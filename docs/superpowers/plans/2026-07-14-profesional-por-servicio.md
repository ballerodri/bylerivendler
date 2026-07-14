# Respetar qué profesional hace cada servicio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la reserva online respete la tabla `staff_services` (quién hace qué), tanto en los botones de "Profesional" como —sobre todo— en el **buscador de horarios**, que hoy la ignora por completo.

**El bug (real, en producción hoy):** el salón ya cargó 20 asignaciones (Leri: 11 faciales · Roman: 6 masajes/reiki · Marina: 3 masajes), pero `fetchSequentialAvailability` elige la profesional con `allPros.find(...)` — **cualquiera** — y `fetchDayAvailability` ni siquiera sabe de qué servicio se trata. Con "Auto", el sistema puede asignarle un **HIFU Facial a Roman**, que no hace faciales. El `ProPicker` de la pantalla, además, ofrece **todas** las profesionales para **todos** los servicios.

**Decisión de la usuaria:** un servicio **sin ninguna profesional asignada NO se puede reservar** online (regla estricta). Hoy hay **9 servicios así** — dejan de aparecer en la reserva hasta que se les asigne alguien, y el admin muestra un cartel que los lista.

**Escape hatch:** en el **admin** la regla NO se aplica. El salón es de confianza y tiene que poder cargar un turno de un servicio todavía sin asignar. Si el admin también fuera estricto, esos 9 servicios no se podrían ni cargar a mano.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase, Vitest.

## Global Constraints

- **`staff_services(staff_id, service_id)` ya existe** (schema inicial) y tiene 20 filas. **No hay migración.**
- **Regla (público):** para cada servicio, las profesionales candidatas son **exactamente** las ligadas en `staff_services`. Si no hay ninguna, el servicio **no se puede reservar**.
- **Regla (admin):** **no se aplica**. `enforceStaffServices` es opt-out y el admin lo desactiva.
- **El servidor es autoritativo.** `createBooking` revalida: una profesional que no hace el servicio se **rechaza** (fail-closed), aunque el cliente mande el payload a mano.
- **La reserva no puede quedar en un callejón:** un servicio no reservable **no se ofrece** en el catálogo (ni suelto, ni dentro de un combo, ni como pack). Nada de mostrarlo y después decir "no hay horarios".
- **Ningún cambio de plata.** Ni precios, ni duraciones, ni `total_cents` / `deposit_cents` / `paid_cents`.
- **No romper lo que ya anda:** packs, combos, el modo "separados", el modo "juntos".
- Verificación en cada tarea: `npx tsc --noEmit` = 0, `npx vitest run` verde, `npm run build` = 0, `npx eslint src --quiet` = **16** (el baseline de `main`; un 17º es un error nuevo).

---

### Task 1: La regla, pura y testeada (TDD)

**Files:**
- Create: `src/lib/servicios/staff-services.ts`
- Test: `src/lib/servicios/staff-services.test.ts`

**Interfaces:**
- Produces:
  - `type StaffServiceMap = Record<string, string[]>` — serviceId → staffIds que lo hacen.
  - `allowedStaffFor(serviceId: string, map: StaffServiceMap): string[]`
  - `serviceIsBookable(serviceId: string, map: StaffServiceMap): boolean`
  - `canStaffDoService(staffId: string, serviceId: string, map: StaffServiceMap): boolean`
  - `unbookableServiceIds(serviceIds: string[], map: StaffServiceMap): string[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/servicios/staff-services.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  allowedStaffFor,
  serviceIsBookable,
  canStaffDoService,
  unbookableServiceIds,
  type StaffServiceMap,
} from "./staff-services"

const MAP: StaffServiceMap = {
  hifu: ["leri"],
  masaje: ["roman", "marina"],
  laser: [], // cargado pero sin nadie
}

describe("allowedStaffFor", () => {
  it("devuelve las profesionales que hacen el servicio", () => {
    expect(allowedStaffFor("masaje", MAP)).toEqual(["roman", "marina"])
  })

  it("un servicio sin nadie asignado devuelve vacío", () => {
    expect(allowedStaffFor("laser", MAP)).toEqual([])
  })

  it("un servicio que no está en el mapa devuelve vacío (fail-closed)", () => {
    expect(allowedStaffFor("desconocido", MAP)).toEqual([])
  })
})

describe("serviceIsBookable", () => {
  it("con al menos una profesional, sí", () => {
    expect(serviceIsBookable("hifu", MAP)).toBe(true)
  })

  it("sin nadie asignado, NO (regla estricta)", () => {
    expect(serviceIsBookable("laser", MAP)).toBe(false)
  })

  it("un servicio ausente del mapa, NO", () => {
    expect(serviceIsBookable("desconocido", MAP)).toBe(false)
  })
})

describe("canStaffDoService", () => {
  it("la profesional asignada, sí", () => {
    expect(canStaffDoService("roman", "masaje", MAP)).toBe(true)
  })

  it("una profesional que NO hace ese servicio, no", () => {
    // Este es EL bug: Roman no hace faciales.
    expect(canStaffDoService("roman", "hifu", MAP)).toBe(false)
  })

  it("nadie puede hacer un servicio sin asignaciones", () => {
    expect(canStaffDoService("leri", "laser", MAP)).toBe(false)
  })

  it('"auto" no es una profesional: no pasa el chequeo', () => {
    expect(canStaffDoService("auto", "hifu", MAP)).toBe(false)
  })
})

describe("unbookableServiceIds", () => {
  it("lista los que no tienen a nadie", () => {
    expect(unbookableServiceIds(["hifu", "masaje", "laser"], MAP)).toEqual(["laser"])
  })

  it("si están todos asignados, la lista es vacía", () => {
    expect(unbookableServiceIds(["hifu", "masaje"], MAP)).toEqual([])
  })

  it("conserva el orden en que se pidieron", () => {
    expect(unbookableServiceIds(["laser", "hifu", "otro"], MAP)).toEqual(["laser", "otro"])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/servicios/staff-services.test.ts`
Expected: FAIL — "Failed to resolve import './staff-services'".

- [ ] **Step 3: Implementar**

Crear `src/lib/servicios/staff-services.ts`:

```ts
/**
 * Quién hace qué: la regla de `staff_services`. Lógica PURA (sin servidor) para
 * poder testearla y usar la MISMA regla en la pantalla, en el buscador de
 * horarios y en el servidor.
 *
 * Regla estricta (decisión del salón): un servicio SIN ninguna profesional
 * asignada **no se puede reservar** online. Fail-closed: ante la duda, no.
 * (En el admin la regla no se aplica: el salón tiene que poder cargar a mano un
 * servicio todavía sin asignar.)
 */

/** serviceId → ids de las profesionales que hacen ese servicio. */
export type StaffServiceMap = Record<string, string[]>

/** Las profesionales que pueden hacer este servicio. Vacío = nadie. */
export function allowedStaffFor(serviceId: string, map: StaffServiceMap): string[] {
  return map[serviceId] ?? []
}

/** ¿Se puede reservar? Sólo si hay al menos una profesional que lo haga. */
export function serviceIsBookable(serviceId: string, map: StaffServiceMap): boolean {
  return allowedStaffFor(serviceId, map).length > 0
}

/**
 * ¿Esta profesional hace este servicio? `"auto"` NO es una profesional: quien
 * quiera resolver el "auto" tiene que elegir de `allowedStaffFor`.
 */
export function canStaffDoService(
  staffId: string,
  serviceId: string,
  map: StaffServiceMap
): boolean {
  return allowedStaffFor(serviceId, map).includes(staffId)
}

/** De estos servicios, cuáles NO se pueden reservar (para avisarle al salón). */
export function unbookableServiceIds(serviceIds: string[], map: StaffServiceMap): string[] {
  return serviceIds.filter((id) => !serviceIsBookable(id, map))
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/staff-services.test.ts`
Expected: PASS — **13 tests** (3 + 3 + 4 + 3).

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/staff-services.ts src/lib/servicios/staff-services.test.ts
git commit -m "feat(profesional): regla pura de quién hace qué servicio"
```

---

### Task 2: Traer el mapa y sacar del catálogo lo que no se puede reservar

**Files:**
- Modify: `src/app/reserva/queries.ts`

**Interfaces:**
- Consumes de Task 1: `type StaffServiceMap`, `serviceIsBookable`.
- Produces:
  - `fetchStaffServices(): Promise<StaffServiceMap>`
  - `fetchCatalog`, `fetchCombos`, `fetchReservaPacks` **ya no devuelven** lo que no se puede reservar.

- [ ] **Step 1: El mapa**

En `src/app/reserva/queries.ts`, importar arriba:

```ts
import { serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
```

Y agregar (junto a `fetchProfessionals`):

```ts
/**
 * serviceId → profesionales que lo hacen (`staff_services`), contando SÓLO
 * staff activo y profesional (una profesional dada de baja no puede atender).
 */
export async function fetchStaffServices(): Promise<StaffServiceMap> {
  const supabase = adminClient()

  const { data } = await supabase
    .from("staff_services")
    .select("service_id, staff:staff(id, active, is_professional)")

  const map: StaffServiceMap = {}
  for (const row of (data ?? []) as unknown as {
    service_id: string
    staff: { id: string; active: boolean; is_professional: boolean } | null
  }[]) {
    if (!row.staff?.active || !row.staff.is_professional) continue
    ;(map[row.service_id] ??= []).push(row.staff.id)
  }
  return map
}
```

> **Por qué se filtra por `active`/`is_professional`:** `fetchProfessionals` ya lo hace. Si una profesional se da de baja y era la única que hacía un servicio, ese servicio pasa a no ser reservable — que es exactamente lo correcto.

- [ ] **Step 2: El catálogo no ofrece lo que no se puede reservar**

En `fetchCatalog()`, después de armar los servicios y **antes** de devolverlos, filtrar con el mapa. Traer el mapa dentro de la misma función (`const map = await fetchStaffServices()`), descartar los servicios con `!serviceIsBookable(s.id, map)`, y **descartar también las categorías que quedan sin servicios** (una categoría vacía en la pantalla es un callejón).

En `fetchCombos()`, descartar un combo si **alguno** de sus servicios no es reservable (el combo se hace entero o no se hace).

En `fetchReservaPacks()`, descartar un pack si su `serviceId` no es reservable.

> **Leé cada función antes de tocarla** y aplicá el filtro respetando la forma en que ya arma sus objetos. No cambies precios, duraciones ni el orden.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/queries.ts
git commit -m "feat(profesional): la reserva no ofrece servicios que nadie hace"
```

---

### Task 3: El buscador de horarios respeta quién hace qué

**Files:**
- Modify: `src/app/reserva/actions.ts` (`fetchSequentialAvailability`, `fetchDayAvailability`, `checkPerm`)
- Modify: `src/app/admin/nueva-reserva/nueva-reserva-form.tsx` (opt-out del admin)

**Interfaces:**
- Consumes de Task 1: `allowedStaffFor`, `canStaffDoService`, `type StaffServiceMap`.
- Produces:
  - `fetchSequentialAvailability(services, fromDate, daysAhead?, opts?: { enforceStaffServices?: boolean })` — **default `true`**.
  - `fetchDayAvailability(dateStr, durationMin, proHint, candidateSlots, serviceId?: string | null)` — cuando llega `serviceId`, se aplica la regla; cuando no (admin), no.

**ESTE ES EL CORAZÓN DEL BUG.** Hoy `checkPerm` elige con `allPros.find(...)`: **cualquier** profesional.

- [ ] **Step 1: `fetchSequentialAvailability`**

1. Importar arriba:

```ts
import { allowedStaffFor, canStaffDoService, type StaffServiceMap } from "@/lib/servicios/staff-services"
```

2. Agregar el parámetro de opciones a la firma (default = estricto):

```ts
export async function fetchSequentialAvailability(
  services: ServiceInput[],
  fromDate: string,
  daysAhead = 30,
  opts: { enforceStaffServices?: boolean } = {}
): Promise<SequentialAvailabilityResult> {
  const enforce = opts.enforceStaffServices ?? true
```

3. Dentro, traer el mapa **sólo si `enforce`** (una query menos cuando el admin no lo necesita):

```ts
  let staffMap: StaffServiceMap = {}
  if (enforce) {
    const { data: linkRows, error: linkErr } = await supabase
      .from("staff_services")
      .select("service_id, staff_id")
      .in("service_id", services.map((s) => s.id))
    if (linkErr) console.error("staff_services:", linkErr.message)
    for (const r of (linkRows ?? []) as { service_id: string; staff_id: string }[]) {
      ;(staffMap[r.service_id] ??= []).push(r.staff_id)
    }
  }
```

> **Ojo (fail-closed):** si esa query falla, `staffMap` queda vacío y **ningún servicio tendrá profesional** → no se ofrecen horarios. Es lo correcto para una regla estricta: ante un error, **no** ofrecer un turno que podría caer en la profesional equivocada. Se loguea el error.

4. `checkPerm` recibe el mapa y el flag, y **elige sólo entre las candidatas del servicio**. Reemplazar la selección (hoy: `const free = preferred ?? allPros.find(...)`) por:

```ts
      // Las candidatas de ESTE servicio: las que lo hacen (regla estricta).
      // Sin la regla (admin), cualquiera de las activas.
      const candidates = enforce ? allowedStaffFor(svc.id, staffMap) : allPros

      // Si la clienta pidió una profesional puntual, tiene que hacer el servicio.
      if (svc.staffId !== "auto") {
        if (enforce && !canStaffDoService(svc.staffId, svc.id, staffMap)) return null
        if (!proWorksAtSlot(svc.staffId, dayOfWeek, sStart, sEnd, blockedMap) || overlaps(svc.staffId))
          return null
        assignment[svc.id] = svc.staffId
      } else {
        const free = candidates.find(
          (pid) => proWorksAtSlot(pid, dayOfWeek, sStart, sEnd, blockedMap) && !overlaps(pid)
        )
        if (!free) return null
        assignment[svc.id] = free
      }
```

> **Leé `checkPerm` entero antes de reemplazar.** Hoy tiene una rama `preferred` para el `staffId` explícito y un `allPros.find` para el "auto": el bloque de arriba cubre las dos, pero adaptalo a los nombres y a la forma exactos que ya tiene (`sStart`, `sEnd`, `overlaps`, `proWorksAtSlot`). **No cambies** la lógica de solapamiento ni la de horarios bloqueados: sólo **de qué lista sale la profesional**.

5. `checkPerm` y `trySlot` necesitan el mapa y el flag: pasalos como parámetros (no uses variables de módulo).

6. **El fallback `individualSlotsForDate`** (el que se usa cuando no hay ningún horario encadenado) también elige profesional con `allPros.some(...)`. Aplicale la misma regla: las candidatas de **ese** servicio.

- [ ] **Step 2: `fetchDayAvailability`**

Agregar un parámetro final **opcional**:

```ts
export async function fetchDayAvailability(
  dateStr: string,
  durationMin: number,
  proHint: string,
  candidateSlots: string[],
  serviceId?: string | null
): Promise<string[]> {
```

Cuando `serviceId` viene (los caminos públicos), traer sus profesionales de `staff_services` y:
- si `proHint !== "auto"`: si esa profesional **no** hace el servicio → devolver `[]`.
- si `proHint === "auto"`: considerar libre un horario sólo si **alguna de las candidatas del servicio** está libre (hoy mira todas las activas). Si el servicio no tiene candidatas → devolver `[]`.

Cuando `serviceId` **no** viene (admin), el comportamiento es **exactamente el de hoy**.

> **Leé la función entera antes de tocarla.** Hoy filtra por `proHint` en las queries y después chequea disponibilidad. Mantené esa estructura: sólo acotá el conjunto de profesionales candidatas.

- [ ] **Step 3: Los llamadores públicos pasan el `serviceId`**

- `src/app/reserva/actions.ts:~364` (rama del pack): pasar `svc.id`.
- `src/app/reserva/actions.ts:~562` (rama "separados"): pasar `s.serviceId`.
- `src/app/reserva/_components/pack-session-picker.tsx:~82`: el componente necesita el `serviceId`. Agregarle una prop `serviceId: string` (obligatoria) y pasarla en sus **dos** call sites de `screens.tsx` (la rama del pack pasa `pack.serviceId`; la rama "separados" pasa el id del servicio que se está fechando).
- `src/app/admin/actions.ts:~1505` (`schedulePackSession`): **NO** pasar `serviceId` (el admin no aplica la regla).

- [ ] **Step 4: El admin se sale de la regla**

En `src/app/admin/nueva-reserva/nueva-reserva-form.tsx:~97`, la llamada pasa a:

```ts
      const res = await fetchSequentialAvailability(svcs, d, 1, { enforceStaffServices: false })
```

> El salón es de confianza y tiene que poder cargar un turno de un servicio todavía sin asignar. Si el admin también fuera estricto, esos servicios no se podrían ni cargar a mano.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/actions.ts src/app/reserva/_components/pack-session-picker.tsx src/app/reserva/screens.tsx src/app/admin/nueva-reserva/nueva-reserva-form.tsx
git commit -m "feat(profesional): el buscador de horarios sólo asigna a quien hace el servicio"
```

---

### Task 4: El servidor rechaza una profesional que no hace el servicio

**Files:**
- Modify: `src/app/reserva/actions.ts` (`createBooking`)

**Interfaces:**
- Consumes de Task 1: `serviceIsBookable`, `canStaffDoService`, `type StaffServiceMap`.

**Por qué:** el buscador ya no ofrece asignaciones malas, pero el cliente manda `resolvedStaff` / `serviceStaff` en el payload. El servidor es el autoritativo: **fail-closed**.

- [ ] **Step 1: Traer el mapa y validar**

En `createBooking`, **después** de resolver `services` (paso 1) y **antes** de la rama del pack, traer el mapa de los servicios pedidos (y del servicio del pack, si hay) y validar:

```ts
  // Quién hace qué (`staff_services`). El servidor es autoritativo: una
  // profesional que no hace el servicio se rechaza, aunque el payload venga
  // armado a mano.
  const { data: linkRows, error: linkMapErr } = await supabase
    .from("staff_services")
    .select("service_id, staff_id")
    .in("service_id", input.serviceIds)
  if (linkMapErr) return { ok: false, error: "No pudimos verificar la disponibilidad. Probá de nuevo." }
  const staffMap: StaffServiceMap = {}
  for (const r of (linkRows ?? []) as { service_id: string; staff_id: string }[]) {
    ;(staffMap[r.service_id] ??= []).push(r.staff_id)
  }

  // Un servicio que nadie hace no se puede reservar.
  for (const s of services) {
    if (!serviceIsBookable(s.id, staffMap))
      return { ok: false, error: `"${s.name}" no está disponible para reservar online por ahora.` }
  }

  // La profesional pedida (si pidió una) tiene que hacer ese servicio.
  for (const s of services) {
    const asked = input.resolvedStaff?.[s.id] ?? input.serviceStaff?.[s.id]
    if (asked && asked !== "auto" && !canStaffDoService(asked, s.id, staffMap))
      return { ok: false, error: `Esa profesional no realiza "${s.name}". Elegí el horario de nuevo.` }
  }
```

> **Ubicación exacta:** después del bloque que arma `computed[]` y **antes** de `if (input.packId)`. Ahí ya están `services` y `input` en alcance.
> ⚠️ **Este bloque va ANTES del descuento de puntos (paso 4b)**, así que sus `return` **no** necesitan reembolso. Verificalo: si por lo que sea quedara después, **tendría** que devolver los puntos vía `rollbackBookingAttempt` (ver el comentario del helper).

- [ ] **Step 2: El pack también**

La rama del pack usa `input.packId`, no `serviceIds`. Su servicio (`svc.id`) también tiene que ser reservable: dentro de esa rama, después de resolver `svc`, traer sus profesionales y rechazar si no hay ninguna, y rechazar `packStaffId` si no hace el servicio. Mismo mensaje y misma forma.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(profesional): el servidor rechaza a quien no hace el servicio"
```

---

### Task 5: La pantalla sólo ofrece las profesionales que hacen el servicio (+ el texto del pack)

**Files:**
- Modify: `src/app/reserva/page.tsx` (traer el mapa)
- Modify: `src/app/reserva/flow.tsx` (pasarlo)
- Modify: `src/app/reserva/screens.tsx` (`ProPicker` + el texto de la Sesión 1)

**Interfaces:**
- Consumes de Task 1: `allowedStaffFor`, `type StaffServiceMap`.
- Consumes de Task 2: `fetchStaffServices()`.

- [ ] **Step 1: El mapa llega a la pantalla**

En `src/app/reserva/page.tsx`, junto a las otras cargas (`fetchProfessionals`, `fetchCatalog`, …), llamar a `fetchStaffServices()` y pasarlo por props a `flow.tsx`, y de ahí a `Screen2DateTime` — **exactamente como ya viaja `professionals`**. Leé cómo lo hace y copiá ese camino.

- [ ] **Step 2: `ProPicker` sólo ofrece a quien hace el servicio**

En `screens.tsx`, `ProPicker` hoy hace `professionals.map(...)` para **cada** servicio: ofrece **todas**. Cambiarlo para que, por servicio, sólo liste las que lo hacen:

```tsx
                  {professionals
                    .filter((p) => allowedStaffFor(svc.id, staffServices).includes(p.id))
                    .map((p) => (
```

Aplicalo en **las dos** ramas de `ProPicker`: la de varios servicios (per-service) y la de un solo servicio (ahí el servicio es `state.services[0]`).

> El botón **"Auto"** sigue estando siempre (significa "la que esté libre", y el servidor ya sólo elige entre las que hacen el servicio). Con la regla estricta y el catálogo filtrado, **todo servicio que la clienta pueda elegir tiene al menos una profesional**, así que la lista nunca queda vacía.

- [ ] **Step 3: La Sesión 1 del pack NO es opcional**

En la rama del pack de `Screen2DateTime`, la lista de sesiones muestra `— la agendo después —` para **todas** las sesiones sin fecha, incluida la 1ª. Pero la 1ª **es obligatoria** (el botón de continuar está deshabilitado con `picked.length === 0` y dice "Elegí la fecha de la primera sesión"). El texto miente.

Reemplazar el texto vacío por uno que dependa del índice:

```tsx
                  {iso
                    ? new Date(iso).toLocaleString("es-AR", {
                        weekday: "short", day: "2-digit", month: "short",
                        hour: "2-digit", minute: "2-digit", hour12: false,
                        timeZone: "America/Argentina/Buenos_Aires",
                      })
                    : i === 0
                      ? <span style={{ color: "var(--ink-mute)" }}>— falta elegir la fecha —</span>
                      : <span style={{ color: "var(--ink-mute)" }}>— la agendo después —</span>}
```

Y en la bajada de la pantalla, el texto ya dice "Elegí al menos la primera; el resto lo podés agendar después" — **está bien, no lo toques**.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: los tres en 0.

- [ ] **Step 5: Verificación manual (obligatoria)**

En `/reserva`:
1. Elegir un servicio **facial** → en "Profesional" aparece **sólo Leri** (+ Auto).
2. Elegir un **masaje** → aparecen **sólo Roman y Marina** (+ Auto).
3. Los 9 servicios sin asignar **no aparecen** en el catálogo.
4. Un pack: la **Sesión 1** dice **"— falta elegir la fecha —"**; las demás siguen diciendo "— la agendo después —".

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/page.tsx src/app/reserva/flow.tsx src/app/reserva/screens.tsx
git commit -m "feat(profesional): la pantalla sólo ofrece a quien hace el servicio; la sesión 1 no es opcional"
```

---

### Task 6: El admin avisa qué servicios nadie hace

**Files:**
- Modify: `src/app/admin/servicios/page.tsx`

**Por qué:** con la regla estricta, un servicio sin profesional **desaparece de la reserva online**. Si eso pasa en silencio, el salón pierde turnos sin enterarse. Tiene que gritarlo.

- [ ] **Step 1: El cartel**

En la página de servicios del admin, traer las filas de `staff_services` y, **arriba de la lista**, si hay servicios activos sin ninguna profesional asignada, mostrar un aviso con **las clases que la página ya usa** (`adm-card`, etc. — leelas antes) que:
- diga claramente que **esos servicios NO se pueden reservar online**;
- **liste los nombres**;
- explique en una línea que se arregla asignándoles una profesional en el editor del servicio.

Además, en la **fila** de cada servicio de esa lista, marcar los que están sin asignar (ej: un texto chico "sin profesional · no reservable" en el color de alerta que la página ya use).

> **No inventes CSS ni clases.** Leé la página y usá lo que ya existe.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos exit 0.

- [ ] **Step 3: Verificación manual**

En `/admin/servicios`: se ve el cartel listando los 9 servicios sin profesional, y cada uno aparece marcado en su fila.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/servicios/page.tsx
git commit -m "feat(profesional): avisar en el admin qué servicios no se pueden reservar"
```

---

### Task 7: Verificación final y deploy

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet
```
Expected: tsc 0 · vitest **91 + 13 = 104** verdes · build 0 · eslint **16** (baseline de main; 0 nuevos).

- [ ] **Step 2: Recorrido end-to-end**

1. **Reserva pública**: un facial sólo ofrece a Leri; un masaje sólo a Roman/Marina.
2. **"Auto"** en un facial nunca cae en Roman (mirar `staff_id` del turno creado).
3. Los **9 servicios sin asignar** no aparecen en el catálogo, ni sueltos, ni en un combo, ni en un pack.
4. **Payload a mano** con una profesional que no hace el servicio → **rechazado** por el servidor.
5. **Admin → Nueva reserva**: sigue pudiendo cargar **cualquier** servicio con **cualquier** profesional (la regla no aplica).
6. **Admin → Servicios**: el cartel lista los 9.
7. **Packs, combos, "juntos" y "separados"**: siguen funcionando.

- [ ] **Step 3: Deploy (lo hace la controladora)**

No hay migración: se pushea el código a `main`.

---

## Notas de riesgo

- **Esto toca el corazón del buscador de horarios**, que es el camino de ingresos principal. Cualquier error acá se traduce en "no hay horarios" para todo el mundo. El fallo de la query de `staff_services` es **fail-closed a propósito** (mejor no ofrecer que ofrecer mal), y por eso se loguea.
- **9 servicios dejan de ser reservables online al desplegar.** Es la decisión tomada, pero hay que avisarle a la usuaria en el momento del deploy, y el cartel del admin existe para eso.
- **Varios de esos 9 parecen duplicados** de servicios que sí están asignados ("Descontracturante" vs "Masaje descontracturante (…)"; "Drenaje Linfatico Manual" vs "Drenaje linfático manual"). Eso es un tema de datos de la usuaria, no de código.
