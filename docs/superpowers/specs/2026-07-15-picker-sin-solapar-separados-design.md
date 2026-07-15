# Diseño — El selector no ofrece horarios que se pisen (modo "cada uno en su fecha")

**Fecha:** 2026-07-15
**Estado:** Aprobado (pendiente de plan de implementación)

## El problema (pedido de la usuaria)

En el modo **"Cada uno en su fecha y horario"** (separados), el selector de fecha de cada servicio (y de cada sesión del pack) **sólo mira su propia disponibilidad**: le pregunta al servidor "¿está libre la profesional a las 15:00 para este servicio?" — y cada servicio, por su lado, puede estar libre a las 15:00. Lo que el selector **no** mira es que la clienta **ya eligió otro servicio a las 15:00 ese mismo día**. Recién al final la regla "no podés estar en dos lugares a la vez" (`validateSeparateSlots`, el cartel rojo) lo detecta y **deja el botón "Continuar" bloqueado** — así que nunca se guarda una reserva pisada, pero la clienta se entera **después** de elegir.

Ejemplo real: Masaje relajante y Reflexología, los dos con Roman Otero. El selector ofrece 15:00 para los dos; la clienta elige 15:00 en ambos; recién ahí aparece *"Reflexología se superpone con Masaje relajante. No podés estar en dos servicios a la vez."*

## La decisión (acordada con la usuaria)

Cuando la clienta abre el selector de un servicio (o de una sesión del pack), los horarios que se **pisarían con algo que ya eligió ese mismo día** se muestran **en gris, no clickeables, con el motivo**. Los horarios libres se eligen normal; los grises no.

## Qué cuenta como "ocupado"

**La propia agenda de la clienta ese día** — todo lo que ya eligió en esta misma reserva. **Vale aunque lo haga otra profesional**, porque la clienta es una sola persona (misma regla que hoy tira el cartel rojo). Por selector:

- **Selector de un servicio suelto** (eligiendo el servicio X): bloquean los **demás servicios** ya elegidos (`serviceSlots`, menos el X) **y todas las sesiones del pack** ya elegidas (`packSlots`). El motivo de un servicio usa su nombre (*"Ya tenés Masaje relajante a esta hora"*); el de una sesión del pack usa el nombre del pack (*"Ya tenés Vela Slim (pack) a esta hora"*).
- **Selector de una sesión del pack**: bloquean **todos los servicios sueltos** ya elegidos. *(El solapamiento sesión-contra-sesión del pack ya lo evita hoy la regla de intervalo `minForPackSession` — cada sesión arranca cuando termina la anterior, y al cambiar una se re-eligen las siguientes. Por eso este selector sólo necesita mirar los servicios.)*

## Cómo funciona (técnico)

**El componente `PackSessionPicker`** (`src/app/reserva/_components/pack-session-picker.tsx`) es el mismo para los dos casos (servicios sueltos y sesiones del pack), así que el cambio va **una sola vez** ahí:

- Gana una prop nueva **`blockedIntervals?: { startMs: number; endMs: number; name: string }[]`** — los tramos ya ocupados por la clienta (en UTC ms), con el nombre de lo que ocupa cada uno (para el motivo).
- Cada candidato de horario `t` del día ya tiene su arranque en UTC ms vía `slotToUtcMs(selectedDate, t)` (ya se usa en el componente). Su tramo es `[tStart, tStart + durationMin*60000)`. Se considera **pisado** si se solapa con algún `blockedInterval`: `tStart < b.endMs && tStart + durationMin*60000 > b.startMs` (solapamiento estricto — adyacente NO pisa, igual que `crossOverlapCheck`/`validateSeparateSlots`).
- Los tramos elegidos vienen como ISO (`serviceSlots[id]`, `packSlots[i]`); su ms es `new Date(iso).getTime()`, su fin `+ duración*60000`. La duración de un servicio es `effectiveService(s, zoneSel).duration`; la de una sesión del pack es `packDurationMin`. Todo en UTC ms — sin ambigüedad de zona horaria.

**Los call sites** (en `screens.tsx`, `Screen2DateTime`) arman el `blockedIntervals` de cada selector con los datos que ya tienen a mano (`serviceSlots`, `packPicked`, `effectiveService`, `packDurationMin`, `state.services` para los nombres).

## Presentación (gris + motivo)

- **El horario pisado** se dibuja **en gris y no clickeable** (mismo estilo apagado que ya usa la lista informativa "Horarios individuales": `opacity: 0.5; cursor: default`), en vez del botón normal.
- **En escritorio:** cada horario gris lleva un `title` (tooltip al pasar el mouse) con el motivo exacto — *"Ya tenés Masaje relajante a esta hora"*.
- **En celular (sin hover):** debajo de la grilla, cuando hay al menos un horario gris ese día, una línea aclaratoria que **nombra** lo que ocupa — *"Los horarios en gris se superponen con: Masaje relajante (15:00–16:00)."* (lista los tramos bloqueados que caen en el día elegido).

Así el motivo se ve en los dos lados (tooltip + línea de abajo).

## Fuera de alcance

- **El modo "juntos"** (el mismo día, uno tras otro): no cambia — ahí el sistema ya arma la cadena sin huecos.
- **La reserva, la plata, el payload, `createBooking`, el backend:** no se tocan. Es un filtro **de presentación** sobre horarios que el servidor ya devolvió.
- **El cartel rojo `validateSeparateSlots`:** se queda igual, como **red de seguridad final** (por si el estado viene de una sesión vieja de localStorage). Deja de aparecer en el uso normal porque el gris lo evita antes.
- **La lista informativa "Horarios individuales disponibles hoy"** (en el modo juntos, cuando no hay cadena): no cambia — es sólo un dato por servicio, no se reserva desde ahí.
- **El calendario:** si un día quedara con **todos** los horarios en gris (la clienta ya lo llenó con otros turnos), el día se abre igual y muestra todo gris con el motivo. Caso raro; no se complica la lógica del calendario por eso.

## Riesgos

- **Es la pantalla de reserva (camino de ingresos).** El cambio es de presentación, pero toca el selector de fechas y sus dos call sites. El selector se usa además desde el **admin** (`pack-sessions.tsx`, con `serviceId: null`): la prop nueva es **opcional**, así que sin pasarla el comportamiento es **idéntico al de hoy** — el admin no se toca.
- **El cálculo del solapamiento tiene que coincidir con la regla que hoy valida** (`validateSeparateSlots`/`crossOverlapCheck`): solapamiento **estricto** (adyacente NO pisa). Si el gris fuera más estricto que la validación, se ocultarían horarios válidos; si fuera menos, volvería a colar un pisado. La revisión tiene que trazar que el gris usa la MISMA regla.
- **`PackSessionPicker` y la pantalla no tienen tests.** La lógica del solapamiento es **pura** y conviene extraerla a un módulo testeable (`src/lib/servicios/`), como se hizo con `visit-timeline`.
