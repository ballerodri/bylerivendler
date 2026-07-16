# Diseño — Fase 3: misma profesional → pegados SIEMPRE (sin el tope de 1 hora)

**Fecha:** 2026-07-16
**Estado:** Aprobado por la usuaria (su ejemplo concreto define la regla)

## El pedido (palabras de la usuaria, viendo la confirmación real)

> "los turnos 10:00 y 11:00 son la misma profesional; si el primero dura 30 min terminaría 10:30 y el segundo de 50 min iniciando 10:30 iría hasta las 11:20 — lo correcto sería 10:00 Vela, **10:30 HIFU**."

Con Vela (sesión del pack, 30 min) y HIFU (50 min) de la MISMA profesional, hoy quedan 10:00 y 11:00 (la Fase 2 sólo pega si **entran juntos en 1 hora**; 30+50=80 > 60 → no pegó). La usuaria define la regla final, más simple:

## La regla (Fase 3 — reemplaza el tope de 1 hora de la Fase 2)

- **Misma profesional → el turno siguiente arranca PEGADO al anterior** (fin del anterior), siempre — aunque cruce la hora en punto (10:30, 11:20…).
- **Distinta profesional → el turno arranca en el siguiente slot de la grilla** (hora en punto: 10, 11, 12), nunca a mitad de hora.
- Consecuencia: cada profesional atiende **de corrido** (sus turnos contiguos) y los cambios de profesional caen en punto. (El orden por profesional ya se prefiere desde el cambio `94d4821`.)

## El pack YA NO es un bloque aparte

La Fase 2 forzaba "el pack nunca se funde con los sueltos". Con la regla nueva, **la sesión 1 del pack se encadena con el primer servicio suelto si lo hace la misma profesional** (Vela 10:00–10:30 → HIFU 10:30). Si el primer suelto es de OTRA profesional, arranca en el siguiente slot de grilla ≥ fin del pack (como hoy).

## El corazón: `placeOnGridChained` (puro — reemplaza la semántica de `placeOnGridMerged`)

Dado los ítems EN ORDEN con su profesional RESUELTA, la grilla y el arranque:
- Ítem 0 arranca en `startSlot`.
- Ítem i: si `staffId === staff del anterior` → arranca en el **fin del anterior** (pegado). Si no → en el **1er slot de grilla ≥ fin del anterior**. `null` si no entra en el día.
- Ya no hay bloques ni `nextGrid`/`fits`: la regla es sólo "misma profe → pegado; distinta → en punto".
- **Propiedades (testeadas):** con todos los staff distintos == `placeOnGrid` (Fase 1). Anclada-sin-memoria (cada paso depende sólo del fin y la profe del anterior) → el server (que coloca sólo los sueltos desde `startsAt`) reproduce al buscador **si `startsAt` = el inicio del 1er suelto**, sea mitad de hora (pegado al pack) o slot de grilla.

## La regla de oro (igual que Fase 2, adaptada)

- **Buscador (`checkPerm`):** la caminata pierde `fits` y `isLeadBoundary` (el pack es el ítem 0 de la cadena, como cualquier otro). Fusión = misma profe del bloque anterior + libre en la posición pegada. Si no puede fundir por disponibilidad, la nueva profe **debe ser distinta** (`excludeStaff = profe anterior`, ahora SIEMPRE que hubo profe anterior) — así `placeOnGridChained(assignment)` reproduce la caminata. Compromiso igual que Fase 2: si la única capaz está ocupada en la posición pegada, ese slot no se ofrece.
- **Cliente:** manda `startsAt` = inicio del 1er suelto (de `resolvedStarts`) — puede ser **mitad de hora** (pegado al pack) o slot de grilla.
- **Creación (`planLooseServices`):** la validación del arranque de cadena acepta: slot de grilla **O** exactamente `packSlots[0] + duración de la sesión 1` cuando viene con pack encadenado (la única mitad-de-hora legítima como arranque). La colocación interna usa `placeOnGridChained(resolvedStaff)` → coincide. La revalidación real por pata (`fetchDayAvailability`) intacta.
- **Carrera del auto del pack (edge aceptado):** si `packStaff` = "auto", el buscador pudo fundir asumiendo que el pack resuelve a la misma profe que el 1er suelto; el server re-resuelve el auto del pack y podría elegir otra (carrera). Nada se pisa (crossOverlapCheck + disponibilidad real); sólo el "mismo-profe" estético puede variar. Misma semántica de carrera que ya tiene el auto.

## Qué NO cambia
- Bloqueo por duración real (por pata) — ya cubre el caso "Lectura 1h15 ocupa hasta 14:15; nadie puede reservar a Roman a las 14:00". Verificado en datos y código.
- Distinta profesional → hora en punto (Fase 1). Separados / pack solo / servicio solo / plata / grilla / portador=ventana.
- El orden por profesional (agrupar, `94d4821`).

## Riesgos
- Motor de reservas sin tests de `createBooking` (igual que Fases 1-2): corazón puro testeado + SDD con revisión adversarial + traza de la regla de oro.
- La validación del arranque de cadena mitad-de-hora es el punto delicado nuevo: tiene que aceptar EXACTAMENTE `T + D_pack` (ni cualquier mitad de hora, ni rechazar la legítima). El server conoce `packSlots[0]` y calcula `firstDuration` en `planPack` — `createBooking` se lo pasa a `planLooseServices`.
