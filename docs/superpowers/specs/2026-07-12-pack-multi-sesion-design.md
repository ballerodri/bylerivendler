# Diseño — Elegir todas las sesiones de un pack al comprarlo

**Fecha:** 2026-07-12
**Estado:** Aprobado (pendiente de plan de implementación)

## Problema

Cuando una clienta compra un pack en la reserva online, sólo puede elegir la fecha de la
**primera** sesión. Las sesiones 2..N las agenda el salón después, a mano. La clienta debería
poder elegir las fechas de **todas** las sesiones al comprar.

## Estado actual

- `packs`: `sessions` (N), `interval_days` (opcional, ej. 7), `zones_count`, `total_price_cents`.
- `pack_purchases`: `sessions_total`, `sessions_used` (+ cliente, pack, servicio).
- `appointments.pack_purchase_id` liga un turno a la compra del pack.
- **Compra online** (`createBooking`, rama `input.packId`): crea `pack_purchases` + **1 turno**
  ("portador") con `total_cents` = precio del pack, seña 30%, `status: pending`,
  `pack_purchase_id` seteado.
- **Sesiones 2..N:** el admin crea un turno normal y, al **Completar**, elige el pack en el
  cartelito "¿Descontar de un pack?" → `sessions_used++`.

### Bug encontrado

En `updateAppointmentStatus`, el pack sólo se descuenta si **quien llama pasa** `packPurchaseId`
explícitamente (`enteringCompleted && packPurchaseId`). Un turno que **ya tiene**
`pack_purchase_id` (como el portador de la sesión 1) **no descuenta solo** al completarse. Peor:
`leavingCompleted` sí devuelve la sesión usando `prev.pack_purchase_id`, así que se puede
devolver una sesión que nunca se contó. Hay que arreglarlo para pre-agendar sesiones.

## Decisiones (acordadas con la usuaria)

1. **Elige una por una, a mano** (no auto-sugerido por intervalo).
2. **No es obligatorio** elegir todas: mínimo la 1ª; el resto puede quedar "para después".
3. **El intervalo (`interval_days`) se hace respetar online**; el **admin puede saltearlo**.
4. Las sesiones pendientes las agendan **la clienta (portal)** y **el admin**.
5. Enfoque: **un selector reutilizable** (no copiar la lógica en cada pantalla).

## Alcance

### Etapa 1 (este spec)

1. Reglas puras de sesiones de pack (lógica aislada y testeada).
2. Selector reutilizable de fecha/hora de una sesión.
3. Reserva online: elegir N sesiones al comprar; crear un turno por sesión elegida.
4. Descuento automático del pack al Completar un turno ya ligado al pack (fix del bug).
5. Admin: agendar sesiones pendientes desde la ficha de la clienta (pudiendo saltear el intervalo).

### Etapa 2 (futuro, fuera de este spec)

6. Portal de la clienta: ver y agendar sus sesiones pendientes.

Con la Etapa 1 el circuito **cierra**: si la clienta no agenda todo, el admin lo hace.

## Modelo de datos

**Sin cambios de schema.** Todo se deriva de lo existente:

- `sessions_total` = sesiones del pack.
- **Agendadas** = turnos con ese `pack_purchase_id` y `status != 'cancelled'`.
- **Pendientes de agendar** = `sessions_total - agendadas`.
- `sessions_used` = completadas (lo mantiene `updateAppointmentStatus`).

No se agrega índice de sesión: el "número de sesión" se deriva ordenando por `starts_at`.

### Reparto del precio (crítico para estadísticas/facturación)

El pack se paga **una sola vez**:

| Turno | `total_cents` | `deposit_cents` | `deposit_paid` | `status` |
|---|---|---|---|---|
| 1ª sesión (portador) | `pack.total_price_cents` | 30% | `false` | `pending` |
| Sesiones 2..N | `0` | `0` | `true` | `pending` |

Todas nacen `pending` (el salón las confirma, igual que hoy). Ojo: con el cambio reciente, el
recordatorio por mail/WhatsApp sólo sale para turnos **confirmados**.

Lo mismo en `appointment_services.price_cents` (pack en la 1ª, `0` en el resto). Si todas
llevaran el precio, un pack de $170.000 × 4 aparecería como $680.000 de ingreso.

Las sesiones agendadas **después** (admin/portal) también se crean en `0` (ya están pagadas).

## Arquitectura

### 1. Reglas puras — `src/lib/servicios/pack-sessions.ts` (nuevo)

Sin dependencias de servidor → **testeable con vitest** (los módulos con `import "server-only"`
no lo son).

- `minStartForNextSession(prevStartsAt: Date, intervalDays: number | null): Date`
  → desde cuándo puede empezar la sesión siguiente.
- `validatePackSlots(slots: Date[], opts: { sessionsTotal: number; intervalDays: number | null }):
  { ok: true } | { ok: false; error: string }`
  → al menos 1; no más de `sessionsTotal`; orden cronológico **estrictamente creciente**;
  intervalo respetado. Si `intervalDays` es `null`/0, sólo se exige el orden creciente (dos
  sesiones podrían caer el mismo día en horarios distintos).
- `packSessionPrices(totalPriceCents: number, count: number): { totalCents: number; depositCents: number; depositPaid: boolean }[]`
  → la 1ª lleva precio + seña 30%; el resto en 0/pagadas.

### 2. Selector — `src/app/reserva/_components/pack-session-picker.tsx` (nuevo, cliente)

Calendario + horarios libres de un día, para **una** sesión.

- Props: `durationMin`, `proHint`, `businessHours`, `minDate` (de la regla), `onPick(iso)`, `onCancel`.
- **La preferencia de profesional es una sola para todo el pack** (la que ya eligió en la reserva).
  No se elige profesional por sesión — queda fuera de alcance.
- Disponibilidad: reusa la acción existente
  `fetchDayAvailability(dateStr, durationMin, proHint, candidateSlots)`.
- Bloquea los días anteriores a `minDate`.
- Se usa en: reserva (compra), admin (ficha de la clienta) y —Etapa 2— portal.

### 3. Servidor

- `createBooking` (`src/app/reserva/actions.ts`): el input gana
  `packSlots: string[]` (ISO, ≥1). Reemplaza al `startsAt` único para la rama de pack.
- `schedulePackSession(packPurchaseId, startsAtISO, { allowIntervalOverride })`
  (`src/app/admin/actions.ts`, nuevo): crea **un** turno en `0` ligado al pack. Usado por el admin
  (y, en Etapa 2, por el portal sin override).
- `updateAppointmentStatus`: si el turno **ya tiene** `pack_purchase_id`, descuenta **solo** al
  entrar a `completed` (sin que el llamador pase nada), con guarda `sessions_used < sessions_total`.
  El parámetro `packPurchaseId` sigue existiendo para turnos **sueltos** que se descuentan de un pack.

## Flujo de compra

1. Elige el pack (+ zonas, si es por zona) — igual que hoy.
2. **Paso de fecha:** en vez de un calendario único, ve la lista de sesiones:

```
Tu pack: Vela Slim Plus · 4 sesiones

  Sesión 1 de 4   Lun 20/07  14:00        [cambiar]
  Sesión 2 de 4   Lun 27/07  14:00        [cambiar]
  Sesión 3 de 4   — la agendo después —   [elegir fecha]
  Sesión 4 de 4   — la agendo después —   [elegir fecha]

        [ Confirmar pack (2 de 4 agendadas) ]
```

- Sesión 1 **obligatoria**; el resto opcionales.
- Al elegir la sesión *k*, el calendario bloquea todo lo anterior a
  `minStartForNextSession(sesión k-1, interval_days)`.

3. Al confirmar, el servidor:
   - Revalida **cada** slot: disponibilidad real (`fetchDayAvailability`), orden e intervalo,
     pack activo/visible, zonas correctas.
   - **Todo o nada:** si algo falla, no crea ni la compra ni ningún turno.
   - Crea `pack_purchases` + **un turno por slot** (precios según la tabla de arriba),
     todos con `pack_purchase_id`.
   - Manda el mail de confirmación con **todas** las fechas.

## Agendar pendientes (admin)

En la ficha de la clienta, por cada pack con sesiones sin agendar:

```
Pack Vela Slim Plus · 4 sesiones     2 agendadas · 2 sin agendar
  [ Agendar sesión ]
```

Abre el mismo selector. El intervalo se **sugiere** pero se puede **saltear**:
> "Ojo: faltan 5 días de la sesión anterior. [Agendar igual]"

## Validaciones y errores

Todo se revalida en el **servidor** (la pantalla se puede manipular):

| Regla | Mensaje |
|---|---|
| ≥ 1 sesión | "Elegí al menos la fecha de la primera sesión." |
| ≤ `sessions_total` | Rechaza |
| Orden cronológico + intervalo | "Entre sesiones tienen que pasar al menos N días." |
| Slot libre al confirmar | "El horario de la sesión K se ocupó. Elegí otro." |
| Pack activo y visible | "Ese pack ya no está disponible." |
| Zonas (si `per_zone`) | "Elegí exactamente N zona(s) para el pack." |

**Carrera:** si otra clienta toma un horario mientras ésta elegía, el servidor la rechaza al
confirmar y **no crea nada**; ella vuelve a elegir esa sesión.

## Testing

- **Vitest (reglas puras, `pack-sessions.test.ts`):** `minStartForNextSession` con y sin intervalo;
  `validatePackSlots` (vacío, de más, desordenado, intervalo corto, caso feliz);
  `packSessionPrices` (1ª con precio + seña, resto en 0; N=1).
- **Compilación:** `tsc`, `next build`.
- **Manual antes de desplegar:** comprar un pack eligiendo 2 de 4 sesiones; verificar los turnos
  creados y sus precios; completar una sesión y verificar que `sessions_used` sube sola; agendar
  una pendiente desde el admin.

## Fuera de alcance

- Portal de la clienta (Etapa 2).
- Reprogramar una sesión ya agendada → sigue el "Reagendar" existente.
- Packs en la "Nueva reserva" del admin (hoy tampoco existen).
- Cobro/seña real (Mercado Pago) — no cambia.

## Archivos afectados

**Nuevos**
- `src/lib/servicios/pack-sessions.ts` + `pack-sessions.test.ts`
- `src/app/reserva/_components/pack-session-picker.tsx`
- Componente cliente para la ficha de la clienta (agendar pendientes)

**Modificados**
- `src/app/reserva/actions.ts` — `createBooking` (rama pack) acepta `packSlots`
- `src/app/reserva/screens.tsx` — paso de fecha del pack → lista de sesiones
- `src/app/reserva/data.ts` — `BookingState.packSlots`; `ReservaPack.intervalDays`
- `src/app/reserva/queries.ts` — `fetchReservaPacks` trae `interval_days`
- `src/app/admin/actions.ts` — `schedulePackSession`; fix del descuento en `updateAppointmentStatus`
- `src/app/admin/_components/status-actions.tsx` — no ofrecer "¿Descontar de un pack?" si el turno
  ya está ligado a uno
- `src/app/admin/turnos/page.tsx` — pasar a `StatusActions` si el turno ya está ligado a un pack
- `src/app/admin/clientas/[id]/page.tsx` — packs con sesiones pendientes + agendar
- `src/lib/email/booking-emails.ts` — confirmación de pack con todas las fechas
