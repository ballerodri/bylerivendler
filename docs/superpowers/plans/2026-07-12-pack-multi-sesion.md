# Pack multi-sesión — Plan de implementación (Etapa 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la clienta, al comprar un pack online, elija las fechas de todas las sesiones (mínimo la 1ª), y que el salón pueda agendar las pendientes y confirmar el pack de un clic.

**Architecture:** Reglas puras testeadas (`pack-sessions.ts`) + un selector de fecha/hora reutilizable (`PackSessionPicker`) usado en la reserva y en el admin. El servidor revalida todo (disponibilidad, orden, intervalo) y crea N turnos: el 1º con el precio del pack, los demás en $0.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase (Postgres, service-role), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-07-12-pack-multi-sesion-design.md`

## Global Constraints

- **Sin cambios de schema.** Todo sale de `pack_purchases` + `appointments.pack_purchase_id`.
- **Reparto del precio (obligatorio):** 1ª sesión `total_cents = pack.total_price_cents`, `deposit_cents = 30%`, `deposit_paid = false`. Sesiones 2..N: `total_cents = 0`, `deposit_cents = 0`, `deposit_paid = true`. Todas nacen `status: 'pending'`.
- **El servidor es autoritativo:** revalida disponibilidad, orden e intervalo aunque la pantalla ya lo haya hecho.
- **Todo o nada:** si una fecha falla al confirmar, no se crea ni la compra ni ningún turno.
- **Argentina es UTC-3 fijo** (sin horario de verano). Los slots se guardan como hora local AR.
- **Los módulos con `import "server-only"` NO son testeables con vitest.** Sólo la lógica pura lleva tests automáticos; el resto se verifica con `tsc`, `next build` y prueba manual.
- Money en centavos (int). UI en pesos.
- Verificación en cada tarea: `npx tsc --noEmit` y `npx vitest run` deben quedar en 0.

---

### Task 1: Reglas puras de sesiones de pack (TDD)

**Files:**
- Create: `src/lib/servicios/pack-sessions.ts`
- Test: `src/lib/servicios/pack-sessions.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `minStartForNextSession(prevStartsAt: Date, intervalDays: number | null): Date`
  - `validatePackSlots(slots: Date[], opts: { sessionsTotal: number; intervalDays: number | null }): { ok: true } | { ok: false; error: string }`
  - `packSessionPrices(totalPriceCents: number, count: number): { totalCents: number; depositCents: number; depositPaid: boolean }[]`
  - `arPartsFromUtc(d: Date): { dateStr: string; timeStr: string; dayOfWeek: number }`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/servicios/pack-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  minStartForNextSession,
  validatePackSlots,
  packSessionPrices,
  arPartsFromUtc,
} from "./pack-sessions"

// Helper: una fecha/hora AR como Date UTC (AR = UTC-3).
const ar = (y: number, m: number, d: number, hh: number, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh + 3, mm))

describe("minStartForNextSession", () => {
  it("suma el intervalo en días", () => {
    const r = minStartForNextSession(ar(2026, 7, 20, 14), 7)
    expect(r.toISOString()).toBe(ar(2026, 7, 27, 14).toISOString())
  })

  it("sin intervalo (null) no suma nada", () => {
    const prev = ar(2026, 7, 20, 14)
    expect(minStartForNextSession(prev, null).toISOString()).toBe(prev.toISOString())
  })

  it("intervalo 0 no suma nada", () => {
    const prev = ar(2026, 7, 20, 14)
    expect(minStartForNextSession(prev, 0).toISOString()).toBe(prev.toISOString())
  })
})

describe("validatePackSlots", () => {
  const opts = { sessionsTotal: 4, intervalDays: 7 }

  it("caso feliz: 2 de 4, respetando 7 días", () => {
    const r = validatePackSlots([ar(2026, 7, 20, 14), ar(2026, 7, 27, 14)], opts)
    expect(r.ok).toBe(true)
  })

  it("una sola sesión es válido (el resto se agenda después)", () => {
    expect(validatePackSlots([ar(2026, 7, 20, 14)], opts).ok).toBe(true)
  })

  it("vacío → error", () => {
    const r = validatePackSlots([], opts)
    expect(r).toEqual({ ok: false, error: "Elegí al menos la fecha de la primera sesión." })
  })

  it("más sesiones que las del pack → error", () => {
    const slots = [
      ar(2026, 7, 6, 14), ar(2026, 7, 13, 14), ar(2026, 7, 20, 14),
      ar(2026, 7, 27, 14), ar(2026, 8, 3, 14),
    ]
    const r = validatePackSlots(slots, opts)
    expect(r.ok).toBe(false)
  })

  it("desordenadas → error", () => {
    const r = validatePackSlots([ar(2026, 7, 27, 14), ar(2026, 7, 20, 14)], opts)
    expect(r).toEqual({ ok: false, error: "Las sesiones tienen que ir en orden." })
  })

  it("intervalo corto (6 días) → error", () => {
    const r = validatePackSlots([ar(2026, 7, 20, 14), ar(2026, 7, 26, 14)], opts)
    expect(r).toEqual({ ok: false, error: "Entre sesiones tienen que pasar al menos 7 días." })
  })

  it("sin intervalo, dos el mismo día en horarios distintos es válido", () => {
    const r = validatePackSlots(
      [ar(2026, 7, 20, 10), ar(2026, 7, 20, 15)],
      { sessionsTotal: 4, intervalDays: null }
    )
    expect(r.ok).toBe(true)
  })

  it("sin intervalo, misma hora exacta → error de orden", () => {
    const r = validatePackSlots(
      [ar(2026, 7, 20, 10), ar(2026, 7, 20, 10)],
      { sessionsTotal: 4, intervalDays: null }
    )
    expect(r.ok).toBe(false)
  })
})

describe("packSessionPrices", () => {
  it("la 1ª lleva el precio del pack + 30% de seña; el resto en 0 y pagadas", () => {
    const r = packSessionPrices(17_000_000, 3)
    expect(r).toEqual([
      { totalCents: 17_000_000, depositCents: 5_100_000, depositPaid: false },
      { totalCents: 0, depositCents: 0, depositPaid: true },
      { totalCents: 0, depositCents: 0, depositPaid: true },
    ])
  })

  it("una sola sesión: lleva todo el precio", () => {
    expect(packSessionPrices(17_000_000, 1)).toEqual([
      { totalCents: 17_000_000, depositCents: 5_100_000, depositPaid: false },
    ])
  })

  it("el total cobrado es el precio del pack, no su múltiplo", () => {
    const total = packSessionPrices(17_000_000, 4).reduce((a, p) => a + p.totalCents, 0)
    expect(total).toBe(17_000_000)
  })
})

describe("arPartsFromUtc", () => {
  it("convierte un Date UTC a fecha/hora/día-de-semana de Argentina", () => {
    // Lunes 20/07/2026 14:00 AR = 17:00 UTC
    const r = arPartsFromUtc(new Date(Date.UTC(2026, 6, 20, 17, 0)))
    expect(r).toEqual({ dateStr: "2026-07-20", timeStr: "14:00", dayOfWeek: 1 })
  })

  it("cruce de medianoche: 01:00 UTC es el día anterior 22:00 en AR", () => {
    const r = arPartsFromUtc(new Date(Date.UTC(2026, 6, 21, 1, 0)))
    expect(r).toEqual({ dateStr: "2026-07-20", timeStr: "22:00", dayOfWeek: 1 })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/servicios/pack-sessions.test.ts`
Expected: FAIL — "Failed to resolve import './pack-sessions'".

- [ ] **Step 3: Implementar**

Crear `src/lib/servicios/pack-sessions.ts`:

```ts
/**
 * Reglas de las sesiones de un pack. Lógica PURA (sin servidor) para poder
 * testearla y usar la MISMA regla en la pantalla y en el servidor.
 */

const DAY_MS = 24 * 60 * 60 * 1000

// Argentina es UTC-3 fijo (sin horario de verano desde 2008). Espeja el
// AR_UTC_OFFSET de src/app/reserva/data.ts; se repite acá para que este módulo
// quede sin dependencias y sea testeable.
const AR_UTC_OFFSET_HOURS = 3

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Desde cuándo puede empezar la sesión siguiente a una que empieza en `prevStartsAt`. */
export function minStartForNextSession(prevStartsAt: Date, intervalDays: number | null): Date {
  const days = intervalDays && intervalDays > 0 ? intervalDays : 0
  return new Date(prevStartsAt.getTime() + days * DAY_MS)
}

export type PackSlotsValidation = { ok: true } | { ok: false; error: string }

/**
 * Valida las fechas elegidas para un pack:
 *  - al menos 1 (la 1ª sesión es obligatoria; el resto se puede agendar después)
 *  - no más que las sesiones del pack
 *  - estrictamente crecientes
 *  - respetando el intervalo del pack, si tiene
 */
export function validatePackSlots(
  slots: Date[],
  opts: { sessionsTotal: number; intervalDays: number | null }
): PackSlotsValidation {
  if (slots.length === 0)
    return { ok: false, error: "Elegí al menos la fecha de la primera sesión." }
  if (slots.length > opts.sessionsTotal)
    return { ok: false, error: `Este pack tiene ${opts.sessionsTotal} sesiones.` }

  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]
    const cur = slots[i]
    if (cur.getTime() <= prev.getTime())
      return { ok: false, error: "Las sesiones tienen que ir en orden." }
    if (cur.getTime() < minStartForNextSession(prev, opts.intervalDays).getTime())
      return {
        ok: false,
        error: `Entre sesiones tienen que pasar al menos ${opts.intervalDays} días.`,
      }
  }
  return { ok: true }
}

export type PackSessionPrice = { totalCents: number; depositCents: number; depositPaid: boolean }

/**
 * Reparte el precio del pack entre sus turnos: la 1ª sesión lleva el precio
 * completo (con seña del 30%) y las demás van en 0 (ya vienen pagadas por el
 * pack). Así el pack se cuenta UNA sola vez en facturación/estadísticas.
 */
export function packSessionPrices(totalPriceCents: number, count: number): PackSessionPrice[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? {
          totalCents: totalPriceCents,
          depositCents: Math.round(totalPriceCents * 0.3),
          depositPaid: false,
        }
      : { totalCents: 0, depositCents: 0, depositPaid: true }
  )
}

/**
 * Pasa un instante (Date, UTC) a la fecha/hora local de Argentina, en el mismo
 * formato en que se guardan los slots del negocio ("2026-07-20", "14:00").
 */
export function arPartsFromUtc(d: Date): { dateStr: string; timeStr: string; dayOfWeek: number } {
  const ar = new Date(d.getTime() - AR_UTC_OFFSET_HOURS * 3_600_000)
  return {
    dateStr: `${ar.getUTCFullYear()}-${pad2(ar.getUTCMonth() + 1)}-${pad2(ar.getUTCDate())}`,
    timeStr: `${pad2(ar.getUTCHours())}:${pad2(ar.getUTCMinutes())}`,
    dayOfWeek: ar.getUTCDay(),
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/pack-sessions.test.ts`
Expected: PASS — 16 tests.

Run: `npx tsc --noEmit`
Expected: exit 0, sin salida.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/pack-sessions.ts src/lib/servicios/pack-sessions.test.ts
git commit -m "feat(packs): reglas puras de sesiones de pack (intervalo, validación, precios)"
```

---

### Task 2: El pack se descuenta solo al completar un turno ya ligado

Arregla el bug del spec: un turno que **ya tiene** `pack_purchase_id` no descontaba al completarse (sólo descontaba si el llamador pasaba `packPurchaseId`). Sin esto, las sesiones pre-agendadas no se contarían.

**Files:**
- Modify: `src/app/admin/actions.ts` (bloque de packs dentro de `updateAppointmentStatus`)
- Modify: `src/app/admin/_components/status-actions.tsx`
- Modify: `src/app/admin/turnos/page.tsx`

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: `StatusActions` gana la prop `packLinked?: boolean` (default `false`).

- [ ] **Step 1: Arreglar el descuento en el servidor**

En `src/app/admin/actions.ts`, reemplazar el bloque que empieza en `if (enteringCompleted && packPurchaseId) {`:

```ts
  if (enteringCompleted) {
    // Un turno que YA nace de un pack (sesión pre-agendada) descuenta SOLO.
    // Un turno suelto descuenta sólo si quien llama eligió un pack a mano.
    const linkedId = prev?.pack_purchase_id ?? packPurchaseId ?? null
    if (linkedId) {
      const { data: pp } = await admin
        .from("pack_purchases")
        .select("sessions_total, sessions_used")
        .eq("id", linkedId)
        .maybeSingle()
      if (pp && pp.sessions_used < pp.sessions_total) {
        await admin
          .from("pack_purchases")
          .update({ sessions_used: pp.sessions_used + 1 })
          .eq("id", linkedId)
        if (!prev?.pack_purchase_id) {
          await admin
            .from("appointments")
            .update({ pack_purchase_id: linkedId })
            .eq("id", appointmentId)
        }
      }
    }
  }
```

**Corregido en revisión (el plan original decía "queda igual" — estaba mal):** el nuevo modelo
rompe la invariante vieja `ligado ⟺ ya consumió una sesión`, porque las sesiones **nacen ligadas
pero sin consumir**. Hay que arreglar dos lugares:

1. En `leavingCompleted`: sigue devolviendo la sesión (`sessions_used--`), pero **ya no borra**
   `pack_purchase_id`. El vínculo es **intrínseco** (la sesión pertenece al pack aunque se
   des-complete); borrarlo la dejaba huérfana y hacía que el pack creyera que le falta agendar una.
2. En `deleteAppointment`: sólo devuelve la sesión si el turno estaba **`completed`** (hay que
   agregar `status` a su `select`). Antes devolvía siempre que hubiera `pack_purchase_id`, así que
   borrar una sesión pendiente le **regalaba** una sesión a la clienta (5 pagando 4).

- [ ] **Step 2: No ofrecer "¿Descontar de un pack?" si el turno ya viene de uno**

En `src/app/admin/_components/status-actions.tsx`:

Agregar `packLinked` a las props del componente:

```tsx
export default function StatusActions({
  appointmentId,
  currentStatus,
  matchingPacks = [],
  packLinked = false,
}: {
  appointmentId: string
  currentStatus: string
  matchingPacks?: { id: string; label: string }[]
  packLinked?: boolean
}) {
```

Y en el botón de acción principal, cambiar la condición del `onClick` para que el turno ya ligado **no** abra el selector de pack (se descuenta solo):

```tsx
          onClick={
            primaryAction.status === "completed" && matchingPacks.length > 0 && !packLinked
              ? () => setChoosingPack(true)
              : () => change(primaryAction.status)
          }
```

- [ ] **Step 3: Pasar `packLinked` desde la lista de turnos**

En `src/app/admin/turnos/page.tsx`:

1. Agregar `pack_purchase_id` al tipo `ApptRow`:

```ts
type ApptRow = {
  id: string
  starts_at: string
  status: string
  duration_min: number
  total_cents: number
  pack_purchase_id: string | null
  client: { id: string; first_name: string; last_name: string; phone: string | null } | null
  appointment_services: ApptService[]
}
```

2. Agregarlo al `select` de `appointments` (queda `id, starts_at, status, duration_min, total_cents, pack_purchase_id,`).

3. Pasar la prop:

```tsx
<StatusActions
  appointmentId={a.id}
  currentStatus={a.status}
  matchingPacks={packsForAppt(a)}
  packLinked={!!a.pack_purchase_id}
/>
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc exit 0; 12+ tests PASS.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/actions.ts src/app/admin/_components/status-actions.tsx src/app/admin/turnos/page.tsx
git commit -m "fix(packs): el turno que ya viene de un pack lo descuenta solo al completarse"
```

---

### Task 3: Exponer `interval_days` y `packSlots` en el modelo del cliente

Plumbing para que la pantalla conozca el intervalo y pueda guardar varias fechas.

**Files:**
- Modify: `src/app/reserva/data.ts`
- Modify: `src/app/reserva/queries.ts`

**Interfaces:**
- Produces: `ReservaPack.intervalDays: number | null`; `BookingState.packSlots?: string[]` (ISO UTC, orden cronológico; `packSlots[0]` = 1ª sesión).

- [ ] **Step 1: Agregar los campos en `data.ts`**

En `src/app/reserva/data.ts`, en `ReservaPack` agregar después de `sessions`:

```ts
  intervalDays: number | null   // cada cuántos días va una sesión (null = sin regla)
```

En `BookingState` agregar después de `zoneSelections`:

```ts
  // Fechas elegidas de las sesiones del pack (ISO UTC, en orden). La [0] es la
  // 1ª sesión (obligatoria); puede haber menos que sessions (el resto se agenda después).
  packSlots?: string[]
```

- [ ] **Step 2: Traer `interval_days` en la query**

En `src/app/reserva/queries.ts`:

1. En `DbReservaPackRow` agregar `interval_days: number | null` después de `zones_count`.
2. En el `select` de `fetchReservaPacks` agregar `interval_days` (queda `..., sessions, zones_count, interval_days,`).
3. En el `.map(...)` agregar después de `sessions: p.sessions,`:

```ts
      intervalDays: p.interval_days,
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/data.ts src/app/reserva/queries.ts
git commit -m "feat(packs): intervalDays en ReservaPack y packSlots en BookingState"
```

---

### Task 4: El servidor crea N turnos del pack

**Files:**
- Modify: `src/app/reserva/actions.ts` (schema `BookingInput` + rama `if (input.packId)` de `createBooking`)
- Modify: `src/lib/email/booking-emails.ts`

**Interfaces:**
- Consumes de Task 1: `validatePackSlots`, `packSessionPrices`, `arPartsFromUtc`.
- Consumes de Task 3: nada en runtime (sólo tipos del cliente).
- Produces: `createBooking` acepta `packSlots?: string[]`. Si viene vacío/ausente, usa `[input.startsAt]` (compatibilidad).
- Produces: `sendPackConfirmation({ to, firstName, packName, sessionsTotal, startsAtList, totalCents })`.

- [ ] **Step 1: Agregar `packSlots` al schema**

En `src/app/reserva/actions.ts`, en `BookingInput` (junto a `packZoneIds`):

```ts
  packSlots: z.array(z.string()).optional(),
```

Y agregar el import de las reglas (arriba, junto al de zones):

```ts
import { validatePackSlots, packSessionPrices, arPartsFromUtc } from "@/lib/servicios/pack-sessions"
```

- [ ] **Step 2: Traer `interval_days` en la query del pack**

En la rama `if (input.packId)`, agregar `interval_days` al select:

```ts
      .select("id, name, sessions, interval_days, total_price_cents, zones_count, active, visible_reserva, service:services(id, name, pricing_mode, duration_min, price_cents)")
```

- [ ] **Step 3: Validar las fechas y crear N turnos**

Reemplazar todo lo que va **desde** `const packStartsAt = new Date(input.startsAt)` **hasta** el `return { ok: true, appointmentId: packAppt.id }` de la rama del pack, por:

```ts
    // ── Fechas de las sesiones ────────────────────────────────────────────────
    const rawSlots = (input.packSlots?.length ? input.packSlots : [input.startsAt])
    const slotDates = rawSlots.map((s) => new Date(s))
    if (slotDates.some((d) => isNaN(d.getTime())))
      return { ok: false, error: "Alguna fecha del pack es inválida." }

    const rules = validatePackSlots(slotDates, {
      sessionsTotal: pack.sessions,
      intervalDays: pack.interval_days ?? null,
    })
    if (!rules.ok) return { ok: false, error: rules.error }

    // Sala + staff (mismo criterio que el turno normal)
    const { data: packRoom } = await supabase.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
    const packStaffId = input.resolvedStaff
      ? (input.serviceOrder?.[0] ? (input.resolvedStaff[input.serviceOrder[0]] ?? null) : Object.values(input.resolvedStaff)[0] ?? null)
      : (input.proHint !== "auto" ? input.proHint : null)
    const packProHint = packStaffId ?? "auto"

    // ── Revalidar CADA fecha contra la disponibilidad real (autoritativo) ─────
    const { data: bhRows } = await supabase
      .from("business_hours")
      .select("day_of_week, is_open, slots")
    const bhByDow = new Map(
      ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
        .map((h) => [h.day_of_week, h])
    )

    for (let i = 0; i < slotDates.length; i++) {
      const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(slotDates[i])
      const bh = bhByDow.get(dayOfWeek)
      if (!bh?.is_open || !bh.slots.includes(timeStr))
        return { ok: false, error: `El horario de la sesión ${i + 1} ya no está disponible. Elegí otro.` }
      const free = await fetchDayAvailability(dateStr, firstDuration, packProHint, [timeStr])
      if (!free.includes(timeStr))
        return { ok: false, error: `El horario de la sesión ${i + 1} se ocupó. Elegí otro.` }
    }

    // ── Crear la compra del pack ──────────────────────────────────────────────
    const { data: purchase, error: purErr } = await supabase
      .from("pack_purchases")
      .insert({
        client_id: clientId,
        pack_id: pack.id,
        pack_name: pack.name,
        service_id: svc.id,
        service_name: svc.name,
        sessions_total: pack.sessions,
        sessions_used: 0,
      })
      .select("id")
      .single()
    if (purErr || !purchase) return { ok: false, error: `No pudimos registrar el pack: ${purErr?.message}` }

    // ── Un turno por sesión elegida ───────────────────────────────────────────
    const prices = packSessionPrices(pack.total_price_cents, slotDates.length)
    const createdIds: string[] = []

    for (let i = 0; i < slotDates.length; i++) {
      const startsAt = slotDates[i]
      const endsAt = new Date(startsAt.getTime() + firstDuration * 60_000)
      const price = prices[i]

      const { data: appt, error: apptErr } = await supabase
        .from("appointments")
        .insert({
          client_id: clientId,
          staff_id: packStaffId,
          room_id: packRoom?.id ?? null,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          duration_min: firstDuration,
          total_cents: price.totalCents,
          deposit_cents: price.depositCents,
          deposit_paid: price.depositPaid,
          status: "pending",
          source: "web",
          pack_purchase_id: purchase.id,
          notes_internal: `Pack: ${pack.name} (sesión ${i + 1} de ${pack.sessions})`,
        })
        .select("id")
        .single()

      if (apptErr || !appt) {
        // Todo o nada: deshacer lo creado hasta acá.
        if (createdIds.length)
          await supabase.from("appointments").delete().in("id", createdIds)
        await supabase.from("pack_purchases").delete().eq("id", purchase.id)
        return { ok: false, error: `No pudimos crear la sesión ${i + 1}: ${apptErr?.message}` }
      }
      createdIds.push(appt.id)

      const { error: linkErr } = await supabase.from("appointment_services").insert({
        appointment_id: appt.id,
        service_id: svc.id,
        duration_min: firstDuration,
        price_cents: price.totalCents,
        zones: zonesSnapshot,
        staff_id: packStaffId,
        starts_at: startsAt.toISOString(),
      })
      if (linkErr) {
        await supabase.from("appointments").delete().in("id", createdIds)
        await supabase.from("pack_purchases").delete().eq("id", purchase.id)
        return { ok: false, error: `Servicio de la sesión ${i + 1}: ${linkErr.message}` }
      }
    }

    // ── Avisos (best-effort) ──────────────────────────────────────────────────
    try {
      await sendPackConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        packName: pack.name,
        sessionsTotal: pack.sessions,
        startsAtList: slotDates,
        totalCents: pack.total_price_cents,
      })
    } catch {}

    await notifyNewBooking(supabase, {
      clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
      clientPhone: input.client.phone,
      servicesNames: [`${pack.name} (pack · ${slotDates.length} de ${pack.sessions} sesiones agendadas)`],
      startsAt: slotDates[0],
      durationMin: firstDuration,
      totalCents: pack.total_price_cents,
      assignedStaffIds: [packStaffId],
    })

    return { ok: true, appointmentId: createdIds[0] }
```

Y agregar al import de emails (arriba del archivo) `sendPackConfirmation`.

- [ ] **Step 4: Email de confirmación con todas las fechas**

En `src/lib/email/booking-emails.ts`, agregar al final. Usa los helpers que **ya existen en ese
archivo** con estas firmas exactas: `FROM`, `SITE`, `shell(title, body)`, `fmtDateAR(d)`,
`fmtPrice(cents)` ← **recibe CENTAVOS**, `escape(s)`, `ctaButtons(primaryHref, primaryLabel)`.

```ts
export async function sendPackConfirmation(data: {
  to: string
  firstName: string
  packName: string
  sessionsTotal: number
  startsAtList: Date[]
  totalCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const subject = `Tu pack está reservado · ${data.packName}`
  const missing = data.sessionsTotal - data.startsAtList.length

  const rows = data.startsAtList
    .map(
      (d, i) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">Sesión ${i + 1}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(d))}</td></tr>`
    )
    .join("")

  const missingNote =
    missing > 0
      ? `<p style="font-size:13px;color:#7a6e64;">Te quedan <strong>${missing}</strong> sesión(es) por agendar. Coordinamos con vos para fijarlas.</p>`
      : ""

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Pack reservado</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;">${escape(data.packName)}</h1>
    <p style="font-size:14px;margin:0 0 16px;">Hola ${escape(data.firstName)}, reservamos tu pack de ${data.sessionsTotal} sesiones.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
    ${missingNote}
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Total del pack: <strong>${fmtPrice(data.totalCents)}</strong></p>
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

En `createBooking` (Step 3), la llamada queda **sin** `appointmentId`:

```ts
      await sendPackConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        packName: pack.name,
        sessionsTotal: pack.sessions,
        startsAtList: slotDates,
        totalCents: pack.total_price_cents,
      })
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/actions.ts src/lib/email/booking-emails.ts
git commit -m "feat(packs): createBooking crea un turno por sesión elegida (1ª con el precio, resto en 0)"
```

---

### Task 5: Selector de fecha/hora reutilizable

**Files:**
- Create: `src/app/reserva/_components/pack-session-picker.tsx`

**Interfaces:**
- Consumes: `fetchDayAvailability` (ya existe en `src/app/reserva/actions.ts`), `generateAvailability`, `filterFutureSlots`, `MONTH_NAMES`, `DOW_SHORT`, `DOW_NAMES`, `pad2`, `ymd`, `parseYmd`, `slotToUtcMs`, `type BusinessHour` (todos de `../data`).
- Produces:

```ts
export default function PackSessionPicker(props: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string            // "auto" o el id de la profesional
  minDate: Date | null       // no se puede elegir antes de esta fecha (regla del intervalo)
  onPick: (startsAtIso: string) => void
  onCancel: () => void
}): JSX.Element
```

- [ ] **Step 1: Crear el componente**

Crear `src/app/reserva/_components/pack-session-picker.tsx`:

```tsx
"use client"

import { useState, useEffect } from "react"
import { fetchDayAvailability } from "../actions"
import {
  generateAvailability,
  filterFutureSlots,
  MONTH_NAMES,
  DOW_SHORT,
  DOW_NAMES,
  pad2,
  ymd,
  parseYmd,
  slotToUtcMs,
  type BusinessHour,
} from "../data"

/**
 * Elige fecha y hora de UNA sesión de pack. Se usa al comprar el pack y desde
 * el admin. Bloquea todo lo anterior a `minDate` (la regla del intervalo) y
 * sólo ofrece horarios realmente libres (los pide al servidor).
 */
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  minDate,
  onPick,
  onCancel,
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
  minDate: Date | null
  onPick: (startsAtIso: string) => void
  onCancel: () => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [availability] = useState(() => generateAvailability(60, businessHours))
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // El día mínimo permitido (por la regla del intervalo). Si no hay, hoy.
  const minDay = (() => {
    if (!minDate) return today
    const d = new Date(minDate)
    d.setHours(0, 0, 0, 0)
    return d > today ? d : today
  })()

  useEffect(() => {
    if (!selectedDate) { setSlots([]); return }
    const candidates = filterFutureSlots(selectedDate, availability[selectedDate] ?? [])
    if (!candidates.length) { setSlots([]); return }
    let cancelled = false
    setLoading(true)
    fetchDayAvailability(selectedDate, durationMin, proHint, candidates).then((free) => {
      if (cancelled) return
      // Además del cupo, respetar el mínimo exacto (hora incluida) del intervalo.
      const okByInterval = minDate
        ? free.filter((t) => slotToUtcMs(selectedDate, t) >= minDate.getTime())
        : free
      setSlots(okByInterval)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedDate, durationMin, proHint, availability, minDate])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())
  const selectedObj = selectedDate ? parseYmd(selectedDate) : null

  return (
    <div>
      <div className="cal">
        <div className="cal__monthnav">
          <h2 className="cal__monthname">
            {MONTH_NAMES[viewMonth]} <span>{viewYear}</span>
          </h2>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              className="cal__arrow"
              disabled={!canPrev}
              onClick={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
                else setViewMonth(viewMonth - 1)
              }}
            >
              ‹
            </button>
            <button
              className="cal__arrow"
              onClick={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
                else setViewMonth(viewMonth + 1)
              }}
            >
              ›
            </button>
          </div>
        </div>

        <div className="cal__grid">
          {DOW_SHORT.map((d) => (
            <div key={d} className="cal__dowheader">{d}</div>
          ))}
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div key={"e" + i} className="cal__day cal__day--empty" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`
            const dateObj = new Date(viewYear, viewMonth, day)
            const isSel = selectedDate === dateStr
            const isToday = dateStr === ymd(today)
            const tooEarly = dateObj < minDay
            const hasSlots =
              !tooEarly &&
              !!availability[dateStr] &&
              filterFutureSlots(dateStr, availability[dateStr]).length > 0
            return (
              <button
                key={day}
                className={`cal__day ${hasSlots ? "cal__day--available" : ""} ${
                  isSel ? "cal__day--selected" : ""
                } ${isToday ? "cal__day--today" : ""}`}
                disabled={!hasSlots}
                onClick={() => setSelectedDate(dateStr)}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      <div className="slots">
        {!selectedDate || !selectedObj ? (
          <p style={{ fontSize: 12, color: "var(--ink-mute)", textAlign: "center", padding: "24px 0" }}>
            Elegí un día para ver horarios disponibles.
          </p>
        ) : (
          <>
            <div className="slots__head">
              <h3 className="slots__title">
                {DOW_NAMES[(selectedObj.getDay() + 6) % 7]}{" "}
                <em>{selectedObj.getDate()} de {MONTH_NAMES[selectedObj.getMonth()].toLowerCase()}</em>
              </h3>
            </div>
            {loading ? (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "16px 0" }}>
                Verificando disponibilidad…
              </p>
            ) : slots.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "16px 0" }}>
                No hay horarios disponibles ese día. Probá con otro.
              </p>
            ) : (
              <div className="slots__grid">
                {slots.map((t) => (
                  <button
                    key={t}
                    className="slot"
                    onClick={() => onPick(new Date(slotToUtcMs(selectedDate, t)).toISOString())}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn" onClick={onCancel} style={{ marginTop: 12 }}>
        Cancelar
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos en 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/reserva/_components/pack-session-picker.tsx
git commit -m "feat(packs): selector reutilizable de fecha/hora para una sesión de pack"
```

---

### Task 6: La reserva pide las fechas de todas las sesiones

**Files:**
- Modify: `src/app/reserva/screens.tsx` — la pantalla de fecha se llama **`Screen2DateTime`**
  (línea ~501; ya recibe `businessHours` y `onNext` como props) y la de confirmación, donde se
  arma la llamada a `createBooking`.

**Interfaces:**
- Consumes: `PackSessionPicker` (Task 5), `minStartForNextSession` (Task 1), `BookingState.packSlots` (Task 3).
- Produces: `state.packSlots` poblado; `createBooking` recibe `packSlots`.

- [ ] **Step 1: En `Screen2DateTime`, si hay pack, mostrar la lista de sesiones**

Agregar los imports arriba del archivo:

```tsx
import PackSessionPicker from "./_components/pack-session-picker"
import { minStartForNextSession } from "@/lib/servicios/pack-sessions"
```

Declarar el hook **junto a los demás hooks** de `Screen2DateTime` (arriba de todo, nunca dentro de un `if`):

```tsx
  const [pickingIdx, setPickingIdx] = useState<number | null>(null)
```

Y **antes** del `return` normal de `Screen2DateTime`, insertar esta rama (usa `selectedPack` y
`packDurationMin`, que ya existen en esa pantalla, y las clases `headline` / `lede` / `btn`, que
son las que ya usa el resto del archivo):

```tsx
  // ── Pack: se eligen las fechas de las sesiones, no una sola ───────────────
  if (selectedPack) {
    const pack = selectedPack.pack
    const picked = state.packSlots ?? []
    const proHint = state.pro ?? "auto"

    const setSlot = (idx: number, iso: string) => {
      const next = [...picked]
      next[idx] = iso
      setState({ ...state, packSlots: next.slice(0, idx + 1) }) // al cambiar una, se re-eligen las siguientes
      setPickingIdx(null)
    }
    const clearFrom = (idx: number) =>
      setState({ ...state, packSlots: picked.slice(0, idx) })

    const minFor = (idx: number): Date | null => {
      if (idx === 0) return null
      const prev = picked[idx - 1]
      if (!prev) return null
      return minStartForNextSession(new Date(prev), pack.intervalDays)
    }

    if (pickingIdx !== null) {
      return (
        <div className="screen__body">
          <h1 className="headline">Sesión {pickingIdx + 1} de {pack.sessions}</h1>
          {pack.intervalDays && pickingIdx > 0 && (
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
              Tiene que haber al menos {pack.intervalDays} días desde la sesión anterior.
            </p>
          )}
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={packDurationMin}
            proHint={proHint}
            minDate={minFor(pickingIdx)}
            onPick={(iso) => setSlot(pickingIdx, iso)}
            onCancel={() => setPickingIdx(null)}
          />
        </div>
      )
    }

    return (
      <div className="screen__body">
        <h1 className="headline">Tus <em>sesiones</em></h1>
        <p className="lede">
          {pack.name} · {pack.sessions} sesiones. Elegí al menos la primera; el resto lo podés
          agendar después.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
          {Array.from({ length: pack.sessions }).map((_, i) => {
            const iso = picked[i]
            const blocked = i > 0 && !picked[i - 1]   // no se puede elegir la 3ª sin la 2ª
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "10px 12px", border: "1px solid var(--line)",
                  borderRadius: 10, opacity: blocked ? 0.45 : 1,
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <strong>Sesión {i + 1}</strong>{" "}
                  {iso
                    ? new Date(iso).toLocaleString("es-AR", {
                        weekday: "short", day: "2-digit", month: "short",
                        hour: "2-digit", minute: "2-digit", hour12: false,
                        timeZone: "America/Argentina/Buenos_Aires",
                      })
                    : <span style={{ color: "var(--ink-mute)" }}>— la agendo después —</span>}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={blocked} onClick={() => setPickingIdx(i)}>
                    {iso ? "Cambiar" : "Elegir fecha"}
                  </button>
                  {iso && i > 0 && (
                    <button className="btn" onClick={() => clearFrom(i)}>Quitar</button>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <button
          className="btn btn--primary"
          disabled={picked.length === 0}
          onClick={onNext}
        >
          {picked.length === 0
            ? "Elegí la fecha de la primera sesión"
            : `Continuar (${picked.length} de ${pack.sessions} agendadas)`}
        </button>
      </div>
    )
  }
```

> **Recordatorio:** `pickingIdx` ya quedó declarado arriba con los demás hooks — no lo declares
> acá dentro (React prohíbe hooks dentro de un `if`).

- [ ] **Step 2: Mandar `packSlots` al confirmar**

En la pantalla de confirmación de `screens.tsx`, en el objeto que se le pasa a `createBooking`, agregar junto a `packId`:

```tsx
      packSlots: state.pack ? (state.packSlots ?? []) : undefined,
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 4: Verificación manual (obligatoria)**

```bash
npm run dev
```

En `/reserva`: elegir el pack de Vela Slim (4 sesiones), elegir las zonas, y en el paso de fecha:
1. Verificar que aparece la lista "Sesión 1..4".
2. Elegir la sesión 1 → vuelve a la lista con la fecha puesta.
3. Elegir la sesión 2 → el calendario **bloquea** los días anteriores a (sesión 1 + 7 días).
4. Dejar 3 y 4 sin elegir → el botón dice "Continuar (2 de 4 agendadas)".
5. Confirmar la reserva.
6. En Supabase: 2 turnos con el mismo `pack_purchase_id`; el 1º con `total_cents` = precio del pack y el 2º en `0`; ambos `pending`.

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(packs): la reserva pide la fecha de cada sesión del pack"
```

---

### Task 7: Admin — agendar sesiones pendientes y "Confirmar pack"

**Files:**
- Modify: `src/app/admin/actions.ts` (dos acciones nuevas)
- Create: `src/app/admin/clientas/[id]/pack-sessions.tsx`
- Modify: `src/app/admin/clientas/[id]/page.tsx`

**Interfaces:**
- Consumes de Task 1: `validatePackSlots`, `arPartsFromUtc`, `minStartForNextSession`.
- Consumes de Task 5: `PackSessionPicker`.
- Produces:
  - `schedulePackSession(packPurchaseId: string, startsAtIso: string, opts?: { allowIntervalOverride?: boolean }): Promise<{ ok: boolean; error?: string }>`
  - `confirmPackSessions(packPurchaseId: string): Promise<{ ok: boolean; error?: string; confirmed?: number }>`

- [ ] **Step 1: Acciones del servidor**

En `src/app/admin/actions.ts`, agregar (junto a las demás acciones de packs). Importar arriba:

```ts
import { minStartForNextSession, arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { fetchDayAvailability } from "@/app/reserva/actions"
```

```ts
// ─── Sesiones de un pack ──────────────────────────────────────────────────────

/**
 * Agenda UNA sesión pendiente de un pack ya comprado. El turno va en 0 (el pack
 * ya está pagado). El intervalo del pack se respeta salvo que se pida saltearlo.
 */
export async function schedulePackSession(
  packPurchaseId: string,
  startsAtIso: string,
  opts?: { allowIntervalOverride?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { data: pp } = await admin
    .from("pack_purchases")
    .select("id, client_id, pack_id, service_id, sessions_total")
    .eq("id", packPurchaseId)
    .maybeSingle()
  if (!pp) return { ok: false, error: "No encontramos ese pack." }

  const { data: pack } = await admin
    .from("packs")
    .select("interval_days, service:services(duration_min)")
    .eq("id", pp.pack_id)
    .maybeSingle()
  const intervalDays = (pack?.interval_days as number | null) ?? null
  const svcDuration = ((pack?.service as unknown as { duration_min: number } | null)?.duration_min) ?? 0

  // Turnos ya agendados de este pack (no cancelados), en orden.
  const { data: existing } = await admin
    .from("appointments")
    .select("id, starts_at, duration_min")
    .eq("pack_purchase_id", packPurchaseId)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })
  const rows = (existing ?? []) as { id: string; starts_at: string; duration_min: number }[]

  if (rows.length >= pp.sessions_total)
    return { ok: false, error: "Este pack ya tiene todas sus sesiones agendadas." }

  const startsAt = new Date(startsAtIso)
  if (isNaN(startsAt.getTime())) return { ok: false, error: "Fecha inválida." }

  // Duración: la de las sesiones ya creadas (respeta las zonas del pack); si no
  // hay ninguna, la del servicio.
  const durationMin = rows[0]?.duration_min ?? svcDuration
  if (durationMin <= 0) return { ok: false, error: "No pudimos calcular la duración de la sesión." }

  // Intervalo contra la sesión inmediatamente anterior (salvo override).
  if (!opts?.allowIntervalOverride && intervalDays && rows.length) {
    const previous = rows
      .map((r) => new Date(r.starts_at))
      .filter((d) => d.getTime() < startsAt.getTime())
      .sort((a, b) => b.getTime() - a.getTime())[0]
    if (previous && startsAt.getTime() < minStartForNextSession(previous, intervalDays).getTime())
      return { ok: false, error: `Entre sesiones tienen que pasar al menos ${intervalDays} días.` }
  }

  // Disponibilidad real.
  const { dateStr, timeStr } = arPartsFromUtc(startsAt)
  const free = await fetchDayAvailability(dateStr, durationMin, "auto", [timeStr])
  if (!free.includes(timeStr)) return { ok: false, error: "Ese horario no está disponible." }

  const { data: room } = await admin.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)

  const { data: appt, error: apptErr } = await admin
    .from("appointments")
    .insert({
      client_id: pp.client_id,
      staff_id: null,
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: durationMin,
      total_cents: 0,          // el pack ya está pagado
      deposit_cents: 0,
      deposit_paid: true,
      status: "pending",
      source: "admin",
      pack_purchase_id: packPurchaseId,
      notes_internal: `Pack: sesión ${rows.length + 1} de ${pp.sessions_total}`,
    })
    .select("id")
    .single()
  if (apptErr || !appt) return { ok: false, error: `No pudimos crear la sesión: ${apptErr?.message}` }

  const { error: linkErr } = await admin.from("appointment_services").insert({
    appointment_id: appt.id,
    service_id: pp.service_id,
    duration_min: durationMin,
    price_cents: 0,
    staff_id: null,
    starts_at: startsAt.toISOString(),
  })
  if (linkErr) {
    await admin.from("appointments").delete().eq("id", appt.id)
    return { ok: false, error: `Servicio de la sesión: ${linkErr.message}` }
  }

  revalidatePath(`/admin/clientas/${pp.client_id}`)
  revalidatePath("/admin/turnos")
  return { ok: true }
}

/**
 * Confirma de una vez TODAS las sesiones pendientes de un pack (se usa después
 * de verificar que la seña está pagada). No toca canceladas ni completadas.
 */
export async function confirmPackSessions(
  packPurchaseId: string
): Promise<{ ok: boolean; error?: string; confirmed?: number }> {
  await requireStaff()
  const admin = adminClient()

  const { data: pending } = await admin
    .from("appointments")
    .select("id, client_id")
    .eq("pack_purchase_id", packPurchaseId)
    .eq("status", "pending")
  const rows = (pending ?? []) as { id: string; client_id: string }[]
  if (!rows.length) return { ok: true, confirmed: 0 }

  const { error } = await admin
    .from("appointments")
    .update({ status: "confirmed" })
    .in("id", rows.map((r) => r.id))
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/admin/clientas/${rows[0].client_id}`)
  revalidatePath("/admin/turnos")
  revalidatePath("/admin")
  return { ok: true, confirmed: rows.length }
}
```

- [ ] **Step 2: Componente de la ficha de la clienta**

Crear `src/app/admin/clientas/[id]/pack-sessions.tsx`:

```tsx
"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { schedulePackSession, confirmPackSessions } from "../../actions"
import type { BusinessHour } from "@/app/reserva/data"

export type PackPurchaseView = {
  id: string
  packName: string
  serviceName: string
  sessionsTotal: number
  sessionsUsed: number
  durationMin: number
  intervalDays: number | null
  sessions: { id: string; startsAt: string; status: string }[]
  lastStartsAt: string | null   // última sesión agendada (para el intervalo)
}

export default function PackSessions({
  purchase,
  businessHours,
}: {
  purchase: PackPurchaseView
  businessHours: BusinessHour[]
}) {
  const [picking, setPicking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState(false)

  const scheduled = purchase.sessions.length
  const missing = purchase.sessionsTotal - scheduled
  const pendingCount = purchase.sessions.filter((s) => s.status === "pending").length

  const minDate =
    !override && purchase.intervalDays && purchase.lastStartsAt
      ? new Date(new Date(purchase.lastStartsAt).getTime() + purchase.intervalDays * 24 * 3600 * 1000)
      : null

  const pick = (iso: string) => {
    setError(null)
    startTransition(async () => {
      const r = await schedulePackSession(purchase.id, iso, { allowIntervalOverride: override })
      if (r.ok) setPicking(false)
      else setError(r.error ?? "Error")
    })
  }

  const confirmAll = () => {
    setError(null)
    startTransition(async () => {
      const r = await confirmPackSessions(purchase.id)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  return (
    <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
      <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>
        {scheduled} agendadas · {missing} sin agendar · {purchase.sessionsUsed} completadas
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {purchase.sessions.map((s, i) => (
          <div key={s.id} style={{ fontSize: 13, display: "flex", gap: 10 }}>
            <span style={{ color: "var(--ink-mute)" }}>Sesión {i + 1}</span>
            <span>
              {new Date(s.startsAt).toLocaleString("es-AR", {
                weekday: "short", day: "2-digit", month: "short",
                hour: "2-digit", minute: "2-digit", hour12: false,
                timeZone: "America/Argentina/Buenos_Aires",
              })}
            </span>
            <span className={`adm-pill adm-pill--${s.status}`}>{s.status}</span>
          </div>
        ))}
      </div>

      {picking ? (
        <div>
          {purchase.intervalDays && purchase.lastStartsAt && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Saltear el mínimo de {purchase.intervalDays} días desde la sesión anterior
            </label>
          )}
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={purchase.durationMin}
            proHint="auto"
            minDate={minDate}
            onPick={pick}
            onCancel={() => setPicking(false)}
          />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {missing > 0 && (
            <button className="adm-btn" disabled={pending} onClick={() => setPicking(true)}>
              Agendar sesión
            </button>
          )}
          {pendingCount > 0 && (
            <button className="adm-btn adm-btn--primary" disabled={pending} onClick={confirmAll}>
              {pending ? "Confirmando…" : `Confirmar las ${pendingCount} sesiones`}
            </button>
          )}
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#8c463c", marginTop: 8 }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Enchufarlo en la ficha de la clienta**

En `src/app/admin/clientas/[id]/page.tsx`:

1. Importar:

```tsx
import PackSessions, { type PackPurchaseView } from "./pack-sessions"
import { fetchBusinessHours } from "@/app/reserva/queries"
```

2. Después de traer `purchases`, traer los turnos de esos packs, los datos de los packs y los horarios:

```tsx
  const businessHours = await fetchBusinessHours()

  const purchaseIds = purchases.map((p) => p.id)
  const { data: packApptsData } = purchaseIds.length
    ? await admin
        .from("appointments")
        .select("id, starts_at, status, duration_min, pack_purchase_id")
        .in("pack_purchase_id", purchaseIds)
        .neq("status", "cancelled")
        .order("starts_at", { ascending: true })
    : { data: [] as { id: string; starts_at: string; status: string; duration_min: number; pack_purchase_id: string }[] }
  const packAppts = (packApptsData ?? []) as {
    id: string; starts_at: string; status: string; duration_min: number; pack_purchase_id: string
  }[]

  // interval_days + duración del servicio de cada pack comprado
  const { data: packMetaData } = await admin
    .from("pack_purchases")
    .select("id, pack:packs(interval_days, service:services(duration_min))")
    .in("id", purchaseIds.length ? purchaseIds : ["00000000-0000-0000-0000-000000000000"])
  const packMeta = new Map(
    ((packMetaData ?? []) as unknown as {
      id: string
      pack: { interval_days: number | null; service: { duration_min: number } | null } | null
    }[]).map((m) => [m.id, m])
  )

  const purchaseViews: PackPurchaseView[] = purchases.map((p) => {
    const sessions = packAppts
      .filter((a) => a.pack_purchase_id === p.id)
      .map((a) => ({ id: a.id, startsAt: a.starts_at, status: a.status }))
    const meta = packMeta.get(p.id)
    return {
      id: p.id,
      packName: p.pack_name,
      serviceName: p.service_name,
      sessionsTotal: p.sessions_total,
      sessionsUsed: p.sessions_used,
      durationMin:
        packAppts.find((a) => a.pack_purchase_id === p.id)?.duration_min ??
        meta?.pack?.service?.duration_min ??
        0,
      intervalDays: meta?.pack?.interval_days ?? null,
      sessions,
      lastStartsAt: sessions.length ? sessions[sessions.length - 1].startsAt : null,
    }
  })
```

3. Dentro del `purchases.map((p) => ...)` que dibuja cada pack, **debajo** de la fila existente, renderizar:

```tsx
<PackSessions
  purchase={purchaseViews.find((v) => v.id === p.id)!}
  businessHours={businessHours}
/>
```

> **Nota para el implementador:** el `.map` actual devuelve un `<div className="adm-list-row">`. Envolvé la fila y el `<PackSessions>` en un `<div key={p.id}>` para no romper el grid de la fila.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 5: Verificación manual (obligatoria)**

En `/admin/clientas/<id>` de la clienta que compró el pack en Task 6:
1. Se ven las 2 sesiones agendadas + "2 sin agendar".
2. "Agendar sesión" → el calendario bloquea antes de (última + 7 días). Elegir una → aparece en la lista.
3. Tildar "Saltear el mínimo" → deja elegir una fecha más cercana.
4. "Confirmar las N sesiones" → todas pasan a **Confirmado** en `/admin/turnos`.
5. Completar una sesión desde Turnos → **no** aparece "¿Descontar de un pack?" y `sessions_used` sube sola (verificar en Supabase).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actions.ts src/app/admin/clientas/[id]/pack-sessions.tsx src/app/admin/clientas/[id]/page.tsx
git commit -m "feat(packs): agendar sesiones pendientes y confirmar el pack de un clic desde el admin"
```

---

### Task 8: Verificación final y deploy

**Files:** ninguno (sólo verificación).

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: los tres en 0. Vitest: 25 tests previos + 16 nuevos = 41.

- [ ] **Step 2: Recorrido end-to-end en dev**

`npm run dev` y verificar, en este orden:
1. Comprar un pack de 4 eligiendo **2** sesiones → se crean 2 turnos, mismo `pack_purchase_id`, el 1º con el precio del pack y el 2º en `$0`, ambos `pending`.
2. El mail de confirmación llega con **las 2 fechas** y dice que quedan 2 por agendar.
3. Admin → ficha de la clienta → agendar las 2 pendientes.
4. "Confirmar las 4 sesiones" → las 4 quedan `confirmed`.
5. Completar una → `sessions_used` = 1, **sin** cartelito de pack.
6. Estadísticas: el pack figura **una sola vez** (no ×4).

- [ ] **Step 3: Deploy**

No hay migración: se pushea el código directo.

```bash
git push origin main
```

Verificar que el deploy de Vercel quede en **READY** y repetir el punto 1 del recorrido en producción con un pack de prueba (después borrar el turno de prueba).

---

## Notas de riesgo

- **`screens.tsx` es enorme (~1900 líneas).** La rama del pack en `Screen2DateTime` (Task 6) es el punto más delicado: respetar las reglas de hooks (nada de `useState` dentro de un `if`) y reusar las clases CSS existentes (`headline`, `lede`, `screen__body`, `btn btn--primary`).
- **Duración de las sesiones del pack:** todas usan la duración de la 1ª (que sale de las zonas elegidas). Es intencional: las zonas del pack son las mismas en todas las sesiones.
- **`fetchDayAvailability` se importa desde el admin** (Task 7). Es un server action exportado de `src/app/reserva/actions.ts`; si eso trajera problemas de importación cruzada, extraer la función a `src/lib/` y que ambos la importen desde ahí.
