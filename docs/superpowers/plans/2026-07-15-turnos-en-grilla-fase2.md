# Fase 2 (fusión) — cableado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** En "uno tras otro", dos turnos SEGUIDOS de la MISMA profesional que entran en 1 hora **comparten la hora** (el 2º arranca pegado); si son de otra profesional (o no entran) arranca en hora en punto. La Fase 1 ya hace la parte "otra profesional → hora en punto".

**Architecture:** El núcleo puro `placeOnGridMerged(items {durationMin, staffId}, gridSlots, startSlot)` (ya construido y testeado, commit anterior) coloca con fusión. Se enchufa en buscador / creación / pantalla. Regla de oro: los tres colocan `placeOnGridMerged(mismo staff resuelto)` — idéntico por construcción.

**Tech Stack:** Next.js 16, TS strict, Vitest (módulos puros).

## Global Constraints

- **Motor de reservas, sin tests de `createBooking`.** La plata, "separados", pack solo, servicio solo, la grilla, el portador=ventana (Fase 1): NO se tocan.
- **REGLA DE ORO:** buscador (ofrece), creación (reserva) y pantalla (muestra) colocan IDÉNTICO. Todos usan `placeOnGridMerged` con el MISMO staff resuelto, la MISMA grilla ordenada, el MISMO startSlot. El buscador DEVUELVE los horarios (`SlotResult.starts`); el cliente los usa; la creación recalcula `placeOnGridMerged(input.resolvedStaff)`.
- **`placeOnGridMerged`:** funde el ítem i con el bloque actual sólo si `staffId === blockStaff` Y `blockEnd + dur ≤ nextGridSlot(blockStart)`; si no, nuevo bloque en el 1er slot ≥ fin del bloque. Con todos los staff distintos == `placeOnGrid` (Fase 1).
- **El PACK es siempre su propio bloque** (no funde con los sueltos): buscador coloca el pack en T y los sueltos vía `placeOnGridMerged(sueltos, grid, 1er slot ≥ T+D_pack)`; creación coloca sólo los sueltos. Así coinciden.
- **Compatibilidad Fase 1:** con profesionales distintas (el caso común), idéntico a lo que ya anda en producción.

---

### Task 1 — `placeOnGridMerged` puro + tests: YA HECHO (commit anterior)

`src/lib/servicios/grid-schedule.ts` (`placeOnGridMerged`) + tests 21/21. No re-hacer.

---

### Task 2 — Buscador `checkPerm`: caminata codiciosa con fusión

**Files:** Modify `src/app/reserva/actions.ts` — `checkPerm` (~1754-1841), `trySlot` (pasar `leadServiceId`), y la llamada en `fetchSequentialAvailability`.

**Diseño (caminata que resuelve profesional + fusión JUNTAS, en la posición REAL):**

Reemplazar el bloque actual (que precalcula `placeOnGrid` y resuelve staff por posición) por una **caminata** que, ítem por ítem en el orden `perm`, decide la posición (fundida o nuevo slot de grilla) y la profesional a la vez. Factorizar la resolución de profesional actual (el bloque `if svc.staffId !== "auto" … else …`, líneas 1818-1838) en un helper `resolveStaffAt(svc, posMin, excludeStaff?)` que devuelve el id o `null`, chequeando disponibilidad en `[posMin, posMin+dur)` (mismos `proWorksAtSlot`/`overlapsNamed`/`assignableStaff` de hoy), y descartando `excludeStaff` si viene.

Estado de la caminata: `blockStartMin`, `blockStaff` (id o null), `blockEndMin`, `isLeadBoundary` (true justo tras colocar el lead/pack, para que el 1er suelto NO funda con el pack).

Para cada `p` (ítem `svc`, `dur`):
- **p==0:** `pos = startSlotMin`. `staff = resolveStaffAt(svc, pos)`; si null → null. Abrir bloque. `isLeadBoundary = (leadServiceId != null && svc.id === leadServiceId)`.
- **p>0:**
  - `nextGrid = gridMin.find(g => g > blockStartMin)`; `fits = nextGrid !== undefined && blockEndMin + dur <= nextGrid`.
  - **Intentar FUSIÓN:** `canMerge = fits && !isLeadBoundary && blockStaff != null && (svc.staffId === "auto" || svc.staffId === blockStaff) && (!enforce || canStaffDoService(blockStaff, svc.id, staffMap)) && blockStaff libre en [blockEndMin, blockEndMin+dur)` (libre = `proWorksAtSlot` + no pisa una pata con su nombre + `assignableStaff(...).includes(blockStaff)` en esa ventana).
    - Si `canMerge`: `pos = blockEndMin`; `assignment[svc.id]=blockStaff`; `blockEndMin += dur`; `isLeadBoundary=false`; continuar.
  - **NUEVO BLOQUE:** `pos = gridMin.find(g => g >= blockEndMin)`; si undefined → null. `excludeStaff = (fits && !isLeadBoundary) ? blockStaff : null` (si geométricamente ENTRABA pero no fundimos, la nueva profesional NO puede ser la del bloque — si no, `placeOnGridMerged` fundiría y no coincidiría). `staff = resolveStaffAt(svc, pos, excludeStaff)`; si null → null. Abrir bloque; `isLeadBoundary=false`.
- Guardar `starts[svc.id] = minutesToHm(pos)` y `assignment[svc.id] = staff`.

`trySlot` pasa `leadServiceId` a `checkPerm` (nuevo param). `fetchSequentialAvailability` ya tiene `opts.leadServiceId` — pasarlo a `trySlot`.

**Invariante a trazar (regla de oro):** la caminata produce `assignment`+`starts` tales que `starts == placeOnGridMerged(perm items con assignment, gridMin, startSlot)` **con el pack como bloque aparte** — porque la caminata funde exactamente cuando `placeOnGridMerged` fundiría (mismo staff + entra), y cuando NO funde por disponibilidad asigna OTRA profesional (así `placeOnGridMerged` tampoco funde). El `isLeadBoundary` reproduce "el pack es su propio bloque".

**Nota (compromiso):** si la profesional del bloque está ocupada en la posición fundida y no hay otra libre, ese slot no se ofrece (puede ofrecer menos horarios que un solver ideal, nunca uno inválido). Aceptado por diseño.

**Verificación:** tsc 0, `npm test` verde. Trazar que con profesionales distintas la caminata == Fase 1 (no regresiona). Que `resolveStaffAt` mantiene la disponibilidad real igual que hoy.

**Commit:** `feat(reserva): el buscador funde turnos cortos de la misma profesional (Fase 2)`

---

### Task 3 — Creación `planLooseServices`: `placeOnGrid` → `placeOnGridMerged`

**Files:** Modify `src/app/reserva/actions.ts` — el loop de patas "juntos" de `planLooseServices` (donde hoy llama `placeOnGrid`).

**Diseño:** Reemplazar `placeOnGrid(durations, gridMin, startSlot)` por `placeOnGridMerged(orderedServices.map(s => ({ durationMin: computed[s.id].durationMin, staffId: input.resolvedStaff?.[s.id] ?? mainStaffId ?? "auto" })), gridMin, startSlot)`. El `staffId` es el que resolvió el buscador (viene en `input.resolvedStaff`) — el MISMO que usó `checkPerm`, así coincide. `null` → error "no entra". El resto (revalidación por pata, needsGrid, portador=ventana) IGUAL.

**Nota:** la creación coloca SÓLo los sueltos (el pack lo hace `planPack`), desde `input.startsAt` (que el cliente manda como el 1er slot suelto en grilla). Así `placeOnGridMerged(sueltos)` coincide con la parte suelta del buscador (que colocó el pack aparte).

**Verificación:** trazar que la creación coloca IDÉNTICO al buscador (mismo `placeOnGridMerged`, mismo staff `input.resolvedStaff`, misma grilla/orden/startSlot). No más estricto. tsc + tests.

**Commit:** `feat(reserva): la reserva coloca las patas con fusión (Fase 2, regla de oro)`

---

### Task 4 — Cliente `screens.tsx`: `looseGridStarts` con fusión

**Files:** Modify `src/app/reserva/screens.tsx` — `looseGridStarts` (~línea 90) y sus llamadas.

**Diseño:** `looseGridStarts` hoy usa `placeOnGrid(durations, …)`. Pasa a `placeOnGridMerged(items {durationMin, staffId}, …)`, donde `staffId = resolvedStarts`… no — el staff sale de `state.resolvedStaff` (lo que devolvió el buscador). Cuando hay `resolvedStarts` (del buscador) se usa tal cual (prioritario). En el respaldo (sin `resolvedStarts`), calcular con `placeOnGridMerged(items con `state.resolvedStaff?.[id] ?? "auto"`, gridMin, startSlot)`. Firma de `looseGridStarts`: agregar `staffByService: Record<string,string>` (de `state.resolvedStaff`) para el respaldo. Los call sites pasan `state.resolvedStaff ?? {}`.

**Verificación:** trazar que lo mostrado == `resolvedStarts` (del buscador) == lo que `pay()` manda == lo que la creación recalcula. Con profesionales distintas, idéntico a Fase 1. tsc + lint (delta 0) + tests.

**Commit:** `feat(reserva): la pantalla muestra los turnos con fusión (Fase 2)`

---

## Self-Review
- Fusión misma-profe-entra → `placeOnGridMerged` (Task 1) en buscador (2) / creación (3) / pantalla (4). ✓
- Regla de oro → misma `placeOnGridMerged`, mismo staff resuelto; caminata mantiene el invariante `starts == placeOnGridMerged(assignment)`; el pack aparte. ✓
- No regresiona Fase 1 (profesionales distintas == `placeOnGrid`). ✓
- Plata / separados / pack-solo / servicio-solo / grilla / portador: sin tocar. ✓
- Compromiso de slots perdidos documentado (Task 2). ✓
