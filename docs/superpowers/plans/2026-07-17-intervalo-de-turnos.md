# Intervalo de turnos configurable (30 min / 1 hora) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Que el salón elija desde Admin → Horarios si los turnos se ofrecen cada 30 min o cada 1 hora, sin que la disponibilidad del personal quede mintiendo.

**Architecture:** El paso NO se guarda como ajuste: se deduce de `business_hours.slots` con un módulo puro nuevo (`gridStepMin`). El editor de horarios genera la grilla con el paso elegido; `updateBusinessHours` convierte los `staff_blocked_slots` existentes en la misma operación; el motor deja de asumir 60 min por casilla bloqueada y por tope del día.

Spec: `docs/superpowers/specs/2026-07-17-intervalo-de-turnos-design.md`.

## Global Constraints

- **La disponibilidad no puede aflojarse NUNCA:** al convertir bloqueos, 1h→30min preserva exactamente la cobertura; 30min→1h bloquea de más (nunca de menos). Ante cualquier duda, bloquear.
- **Todo o nada:** si la conversión de bloqueos falla, los horarios tampoco se guardan.
- El motor sigue leyendo la grilla guardada como única verdad. Ningún camino puede volver a asumir "60" a mano.
- Turnos ya reservados: NO se tocan ni se revalidan contra la grilla nueva.
- La plata, los mails, los packs, la regla Fase 3 y la reserva online no se tocan.
- tsc 0 · `npx vitest run` (189 + los nuevos) · `npm run lint` sin problemas nuevos (baseline 20) · `npx next build` OK.
- Castellano rioplatense en copy y comentarios.

### Task 1 — Núcleo puro `gridStepMin` + tope del día por paso

**Files:** Create `src/lib/servicios/grid-step.ts` + `grid-step.test.ts`; Modify `src/lib/servicios/grid-schedule.ts` (+ su test) y `src/app/reserva/actions.ts` (espejo del tope en `checkPerm`).

```ts
/** El paso de la grilla en minutos: la MÍNIMA diferencia positiva entre
 *  horarios consecutivos. 60 por defecto con menos de 2 horarios. */
export function gridStepMin(slots: string[]): number
```
- Casos a testear: `["09:00","10:00","11:00"]`→60; `["09:00","09:30","10:00"]`→30; con pausa `["09:00","09:30","13:00","13:30"]`→30 (la pausa NO define el paso); `[]`/`["09:00"]`→60; desordenado→igual resultado; duplicados→se ignoran (diferencia 0 no cuenta).
- `placeOnGridMerged`: el tope `gridSlots[len-1] + 60` pasa a `+ gridStepMin(...)` sobre los MISMOS `gridSlots` (que están en minutos: agregar una variante o convertir — resolver sin duplicar la lógica). Tests existentes (grilla de 1 h) deben seguir verdes sin tocarlos; agregar uno con grilla de 30.
- `checkPerm` (`src/app/reserva/actions.ts`, `dayEndMin`): mismo cambio, mismo valor.

**Commit:** `feat(reserva): el tope del día sale del paso real de la grilla`

### Task 2 — Editor de horarios con selector de intervalo

**Files:** Modify `src/app/admin/horarios/hours-editor.tsx` (y `page.tsx` si hace falta pasar algo).

- `SLOT_MIN` constante → estado `stepMin: 30 | 60`, inicializado con `gridStepMin` de los slots guardados (el de cualquier día abierto; si difieren, el MÁS CHICO). Selector arriba de la lista de días: "Los turnos se ofrecen cada: [30 min | 1 hora]".
- Al cambiar el selector: regenerar `slots` de todos los días abiertos con `slotsFromConfig` usando el paso nuevo (la apertura/cierre/pausa de cada día se conservan).
- `slotsFromConfig` y `configFromHour` reciben el paso en vez de usar la constante. `configFromHour` deduce la pausa comparando contra el paso recibido.
- Avisar en pantalla, junto al selector: "Cambiar el intervalo reacomoda también las horas bloqueadas del personal para que su disponibilidad no cambie."

**Commit:** `feat(admin): elegir si los turnos se ofrecen cada 30 min o cada 1 hora`

### Task 3 — Conversión de los bloqueos del personal al guardar

**Files:** Modify `src/app/admin/actions.ts` (`updateBusinessHours`, ~línea 969).

- Antes de escribir: leer los `business_hours` actuales (día → slots viejos). Para cada día que llega, comparar `gridStepMin(viejos)` con `gridStepMin(nuevos)`.
- Si cambió, convertir `staff_blocked_slots` de ESE día (todas las profesionales):
  - **más fino** (60→30): cada fila `HH:MM` genera además las filas intermedias que caigan dentro del paso viejo y existan en los slots nuevos (60→30 = una extra en `+30`). Genérico: `for (let m = base; m < base + pasoViejo; m += pasoNuevo)`.
  - **más grueso** (30→60): cada fila se lleva al slot NUEVO más cercano hacia atrás que exista en la grilla nueva; se deduplica.
  - Filas que no caen en ningún slot nuevo: se descartan sólo si no hay ningún slot nuevo que las cubra (loguear cuántas).
- Escritura: `delete` de las filas de ese día + `insert` de las nuevas, y recién después el upsert de `business_hours`. Si algo falla → devolver error y NO guardar los horarios (todo o nada; si ya se borró algo, restaurar las filas viejas leídas al principio).
- La firma pública de `updateBusinessHours` no cambia (la llama el editor).

**Verificar:** 1h→30 conserva la cobertura EXACTA (Leri jueves 08–13 = 10 filas de 30 min); 30→1h no deja huecos; sin cambio de paso no se toca ninguna fila.

**Commit:** `feat(admin): al cambiar el intervalo, los bloqueos del personal se reacomodan solos`

### Task 4 — El bloqueo dura un paso, no 60 fijos

**Files:** Modify `src/app/reserva/actions.ts` (`SLOT_BLOCK_MIN`, `proWorksAtSlot` y sus llamadores).

- Eliminar la constante. `proWorksAtSlot` recibe el paso del día (o un `Map<dow, paso>` construido con `gridStepMin` sobre las filas de `business_hours` que el llamador YA tiene). Rastrear todos los llamadores y pasarles el dato sin re-consultar la base.
- Sin filas de `business_hours` para ese día (día cerrado) → 60 por defecto, como hoy.

**Verificar:** con grilla de 1 h el comportamiento es idéntico al de hoy (misma cobertura de bloqueo); con grilla de 30 una casilla bloquea 30 min.

**Commit:** `fix(reserva): una hora bloqueada cubre el paso real de la grilla`

### Final
tsc + vitest + build + lint (delta 0) + revisión final opus (trazar: grilla de 1 h byte-equivalente a hoy; cambio 1h→30 con los bloqueos reales del salón; ningún camino que afloje disponibilidad) → deploy → avisar a la usuaria que revise Admin → Personal después de cambiar el intervalo.
