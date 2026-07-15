# Diseño — Los turnos de una visita "uno tras otro" caen en la grilla de 1 hora

**Fecha:** 2026-07-15
**Estado:** EN REVISIÓN (la usuaria tiene que aprobar el diseño y decidir el alcance — ver "La decisión de alcance")

## El problema (pedido de la usuaria)

En el modo **"el mismo día, uno tras otro"** (encadenado / "juntos"), el sistema empaqueta los turnos **pegados por minutos reales**: sesión 14:00–14:20, entonces el masaje arranca **14:20**, el siguiente **15:20**. Eso hace que la profesional quede reservada **cruzando la hora en punto** (Roman ocupado 14:20–16:20), cuando el salón trabaja con **grilla de a 1 hora** (los turnos se ofrecen y se reservan 14:00, 15:00, 16:00…).

**La regla que se quiere:** cada turno de la visita cae en un **horario de la grilla** (en hora en punto), y cada profesional queda reservada **en su hora**. **Única excepción:** si dos (o más) turnos seguidos son de **la misma profesional** y **entre todos entran en 1 hora**, comparten esa hora (el 2º arranca pegado adentro del bloque — ahí sí puede aparecer un 14:20 legítimo).

## Cómo funciona hoy (lo que hay que entender)

Verificado en el código (`src/app/reserva/actions.ts`, `data.ts`, `src/lib/servicios/*`):

1. **La grilla** de horarios de inicio es una **lista fija por día** (`business_hours.slots`), que el admin arma con paso de **60 min** (`hours-editor.tsx:19`, `SLOT_MIN = 60`). En una reserva normal (un servicio, o "cada uno en su fecha") **todo cae en hora** — nunca hay un 14:20.
2. **El bloqueo de una profesional es por DURACIÓN REAL del servicio**, no por bloque de 1h (`actions.ts:1731,1448`, `endMs = start + duración*60_000`). Y el bloqueo se guarda **por pata** (`appointment_services`, cada fila con su `starts_at`/`duration_min`/`staff`), leído por `buildBusyLegs` (`availability.ts:117-155`).
3. **El encadenado** (buscador `checkPerm`, `actions.ts:1726-1780`, y escritura `planLooseServices`, `actions.ts:582-628`) camina los servicios **pegados**: `ms = sEnd` / `legMs += duración`. Sólo el 1er tramo tiene que caer en la grilla; los 2..N arrancan pegados, **fuera de la grilla a propósito** (`needsGrid = i===0 && !packChainedFirst`, `actions.ts:610`).
4. **La disponibilidad real** de cada tramo (¿la profesional de ESE tramo está libre?) se chequea tramo por tramo, en el buscador (`assignableStaff`/`proWorksAtSlot`) y de nuevo, autoritativo, al confirmar (`fetchDayAvailability`, `actions.ts:616`). La grilla sólo decide **qué horarios de inicio existen**; la disponibilidad real es aparte.
5. **La REGLA DE ORO:** el servidor (al confirmar) nunca puede ser **más estricto** que el buscador (al ofrecer). Si lo fuera, se pierde una reserva que se acababa de ofrecer. Los dos usan el **mismo** cálculo de tramos y las **mismas** consultas.

## La regla nueva (el cálculo puro)

El corazón del cambio es **dónde arranca cada turno de la cadena**. Se saca a un módulo **puro y testeado** (`src/lib/servicios/*`), que dado:
- los servicios **en orden**, cada uno con su **profesional resuelta** y su **duración**,
- la **grilla del día** (los horarios de inicio disponibles), y
- el **horario de arranque** elegido (un slot de la grilla),

devuelve **el horario de inicio de cada turno**, con esta regla:
- El **1er turno** arranca en el slot elegido (grilla).
- Un turno siguiente **comparte el bloque** del anterior (arranca pegado, dentro de la misma hora) **si y sólo si**: es de la **misma profesional** que el bloque actual **y** entra antes del **siguiente slot de la grilla** (o sea, el bloque no se pasa de la hora).
- Si no (otra profesional, o no entra en la hora): el turno arranca en el **siguiente slot de la grilla ≥ donde terminó el bloque anterior**.
- Si no queda slot en el día → no hay horario (esa combinación no entra ese día).

Ejemplo de la usuaria (sesión 20 min con A a las 14:00 + masaje 1h con B + reflexo 1h con B): A≠B y los masajes son de 1h → **14:00 · 15:00 · 16:00** (cada uno en su hora, con hueco 14:20–15:00). Excepción (cejas 15 min + perfilado 20 min, misma profesional): **14:00 · 14:15** (comparten la hora).

Esta función es **pura** (sin fecha real, sin DB): se puede testear a fondo antes de tocar el motor, como se hizo con `visit-timeline`, `slot-overlap`.

## Dónde se enchufa (y la regla de oro)

El **mismo** cálculo puro se usa en los tres lugares, para que nunca discrepen:
1. **Buscador** (`checkPerm`/`trySlot`, `actions.ts`): en vez de caminar pegado (`ms = sEnd`), coloca cada tramo con la regla de grilla y chequea que la profesional de **cada** tramo esté libre en **su** horario (misma disponibilidad real que hoy: `assignableStaff`/`proWorksAtSlot`).
2. **Escritura** (`planLooseServices`, `actions.ts:582-628`): arma las patas con los **mismos** horarios de grilla, y revalida cada una contra la DB (`fetchDayAvailability`) — igual que hoy, pero con los horarios nuevos.
3. **Cliente** (`screens.tsx`): el cálculo de los horarios que se muestran y el `startsAt` que se manda usan la **misma** función (hoy es `looseChainStartMs`/`packDurationMin`/`juntosItems`, pegado por minutos).

La **regla de oro** se mantiene: buscador y servidor colocan los tramos **idéntico** (misma función pura) y chequean la **misma** disponibilidad real. La revisión tiene que trazar que el servidor no quede más estricto.

## Detalles a resolver (decididos acá, para que los veas)

- **El turno "portador":** hoy es UN `appointment` con `duration_min` = suma de las patas (contiguas). Con huecos, la ventana real de la visita (primer inicio → último fin) es más larga que la suma. El bloqueo real es **por pata** (no por el portador), así que esto es cosmético/registro: se propone que el portador guarde como duración **la ventana completa** (último fin − primer inicio) para que su `ends_at` represente bien la visita. **No cambia** el bloqueo ni la plata.
- **La seña / la plata:** **no cambia.** Sigue siendo `amountDueNow(totalCents)` del portador (o la suma en separados). El precio no depende de dónde caen los horarios.
- **Alcance de servicios afectados:** todo lo que hoy va "juntos" en UN turno — varios servicios sueltos "juntos", **combos**, y la 1ª sesión del pack encadenada (`packChainedFirst`). Los **packs** ya eligen cada sesión en la grilla (sin cambio). "Cada uno en su fecha" (separados) ya está en grilla (sin cambio). Pack solo / servicio solo (sin cambio).

## La decisión de alcance (esto lo decidís vos)

La **excepción de la fusión** ("2 turnos cortos de la misma profesional comparten la hora") es lo que más complica el motor: la fusión depende de **qué profesional** resolvió el buscador para cada tramo, y esa resolución depende de los horarios — se enredan. Propongo dos caminos:

- **Opción A — En dos fases (recomendado por riesgo).**
  - **Fase 1:** cada turno en **su propia hora** de la grilla (sin fusión). Resuelve el 99% (nunca más un 14:20 en los casos comunes: pack+servicios de distinta profesional, servicios de 1h). Es un cambio **más simple y seguro** que el motor de hoy (coloca en slots de grilla, sin la matemática por-minutos). Dos servicios cortos de la misma profesional gastarían una hora cada uno (14:00 y 15:00) en vez de compartir — no es *incorrecto*, sólo menos eficiente.
  - **Fase 2:** se agrega la **fusión** (misma profesional, entran en 1 hora → comparten, 14:00 + 14:15). Sólo cuando la Fase 1 esté sólida en producción.
- **Opción B — Todo junto** (grilla + fusión en un solo cambio). Entrega la regla completa de una, pero es más grande y riesgoso en el camino de ingresos.

**Mi recomendación: Opción A (fases).** Baja mucho el riesgo, entrega el valor principal ya, y la fusión (un caso de borde en este salón, donde casi todo es de 1h) se agrega después con calma. Pero es tu llamada.

## Fuera de alcance / no se toca
- La plata, la seña, `createBooking` fuera del cálculo de horarios, el payload salvo los horarios.
- "Cada uno en su fecha" (separados), pack solo, servicio solo, la fila de puntos.
- La grilla en sí (la sigue definiendo el admin con `SLOT_MIN`).

## Riesgos
- **Es el motor de reservas (camino de ingresos), sin tests en `createBooking`.** Toca el buscador y la escritura. Por eso el corazón (la colocación en grilla) va como **módulo puro testeado**, y el resto con subagentes + revisión adversarial + traza de la regla de oro.
- **La regla de oro:** si el servidor colocara los tramos distinto del buscador, o chequeara disponibilidad más estricta, se pierde una reserva ofrecida. Hay que trazar que usan la MISMA función y las MISMAS consultas.
- **Reemplaza el "sin huecos":** puede quedar espera entre turnos (la usuaria ya lo eligió a sabiendas).
- **`packChainedFirst`:** hoy relaja la grilla del 1er tramo suelto (arranca fuera de grilla a propósito). Con la regla nueva, **todo** cae en grilla — esa relajación cambia de sentido y hay que rehacerla con cuidado (el 1er servicio suelto ya no arranca en `T + D_pack`, sino en el siguiente slot de grilla).
