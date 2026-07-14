# Un pack + servicios sueltos en la misma reserva — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta pueda comprar **un pack y servicios sueltos en la misma reserva**, y pagar **una sola seña**.

**Architecture:** `createBooking` tiene hoy **tres caminos que retornan cada uno por su lado** (pack, "separados", "juntos"), y por eso el pack es excluyente. Se reestructura en **fases**: cada camino pasa a **planificar** los turnos que quiere crear (una lista de `PlannedAppointment`) en vez de crearlos; después se **valida todo junto** (incluida la superposición **cruzada** pack ↔ servicios); y recién entonces **un solo escritor** los crea, con **un solo rollback** todo-o-nada. La mezcla es simplemente "el plan del pack + el plan de los servicios".

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-07-14-pack-mas-servicios-design.md`

## Global Constraints

- **Cuando NO se mezclan, el resultado tiene que ser IDÉNTICO al de hoy.** Un pack solo, servicios solos (juntos o separados), un combo: las mismas filas, la misma plata, los mismos avisos. **El modo "juntos" es el camino de ingresos principal del salón: cualquier regresión ahí es crítica.** Se verifica en la revisión comparando contra `main`.
- **La plata NO se mueve entre turnos.** La sesión 1 del pack lleva el precio **del pack**; las sesiones 2..N van en **$0**; cada servicio suelto lleva **su propio** precio. `packSessionPrices` se llama **UNA sola vez por compra** (índice 0). Mover el precio entre turnos ya chocó con facturación (que factura y deduplica **por turno**) y una segunda Factura C a ARCA es **irreversible**.
- **La seña = la SUMA de los `deposit_cents` de todos los turnos.** NO es el 30% del total: cada turno redondea el suyo. La clienta transfiere **exactamente** lo que ve.
- **La clienta es una sola:** ningún turno puede superponerse con otro — **ni las sesiones del pack con los servicios**. Los turnos que se están creando **todavía no están en la base**, así que la disponibilidad real **no los ve entre sí**: hay que chequearlo en memoria.
- **Todo o nada:** si algo falla, no queda **ningún** turno, **ninguna** `pack_purchase`, y **los puntos se devuelven**.
- ⚠️ **Los puntos se descuentan ANTES de crear los turnos. TODO `return` de error posterior TIENE que devolverlos** (`rollbackAll`). Esta regla ya se rompió tres veces en este código.
- **Con un pack en la compra, el canje con puntos se RECHAZA** (y no se ofrece en la pantalla).
- **Un (1) pack por compra. Los combos siguen siendo excluyentes.**
- **Facturación y Estadísticas NO se tocan.**
- **No hay migración.**
- Verificación en cada tarea: `npx tsc --noEmit` = 0 · `npx vitest run` verde · `npm run build` = 0 · `npx eslint src --quiet` = **16** (el baseline de `main`; un 17º es un error nuevo).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/servicios/booking-plan.ts` **(nuevo, puro)** | El tipo `PlannedAppointment`, la superposición **cruzada** y la suma de las señas. Testeable. |
| `src/app/reserva/actions.ts` | Se reestructura `createBooking`: planificar → validar → escribir → avisar. Un solo `rollbackAll`. |
| `src/app/reserva/screens.tsx` | El pack deja de borrar los servicios (y viceversa). La pantalla de fechas muestra las dos secciones. La confirmación suma una sola seña. |
| `src/app/reserva/data.ts` · `flow.tsx` | Nada nuevo en el estado salvo lo que ya existe; **`FLOW_VERSION` sube**. |

---

### Task 1: El plan de turnos, puro y testeado (TDD)

**Files:**
- Create: `src/lib/servicios/booking-plan.ts`
- Test: `src/lib/servicios/booking-plan.test.ts`

**Interfaces:**
- Produces:
  - `type PlannedLeg = { serviceId: string; name: string; durationMin: number; priceCents: number; zones: unknown | null; staffId: string | null; startsAtMs: number }`
  - `type PlannedAppointment = { label: string; startsAtMs: number; durationMin: number; staffId: string | null; totalCents: number; depositCents: number; depositPaid: boolean; notesInternal: string | null; isPackSession: boolean; legs: PlannedLeg[] }`
  - `crossOverlapCheck(planned: PlannedAppointment[]): { ok: true } | { ok: false; error: string }`
  - `sumDeposits(planned: PlannedAppointment[]): number`
  - `sumTotals(planned: PlannedAppointment[]): number`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/servicios/booking-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  crossOverlapCheck,
  sumDeposits,
  sumTotals,
  type PlannedAppointment,
} from "./booking-plan"

const T0 = Date.parse("2026-08-10T13:00:00.000Z") // lunes 10:00 AR
const HOUR = 3_600_000

function appt(p: Partial<PlannedAppointment> & { label: string; startsAtMs: number }): PlannedAppointment {
  return {
    label: p.label,
    startsAtMs: p.startsAtMs,
    durationMin: p.durationMin ?? 60,
    staffId: p.staffId ?? null,
    totalCents: p.totalCents ?? 0,
    depositCents: p.depositCents ?? 0,
    depositPaid: p.depositPaid ?? false,
    notesInternal: p.notesInternal ?? null,
    isPackSession: p.isPackSession ?? false,
    legs: p.legs ?? [],
  }
}

describe("crossOverlapCheck", () => {
  it("una lista vacía es válida (no hay nada que chocar)", () => {
    expect(crossOverlapCheck([])).toEqual({ ok: true })
  })

  it("un solo turno no se puede superponer con nadie", () => {
    expect(crossOverlapCheck([appt({ label: "Limpieza", startsAtMs: T0 })])).toEqual({ ok: true })
  })

  it("dos turnos separados: OK", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 2 * HOUR, durationMin: 90 }),
    ])
    expect(r).toEqual({ ok: true })
  })

  it("pegados exactamente (uno termina cuando empieza el otro): OK", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + HOUR, durationMin: 30 }),
    ])
    expect(r).toEqual({ ok: true })
  })

  it("EL CASO NUEVO: una sesión del pack pisa un servicio suelto", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 2 del pack", startsAtMs: T0, durationMin: 60, isPackSession: true }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "Limpieza facial se superpone con Sesión 2 del pack. No podés estar en dos lugares a la vez.",
    })
  })

  it("detecta la superposición aunque vengan desordenados", () => {
    const r = crossOverlapCheck([
      appt({ label: "Limpieza facial", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
      appt({ label: "Sesión 2 del pack", startsAtMs: T0, durationMin: 60 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "Limpieza facial se superpone con Sesión 2 del pack. No podés estar en dos lugares a la vez.",
    })
  })

  it("tres turnos: el 3º pisa al 1º", () => {
    const r = crossOverlapCheck([
      appt({ label: "A", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "B", startsAtMs: T0 + 5 * HOUR, durationMin: 60 }),
      appt({ label: "C", startsAtMs: T0 + 30 * 60_000, durationMin: 30 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "C se superpone con A. No podés estar en dos lugares a la vez.",
    })
  })

  it("una fecha inválida (NaN) -> error que nombra el turno", () => {
    const r = crossOverlapCheck([appt({ label: "Limpieza", startsAtMs: NaN })])
    expect(r).toEqual({ ok: false, error: "La fecha de Limpieza no es válida." })
  })
})

describe("sumDeposits / sumTotals", () => {
  it("la seña es la SUMA de las señas de cada turno", () => {
    const plan = [
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, totalCents: 17_000_000, depositCents: 5_100_000 }),
      appt({ label: "Sesión 2 del pack", startsAtMs: T0 + 7 * 24 * HOUR, totalCents: 0, depositCents: 0 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 2 * HOUR, totalCents: 5_000_000, depositCents: 1_500_000 }),
    ]
    expect(sumDeposits(plan)).toBe(6_600_000)
    expect(sumTotals(plan)).toBe(22_000_000)
  })

  it("un plan vacío suma 0", () => {
    expect(sumDeposits([])).toBe(0)
    expect(sumTotals([])).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/servicios/booking-plan.test.ts`
Expected: FAIL — "Failed to resolve import './booking-plan'".

- [ ] **Step 3: Implementar**

Crear `src/lib/servicios/booking-plan.ts`:

```ts
/**
 * El "plan" de una reserva: los turnos que se van a crear, ANTES de crearlos.
 *
 * Existe para que los tres caminos (el pack, los servicios "juntos" y los
 * servicios "separados") puedan CONVIVIR en una misma compra: cada uno arma su
 * parte del plan, se valida TODO junto (sobre todo que no se pisen entre sí), y
 * recién entonces un solo escritor lo crea, todo o nada.
 *
 * Lógica PURA (sin servidor) para poder testearla.
 */

/** Un servicio dentro de un turno. Un turno "juntos" tiene varios; el resto, uno. */
export type PlannedLeg = {
  serviceId: string
  name: string
  durationMin: number
  priceCents: number
  /** Snapshot de zonas (servicios per_zone). `null` si no aplica. */
  zones: unknown | null
  staffId: string | null
  startsAtMs: number
}

/** Un turno a crear. */
export type PlannedAppointment = {
  /** Cómo nombrarlo en los mensajes de error ("Sesión 2 del pack", "Limpieza facial"). */
  label: string
  startsAtMs: number
  durationMin: number
  staffId: string | null
  /** Lo que vale el turno. La sesión 1 del pack lleva el precio DEL PACK; las 2..N, 0. */
  totalCents: number
  /** Lo que hay que pagar AHORA por este turno. La seña total es la SUMA de estos. */
  depositCents: number
  depositPaid: boolean
  notesInternal: string | null
  isPackSession: boolean
  legs: PlannedLeg[]
}

/**
 * Ningún turno puede pisar a otro — **incluidas las sesiones del pack contra los
 * servicios sueltos**. La clienta es una sola y no puede estar en dos lugares a
 * la vez, aunque los atiendan profesionales distintas.
 *
 * Los turnos de este pedido todavía NO están en la base, así que la
 * disponibilidad real no los ve entre sí: hay que chequearlo acá.
 *
 * Pegados exactamente (uno termina cuando empieza el otro) está PERMITIDO.
 */
export function crossOverlapCheck(
  planned: PlannedAppointment[]
): { ok: true } | { ok: false; error: string } {
  for (const p of planned) {
    if (!Number.isFinite(p.startsAtMs))
      return { ok: false, error: `La fecha de ${p.label} no es válida.` }
  }

  // Se ordena una COPIA por comienzo: comparando cada turno con el anterior, el
  // mensaje nombra al que la clienta puso DESPUÉS en el tiempo.
  const sorted = [...planned].sort((a, b) => a.startsAtMs - b.startsAtMs)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const prevEnd = prev.startsAtMs + prev.durationMin * 60_000
    if (cur.startsAtMs < prevEnd)
      return {
        ok: false,
        error: `${cur.label} se superpone con ${prev.label}. No podés estar en dos lugares a la vez.`,
      }
  }

  return { ok: true }
}

/** El importe ÚNICO a transferir: la SUMA de las señas de cada turno. */
export function sumDeposits(planned: PlannedAppointment[]): number {
  return planned.reduce((a, p) => a + p.depositCents, 0)
}

/** Lo que vale la compra entera. */
export function sumTotals(planned: PlannedAppointment[]): number {
  return planned.reduce((a, p) => a + p.totalCents, 0)
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/booking-plan.test.ts`
Expected: PASS — **10 tests** (8 de `crossOverlapCheck`, 2 de las sumas).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/booking-plan.ts src/lib/servicios/booking-plan.test.ts
git commit -m "feat(mezcla): el plan de turnos, puro y testeado (superposición cruzada + suma de señas)"
```

---

### Task 2: Un solo rollback

**Files:**
- Modify: `src/app/reserva/actions.ts` (`rollbackPackAttempt` :80-110, `rollbackBookingAttempt` :111-145)

**Interfaces:**
- Produces: `rollbackAll(supabase, created: { appointmentIds: string[]; packPurchaseId: string | null }, clientId: string, pointsToRefund: number, fallbackError: string): Promise<CreateBookingResult>`

**Por qué:** hoy hay **dos** rollbacks distintos (uno sabe borrar la `pack_purchase`, el otro sabe devolver los puntos). En una compra mezclada hay que hacer **las dos cosas**. Dos helpers que se pisan es exactamente cómo se pierde un reembolso.

- [ ] **Step 1: Escribir el helper único**

Reemplazar **ambos** helpers por uno solo. `rollbackPackAttempt` y `rollbackBookingAttempt` **desaparecen**; leé los dos enteros antes de escribir (sobre todo sus comentarios: explican **por qué** cada guarda existe, y hay que conservarlas todas).

```ts
/**
 * Deshace una reserva que falló, y DEVUELVE LOS PUNTOS. Todo o nada.
 *
 * Reemplaza a los dos rollbacks que había (uno sabía borrar la compra del pack,
 * el otro sabía devolver los puntos). En una compra MEZCLADA hay que hacer las
 * dos cosas, y tener dos helpers es como se pierde un reembolso.
 *
 * Los puntos del canje se descuentan ANTES de crear ningún turno. Cualquier
 * salida de error posterior tiene que pasar por acá, o la clienta se queda sin
 * puntos y sin turno.
 *
 * Con `appointmentIds` vacío y sin `packPurchaseId` no borra nada: sólo
 * reembolsa. Eso lo hace servible también para un rechazo temprano.
 */
async function rollbackAll(
  supabase: ReturnType<typeof adminClient>,
  created: { appointmentIds: string[]; packPurchaseId: string | null },
  clientId: string,
  pointsToRefund: number,
  fallbackError: string
): Promise<CreateBookingResult> {
  if (created.appointmentIds.length) {
    const { error: delErr } = await supabase
      .from("appointments")
      .delete()
      .in("id", created.appointmentIds)
    if (delErr) {
      // No pudimos deshacer: quedan turnos sueltos en la agenda. Que NO
      // reintente sola (duplicaría los turnos): que llame al salón.
      // A propósito NO se devuelven los puntos acá: si el DELETE falló, la
      // clienta puede estar quedándose con algunos turnos ya creados, así que
      // reembolsar sería regalarle los puntos Y el turno.
      // No "arreglarlo" agregando un refund acá.
      return {
        ok: false,
        error:
          "Hubo un problema al crear tus turnos y no pudimos deshacerlo por completo. Por favor comunicate con el salón para confirmar el estado de tu reserva antes de volver a intentar.",
      }
    }
  }

  if (created.packPurchaseId) {
    // `appointments.pack_purchase_id` tiene ON DELETE SET NULL, así que borrar
    // la compra SIEMPRE "funciona" aunque hayan quedado turnos: por eso el
    // borrado de turnos de arriba se chequea a mano y corta antes de llegar acá.
    await supabase.from("pack_purchases").delete().eq("id", created.packPurchaseId)
  }

  if (pointsToRefund > 0) {
    const { data: c, error: readErr } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    // Si no pudimos LEER el saldo, NO escribimos: sumarle el reembolso a un
    // saldo desconocido (que caería en 0) le borraría todos sus puntos.
    if (readErr || !c) {
      return {
        ok: false,
        error:
          "No pudimos completar tu reserva y tampoco confirmar la devolución de tus puntos. Por favor comunicate con el salón: no perdiste nada, lo resolvemos a mano.",
      }
    }
    await supabase
      .from("clients")
      .update({ loyalty_points: ((c.loyalty_points as number | null) ?? 0) + pointsToRefund })
      .eq("id", clientId)
  }

  return { ok: false, error: fallbackError }
}
```

- [ ] **Step 2: Migrar todos los llamadores**

`tsc` va a marcar cada uno. Son varios (buscalos con `grep -n "rollbackPackAttempt\|rollbackBookingAttempt" src/app/reserva/actions.ts`). Traducción mecánica:

- `rollbackBookingAttempt(supabase, ids, clientId, refund, msg)` → `rollbackAll(supabase, { appointmentIds: ids, packPurchaseId: null }, clientId, refund, msg)`
- `rollbackPackAttempt(supabase, ids, purchaseId, msg)` → `rollbackAll(supabase, { appointmentIds: ids, packPurchaseId: purchaseId }, clientId, 0, msg)`

> ⚠️ **El `0` en la traducción del pack es correcto HOY** (la rama del pack corre **antes** del descuento de puntos, así que no hay nada que devolver). Cuando la Task 6 mueva esa rama **después** del descuento, ese `0` **tiene que pasar a ser el refund real**. Está anotado en la Task 6; no te olvides.

- [ ] **Step 3: Verificar que no cambió NADA de comportamiento**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Este paso es un **refactor puro**: mismo comportamiento, mismos mensajes, mismas guardas. Si te ves cambiando un mensaje o una condición, parate: no es lo que pide esta tarea.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "refactor(mezcla): un solo rollback que sabe deshacer turnos, pack y puntos"
```

---

### Task 3: El pack tiene SU propia profesional

**Files:**
- Modify: `src/app/reserva/actions.ts` (schema + `packStaffId` :385-388)
- Modify: `src/app/reserva/screens.tsx` (el payload del pack)

**Interfaces:**
- Produces: `createBooking` acepta `packStaff?: "auto" | <uuid>`.

**El bug (latente hoy, alcanzable al mezclar):** el pack toma su profesional de `input.resolvedStaff` / `input.serviceOrder` (`actions.ts:385-387`). Eso funciona hoy **sólo porque nunca conviven**: en la reserva de un pack, la pantalla manda `resolvedStaff: undefined`. En una compra **mezclada**, `resolvedStaff` es de **los servicios sueltos** — y el pack se asignaría a **la profesional de otro servicio**, que puede no hacer el servicio del pack.

- [ ] **Step 1: El campo en el schema**

En `BookingInput` (`actions.ts:~17`), junto a `packSlots`:

```ts
  // La profesional del pack ("auto" o un staffId). ES SUYA: no se deriva de
  // `resolvedStaff`, que pertenece a los servicios sueltos (en una compra
  // mezclada el pack terminaría con la profesional de otro servicio).
  packStaff: z.union([z.literal("auto"), z.string().uuid()]).optional(),
```

- [ ] **Step 2: Usarlo**

Reemplazar el cálculo de `packStaffId` (`actions.ts:385-388`) por:

```ts
    const { data: packRoom } = await supabase.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
    // La profesional del pack sale de SU propio campo. `proHint` se conserva
    // como fallback para las reservas viejas (una pestaña abierta de antes del
    // deploy manda `proHint` y no `packStaff`).
    const packHint = input.packStaff ?? (input.proHint !== "auto" ? input.proHint : "auto")
    const packStaffId = packHint !== "auto" ? packHint : null
    const packProHint = packStaffId ?? "auto"
```

> **Byte-identidad con hoy:** en la reserva de un pack, la pantalla **no** manda `resolvedStaff` ni `serviceOrder` (`screens.tsx` los pone en `undefined` para packs), así que hoy `packStaffId` ya vale `proHint !== "auto" ? proHint : null`. El nuevo cálculo da **exactamente lo mismo** cuando no viene `packStaff`. Verificalo leyendo el payload en `screens.tsx` antes de tocar nada.

- [ ] **Step 3: La pantalla lo manda**

En el payload de `createBooking` en `screens.tsx` (buscá `packId: state.pack?.pack.id`), agregar:

```tsx
      packStaff: pack ? ((state.pro || "auto") as "auto" | string) : undefined,
```

> `state.pro` es lo que la pantalla del pack ya usaba como `proHint`. Con esto el pack lleva **su** elección explícita.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Comprobación manual: reservar un pack (sin servicios) → el turno queda con **la misma profesional** que antes.

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/actions.ts src/app/reserva/screens.tsx
git commit -m "fix(mezcla): el pack lleva SU profesional, no la de los servicios sueltos"
```

---

### Task 4: El pack PLANIFICA en vez de crear

**Files:**
- Modify: `src/app/reserva/actions.ts` (la rama del pack, :322-525)

**Interfaces:**
- Consumes de Task 1: `type PlannedAppointment`.
- Produces (helpers locales de `actions.ts`, no exportados):
  - `type PackPlan = { pack: { id: string; name: string; sessions: number; totalPriceCents: number }; serviceId: string; serviceName: string; slotDates: Date[]; appointments: PlannedAppointment[] }`
  - `planPack(supabase, input, payChoice): Promise<{ ok: true; plan: PackPlan } | { ok: false; error: string }>`

**Qué hace:** se parte la rama del pack en dos. `planPack` hace **todo lo que hoy hace hasta antes del primer INSERT** (resolver el pack, las zonas, la duración, validar las fechas, revalidar la disponibilidad) y devuelve **el plan**: los turnos que habría que crear. **No escribe nada.**

- [ ] **Step 1: Extraer `planPack`**

Mover **verbatim** el bloque `actions.ts:323-420` (desde el `select` de `packs` hasta el cierre del `for` de revalidación) al cuerpo de una función nueva, arriba de `createBooking`. Los `return { ok: false, error }` quedan **igual** (el tipo de retorno los admite). Al final, en vez de crear nada, arma el plan:

```ts
    const prices = packSessionPrices(pack.total_price_cents, slotDates.length, payChoice)

    const appointments: PlannedAppointment[] = slotDates.map((d, i) => ({
      label: `Sesión ${i + 1} del pack`,
      startsAtMs: d.getTime(),
      durationMin: firstDuration,
      staffId: packStaffId,
      totalCents: prices[i].totalCents,
      depositCents: prices[i].depositCents,
      depositPaid: prices[i].depositPaid,
      notesInternal: `Pack: ${pack.name} (sesión ${i + 1} de ${pack.sessions})`,
      isPackSession: true,
      legs: [
        {
          serviceId: svc.id,
          name: svc.name,
          durationMin: firstDuration,
          priceCents: prices[i].totalCents,
          zones: zonesSnapshot,
          staffId: packStaffId,
          startsAtMs: d.getTime(),
        },
      ],
    }))

    return {
      ok: true,
      plan: {
        pack: {
          id: pack.id,
          name: pack.name,
          sessions: pack.sessions,
          totalPriceCents: pack.total_price_cents,
        },
        serviceId: svc.id,
        serviceName: svc.name,
        slotDates,
        appointments,
      },
    }
```

> ⚠️ **`packSessionPrices` se llama UNA sola vez, acá.** El índice 0 lleva el precio del pack. Si alguien la llamara otra vez para las sesiones que se agendan después, el pack se cobraría **dos veces** y se emitiría una **segunda Factura C irreversible**. No la muevas ni la repitas.

- [ ] **Step 2: La rama del pack usa el plan**

En `createBooking`, la rama `if (input.packId)` pasa a:

```ts
  if (input.packId) {
    const planned = await planPack(supabase, input, payChoice)
    if (!planned.ok) return { ok: false, error: planned.error }
    const { plan } = planned

    // (por ahora sigue creando acá mismo, exactamente como antes)
```

y **el resto del bloque (la creación de la `pack_purchase`, el `for` de inserts, los avisos y el `return`) se conserva TAL CUAL**, leyendo del plan: `plan.appointments[i].startsAtMs`, `.totalCents`, `.depositCents`, `.depositPaid`, `.notesInternal`, `.staffId`, y `plan.appointments[i].legs[0]` para la fila de `appointment_services`.

**No cambia ni una fila.** Esta tarea es una **reorganización**: el pack sigue creando lo mismo, en el mismo orden, con la misma plata.

- [ ] **Step 3: Verificar que el pack SOLO quedó idéntico**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Comprobación manual (obligatoria): reservar **un pack solo** → misma `pack_purchase`, mismos turnos, misma plata (`total_cents` del pack en la sesión 1, `$0` en el resto), mismos mensajes de error si elegís una fecha ocupada.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "refactor(mezcla): el pack planifica sus turnos antes de crearlos"
```

---

### Task 5: Los servicios sueltos PLANIFICAN en vez de crear

**Files:**
- Modify: `src/app/reserva/actions.ts` (la rama "separados" :567-797 y la "juntos" :798-1064)

**Interfaces:**
- Consumes de Task 1: `type PlannedAppointment`, `type PlannedLeg`.
- Produces (helper local, no exportado):
  - `planLooseServices(supabase, input, services, computed, payChoice, redeem, totalPointsCost): Promise<{ ok: true; appointments: PlannedAppointment[] } | { ok: false; error: string }>`

**Qué hace:** lo mismo que la Task 4, pero para los servicios sueltos. Devuelve:
- modo **separados** → **N** `PlannedAppointment`, cada uno con **una** pata;
- modo **juntos** (o un solo servicio, o un combo) → **UN** `PlannedAppointment` con **M** patas escalonadas.

**No escribe nada.** Toda la validación que hoy hacen esas dos ramas (fechas futuras, superposición entre los servicios, horarios del negocio, revalidación por pata contra la disponibilidad real, el orden `order_last`) se conserva **exactamente**, sólo que ahora corre **antes** de escribir.

- [ ] **Step 1: Extraer**

Leé las dos ramas enteras primero. Después, moverlas a `planLooseServices`, con estos cambios **y ningún otro**:

1. Donde hoy hacen `INSERT` en `appointments` / `appointment_services`, arman un `PlannedAppointment` en su lugar.
2. Donde hoy llaman a `rollbackBookingAttempt`/`rollbackAll` por un fallo de **validación** (no de insert), devuelven `{ ok: false, error }` — **el reembolso de los puntos lo hace quien la llama** (Task 6), porque en la mezcla el rollback también tiene que borrar la `pack_purchase`.
3. El precio y la seña de cada turno salen de lo que ya calculan: `computed[s.id].priceCents` y `amountDueNow(precio, payChoice)`; con `redeem`, `totalCents: 0` y `depositCents: 0`. **La pata (`leg`) conserva el precio REAL aunque se canjee** (es lo que hace hoy: el snapshot guarda lo que vale el servicio).
4. `label` de cada turno: el **nombre del servicio** en separados; en juntos, los nombres unidos con `" + "`.

> **Ojo con "juntos":** su `PlannedAppointment` lleva `durationMin` = la **suma** de las duraciones, y sus patas van **escalonadas** (`startsAtMs` de cada una = el final de la anterior), exactamente como hoy. El orden de las patas es el que ya calcula `sortOrderLast` (los masajes al final): **no lo toques**.

- [ ] **Step 2: Las dos ramas usan el plan**

Igual que en la Task 4: cada rama llama a `planLooseServices` y **sigue creando lo mismo, en el mismo lugar**, leyendo del plan. **Ni una fila cambia.**

- [ ] **Step 3: Verificar que "juntos" y "separados" quedaron idénticos**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Comprobación manual (obligatoria):
1. **Un servicio solo** → un turno, misma plata, mismos avisos.
2. **Dos servicios "juntos"** → **UN** turno, servicios encadenados, `appointment_services` con `starts_at` escalonado, el masaje al final si está marcado.
3. **Dos servicios "separados"** → **DOS** turnos, cada uno con su precio y su seña.
4. **Un combo** → **UN** turno, con el precio del combo.
5. **Canje con puntos** → todo en `$0`, `confirmed`, puntos descontados una vez.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "refactor(mezcla): los servicios sueltos planifican sus turnos antes de crearlos"
```

---

### Task 6: Un solo escritor, y la mezcla

**Files:**
- Modify: `src/app/reserva/actions.ts` (`createBooking` entero)
- Modify: `src/lib/email/booking-emails.ts` (el mail de la mezcla)

**Interfaces:**
- Consumes de Task 1: `crossOverlapCheck`, `sumDeposits`, `sumTotals`.
- Consumes de Task 2: `rollbackAll`.
- Consumes de Tasks 4 y 5: `planPack`, `planLooseServices`.
- Produces: `createBooking` acepta **`packId` y `serviceIds` a la vez**.

**Esta es la tarea del medio: acá se junta todo.** `createBooking` pasa a tener **una sola** región de escritura.

- [ ] **Step 1: La nueva forma de `createBooking`**

Después de resolver la clienta (paso 2) y la sala, el cuerpo pasa a ser:

```ts
  const hasPack = !!input.packId
  const hasServices = services.length > 0

  // ── Canje con puntos: NO se puede canjear un pack ────────────────────────
  // Hoy esto es inalcanzable (la pantalla no ofrece canje con un pack elegido)
  // PERO la rama del pack retornaba ANTES del bloque de canje: si llegaran las
  // dos cosas, el pack se creaba SIN descontar los puntos. Al fusionar los
  // caminos ese agujero pasa a ser alcanzable. Se cierra acá.
  if (hasPack && redeem)
    return { ok: false, error: "Los packs no se pueden canjear con puntos." }

  // ── FASE B: planificar y validar TODO, sin escribir nada ──────────────────
  const plan: PlannedAppointment[] = []
  let packPlan: PackPlan | null = null

  if (hasPack) {
    const r = await planPack(supabase, input, payChoice)
    if (!r.ok) return { ok: false, error: r.error }
    packPlan = r.plan
    plan.push(...r.plan.appointments)
  }

  if (hasServices) {
    const r = await planLooseServices(
      supabase, input, services, computed, payChoice, redeem, totalPointsCost
    )
    if (!r.ok) return { ok: false, error: r.error }
    plan.push(...r.appointments)
  }

  if (plan.length === 0)
    return { ok: false, error: "No hay nada para reservar." }

  // NUEVO: ningún turno puede pisar a otro — NI las sesiones del pack contra
  // los servicios sueltos. Hasta ahora cada camino se chequeaba por su lado,
  // porque nunca convivían.
  const cross = crossOverlapCheck(plan)
  if (!cross.ok) return { ok: false, error: cross.error }
```

> **Los `return` de arriba NO reembolsan puntos, y está bien: todavía no se descontaron.** El descuento va abajo.

- [ ] **Step 2: Fase C — escribir, todo o nada**

```ts
  // ── FASE C: escribir. Desde acá, TODO error tiene que pasar por rollbackAll ─
  const created = { appointmentIds: [] as string[], packPurchaseId: null as string | null }
  const refund = redeem ? totalPointsCost : 0

  // 1) Descontar los puntos (sólo servicios: el pack ya se rechazó arriba).
  //    Este bloque es el que YA existe hoy, movido acá SIN cambios:
  if (redeem) {
    if (totalPointsCost <= 0) {
      return { ok: false, error: "Estos servicios no se pueden canjear por puntos." }
    }
    const { data: c } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    const balance = (c?.loyalty_points as number | null) ?? 0
    if (balance < totalPointsCost) {
      return {
        ok: false,
        error: `Te faltan ${totalPointsCost - balance} pts para canjear este turno.`,
      }
    }
    // Si el descuento falla, NO seguimos: si siguiéramos, la clienta se llevaría
    // el turno gratis con los puntos intactos — y peor, un rollback posterior le
    // SUMARÍA puntos que nunca gastó.
    const { error: spendErr } = await supabase
      .from("clients")
      .update({ loyalty_points: balance - totalPointsCost })
      .eq("id", clientId)
    if (spendErr)
      return { ok: false, error: "No pudimos descontar tus puntos. Probá de nuevo en un momento." }
  }

  // 2) La compra del pack.
  if (packPlan) {
    const { data: purchase, error: purErr } = await supabase
      .from("pack_purchases")
      .insert({
        client_id: clientId,
        pack_id: packPlan.pack.id,
        pack_name: packPlan.pack.name,
        service_id: packPlan.serviceId,
        service_name: packPlan.serviceName,
        sessions_total: packPlan.pack.sessions,
        sessions_used: 0,
      })
      .select("id")
      .single()
    if (purErr || !purchase)
      return await rollbackAll(supabase, created, clientId, refund, `No pudimos registrar el pack: ${purErr?.message}`)
    created.packPurchaseId = purchase.id
  }

  // 3) Los turnos, en orden cronológico (así `appointmentIds[0]` es el primero
  //    de verdad y la clienta aterriza en la confirmación correcta).
  const ordered = [...plan].sort((a, b) => a.startsAtMs - b.startsAtMs)

  for (const p of ordered) {
    const { data: appt, error: apptErr } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        staff_id: p.staffId,
        room_id: room?.id ?? null,
        starts_at: new Date(p.startsAtMs).toISOString(),
        ends_at: new Date(p.startsAtMs + p.durationMin * 60_000).toISOString(),
        duration_min: p.durationMin,
        total_cents: p.totalCents,
        deposit_cents: p.depositCents,
        deposit_paid: p.depositPaid,
        paid_cents: 0,
        status: redeem ? "confirmed" : "pending",
        source: "web",
        pack_purchase_id: p.isPackSession ? created.packPurchaseId : null,
        notes_internal: p.notesInternal,
      })
      .select("id")
      .single()
    if (apptErr || !appt)
      return await rollbackAll(supabase, created, clientId, refund, `No pudimos crear el turno de ${p.label}: ${apptErr?.message}`)
    created.appointmentIds.push(appt.id)

    const { error: linkErr } = await supabase.from("appointment_services").insert(
      p.legs.map((l) => ({
        appointment_id: appt.id,
        service_id: l.serviceId,
        duration_min: l.durationMin,
        price_cents: l.priceCents,
        zones: l.zones,
        staff_id: l.staffId,
        starts_at: new Date(l.startsAtMs).toISOString(),
      }))
    )
    if (linkErr)
      return await rollbackAll(supabase, created, clientId, refund, `Servicios del turno de ${p.label}: ${linkErr.message}`)
  }
```

> ⚠️ **`status`**: hoy las sesiones del pack nacen **siempre** `pending` (el salón valida el pago antes de confirmar) y el canje nace `confirmed`. Como el canje y el pack **no pueden convivir**, `redeem ? "confirmed" : "pending"` da **exactamente lo de hoy** en los dos casos. Verificalo.

- [ ] **Step 3: Fase D — avisos (best-effort, los turnos ya existen)**

Los avisos dependen de qué se compró:

- **Pack solo** → `sendPackConfirmation` + `notifyNewBooking`, **exactamente como hoy**.
- **Servicios solos** → lo de hoy (`sendBookingConfirmation` para un turno, `sendMultiBookingConfirmation` para varios, y `notifyNewBooking`).
- **Mezcla** → **UN** mail nuevo con **todo** y **una sola** seña.

Para la mezcla, agregar al final de `src/lib/email/booking-emails.ts` una función que **copie el layout y los helpers de `sendMultiBookingConfirmation`** (que ya está en ese archivo — leela: usa `resend`, `FROM`, `SITE`, `fmtDateAR`, `fmtPrice` (toma **centavos**), `shell`, `ctaButtons`, `escape`):

```ts
/**
 * Confirmación de una compra MEZCLADA: un pack + servicios sueltos, en la misma
 * reserva, con UNA sola seña.
 */
export async function sendMixedBookingConfirmation(data: {
  to: string
  firstName: string
  packName: string
  packSessionsTotal: number
  /** Las sesiones del pack que SÍ agendó. */
  packStartsAtList: Date[]
  /** Los servicios sueltos, con su fecha. */
  services: { serviceName: string; startsAt: Date }[]
  totalCents: number
  dueNowCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const subject = "Tu reserva en By Leri Vendler"

  const packRows = data.packStartsAtList
    .map(
      (d, i) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">Sesión ${i + 1}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(d))}</td></tr>`
    )
    .join("")

  const svcRows = data.services
    .map(
      (s) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">${escape(s.serviceName)}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(s.startsAt))}</td></tr>`
    )
    .join("")

  const missing = data.packSessionsTotal - data.packStartsAtList.length
  const missingNote =
    missing > 0
      ? `<p style="font-size:13px;color:#7a6e64;">Te quedan <strong>${missing}</strong> sesión(es) del pack por agendar. Coordinamos con vos para fijarlas.</p>`
      : ""

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Reserva confirmada</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;">Tus turnos</h1>
    <p style="font-size:14px;margin:0 0 16px;">Hola ${escape(data.firstName)}, reservamos tu pack y tus turnos.</p>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 4px;"><strong>${escape(data.packName)}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 12px;">${packRows}</table>
    ${missingNote}
    <p style="font-size:13px;color:#7a6e64;margin:0 0 4px;"><strong>Tus otros turnos</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${svcRows}</table>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 4px;">Total: <strong>${fmtPrice(data.totalCents)}</strong></p>
    <p style="font-size:14px;margin:0 0 16px;">A transferir ahora: <strong>${fmtPrice(data.dueNowCents)}</strong></p>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Es <strong>una sola transferencia</strong> por todo. Mandanos el comprobante por WhatsApp y te lo confirmamos.</p>
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

Y en `createBooking`, para la mezcla: `dueNowCents: sumDeposits(plan)` y `totalCents: sumTotals(plan)`.

**Google Calendar:** un evento por turno (un `for` sobre `created.appointmentIds` / `ordered`, best-effort, envuelto en `try/catch`). **`notifyNewBooking`:** un aviso **por turno**, con **su** fecha, **su** duración, **su** profesional y **su** precio — nunca uno solo con una fecha inventada.

**El magic link** (el bloque `if (!authUser && !alreadyLinked)`) se conserva **igual**, al final.

- [ ] **Step 4: El retorno**

```ts
  return {
    ok: true,
    appointmentId: created.appointmentIds[0],
    appointmentIds: created.appointmentIds,
  }
```

> `/reserva/exito?id=a,b,c` ya sabe mostrar N turnos y **relee** los `deposit_cents` de la base. No hay que tocarlo.

- [ ] **Step 5: El `0` de la Task 2**

La traducción mecánica de la Task 2 dejó un `0` en el refund del rollback del pack, porque **entonces** la rama del pack corría antes del descuento. **Ahora ya no.** Buscá cualquier `rollbackAll(..., 0, ...)` que haya quedado y reemplazá el `0` por `refund`. Si no queda ninguno (porque el escritor unificado ya usa `refund`), dejá constancia en el reporte.

- [ ] **Step 6: Auditar los reembolsos (obligatorio)**

Listá **todos** los `return` de error que quedan **después** del descuento de puntos. **Cada uno** tiene que pasar por `rollbackAll(..., refund, ...)`. Un solo `return { ok: false }` pelado ahí abajo deja a la clienta **sin puntos y sin turno**.

```bash
grep -n "return { ok: false" src/app/reserva/actions.ts
```

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 8: Commit**

```bash
git add src/app/reserva/actions.ts src/lib/email/booking-emails.ts
git commit -m "feat(mezcla): un pack + servicios sueltos en la misma reserva, con una sola seña"
```

---

### Task 7: La pantalla

**Files:**
- Modify: `src/app/reserva/screens.tsx` (Screen1 `togglePack`/`toggle`/`toggleCombo`; Screen2; Screen5)
- Modify: `src/app/reserva/flow.tsx` (`FLOW_VERSION`)

**Interfaces:**
- Consumes de Task 6: `createBooking` acepta `packId` y `serviceIds` a la vez, y `packStaff` (Task 3).
- Consumes (ya existen): `amountDueNow`, `type PayChoice` de `@/lib/servicios/payments`; `totalDueNowSeparate` de `@/lib/servicios/multi-booking`.
- Produces: `state.pack` y `state.services` pueden coexistir.

> **Ojo:** la pantalla **no** usa `sumDeposits` (de la Task 1): esa función suma **el plan del servidor**, que la pantalla no tiene. La pantalla calcula la misma suma con lo que ya conoce — ver el Step 3. El servidor es el autoritativo; la pantalla sólo tiene que **mostrar el mismo número**.

- [ ] **Step 1: El pack deja de ser excluyente**

En `screens.tsx`:

1. `togglePack` (`:150`) — hoy hace `services: [], combo: null`. Pasa a **conservar los servicios** y seguir borrando el combo:

```tsx
  const togglePack = (p: ReservaPack) => {
    if (selectedPack?.pack.id === p.id) {
      setState({ ...state, pack: null, ...clearedResolution })
    } else {
      // El pack ya NO borra los servicios sueltos: se pueden comprar juntos.
      // El combo sí (tiene precio propio; mezclarlo está fuera de alcance).
      setState({ ...state, pack: { pack: p, zoneIds: [] }, combo: null, ...clearedResolution })
    }
  }
```

2. `toggle` (`:168`) — hoy hace `pack: null`. Pasa a **conservar el pack**:

```tsx
  const toggle = (svc: Service) => {
    const exists = selected.find((s) => s.id === svc.id)
    const next = exists ? selected.filter((s) => s.id !== svc.id) : [...selected, svc]
    // Ya NO borra el pack: se pueden comprar juntos. El combo sí.
    setState({ ...state, combo: null, services: next, activeCat, ...clearedResolution })
  }
```

3. `toggleCombo` — **no cambia**: sigue borrando el pack y los servicios (el combo es excluyente).

> **`clearedResolution` se sigue spreadeando en los tres.** Es lo que evita que una fecha vieja sobreviva a un cambio de compra y deje la reserva **muerta**. No lo saques.

- [ ] **Step 2: La pantalla de fechas muestra las dos secciones**

**Leé `Screen2DateTime` entero antes de tocar nada.** Hoy tiene tres bloques que **retornan**, en este orden:
1. `if (selectedPack) { … }` — el picker de una sesión (`PickerBody`/`PickerFooterCTA`) o **la lista de sesiones** (`ListBody`/`ListFooterCTA`).
2. `if (bookingMode === "separados") { … }` — el picker de un servicio o **la lista de servicios** (`SepBody`/`SepFooterCTA`).
3. El render normal (juntos): `{ModeChooser()}` + `{Cal()}` + `{Slots()}` + `{ProPicker()}`.

Como el pack **retorna primero**, con un pack elegido nunca se ven los servicios. Hay que **componer**, no reescribir.

**2.1 — Extraer las dos secciones a funciones locales.** Dentro de `Screen2DateTime`, sacar el **contenido** (no el `return`, no los wrappers `dmain`/`screen`) de los dos `Body` a funciones propias:

- `PackSessionsSection()` = **el cuerpo de `ListBody`** tal cual está (el `<h1 className="headline">`, la bajada y la lista de sesiones con sus botones "Elegir fecha"/"Cambiar"/"Quitar").
- `ServiceDatesSection()` = **el cuerpo de `SepBody`** tal cual está (el `ModeChooser`, la lista de servicios con sus fechas y el error de superposición).

`ListBody` y `SepBody` pasan a ser `() => <>{PackSessionsSection()}</>` y `() => <>{ServiceDatesSection()}</>`. **Los dos caminos existentes tienen que quedar idénticos** — ésta es una extracción mecánica.

**2.2 — Las condiciones.** Junto a las otras constantes derivadas:

```tsx
  // ¿Compra mezclada? Un pack Y servicios sueltos a la vez.
  const mixed = !!selectedPack && state.services.length > 0
  // La sesión 1 del pack es OBLIGATORIA; el resto se puede agendar después.
  const packReady = !selectedPack || !!(state.packSlots ?? [])[0]
  // Los servicios: juntos -> hace falta el horario de la cadena;
  //                separados -> hace falta la fecha de CADA uno.
  const servicesReady =
    state.services.length === 0 ||
    (bookingMode === "separados"
      ? state.services.every((s) => (state.serviceSlots ?? {})[s.id])
      : !!state.selectedDate && !!state.selectedTime)
```

**2.3 — La rama mezclada.** Va **antes** de `if (selectedPack)` (para que el pack no retorne primero), y sólo se activa con `mixed`. Los pickers (elegir la fecha de una sesión / de un servicio) siguen siendo los que ya existen: **no los dupliques** — si `pickingIdx !== null` o `pickingServiceId !== null`, dejá que caigan en los bloques que ya los manejan.

```tsx
  // ── Pack + servicios sueltos: las dos secciones en una sola pantalla ──────
  if (mixed && pickingIdx === null && pickingServiceId === null) {
    const MixedBody = () => (
      <>
        {PackSessionsSection()}
        <div style={{ marginTop: 28 }}>{ServiceDatesSection()}</div>
      </>
    )
    const MixedFooterCTA = () => (
      <div className="footer">
        <div className="footer__row">
          <button className="btn--back" onClick={onBack}>
            ← Atrás
          </button>
          <button
            className="btn btn--primary"
            disabled={!packReady || !servicesReady}
            onClick={onNext}
          >
            {!packReady
              ? "Elegí la fecha de la primera sesión"
              : !servicesReady
                ? "Elegí la fecha de tus servicios"
                : "Continuar"}
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
          <div className="dmain__inner">{MixedBody()}</div>
          {MixedFooterCTA()}
        </div>
      )
    }

    return (
      <div className="screen">
        <TopBar onBack={onBack} onClose={onClose} />
        <Progress step={stepNumber} total={totalSteps} />
        <div className="screen__body">{MixedBody()}</div>
        {MixedFooterCTA()}
      </div>
    )
  }
```

> **Nota sobre el modo "juntos" dentro de la mezcla:** `ServiceDatesSection()` (el cuerpo de `SepBody`) hoy **asume separados**. Cuando `bookingMode === "juntos"`, esa sección tiene que mostrar `{ModeChooser()}` + `{Cal()}` + `{Slots()}` + `{ProPicker()}` en vez de la lista de fechas por servicio. Hacelo dentro de `ServiceDatesSection()` con un `if (bookingMode === "juntos") return (…)` **usando las mismas funciones locales que ya existen** — no reescribas el calendario.

> **Crítico (se aprendió a los golpes):** toda pantalla **tiene que tener Atrás y cerrar** (`TopBar` + `btn--back`), o en celular la clienta queda **atrapada** sin salida.
> **No inventes clases:** `headline`, `lede`, `btn`, `btn--primary`, `btn--back`, `btn__arrow`, `footer`, `footer__row`, `dmain`, `dmain__inner`, `screen`, `screen__body` ya existen y son las que usan las dos ramas.

**2.4 — Sin mezcla, nada cambia.** Con `mixed === false`, la rama nueva **no se activa** y el flujo cae en los bloques de siempre: un pack solo se comporta **exactamente como hoy**, y los servicios solos también.

- [ ] **Step 3: La confirmación suma una sola seña**

En `Screen5Confirm`, hoy `total` es `pack ? pack.pack.priceCents / 100 : combo ? … : services.reduce(…)` — **excluyente**. Pasa a **sumar**:

```tsx
  const packTotal = pack ? pack.pack.priceCents / 100 : 0
  const servicesTotal = combo ? combo.price : services.reduce((a, s) => a + effective(s).price, 0)
  const total = packTotal + servicesTotal
```

Y la seña, que es **la suma de las señas de cada turno** (no el 30% del total):

```tsx
  const dueNowFor = (c: PayChoice) => {
    // Cada turno redondea SU propia seña. La suma de los redondeos puede
    // diferir del redondeo de la suma: la clienta transfiere exactamente lo que
    // suman los `deposit_cents` que el servidor va a guardar.
    const packDue = pack ? amountDueNow(pack.pack.priceCents, c) : 0
    const svcDue = separados
      ? totalDueNowSeparate(services.map((s) => Math.round(effective(s).price * 100)), c)
      : amountDueNow(Math.round(servicesTotal * 100), c)
    return packDue + svcDue
  }
  const depositCents = redeeming ? 0 : dueNowFor(payChoice)
```

> **El canje no se ofrece si hay un pack.** Donde hoy se decide si mostrar el canje (`canRedeem`), agregar `&& !pack`. El servidor **igual lo rechaza** (Task 6), pero la pantalla no debe ofrecer algo que va a fallar.

El resumen lista **el pack y los servicios**, y la fila "Cuándo" muestra las sesiones del pack **y** la(s) fecha(s) de los servicios. El payload manda `packId` **y** `serviceIds` a la vez.

- [ ] **Step 4: Invalidar el estado guardado**

En `src/app/reserva/flow.tsx`, subir `FLOW_VERSION` en uno (de `4` a `5`):

```ts
const FLOW_VERSION = 5
```

> El wizard guarda `BookingState` en `localStorage`. Una clienta con una reserva a medias de **antes** de este deploy tiene un estado que la pantalla nueva no espera. Sin esto, esa compra puede quedar **imposible de completar**.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 6: Verificación manual (obligatoria)**

En `/reserva`:
1. Elegir un **pack** y **un servicio suelto** → los dos quedan seleccionados (antes uno borraba al otro).
2. La pantalla de fechas muestra **las dos secciones**.
3. Poner la **Sesión 2 del pack pisando** la limpieza facial → **no** deja continuar, y dice cuál pisa a cuál.
4. Confirmar → **UNA** seña (la suma) → en el admin aparecen **la compra del pack + sus sesiones + el turno del servicio**, cada uno con **su** plata.
5. **Un pack solo** → igual que siempre. **Servicios solos** → igual que siempre. **Un combo** → igual que siempre.
6. Con un pack elegido, el **canje con puntos no aparece**.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/screens.tsx src/app/reserva/flow.tsx
git commit -m "feat(mezcla): la pantalla deja comprar un pack y servicios juntos, con una sola seña"
```

---

### Task 8: Verificación final y deploy

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet
```
Expected: tsc 0 · vitest **121 + 10 = 131** verdes · build 0 · eslint **16** (baseline de `main`; 0 nuevos).

- [ ] **Step 2: Recorrido end-to-end**

**Lo que NO se puede haber roto (byte-idéntico a `main`):**
1. **Un servicio solo.**
2. **Dos servicios "juntos"** → **UN** turno encadenado. *(camino de ingresos principal)*
3. **Dos servicios "separados"** → **DOS** turnos.
4. **Un combo** → **UN** turno con el precio del combo.
5. **Un pack solo** → `pack_purchase` + sus sesiones, el precio en la sesión 1, `$0` en el resto.
6. **Canje con puntos** (servicios solos) → todo en `$0`, `confirmed`, puntos descontados **una** vez.

**Lo nuevo:**
7. **Pack + servicios** → la `pack_purchase`, sus sesiones **y** los turnos de los servicios, con **UNA** seña = la suma exacta de los `deposit_cents` guardados.
8. **Superposición cruzada** → rechazada, aunque se fuerce el payload.
9. **Pack + canje** → rechazado (`"Los packs no se pueden canjear con puntos."`).
10. **Falla a mitad de camino** → no queda **ningún** turno, **ninguna** `pack_purchase`, y los puntos **vuelven**.

**Lo que no cambió:** Facturación y Estadísticas siguen leyendo `total_cents` por turno.

- [ ] **Step 3: Deploy (lo hace la controladora)**

No hay migración: se pushea el código a `main`.

---

## Notas de riesgo

- **Es una cirugía sobre `createBooking`**, el archivo donde vive toda la plata de la reserva y donde en las últimas 24 h se cerraron **cuatro** agujeros de doble reserva. Las Tasks 4 y 5 son **refactors puros** a propósito: se separan del cambio de comportamiento (Task 6) **justamente** para que la revisión pueda verificar "esto no cambió nada" en un diff, y "esto cambia el comportamiento" en otro.
- **La superposición cruzada** (pack ↔ servicios) es la regla nueva más fácil de olvidar, y la que produce el peor síntoma: la clienta agendada en dos lugares a la vez.
- **El `status`**: las sesiones del pack nacen `pending` y el canje nace `confirmed`. Como no pueden convivir, una sola expresión (`redeem ? "confirmed" : "pending"`) cubre los dos casos — **pero hay que verificarlo**, no asumirlo.
- **Los puntos**: la regla ("todo error posterior al descuento los devuelve") ya se rompió **tres veces** en este código. La Task 6 tiene un paso de auditoría dedicado. No lo saltees.
