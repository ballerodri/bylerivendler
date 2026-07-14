# Que el turno guarde quién lo hace — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un turno reservado en **"Auto"** deje de quedar con `staff_id = NULL`: el servidor elige una profesional real y la **guarda**; y que el salón pueda **cambiarla** desde el admin.

**Architecture:** `assignableStaff` (en `src/lib/servicios/availability.ts`) **ya devuelve la lista** de quiénes pueden tomar un horario — `fetchDayAvailability` sólo pregunta `.length > 0` y la tira. Se agrega una función pura `chooseStaff` (desempate + continuidad) y un helper de servidor `chooseStaffForSlot` que reusa **exactamente** las mismas piezas puras que ya deciden la disponibilidad, así que la elección **no puede contradecir** al buscador. Se guarda el resultado en las sesiones de pack, en los servicios "cada uno en su fecha" (separados) y en `schedulePackSession`. Se agrega la acción `reasignarProfesional` + un botón en el admin.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-profesional-asignada-design.md`

## Global Constraints

- **La resolución tiene que usar la MISMA función que decide la disponibilidad** (`assignableStaff`). Si el servidor asignara a alguien que el buscador considera ocupada → **doble reserva**; si rechazara un horario que el buscador ofrece → **reserva perdida**. Las dos cosas ya rompieron esta app.
- **Desempate (varias libres): la que tenga MENOS turnos ese día.**
- **Continuidad en un pack: se PREFIERE la profesional ya elegida en una sesión anterior, pero NO se fuerza** (forzarla rechazaría horarios válidos = menos reservas).
- **"Juntos" NO se toca** (el buscador secuencial ya resuelve y guarda) ni **`createAdminBooking`** (ya devuelve `resolvedStaff`).
- **El botón "Cambiar profesional" DEBE negarse si la profesional nueva ya está ocupada** en esa ventana (sus turnos, sus horas bloqueadas), excluyendo el turno que se está editando. Sin ese chequeo es una máquina de pisar turnos.
- **El cambio NO exige `staff_services`** (escape del admin), pero la pantalla **marca** cuáles sí lo hacen.
- **Ninguna migración.** `appointments.staff_id` y `appointment_services.staff_id` ya existen.
- **La lógica de "patas anónimas" (`assignableStaff`) se CONSERVA** — van a seguir existiendo turnos sin profesional (los que el admin cargue a mano). No se borra nada.
- Verificación en cada tarea: `npx tsc --noEmit` = 0 · `npx vitest run` verde · `npm run build` = 0 · `npx eslint src --quiet` = **16** (el baseline de `main`; un 17º es un error nuevo).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/lib/servicios/choose-staff.ts` **(nuevo, puro)** | `chooseStaff(candidates, countsByStaff, preferredStaffId?)`: el desempate (menos turnos ese día) + la continuidad. Testeable. |
| `src/app/reserva/actions.ts` | `chooseStaffForSlot(...)` (helper de servidor) + guardar la profesional resuelta en pack y separados. |
| `src/app/admin/actions.ts` | `schedulePackSession` resuelve y guarda; nueva acción `reasignarProfesional`. |
| `src/app/admin/_components/status-actions.tsx` (o el componente del turno) | Botón "Cambiar profesional". |
| `src/app/admin/…/page.tsx` (donde se listan los turnos) | Traer `appointment_services(service, staff)` para poder cambiar por servicio. |

---

### Task 1: La elección, pura y testeada (TDD)

**Files:**
- Create: `src/lib/servicios/choose-staff.ts`
- Test: `src/lib/servicios/choose-staff.test.ts`

**Interfaces:**
- Produces: `chooseStaff(candidates: string[], countsByStaff: Record<string, number>, preferredStaffId?: string | null): string | null`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/servicios/choose-staff.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { chooseStaff } from "./choose-staff"

describe("chooseStaff", () => {
  it("sin candidatas devuelve null", () => {
    expect(chooseStaff([], {})).toBeNull()
  })

  it("una sola candidata: esa", () => {
    expect(chooseStaff(["leri"], { leri: 3 })).toBe("leri")
  })

  it("varias libres: la que tiene MENOS turnos ese día", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 5, marina: 2 })).toBe("marina")
  })

  it("empate de turnos: la primera de la lista (determinista)", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 2, marina: 2 })).toBe("roman")
  })

  it("una candidata sin turnos ese día cuenta como 0", () => {
    // marina no aparece en el mapa -> 0 turnos -> gana
    expect(chooseStaff(["roman", "marina"], { roman: 1 })).toBe("marina")
  })

  it("CONTINUIDAD: si la preferida está entre las candidatas, se la elige aunque tenga más turnos", () => {
    // marina es la preferida (sesión anterior del pack) y sigue disponible:
    // se la mantiene aunque roman tenga menos turnos.
    expect(chooseStaff(["roman", "marina"], { roman: 1, marina: 9 }, "marina")).toBe("marina")
  })

  it("la preferida ya NO está disponible: se cae al desempate normal", () => {
    // marina era la preferida pero no quedó entre las candidatas de este slot.
    expect(chooseStaff(["roman", "leri"], { roman: 4, leri: 1 }, "marina")).toBe("leri")
  })

  it("preferida null (primera sesión, sin preferencia): desempate normal", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 3, marina: 1 }, null)).toBe("marina")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/servicios/choose-staff.test.ts`
Expected: FAIL — "Failed to resolve import './choose-staff'".

- [ ] **Step 3: Implementar**

Crear `src/lib/servicios/choose-staff.ts`:

```ts
/**
 * Elige UNA profesional entre las que pueden tomar un horario.
 *
 * `candidates` ya viene de `assignableStaff` (la MISMA función que decide la
 * disponibilidad): son las que hacen el servicio, están activas, trabajan a esa
 * hora y no tienen un turno encima. Acá sólo se desempata.
 *
 * Reglas:
 *  1. Si la `preferredStaffId` (la que ya se eligió en una sesión anterior de
 *     este mismo pack) sigue entre las candidatas, se la mantiene — continuidad,
 *     sin forzarla: si ya no está disponible, se cae al desempate normal.
 *  2. Desempate: la que tenga MENOS turnos ese día (reparte la carga). Si aún
 *     hay empate, la primera de la lista (determinista).
 *
 * Lógica PURA (sin servidor) para poder testearla.
 */
export function chooseStaff(
  candidates: string[],
  countsByStaff: Record<string, number>,
  preferredStaffId?: string | null
): string | null {
  if (candidates.length === 0) return null

  // Continuidad: la preferida gana si sigue disponible.
  if (preferredStaffId && candidates.includes(preferredStaffId)) return preferredStaffId

  // Desempate por menos turnos ese día. `reduce` conserva la PRIMERA ante un
  // empate, así que el resultado es determinista respecto del orden de entrada.
  return candidates.reduce((best, pid) =>
    (countsByStaff[pid] ?? 0) < (countsByStaff[best] ?? 0) ? pid : best
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/choose-staff.test.ts`
Expected: PASS — **8 tests**.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/choose-staff.ts src/lib/servicios/choose-staff.test.ts
git commit -m "feat(profesional): elección pura (desempate por menos turnos + continuidad)"
```

---

### Task 2: El helper de servidor que elige a quién

**Files:**
- Modify: `src/app/reserva/actions.ts` (nuevo `chooseStaffForSlot`, junto a `fetchDayAvailability`)

**Interfaces:**
- Consumes de Task 1: `chooseStaff`.
- Consumes (ya existen, exportadas de `@/lib/servicios/availability`): `buildBusyLegs`, `assignableStaff`, `type BusyLeg`.
- Consumes (ya existen): `allowedStaffFor`, `type StaffServiceMap` de `@/lib/servicios/staff-services`; `proWorksAtSlot`, `buildBlockedMap`, `arPartsFromUtc`, `slotToUtcMs`.
- Produces:
  - `chooseStaffForSlot(supabase, args: { dateStr: string; timeStr: string; durationMin: number; serviceId: string; preferredStaffId?: string | null }): Promise<string | null>`

**Qué hace:** corre la **misma** consulta y la **misma** función (`assignableStaff`) que el ramo `proHint === "auto" && serviceId` de `fetchDayAvailability`, pero en vez de tirar la lista, la pasa por `chooseStaff` con los conteos de turnos de **ese día**. Devuelve el `staffId` elegido, o `null` si nadie puede (mismo veredicto que el buscador → nunca lo contradice).

- [ ] **Step 1: Leer `fetchDayAvailability` entero**

Antes de escribir nada, leé `fetchDayAvailability` (en `src/app/reserva/actions.ts`, arranca ~`:1284`), en particular el bloque `if (proHint === "auto") { if (serviceId) { … } }`. **`chooseStaffForSlot` tiene que armar `candidates` con exactamente los mismos tres filtros** (`activePros.includes` · `proWorksAtSlot` · `!overlappingLegs.some(l => l.staffId === pid)`) y llamar a `assignableStaff` con los mismos argumentos. Copiar la forma, no inventarla.

- [ ] **Step 2: Escribir el helper**

Agregar en `src/app/reserva/actions.ts`, **inmediatamente después** de `fetchDayAvailability`, importando `chooseStaff` arriba:

```ts
import { chooseStaff } from "@/lib/servicios/choose-staff"
```

```ts
/**
 * Elige UNA profesional concreta para un slot que se reservó en "Auto".
 *
 * Usa la MISMA consulta y la MISMA función (`assignableStaff`) que
 * `fetchDayAvailability` para decidir la disponibilidad: si devuelve un nombre,
 * ese nombre está tan libre como el buscador afirmó; si devuelve `null`, nadie
 * puede — el mismo veredicto que el buscador. No pueden contradecirse.
 *
 * Desempate: la que tenga menos turnos ESE día. `preferredStaffId` (la elegida
 * en una sesión anterior del mismo pack) se prefiere si sigue disponible.
 */
async function chooseStaffForSlot(
  supabase: ReturnType<typeof adminClient>,
  args: {
    dateStr: string
    timeStr: string
    durationMin: number
    serviceId: string
    preferredStaffId?: string | null
  }
): Promise<string | null> {
  const { dateStr, timeStr, durationMin, serviceId, preferredStaffId } = args
  const slotStart = slotToUtcMs(dateStr, timeStr)
  const slotEnd = slotStart + durationMin * 60_000

  // Ventana del día (AR) para traer los turnos y contar por profesional.
  const [dy, dm, dd] = dateStr.split("-").map(Number)
  const dayStartMs = Date.UTC(dy, dm - 1, dd, AR_UTC_OFFSET, 0, 0)
  const dayStart = new Date(dayStartMs).toISOString()
  const dayEnd = new Date(dayStartMs + 24 * 3_600_000).toISOString()

  const [{ data: apptData }, { data: prosData }, { data: availData }, { data: linkRows, error: linkErr }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("id, starts_at, duration_min, staff_id, appointment_services(service_id, staff_id, starts_at, duration_min)")
        .gte("starts_at", dayStart)
        .lte("starts_at", dayEnd)
        .in("status", ["pending", "confirmed"]),
      supabase.from("staff").select("id").eq("is_professional", true).eq("active", true),
      supabase.from("staff_blocked_slots").select("staff_id, day_of_week, slot"),
      supabase.from("staff_services").select("staff_id, service_id").eq("service_id", serviceId),
    ])
  // Fail-closed: si no podemos leer quién hace el servicio, no inventamos a nadie.
  if (linkErr) return null

  const activePros = (prosData ?? []).map((p: { id: string }) => p.id)
  const blockedMap = buildBlockedMap((availData ?? []) as { staff_id: string; day_of_week: number; slot: string }[])
  const staffMap: StaffServiceMap = {
    [serviceId]: (linkRows ?? []).map((r: { staff_id: string }) => r.staff_id),
  }
  const legs = buildBusyLegs((apptData ?? []) as ApptRow[])
  const overlappingLegs = legs.filter((l) => slotStart < l.endMs && slotEnd > l.startMs)

  // El día de la semana AR para `proWorksAtSlot` (mismo criterio que el buscador).
  const arDow = arPartsFromUtc(new Date(slotStart)).dayOfWeek

  const candidates = allowedStaffFor(serviceId, staffMap).filter(
    (pid) =>
      activePros.includes(pid) &&
      proWorksAtSlot(pid, arDow, slotStart, slotEnd, blockedMap) &&
      !overlappingLegs.some((l) => l.staffId === pid)
  )
  const assignable = assignableStaff(candidates, overlappingLegs, staffMap, activePros)

  // Conteo de turnos por profesional ESE día (para repartir la carga).
  const countsByStaff: Record<string, number> = {}
  for (const a of (apptData ?? []) as { staff_id: string | null }[]) {
    if (a.staff_id) countsByStaff[a.staff_id] = (countsByStaff[a.staff_id] ?? 0) + 1
  }

  return chooseStaff(assignable, countsByStaff, preferredStaffId ?? null)
}
```

> **El día de la semana** que consume `proWorksAtSlot` tiene que ser el **AR** (`arDow`, vía `arPartsFromUtc`), no `getUTCDay()` — así lo hace `fetchDayAvailability`. Verificá cómo lo obtiene ese buscador y usá el **mismo** camino, o `proWorksAtSlot` compararía contra las horas bloqueadas del día equivocado.
> **`ApptRow`** es el tipo que ya usa `fetchDayAvailability` para `buildBusyLegs` — reusalo (está en el mismo archivo). Si no está exportado, importá o compartí la forma exacta que ya se usa ahí.

- [ ] **Step 3: Verificar que compila (todavía no cambia comportamiento)**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16. (El helper todavía no se llama desde ningún lado: sólo tiene que compilar.)

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(profesional): helper que elige a quién, con la misma función que el buscador"
```

---

### Task 3: Guardar la profesional en el pack y en separados

**Files:**
- Modify: `src/app/reserva/actions.ts` (la revalidación del pack ~`:404-420` y la de separados ~`:407-448`)

**Interfaces:**
- Consumes de Task 2: `chooseStaffForSlot`.

**Qué hace:** cuando un slot quedó en "Auto", después de confirmar que está libre, elige un nombre y lo guarda en el `PlannedAppointment` (y en su pata). Si la clienta pidió una profesional puntual, no cambia nada.

- [ ] **Step 1: Separados**

En la rama de separados, hoy el loop confirma disponibilidad y después arma los `PlannedAppointment` con `staffId = hint !== "auto" ? hint : null`. Reemplazar ese cálculo para que, cuando el hint sea "auto", **resuelva y guarde**:

```ts
    // Resolver la profesional de cada slot ANTES de armar el plan. "Auto" se
    // convierte en un nombre concreto (o se rechaza si nadie puede).
    const resolvedByService: Record<string, string | null> = {}
    for (const s of slots) {
      const hint = hintFor(s.serviceId)
      if (hint !== "auto") {
        resolvedByService[s.serviceId] = hint
        continue
      }
      const { dateStr, timeStr } = arPartsFromUtc(new Date(s.startsAtMs))
      const chosen = await chooseStaffForSlot(supabase, {
        dateStr,
        timeStr,
        durationMin: s.durationMin,
        serviceId: s.serviceId,
      })
      // Si el buscador lo ofreció como libre pero acá nadie puede, hubo una
      // carrera (alguien reservó en el medio): se rechaza, nunca se deja en $0
      // ni se pisa un turno.
      if (!chosen)
        return await rollbackAll(
          supabase,
          { appointmentIds: [], packPurchaseId: null },
          clientId,
          redeem ? totalPointsCost : 0,
          `El horario de ${s.name} se ocupó. Elegí otro.`
        )
      resolvedByService[s.serviceId] = chosen
    }
```

> **Ubicación:** este bloque va **después** del loop que revalida con `fetchDayAvailability` (el de ~`:407-415`) y **antes** del `slots.map(...)` que arma los `PlannedAppointment`. El rollback se llama `rollbackAll(supabase, { appointmentIds, packPurchaseId }, clientId, pointsToRefund, error)` — verificá su firma real leyendo el archivo. **Este `return` es posterior a un posible descuento de puntos → TIENE que devolver los puntos** (`redeem ? totalPointsCost : 0`). Esta regla ya se rompió tres veces en este código.

Y en el `slots.map(...)`, cambiar las dos apariciones de `staffId`:

```ts
      const staffId = resolvedByService[s.serviceId] ?? null
```

(la de `PlannedAppointment.staffId` y la de la pata `legs[0].staffId` — las dos leen `resolvedByService`).

- [ ] **Step 2: Pack (con continuidad)**

En la rama del pack, hoy `packStaffId` es **uno solo para todas las sesiones**. Con la resolución, cada sesión se resuelve **prefiriendo la de la sesión anterior**. Después del loop que revalida las fechas del pack, y antes de armar los `PlannedAppointment` de las sesiones, resolver por sesión:

```ts
    // Resolver la profesional de CADA sesión. Si la clienta pidió una puntual
    // (packStaffId no es null), se respeta en todas. Si es "Auto", se elige por
    // sesión, PREFIRIENDO la de la sesión anterior (continuidad) sin forzarla.
    const sessionStaff: (string | null)[] = []
    let prev: string | null = null
    for (let i = 0; i < slotDates.length; i++) {
      if (packStaffId) { sessionStaff.push(packStaffId); continue }
      const { dateStr, timeStr } = arPartsFromUtc(slotDates[i])
      const chosen = await chooseStaffForSlot(supabase, {
        dateStr,
        timeStr,
        durationMin: firstDuration,
        serviceId: svc.id,
        preferredStaffId: prev,
      })
      if (!chosen)
        return { ok: false, error: `El horario de la sesión ${i + 1} se ocupó. Elegí otro.` }
      sessionStaff.push(chosen)
      prev = chosen
    }
```

> **El `return` del pack no reembolsa puntos y está bien:** con un pack en la compra el canje se rechaza antes (`hasPack && redeem`), así que `redeem` es `false` en esta rama. Verificalo.

Y en el `slotDates.map(...)` (o el loop) que arma los `PlannedAppointment` de las sesiones, usar `sessionStaff[i]` en lugar de `packStaffId` para **`staffId`** del turno y de su pata.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Comprobación manual (obligatoria):
1. Reservar un **pack en "Auto"** → cada sesión queda con **una profesional guardada** (mirar `appointments.staff_id` y `appointment_services.staff_id`), y es alguien que **hace** ese servicio.
2. Reservar **2 servicios "cada uno en su fecha" en "Auto"** → cada turno queda con profesional.
3. Reservar eligiendo una profesional **puntual** → queda **esa** (sin cambios respecto de hoy).

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(profesional): guardar la profesional resuelta en el pack y en separados"
```

---

### Task 4: El salón agenda una sesión → también se resuelve

**Files:**
- Modify: `src/app/admin/actions.ts` (`schedulePackSession`, ~`:1607-1665`)

**Interfaces:**
- Consumes de Task 2: `chooseStaffForSlot` (hay que **exportarla** de `reserva/actions.ts` — sacarle el `async function` privado y ponerle `export`).

**Qué hace:** las sesiones que el salón agenda desde la ficha de la clienta hoy se guardan con `staff_id: NULL`. Ahora se resuelven igual.

- [ ] **Step 1: Exportar el helper**

En `src/app/reserva/actions.ts`, cambiar `async function chooseStaffForSlot` por `export async function chooseStaffForSlot`.

- [ ] **Step 2: Resolver en `schedulePackSession`**

En `src/app/admin/actions.ts`, importar arriba:

```ts
import { chooseStaffForSlot } from "@/app/reserva/actions"
```

Después del chequeo de disponibilidad (`const free = await fetchDayAvailability(...)`, ~`:1617`) y antes del insert del `appointments`, resolver:

```ts
  // Resolver una profesional concreta para la sesión (antes quedaba en NULL).
  const chosenStaffId = await chooseStaffForSlot(admin, {
    dateStr,
    timeStr,
    durationMin,
    serviceId: pp.service_id,
  })
```

> `dateStr`/`timeStr` ya están calculados arriba (`arPartsFromUtc(startsAt)`), `durationMin` también, y `pp.service_id` es el servicio del pack. `admin` es el cliente Supabase de esta acción.

Y en los **dos** inserts (`appointments` ~`:1636` y `appointment_services` ~`:1659`), cambiar `staff_id: null` por `staff_id: chosenStaffId`.

> **Si `chosenStaffId` es `null`** (nadie disponible / servicio sin nadie cargado), se **conserva** el comportamiento de hoy (queda en NULL): no se rechaza el agendado del salón — el admin es el escape, y la sesión de pack tiene que poder agendarse igual. Es exactamente lo que `chooseStaffForSlot` ya devuelve en ese caso.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

Comprobación manual: agendar una sesión de pack desde la ficha → queda con profesional (si hay alguien que lo hace y está libre).

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts src/app/admin/actions.ts
git commit -m "feat(profesional): al agendar una sesión de pack, el salón también la resuelve"
```

---

### Task 5: Cambiar la profesional desde el admin (acción)

**Files:**
- Modify: `src/app/admin/actions.ts` (nueva acción `reasignarProfesional`)

**Interfaces:**
- Consumes (ya existen): `fetchDayAvailability` de `@/app/reserva/actions`, `arPartsFromUtc` de `@/lib/servicios/pack-sessions`, `requireStaff`, `adminClient`.
- Produces: `reasignarProfesional(appointmentId: string, serviceId: string, staffId: string): Promise<{ ok: boolean; error?: string }>`

**Qué hace:** cambia la profesional de **una pata** (un servicio) de un turno, **negándose si ya está ocupada**.

- [ ] **Step 1: La acción**

En `src/app/admin/actions.ts`:

```ts
/**
 * Cambia la profesional de UN servicio de un turno. Se niega si la profesional
 * nueva ya está ocupada en esa ventana (sus turnos, sus horas bloqueadas),
 * excluyendo este mismo turno — o sea, el botón NUNCA puede pisar un turno.
 *
 * NO exige `staff_services` (el admin es el escape del salón), pero la pantalla
 * marca cuáles sí lo hacen.
 */
export async function reasignarProfesional(
  appointmentId: string,
  serviceId: string,
  staffId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  // La profesional nueva tiene que estar activa y ser profesional.
  const { data: staff } = await admin
    .from("staff")
    .select("full_name, active, is_professional")
    .eq("id", staffId)
    .maybeSingle()
  if (!staff || !staff.active || !staff.is_professional)
    return { ok: false, error: "Esa profesional no está activa." }

  // La pata (servicio) que se está cambiando, para saber su ventana.
  const { data: leg } = await admin
    .from("appointment_services")
    .select("starts_at, duration_min, appointment:appointments(starts_at, duration_min)")
    .eq("appointment_id", appointmentId)
    .eq("service_id", serviceId)
    .maybeSingle()
  if (!leg) return { ok: false, error: "No encontramos ese servicio en el turno." }

  // La ventana de la pata (si la pata no tiene starts_at propio, la del turno).
  const legStartIso = (leg.starts_at as string | null)
    ?? (leg.appointment as unknown as { starts_at: string }).starts_at
  const legDuration = (leg.duration_min as number | null)
    ?? (leg.appointment as unknown as { duration_min: number }).duration_min
  const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(new Date(legStartIso))

  // ¿Trabaja a esa hora? ¿Está libre? Se reusa el buscador con esa profesional
  // como hint explícito, saltando la puerta `staff_services` (escape del admin)
  // y EXCLUYENDO este turno (no puede bloquearse a sí mismo).
  const free = await fetchDayAvailability(dateStr, legDuration, staffId, [timeStr], {
    serviceId,
    excludeAppointmentId: appointmentId,
    skipStaffServiceCheck: true,
  })
  if (!free.includes(timeStr))
    return { ok: false, error: `${staff.full_name} ya tiene un turno a esa hora (o no atiende).` }

  // Cambiar la pata.
  const { error: legErr } = await admin
    .from("appointment_services")
    .update({ staff_id: staffId })
    .eq("appointment_id", appointmentId)
    .eq("service_id", serviceId)
  if (legErr) return { ok: false, error: legErr.message }

  // `appointments.staff_id` = la profesional de la PRIMERA pata en el tiempo
  // (la convención de `createBooking`/`mainStaffId`). Se recalcula.
  const { data: legs } = await admin
    .from("appointment_services")
    .select("staff_id, starts_at")
    .eq("appointment_id", appointmentId)
  const firstLeg = (legs ?? [])
    .filter((l) => l.staff_id)
    .sort((a, b) => new Date(a.starts_at as string).getTime() - new Date(b.starts_at as string).getTime())[0]
  await admin
    .from("appointments")
    .update({ staff_id: firstLeg?.staff_id ?? staffId })
    .eq("id", appointmentId)

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
  revalidatePath("/admin/clientas")
  return { ok: true }
}
```

> **Leé una acción vecina** (`registrarPago`, `rescheduleAppointment`) para copiar **exactamente** cómo obtienen `requireStaff`, `adminClient` y qué `revalidatePath` usan. Si `appointment_services.starts_at` puede ser NULL, el fallback a la ventana del turno ya está contemplado.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "feat(profesional): reasignarProfesional — cambiar por servicio, se niega si ya está ocupada"
```

---

### Task 6: El botón en el admin

**Files:**
- Modify: la página donde se listan los turnos (`src/app/admin/turnos/page.tsx` y/o `src/app/admin/page.tsx`) — traer las patas con su profesional.
- Modify: el componente de acciones del turno (`src/app/admin/_components/status-actions.tsx`) o uno nuevo — el botón + el selector.

**Interfaces:**
- Consumes de Task 5: `reasignarProfesional(appointmentId, serviceId, staffId)`.

- [ ] **Step 1: Traer las patas y las profesionales**

En la página que lista los turnos, el `select` de `appointments` ya trae `appointment_services(service:services(name), staff:staff(full_name))`. Asegurate de que traiga también **el `id` del servicio y el `id` de la profesional** por pata, y la lista de profesionales activas (para el selector). Leé el `select` actual y agregá lo que falte (`service:services(id, name)`, `staff:staff(id, full_name)`), y pasá `professionals` (las activas) al componente.

> **También conviene traer, por servicio, quiénes lo hacen** (`staff_services`) para poder **marcar** en el selector cuáles sí — pero es opcional para la primera versión: alcanza con listar todas las activas. Si se agrega, que sea un dato ya resuelto en el server component, no una query desde el cliente.

- [ ] **Step 2: El botón + selector**

En el componente del turno, agregar un ítem **"Cambiar profesional"**. Como un turno puede tener **varios servicios**, mostrar **una fila por servicio** con su profesional actual y un selector de las activas. Al elegir una, llamar a `reasignarProfesional(appointmentId, serviceId, staffId)` dentro de un `startTransition`, y mostrar el error si vuelve `{ ok: false }`.

Seguí **el patrón que ya usa `StatusActions`** para los formularios inline (el de "Registrar pago" es el más parecido: abre un mini-form, llama a la acción, muestra el error). **Reusá las clases que ya existen** (`adm-btn`, `adm-menu`, etc.) — no inventes CSS. Y **mantené Atrás/cerrar** donde corresponda.

> Como el markup exacto depende de cómo esté hoy `StatusActions`, **leelo entero antes** y calcá la forma de "Registrar pago": mismo `useState` para abrir/cerrar, mismo `startTransition`, mismo lugar en el menú `⋯`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 4: Verificación manual (obligatoria)**

En `/admin/turnos`:
1. Un turno "Auto" ahora muestra **una profesional** (ya no está en blanco).
2. **⋯ → Cambiar profesional** → elegir otra → la fila se actualiza.
3. Elegir una profesional que **ya tiene un turno a esa hora** → **error**, no se cambia nada.
4. Un turno con **dos servicios** → se puede cambiar **cada uno** por separado.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/turnos/page.tsx src/app/admin/page.tsx src/app/admin/_components/status-actions.tsx
git commit -m "feat(profesional): botón Cambiar profesional en el turno (por servicio)"
```

---

### Task 7: Verificación final y deploy

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet
```
Expected: tsc 0 · vitest **131 + 8 = 139** verdes · build 0 · eslint **16** (baseline; 0 nuevos).

- [ ] **Step 2: Recorrido end-to-end**

1. **Pack en "Auto"** → cada sesión con profesional guardada, que hace el servicio.
2. **Separados en "Auto"** → cada turno con profesional.
3. **Profesional puntual elegida** → queda esa (sin cambios).
4. **"Juntos"** → **idéntico a hoy** (no se tocó).
5. **Sesión de pack agendada por el salón** → con profesional.
6. **Cambiar profesional** → funciona por servicio; **se niega** si la nueva ya está ocupada.
7. **Continuidad**: en un pack "Auto", las sesiones tienden a la **misma** profesional cuando está libre.
8. **Sin regresión** en el buscador: un servicio que sólo hace Leri sigue ofreciendo sus horarios; "Auto" sigue mostrando **más** horarios que elegir una persona.

- [ ] **Step 3: Deploy (lo hace la controladora)**

No hay migración: se pushea el código a `main`.

---

## Notas de riesgo

- **`chooseStaffForSlot` DEBE coincidir con `fetchDayAvailability`.** Las dos arman `candidates` con los mismos tres filtros y llaman a `assignableStaff` con los mismos argumentos. Si divergen, el servidor podría asignar a alguien ocupada (doble reserva) o rechazar un horario ofrecido (reserva perdida). La revisión tiene que comparar los dos bloques lado a lado.
- **El botón "Cambiar profesional" sin el chequeo de disponibilidad es una máquina de pisar turnos.** El chequeo (con `excludeAppointmentId`) es obligatorio.
- **Los turnos sin profesional NO desaparecen** (los que el admin ya cargó, o los que cargue a mano si `chooseStaffForSlot` devuelve null). La lógica de "patas anónimas" de `assignableStaff` **se conserva** — sólo deja de *crearse* el problema en los caminos nuevos.
- **`createBooking` sigue sin tests.** Los caminos de pack y separados que toca la Task 3 se verifican leyendo el diff y con la comprobación manual — no hay red automática. La revisión tiene que trazar la plata y la profesional a mano.
