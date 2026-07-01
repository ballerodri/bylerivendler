# Servicio "por zona" (Vela Slim) + packs seleccionables en reserva — Diseño

**Fecha:** 2026-07-01
**Estado:** Aprobado
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

Soportar servicios que se **cobran por zona** y cuya **duración depende de qué zonas** se
eligen (caso concreto: *Vela Slim*). Además, permitir que los **packs promocionales** (varias
sesiones a precio de combo) se puedan **vender desde el admin** y también **elegir en la reserva
online**.

Ejemplo real (Vela Slim):
- **Zona suelta:** $25.000 (mismo precio toda zona; cada zona tarda distinto).
- **1 zona × 4 sesiones (pack):** $90.000.
- **2 zonas × 4 sesiones (pack):** $160.000.

Construye sobre lo existente: `services`, flujo de reserva (`src/app/reserva`), `packs` +
`pack_purchases` (seguimiento de sesiones ya en producción — ver
`docs/superpowers/specs/2026-06-20-packs-etapa2-seguimiento-design.md`).

---

## 2. Conceptos

- **Servicio "por zona"** (`pricing_mode = 'per_zone'`): en vez de un precio y una duración fijos,
  tiene un **precio por zona** y una **lista de zonas**, cada una con su **duración en minutos**.
- **Turno suelto por zonas:** la clienta elige N zonas → se hacen en **un** turno.
  Precio = N × precio-por-zona. Duración = suma de las duraciones de esas zonas.
- **Pack:** promo por varias **sesiones** (cada sesión es un turno). Para servicios por zona, el
  pack define **cuántas zonas cubre por sesión** (`zones_count`). El pack se paga como bundle
  (precio propio) y se consume una sesión al completar cada turno (mecánica ya existente).

---

## 3. Modelo de datos

### 3.1 `services` (cambios)
| Campo | Tipo | Notas |
|---|---|---|
| `pricing_mode` | text not null default `'fixed'` check in (`'fixed'`,`'per_zone'`) | Modo de cobro |

- Para `per_zone`: **`price_cents` = precio por zona**.
- Para `per_zone`: `duration_min` **no se usa** al reservar (la duración sale de las zonas).
  Se relaja el check `duration_min > 0` a `duration_min >= 0`; en los servicios por zona se
  guarda `0` y en los listados se muestra "según zonas".
- `visible_public`, `active`, `category_id`, puntos, etc. siguen igual.

### 3.2 `service_zones` (tabla nueva)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `service_id` | uuid not null → `services(id)` on delete cascade | Servicio dueño |
| `name` | text not null | Nombre de la zona (ej. "Abdomen") |
| `duration_min` | int not null check (> 0) | Minutos que ocupa esa zona |
| `order_index` | int not null default 0 | Orden de aparición |
| `active` | boolean not null default true | Zona disponible |
| `created_at` | timestamptz not null default now() | |

- **RLS:** lectura pública de zonas `active` de servicios visibles (para la reserva); escritura
  solo staff (mismo criterio que `services`). Índice por `service_id`.

### 3.3 `appointment_services` (cambios — snapshot de zonas)
| Campo | Tipo | Notas |
|---|---|---|
| `zones` | jsonb null | Para servicios por zona: `[{ "name": "...", "duration_min": N }]` con las zonas elegidas en ese turno. Null para servicios normales. |

- La fila del servicio por zona guarda `duration_min` = suma de las zonas elegidas y
  `price_cents` = cantidad × precio-por-zona (**snapshot**, igual que hoy).
- `zones` es la "foto" de qué zonas se hicieron (para agenda, resumen y factura).

### 3.4 `packs` (cambios)
| Campo | Tipo | Notas |
|---|---|---|
| `zones_count` | int null check (> 0) | Solo packs de servicios por zona: cuántas zonas cubre cada sesión. Null para packs normales. |
| `visible_reserva` | boolean not null default false | Si el pack se puede **elegir en la reserva online** |

- Cálculo de "precio de lista / ahorro" en el alta del pack:
  - Servicio `fixed`: referencia = `service.price_cents × sessions` (como hoy).
  - Servicio `per_zone`: referencia = `service.price_cents (precio/zona) × zones_count × sessions`.
    Ej. 2 × $25.000 × 4 = $200.000 → pack $160.000 → ahorro $40.000.

### 3.5 `pack_purchases`
- Sin cambios de esquema. Al comprar un pack (admin o reserva) se crea la compra con
  `sessions_total = pack.sessions`, `sessions_used = 0` (snapshots de nombre/servicio ya
  existentes).

---

## 4. Alta / edición de servicio (admin)

En `src/app/admin/servicios/nuevo` y `.../[id]` (form + `service-editor`):

- Nuevo interruptor **"Cobrar por zona"** (`pricing_mode`).
- **Modo fijo (default):** igual que hoy (Duración + Precio).
- **Modo por zona:**
  - Se **oculta** el campo "Duración (minutos)" único.
  - El campo "Precio" pasa a rotularse **"Precio por zona"**.
  - Aparece un **editor de zonas**: filas de **(nombre, minutos)** con agregar / editar / borrar
    y orden. Se exige **al menos 1 zona** para guardar un servicio por zona.
- Acciones `createService` / `updateService` (`src/app/admin/actions.ts`): guardan
  `pricing_mode`, y sincronizan las filas de `service_zones` (alta/actualización/baja). Al pasar a
  `per_zone`, `duration_min` se guarda en `0`.

---

## 5. Reserva — turno suelto por zonas

Archivos: `src/app/reserva/{queries.ts,data.ts,screens.tsx,actions.ts}`.

- **Carga (`queries.ts`/`data.ts`):** para servicios `per_zone`, incluir `pricingMode`,
  `pricePerZoneCents` y `zones: [{ id, name, durationMin }]` (solo zonas `active`).
- **UI (`screens.tsx`):** al elegir un servicio por zona se despliega la **lista de zonas para
  tildar**. El resumen calcula, para ese servicio:
  - precio = (zonas elegidas) × precio-por-zona
  - duración = suma de minutos de las zonas elegidas
  Se combina con otros servicios normales del turno (se siguen sumando precio y duración).
- **Reserva (`actions.ts`) — autoritativo en el servidor:** el navegador manda las zonas elegidas
  por servicio (ej. `zoneSelections: { [serviceId]: zoneId[] }`). El servidor:
  1. Trae de la DB las zonas del servicio y **valida** que los `zoneId` pertenezcan al servicio y
     sean `active`, y que haya **≥ 1**.
  2. Calcula `price_cents = count × service.price_cents` y `duration_min = Σ zona.duration_min`.
  3. Inserta la fila en `appointment_services` con esos valores + `zones` (snapshot de
     `{name, duration_min}`).
  4. Totales del turno (`appointments.total_cents`, `duration_min`) y **seña 30%** se calculan
     como hoy sobre la suma.
- **Nunca** se confía en el precio/duración del navegador (se recalcula todo en el servidor).

Aplica tanto a la **reserva online** como a **"Nueva reserva"** del admin (misma lógica de
servidor; el selector de zonas se muestra en ambos).

---

## 6. Packs — creación, venta y selección en reserva

### 6.1 Alta del pack (admin, `src/app/admin/packs`)
- Al elegir un **servicio por zona**, el form muestra **"Cantidad de zonas por sesión"**
  (`zones_count`) y usa la fórmula de referencia por zona (§3.4) para mostrar el ahorro.
- Nuevo checkbox **"Visible en la reserva online"** (`visible_reserva`).

### 6.2 Vender pack desde el admin
- Sin cambios de flujo: `venderPack` (ficha de la clienta) crea la `pack_purchase` y opcionalmente
  factura. Ver spec de packs etapa 2.

### 6.3 Elegir un pack en la reserva online (nuevo)
- **Carga:** `queries.ts` trae los packs con `visible_reserva = true` y `active = true`
  (nombre, `sessions`, `total_price_cents`, servicio, `zones_count`).
- **UI (`screens.tsx`):** sección **"Packs"**. Elegir un pack es **excluyente** dentro de la
  reserva (igual que hoy un combo reemplaza la selección de servicios): una reserva es
  *servicios sueltos* **o** *un combo* **o** *un pack*.
  - Si el pack es de un servicio por zona: la clienta elige **exactamente `zones_count` zonas**
    (define la duración de la 1ª sesión).
  - Elige día/hora de la **1ª sesión** con esa duración.
  - Precio mostrado = precio del pack; **seña = 30% del pack**.
- **Reserva (`actions.ts`):** cuando la selección es un pack:
  1. Valida `visible_reserva` + `active`; si es por zona, valida que se hayan elegido
     **exactamente `zones_count`** zonas válidas.
  2. Crea la `pack_purchase` (client, snapshots, `sessions_total = pack.sessions`,
     `sessions_used = 0`).
  3. Crea el **primer turno**:
     - `duration_min` = Σ zonas elegidas (o `service.duration_min` si el servicio del pack es fijo).
     - **`total_cents = pack.total_price_cents`** (el turno "portador" del pack lleva el precio del
       bundle), `deposit_cents = 30%` del pack, `status = 'pending'`.
     - `pack_purchase_id` = la compra recién creada (queda marcado como sesión de pack desde el
       agendamiento).
     - `appointment_services`: fila del servicio del pack con `zones` snapshot; `price_cents`
       de la fila = `pack.total_price_cents` para que la factura del turno portador sea el pack.
  4. Las **sesiones restantes (2..N)** las **agenda/coordina el admin** después (no se auto-cobran
     online, para no volver a pedir seña: el pack ya se señó). Se crean como turnos del servicio y
     se **descuentan al completar** (mecánica existente: al completar un turno de ese servicio con
     pack activo, se ofrece descontar → `sessions_used += 1`). El precio de esos turnos es
     informativo y **no se facturan** (el pack ya se cobró en el turno portador).

> **Consumo de sesiones:** el **primer** turno ya viene con `pack_purchase_id`; su `sessions_used`
> se incrementa al **completarlo** (igual que el resto), evitando contar no-shows. La reversa
> (borrar turno) devuelve la sesión, como ya está implementado.

### 6.4 Facturación
- Sin cambios automáticos: la factura del pack se emite cuando el staff lo decide (botón
  "Facturar" del turno portador, que lleva el total del pack, o factura manual eligiendo el pack).
  Los turnos de las sesiones siguientes van en $0 (no se facturan).

---

## 7. Validaciones y casos borde

- Servicio por zona sin zonas activas: no se puede reservar (y el admin no puede guardar uno sin
  al menos 1 zona).
- Turno suelto por zona: exige **≥ 1** zona; pack por zona: exige **exactamente `zones_count`**.
- Zonas inválidas (no pertenecen al servicio o inactivas): se rechazan en el servidor.
- **Combos:** un servicio `per_zone` **no** puede formar parte de un combo (precio variable) — se
  excluye de la selección de servicios de combos en el admin.
- **Canje por puntos** (redeem) **no** aplica a servicios por zona ni a packs (fuera de alcance).
- Precio/duración siempre **recalculados en el servidor**.

---

## 8. Fuera de alcance (YAGNI)

- Agendar **todas** las sesiones del pack de una (solo la 1ª; el resto los coordina/agenda el admin).
- Auto-agendado online de las sesiones **2..N** por la clienta (para no re-cobrar seña).
- Cobro online del pack completo (se cobra **seña 30%**; resto en el local).
- Vencimiento de packs / reprogramación automática de sesiones.
- Precio distinto por zona (todas las zonas comparten el precio-por-zona).
- Servicios por zona dentro de combos.
- Facturación automática al comprar el pack en la reserva.

---

## 9. Archivos previstos

- **Migración** `supabase/migrations/20260701000000_servicio_por_zona.sql`:
  `services.pricing_mode` (+ relajar check de `duration_min`), tabla `service_zones` (+RLS+índice),
  `appointment_services.zones`, `packs.zones_count` + `packs.visible_reserva`.
- **Admin servicios:** `src/app/admin/servicios/nuevo/new-service-form.tsx`,
  `src/app/admin/servicios/[id]/service-editor.tsx`, acciones en `src/app/admin/actions.ts`
  (`createService`/`updateService` + sync de zonas).
- **Admin packs:** `src/app/admin/packs/pack-form.tsx` (+ `zones_count`, `visible_reserva`,
  ahorro por zona) y sus acciones.
- **Reserva:** `src/app/reserva/{queries.ts,data.ts,screens.tsx,actions.ts}` (selector de zonas,
  sección packs, cálculo servidor, compra de pack + 1er turno).
- **Combos:** excluir servicios `per_zone` del selector (`src/app/admin/combos/combo-form.tsx`).

## 10. Referencias

- Packs etapa 2 (seguimiento): `docs/superpowers/specs/2026-06-20-packs-etapa2-seguimiento-design.md`.
- Facturación ARCA: `src/lib/arca/invoice-service.ts`, `src/app/admin/facturacion/actions.ts`.
- Reserva actual: `src/app/reserva/actions.ts` (cálculo de totales, seña 30%, inserción de
  `appointment_services`).
