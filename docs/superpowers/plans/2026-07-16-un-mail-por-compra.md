# Un solo mail por compra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Al comprar: la clienta no recibe mail y el equipo recibe UN solo aviso itemizado por compra. Al confirmar el ÚLTIMO turno pendiente de la compra: UN mail a la clienta con todos los turnos. Canje con puntos: ese mail sale al instante.

**Architecture:** Nueva columna `appointments.booking_group_id` (migración ya commiteada, la corre la usuaria ANTES del deploy) vincula los turnos de una compra. `createBooking` la escribe y reemplaza su fase de avisos (4 caminos) por un único `notifyNewPurchase` al equipo. Un módulo nuevo `sendGroupConfirmationEmail(admin, groupId)` lee de la base, reclama `confirmation_email_sent_at` (anti-duplicado) y manda el mail de la clienta; lo llaman los DOS únicos escritores de `confirmed` (`updateAppointmentStatus`, `confirmPackSessions`) y el camino redeem de `createBooking`.

**Tech Stack:** Next.js 16 server actions, Supabase service-role, Resend.

## Global Constraints

- La reserva en sí (solver/writer/cliente Fase 3), la PLATA (totales/señas/puntos), Google Calendar, magic link, recordatorio 24h y portal NO se tocan.
- Toda fecha/hora mostrada en mails = hora argentina (`fmtDateAR` / `arPartsFromUtc`), nunca el reloj del servidor.
- Avisos best-effort: try/catch alrededor de todo envío; un mail que falla NUNCA rompe la reserva ni el cambio de estado.
- El trigger del mail de la clienta exige `booking_group_id` NO nulo (turnos viejos/manuales del admin: sin mail, como hoy).
- Anti-duplicado por RECLAMO: `update appointments set confirmation_email_sent_at = now() where booking_group_id = X and confirmation_email_sent_at is null` con `.select("id")`; si devuelve 0 filas → NO mandar. Si el envío falla tras reclamar → best-effort des-reclamar (set null) para que un re-toque pueda reintentar.
- `escape()` en todo dato de usuaria interpolado en HTML de mails.
- tsc 0 errores · vitest 182/182 · build OK · lint sin problemas nuevos (baseline 20).
- NO desplegar: la usuaria tiene que correr la migración primero.

### Task 1 — `src/lib/email/`: aviso de compra al equipo + mail de confirmación a la clienta

**Files:** Modify `src/lib/email/booking-emails.ts` (agregar `sendNewPurchaseAlert`), Modify `src/lib/email/notify-booking.ts` (agregar `notifyNewPurchase`), Create `src/lib/email/confirm-purchase.ts` (`sendGroupConfirmationEmail`).

**Produces (interfaces exactas):**
```ts
// booking-emails.ts — mismo estilo/shell que los mails existentes
export async function sendNewPurchaseAlert(data: {
  to: string[]
  clientName: string
  clientPhone?: string | null
  rows: { startsAt: Date; label: string; durationMin: number; staffName: string | null }[]
  totalCents: number
  dueNowCents: number
}): Promise<{ ok: boolean; error?: string }>
// Render: h1 "Reservó <em>{clientName}</em>"; filas ORDENADAS por startsAt:
// `{fmtDateAR(startsAt)} — {label} · {durationMin} min · {staffName ?? "A asignar"}`;
// luego "Total: {fmtPrice}" y (si dueNowCents > 0) "Seña a transferir: {fmtPrice}";
// contacto si hay; CTA "Ver en la agenda" → /admin/turnos. escape() en label/nombres.

// notify-booking.ts — mismos destinatarios que notifyNewBooking (admins/reception
// activos + profesionales asignadas, dedupe, excludeEmail opcional)
export async function notifyNewPurchase(
  supabase: SupabaseClient,
  opts: {
    clientName: string
    clientPhone?: string | null
    rows: { startsAt: Date; label: string; durationMin: number; staffId: string | null }[]
    totalCents: number
    dueNowCents: number
    excludeEmail?: string | null
  }
): Promise<void>
// Resuelve nombres: un solo select a staff con los ids únicos de rows
// (full_name) → staffName por fila; assignedStaffIds = esos mismos ids.
// Llama sendNewPurchaseAlert. Nunca lanza (try/catch integral, como notifyNewBooking).

// confirm-purchase.ts ("server-only")
export async function sendGroupConfirmationEmail(
  admin: SupabaseClient,
  bookingGroupId: string
): Promise<void>
```
**`sendGroupConfirmationEmail` hace, en orden:**
1. Lee turnos del grupo: `appointments` where `booking_group_id = X` → `id, starts_at, status, pack_purchase_id, client_id, appointment_services(starts_at, duration_min, service:services(name), staff:staff(full_name))`. Si no hay filas → return.
2. Si ALGUNO está `pending` → return (todavía no es el último).
3. RECLAMO anti-duplicado (Global Constraints). 0 filas reclamadas → return.
4. Cliente: `clients` → `email, first_name` (por `client_id`). Sin email → des-reclamar y return.
5. Pack (si algún turno tiene `pack_purchase_id`): `pack_purchases` → `pack_name, sessions_total`; sesiones agendadas = turnos del grupo con ese id; "quedan M por agendar" si M > 0.
6. Arma y manda (Resend, mismo `shell`) SOLO con turnos vivos (status ≠ cancelled/no_show): eyebrow "Reserva confirmada", h1 "Te <em>esperamos</em>, {nombre}."; por turno: fecha AR (`fmtDateAR`) + si el turno tiene 2+ patas, sub-filas `{hora AR} {servicio} · {min} min · {profesional}`; sesión de pack como "Sesión i · {pack}"; SIN plata; "Dónde" + nota del recordatorio 24h + CTA "Ver mis turnos" → /portal. Con UN solo turno vivo total: incluir el chip de Google Calendar (`gcalLink`/`calChip` — exportarlos o mover la lógica a confirm-purchase).
7. Si Resend falla → des-reclamar (best-effort) y return.

**Steps:** escribir las 3 piezas → `npx tsc --noEmit` (0) → `npx vitest run` (182) → commit `feat(mails): aviso único de compra al equipo + mail de confirmación por grupo`.

### Task 2 — `createBooking`: grupo + fase de avisos nueva + copy de éxito

**Files:** Modify `src/app/reserva/actions.ts` (FASE C insert + FASE D), Modify `src/app/reserva/exito/page.tsx` (copy condicional).

**Consumes:** `notifyNewPurchase`, `sendGroupConfirmationEmail` (Task 1).

- FASE C: `const bookingGroupId = crypto.randomUUID()` (una vez, antes del loop de inserts); agregar `booking_group_id: bookingGroupId` al insert de `appointments` (reserva/actions.ts:1060).
- FASE D: **eliminar** los envíos a la clienta (`sendPackConfirmation`, `sendMultiBookingConfirmation`, `sendBookingConfirmation`, `sendMixedBookingConfirmation`) y **reemplazar** todos los `notifyNewBooking` de los 4 caminos por UN solo `notifyNewPurchase` por compra (hoisted, común a los caminos), con:
  - `rows`: de `ordered` — por turno: si `legs.length > 1` una fila POR PATA (`startsAt` = pata, `label` = servicio, `durationMin` = pata, `staffId` = pata); si no, una fila por turno (`label` del planned — las sesiones del pack ya vienen etiquetadas, verificar que incluya el nombre del pack; si no, armar "Sesión i · {pack.name}").
  - `totalCents = sumTotals(plan)`; `dueNowCents` = el MISMO valor que cada camino le pasaba al mail viejo (separados: `totalDueNowSeparate(...)`; mezcla: `sumDeposits(plan)`; juntos: el depósito del portador; pack solo: su seña) — NO inventar una fórmula nueva; con `redeem`, 0.
  - Google Calendar de cada camino queda EXACTAMENTE donde está.
- redeem: tras FASE C exitosa, `try { await sendGroupConfirmationEmail(supabase, bookingGroupId) } catch {}`.
- Éxito: agregar `status` al select; si TODOS los turnos están `confirmed` → texto de hoy; si no → "Cuando confirmemos tu seña te mandamos la confirmación por email. Vas a recibir también un recordatorio 24 horas antes de tu turno."
- Limpieza: borrar de `booking-emails.ts` los enviadores que quedaron sin uso (`sendPackConfirmation`, `sendMultiBookingConfirmation`, `sendMixedBookingConfirmation`, `sendBookingConfirmation` — verificar con grep que NADIE más los importa; si alguno se usa en otro lado, dejarlo). Actualizar imports.

**Steps:** editar → tsc 0 → vitest 182 → lint (baseline) → build → commit `feat(reserva): un solo aviso al equipo por compra y ningún mail a la clienta al comprar`.

### Task 3 — Admin: disparar el mail de la clienta al confirmar

**Files:** Modify `src/app/admin/actions.ts` (`updateAppointmentStatus` ~:51-116, `confirmPackSessions` ~:1684-1708).

**Consumes:** `sendGroupConfirmationEmail` (Task 1).

- `updateAppointmentStatus`: el select de `prev` (:64-68) suma `booking_group_id`. Tras el update exitoso (:106-111), si `parsed.data === "confirmed"` y `prev?.booking_group_id`: `try { await sendGroupConfirmationEmail(admin, prev.booking_group_id) } catch {}`. (La función ya chequea "sin pendientes" + reclamo — acá NO se duplica esa lógica.)
- `confirmPackSessions`: el select de pendientes (:1690-1694) suma `booking_group_id`. Tras el update batch exitoso: por cada `booking_group_id` ÚNICO no nulo de las filas confirmadas → mismo try/catch. (Normalmente es uno solo.)
- El cambio de estado devuelve `ok: true` aunque el mail falle.

**Steps:** editar → tsc 0 → vitest 182 → commit `feat(admin): confirmar el último turno de una compra manda el mail a la clienta`.

### Final
tsc + vitest + build + lint (delta 0) + revisión final opus de la rama (trazar: compra mixta → 1 aviso equipo con todas las filas y 0 mails clienta; confirmar turno 1 de 2 → nada; confirmar 2 de 2 → 1 mail clienta con todo; re-confirmar → nada; canje → 1 mail clienta al comprar; turno manual del admin → sin mails; plata byte-intacta) → **ESPERAR confirmación de la usuaria de que corrió la migración** → deploy.
