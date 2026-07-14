# Diseño — Un pack + servicios sueltos en la misma reserva, con una sola seña

**Fecha:** 2026-07-14
**Estado:** Aprobado (pendiente de plan de implementación)

## El problema

Hoy el pack es **excluyente**, en los dos lados:

- **En la pantalla:** elegir un pack **borra** los servicios sueltos y el combo (`screens.tsx:155`), y elegir un servicio **borra** el pack (`screens.tsx:171`).
- **En el servidor:** la rama del pack (`actions.ts:322`) **retorna sola** (`:524`) — nunca llega al código que crea los turnos de los servicios sueltos.

Así que una clienta que quiere el pack de Vela Slim **y** una limpieza facial tiene que hacer **dos reservas** y pasar **dos señas**. Es el mismo problema que resolvimos para los servicios sueltos entre sí, pero con el pack afuera.

## Decisiones (acordadas con la usuaria)

1. **Un (1) pack + N servicios sueltos.** No hay carrito de varios packs: no es un caso real, y multiplicaría la superficie de error con la plata.
2. **Los combos siguen siendo excluyentes.** Un combo tiene precio propio que reemplaza la suma de sus servicios; mezclarlo complica el precio sin un caso que lo pida.
3. **Las fechas:** el pack conserva **su** lista de sesiones (la 1ª obligatoria, el resto opcionales), y los servicios sueltos conservan **su** modo actual — *"el mismo día, uno después del otro"* (juntos) o *"cada uno en su fecha"* (separados). No se unifican en una sola lista.
4. **Una sola seña:** la suma de las señas de cada turno. Una sola transferencia.
5. **Si hay un pack en la compra, NO se ofrece canjear con puntos.**

## Por qué NO "comprar ahora, agendar después"

Se evaluó y se descartó. **La app no cobra** (no hay pasarela): "cobrar la seña" es mostrar un número para transferir. Así que mover el pago antes o después de las fechas **no cambia el riesgo** — sólo reordena pantallas.

Y llevarlo al extremo ("compro sin elegir ninguna fecha") es **más** trabajo, no menos: hoy **un servicio comprado ES un turno**; no existe "comprado pero sin agendar" para servicios sueltos. Crear ese concepto choca de frente con Facturación y Estadísticas, que leen la plata **del turno** (`appointments.total_cents`) — la venta sería **invisible** hasta que se agende. Es exactamente la trampa del precio del pack que hubo que revertir. Ver [[project_pack_multi_sesion]].

## La regla de oro (no negociable)

**La plata NO se mueve entre turnos.** Cada turno lleva lo suyo:

| | `total_cents` | `deposit_cents` |
|---|---|---|
| Sesión 1 del pack | el precio **del pack** | `amountDueNow(precio_pack, elección)` |
| Sesiones 2..N del pack | **0** | 0 |
| Cada servicio suelto | el precio **de ese servicio** | `amountDueNow(precio_servicio, elección)` |

**La seña que se le muestra = la SUMA de los `deposit_cents` de todos los turnos.** No es el 30% del total: cada turno redondea el suyo, y la suma de los redondeos puede diferir del redondeo de la suma. Ella transfiere **exactamente** lo que ve.

`packSessionPrices` se sigue llamando **UNA sola vez por compra** (el índice 0 lleva el precio del pack). Facturación y Estadísticas **no se tocan**.

## La arquitectura: tres fases, un solo "todo o nada"

Hoy `createBooking` tiene **tres caminos que retornan cada uno por su lado**: pack (`:322-524`), separados (`:567-797`), juntos (`:798-1064`). El pack corre **antes** del descuento de puntos y **antes** de buscar la sala; los otros dos, después. Por eso no pueden convivir.

Se reestructura en **fases**, con **una sola** región de escritura:

### Fase A — Resolver (sin escribir nada)
Servicios, zonas, precios efectivos, el pack y su servicio, la clienta. Como hoy.

### Fase B — Validar TODO junto (sin escribir nada)
- Las fechas de las sesiones del pack (intervalo, futuras, entre sí) — como hoy.
- Las fechas de los servicios (juntos: la cadena; separados: cada una).
- **NUEVO: la no-superposición CRUZADA.** La Sesión 2 del pack no puede pisar la limpieza facial. Hoy cada camino se chequea **por su lado**, porque nunca conviven. **La clienta es una sola.**
- Cada horario, revalidado contra la disponibilidad real (con la duración y la profesional de **ese** servicio).
- **Si hay pack y llega `redeemWithPoints`, se rechaza.**

### Fase C — Escribir, todo o nada
1. Descontar los puntos (sólo si NO hay pack).
2. Crear la `pack_purchase` (si hay pack).
3. Crear **todos** los turnos (sesiones del pack + servicios).
4. **Si algo falla:** borrar los turnos creados, borrar la `pack_purchase`, **devolver los puntos**, y no dejar nada a medias.

Se unifican `rollbackPackAttempt` y `rollbackBookingAttempt` en **un solo** `rollbackAll(created, refund, error)` que sabe deshacer las tres cosas.

### Fase D — Avisos (best-effort, los turnos ya existen)
Google Calendar (un evento por turno), **un solo** mail a la clienta listando todo con **una sola** seña, un aviso por turno al salón, magic link.

## El requisito más importante

**Cuando NO se mezclan, el resultado tiene que ser idéntico al de hoy.**

- Un **pack solo** → los mismos turnos, la misma plata, la misma `pack_purchase`.
- **Servicios solos** (juntos o separados) → idéntico.
- Un **combo** → idéntico (sigue siendo un turno).

Esto se verifica en la revisión, comparando contra `main`. El modo "juntos" es el camino de ingresos principal del salón: **cualquier regresión ahí es crítica**.

## Los puntos (y el bug latente que se cierra)

Hoy, si llegara `packId` **y** `redeemWithPoints`, la rama del pack **retorna antes** del bloque de canje: el pack se crearía **sin descontar los puntos** y sin poner nada en $0. Es un agujero latente (hoy inalcanzable porque la UI no ofrece canje con un pack elegido).

Al fusionar los caminos ese agujero pasa a ser **alcanzable**. Se cierra explícitamente: **con un pack en la compra, el canje se rechaza en el servidor** y no se ofrece en la pantalla.

⚠️ **Invariante que ya se rompió tres veces:** los puntos se descuentan **antes** de crear los turnos. **Todo** `return` de error posterior **tiene que devolverlos** (`rollbackAll`). Ver [[project_reserva_pagos_separados]].

## La pantalla

1. **Screen1 (elegir):** `togglePack` deja de borrar los servicios y `toggle` deja de borrar el pack. El combo sigue borrando ambos (y viceversa).
2. **Screen2 (fechas):** con pack **y** servicios, se muestran **las dos secciones**: arriba la lista de sesiones del pack; abajo los servicios con su selector *juntos / separados*. El botón de continuar exige: la **Sesión 1** del pack **y** todas las fechas de los servicios (si eligió separados) o el horario de la cadena (si eligió juntos).
3. **Screen5 (confirmar):** lista todo, y muestra **una sola seña** = la suma. La elección *seña / total* sigue disponible. El canje **no** se ofrece.
4. **Éxito:** ya muestra N turnos (`?id=a,b,c`) y relee los `deposit_cents` de la base. Sin cambios.

⚠️ **El estado del wizard vive en `localStorage`.** Una compra a medias con la forma vieja tiene que descartarse: **subir `FLOW_VERSION`**. Y `clearedResolution` tiene que seguir limpiando lo que corresponda al cambiar la compra (una fecha vieja de un servicio que ya no está deja la compra **muerta**).

## Validaciones (servidor, autoritativo)

| Regla | Mensaje |
|---|---|
| La 1ª sesión del pack es obligatoria | "Elegí la fecha de la primera sesión." |
| Todas las fechas de los servicios (modo separados) | "Elegí fecha y hora para cada servicio." |
| **Ningún turno se superpone con otro** (sesiones del pack **y** servicios entre sí) | "*(X)* se superpone con *(Y)*. No podés estar en dos servicios a la vez." |
| Cada horario sigue libre | "El horario de *(X)* se ocupó. Elegí otro." → no se crea nada |
| Fechas en el futuro | "*(X)* tiene que ser en una fecha futura." |
| El horario existe en los horarios del negocio | Rechaza |
| Canje con puntos + pack | "Los packs no se pueden canjear con puntos." |

## Fuera de alcance

- **Varios packs** en la misma compra.
- **Combos** mezclados con packs o con servicios sueltos.
- **Comprar sin agendar** (ver arriba: choca con Facturación/Estadísticas).
- **Cobro online.** Sigue siendo transferencia + comprobante por WhatsApp.
- **Facturación y Estadísticas:** no se tocan.

## Riesgos

- **Es una cirugía sobre `createBooking`**, que es donde vive toda la plata de la reserva y donde en las últimas 24 h se encontraron y cerraron **cuatro** agujeros de doble reserva. Mover la rama del pack de lugar no es un agregado: es reordenar el corazón.
- **Tres caminos pasan a ser cuatro** (pack, juntos, separados, y la mezcla). Los tres viejos tienen que quedar **byte-idénticos**; el nuevo comparte sus mismas funciones puras para que no puedan divergir.
- **`screens.tsx` (~2400 líneas)** ya alberga tres caminos. El cuarto tiene que convivir sin tocar los otros.
- **La superposición cruzada** (pack ↔ servicios) es la regla nueva más fácil de olvidar, y la que produce el peor síntoma: una clienta agendada en dos lugares a la vez.
