# "Tus turnos" unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar la reserva en una sola sección "Tus turnos" (pantalla de fecha + confirmación) y corregir el bug de visualización donde los servicios encadenados se muestran en `T` (arranque de la visita) en vez de `T + D_pack`.

**Architecture:** Extraer el cálculo de horarios de la cadena "juntos" a un módulo PURO y testeado (`src/lib/servicios/visit-timeline.ts`), usarlo en la confirmación (`Screen5Confirm`) para que lo que se **muestra** coincida exactamente con lo que `pay()` **reserva** (`startsAt`), y reordenar la pantalla de fecha mezclada (`Screen2DateTime`) en una única sección "Tus turnos". Todo el cambio es presentacional salvo la corrección del horario mostrado.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Vitest (sólo para módulos puros de `src/lib/servicios/`).

## Global Constraints

Copiadas verbatim de la spec (`docs/superpowers/specs/2026-07-14-tus-turnos-unificado-design.md`). Todas las tareas las heredan:

- **Presentacional.** NO se toca `createBooking`, el payload de `pay()`, la lógica de encadenado, `packSlots`/`serviceSlots`, ni la plata. La reserva ya es correcta.
- **La regla del cálculo:** el arranque del bloque de servicios que se **muestra** tiene que ser **el mismo** que el que `pay()` **manda** (`startsAt`): `T` sin encadenado, **`T + D_pack`** encadenado. Hoy la confirmación usa `selectedTime` (`T`) siempre — ahí está el bug.
- **Byte-idéntico** para: pack solo, servicios solos (juntos y separados), combo, mezcla-separados, y servicios-juntos-sin-pack (encadenado falso → `T + 0 = T`). Sólo cambia lo que se muestra en el caso encadenado (mezcla + juntos + pack).
- Copy en español. Sin migración nueva. Sin cambios en el servidor.
- `D_pack` mostrado = `packDurationMin` (Screen2/Screen5): `per_zone` → suma de las duraciones de las zonas elegidas; `fixed` → `serviceDurationMin`. Es la MISMA fuente que ya usa `pay()`.

**Definiciones de referencia (ya existen en el código, NO crear):**
- `chainPackFirst` (gate del encadenado) — definido en `Screen2DateTime` (~línea 705) y recalculado idéntico en `Screen5Confirm` (~línea 2279). `true` sólo cuando: hay pack Y servicios sueltos, modo normalizado "juntos", el pack tiene `serviceId`, y ese `serviceId` NO está entre los servicios sueltos.
- `packDurationMin` — definido en ambos componentes.
- `effective(s)` en `Screen5Confirm` (~línea 2249) y `effectiveService(s, zoneSel)` en `Screen2DateTime` (~línea 61, top-level) — precio/duración efectivos de un servicio.
- `combineDateTime(ymd, "HH:MM"): Date`, `parseYmd`, `fmtDuration`, `fmtPrice` — de `./data`.
- `arPartsFromUtc(date): { dateStr, timeStr }` — de `@/lib/servicios/pack-sessions`.
- `DOW_NAMES`, `MONTH_NAMES` — constantes en `screens.tsx`.
- `Service` type — ya importado en `screens.tsx`.

---

### Task 1: Módulo puro de horarios de la visita (`visit-timeline.ts`)

**Files:**
- Create: `src/lib/servicios/visit-timeline.ts`
- Test: `src/lib/servicios/visit-timeline.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sin dependencias).
- Produces:
  - `addMinutesHM(hm: string, add: number): string` — suma `add` minutos a un horario `"HH:MM"`. `add === 0` devuelve el mismo string (identidad).
  - `sequentialStartTimes(startHM: string, durations: number[]): string[]` — dado el arranque `"HH:MM"` y las duraciones en orden, el horario de inicio `"HH:MM"` de cada ítem (el primero arranca en `startHM`, cada siguiente cuando termina el anterior; cadena sin huecos).

- [ ] **Step 1: Write the failing tests**

Crear `src/lib/servicios/visit-timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { addMinutesHM, sequentialStartTimes } from "./visit-timeline"

describe("addMinutesHM", () => {
  it("suma 0 -> el mismo horario (identidad: el caso NO encadenado queda byte-idéntico)", () => {
    expect(addMinutesHM("13:00", 0)).toBe("13:00")
    expect(addMinutesHM("09:05", 0)).toBe("09:05")
  })

  it("suma la duración del pack -> el bloque de servicios arranca después de la 1ª sesión", () => {
    expect(addMinutesHM("13:00", 20)).toBe("13:20")
  })

  it("cruza la hora en punto", () => {
    expect(addMinutesHM("13:50", 20)).toBe("14:10")
  })

  it("mantiene el cero a la izquierda en horas y minutos", () => {
    expect(addMinutesHM("08:00", 5)).toBe("08:05")
    expect(addMinutesHM("08:03", 2)).toBe("08:05")
  })
})

describe("sequentialStartTimes", () => {
  it("cadena sin huecos: cada ítem arranca cuando termina el anterior", () => {
    expect(sequentialStartTimes("13:20", [50, 60])).toEqual(["13:20", "14:10"])
  })

  it("un solo ítem arranca en el inicio", () => {
    expect(sequentialStartTimes("13:00", [30])).toEqual(["13:00"])
  })

  it("sin ítems -> lista vacía", () => {
    expect(sequentialStartTimes("13:00", [])).toEqual([])
  })

  it("el primer ítem SIEMPRE arranca exactamente en el inicio (no suma su propia duración antes)", () => {
    expect(sequentialStartTimes("10:00", [15, 15, 15])).toEqual(["10:00", "10:15", "10:30"])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- visit-timeline`
Expected: FAIL — no se puede resolver el import `./visit-timeline` (el módulo no existe todavía).

- [ ] **Step 3: Write the module**

Crear `src/lib/servicios/visit-timeline.ts`:

```ts
/**
 * Horarios de una visita "juntos" de la reserva, como texto "HH:MM". PURO
 * (sin fecha real ni zona horaria): trabaja en minutos de reloj de pared
 * desde un arranque "HH:MM", exactamente como el resumen de confirmación lo
 * hacía inline. Se extrae acá para (1) tener UNA sola fuente del cálculo que
 * la pantalla de fecha, el resumen y el servidor tienen que mostrar igual, y
 * (2) poder testearlo: el bug que corrige esto era mostrar los servicios
 * encadenados en el arranque de la visita (T) en vez de después de la 1ª
 * sesión del pack (T + D_pack).
 */

const toMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number)
  return h * 60 + m
}

const fmtHM = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`

/**
 * Suma `add` minutos a un horario "HH:MM". `add === 0` devuelve el mismo
 * horario tal cual (identidad byte a byte: el caso NO encadenado no puede
 * cambiar). No aplica módulo de 24h a propósito: si la cadena cruzara
 * medianoche devuelve "25:30", igual que el cálculo inline que reemplaza
 * (el salón no agenda cadenas que crucen el día; mantener la MISMA conducta).
 */
export function addMinutesHM(hm: string, add: number): string {
  return fmtHM(toMinutes(hm) + add)
}

/**
 * Dado el arranque "HH:MM" y las duraciones (min) de cada ítem EN ORDEN, el
 * horario de inicio de cada ítem: el primero arranca en `startHM`, cada
 * siguiente cuando termina el anterior (cadena sin huecos, igual que arma el
 * servidor). Devuelve un "HH:MM" por cada duración recibida.
 */
export function sequentialStartTimes(startHM: string, durations: number[]): string[] {
  let mins = toMinutes(startHM)
  return durations.map((d) => {
    const t = fmtHM(mins)
    mins += d
    return t
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- visit-timeline`
Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/visit-timeline.ts src/lib/servicios/visit-timeline.test.ts
git commit -m "feat(reserva): módulo puro de horarios de la visita (addMinutesHM, sequentialStartTimes)"
```

---

### Task 2: Confirmación — unificar "CUÁNDO" y corregir los horarios encadenados

**Files:**
- Modify: `src/app/reserva/screens.tsx` (componente `Screen5Confirm`): el import (~línea 25), `orderedItems` (~líneas 2332-2345), y el bloque "Cuándo" (~líneas 2536-2583). Se agrega `chainedOrdered` junto a `orderedItems`.

**Interfaces:**
- Consumes (de Task 1): `addMinutesHM(hm, add)`, `sequentialStartTimes(startHM, durations)`.
- Produces: nada que otras tareas consuman (cambio contenido en `Screen5Confirm`).

**Contexto:** El bug: `orderedItems` (bloque "QUÉ") y la línea de servicios de "CUÁNDO" calculan los horarios desde `state.selectedTime` (`T`), pero con encadenado `pay()` reserva los servicios en `T + packDurationMin`. Además la spec pide unificar "CUÁNDO" en una sola secuencia para el caso encadenado. Los caminos NO encadenados quedan byte-idénticos.

- [ ] **Step 1: Agregar el import del módulo puro**

Debajo de la línea `import { arPartsFromUtc, minStartForNextSession } from "@/lib/servicios/pack-sessions"` (~línea 25), agregar:

```ts
import { addMinutesHM, sequentialStartTimes } from "@/lib/servicios/visit-timeline"
```

- [ ] **Step 2: Reescribir `orderedItems` para respetar el offset del encadenado**

Reemplazar el bloque actual (~líneas 2332-2345):

```tsx
  const orderedItems = (() => {
    if (!isMultiResolved || !state.serviceOrder || !state.selectedTime) return []
    const [hh, mm] = state.selectedTime.split(":").map(Number)
    let mins = hh * 60 + mm
    return state.serviceOrder.map((id) => {
      const svc = services.find((s) => s.id === id)
      const staffId = state.resolvedStaff?.[id]
      const assignedPro = professionals.find((p) => p.id === staffId)
      const h = Math.floor(mins / 60), m = mins % 60
      const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      if (svc) mins += effective(svc).duration
      return { svc, assignedPro, startTime }
    }).filter((x): x is { svc: Service; assignedPro: Professional | undefined; startTime: string } => !!x.svc)
  })()
```

por:

```tsx
  const orderedItems = (() => {
    if (!isMultiResolved || !state.serviceOrder || !state.selectedTime) return []
    // Con encadenado, el bloque de servicios sueltos arranca DESPUÉS de la 1ª
    // sesión del pack (T + D_pack) — el MISMO arranque que pay() manda en
    // `startsAt`. Sin encadenado el offset es 0 (byte-idéntico a antes).
    const base = addMinutesHM(state.selectedTime, chainPackFirst ? packDurationMin : 0)
    const items = state.serviceOrder
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const starts = sequentialStartTimes(base, items.map((s) => effective(s).duration))
    return items.map((svc, i) => ({
      svc,
      assignedPro: professionals.find((p) => p.id === state.resolvedStaff?.[svc.id]),
      startTime: starts[i],
    }))
  })()
```

**Nota de equivalencia (para el revisor):** el nuevo `orderedItems` produce, para el caso NO encadenado (offset 0), exactamente los mismos `{ svc, assignedPro, startTime }` que el anterior: el primer ítem arranca en `selectedTime`, cada siguiente suma la duración del anterior, y un `id` sin servicio se descarta (antes emitía un ítem con `svc` undefined que el `.filter` sacaba, sin avanzar `mins`; ahora se filtra antes, sin contar su duración — 0 en ambos casos). El `assignedPro` se resuelve con `svc.id` (idéntico al `id` del `serviceOrder`).

- [ ] **Step 3: Agregar `chainedOrdered` (la secuencia de servicios del caso encadenado, con o sin `isMultiResolved`)**

Inmediatamente DESPUÉS del bloque `orderedItems` (recién reescrito), agregar:

```tsx
  // Encadenado: los servicios sueltos como secuencia, arrancando en T + D_pack
  // (el MISMO arranque que pay() reserva). A diferencia de `orderedItems`,
  // existe también con UN solo servicio suelto (ahí `isMultiResolved` es false
  // y `orderedItems` queda vacío). Misma fuente pura, así "QUÉ" y "CUÁNDO"
  // nunca discrepan.
  const chainedOrdered = (() => {
    if (!chainPackFirst || !state.selectedTime) return []
    const items = (state.serviceOrder ?? services.map((s) => s.id))
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const starts = sequentialStartTimes(
      addMinutesHM(state.selectedTime, packDurationMin),
      items.map((s) => effective(s).duration)
    )
    return items.map((svc, i) => ({ svc, startTime: starts[i] }))
  })()
```

- [ ] **Step 4: Unificar el bloque "Cuándo"**

En el `<div className="summary__value" style={separados ? { flex: 1, marginLeft: 16 } : undefined}>` del row "Cuándo" (~línea 2538), envolver el contenido actual en una condición por `chainPackFirst`. Reemplazar el contenido interno actual:

```tsx
            {pack && (
              <div style={{ marginBottom: services.length > 0 ? 10 : 0 }}>
                {packSlotsForDisplay.map((iso, i) => {
                  const parts = arPartsFromUtc(new Date(iso))
                  const d = parseYmd(parts.dateStr)
                  const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                  return (
                    <div key={iso} style={{ marginBottom: i < packSlotsForDisplay.length - 1 ? 6 : 0 }}>
                      <strong>Sesión {i + 1}</strong>
                      <small>
                        {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)}
                      </small>
                    </div>
                  )
                })}
                {pack.pack.sessions > packSlotsForDisplay.length && (
                  <small>
                    {`${pack.pack.sessions - packSlotsForDisplay.length} sesión${pack.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} a agendar después`}
                  </small>
                )}
              </div>
            )}
            {services.length > 0 && (
              separados ? (
                services.map((s) => {
                  const iso = state.serviceSlots?.[s.id]
                  return (
                    <div key={s.id} className="breakdown__row">
                      <span>{s.name}</span>
                      <span>{iso ? fmtSlotAR(iso) : "—"}</span>
                    </div>
                  )
                })
              ) : (
                <div>
                  {dow} {dateObj && dateObj.getDate()} de{" "}
                  {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
                  <small>
                    {displayTime}hs · {fmtDuration(servicesTotalMin)}
                  </small>
                </div>
              )
            )}
```

por (el `else` es EXACTAMENTE el código de arriba, sin cambios; sólo se agrega la rama `chainPackFirst`):

```tsx
            {chainPackFirst ? (
              // UNA sola secuencia: 1ª sesión del pack en T, los servicios
              // sueltos pegados desde T + D_pack (el MISMO arranque que pay()
              // reserva), y debajo las sesiones 2..N del pack (agendadas o
              // "a agendar después"). Antes se mostraban en dos bloques y los
              // servicios arrancaban en T → parecían encimados con la sesión 1.
              <div>
                <div style={{ marginBottom: chainedOrdered.length > 0 ? 6 : 0 }}>
                  <strong>Sesión 1 · {pack!.pack.name}</strong>
                  <small>
                    {dow} {dateObj && dateObj.getDate()} de{" "}
                    {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()} · {displayTime}hs · {fmtDuration(packDurationMin)}
                  </small>
                </div>
                {chainedOrdered.map(({ svc, startTime }, i) => (
                  <div key={svc.id} style={{ marginBottom: i < chainedOrdered.length - 1 ? 6 : 0 }}>
                    {svc.name}
                    <small>{startTime}hs · {fmtDuration(effective(svc).duration)}</small>
                  </div>
                ))}
                {packSlotsForDisplay.slice(1).map((iso, i) => {
                  const parts = arPartsFromUtc(new Date(iso))
                  const d = parseYmd(parts.dateStr)
                  const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                  return (
                    <div key={iso} style={{ marginTop: 6 }}>
                      <strong>Sesión {i + 2}</strong>
                      <small>
                        {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)}
                      </small>
                    </div>
                  )
                })}
                {pack!.pack.sessions > packSlotsForDisplay.length && (
                  <small style={{ display: "block", marginTop: 6 }}>
                    {`${pack!.pack.sessions - packSlotsForDisplay.length} sesión${pack!.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} del pack a agendar después`}
                  </small>
                )}
              </div>
            ) : (
              <>
                {pack && (
                  <div style={{ marginBottom: services.length > 0 ? 10 : 0 }}>
                    {packSlotsForDisplay.map((iso, i) => {
                      const parts = arPartsFromUtc(new Date(iso))
                      const d = parseYmd(parts.dateStr)
                      const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                      return (
                        <div key={iso} style={{ marginBottom: i < packSlotsForDisplay.length - 1 ? 6 : 0 }}>
                          <strong>Sesión {i + 1}</strong>
                          <small>
                            {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)}
                          </small>
                        </div>
                      )
                    })}
                    {pack.pack.sessions > packSlotsForDisplay.length && (
                      <small>
                        {`${pack.pack.sessions - packSlotsForDisplay.length} sesión${pack.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} a agendar después`}
                      </small>
                    )}
                  </div>
                )}
                {services.length > 0 && (
                  separados ? (
                    services.map((s) => {
                      const iso = state.serviceSlots?.[s.id]
                      return (
                        <div key={s.id} className="breakdown__row">
                          <span>{s.name}</span>
                          <span>{iso ? fmtSlotAR(iso) : "—"}</span>
                        </div>
                      )
                    })
                  ) : (
                    <div>
                      {dow} {dateObj && dateObj.getDate()} de{" "}
                      {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
                      <small>
                        {displayTime}hs · {fmtDuration(servicesTotalMin)}
                      </small>
                    </div>
                  )
                )}
              </>
            )}
```

- [ ] **Step 5: Typecheck, lint y tests**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores nuevos en `src/app/reserva/screens.tsx`.

Run: `npm test`
Expected: toda la suite verde (incluye `visit-timeline` de Task 1; ningún otro test toca `screens.tsx`).

- [ ] **Step 6: Verificación manual (leer el diff y trazar)**

Verificar por lectura del diff (no hay test de componente):
1. **Encadenado (pack + servicios, juntos):** en "CUÁNDO", "Sesión 1 · {pack}" en `T`, y cada servicio en `T + D_pack`, `T + D_pack + d1`, … El primer servicio NO arranca en `T` (bug corregido). El horario del primer servicio mostrado == `startsAt` que arma `pay()` (`T + packDurationMin`).
2. **QUÉ (encadenado, 2+ servicios):** los `startTime` de `orderedItems` ahora arrancan en `T + D_pack` (coinciden con "CUÁNDO").
3. **Byte-idéntico** (rama `else`, sin tocar): pack solo, servicios solos juntos, separados (con o sin pack), combo. Confirmar que el bloque `else` es idéntico carácter a carácter al original.
4. **Sesiones 2..N del pack** agendadas: aparecen como "Sesión 2", "Sesión 3"… con su fecha; el conteo "a agendar después" = `sessions - packSlotsForDisplay.length`.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "fix(reserva): confirmación muestra los servicios encadenados en T+D_pack y unifica CUÁNDO"
```

---

### Task 3: Pantalla de fecha — unificar la mezcla en una sola sección "Tus turnos"

**Files:**
- Modify: `src/app/reserva/screens.tsx` (componente `Screen2DateTime`): `PackSessionsSection` (~líneas 1340-1399), `ServiceDatesSection` (~líneas 1409-1474), `MixedBody` (~líneas 1478-1492). Se agregan los helpers `PackSessionRows`, `ServiceDateRows`, `VisitPreview`.

**Interfaces:**
- Consumes (de Task 1, ya importado en Task 2): `addMinutesHM`, `sequentialStartTimes`. **El import ya existe** (agregado en Task 2, Step 1) — no volver a agregarlo.
- Produces: nada que otras tareas consuman.

**Contexto:** Hoy la mezcla (pack + servicios sueltos) muestra dos secciones con dos títulos: "Tus sesiones" (del pack) y "Tus servicios". La usuaria quiere UNA sola "Tus turnos", conservando el elegir "juntos" vs "separados". El pack-solo (`ListBody`) y el separados-standalone (`SepBody`) NO cambian de aspecto. `chainPackFirst`, `packDurationMin`, `packPicked`, `serviceSlots`, `pack`, `mixed`, `bookingMode`, `zoneSel`, `effectiveService`, `setPickingIdx`, `setPickingServiceId`, `clearPackFrom`, `separateOverlap` ya están en scope de `Screen2DateTime`.

- [ ] **Step 1: Extraer `PackSessionRows` (las filas de sesiones) de `PackSessionsSection`**

`PackSessionsSection` (~línea 1340) es hoy: `<h1>Tus sesiones</h1>` + `<p class="lede">` + el `<div>` con las filas. Extraer las filas a un helper con un flag opcional para saltar la sesión 1 en el encadenado (cuando la muestra `VisitPreview`). Reemplazar todo el bloque `const PackSessionsSection = () => { ... }`:

```tsx
  // Las filas de sesiones del pack. `skipFirstInChain` saltea la sesión 1
  // cuando el encadenado la muestra en `VisitPreview` (así no se duplica); en
  // el flujo "sólo pack" se llama sin flag y muestra las N.
  const PackSessionRows = ({ skipFirstInChain = false }: { skipFirstInChain?: boolean } = {}) => {
    if (!pack) return null
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
        {Array.from({ length: pack.sessions }).map((_, i) => {
          if (skipFirstInChain && chainPackFirst && i === 0) return null
          const iso = packPicked[i]
          const blocked = i > 0 && !packPicked[i - 1]   // no se puede elegir la 3ª sin la 2ª
          return (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, padding: "10px 12px", border: "1px solid var(--line)",
                borderRadius: 10, opacity: blocked ? 0.45 : 1,
              }}
            >
              {i === 0 && chainPackFirst ? (
                <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                  {state.selectedDate && state.selectedTime
                    ? `${fmtSlotAR(combineDateTime(state.selectedDate, state.selectedTime).toISOString())} · en esta visita`
                    : "— elegí el horario de la visita —"}
                </span>
              ) : (
                <>
                  <span style={{ fontSize: 13 }}>
                    <strong>Sesión {i + 1}</strong>{" "}
                    {iso
                      ? new Date(iso).toLocaleString("es-AR", {
                          weekday: "short", day: "2-digit", month: "short",
                          hour: "2-digit", minute: "2-digit", hour12: false,
                          timeZone: "America/Argentina/Buenos_Aires",
                        })
                      : i === 0
                        ? <span style={{ color: "var(--ink-mute)" }}>— falta elegir la fecha —</span>
                        : <span style={{ color: "var(--ink-mute)" }}>— la agendo después —</span>}
                  </span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className="btn" disabled={blocked} onClick={() => setPickingIdx(i)}>
                      {iso ? "Cambiar" : "Elegir fecha"}
                    </button>
                    {iso && i > 0 && (
                      <button className="btn" onClick={() => clearPackFrom(i)}>Quitar</button>
                    )}
                  </span>
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Flujo "sólo pack": título + lede + las N filas (sin saltar ninguna).
  const PackSessionsSection = () => {
    if (!pack) return null
    return (
      <>
        <h1 className="headline">Tus <em>sesiones</em></h1>
        <p className="lede">
          {pack.name} · {pack.sessions} sesiones. Elegí al menos la primera; el resto lo podés
          agendar después.
        </p>
        {PackSessionRows()}
      </>
    )
  }
```

- [ ] **Step 2: Extraer `ServiceDateRows` y dejar `ServiceDatesSection` sólo para "separados" standalone**

`ServiceDatesSection` (~línea 1409) tiene hoy una rama `juntos` (usada SÓLO por la mezcla) y una rama `separados` (usada por la mezcla y por el standalone). La mezcla dejará de llamarla (Step 4), así que la rama `juntos` queda muerta y se elimina; la rama `separados` queda para `SepBody`. Extraer sus filas a `ServiceDateRows`. Reemplazar todo el bloque `const ServiceDatesSection = () => { ... }`:

```tsx
  // Las filas de servicios sueltos (una fecha por servicio, modo "separados").
  // Compartidas entre la mezcla (MixedBody) y el standalone (SepBody).
  const ServiceDateRows = () => (
    <>
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

      {!separateOverlap.ok && (
        <p style={{ fontSize: 12, color: "#8c463c", margin: "0 0 8px" }}>{separateOverlap.error}</p>
      )}
    </>
  )

  // Standalone "separados" (sin pack): título "Tus turnos" + modo + profesional
  // + filas. La mezcla NO pasa por acá (arma su propia sección unificada).
  const ServiceDatesSection = () => (
    <>
      <h1 className="headline">Tus <em>turnos</em></h1>
      <p className="lede">Elegí la fecha de cada servicio.</p>

      {ModeChooser()}
      {ProPicker()}
      {ServiceDateRows()}
    </>
  )
```

**Nota (para el revisor):** en el standalone separados, `mixed` es `false`, así que el `{!mixed && ProPicker()}` original equivalía a `ProPicker()`. Se simplifica a `ProPicker()` porque esta función ya no se usa desde la mezcla.

- [ ] **Step 3: Agregar `VisitPreview` (lo que entra en la visita encadenada, en orden)**

Agregar, cerca de `PackSessionRows`/`ServiceDateRows` (antes del `if (mixed && ...)` de la línea ~1477):

```tsx
  // Encadenado: lo que entra en la visita, en orden — la 1ª sesión del pack
  // primero, después los servicios sueltos. Antes de elegir horario, sin las
  // horas; con horario elegido, cada uno en T / T + D_pack / … (la MISMA
  // cuenta que arma pay() y que muestra la confirmación).
  const VisitPreview = () => {
    if (!chainPackFirst || !pack) return null
    const orderedLoose = (state.serviceOrder ?? state.services.map((s) => s.id))
      .map((id) => state.services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const times = state.selectedTime
      ? sequentialStartTimes(
          addMinutesHM(state.selectedTime, packDurationMin),
          orderedLoose.map((s) => effectiveService(s, zoneSel).duration)
        )
      : null
    return (
      <div style={{ margin: "20px 0 0" }}>
        <p className="eyebrow">En esta visita</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6, fontSize: 13 }}>
          <div>
            <strong>Sesión 1 · {pack.name}</strong>
            {state.selectedTime ? ` · ${state.selectedTime}hs` : ""}
          </div>
          {orderedLoose.map((svc, i) => (
            <div key={svc.id}>
              {svc.name}
              {times ? ` · ${times[i]}hs` : ""}
            </div>
          ))}
        </div>
      </div>
    )
  }
```

- [ ] **Step 4: Reescribir `MixedBody` como una sola sección "Tus turnos"**

Reemplazar el bloque `const MixedBody = () => ( ... )` actual (~líneas 1478-1492):

```tsx
    const MixedBody = () => (
      <>
        {/* La profesional PRIMERO: filtra los horarios, así que elegirla antes
            evita elegir fechas y perderlas al cambiar de profesional. */}
        {ProPicker()}
        {PackSessionsSection()}
        <div style={{ marginTop: 28 }}>{ServiceDatesSection()}</div>
        {/* Misma regla y mismo estilo que el error de superposición de la
            pantalla "separados" (`separateOverlap`, en `ServiceDatesSection`)
            — acá es entre las sesiones del pack y los servicios sueltos. */}
        {!mixedOverlap.ok && (
          <p style={{ fontSize: 12, color: "#8c463c", margin: "16px 0 0" }}>{mixedOverlap.error}</p>
        )}
      </>
    )
```

por:

```tsx
    const MixedBody = () => (
      <>
        <h1 className="headline">Tus <em>turnos</em></h1>
        <p className="lede">
          {bookingMode === "separados"
            ? "Elegí la fecha de cada servicio y de cada sesión del pack."
            : "Elegí el horario de la visita: la primera sesión del pack y tus servicios van uno tras otro. Las demás sesiones del pack las agendás cuando quieras."}
        </p>
        {ModeChooser()}
        {/* La profesional PRIMERO: filtra los horarios, así que elegirla antes
            evita elegir fechas y perderlas al cambiar de profesional. */}
        {ProPicker()}

        {bookingMode === "separados" ? (
          <>
            {/* Cada uno en su fecha: todas las sesiones del pack y todos los
                servicios, cada uno con su propia fecha, bajo un solo título. */}
            <p className="eyebrow" style={{ marginTop: 20 }}>Sesiones del pack</p>
            {PackSessionRows()}
            <p className="eyebrow" style={{ marginTop: 20 }}>Servicios</p>
            {ServiceDateRows()}
          </>
        ) : (
          <>
            {/* El mismo día, uno tras otro: se elige UN horario (la visita);
                la 1ª sesión del pack queda pegada a los servicios. */}
            {Cal()}
            {Slots()}
            {VisitPreview()}
            {/* Las sesiones 2..N del pack (opcionales acá): la 1ª ya va fijada
                al horario de la visita, la muestra VisitPreview. */}
            {chainPackFirst && pack && pack.sessions > 1 && (
              <p className="eyebrow" style={{ marginTop: 20 }}>Las demás sesiones del pack</p>
            )}
            {PackSessionRows({ skipFirstInChain: true })}
          </>
        )}

        {!mixedOverlap.ok && (
          <p style={{ fontSize: 12, color: "#8c463c", margin: "16px 0 0" }}>{mixedOverlap.error}</p>
        )}
      </>
    )
```

**Nota (para el revisor):** en juntos NO encadenado (caso borde: el `serviceId` del pack también está entre los sueltos → `chainPackFirst === false`) `VisitPreview` devuelve `null`, el subtítulo "Las demás sesiones" no aparece, y `PackSessionRows({ skipFirstInChain: true })` NO saltea nada (el guard exige `chainPackFirst`), así que muestra las N filas normales con "Elegir fecha" — misma conducta que hoy. `Cal`/`Slots` siguen pidiendo el horario de los servicios.

- [ ] **Step 5: Typecheck, lint y tests**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores nuevos en `src/app/reserva/screens.tsx` (en particular, sin `ServiceDatesSection`/`PackSessionsSection` sin usar — `ServiceDatesSection` la usa `SepBody`, `PackSessionsSection` la usa `ListBody`).

Run: `npm test`
Expected: toda la suite verde.

- [ ] **Step 6: Verificación manual (leer el diff y trazar los caminos)**

1. **Mezcla, juntos (encadenado):** un solo título "Tus turnos"; orden: título → lede → ModeChooser → ProPicker → calendario/horarios → "En esta visita" (Sesión 1 + servicios en orden; con horario, con las horas T / T+D_pack) → "Las demás sesiones del pack" (filas 2..N). NO aparece "Tus sesiones" ni "Tus servicios".
2. **Mezcla, separados:** un solo título "Tus turnos"; ModeChooser → ProPicker → "Sesiones del pack" (N filas con "Elegir fecha") → "Servicios" (filas con "Elegir fecha"). Se pueden agendar todas las sesiones y todos los servicios.
3. **Pack solo (`ListBody`):** sin cambios — sigue diciendo "Tus sesiones" con las N filas (llama `PackSessionsSection`, que usa `PackSessionRows()` sin flag).
4. **Servicios solos, separados (`SepBody`):** sin cambios — "Tus turnos" + ModeChooser + ProPicker + filas (llama `ServiceDatesSection`, que usa `ServiceDateRows()`).
5. **Servicios solos, juntos (standalone):** sin cambios — usa el camino inline "¿Cuándo te esperamos?" (no toca ninguna de estas funciones).
6. **Footer/validación:** `packReady`/`servicesReady`/`mixedOverlap` sin cambios; el botón "Continuar" se habilita igual que antes.
7. **Caso borde (pack.serviceId entre los sueltos, juntos):** `VisitPreview` null, sin subtítulo "Las demás sesiones", `PackSessionRows` muestra las N filas normales.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(reserva): pantalla de fecha unificada en una sola sección 'Tus turnos'"
```

---

## Self-Review

**1. Spec coverage:**
- Bug de visualización (servicios encadenados en T en vez de T+D_pack) → Task 1 (cálculo puro) + Task 2 (`orderedItems` + "CUÁNDO"). ✓
- Una sola sección "Tus turnos" en la pantalla de fecha → Task 3. ✓
- Confirmación "CUÁNDO" unificada en una secuencia con horarios correctos → Task 2. ✓
- Conservar juntos/separados → Task 3 (ModeChooser en ambos MixedBody). ✓
- Juntos con pack: sólo la 1ª sesión en la visita → Task 3 (`VisitPreview` + `skipFirstInChain`). ✓
- Separados: todas las sesiones y servicios con su fecha → Task 3 (rama separados). ✓
- Byte-idéntico para pack solo / servicios solos / combo / separados / juntos-sin-pack → ramas `else` intactas (Task 2) y funciones no tocadas (`ListBody`, `SepBody`, camino inline) (Task 3). ✓
- Lo mostrado == lo reservado (`startsAt`) → misma fuente pura `sequentialStartTimes(addMinutesHM(T, D_pack), …)` que replica `T + packDurationMin`. ✓

**2. Placeholder scan:** sin TODO/TBD; todo el código está completo y transcrito.

**3. Type consistency:** `addMinutesHM(hm, add)` y `sequentialStartTimes(startHM, durations)` se definen en Task 1 y se usan con esas firmas en Tasks 2 y 3. `chainedOrdered`/`orderedItems` devuelven `{ svc, startTime }`/`{ svc, assignedPro, startTime }`. `PackSessionRows({ skipFirstInChain })`, `ServiceDateRows()`, `VisitPreview()` — nombres consistentes entre su definición y su uso en `MixedBody`.
