# Diseño — Reservar un pack (y tratamientos) por la clienta, desde el admin

**Fecha:** 2026-07-17
**Estado:** Aprobado por la usuaria

## El pedido

> "quiero poder al igual que los turnos poder desde el admin comprar el pack como si fuese la clienta, reservar su primer sesión y que se le envíe el mail de confirmación"

Decisiones tomadas con la usuaria: va **en el asistente "Nueva reserva"** que ya existe; se pueden agendar **todas las sesiones** que la clienta ya sepa (no sólo la 1ª); y se puede sumar **pack + tratamientos sueltos** en la misma compra (como la web).

## La regla

Admin → Nueva reserva: **Clienta → Qué reserva (packs + tratamientos) → Fechas y horarios → Confirmar**.

Al confirmar, con el MISMO motor que la reserva online (`createBooking`):
- Se registra la compra del pack (`pack_purchases`) + los turnos (sesiones del pack y tratamientos), **todo o nada**, agrupados por `booking_group_id` (una sola compra en la agenda).
- Todo nace **`confirmed`** con **`deposit_paid: true`** (el salón cobra en persona; el monto real se carga después con "Registrar pago"). Los importes (total/seña) se calculan igual que siempre.
- Sale **el mail de confirmación a la clienta** (`sendGroupConfirmationEmail`) — el mismo que recibe cuando reserva por la web. Como nace todo confirmado, no queda nada pendiente y el mail sale al instante (mismo camino que el canje con puntos).
- La grilla, la disponibilidad real y la regla "misma profesional → pegados" (Fase 3) aplican igual que en la web. **Esto corrige de paso** que `createAdminBooking` encadenaba por minutos sin respetar la grilla.

## El motor compartido: `createBooking` con `adminMode`

`BookingInput` suma `adminMode?: boolean`. Cuando viene en `true`:

- **SEGURIDAD (lo primero de todo, antes de cualquier lectura o escritura):** se exige sesión de staff activa (helper nuevo exportado desde `@/lib/staff`, mismo criterio que `requireStaff` del admin). Sin staff → `{ ok: false, error: "Acceso denegado" }` y no se toca nada. `createBooking` es una server action PÚBLICA: sin esta guarda, cualquiera podría mandar `adminMode: true` y llevarse turnos confirmados sin pagar. Es el punto crítico del cambio.
- **Puntos:** `redeemWithPoints` se ignora (forzado a false). El camino del canje no corre nunca en modo admin.
- **Packs:** el pack se busca por `active = true` **sin** exigir `visible_reserva` (el salón puede vender packs que no se muestran en la web). En modo público, `visible_reserva` sigue siendo obligatorio.
- **Estado y plata:** los turnos nacen `status: "confirmed"` y `deposit_paid: true`. `total_cents`/`deposit_cents` se calculan igual que hoy (sin fórmula nueva). `paid_cents` sigue en 0: lo carga el salón con "Registrar pago".
- **La clienta autenticada NO es la clienta del turno:** en modo admin el `authUser` de la sesión es la del SALÓN. Se ignora por completo: nunca se vincula `clients.user_id` con ese usuario ni se usa para nada. (Hoy no pasaría por casualidad —los emails no coinciden— pero queda explícito.)
- **Magic link:** no se manda (hoy quedaría salteado por casualidad porque hay `authUser`; queda explícito).
- **Aviso al equipo (`notifyNewPurchase`):** no se manda — la compra la está cargando el propio salón.
- **`dob` / `marketingConsent`:** opcionales en modo admin (el asistente del admin no los pide).
- Todo lo demás es **idéntico** al camino público: planificación, validación cruzada (`crossOverlapCheck`), revalidación de disponibilidad por pata, escritura todo-o-nada con `rollbackAll`, Google Calendar, `booking_group_id`.

**Clienta existente:** el asistente manda `savedClientId` (ya soportado). **Clienta nueva:** se crea por email como hoy; sin email real el asistente manda el placeholder `admin_created_…@noemail.local` (mismo formato que hoy).

**Mail a una clienta sin email real:** `sendGroupConfirmationEmail` trata `@noemail.local` como "sin email" (no manda y suelta el reclamo, mismo camino que el email vacío). El asistente avisa en pantalla, ANTES de confirmar, que esa clienta no va a recibir el mail.

## El asistente (`/admin/nueva-reserva`)

- **Paso "Qué reserva"** (hoy "Servicios"): arriba, los **packs activos** (nombre · N sesiones · precio; con selección de zonas si el servicio del pack es por zona); abajo, los tratamientos como hoy. Se puede elegir un pack, tratamientos, o ambos.
- **Paso "Fechas y horarios"**: si hay pack, se eligen las fechas/horarios de las sesiones con el `PackSessionPicker` que ya existe (respeta `interval_days`, con la opción de saltearlo que ya tiene el admin); se pueden dejar sesiones sin agendar (quedan para después en la ficha). Si hay tratamientos, se elige su horario con el buscador de siempre (`fetchSequentialAvailability`).
- **Pack + tratamientos:** cada parte con su fecha propia; el arranque de los tratamientos es un slot de la grilla (`packChainedFirst: false`). El encadenado "el 1er tratamiento pegado a la sesión del pack" queda fuera de alcance en el admin (la web lo sigue teniendo).
- **Paso "Confirmar"**: itinerario completo (mismo orden cronológico que ve la clienta) + total + aviso de "no tiene email" si corresponde.

## Qué NO cambia

- `venderPack` de la ficha (vender sin agendar, con "Facturar ahora") sigue igual.
- La reserva online, la plata, los puntos, la facturación ARCA, la agenda agrupada, el portal.
- `createAdminBooking` (turnos manuales sin pack) sigue existiendo para el camino de hoy; **no se toca en este trabajo**.

## Riesgos

- `createBooking` es el corazón de la plata y **no tiene tests**: el cambio se hace por fases con revisión adversarial en cada una.
- La guarda de `adminMode` es el punto crítico (privilegios): lleva una revisión de seguridad dedicada que trace el camino "visitante manda `adminMode: true`" y confirme que no escribe nada.
- Modo admin y modo público comparten motor: cualquier regresión afectaría a los dos. La revisión final tiene que trazar el camino público sin `adminMode` y confirmarlo byte-equivalente.
