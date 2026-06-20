# Packs de sesiones — Diseño

**Fecha:** 2026-06-20
**Estado:** Aprobado (pendiente revisión final del usuario)
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

Permitir definir y mostrar **packs de sesiones**: la **misma** prestación repetida **N veces**
a un precio especial (ej. "Depilación definitiva piernas — pack 6 sesiones — $X"), con un
**intervalo entre sesiones** (ej. una cada 14 días). Los packs se administran desde el admin
y se muestran en la página de reserva como **vitrina informativa**.

**Versión 1 = definir + mostrar.** La venta, el cobro/facturación y el agendado de las sesiones
los maneja la usuaria manualmente. No hay conteo de sesiones ni compra online (ver Sección 6).

---

## 2. Por qué una entidad nueva (no Combos, no Services)

- **Combos** (`combos` + `combo_services`) agrupan servicios **distintos** (exigen ≥2 y no
  permiten repetir el mismo servicio: `unique(combo_id, service_id)`). No pueden representar
  "N sesiones del mismo servicio".
- **Services**: meter el pack como campos del servicio limitaría a **un solo pack por servicio**.
  La usuaria puede querer varios (pack de 6 y pack de 10 del mismo tratamiento).
- **Decisión:** tabla nueva **`packs`**, una fila por pack, referenciando un único `service_id`.

---

## 3. Modelo de datos — tabla `packs`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `service_id` | uuid not null → `services(id)` on delete cascade | El servicio del pack |
| `name` | text not null | Nombre visible (ej. "Pack 6 sesiones piernas") |
| `description` | text null | Opcional, para la clienta |
| `sessions` | int not null check (sessions >= 1) | Cantidad de sesiones |
| `interval_days` | int null check (interval_days is null or interval_days > 0) | Cada cuántos días (informativo) |
| `total_price_cents` | int not null check (total_price_cents >= 0) | Precio del pack, en centavos |
| `active` | boolean not null default false | Si se muestra en la web |
| `created_at` | timestamptz not null default now() | |

- **RLS:** lectura pública (`select using (true)`) para que la reserva online lea los packs
  activos — mismo patrón que `combos`. Escritura solo staff (`public.is_staff()`).
- Índice por `service_id`.
- **Precios en centavos** (convención del proyecto).

---

## 4. Admin — sección "Packs"

Nuevo ítem **"Packs"** en el menú lateral del admin (junto a "Combos", solo roles
no-`professional`). Estilo y patrón idénticos a Combos:

- **Lista** (`/admin/packs`): cada pack con servicio, "N sesiones · una cada X días", precio,
  estado (Activo/Inactivo), y acciones (Editar, activar/desactivar, eliminar).
- **Nuevo / Editar** (`/admin/packs/nuevo`, `/admin/packs/[id]`): formulario con
  - **Servicio** (select de servicios activos),
  - **Nombre**, **Descripción** (opcional),
  - **Cantidad de sesiones** (número ≥ 1),
  - **Intervalo en días** (número, opcional),
  - **Precio del pack** (en pesos → se guarda en centavos).
  - Muestra el **ahorro** vs. pagar las N sesiones por separado (`sessions × price_cents` del
    servicio), igual que el form de combos.
- **Server Actions** (`createPack`, `updatePack`, `setPackActive`, `deletePack`) con
  `requireStaff` + cliente service-role (mismo patrón que `combos/actions.ts`).

---

## 5. Web pública — vitrina de packs en la reserva

En la página de reserva, una sección **"Packs"** que lista los packs **activos** (lectura
pública): nombre, servicio, "N sesiones · una cada X días", precio y ahorro. Cada uno con un
**botón de contacto por WhatsApp** (reusando el helper de WhatsApp del proyecto) para coordinar
la compra. **Informativo: no se reserva ni se paga online.**

---

## 6. Fuera de alcance (YAGNI)

- **Conteo de sesiones** usadas/restantes por clienta (créditos/vouchers).
- **Compra o reserva online** del pack; agendado automático de las N sesiones.
- **Integración con la factura manual** (seleccionar el pack al facturar). Por ahora se factura
  escribiendo el concepto a mano, como hoy.

Todo esto puede ser una segunda etapa si hace falta.

---

## 7. Archivos previstos

- Migración: `supabase/migrations/20260620_packs.sql` (tabla + RLS + índice).
- Admin: `src/app/admin/packs/` (`page.tsx` lista, `nuevo/`, `[id]/`, `pack-form.tsx`,
  `actions.ts`, toggle activo y botón eliminar — espejo de `combos/`).
- Menú: ítem "Packs" en `src/app/admin/layout.tsx`.
- Web pública: sección de packs en la página de reserva (componente nuevo que lee packs activos).

---

## 8. Referencias en el código

- Patrón a espejar: `src/app/admin/combos/` (lista, form, actions, toggle, delete) y la
  migración `supabase/migrations/20260507100000_combos.sql`.
- Helper de WhatsApp: `src/lib/whatsapp.ts`.
- Formato de precios: `fmtPrice` de `src/app/reserva/data.ts`.
