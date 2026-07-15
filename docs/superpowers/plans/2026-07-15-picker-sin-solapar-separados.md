# El selector no ofrece horarios que se pisen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el modo "cada uno en su fecha" (separados), el selector muestra en gris (con el motivo) los horarios que se pisarían con algo que la clienta ya eligió ese día, en vez de ofrecerlos y rebotarlos con el cartel rojo después.

**Architecture:** Extraer la regla de solapamiento a un módulo PURO y testeado (`src/lib/servicios/slot-overlap.ts`). El componente `PackSessionPicker` gana una prop opcional `blockedIntervals`; con ella, dibuja en gris los horarios pisados (tooltip + leyenda con el motivo). Los dos call sites en `screens.tsx` arman esa lista con los turnos que la clienta ya eligió. Todo es presentacional.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Vitest (sólo módulos puros de `src/lib/servicios/`).

## Global Constraints

Copiadas de la spec (`docs/superpowers/specs/2026-07-15-picker-sin-solapar-separados-design.md`). Todas las tareas las heredan:

- **Presentacional.** No se toca `createBooking`, `pay()`, el payload, la plata, ni el modo "juntos". Es un filtro sobre horarios que el servidor ya devolvió.
- **La regla del solapamiento es ESTRICTA — pegados NO cuentan como pisado** (fin == inicio está permitido), IDÉNTICA a `validateSeparateSlots` (`src/lib/servicios/multi-booking.ts:69`, `cur.startsAtMs < prevEnd`) y a `crossOverlapCheck`. Si el gris fuera más estricto se ocultarían horarios válidos; si fuera menos, colaría un pisado.
- **La prop nueva de `PackSessionPicker` es OPCIONAL.** Sin pasarla (o `[]`), el componente se comporta **idéntico a hoy** — el uso desde el admin (`pack-sessions.tsx`, `serviceId: null`) NO se toca ni cambia.
- **Qué cuenta como ocupado:** la agenda de la clienta ese día (vale aunque lo haga otra profesional). Selector de servicio X → los demás servicios elegidos + todas las sesiones del pack. Selector de sesión del pack → todos los servicios (el solapamiento sesión-vs-sesión ya lo evita `minForPackSession`).
- **El motivo:** servicio → su nombre (*"Ya tenés Masaje relajante a esta hora"*); sesión del pack → `${pack.name} (pack)` (*"Ya tenés Vela Slim (pack) a esta hora"*).
- **El cartel rojo `validateSeparateSlots` se queda** como red de seguridad final. No se toca.

**Definiciones de referencia (ya existen, NO crear):**
- `PackSessionPicker` — `src/app/reserva/_components/pack-session-picker.tsx`. Ya importa `slotToUtcMs` (de `./data`) y `arPartsFromUtc` (de `@/lib/servicios/pack-sessions`, devuelve `{ dateStr, timeStr }`).
- `slotToUtcMs(dateStr, "HH:MM"): number` — ms UTC de un horario de la grilla.
- `effectiveService(s, zoneSel).duration` — duración (min) efectiva de un servicio (`screens.tsx:62`, top-level).
- `packDurationMin`, `packPicked` (string[] ISO), `pack` (`Pack | null`), `serviceSlots` (Record<id, iso>), `state.services`, `zoneSel` — todas en scope de `Screen2DateTime`.

---

### Task 1: Módulo puro de solapamiento (`slot-overlap.ts`)

**Files:**
- Create: `src/lib/servicios/slot-overlap.ts`
- Test: `src/lib/servicios/slot-overlap.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces:
  - `type BlockedInterval = { startMs: number; endMs: number; name: string }`
  - `overlappingBlock(startMs: number, durationMin: number, blocked: BlockedInterval[]): BlockedInterval | null` — si el tramo `[startMs, startMs+durationMin*60000)` se pisa con algún bloqueado, devuelve el PRIMERO (para el motivo); si no, `null`. Solapamiento estricto (pegados no cuentan).

- [ ] **Step 1: Write the failing tests**

Crear `src/lib/servicios/slot-overlap.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { overlappingBlock, type BlockedInterval } from "./slot-overlap"

const MIN = 60_000
// Bloque en minutos-desde-cero (ej: 900 = las 15:00 si contás minutos del día).
const block = (startMin: number, endMin: number, name: string): BlockedInterval => ({
  startMs: startMin * MIN,
  endMs: endMin * MIN,
  name,
})

describe("overlappingBlock", () => {
  it("sin bloqueos -> libre (null)", () => {
    expect(overlappingBlock(900 * MIN, 60, [])).toBeNull()
  })

  it("pegado por delante (el candidato termina justo cuando arranca el bloque) -> libre", () => {
    // candidato 14:00-15:00, bloque 15:00-16:00
    expect(overlappingBlock(840 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })

  it("pegado por detrás (el candidato arranca justo cuando termina el bloque) -> libre", () => {
    // candidato 16:00-17:00, bloque 15:00-16:00
    expect(overlappingBlock(960 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })

  it("mismo tramo -> se pisa, devuelve el bloque (para el motivo)", () => {
    expect(overlappingBlock(900 * MIN, 60, [block(900, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("el candidato arranca dentro del bloque -> se pisa", () => {
    // candidato 15:30-16:30, bloque 15:00-16:00
    expect(overlappingBlock(930 * MIN, 60, [block(900, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("el bloque queda dentro del candidato -> se pisa", () => {
    // candidato 15:00-17:00, bloque 15:30-16:00
    expect(overlappingBlock(900 * MIN, 120, [block(930, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("varios bloques -> devuelve el primero que se pisa", () => {
    const blocks = [block(600, 660, "Reflexo"), block(900, 960, "Masaje")]
    expect(overlappingBlock(900 * MIN, 60, blocks)?.name).toBe("Masaje")
  })

  it("candidato lejos de todos -> libre", () => {
    expect(overlappingBlock(600 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- slot-overlap`
Expected: FAIL — no se resuelve el import `./slot-overlap` (el módulo no existe).

- [ ] **Step 3: Write the module**

Crear `src/lib/servicios/slot-overlap.ts`:

```ts
/**
 * Solapamiento de horarios en la reserva "cada uno en su fecha". PURO (trabaja
 * en milisegundos UTC), para poder testearlo y usar la MISMA regla que la
 * validación final (`validateSeparateSlots`/`crossOverlapCheck`): solapamiento
 * ESTRICTO — pegados (fin == inicio) NO cuentan como pisado.
 */

export type BlockedInterval = { startMs: number; endMs: number; name: string }

/**
 * Si el tramo `[startMs, startMs + durationMin*60000)` se pisa con algún
 * intervalo bloqueado, devuelve el PRIMERO (para poder mostrar su nombre como
 * motivo); si está libre, `null`.
 */
export function overlappingBlock(
  startMs: number,
  durationMin: number,
  blocked: BlockedInterval[]
): BlockedInterval | null {
  const endMs = startMs + durationMin * 60_000
  for (const b of blocked) {
    if (startMs < b.endMs && endMs > b.startMs) return b
  }
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- slot-overlap`
Expected: PASS — 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/slot-overlap.ts src/lib/servicios/slot-overlap.test.ts
git commit -m "feat(reserva): módulo puro de solapamiento de horarios (overlappingBlock)"
```

---

### Task 2: `PackSessionPicker` — prop `blockedIntervals` (gris + motivo)

**Files:**
- Modify: `src/app/reserva/_components/pack-session-picker.tsx` (imports; firma de props; cálculo derivado antes del `return`; render de la grilla de horarios ~líneas 187-199).

**Interfaces:**
- Consumes (de Task 1): `overlappingBlock`, `type BlockedInterval`.
- Produces: `PackSessionPicker` acepta una prop nueva `blockedIntervals?: BlockedInterval[]` (default `[]`). Sin pasarla → comportamiento idéntico a hoy.

**Contexto:** Este componente elige fecha/hora de UNA cosa (un servicio suelto o una sesión de pack) y también lo usa el admin. Hoy dibuja cada horario libre como un `<button>` clickeable. El cambio: los horarios que se pisan con `blockedIntervals` se dibujan en gris, no clickeables, con el motivo (tooltip + leyenda). NO se toca la lógica de qué horarios trae el servidor.

- [ ] **Step 1: Agregar el import del módulo puro**

Debajo de `import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"` (~línea 17), agregar:

```ts
import { overlappingBlock, type BlockedInterval } from "@/lib/servicios/slot-overlap"
```

- [ ] **Step 2: Agregar la prop `blockedIntervals` a la firma**

En la desestructuración de props (`export default function PackSessionPicker({ ... }: { ... })`), agregar el parámetro con default y su tipo. El bloque actual empieza:

```tsx
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  serviceId,
  minDate,
  onPick,
  onCancel,
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
```

Cambiar la lista de parámetros para incluir `blockedIntervals = []` (después de `onCancel`) y su tipo (después de `proHint: string`). Reemplazar:

```tsx
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  serviceId,
  minDate,
  onPick,
  onCancel,
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
```

por:

```tsx
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  serviceId,
  minDate,
  onPick,
  onCancel,
  blockedIntervals = [],
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
  // Tramos que la clienta YA ocupa ese día (en ms UTC). Opcional: sin pasarlo
  // (o `[]`), el picker se comporta idéntico a hoy — el admin no lo pasa.
  blockedIntervals?: BlockedInterval[]
```

- [ ] **Step 3: Calcular el estado de cada horario antes del `return`**

Justo antes del `return (` del componente (después de `const selectedObj = selectedDate ? parseYmd(selectedDate) : null`, ~línea 101), agregar:

```tsx
  // Para cada horario libre que trae el servidor, ¿se pisa con algo que la
  // clienta ya eligió? (misma regla estricta que `validateSeparateSlots`).
  const slotStates = selectedDate
    ? slots.map((t) => ({
        t,
        block: overlappingBlock(slotToUtcMs(selectedDate, t), durationMin, blockedIntervals),
      }))
    : []
  // Los bloques que efectivamente pisan algún horario de este día (para la
  // leyenda). Se deduplican por referencia (los ítems de `blockedIntervals`
  // son estables), preservando el orden de aparición.
  const activeBlocks: BlockedInterval[] = []
  for (const s of slotStates) if (s.block && !activeBlocks.includes(s.block)) activeBlocks.push(s.block)
```

- [ ] **Step 4: Renderizar la grilla con gris + tooltip + leyenda**

Reemplazar el bloque actual de render de horarios (~líneas 187-199):

```tsx
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
```

por:

```tsx
            ) : (
              <>
                <div className="slots__grid">
                  {slotStates.map(({ t, block }) =>
                    block ? (
                      <div
                        key={t}
                        className="slot"
                        style={{ opacity: 0.5, cursor: "default" }}
                        title={`Ya tenés ${block.name} a esta hora`}
                      >
                        {t}
                      </div>
                    ) : (
                      <button
                        key={t}
                        className="slot"
                        onClick={() => onPick(new Date(slotToUtcMs(selectedDate, t)).toISOString())}
                      >
                        {t}
                      </button>
                    )
                  )}
                </div>
                {activeBlocks.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 10 }}>
                    Los horarios en gris se superponen con:{" "}
                    {activeBlocks
                      .map(
                        (b) =>
                          `${b.name} (${arPartsFromUtc(new Date(b.startMs)).timeStr}–${arPartsFromUtc(new Date(b.endMs)).timeStr})`
                      )
                      .join(", ")}
                    .
                  </p>
                )}
              </>
            )}
```

- [ ] **Step 5: Typecheck, lint y tests**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores NUEVOS en `pack-session-picker.tsx` (reportar el delta).

Run: `npm test`
Expected: toda la suite verde (Task 1 incluida; ningún test toca este componente).

- [ ] **Step 6: Verificación manual (leer el diff)**

1. **Sin `blockedIntervals` (o `[]`):** `slotStates` marca `block: null` para todos → se renderizan SÓLO `<button>` clickeables, y `activeBlocks` queda vacío → NO aparece leyenda. **Idéntico a hoy** (esto cubre el uso del admin, que no pasa la prop).
2. **Con un bloque que pisa:** ese horario se dibuja como `<div>` gris (opacity 0.5, sin `onClick`), con `title="Ya tenés … a esta hora"`, y abajo la leyenda nombra el/los bloque(s) con su rango horario.
3. **La regla:** un horario pegado (empieza justo cuando termina el bloque, o termina justo cuando arranca) queda **clickeable** (no gris) — coincide con `validateSeparateSlots`.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/_components/pack-session-picker.tsx
git commit -m "feat(reserva): el selector de fecha marca en gris los horarios que se pisan (prop blockedIntervals)"
```

---

### Task 3: Pasar `blockedIntervals` desde los dos call sites (`screens.tsx`)

**Files:**
- Modify: `src/app/reserva/screens.tsx` (import de `BlockedInterval`; el selector de sesión del pack ~línea 1611-1629; el selector de servicio suelto ~línea 1724-1743).

**Interfaces:**
- Consumes (de Task 2): la prop `blockedIntervals?: BlockedInterval[]` de `PackSessionPicker`; el tipo `BlockedInterval` de `@/lib/servicios/slot-overlap`.
- Produces: nada que otras tareas consuman.

**Contexto:** Dos lugares abren el `PackSessionPicker`. Cada uno arma la lista de lo que la clienta YA ocupa ese día. Ambos usan datos ya en scope de `Screen2DateTime`. El módulo puro (Task 1) y la prop (Task 2) ya existen.

- [ ] **Step 1: Agregar el import del tipo**

Debajo de `import PackSessionPicker from "./_components/pack-session-picker"` (~línea 24), agregar:

```ts
import type { BlockedInterval } from "@/lib/servicios/slot-overlap"
```

- [ ] **Step 2: Armar y pasar `blockedIntervals` en el selector de sesión del pack**

En el bloque `if (pickingIdx !== null) { const idx = pickingIdx` (~líneas 1611-1612), agregar el cálculo justo después de `const idx = pickingIdx`. Reemplazar:

```tsx
    if (pickingIdx !== null) {
      const idx = pickingIdx
      const PickerBody = () => (
```

por:

```tsx
    if (pickingIdx !== null) {
      const idx = pickingIdx
      // Los servicios sueltos que la clienta ya ocupa ese día: la sesión del
      // pack no puede pisarlos (es una sola persona, aunque sea otra
      // profesional). El solapamiento sesión-vs-sesión del pack ya lo evita
      // `minForPackSession`. Misma regla estricta que el cartel rojo final.
      const blocked: BlockedInterval[] = state.services
        .filter((s) => serviceSlots[s.id])
        .map((s) => {
          const startMs = new Date(serviceSlots[s.id]).getTime()
          return { startMs, endMs: startMs + effectiveService(s, zoneSel).duration * 60_000, name: s.name }
        })
      const PickerBody = () => (
```

Y en el `<PackSessionPicker ... />` de ese bloque (~líneas 1621-1629), agregar la prop `blockedIntervals={blocked}` (por ejemplo, después de `minDate={minForPackSession(idx)}`). El bloque actual:

```tsx
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={packDurationMin}
            proHint={packProHint}
            serviceId={packDetails.serviceId}
            minDate={minForPackSession(idx)}
            onPick={(iso) => setPackSlot(idx, iso)}
            onCancel={backToPackList}
          />
```

pasa a:

```tsx
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={packDurationMin}
            proHint={packProHint}
            serviceId={packDetails.serviceId}
            minDate={minForPackSession(idx)}
            blockedIntervals={blocked}
            onPick={(iso) => setPackSlot(idx, iso)}
            onCancel={backToPackList}
          />
```

- [ ] **Step 3: Armar y pasar `blockedIntervals` en el selector de servicio suelto**

En el bloque `if (picking) { const eff = effectiveService(picking, zoneSel)` (~líneas 1724-1726), agregar el cálculo después de `const backToList = () => setPickingServiceId(null)`. Reemplazar:

```tsx
    if (picking) {
      const eff = effectiveService(picking, zoneSel)
      const backToList = () => setPickingServiceId(null)

      const PickerBody = () => (
```

por:

```tsx
    if (picking) {
      const eff = effectiveService(picking, zoneSel)
      const backToList = () => setPickingServiceId(null)

      // Lo que la clienta ya ocupa ese día (no puede estar en dos lugares a la
      // vez, aunque sea otra profesional): los demás servicios elegidos y todas
      // las sesiones del pack. Misma regla estricta que el cartel rojo final.
      const blocked: BlockedInterval[] = [
        ...state.services
          .filter((s) => s.id !== picking.id && serviceSlots[s.id])
          .map((s) => {
            const startMs = new Date(serviceSlots[s.id]).getTime()
            return { startMs, endMs: startMs + effectiveService(s, zoneSel).duration * 60_000, name: s.name }
          }),
        ...packPicked.map((iso) => {
          const startMs = new Date(iso).getTime()
          return { startMs, endMs: startMs + packDurationMin * 60_000, name: pack ? `${pack.name} (pack)` : "el pack" }
        }),
      ]

      const PickerBody = () => (
```

Y en el `<PackSessionPicker ... />` de ese bloque (~líneas 1732-1743), agregar `blockedIntervals={blocked}` (después de `minDate={null}`). El bloque actual:

```tsx
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={eff.duration}
            proHint={serviceStaff[picking.id] ?? "auto"}
            serviceId={picking.id}
            minDate={null}
            onPick={(iso) => {
              setState({ ...state, serviceSlots: { ...serviceSlots, [picking.id]: iso } })
              setPickingServiceId(null)
            }}
            onCancel={backToList}
          />
```

pasa a:

```tsx
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={eff.duration}
            proHint={serviceStaff[picking.id] ?? "auto"}
            serviceId={picking.id}
            minDate={null}
            blockedIntervals={blocked}
            onPick={(iso) => {
              setState({ ...state, serviceSlots: { ...serviceSlots, [picking.id]: iso } })
              setPickingServiceId(null)
            }}
            onCancel={backToList}
          />
```

- [ ] **Step 4: Typecheck, lint y tests**

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores NUEVOS en `screens.tsx` (reportar el delta).

Run: `npm test`
Expected: toda la suite verde.

- [ ] **Step 5: Verificación manual (leer el diff y trazar)**

1. **Servicio suelto, separados, dos servicios de la misma profesional:** elegir el 1º a las 15:00 (60 min); abrir el selector del 2º ese mismo día → 15:00 aparece **en gris** con *"Ya tenés {servicio} a esta hora"* y la leyenda abajo; 16:00 queda clickeable (pegado, no pisa).
2. **Mezcla separados:** un servicio a las 15:00 bloquea ese horario en el selector de las **sesiones del pack**, y una sesión del pack a las 15:00 bloquea el selector de **servicios** (nombre `{pack} (pack)`).
3. **Standalone separados (sin pack):** `packPicked` es `[]` → sólo bloquean los otros servicios. Igual que antes salvo el gris.
4. **Pack solo (sin servicios):** `state.services` vacío → `blocked` vacío en el selector de sesiones → el selector queda **idéntico a hoy** (el solapamiento entre sesiones lo sigue manejando `minForPackSession`).
5. **Otro día:** un turno elegido el miércoles NO grisa horarios del jueves (los ms no se pisan).

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(reserva): los selectores separados grisan los horarios que la clienta ya ocupa ese día"
```

---

## Self-Review

**1. Spec coverage:**
- Gris + motivo en el modo separados → Task 2 (render) + Task 3 (datos). ✓
- Regla estricta idéntica a `validateSeparateSlots` → Task 1 (`overlappingBlock`, `<`/`>`) + constraint. ✓
- Servicio bloquea con su nombre; sesión de pack con `{pack} (pack)` → Task 3 Step 3. ✓
- Selector de servicio mira otros servicios + sesiones del pack; selector de sesión mira servicios → Task 3 Steps 2-3. ✓
- Prop opcional; admin sin cambios → Task 2 (default `[]`) + verificación 1. ✓
- Cartel rojo intacto; juntos/plata/backend intactos → no se tocan (constraint). ✓
- Módulo puro testeable → Task 1. ✓
- Motivo en escritorio (tooltip) y celular (leyenda) → Task 2 Step 4. ✓

**2. Placeholder scan:** sin TODO/TBD; todo el código está completo.

**3. Type consistency:** `BlockedInterval { startMs, endMs, name }` y `overlappingBlock(startMs, durationMin, blocked)` se definen en Task 1 y se usan con esas firmas en Tasks 2 y 3. La prop `blockedIntervals?: BlockedInterval[]` se declara en Task 2 y se pasa en Task 3. `activeBlocks`/`slotStates` consistentes dentro de Task 2.
