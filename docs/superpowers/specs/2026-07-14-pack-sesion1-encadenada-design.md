# Diseño — La 1ª sesión del pack encadenada con los servicios sueltos (misma visita)

**Fecha:** 2026-07-14
**Estado:** Aprobado (pendiente de plan de implementación)

## El problema (pedido de la usuaria)

> *"quizás quiera venir un mismo día para la primera sesión del pack y los demás servicios todos juntos uno después de otro, y no tengo esa posibilidad — se maneja pack y servicio por separado ahora."*

Hoy, en una compra mezclada (pack + servicios sueltos), **la 1ª sesión del pack y los servicios se agendan por separado**: la sesión del pack elige su fecha por un lado (`packSlots[0]`) y los servicios por otro (`startsAt`). Es **intencional** — hay un comentario explícito en `screens.tsx:2324-2343` de que las dos fechas **no pueden coincidir**, porque si lo hicieran `crossOverlapCheck` rechazaría la reserva. Así que no hay forma de decir *"vengo un día y me hago la sesión 1 + el facial + el dermapen, todo seguido"*.

## Decisión (acordada con la usuaria)

**Entra en la cadena del día: la 1ª sesión del pack + los servicios sueltos.** Las sesiones 2, 3 y 4 del pack se siguen agendando por separado (otros días), como hoy.

## Cómo funciona hoy (lo que hay que reusar)

- `fetchSequentialAvailability(services, fromDate)` (`actions.ts:1802`) es el buscador que encadena servicios **espalda con espalda**: prueba permutaciones, respeta las reglas de orden (`service_order_rules` y `order_last` — los masajes al final), **fija la profesional pedida** si un `ServiceInput.staffId` no es `"auto"` (`actions.ts:1747-1756`), y devuelve **un** `SlotResult` = `{ date, time, serviceOrder, resolvedStaff }`. Cada servicio arranca cuando termina el anterior, sin hueco (`checkPerm`, `actions.ts:1709-1770`).
- **Sólo ve los servicios sueltos** (`state.services`). No hay forma hoy de inyectar el servicio del pack en la cadena.
- `crossOverlapCheck` (`booking-plan.ts:51`) permite turnos **pegados exactamente** (`cur.startsAtMs < prevEnd`, `<` estricto): back-to-back está OK.
- La sesión 1 del pack es un **turno propio** (lleva `pack_purchase_id` y el precio del pack); los servicios "juntos" son **otro** turno con varias patas. No se pueden fusionar en uno.

## La arquitectura del cambio

Cuando hay **pack + servicios sueltos** y el modo de los servicios es **"juntos"** ("el mismo día, uno después del otro"), la **1ª sesión del pack se suma a esa cadena, siempre PRIMERA**:

```
[ Sesión 1 del pack (D_pack, con SU profesional) ][ servicio A ][ servicio B (masaje, al final) ]
   ^ arranca en T (el horario que elige la clienta)     ^ T + D_pack        ^ T + D_pack + D_A
```

- La sesión 1 del pack va **primera** (no intercalada): el bloque de servicios sueltos es **un solo turno contiguo**, así que el pack sólo puede ir **antes** o **después** — se elige **antes**, que es lo natural ("primero la sesión, después lo demás").
- El buscador ofrece **sólo horarios donde entra TODA la visita seguida** (pack + servicios).
- Al confirmar: la sesión 1 se crea en **T**, y el bloque de servicios en **T + D_pack** — **dos turnos separados, pegados, que no se pisan**.

### La profesional del pack, respetada (el riesgo que la usuaria marcó)

La 1ª sesión del pack se fija a **`packPro`** (la profesional que la clienta eligió en el selector del pack). Si eligió una puntual, el buscador **sólo** ofrece horarios donde **esa** persona esté libre para la sesión (el pinning de `staffId != "auto"` ya existe en `checkPerm`). Si dejó "Auto", el buscador elige una que haga el servicio del pack. **Nunca** le pone otra profesional a la sesión sólo para que "entre" el horario.

## El modelo de datos

**Ninguna migración.** Se reusa lo que ya existe:
- El buscador `fetchSequentialAvailability` gana la capacidad de recibir **un ítem inicial fijo** (el pack): un `ServiceInput` extra que va **primero** y con su profesional fijada.
- El payload de `createBooking` ya tiene `packSlots`, `packStaff`, `startsAt`, `serviceOrder`, `resolvedStaff`. Se agrega **un solo dato**: una marca de que la sesión 1 del pack va encadenada al inicio (así el servidor la ubica en **T**, no en un `packSlots[0]` elegido aparte).

## La plata (no se toca)

- La sesión 1 del pack sigue llevando **el precio del pack** (`packSessionPrices` índice 0). Las sesiones 2..N en $0. Cada servicio suelto con su precio.
- **Una sola seña = la suma de las señas de cada turno** (igual que hoy). Encadenar sólo cambia **el horario** de la sesión 1, no su precio.
- Facturación y Estadísticas: **no se tocan**.

## El flujo (UI)

1. La clienta arma la compra: un pack + servicios sueltos (ya se puede).
2. En la pantalla de fechas, con el modo **"el mismo día, uno después del otro"**:
   - La **1ª sesión del pack** deja de pedir su fecha por separado: se muestra como **"en esta misma visita"** dentro de la lista de sesiones.
   - El calendario y los horarios reflejan la disponibilidad de **toda la cadena** (sesión 1 + servicios).
   - La clienta elige **un** horario → queda agendada la visita completa.
   - Las sesiones **2, 3, 4** del pack siguen con su **"Elegir fecha"** para otros días.
3. Si elige **"cada uno en su fecha"** (separados): la sesión 1 del pack vuelve a agendarse **por su cuenta**, como hoy. (El encadenado es exclusivo del modo "juntos".)

## Validaciones (servidor, autoritativo)

| Regla | Qué pasa |
|---|---|
| El horario elegido tiene que existir en los horarios del negocio (sólo el **inicio** de la cadena) | Rechaza |
| La profesional del pack (si es puntual) tiene que estar libre en **T..T+D_pack** | El buscador no lo ofrece; el servidor revalida |
| Cada servicio suelto libre en su tramo | Ya lo hace `planLooseServices` |
| La sesión 1 (T) y el bloque de servicios (T+D_pack) **no se pisan** | `crossOverlapCheck` (pegados = OK) |
| Todo o nada + devolver los puntos si algo falla tras el descuento | Ya lo hace `rollbackAll` |

## El caso borde a cuidar

**Si el servicio del pack es TAMBIÉN uno de los servicios sueltos elegidos** (ej: compra el pack de Vela Slim *y* además Vela Slim suelto), el buscador secuencial usa el `id` del servicio como clave (`serviceOrder`, `resolvedStaff`). Meter dos ítems con el mismo `id` los haría chocar.

**Decisión:** en ese caso **no se ofrece el encadenado** — la sesión 1 del pack se agenda por separado, como hoy. Es un caso rarísimo (comprar un pack de un servicio y además ese mismo servicio suelto) y no vale la pena complicar el buscador por él. Se detecta simple: el `serviceId` del pack está entre los `serviceIds` sueltos.

## Fuera de alcance

- Encadenar **más de una** sesión del pack el mismo día (rarísimo; la usuaria eligió sólo la 1ª).
- Poner la sesión del pack **en el medio** o **al final** de la cadena (va siempre primera).
- El modo **"cada uno en su fecha"** (separados): no cambia — la sesión 1 sigue por su cuenta.
- Cobro online. Sigue siendo transferencia + comprobante.

## Riesgos

- **Toca el buscador de horarios** (`fetchSequentialAvailability`) y el código que crea los turnos (`createBooking`/`planPack`/`planLooseServices`) — el corazón de la plata y de la agenda. La regla de oro sigue: **el servidor no puede ser más estricto que el buscador** — si el buscador ofrece un horario, el servidor tiene que aceptarlo (o hay reserva perdida); si asigna a alguien ocupada, hay doble reserva. Ya rompió esta app antes.
- **La sesión 1 del pack pasa a depender del bloque de servicios** (su horario = T, el inicio de la cadena). Hoy son independientes a propósito (`screens.tsx:2324`). Ese acoplamiento es el cambio central y hay que hacerlo sin romper: (a) el pack solo, (b) los servicios solos, (c) la mezcla en modo "separados" — los tres tienen que seguir **idénticos**.
- **`createBooking` no tiene tests.** La plata y el encadenado se verifican leyendo el diff y con la prueba manual.
