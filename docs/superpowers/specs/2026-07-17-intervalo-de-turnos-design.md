# Diseño — Intervalo de turnos configurable (30 min / 1 hora)

**Fecha:** 2026-07-17
**Estado:** Aprobado por la usuaria (intervalo ÚNICO para todos los días; bloqueos del personal convertidos automáticamente)

## El pedido

> "las reservas tienen intervalos de 1 hora, podemos eso cambiarlo desde el menú admin en algún lugar? porque ahora quiere intervalos de 30 minutos no de 1 hora"

## La regla

En **Admin → Horarios**, arriba de los días: **"Los turnos se ofrecen cada: 30 min / 1 hora"**. Cambia cómo se generan los horarios de **todos** los días abiertos (uno solo para todo el salón). Al guardar, la grilla nueva queda vigente para la reserva online, el asistente del admin y las horas bloqueadas del personal.

**El intervalo NO se guarda como ajuste aparte: se DEDUCE de los horarios guardados.** `business_hours.slots` ya es la fuente de verdad de la grilla (el motor siempre leyó "los horarios que estén guardados", sin asumir 1 hora). Deducirlo evita una migración y hace imposible que el ajuste diga una cosa y los datos otra.

## Las piezas

### 1. Núcleo puro: `gridStepMin(slots)` (`src/lib/servicios/grid-step.ts`)
La MÍNIMA diferencia positiva entre horarios consecutivos ordenados; 60 por defecto con menos de 2 horarios. La mínima (no el promedio) porque una pausa del mediodía deja un salto grande que no es el paso.

### 2. Editor de horarios (`src/app/admin/horarios/hours-editor.tsx`)
`SLOT_MIN` (hoy constante 60) pasa a ser un estado 30 | 60, arrancado con `gridStepMin` de lo guardado. Al cambiarlo se regeneran los horarios de todos los días abiertos. `configFromHour` (que deduce apertura/cierre/pausa de los slots) usa el paso deducido en vez de la constante.

### 3. Bloqueos del personal: conversión automática (`updateBusinessHours`)
Cada fila de `staff_blocked_slots` significa "esta profesional NO está disponible durante **un paso** desde ese horario". Al cambiar el paso, las filas ya cargadas tienen que convertirse **en la misma operación**, o la disponibilidad miente:
- **1 hora → 30 min:** cada fila se DUPLICA (`08:00` → `08:00` + `08:30`), siempre que el horario nuevo exista en la grilla del día. La disponibilidad queda idéntica a la de hoy.
- **30 min → 1 hora:** cada fila colapsa al comienzo de su hora (`08:30` → `08:00`), deduplicando. Bloquea **de más** — dirección segura: nadie queda "libre" cuando no lo está.
- Sólo se tocan los días cuya grilla cambió. Si la conversión falla, la operación entera falla (los horarios tampoco se guardan): mejor no cambiar nada que dejar la agenda mintiendo.

### 4. El bloqueo dura un paso, no 60 min fijos (`src/app/reserva/actions.ts`)
`SLOT_BLOCK_MIN = 60` desaparece como constante: `proWorksAtSlot` pasa a usar el paso **del día que evalúa** (mapa `dow → paso`, armado con `gridStepMin` sobre las filas de `business_hours` que la función ya tiene a mano). Sin esto, con grilla de 30 una casilla tildada seguiría bloqueando 60 min (bloquearía de más) y con grilla de 1 h media hora (bloquearía de menos → doble reserva).

### 5. Tope del cierre del día (`grid-schedule.ts` + su espejo en `checkPerm`)
El tope que agregamos ayer (`último horario + 60`) pasa a `último horario + paso`, deducido de la misma grilla que ya recibe. Con grilla de 1 h no cambia nada.

## Consecuencia buscada

La regla "**distinta profesional → el turno arranca en un horario de la grilla**" pasa sola a permitir **y media** (10:00, 10:30, 11:00…). "Misma profesional → pegados" no cambia. La usuaria lo confirmó explícitamente.

## Qué NO cambia

La plata, los mails, la agenda, los packs, la regla de la Fase 3, la reserva online (que ya leía la grilla guardada). Los turnos YA reservados no se mueven: siguen en su horario, y su bloqueo real sale de la duración del servicio, no de la grilla.

## Limitación conocida (documentada por la revisión final)

Yendo de **fino a grueso** (30 → 1 hora) **con una pausa que no queda alineada** a la grilla nueva, una fila bloqueada puede no tener ningún horario nuevo que la cubra y se descarta (la grilla gruesa no puede representar esa media hora). No es alcanzable con la configuración de hoy (no hay pausa cargada, y el primer movimiento es 60 → 30, que no descarta nada). Como no hay un horario "correcto" al que llevarla —arrastrarla al anterior bloquearía un rato en el que la profesional SÍ trabaja—, se descarta y **se avisa en pantalla** ("Revisá Admin → Personal: N horas bloqueadas no entraban en la grilla nueva").

## Riesgos

- **Es un cambio de disponibilidad de todo el salón.** Lo delicado es la conversión de bloqueos: mal hecha, alguien figura libre cuando no lo está (doble reserva) o al revés (se pierden turnos).
- Los turnos existentes quedan en horarios que puede que ya no estén en la grilla (ej. reservado 14:00 con grilla nueva de 30 → sigue siendo 14:00, y está bien). Nada los revalida contra la grilla: sólo el ARRANQUE de una reserva NUEVA se exige en grilla.
- `createBooking` sigue sin tests: el cambio se hace por fases con revisión adversarial y con el núcleo (`gridStepMin`, tope del día) testeado.
