# Diseño — Un solo mail por compra (equipo al comprar, clienta al confirmar)

**Fecha:** 2026-07-16
**Estado:** Aprobado por la usuaria (eligió: mail a la clienta al confirmar el ÚLTIMO turno pendiente; aviso al equipo al comprar)

## El pedido (palabras de la usuaria)

> "los admins recibieron 2 mails separados… un solo mail por compra, y no quiero enviar mail cuando compra sino al momento que el turno es confirmado, es decir que las clientas reciban solo un mail"

## La regla

**Al comprar (createBooking):**
- **Clienta: NINGÚN mail.** (Hoy salen sendBookingConfirmation / sendMultiBookingConfirmation / sendMixedBookingConfirmation / sendPackConfirmation según el camino — se eliminan de la fase de avisos.)
- **Equipo: UN solo aviso por compra** (hoy: uno por el pack + uno por turno suelto). Nuevo formato itemizado: una fila por turno/pata con **hora AR · servicio · duración · profesional**; la sesión del pack como "Sesión 1 · <pack> (1 de N agendadas)"; total de la compra + "a transferir" (seña); contacto. Destinatarios: los de siempre (`notifyNewBooking`: admins/reception + profesionales involucradas — ahora la UNIÓN de todas las patas de la compra).
- **Excepción canje con puntos (`redeem`):** los turnos nacen `confirmed` → la clienta recibe su único mail (el de confirmación, abajo) inmediatamente al comprar.
- El magic link (auth), Google Calendar y la escritura de la reserva NO cambian.
- **Pantalla de éxito:** el texto "Te enviamos los detalles por email" pasa a ser condicional: si debe seña → "Cuando confirmemos tu seña te mandamos la confirmación por email. Vas a recibir también un recordatorio 24 horas antes."; si ya está confirmado (canje) → como hoy.

**Al confirmar (admin):**
- Cuando un turno de una compra web pasa a `confirmed` y **no queda ningún otro turno del grupo en `pending`** → sale **UN mail** a la clienta con TODOS los turnos vivos (no cancelados/no_show) de la compra: fecha + hora AR de cada uno, detalle por pata (hora · servicio · duración) cuando el turno "juntos" tiene 2+ servicios, profesional, línea del pack ("Sesión 1 de N · quedan M por agendar"). **Sin hablar de plata** (se coordinó por WhatsApp). Con un solo turno en la compra, incluye el chip "agregar a Google Calendar"; con varios, no (igual que el mail múltiple de hoy).
- **Disparadores** (los ÚNICOS lugares que escriben `confirmed`): `updateAppointmentStatus` (admin/actions.ts:108) y `confirmPackSessions` (admin/actions.ts:1700). Ambos, tras actualizar, corren el mismo chequeo de grupo.
- **Anti-duplicado:** columna `confirmation_email_sent_at`. El chequeo "reclama" el envío con un update condicional (`set confirmation_email_sent_at = now() where booking_group_id = X and confirmation_email_sent_at is null` + select) — si no reclamó ninguna fila, otro proceso ya lo mandó (o ya se había mandado): no re-manda. Des-confirmar y re-confirmar NO re-manda.
- **Sólo compras web:** el trigger requiere `booking_group_id` no nulo. Turnos creados a mano por el admin (o viejos, previos a la migración) NO mandan mail al confirmarse — igual que hoy.

## Vínculo de compra (migración)

Hoy los turnos de una misma compra no están vinculados (salvo las sesiones del pack por `pack_purchase_id`). Nueva columna:

```sql
alter table appointments add column if not exists booking_group_id uuid;
alter table appointments add column if not exists confirmation_email_sent_at timestamptz;
create index if not exists appointments_booking_group_id_idx
  on appointments (booking_group_id) where booking_group_id is not null;
```

`createBooking` genera `crypto.randomUUID()` una vez por compra y lo escribe en TODOS los turnos (sesiones del pack + portador juntos / turnos separados). Con canje (`redeem`), tras escribir llama al MISMO enviador del mail de confirmación (lee de la base por grupo, marca sent_at) — DRY con el camino del admin.

**Orden de deploy:** la migración es aditiva (columnas nullable) → correrla en Supabase ANTES de desplegar el código (el insert nuevo escribe la columna; sin migración, la reserva web se rompe).

## Piezas nuevas en `src/lib/email/`

- `sendNewPurchaseAlert` (equipo): reemplaza los usos de `sendNewBookingAlert` desde la reserva web (los 4 caminos de la FASE D). Filas itemizadas + total + seña + contacto. `notifyNewBooking` gana la variante multi-fila (o una función hermana) — los usos del ADMIN de `notifyNewBooking`/`sendNewBookingAlert` (si los hay) no cambian.
- `sendPurchaseConfirmedEmail` (clienta): lee de la base por `booking_group_id` (turnos vivos + patas con `starts_at`/`duration_min`/servicio/profesional + pack), arma el mail "Reserva confirmada / Te esperamos". Hora SIEMPRE con `arPartsFromUtc` / `fmtDateAR` (hora argentina).
- Limpieza: los enviadores de creación que queden sin uso (`sendMultiBookingConfirmation`, `sendMixedBookingConfirmation`, `sendPackConfirmation`, y `sendBookingConfirmation` si nadie más lo usa) se eliminan. `sendBookingReminder` (cron 24h, sólo confirmados) y `sendBookingReschedule`/`sendBookingCancellation` quedan.

## Qué NO cambia

- La reserva en sí (solver/writer/cliente, Fase 3), la plata, señas, puntos, Google Calendar, magic link, recordatorio 24h, portal.
- Los avisos del admin al crear turnos manuales.

## Riesgos

- `createBooking` sin tests (riesgo conocido): la fase de avisos es best-effort (try/catch, no bloquea la reserva) — se mantiene así.
- Carrera de dos admins confirmando a la vez: el "reclamo" condicional hace que mande uno solo.
- Si el último turno pendiente del grupo se CANCELA (portal o admin) en vez de confirmarse, el grupo queda sin pendientes SIN pasar por los triggers → el mail sale recién cuando se confirme (o re-toque) algún turno del grupo. Aceptado (caso raro; el equipo ve la agenda).
