# Turnos en la grilla de 1 hora — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** En el modo "uno tras otro", cada turno cae en un slot de la grilla (en hora en punto) en vez de pegado por minutos. Fase 1: cada turno en su propio slot (sin la fusión de 2 cortos de la misma profesional — eso es Fase 2).

**Architecture:** El cálculo puro `placeOnGrid` (ya construido y testeado, `src/lib/servicios/grid-schedule.ts`) coloca los turnos en la grilla. Se usa en los tres lugares que HOY empaquetan por minutos: el buscador (`checkPerm`), la creación de la reserva (`planLooseServices`) y la pantalla (`screens.tsx`). Regla de oro: el buscador DEVUELVE los horarios colocados, el cliente los USA (no recalcula), y el escritor los RECALCULA con la misma función y las mismas entradas → coinciden por construcción.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Vitest (módulos puros).

## Global Constraints

- **Presentacional-NO:** esto cambia el MOTOR de reservas (buscador + creación). La plata NO cambia (`amountDueNow(totalCents)` / suma en separados). Sólo cambian los HORARIOS de los tramos.
- **REGLA DE ORO (lo más importante):** el buscador (al ofrecer) nunca puede ser MENOS estricto ni colocar DISTINTO que el servidor (al confirmar). Los dos usan `placeOnGrid` con las MISMAS entradas (duraciones en el mismo orden, la MISMA grilla `business_hours.slots`, el mismo slot de arranque) y chequean la MISMA disponibilidad real (`assignableStaff`/`proWorksAtSlot`/`fetchDayAvailability`). La revisión de cada task DEBE trazar esto.
- **`placeOnGrid(durations, gridSlots, startSlot)`** (de `@/lib/servicios/grid-schedule`): `gridSlots` en minutos-del-día ASCENDENTE; `startSlot` uno de la grilla; devuelve el minuto de inicio de cada turno (1º en `startSlot`, cada siguiente en el 1er slot ≥ el fin del anterior), o `null` si no entra en el día. Helpers `hmToMinutes`/`minutesToHm`.
- **Modo "separados", pack solo, servicio solo, la grilla en sí, la plata, los puntos: NO se tocan.**
- **Afecta:** "juntos" multi-servicio, combos, y la 1ª sesión del pack encadenada (`packChainedFirst`). Todos van por `checkPerm`/`planLooseServices`.

**Referencia (ya existen):** `slotToUtcMs(dateStr, "HH:MM")`, `arPartsFromUtc(date) → {dateStr,timeStr,dayOfWeek}`, `AR_UTC_OFFSET`. La grilla del día viene de `business_hours.slots: string[]` (["14:00","15:00",…]).

---

### Task 1: Módulo puro `placeOnGrid` — YA HECHO (commit `e0b3986`)

`src/lib/servicios/grid-schedule.ts` + `grid-schedule.test.ts` (10/10 verde). `placeOnGrid`, `hmToMinutes`, `minutesToHm`. No re-hacer; las tasks siguientes lo consumen.

---

### Task 2: Buscador — colocar en grilla y DEVOLVER los horarios (`checkPerm`/`trySlot`)

**Files:** Modify `src/app/reserva/actions.ts` — `checkPerm` (~1712-1782), `trySlot` (~1784-1811), y el tipo `SlotResult` (grep `type SlotResult`). Importar `placeOnGrid`, `hmToMinutes`, `minutesToHm` de `@/lib/servicios/grid-schedule`.

**Interfaces:**
- Consumes: `placeOnGrid`, `hmToMinutes`, `minutesToHm`.
- Produces: `SlotResult` gana `starts: Record<string, string>` (serviceId → "HH:MM" del inicio colocado en grilla). El cliente lo usa para mostrar y para armar `startsAt`.

**Diseño (el implementador adapta el código con el archivo delante, y verifica con tsc):**
1. `checkPerm` gana dos parámetros: `dateStr: string` y `gridSlots: string[]` (los `bh.slots` del día). `trySlot` ya tiene `dateStr` y recibe `gridSlots` (agregarlo a su firma y al call site en `fetchSequentialAvailability`, ~línea 1951, donde ya se itera sobre `bh.slots`).
2. En `checkPerm`, en vez de `let ms = startMs` + `ms = sEnd` (pegado):
   - `const gridMin = gridSlots.map(hmToMinutes)` (ya vienen ascendentes; si no, `.sort((a,b)=>a-b)`).
   - `const startSlotMin = hmToMinutes(arPartsFromUtc(new Date(startMs)).timeStr)`.
   - `const durations = perm.map((i) => services[i].duration)`.
   - `const startsMin = placeOnGrid(durations, gridMin, startSlotMin)`.
   - `if (!startsMin) return null` (la cadena no entra en el día → ese slot no sirve).
   - En el loop `for (let p = 0; p < perm.length; p++)`: `const idx = perm[p]`, `const sStart = slotToUtcMs(dateStr, minutesToHm(startsMin[p]))`, `const sEnd = sStart + services[idx].duration * 60_000`. **Todo el resto de la lógica de staff (candidates, overlapsNamed, assignableStaff, assignment) queda IGUAL** — sólo cambia de dónde salen `sStart`/`sEnd`.
   - Guardar los inicios para devolverlos: `startsByService[services[idx].id] = minutesToHm(startsMin[p])`.
3. `checkPerm` devuelve `{ assignment, starts }` (o mantené `assignment` y devolvé `starts` aparte). `trySlot` arma el `SlotResult` con `starts`.
4. `SlotResult` (el tipo) gana `starts: Record<string, string>`.

**Verificación (Step de revisión manual + la del reviewer):** trazar que `checkPerm` chequea la disponibilidad real (`proWorksAtSlot`, `assignableStaff`) en los MISMOS `[sStart,sEnd)` que ahora salen de `placeOnGrid` — no más estricto que antes. Que si `placeOnGrid` da `null`, es porque la cadena no entra en el día (correcto rechazar). tsc verde, `npm test` verde.

**Commit:** `feat(reserva): el buscador coloca los turnos en la grilla y devuelve sus horarios`

---

### Task 3: Creación de la reserva — colocar las patas en la grilla (`planLooseServices`)

**Files:** Modify `src/app/reserva/actions.ts` — `planLooseServices`, el loop de patas "juntos" (~582-628). Importar `placeOnGrid`/`hmToMinutes`/`minutesToHm` (ya importados por Task 2).

**Interfaces:**
- Consumes: `placeOnGrid` + `SlotResult.starts` (conceptual — el server recalcula, no confía en el cliente).

**Diseño:**
1. Antes del loop: armar la grilla del día del `startsAt` y colocar las patas:
   - `const { dateStr: chainDate, timeStr: chainStartHm, dayOfWeek: chainDow } = arPartsFromUtc(startsAt)`.
   - `const bh0 = bhByDow.get(chainDow)`; `if (!bh0?.is_open) return { ok:false, error:"..." }`.
   - `const gridMin = bh0.slots.map(hmToMinutes)`.
   - `const durations = orderedServices.map((s) => computed[s.id].durationMin)`.
   - `const startsMin = placeOnGrid(durations, gridMin, hmToMinutes(chainStartHm))`.
   - `if (!startsMin) return { ok:false, error:"Ese horario ya no entra. Elegí otro." }`.
2. En el loop `for (let i…)`: `const legStart = new Date(slotToUtcMs(chainDate, minutesToHm(startsMin[i])))` (en vez de `legMs += duración`). **La revalidación por pata (`fetchDayAvailability`) queda IGUAL** — ahora con el horario de grilla.
3. **`needsGrid`:** ahora TODAS las patas caen en la grilla (`placeOnGrid` las coloca ahí; la 1ª es `startsAt`, que el cliente manda como slot de grilla). Reemplazar `const needsGrid = i === 0 && !input.packChainedFirst` por `const needsGrid = true` (todas deben estar en `bh.slots` — es un invariante que `placeOnGrid` garantiza; el chequeo es una red). **Sacar la relajación de `packChainedFirst`** (ya no arranca fuera de grilla). El chequeo `bh.slots.includes(timeStr)` ahora corre para todas y debe pasar.
4. **Turno "portador" (`PlannedAppointment`, ~631-634):** hoy `durationMin: totalDuration` (suma). Con huecos, la ventana real es más larga. **VERIFICAR primero** (leer `buildBusyLegs` en `availability.ts` y las queries de `appointments`): si el bloqueo es SÓLO por pata (`appointment_services`) y el portador es informativo, poné `durationMin` = ventana (`(lastLegEnd - firstLegStart)/60000`) para que `ends_at` represente la visita. Si el portador BLOQUEA a la profesional principal, evaluá si conviene la suma o la ventana (documentá la decisión en el reporte). NO cambiar la plata.

**Verificación:** trazar que el server coloca las patas IDÉNTICO al buscador (misma `placeOnGrid`, misma grilla del día, mismo `startSlot` = `arPartsFromUtc(input.startsAt).timeStr`). Que la revalidación por pata sigue corriendo. Que no quedó más estricto que el buscador. tsc + tests verdes.

**Commit:** `feat(reserva): la reserva coloca las patas juntos en la grilla (regla de oro con el buscador)`

---

### Task 4: Cliente — usar los horarios del buscador, `startsAt` en grilla, display

**Files:** Modify `src/app/reserva/screens.tsx` — `looseChainStartMs`/`looseChainSlot`/`mixedOverlap` (~744-762), `selectSeqSlot` (~823), `pay()` `startsAt` (~2509-2516) y el payload (`packChainedFirst`), `juntosItems` (~2427), la confirmación "Cuándo" (chained), y en `Screen2DateTime` `VisitPreview`/`PackSessionRows`. Importar `placeOnGrid`/`hmToMinutes`/`minutesToHm`.

**Interfaces:**
- Consumes: `SlotResult.starts` (del buscador), `placeOnGrid`.

**Diseño:**
1. **`selectSeqSlot`:** el `result` ahora trae `result.starts` (serviceId → "HH:MM"). Guardarlo en el estado (nuevo campo `resolvedStarts?: Record<string,string>`) para que la pantalla y la confirmación muestren EXACTAMENTE lo que el buscador colocó (no recalcular). El resto (serviceOrder, resolvedStaff, packSlots[0]=T) igual.
2. **`pay()` `startsAt`:** el arranque de la cadena suelta = el 1er horario suelto colocado. Sin pack: el slot elegido T (`result.starts` del 1er servicio, = T). Con pack encadenado: el 1er servicio suelto cae en el 1er slot ≥ T+D_pack — usar `resolvedStarts` del 1er servicio suelto (`serviceOrder[0]`): `startsAt = slotToUtcMs(selectedDate, resolvedStarts[serviceOrder[0]])`. Reemplaza el `T + packDurationMin*60000` de hoy. (Si no hay `resolvedStarts`, calcular con `placeOnGrid` como respaldo.)
3. **`packChainedFirst` en el payload:** ya NO hace falta la relajación de grilla en el server (Task 3). Si `planLooseServices` ya no lo lee para `needsGrid`, se puede sacar del payload o dejar en `false`. Verificar que sacarlo no rompa nada más (grep `packChainedFirst` en actions.ts). El `leadServiceId` del buscador SÍ se mantiene (el pack va primero).
4. **`looseChainSlot`/`mixedOverlap`:** hoy es UN `SlotItem` contiguo. Con grilla + huecos, los servicios sueltos están en slots separados. Construir un `SlotItem` POR servicio suelto (cada uno en su horario colocado, de `resolvedStarts`) y chequear contra las sesiones del pack (`validateSeparateSlots([...packSessionSlots, ...looseItemsPorGrilla])`). Así el aviso de superposición sigue siendo correcto.
5. **`juntosItems` (confirmación):** los `startTime` ahora salen de `resolvedStarts` (o `placeOnGrid` de respaldo), no de `sequentialStartTimes` pegado. Mostrar cada servicio en su horario de grilla.
6. **Confirmación "Cuándo" (chained) y `VisitPreview`/`PackSessionRows` (Screen2):** la sesión 1 en T, los servicios en sus horarios de grilla (con huecos posibles). Reemplazar el cálculo pegado (`addMinutesHM`/`sequentialStartTimes`) por los horarios colocados. El encabezado de día (una vez) se mantiene.

**Verificación:** trazar que lo que se muestra == `resolvedStarts` (lo que el buscador colocó) == lo que `pay()` manda como `startsAt` == lo que el server recalcula. Byte-idéntico para separados/pack-solo/servicio-solo. tsc + lint (delta 0) + tests verdes.

**Commit:** `feat(reserva): la pantalla muestra y reserva los turnos en la grilla`

---

## Self-Review

- Regla nueva (cada turno en su slot de grilla) → `placeOnGrid` (Task 1) usado en buscador (2), server (3), cliente (4). ✓
- Regla de oro (buscador == server == cliente) → misma `placeOnGrid`, mismas entradas; el server recalcula, el cliente usa lo devuelto. Trazado en cada task + revisión final. ✓
- Fusión (2 cortos misma profe en 1h) → NO en fase 1 (`placeOnGrid` sin fusión). Fase 2. ✓
- Plata / separados / pack-solo / grilla → sin tocar. ✓
- `packChainedFirst` relajación → se saca (todo en grilla). `leadServiceId` se mantiene. ✓
- Portador (suma vs ventana) → verificar el bloqueo real antes de decidir (Task 3). ✓
