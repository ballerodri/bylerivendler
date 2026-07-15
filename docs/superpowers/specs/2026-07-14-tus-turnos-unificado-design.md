# Diseño — Unificar la reserva en "Tus turnos" (fechas + confirmación)

**Fecha:** 2026-07-14
**Estado:** Aprobado (pendiente de plan de implementación)

## Los problemas (pedido de la usuaria)

1. **Bug de visualización en la confirmación (encadenado):** en modo "el mismo día, uno después del otro", la confirmación muestra la 1ª sesión del pack y los servicios **encimados** — la sesión a las 13:00 y el facial también a las 13:00. **La reserva NO se guarda encimada** (`pay()` manda el bloque de servicios en `T + D_pack`, así que en la agenda queda sesión a las 13:00 y facial a las 13:20). El bug es **sólo cómo lo muestra la confirmación**: calcula los horarios de los servicios desde `selectedTime` (el arranque de la visita, T) en vez de `T + D_pack`.
2. **Dos secciones separadas** ("Tus sesiones" del pack + "Tus servicios") — la usuaria quiere **una sola: "Tus turnos"**, tanto en la pantalla de fechas como en la confirmación.

## Confirmación importante (para no asustar)

**Lo que se reserva es correcto.** `createBooking` crea la sesión 1 en T y el bloque de servicios en T+D_pack (pegados, sin pisarse). Este trabajo es **presentacional** (la única corrección funcional es el cálculo de los horarios que **muestra** la confirmación). La plata, el payload, el encadenado y `createBooking` **no se tocan**.

## Decisiones (acordadas con la usuaria)

1. **Una sola sección "Tus turnos"** — se van los encabezados separados "Tus sesiones" / "Tus servicios".
2. Se conserva el elegir **"el mismo día, uno después del otro"** vs **"cada uno en su fecha"**.
3. **Modo "el mismo día":** con un pack, sólo se agenda la **1ª sesión** en esa visita (encadenada); las demás sesiones se agendan después. La lista muestra la visita completa en orden.
4. **Modo "cada uno en su fecha":** se pueden agendar **todos** los servicios **y todas** las sesiones del pack, cada uno con su fecha (ya se puede hoy; sólo se unifica visualmente).

## Cómo queda la pantalla de fechas

**Una** sección **"Tus turnos"**, con el selector de modo arriba y, debajo:

- **El mismo día, uno después del otro:**
  - El calendario + horarios para elegir **el horario de la visita** (uno solo).
  - La lista de lo que entra en la visita, en orden y con su hora: *Sesión 1 del pack · 13:00 · Vela Slim · HIFU Facial · 13:20 · Dermapen · 14:10*. (Antes de elegir horario, sin las horas.)
  - Debajo: *"Las otras 3 sesiones del pack las agendás después"* (con "Elegir fecha" opcional para 2..N, como hoy).
- **Cada uno en su fecha:**
  - Una lista con **cada servicio y cada sesión del pack**, cada uno con su propia fecha ("Elegir fecha" / la fecha elegida). Todo bajo el mismo "Tus turnos".

## Cómo queda la confirmación ("Casi listo")

El bloque **"CUÁNDO"** deja de separar la sesión del pack de los servicios. Muestra **una** secuencia en orden, con los horarios **correctos**:

- **Encadenado (el mismo día + pack):**
  ```
  Sesión 1 del pack   Miércoles 15 de julio · 13:00hs · 20 min
  HIFU Facial         13:20hs · 50 min
  Dermapen            14:10hs · 1h
  · 3 sesiones del pack a agendar después
  ```
  (Los horarios de los servicios arrancan en **T + D_pack**, no en T — esto corrige el bug.)
- **Servicios "el mismo día" sin pack:** como hoy (una cadena desde T).
- **"Cada uno en su fecha":** cada servicio y cada sesión del pack con su fecha, en una lista.
- **Pack solo / servicios solos / combo:** como hoy.

**La regla del cálculo:** el arranque del bloque de servicios que se **muestra** tiene que ser **el mismo** que el que `pay()` **manda** (`startsAt`): T sin encadenado, **T + D_pack** encadenado. Hoy la confirmación usa `selectedTime` (T) siempre — ahí está el bug.

## Fuera de alcance

- **La lógica de reserva** (el encadenado, `packSlots`, `serviceSlots`, el payload, `createBooking`): **no se toca**. La reserva ya es correcta.
- **La plata:** una sola seña = la suma; sin cambios.
- **Modo "juntos" sin pack, separados, pack solo, combo:** el comportamiento no cambia; sólo se reordena/renombra la presentación, y para los servicios "el mismo día" sin pack la confirmación queda **byte-idéntica** (T + 0 = T).

## Riesgos

- **Es la pantalla de reserva (camino de ingresos principal).** El rediseño es presentacional, pero toca `screens.tsx` (~2600 líneas) con varios caminos que conviven (pack solo, servicios solos juntos/separados, combo, mezcla juntos/separados). Cada uno tiene que seguir mostrando lo correcto.
- **El cálculo de horarios que se muestra tiene que coincidir con el que se reserva** (`startsAt`). Si divergen, la confirmación vuelve a mentir. La revisión tiene que trazar que lo mostrado == lo reservado en el caso encadenado.
- **`createBooking` y la pantalla no tienen tests.** Se verifica leyendo el diff y con la prueba manual.
