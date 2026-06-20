# Packs etapa 2 — Seguimiento de sesiones — Diseño

**Fecha:** 2026-06-20
**Estado:** Aprobado
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

Que el sistema **gestione** los packs (no solo los muestre): registrar que una clienta **compró**
un pack, llevar la **cuenta de sesiones** (usadas / restantes), y **descontar una sesión al
completar un turno** del servicio del pack. Opcionalmente, **facturar** el pack al venderlo.

Construye sobre la etapa 1 (tabla `packs`, ya en producción).

---

## 2. Modelo de datos

### Tabla `pack_purchases` (compras de pack)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid not null → `clients(id)` on delete cascade | La clienta |
| `pack_id` | uuid null → `packs(id)` on delete set null | El pack (se conserva el snapshot si se borra) |
| `pack_name` | text not null | Snapshot del nombre |
| `service_id` | uuid null → `services(id)` on delete set null | Servicio del pack (para matchear turnos) |
| `service_name` | text not null | Snapshot |
| `sessions_total` | int not null check (> 0) | Sesiones del pack |
| `sessions_used` | int not null default 0 check (>= 0) | Sesiones consumidas |
| `created_at` | timestamptz not null default now() | |

- RLS: solo staff. Índice por `client_id`.
- "Activo" = `sessions_used < sessions_total` (derivado, no columna).

### Columna nueva en `appointments`
- `pack_purchase_id` uuid null → `pack_purchases(id)` on delete set null. Marca que ese turno
  descontó una sesión de esa compra (permite revertir y mostrar "Sesión de pack").

---

## 3. Vender un pack (registrar compra) + facturar opcional

En la **ficha de la clienta** (`/admin/clientas/[id]`), sección **"Packs"**:
- Botón **"Vender pack"** → elegís un **pack activo** + un checkbox **"Facturar ahora"**.
- **Acción `venderPack(clientId, packId, { facturar })`:**
  1. Crea `pack_purchases` (snapshots de nombre/servicio, `sessions_total = pack.sessions`, `sessions_used = 0`).
  2. Si `facturar`: emite la **Factura C** del pack reusando `emitirFactura` (invoice-service):
     `concepto/descripcion = pack_name`, `totalCents = pack.total_price_cents`,
     receptor = **DNI de la clienta si lo tiene, sino Consumidor Final** (igual que facturar turno),
     `condIvaReceptor = 5`, `clientId`. Luego **envía el PDF por email** si la clienta tiene email,
     reusando el helper de envío de facturación (se exporta para reuso).
  3. Si el emit de la factura falla, se informa el error pero **la compra del pack queda registrada**
     igual (no se pierde la venta); el email es best-effort (no rompe).

> La factura y la compra están **desacopladas**: si no marcás "Facturar ahora", solo registra la
> compra y facturás cuando quieras (factura manual eligiendo el pack, ya disponible).

---

## 4. Saldo en la ficha de la clienta

En `/admin/clientas/[id]`, sección "Packs": lista de compras con
**nombre · servicio · "usó X / quedan Y" · estado** (Activo / Completado).

---

## 5. Descontar al completar el turno

- En el **listado de turnos** (`/admin/turnos`), al **Completar** un turno cuya clienta tenga un
  **pack activo cuyo servicio coincida** con alguno de los servicios del turno, el botón ofrece:
  **"¿Descontar del pack [nombre · quedan N]?"** (si tiene varios packs activos que matchean, se
  elige cuál).
  - **Sí** → completa el turno, setea `appointments.pack_purchase_id` e **incrementa
    `sessions_used`** (tope = total).
  - **No** → completa normal (sin tocar packs).
- Si la clienta **no** tiene pack activo que matchee, "Completar" funciona como hoy (sin preguntar).
- **Reversa (corrección de error):** en la UI un turno "completado" es **terminal** (no se reactiva,
  para no duplicar los puntos de fidelidad que se suman al completar). La forma de corregir un
  descuento equivocado es **eliminar el turno**: `deleteAppointment` devuelve la sesión
  (`sessions_used − 1`, con piso en 0) si el turno tenía `pack_purchase_id`. La lógica de
  "salir de completed" en `updateAppointmentStatus` queda como defensa por si en el futuro se
  agrega "Reactivar" (con reversa de puntos incluida).
- Integración: extender la acción existente `updateAppointmentStatus` con un parámetro opcional
  `packPurchaseId`, manejando el incremento al entrar a `completed` y el decremento al salir.
  Para mostrar la opción, `/admin/turnos` calcula los packs activos que matchean por turno y se
  los pasa a `StatusActions`.

---

## 6. Errores / consistencia

- Tope: `sessions_used` nunca supera `sessions_total` (check + lógica).
- Idempotencia: el incremento ocurre solo en la transición *hacia* `completed` con
  `packPurchaseId`, y el decremento solo al salir de `completed` con `pack_purchase_id` ya seteado.
- La compra registra snapshots (nombre/servicio) para sobrevivir cambios o borrado del pack.

---

## 7. Fuera de alcance (YAGNI)

- Descontar automático sin elegir; vincular el pack al **agendar** (se hace al completar);
  comprar/reservar packs desde la reserva online; vencimiento de packs; reportes de packs.

---

## 8. Archivos previstos

- Migración: `supabase/migrations/20260620000003_pack_purchases.sql` (tabla + columna en appointments + RLS).
- Acción `venderPack` (+ UI "Vender pack" en la ficha de la clienta) y display del saldo.
- Reuso de `emitirFactura` (`src/lib/arca/invoice-service.ts`) y exportar el helper de envío de
  email de `src/app/admin/facturacion/actions.ts` (o moverlo a un módulo compartido).
- Extender `updateAppointmentStatus` (`src/app/admin/actions.ts`) con `packPurchaseId` + reversa.
- `StatusActions` + `/admin/turnos` para ofrecer el descuento al completar.

## 9. Referencias

- Etapa 1: `docs/superpowers/specs/2026-06-19-facturacion-arca-design.md` (sección packs) y
  `docs/superpowers/plans/2026-06-20-packs-sesiones.md`.
- Facturación: `src/lib/arca/invoice-service.ts`, `src/app/admin/facturacion/actions.ts`.
- Turnos/estado: `src/app/admin/actions.ts` (`updateAppointmentStatus`),
  `src/app/admin/_components/status-actions.tsx`, `src/app/admin/turnos/page.tsx`.
