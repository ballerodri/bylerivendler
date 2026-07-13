# Reserva separada — Plan de implementación (Etapa 1b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta pueda elegir **varios servicios, cada uno con su fecha y horario**, y pagar **una sola seña**.

**Architecture:** Se agrega un **tercer camino** a la reserva, junto al normal ("juntos": todos los servicios encadenados el mismo día, **un** turno) y al del pack. En el modo **"separados"** se crea **un turno por servicio**, cada uno con su propio precio y su propia seña; el importe que se le pide transferir es **la suma de esas señas**. Reusa la mecánica ya probada del pack multi-sesión: varias fechas → varios turnos en una sola llamada, revalidación por slot, chequeo de auto-superposición y rollback todo-o-nada.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-07-12-reserva-multiple-design.md`

## Global Constraints

- **El modo "juntos" es el camino de ingresos principal del salón: cualquier regresión ahí es crítica.** Sin `serviceSlots` en el payload, el comportamiento debe ser **byte-idéntico** al de hoy: **un** turno, servicios encadenados, `appointment_services` con `starts_at` escalonado.
- **La plata NO se mueve entre turnos.** Cada turno lleva **el precio de su propio servicio**, su `deposit_cents` y su `paid_cents`. Ninguna función mueve plata de un turno a otro. (Ver `docs/superpowers/specs/2026-07-12-pack-multi-sesion-design.md`: intentar que el precio "siguiera" al turno vivo chocó de raíz con facturación, que **factura y deduplica POR TURNO** — una segunda Factura C a ARCA es **irreversible**.)
- **La seña que se le muestra = la SUMA de los `deposit_cents` de cada turno**, NO el 30% del total. Cada turno redondea su propia seña; la suma de los redondeos puede diferir del redondeo de la suma. La clienta transfiere **exactamente** lo que ve.
- **NO hay pasarela de pago.** La app nunca cobra: la clienta transfiere y manda el comprobante por WhatsApp.
- **La clienta es una sola y no puede estar en dos lugares a la vez:** los turnos elegidos **no pueden superponerse entre sí**, aunque sean con profesionales distintas. Los turnos que se están creando **todavía no están en la base**, así que `fetchDayAvailability` **no los ve**: hay que chequearlo a mano (mismo problema ya resuelto en el pack).
- **Todo o nada:** si algún horario falla, **no se crea ningún turno**.
- **En el modo separados TODAS las fechas son obligatorias** (a diferencia del pack: acá son servicios sueltos, no sesiones de algo ya pagado).
- **Los packs y los combos no se tocan.** Un combo sigue siendo **un** turno. Un pack sigue siendo lo que es hoy.
- **Facturación y Estadísticas NO se tocan** (siguen leyendo `total_cents` por turno).
- **No hay migración.** El modelo de datos ya alcanza: un turno por servicio, cada uno con su `appointment_services`.
- Money en centavos (int) en el servidor. `fmtPrice()` toma **PESOS**.
- Verificación en cada tarea: `npx tsc --noEmit` = 0, `npx vitest run` verde, `npm run build` = 0.

---

### Task 1: Reglas puras del modo separados (TDD)

**Files:**
- Create: `src/lib/servicios/multi-booking.ts`
- Test: `src/lib/servicios/multi-booking.test.ts`

**Interfaces:**
- Consumes: `amountDueNow`, `type PayChoice` de `./payments`.
- Produces:
  - `type SlotItem = { serviceId: string; name: string; startsAtMs: number; durationMin: number; priceCents: number }`
  - `separateDeposits(priceCentsList: number[], choice: PayChoice): number[]`
  - `totalDueNowSeparate(priceCentsList: number[], choice: PayChoice): number`
  - `validateSeparateSlots(items: SlotItem[], nowMs: number): { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/servicios/multi-booking.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { separateDeposits, totalDueNowSeparate, validateSeparateSlots, type SlotItem } from "./multi-booking"

const T0 = Date.parse("2026-08-10T13:00:00.000Z") // lunes 10:00 AR
const HOUR = 3_600_000

function item(p: Partial<SlotItem> & { name: string; startsAtMs: number }): SlotItem {
  return {
    serviceId: p.serviceId ?? p.name,
    name: p.name,
    startsAtMs: p.startsAtMs,
    durationMin: p.durationMin ?? 60,
    priceCents: p.priceCents ?? 1_000_000,
  }
}

describe("separateDeposits", () => {
  it("cada turno lleva la seña de SU propio precio", () => {
    expect(separateDeposits([10_000_000, 5_000_000], "deposit")).toEqual([3_000_000, 1_500_000])
  })

  it("si eligió pagar el total, cada turno pide su precio completo", () => {
    expect(separateDeposits([10_000_000, 5_000_000], "full")).toEqual([10_000_000, 5_000_000])
  })

  it("un turno en 0 (canje) no pide nada", () => {
    expect(separateDeposits([0, 5_000_000], "deposit")).toEqual([0, 1_500_000])
  })

  it("sin servicios devuelve una lista vacía", () => {
    expect(separateDeposits([], "deposit")).toEqual([])
  })
})

describe("totalDueNowSeparate", () => {
  it("es la SUMA de las señas de cada turno", () => {
    expect(totalDueNowSeparate([10_000_000, 5_000_000], "deposit")).toBe(4_500_000)
  })

  it("pagando el total, es la suma de los precios", () => {
    expect(totalDueNowSeparate([10_000_000, 5_000_000], "full")).toBe(15_000_000)
  })

  it("la suma de los redondeos NO siempre es el redondeo de la suma (por eso existe esta función)", () => {
    // 5*0.3 = 1,5 -> Math.round redondea a 2 en cada turno = 4
    // (5+5)*0.3 = 3 -> redondear la suma daría 3. La clienta transfiere lo que
    // suman los turnos, así que la fuente de verdad es la suma de los redondeos.
    expect(totalDueNowSeparate([5, 5], "deposit")).toBe(4)
  })
})

describe("validateSeparateSlots", () => {
  const now = T0 - 24 * HOUR

  it("dos turnos que no se pisan: OK", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + 2 * HOUR, durationMin: 90 })],
      now
    )
    expect(r).toEqual({ ok: true })
  })

  it("pegados exactamente (uno termina cuando empieza el otro): OK", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + HOUR, durationMin: 30 })],
      now
    )
    expect(r).toEqual({ ok: true })
  })

  it("se superponen -> error que nombra los DOS servicios", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + 30 * 60_000, durationMin: 60 })],
      now
    )
    expect(r).toEqual({
      ok: false,
      error: "Masaje se superpone con Limpieza. No podés estar en dos servicios a la vez.",
    })
  })

  it("detecta la superposición aunque vengan desordenados", () => {
    const r = validateSeparateSlots(
      [item({ name: "Masaje", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
       item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 })],
      now
    )
    expect(r.ok).toBe(false)
  })

  it("una fecha en el pasado -> error que nombra el servicio", () => {
    const r = validateSeparateSlots([item({ name: "Limpieza", startsAtMs: now - HOUR })], now)
    expect(r).toEqual({ ok: false, error: "Limpieza tiene que ser en una fecha futura." })
  })

  it("una fecha inválida (NaN) -> error", () => {
    const r = validateSeparateSlots([item({ name: "Limpieza", startsAtMs: NaN })], now)
    expect(r.ok).toBe(false)
  })

  it("un solo servicio: no hay con qué superponerse", () => {
    expect(validateSeparateSlots([item({ name: "Limpieza", startsAtMs: T0 })], now)).toEqual({ ok: true })
  })

  it("sin servicios -> error (en este modo las fechas son obligatorias)", () => {
    expect(validateSeparateSlots([], now)).toEqual({
      ok: false,
      error: "Elegí fecha y hora para cada servicio.",
    })
  })

  it("tres turnos, el 3º pisa al 1º", () => {
    const r = validateSeparateSlots(
      [item({ name: "A", startsAtMs: T0, durationMin: 60 }),
       item({ name: "B", startsAtMs: T0 + 5 * HOUR, durationMin: 60 }),
       item({ name: "C", startsAtMs: T0 + 30 * 60_000, durationMin: 30 })],
      now
    )
    expect(r).toEqual({
      ok: false,
      error: "C se superpone con A. No podés estar en dos servicios a la vez.",
    })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/servicios/multi-booking.test.ts`
Expected: FAIL — "Failed to resolve import './multi-booking'".

- [ ] **Step 3: Implementar**

Crear `src/lib/servicios/multi-booking.ts`:

```ts
import { amountDueNow, type PayChoice } from "./payments"

/**
 * Reglas del modo "separados": varios servicios, cada uno con SU fecha, cada
 * uno en SU turno, con UNA sola seña. Lógica PURA (sin servidor) para poder
 * testearla y usar la MISMA regla en la pantalla y en el servidor.
 */

/** Un servicio con la fecha que la clienta le eligió. */
export type SlotItem = {
  serviceId: string
  name: string
  /** Comienzo del turno, en ms UTC. */
  startsAtMs: number
  durationMin: number
  priceCents: number
}

/**
 * La seña de CADA turno, calculada sobre el precio de SU propio servicio.
 * La plata no se mueve entre turnos: cada uno es autosuficiente.
 */
export function separateDeposits(priceCentsList: number[], choice: PayChoice): number[] {
  return priceCentsList.map((p) => amountDueNow(p, choice))
}

/**
 * El importe ÚNICO que se le pide transferir: la SUMA de las señas de cada
 * turno.
 *
 * ⚠️ NO es `amountDueNow(suma de los precios)`. Cada turno redondea su propia
 * seña, y la suma de los redondeos puede diferir del redondeo de la suma. Lo
 * que la clienta transfiere tiene que ser exactamente lo que suman los
 * `deposit_cents` que quedan guardados.
 */
export function totalDueNowSeparate(priceCentsList: number[], choice: PayChoice): number {
  return separateDeposits(priceCentsList, choice).reduce((a, d) => a + d, 0)
}

/**
 * Valida las fechas elegidas: todas futuras y **ninguna se superpone con otra**.
 *
 * La no-superposición es obligatoria aunque los turnos sean con profesionales
 * distintas: la clienta es una sola. Los turnos todavía no existen en la base,
 * así que la disponibilidad real no los ve entre sí — hay que chequearlo acá.
 */
export function validateSeparateSlots(
  items: SlotItem[],
  nowMs: number
): { ok: true } | { ok: false; error: string } {
  if (items.length === 0)
    return { ok: false, error: "Elegí fecha y hora para cada servicio." }

  for (const it of items) {
    if (!Number.isFinite(it.startsAtMs))
      return { ok: false, error: `La fecha de ${it.name} no es válida.` }
    if (it.startsAtMs <= nowMs)
      return { ok: false, error: `${it.name} tiene que ser en una fecha futura.` }
  }

  // Se ordena una copia por comienzo: así, al comparar cada turno con el
  // anterior, el mensaje nombra al que la clienta puso DESPUÉS en el tiempo.
  const sorted = [...items].sort((a, b) => a.startsAtMs - b.startsAtMs)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const prevEnd = prev.startsAtMs + prev.durationMin * 60_000
    // Pegados exactamente (prevEnd === cur.startsAtMs) está permitido.
    if (cur.startsAtMs < prevEnd)
      return {
        ok: false,
        error: `${cur.name} se superpone con ${prev.name}. No podés estar en dos servicios a la vez.`,
      }
  }

  return { ok: true }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/multi-booking.test.ts`
Expected: PASS — **15 tests** (4 de `separateDeposits`, 3 de `totalDueNowSeparate`, 8 de `validateSeparateSlots`).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/multi-booking.ts src/lib/servicios/multi-booking.test.ts
git commit -m "feat(separados): reglas puras (seña por turno, suma, no-superposición)"
```

---

### Task 2: El email de varios turnos

**Files:**
- Modify: `src/lib/email/booking-emails.ts` (agregar `sendMultiBookingConfirmation`)

**Interfaces:**
- Produces: `sendMultiBookingConfirmation(data: MultiBookingEmailData): Promise<{ ok: boolean; error?: string }>`

**Por qué existe:** `sendBookingConfirmation` tiene **una sola** `startsAt` — no puede describir varios turnos en fechas distintas. Y mandar un mail por turno le haría creer a la clienta que debe **una seña por cada uno**, que es justo el problema que esta función viene a resolver. Tiene que ser **un** mail, con **una** seña.

- [ ] **Step 1: Agregar la función**

Al final de `src/lib/email/booking-emails.ts`. Usa **exactamente** los helpers que el archivo ya define: `resend` (:6), `FROM` (:10), `SITE` (:11), `fmtDateAR` (:23), `fmtPrice` (:35, toma **centavos**), `shell` (:39), `ctaButtons` (:311), `escape` (:342). El layout es el mismo de `sendPackConfirmation` (:350).

```ts
/**
 * Confirmación de una reserva con VARIOS turnos, cada uno en su fecha.
 *
 * Es UN solo mail con UNA sola seña **a propósito**: mandar uno por turno le
 * haría creer a la clienta que debe una seña por cada servicio, que es justo el
 * problema que este modo viene a resolver.
 */
export async function sendMultiBookingConfirmation(data: {
  to: string
  firstName: string
  /** Un ítem por turno: qué servicio y cuándo. */
  items: { serviceName: string; startsAt: Date }[]
  /** La suma de lo que valen los turnos. */
  totalCents: number
  /**
   * Lo que tiene que transferir AHORA, UNA sola vez: la suma de las señas de
   * cada turno (o la suma de los totales, si eligió pagar todo).
   */
  dueNowCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const subject = `Tus turnos están reservados (${data.items.length})`

  const rows = data.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">${escape(it.serviceName)}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(it.startsAt))}</td></tr>`
    )
    .join("")

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Reserva confirmada</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;">Tus turnos</h1>
    <p style="font-size:14px;margin:0 0 16px;">Hola ${escape(data.firstName)}, reservamos tus ${data.items.length} turnos.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 4px;">Total: <strong>${fmtPrice(data.totalCents)}</strong></p>
    <p style="font-size:14px;margin:0 0 16px;">A transferir ahora: <strong>${fmtPrice(data.dueNowCents)}</strong></p>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Es <strong>una sola transferencia</strong> por los ${data.items.length} turnos. Mandanos el comprobante por WhatsApp y te los confirmamos.</p>
    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
  `

  try {
    await resend.emails.send({ from: FROM, to: data.to, subject, html: shell(subject, body) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al enviar" }
  }
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/booking-emails.ts
git commit -m "feat(separados): email de varios turnos con una sola seña"
```

> **No toques `sendBookingConfirmation` ni `sendPackConfirmation`:** esta función se **suma**, las otras dos siguen sirviendo a sus caminos.

---

### Task 3: El servidor crea un turno por servicio

**Files:**
- Modify: `src/app/reserva/actions.ts`

**Interfaces:**
- Consumes de Task 1: `validateSeparateSlots`, `type SlotItem`.
- Consumes de Task 2: `sendMultiBookingConfirmation`.
- Consumes (ya existe): `amountDueNow`, `type PayChoice` de `@/lib/servicios/payments`.
- Produces:
  - `CreateBookingResult` gana `appointmentIds?: string[]`.
  - `createBooking` acepta `serviceSlots?: Record<string, string>` (serviceId → ISO) y `serviceStaff?: Record<string, string>` (serviceId → `"auto"` | staffId).

- [ ] **Step 1: Imports, schema y tipo de resultado**

1. Importar arriba, junto a los otros de `@/lib/servicios`:

```ts
import { validateSeparateSlots, type SlotItem } from "@/lib/servicios/multi-booking"
```

y junto a los otros de email:

```ts
import { sendMultiBookingConfirmation } from "@/lib/email/booking-emails"
```

(si `sendBookingConfirmation` ya se importa de ahí, agregalo a **esa misma** línea de import).

2. En `BookingInput` (línea ~15), agregar junto a `packSlots`:

```ts
  // Modo "separados": una fecha por servicio (serviceId → ISO). Si no viene,
  // la reserva es la de siempre: UN turno con los servicios encadenados.
  serviceSlots: z.record(z.string().uuid(), z.string().datetime()).optional(),
  // Profesional preferida por servicio ("auto" o un staffId).
  serviceStaff: z.record(z.string().uuid(), z.string()).optional(),
```

3. `CreateBookingResult` (línea ~45) pasa a:

```ts
export type CreateBookingResult =
  | { ok: true; appointmentId: string; appointmentIds?: string[] }
  | { ok: false; error: string }
```

> `appointmentId` sigue siendo el **primer** turno, para no romper a nadie que ya lo lea. `appointmentIds` sólo viene en el modo separados.

- [ ] **Step 2: El rollback (todo o nada)**

Justo **debajo** de `rollbackPackAttempt` (que termina ~línea 84), agregar:

```ts
/**
 * Deshace (todo o nada) los turnos ya creados de una reserva "separados" que
 * falló a mitad de camino. Si la clienta había canjeado con puntos, los puntos
 * ya se descontaron ANTES de crear los turnos: se le devuelven, porque no se
 * queda con ningún turno.
 */
async function rollbackSeparateAttempt(
  supabase: ReturnType<typeof adminClient>,
  createdIds: string[],
  clientId: string,
  pointsToRefund: number,
  fallbackError: string
): Promise<CreateBookingResult> {
  if (createdIds.length) {
    const { error: delErr } = await supabase.from("appointments").delete().in("id", createdIds)
    if (delErr) {
      // No pudimos deshacer: quedan turnos sueltos en la agenda. Que NO
      // reintente sola (duplicaría los turnos): que llame al salón.
      return {
        ok: false,
        error:
          "Hubo un problema al crear tus turnos y no pudimos deshacerlo por completo. Por favor comunicate con el salón para confirmar el estado de tu reserva antes de volver a intentar.",
      }
    }
  }
  if (pointsToRefund > 0) {
    const { data: c } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    await supabase
      .from("clients")
      .update({ loyalty_points: ((c?.loyalty_points as number | null) ?? 0) + pointsToRefund })
      .eq("id", clientId)
  }
  return { ok: false, error: fallbackError }
}
```

- [ ] **Step 3: La rama "separados"**

Ubicación **exacta**: dentro de `createBooking`, **después** del bloque `if (redeem) { ... }` que valida y descuenta los puntos (el que termina ~línea 438) y **antes** del comentario `// 5) Determine main staff`. Ahí ya están en alcance: `services`, `computed`, `payChoice`, `redeem`, `totalPointsCost`, `totalCents`, `clientId`, `email`, `alreadyLinked`, `authUser`, `room`, `supabase`, `input`.

```ts
  // ── Varios servicios, cada uno con SU fecha (modo "separados") ─────────────
  // Un turno por servicio, con UNA sola seña (la suma de las de cada turno).
  // El modo "juntos" (los servicios encadenados el mismo día) NO pasa por acá:
  // sigue siendo UN turno, más abajo, exactamente como siempre.
  if (input.serviceSlots && services.length >= 2 && !input.comboId) {
    // En este modo las fechas son TODAS obligatorias.
    if (services.some((s) => !input.serviceSlots![s.id]))
      return { ok: false, error: "Elegí fecha y hora para cada servicio." }

    const slots: SlotItem[] = services.map((s) => ({
      serviceId: s.id,
      name: s.name,
      startsAtMs: new Date(input.serviceSlots![s.id]).getTime(),
      durationMin: computed[s.id].durationMin,
      priceCents: computed[s.id].priceCents,
    }))

    const rules = validateSeparateSlots(slots, Date.now())
    if (!rules.ok) return { ok: false, error: rules.error }

    // Revalidar CADA horario contra la disponibilidad real (autoritativo),
    // con la duración y la profesional de ESE servicio.
    const { data: bhRows } = await supabase
      .from("business_hours")
      .select("day_of_week, is_open, slots")
    const bhByDow = new Map(
      ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
        .map((h) => [h.day_of_week, h])
    )

    const hintFor = (serviceId: string) => {
      const h = input.serviceStaff?.[serviceId] ?? input.proHint
      return h && h !== "auto" ? h : "auto"
    }

    for (const s of slots) {
      const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(new Date(s.startsAtMs))
      const bh = bhByDow.get(dayOfWeek)
      if (!bh?.is_open || !bh.slots.includes(timeStr))
        return { ok: false, error: `El horario de ${s.name} ya no está disponible. Elegí otro.` }
      const free = await fetchDayAvailability(dateStr, s.durationMin, hintFor(s.serviceId), [timeStr])
      if (!free.includes(timeStr))
        return { ok: false, error: `El horario de ${s.name} se ocupó. Elegí otro.` }
    }

    // ── Un turno por servicio ────────────────────────────────────────────────
    const createdIds: string[] = []
    const refund = redeem ? totalPointsCost : 0

    for (const s of slots) {
      const hint = hintFor(s.serviceId)
      const staffId = hint !== "auto" ? hint : null
      const sStart = new Date(s.startsAtMs)
      const sEnd = new Date(s.startsAtMs + s.durationMin * 60_000)

      const { data: a, error: aErr } = await supabase
        .from("appointments")
        .insert({
          client_id: clientId,
          staff_id: staffId,
          room_id: room?.id ?? null,
          starts_at: sStart.toISOString(),
          ends_at: sEnd.toISOString(),
          duration_min: s.durationMin,
          // Cada turno lleva el precio de SU servicio y SU propia seña.
          total_cents: redeem ? 0 : s.priceCents,
          deposit_cents: redeem ? 0 : amountDueNow(s.priceCents, payChoice),
          deposit_paid: redeem,
          paid_cents: 0,
          status: redeem ? "confirmed" : "pending",
          source: "web",
          notes_internal: redeem
            ? `Canjeado con ${totalPointsCost} pts del Programa Cerca`
            : null,
        })
        .select("id")
        .single()

      if (aErr || !a)
        return await rollbackSeparateAttempt(
          supabase, createdIds, clientId, refund,
          `No pudimos crear el turno de ${s.name}: ${aErr?.message}`
        )
      createdIds.push(a.id)

      const { error: lErr } = await supabase.from("appointment_services").insert({
        appointment_id: a.id,
        service_id: s.serviceId,
        duration_min: s.durationMin,
        // El snapshot guarda lo que VALE el servicio aunque se haya canjeado
        // (igual que en el camino normal).
        price_cents: s.priceCents,
        zones: computed[s.serviceId].zones,
        staff_id: staffId,
        starts_at: sStart.toISOString(),
      })
      if (lErr)
        return await rollbackSeparateAttempt(
          supabase, createdIds, clientId, refund,
          `Servicio del turno de ${s.name}: ${lErr.message}`
        )
    }

    // ── De acá para abajo, todo es best-effort: los turnos YA están creados ──
    const ordered = [...slots].sort((a, b) => a.startsAtMs - b.startsAtMs)
    const firstStart = new Date(ordered[0].startsAtMs)
    const sumDuration = slots.reduce((a, s) => a + s.durationMin, 0)
    const sumTotal = redeem ? 0 : slots.reduce((a, s) => a + s.priceCents, 0)
    const dueNow = redeem
      ? 0
      : slots.reduce((a, s) => a + amountDueNow(s.priceCents, payChoice), 0)

    // Google Calendar: un evento por turno.
    for (let i = 0; i < createdIds.length; i++) {
      try {
        const s = slots[i]
        const hint = hintFor(s.serviceId)
        const staffId = hint !== "auto" ? hint : null
        let staffName: string | null = null
        let staffEmail: string | null = null
        let staffColorId: string | null = null
        if (staffId) {
          const { data: staffRow } = await supabase
            .from("staff")
            .select("full_name, email, calendar_color_id")
            .eq("id", staffId)
            .maybeSingle()
          staffName = staffRow?.full_name ?? null
          staffEmail = staffRow?.email ?? null
          staffColorId = (staffRow as { calendar_color_id?: string | null } | null)?.calendar_color_id ?? null
        }
        const eventId = await createCalendarEvent({
          appointmentId: createdIds[i],
          clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
          serviceNames: [s.name],
          staffName,
          staffEmail,
          staffColorId,
          startsAt: new Date(s.startsAtMs),
          endsAt: new Date(s.startsAtMs + s.durationMin * 60_000),
          notes: null,
        })
        if (eventId)
          await supabase.from("appointments").update({ google_event_id: eventId }).eq("id", createdIds[i])
      } catch {
        // Non-fatal: los turnos ya están creados.
      }
    }

    // UN solo mail, con UNA sola seña.
    try {
      await sendMultiBookingConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        items: ordered.map((s) => ({ serviceName: s.name, startsAt: new Date(s.startsAtMs) })),
        totalCents: sumTotal,
        dueNowCents: dueNow,
      })
    } catch {
      // ignore — la reserva ya está; el equipo puede reenviar manualmente.
    }

    // UN solo aviso al salón (no uno por turno).
    try {
      await notifyNewBooking(supabase, {
        clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
        clientPhone: input.client.phone,
        servicesNames: ordered.map((s) => s.name),
        startsAt: firstStart,
        durationMin: sumDuration,
        totalCents: sumTotal,
        assignedStaffIds: slots.map((s) => {
          const h = hintFor(s.serviceId)
          return h !== "auto" ? h : null
        }),
      })
    } catch {
      // ignore
    }

    if (!authUser && !alreadyLinked) {
      try {
        const h = await headers()
        const proto = h.get("x-forwarded-proto") ?? "http"
        const host = h.get("host")
        const origin = `${proto}://${host}`
        const plain = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )
        await plain.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${origin}/auth/callback?next=/portal`,
            shouldCreateUser: true,
          },
        })
      } catch {
        // ignore
      }
    }

    return { ok: true, appointmentId: createdIds[0], appointmentIds: createdIds }
  }
```

> **Nota sobre el orden:** el descuento de puntos ya ocurrió arriba (paso 4b). Las validaciones de horario de esta rama corren **antes** de cualquier insert, así que el único fallo posible después del descuento es un error de la base — y para ese caso `rollbackSeparateAttempt` **devuelve los puntos**.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0. Vitest: los 60 previos + 15 de Task 1 = **75**.

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(separados): un turno por servicio, con una sola seña"
```

---

### Task 4: La página de éxito muestra los varios turnos

**Files:**
- Modify: `src/app/reserva/exito/page.tsx`

**Interfaces:**
- Consumes de Task 3: `createBooking` devuelve `appointmentIds`.
- Produces: `/reserva/exito?id=A,B,C` muestra los N turnos y **una sola** seña.

**Por qué:** hoy la página lee **un** `id` y muestra **un** turno con **su** precio. Si la reserva creó 3 turnos y mostramos sólo el primero, la clienta ve un precio que no es el que tiene que transferir. Eso es un error de plata, no de estética.

- [ ] **Step 1: Traer los N turnos**

En `src/app/reserva/exito/page.tsx`:

1. `ApptRow` (:10) gana la seña:

```ts
type ApptRow = {
  id: string
  starts_at: string
  duration_min: number
  total_cents: number
  deposit_cents: number
  client: { first_name: string | null } | null
  appointment_services: { service: { name: string } | null }[]
}
```

2. Reemplazar el bloque que va desde `const { id } = await searchParams` (:24) hasta `const firstName = appt.client?.first_name ?? ""` (:48) por:

```tsx
  const { id } = await searchParams
  if (!id) notFound()
  // El modo "separados" crea varios turnos: llegan como "id1,id2,id3".
  const ids = id.split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) notFound()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("appointments")
    .select(
      "id, starts_at, duration_min, total_cents, deposit_cents, client:clients(first_name), appointment_services(service:services(name))"
    )
    .in("id", ids)
    .order("starts_at", { ascending: true })

  const appts = (data ?? []) as unknown as ApptRow[]
  if (appts.length === 0) notFound()

  const appt = appts[0]
  const firstName = appt.client?.first_name ?? ""
  const dueNowCents = appts.reduce((acc, a) => acc + a.deposit_cents, 0)
```

> `date`, `dow` y `services` (que hoy se derivan de `appt`) **dejan de existir a nivel de página**: pasan a calcularse por turno, dentro de la tarjeta (paso 2). Si quedan referencias sueltas, `tsc` las va a marcar.

- [ ] **Step 2: Una tarjeta por turno, y una sola seña**

Reemplazar el bloque `{/* Card with appointment details */}` entero (el `<div className="success__card">…</div>`, ~:116-146) por:

```tsx
        {/* Card with appointment details — una por turno */}
        {appts.map((a) => {
          const aDate = new Date(a.starts_at)
          const aDow = DOW_NAMES[(aDate.getDay() + 6) % 7]
          const aServices = a.appointment_services
            .map((as) => as.service?.name)
            .filter((n): n is string => Boolean(n))
          return (
            <div
              key={a.id}
              className="success__card"
              style={{ textAlign: "left", marginBottom: 24 }}
            >
              {aServices.map((name) => (
                <div key={name} style={{ marginBottom: 8 }}>
                  <div className="success__svc">{name}</div>
                </div>
              ))}
              <div
                className="success__when"
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <strong>
                  {aDow} {aDate.getDate()} de{" "}
                  {MONTH_NAMES[aDate.getMonth()].toLowerCase()}
                </strong>{" "}
                ·{" "}
                {aDate.toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                hs · {fmtDuration(a.duration_min)} ·{" "}
                {fmtPrice(a.total_cents / 100)}
                <br />
                <a
                  href={MAPS_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: 2 }}
                >
                  {ADDRESS_LINE} · {ADDRESS_AREA}
                </a>
              </div>
            </div>
          )
        })}

        {/* Con varios turnos, la seña es UNA sola: hay que decirlo. */}
        {appts.length > 1 && (
          <div
            className="success__card"
            style={{ textAlign: "left", marginBottom: 24 }}
          >
            <div className="success__when">
              <strong>A transferir ahora: {fmtPrice(dueNowCents / 100)}</strong>
              <br />
              Es <strong>una sola transferencia</strong> por los {appts.length} turnos.
            </div>
          </div>
        )}
```

> **Con un solo turno la página queda idéntica a hoy**: mismo markup, mismas clases (`success__card`, `success__svc`, `success__when`), mismos helpers (`DOW_NAMES`, `MONTH_NAMES`, `fmtDuration`, `fmtPrice`), y el bloque de la seña **no aparece** (`appts.length > 1`). No agregues CSS: no hace falta ninguna clase nueva.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos exit 0.

- [ ] **Step 4: Verificación manual**

Con un turno existente: `/reserva/exito?id=<un-id>` se ve **igual que antes** (sin la tarjeta de "a transferir").
Con dos: `/reserva/exito?id=<id1>,<id2>` muestra las dos tarjetas y la suma.

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/exito/page.tsx
git commit -m "feat(separados): la página de éxito muestra los varios turnos y una sola seña"
```

---

### Task 5: La clienta elige el modo y la fecha de cada servicio

**Files:**
- Modify: `src/app/reserva/data.ts` (`BookingState`)
- Modify: `src/app/reserva/flow.tsx` (`FLOW_VERSION`)
- Modify: `src/app/reserva/screens.tsx` (`Screen2DateTime` + `clearedResolution`)

**Interfaces:**
- Consumes de Task 1: `validateSeparateSlots`.
- Produces: `state.bookingMode` (`"juntos" | "separados"`) y `state.serviceSlots` (serviceId → ISO), poblados.

- [ ] **Step 1: El estado**

En `src/app/reserva/data.ts`, en `BookingState`, agregar después de `packSlots`:

```ts
  // Con 2+ servicios: "juntos" = el mismo día, uno después del otro (lo de
  // siempre) · "separados" = cada uno en su fecha. Default: "juntos".
  bookingMode?: "juntos" | "separados"
  // Modo separados: la fecha elegida de cada servicio (serviceId → ISO UTC).
  serviceSlots?: Record<string, string>
```

- [ ] **Step 2: Que un cambio de compra NO deje fechas viejas**

En `src/app/reserva/screens.tsx`, el objeto `clearedResolution` (~línea 100) se spreadea en **todos** los handlers que cambian qué se está comprando. Un `serviceSlots` viejo sobreviviendo a un cambio de servicios dejaría la compra **muerta** (fechas de un servicio que ya no está). Agregarle los dos campos nuevos:

```ts
const clearedResolution = {
  packSlots: undefined,
  serviceSlots: undefined,
  bookingMode: undefined,
  serviceOrder: undefined,
  resolvedStaff: undefined,
  selectedDate: undefined,
  selectedTime: null,
} as const
```

- [ ] **Step 3: Invalidar el estado guardado de los navegadores**

En `src/app/reserva/flow.tsx`, `FLOW_VERSION` pasa de `3` a `4`:

```ts
const FLOW_VERSION = 4
```

> El wizard guarda `BookingState` en `localStorage`. Una clienta con una reserva a medias de **antes** de este deploy tiene un estado con la forma vieja; bumpear la versión lo descarta y arranca limpio. Sin esto, un estado viejo puede producir una compra imposible de completar.

- [ ] **Step 4: El selector de modo y la lista de fechas**

En `src/app/reserva/screens.tsx`, dentro de `Screen2DateTime`:

1. Junto a los otros `useState` del componente (arriba de todo, **antes** de cualquier `return`, para no romper las reglas de hooks), agregar:

```tsx
  // Modo separados: qué servicio se está fechando ahora (null = mostrando la lista)
  const [pickingServiceId, setPickingServiceId] = useState<string | null>(null)
```

2. Junto a las otras constantes derivadas (después de `const selectedPack = state.pack ?? null`):

```tsx
  // Elegir "separados" sólo tiene sentido con 2+ servicios sueltos: un combo es
  // un turno por definición, y un pack ya tiene su propia pantalla de fechas.
  const canSeparate = !selectedPack && !state.combo && state.services.length >= 2
  const bookingMode = canSeparate ? (state.bookingMode ?? "juntos") : "juntos"
  const serviceSlots = state.serviceSlots ?? {}
```

3. Un helper para el selector, junto a `Cal()` y `Slots()` (son funciones locales del componente):

```tsx
  const setMode = (m: "juntos" | "separados") => {
    // Al cambiar de modo, lo elegido en el otro modo deja de valer.
    setState({
      ...state,
      bookingMode: m,
      serviceSlots: undefined,
      serviceOrder: undefined,
      resolvedStaff: undefined,
      selectedDate: undefined,
      selectedTime: null,
    })
    setPickingServiceId(null)
  }

  const ModeChooser = () =>
    !canSeparate ? null : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 20px" }}>
        <strong style={{ fontFamily: "var(--serif)", fontSize: 15 }}>
          Elegiste {state.services.length} servicios. ¿Cómo los querés?
        </strong>
        {([
          { v: "juntos" as const, label: "El mismo día, uno después del otro", note: "Venís una sola vez" },
          { v: "separados" as const, label: "Cada uno en su fecha y horario", note: "Elegís cuándo va cada uno" },
        ]).map((o) => (
          <label
            key={o.v}
            style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              padding: "12px 14px", borderRadius: 12, fontSize: 13,
              border: `1px solid ${bookingMode === o.v ? "var(--nude)" : "var(--line)"}`,
              background: bookingMode === o.v ? "var(--rose-wash)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === o.v}
              onChange={() => setMode(o.v)}
              style={{ width: 16, height: 16, accentColor: "#b68a5f" }}
            />
            <span style={{ flex: 1 }}>
              <strong>{o.label}</strong>
              <br />
              <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{o.note}</span>
            </span>
          </label>
        ))}
      </div>
    )
```

4. Un helper de fecha a nivel de **módulo** (junto a los otros helpers de `screens.tsx`, arriba de los componentes):

```tsx
function fmtSlotAR(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  })
}
```

5. La rama del modo separados. Va **después** del bloque `if (selectedPack) { ... }` (que cierra ~línea 1135) y **antes** del `if (variant === "desktop")` del render normal.

Copia la estructura **exacta** de la rama del pack (picker + lista, cada uno con su `Body`/`FooterCTA` y su doble render desktop/mobile). `TopBar` toma **sólo** `onBack` y `onClose`; el paso se muestra con `<Progress step={stepNumber} total={totalSteps} />`; los botones son `btn`, `btn btn--primary`, `btn--back`, y la flecha es `<span className="btn__arrow"><Icon.Arrow /></span>`:

```tsx
  // ── Separados: cada servicio con SU fecha ─────────────────────────────────
  if (bookingMode === "separados") {
    const picking = pickingServiceId
      ? state.services.find((s) => s.id === pickingServiceId) ?? null
      : null

    if (picking) {
      const eff = effectiveService(picking, zoneSel)
      const backToList = () => setPickingServiceId(null)

      const PickerBody = () => (
        <>
          <h1 className="headline">{picking.name}</h1>
          <p className="lede">Elegí cuándo querés este servicio.</p>
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={eff.duration}
            proHint={serviceStaff[picking.id] ?? "auto"}
            minDate={null}
            onPick={(iso) => {
              setState({ ...state, serviceSlots: { ...serviceSlots, [picking.id]: iso } })
              setPickingServiceId(null)
            }}
            onCancel={backToList}
          />
        </>
      )
      const PickerFooterCTA = () => (
        <div className="footer">
          <div className="footer__row">
            <button className="btn--back" onClick={backToList}>
              ← Atrás
            </button>
          </div>
        </div>
      )

      if (variant === "desktop") {
        return (
          <div className="dmain">
            <div className="dmain__inner">{PickerBody()}</div>
            {PickerFooterCTA()}
          </div>
        )
      }

      return (
        <div className="screen">
          <TopBar onBack={backToList} onClose={onClose} />
          <Progress step={stepNumber} total={totalSteps} />
          <div className="screen__body">{PickerBody()}</div>
          {PickerFooterCTA()}
        </div>
      )
    }

    // Las fechas elegidas, validadas con la MISMA regla que el servidor.
    const chosen = state.services
      .filter((s) => serviceSlots[s.id])
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        startsAtMs: new Date(serviceSlots[s.id]).getTime(),
        durationMin: effectiveService(s, zoneSel).duration,
        priceCents: Math.round(effectiveService(s, zoneSel).price * 100),
      }))
    const overlap =
      chosen.length >= 2 ? validateSeparateSlots(chosen, Date.now()) : ({ ok: true } as const)
    const allPicked = state.services.every((s) => serviceSlots[s.id])
    const canContinue = allPicked && overlap.ok

    const SepBody = () => (
      <>
        <h1 className="headline">Tus <em>turnos</em></h1>
        <p className="lede">Elegí la fecha de cada servicio.</p>

        {ModeChooser()}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
          {state.services.map((s) => {
            const iso = serviceSlots[s.id]
            const eff = effectiveService(s, zoneSel)
            return (
              <div
                key={s.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "10px 12px", border: "1px solid var(--line)",
                  borderRadius: 10,
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <strong>{s.name}</strong> · {eff.duration} min
                  <br />
                  {iso ? (
                    fmtSlotAR(iso)
                  ) : (
                    <span style={{ color: "var(--ink-mute)" }}>— falta elegir la fecha —</span>
                  )}
                </span>
                <button className="btn" onClick={() => setPickingServiceId(s.id)}>
                  {iso ? "Cambiar" : "Elegir fecha"}
                </button>
              </div>
            )
          })}
        </div>

        {!overlap.ok && (
          <p style={{ fontSize: 12, color: "#8c463c", margin: "0 0 8px" }}>{overlap.error}</p>
        )}
      </>
    )

    const SepFooterCTA = () => (
      <div className="footer">
        <div className="footer__row">
          <button className="btn--back" onClick={onBack}>
            ← Atrás
          </button>
          <button className="btn btn--primary" disabled={!canContinue} onClick={onNext}>
            {!allPicked ? "Elegí la fecha de cada servicio" : "Continuar"}
            <span className="btn__arrow">
              <Icon.Arrow />
            </span>
          </button>
        </div>
      </div>
    )

    if (variant === "desktop") {
      return (
        <div className="dmain">
          <div className="dmain__inner">{SepBody()}</div>
          {SepFooterCTA()}
        </div>
      )
    }

    return (
      <div className="screen">
        <TopBar onBack={onBack} onClose={onClose} />
        <Progress step={stepNumber} total={totalSteps} />
        <div className="screen__body">{SepBody()}</div>
        {SepFooterCTA()}
      </div>
    )
  }
```

> **Crítico (se aprendió a los golpes en el pack):** la pantalla del picker **tiene que tener Atrás y cerrar** (`TopBar` + `btn--back`), o en celular la clienta queda **atrapada** sin salida. Ya está arriba: no lo saques.

6. Que desde el modo "juntos" se pueda pasar a "separados": en el render normal (el `if (variant === "desktop")` y el return de mobile que vienen después, ~líneas 1137-1180), insertar `{ModeChooser()}` **justo arriba** de la llamada a `{Cal()}`, en **los dos**.

7. Importar arriba de `screens.tsx`:

```tsx
import { validateSeparateSlots } from "@/lib/servicios/multi-booking"
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/data.ts src/app/reserva/flow.tsx src/app/reserva/screens.tsx
git commit -m "feat(separados): elegir el modo y la fecha de cada servicio"
```

---

### Task 6: La confirmación suma una sola seña

**Files:**
- Modify: `src/app/reserva/screens.tsx` (`Screen5Confirm`)

**Interfaces:**
- Consumes de Task 1: `totalDueNowSeparate`.
- Consumes de Task 3: `createBooking` acepta `serviceSlots` / `serviceStaff` y devuelve `appointmentIds`.

- [ ] **Step 1: La seña del modo separados**

En `Screen5Confirm`, hoy el cálculo es:

```tsx
  const totalCents = Math.round(total * 100)
  const depositCents = redeeming ? 0 : amountDueNow(totalCents, payChoice)
```

Reemplazarlo por:

```tsx
  const separados =
    !pack && !combo && services.length >= 2 && (state.bookingMode ?? "juntos") === "separados"

  const totalCents = Math.round(total * 100)
  // En "separados" cada turno lleva su propia seña: lo que transfiere es la
  // SUMA de esas señas, no el 30% del total (cada turno redondea la suya).
  const depositCents = redeeming
    ? 0
    : separados
      ? totalDueNowSeparate(services.map((s) => Math.round(effective(s).price * 100)), payChoice)
      : amountDueNow(totalCents, payChoice)
```

> El resto (`const deposit = depositCents / 100`, `remaining`, los radios de "¿Cuánto vas a pagar ahora?") **no cambia**: ya trabaja sobre `depositCents`.

- [ ] **Step 2: Los radios muestran el importe correcto en separados**

El bloque de los radios calcula el importe de cada opción con `amountDueNow(totalCents, o.v) / 100`. En separados hay que usar la misma suma. Extraer un helper arriba, junto a `depositCents`:

```tsx
  const dueNowFor = (c: PayChoice) =>
    separados
      ? totalDueNowSeparate(services.map((s) => Math.round(effective(s).price * 100)), c)
      : amountDueNow(totalCents, c)
```

y en los radios, reemplazar `amountDueNow(Math.round(total * 100), o.v) / 100` (o `amountDueNow(totalCents, o.v) / 100`, según cómo haya quedado) por:

```tsx
{fmtPrice(dueNowFor(o.v) / 100)}
```

- [ ] **Step 3: Mostrar CUÁNDO es cada servicio**

La fila "Cuándo" (~líneas 1812-1846) hoy tiene la forma `{pack ? (A) : (B)}`, donde **A** es la lista de sesiones del pack y **B** es la fecha única. Necesita una tercera rama.

**No reescribas A ni B.** Insertá `separados ? ( … ) :` **entre** el `:` que cierra A y el `(B)`, quedando `{pack ? (A) : separados ? (NUEVO) : (B)}`. El bloque nuevo es:

```tsx
            services.map((s) => {
              const iso = state.serviceSlots?.[s.id]
              return (
                <div key={s.id} className="breakdown__row">
                  <span>{s.name}</span>
                  <span>{iso ? fmtSlotAR(iso) : "—"}</span>
                </div>
              )
            })
```

> `fmtSlotAR` es el helper de módulo creado en Task 5 (paso 4). `breakdown__row` es la clase que esa fila ya usa: **confirmala leyendo A y B** y usá la misma.

- [ ] **Step 4: El payload y el guard de `pay()`**

En `pay()`:

1. El guard de "falta la fecha" (hoy: `const missingDate = pack ? … : (!state.selectedDate || !state.selectedTime)`) pasa a:

```tsx
  const missingDate = pack
    ? packSlotsPicked.length === 0
    : separados
      ? !services.every((s) => state.serviceSlots?.[s.id])
      : (!state.selectedDate || !state.selectedTime)
```

2. `startsAt` (hoy: `pack ? new Date(packSlotsPicked[0]) : combineDateTime(...)`) pasa a:

```tsx
  // En separados el servidor usa serviceSlots; startsAt va igual porque el
  // schema lo exige: mandamos el más temprano de los elegidos.
  const startsAt = pack
    ? new Date(packSlotsPicked[0])
    : separados
      ? new Date(
          Math.min(...services.map((s) => new Date(state.serviceSlots![s.id]).getTime()))
        )
      : combineDateTime(state.selectedDate!, state.selectedTime!)
```

3. En el objeto que se le pasa a `createBooking`, agregar:

```tsx
      serviceSlots: separados ? state.serviceSlots : undefined,
      serviceStaff: separados ? state.serviceStaff : undefined,
```

y en las líneas que ya existen, `serviceOrder` y `resolvedStaff` no deben mandarse en separados (son del modo juntos):

```tsx
      serviceOrder: pack || separados ? undefined : state.serviceOrder,
      resolvedStaff: pack || separados ? undefined : state.resolvedStaff,
```

4. La redirección (hoy: `window.location.href = \`/reserva/exito?id=${result.appointmentId}\``) pasa a:

```tsx
      const ids = result.appointmentIds ?? [result.appointmentId]
      window.location.href = `/reserva/exito?id=${ids.join(",")}`
```

- [ ] **Step 5: Importar**

Arriba de `screens.tsx`, agregar a la línea de import de `multi-booking` (creada en Task 5):

```tsx
import { totalDueNowSeparate, validateSeparateSlots } from "@/lib/servicios/multi-booking"
```

- [ ] **Step 6: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 7: Verificación manual (obligatoria)**

En `/reserva`:
1. Elegir **2 servicios** → aparece "¿Cómo los querés?" con las dos opciones.
2. **Juntos** (default): la pantalla es **exactamente la de siempre** (calendario + horarios encadenados).
3. **Separados**: lista con los 2 servicios; elegir fecha de cada uno.
4. Elegir dos horarios que **se pisan** → aparece el error y **no** se puede continuar.
5. Confirmar → **UNA** seña (la suma) → se crean **2 turnos** en el admin, cada uno con **su** precio.
6. La pantalla de éxito muestra **los 2** turnos y **una** sola seña.
7. Un servicio **solo** (sin elegir modo) → todo igual que siempre.

- [ ] **Step 8: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(separados): la confirmación suma una sola seña y crea los turnos"
```

---

### Task 7: Verificación final y deploy

**Files:** ninguno (sólo verificación).

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet
```
Expected: tsc 0, vitest **75** verdes, build 0, eslint **sin errores nuevos** respecto de `main` (main tiene 16 pre-existentes: compararlos, no contarlos).

- [ ] **Step 2: Recorrido end-to-end en dev**

1. **Modo juntos (el camino de siempre)**: 2 servicios el mismo día → **1** turno, servicios encadenados, `appointment_services` con `starts_at` escalonado. **Byte-idéntico a hoy.**
2. **Modo separados**: 2 servicios en días distintos → **2** turnos; cada uno con **su** `total_cents` y **su** `deposit_cents`; la suma de los `deposit_cents` == lo que la pantalla le pidió transferir.
3. **Separados + pagar el total** → cada turno con `deposit_cents == total_cents`.
4. **Separados + canje con puntos** → los 2 turnos en `total_cents: 0`, `confirmed`, y los puntos descontados **una** sola vez.
5. **Superposición** → rechazada por el servidor aunque se fuerce el payload.
6. **Combo** → sigue siendo **1** turno.
7. **Pack** → sin cambios.
8. **Facturación y Estadísticas** → los números no cambiaron (leen `total_cents` por turno).

- [ ] **Step 3: Deploy (lo hace la controladora)**

No hay migración: se pushea el código a `main` y listo.

---

## Notas de riesgo

- **`screens.tsx` (~2300 líneas) ya tiene dos caminos** (normal y pack). Este agrega el tercero. Los tres tienen que convivir: **el camino normal no puede cambiar en nada**.
- **El estado guardado en `localStorage`** es la fuente de bugs más cara de esta serie (una compra puede quedar *muerta* si sobrevive estado viejo). Por eso: `clearedResolution` limpia `serviceSlots`/`bookingMode`, y `FLOW_VERSION` sube a 4.
- **La superposición entre los turnos que se están creando NO la ve la base** (todavía no existen). Si no se chequea a mano, la clienta puede reservarse a sí misma en dos lugares a la vez. Está chequeado en la pantalla **y** en el servidor (el servidor es el autoritativo).
- **La seña es la SUMA de las señas de cada turno**, no el 30% del total. Si alguien "simplifica" eso, la clienta puede transferir un importe que no coincide con lo guardado.
