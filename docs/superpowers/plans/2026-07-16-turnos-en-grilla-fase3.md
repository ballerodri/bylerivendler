# Fase 3 (misma profesional pegados SIEMPRE) — cableado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Misma profesional → el turno siguiente arranca PEGADO (aunque cruce la hora: 10:30); distinta → hora en punto. El pack se encadena con el 1er suelto si lo hace la misma profesional. Reemplaza el tope "entran en 1 hora" de la Fase 2.

**Architecture:** El núcleo puro `placeOnGridMerged` YA tiene la regla nueva (commit anterior, 24/24 tests, anclada-sin-memoria incluso con el pack pegado). Falta el cableado: buscador (caminata sin `fits` ni `isLeadBoundary`), creación (aceptar el arranque de cadena en `T + D_pack` exacto), y cliente (fallback pack-pro-aware). Regla de oro igual que Fase 2: los tres colocan `placeOnGridMerged(mismo staff resuelto)`.

## Global Constraints

- **REGLA DE ORO:** la caminata del buscador debe cumplir `starts == placeOnGridMerged(assignment)`. Como la regla pura pega SIEMPRE que el staff coincide con el anterior, la caminata NUNCA puede asignar la misma profesional a un ítem consecutivo sin pegarlo → cuando no puede pegar por disponibilidad, `excludeStaff = profe del ítem anterior` en TODA colocación no-pegada (antes era sólo cuando `fits`).
- El PACK es el ítem 0 de la cadena como cualquier otro (se elimina `isLeadBoundary`): el 1er suelto se pega si misma profe, o va a grilla si no. `leadServiceId` sigue forzando el pack primero (`isValidOrder`), eso no cambia.
- **Arranque de cadena (writer):** válido si es slot de grilla **O** exactamente `packSlots[0] + duración de la sesión 1` (la única mitad-de-hora legítima). `createBooking` le pasa a `planLooseServices` el fin de la sesión 1 (`packChainEndMs`) que `planPack` ya calcula (`firstDuration`).
- Bloqueo real por pata / plata / separados / pack-solo / orden-por-profesional (94d4821): NO se tocan.
- Compromiso igual que Fase 2 (documentado): si la única profe capaz está ocupada en la posición pegada, ese slot no se ofrece. Carrera del pack-auto aceptada (spec).

### Task 1 — Núcleo: YA HECHO (commit anterior). placeOnGridMerged Fase 3 + 24 tests.

### Task 2 — Buscador `checkPerm`: caminata Fase 3
**Modify** `src/app/reserva/actions.ts` (`checkPerm`). Cambios sobre la caminata Fase 2:
- Eliminar `nextGrid`/`fits` y `isLeadBoundary` (y el param `leadServiceId` de `checkPerm` si sólo servía para eso — verificar; `trySlot`/`isValidOrder` lo siguen usando para el orden).
- Fusión: `canMerge = blockStaff != null && (svc.staffId === "auto" || svc.staffId === blockStaff) && (!enforce || canStaffDoService(blockStaff, svc.id, staffMap)) && blockStaff libre en [prevEnd, prevEnd+dur)`. Si pega: pos = prevEnd.
- No-pegado: pos = 1er slot grilla ≥ prevEnd; `excludeStaff = blockStaff` SIEMPRE que blockStaff != null (la regla pura pegaría a cualquier mismo-staff consecutivo). resolveStaffAt igual.
- Estado: ya no hay bloque — basta `prevStaff`/`prevEnd` (espejo del núcleo).
**Verificar:** inducción `starts == placeOnGridMerged(assignment)`; con staff todo distinto == Fase 1; tsc + tests.

### Task 3 — Creación: aceptar arranque `T + D_pack`
**Modify** `src/app/reserva/actions.ts`. `planPack` ya calcula `firstDuration` y la sesión 1 (`packSlots[0]`). `createBooking` pasa a `planLooseServices` un nuevo parámetro opcional `packChainEndMs: number | null` (= `sesión1StartMs + firstDuration*60000`, sólo cuando hay pack + servicios juntos). En `planLooseServices`, la validación del arranque pasa de `bh0.slots.includes(chainStartHm)` a `bh0.slots.includes(chainStartHm) || startsAt.getTime() === packChainEndMs`. Nada más cambia (la colocación interna ya usa el núcleo nuevo).
**Verificar:** el arranque mitad-de-hora SÓLO se acepta cuando es exactamente el fin de la sesión 1; regla de oro (writer reproduce al buscador vía anclada-sin-memoria — testeada); orden de fases en createBooking (planPack antes de planLooseServices o reordenar el cálculo).

### Task 4 — Cliente: `looseGridStarts` fallback pack-pro-aware
**Modify** `src/app/reserva/screens.tsx`. La rama `resolvedStarts` (normal) ya es correcta. El FALLBACK con pack encadenado hoy arranca en `1er slot grilla ≥ T+D_pack`; ahora: si `packPro` es concreta y == staff del 1er suelto → arranque = `T + D_pack` (pegado); si no → grilla (como hoy). `pay()` startsAt sin cambios (usa resolvedStarts/looseGridStarts[0]).
**Verificar:** display == resolvedStarts == startsAt == server; sin regresión separados/single/pack-solo.

### Final: tsc + vitest + build + lint (delta 0) + revisión final opus (regla de oro end-to-end con el caso de la usuaria: pack 30@Leri + HIFU 50@Leri + masaje 60@Roman + lectura 75@Roman → 10:00 · 10:30 · 12:00 · 13:00) → deploy.
