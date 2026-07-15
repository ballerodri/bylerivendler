# Diseño — Fase 2: fusión de turnos cortos de la misma profesional en 1 hora

**Fecha:** 2026-07-15
**Estado:** EN DISEÑO (continúa la Fase 1, ya en producción `3b661ba`)

## La necesidad (palabras de la usuaria)

> "si era el mismo profesional pueda aprovechar más su horario — si tenía un turno de 20 min y un turno de 30 min y entraban dentro de 1 hr que se aproveche; pero si el otro turno era de otro profesional tiene que empezar en un horario puntual 10 11 12, no puede empezar 10:20 10:30."

## La regla

En una visita "uno tras otro":
- **Mismo profesional** + los turnos seguidos **entran dentro de 1 hora** → **comparten la hora** (el 2º arranca pegado adentro: 10:00 + 10:20). Aprovechan el tiempo de esa profesional.
- **Distinto profesional** (o no entran en 1 hora) → el turno arranca en el **siguiente horario en punto** de la grilla (10, 11, 12), nunca a las 10:20.

La **Fase 1 (ya en producción)** ya hace la parte de "distinto profesional → hora en punto". Falta **sólo** la fusión del mismo-profesional-corto.

## El corazón: `placeOnGridMerged` (puro, testeado)

Reemplaza a `placeOnGrid` (Fase 1) por una versión **consciente de la profesional**. Dado los turnos EN ORDEN, cada uno con su **duración** y su **profesional YA RESUELTA** (id concreto), la grilla del día y el slot de arranque, devuelve el minuto de inicio de cada turno:

- El 1º arranca en `startSlot` (grilla). Abre un "bloque" con su profesional.
- El turno i **se funde** con el bloque actual **si y sólo si**: su profesional es la **misma** que la del bloque **Y** termina **antes del siguiente slot de la grilla** posterior al arranque del bloque (`blockEnd + durᵢ ≤ nextGridSlot(blockStart)`). Arranca pegado (`blockEnd`).
- Si no (otra profesional, o no entra en la hora) → **nuevo bloque** en el **1er slot de la grilla ≥** el fin del bloque anterior.
- `null` si no entra en el día.

**Propiedad clave (generaliza la Fase 1):** con **todas** las profesionales distintas, `placeOnGridMerged` nunca funde → da **exactamente** lo mismo que `placeOnGrid`. Así la Fase 1 es el caso particular "sin fusión". (Se testea esta igualdad.)

Ejemplos (grilla horaria):
- 20 min@A + 30 min@A (misma) → **10:00 · 10:20** (funden, 10:50 ≤ 11:00). ✓
- 20 min@A + 30 min@**B** (distinta) → **10:00 · 11:00** (no funde, B en punto). ✓
- 40 min@A + 40 min@A (misma, 80 > 60 no entra) → **10:00 · 11:00** (no funde). ✓
- 1h@A + 1h@A (el caso de la captura) → **10:00 · 11:00** (no entra en 1h). ✓ (ya andaba así en Fase 1)

## La REGLA DE ORO con la fusión (lo delicado)

La colocación tiene que seguir siendo **pura** (sólo profesional + duración + grilla), para que el buscador, la creación de la reserva y la pantalla la reproduzcan idéntica. **La disponibilidad NO entra en la decisión de fundir** — se chequea aparte.

- **Buscador (`checkPerm`):** resuelve la profesional de cada turno con una caminata **consciente de la fusión**, y coloca con `placeOnGridMerged(profesionales resueltas)`. La caminata cumple un invariante: **dos turnos seguidos con la MISMA profesional que ENTRAN en la hora SIEMPRE se funden** (nunca quedan en bloques separados con la misma profesional pudiendo fundirse). Cuando el buscador no puede fundir por disponibilidad (la profesional del bloque está ocupada en la posición fundida), abre un **nuevo bloque con OTRA profesional libre** (distinta → `placeOnGridMerged` no funde, coincide); si no hay otra profesional capaz y libre, **ese horario no se ofrece** (falla ese slot). La disponibilidad real (`assignableStaff`/`proWorksAtSlot`) se chequea en las posiciones colocadas.
- **Creación (`planLooseServices`):** recalcula con `placeOnGridMerged(input.resolvedStaff)` — las MISMAS profesionales que el buscador resolvió y que el cliente mandó. Coincide por construcción (la colocación es pura dado el staff). Revalida cada pata contra la DB (igual que hoy).
- **Cliente (`screens.tsx`):** muestra y manda `startsAt` usando `placeOnGridMerged(resolvedStaff)` (o lo que devolvió el buscador). Coincide.

Invariante testeado: `placeOnGridMerged(staff)` es **determinístico** dado el staff; y `checkPerm` produce un `resolvedStaff` tal que `placeOnGridMerged(resolvedStaff)` reproduce su colocación. Así los tres coinciden.

## El pack es SIEMPRE su propio bloque (no se funde con los sueltos)

La 1ª sesión del pack va en `T` (grilla), su propio bloque, y **nunca se funde** con los servicios sueltos — aunque los haga la misma profesional. Motivo: la arquitectura actual crea el pack aparte (`planPack`) y los sueltos aparte (`planLooseServices`), y la creación de la reserva coloca **sólo los sueltos** vía `placeOnGridMerged(sueltos, …)`. Para que el buscador coincida (regla de oro), coloca el pack en `T` por separado y corre la fusión **sólo sobre los sueltos**, desde el 1er slot de grilla ≥ `T + D_pack`. Así `placeOnGridMerged` (que sólo ve los sueltos) es anclada-sin-memoria y los tres coinciden.

## Qué cambia y qué no

- **Cambia:** `placeOnGrid` → `placeOnGridMerged` (staff-aware) en los tres lugares. La caminata de `checkPerm` (resolución de profesional + fusión juntas). El cliente y la creación pasan a la variante con staff.
- **No cambia:** la plata, "separados", pack solo, servicio solo, la grilla, el bloqueo por pata, el portador = ventana (Fase 1). Todo lo que la Fase 1 dejó bien.
- **Compatibilidad:** con profesionales todas distintas (el caso común de pack+servicios de distinta profesional), `placeOnGridMerged` == `placeOnGrid` → **idéntico a la Fase 1** (no regresiona lo que ya anda).

## Fuera de alcance / decisiones

- **Fusión sólo de a "bloques de 1 hora"** (la grilla actual, `SLOT_MIN=60`). La capacidad del bloque es el intervalo de la grilla.
- **Auto (sin profesional elegida):** el buscador prefiere **reusar** la misma profesional en turnos seguidos capaces, para habilitar la fusión; si eso deja una posición ocupada y no hay alternativa, ese slot no se ofrece (puede ofrecer menos horarios que un solver ideal, pero **nunca** ofrece uno inválido). Es un compromiso aceptable.

## Riesgos

- **Es el buscador (`checkPerm`), la función más compleja del motor, sin tests de `createBooking`.** La resolución de profesional + fusión van juntas — el punto más delicado. El corazón (`placeOnGridMerged`) va **puro y testeado**; la caminata, con subagentes + revisión adversarial + traza de la regla de oro.
- **La regla de oro:** si la colocación dependiera de la disponibilidad, el creador (que recalcula) podría diferir del buscador. Por eso la fusión es **pura** (staff+tiempo) y la disponibilidad se chequea aparte; la caminata mantiene el invariante "misma-profesional-que-entra ⇒ funde".
- **No perder horarios:** el compromiso del auto (reusar profesional) puede ofrecer menos slots. Hay que trazar que no regresiona el caso común (profesionales distintas → idéntico a Fase 1).
