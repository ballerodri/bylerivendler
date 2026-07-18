# Reservar un pack por la clienta desde el admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Desde Admin → Nueva reserva se puede comprar un pack por la clienta (con sus sesiones), sumar tratamientos, y que salga el mail de confirmación — usando el MISMO motor que la reserva online.

**Architecture:** `createBooking` (reserva/actions.ts) gana `adminMode`, protegido por una guarda de staff que corre ANTES de todo. En modo admin: sin puntos, sin magic link, sin aviso al equipo, packs sin exigir `visible_reserva`, turnos `confirmed` + `deposit_paid`, y el mail de confirmación al instante (mismo camino que el canje). El asistente `/admin/nueva-reserva` suma packs y el `PackSessionPicker` que ya existe, y llama a `createBooking` con `adminMode`.

Spec: `docs/superpowers/specs/2026-07-17-reservar-pack-desde-admin-design.md`.

## Global Constraints

- **SEGURIDAD (lo más importante):** `createBooking` es una server action pública. Con `adminMode: true` lo PRIMERO que corre —antes de cualquier lectura, escritura, descuento de puntos o mail— es la verificación de sesión de staff activa. Sin staff: `{ ok: false, error: "Acceso denegado" }` y CERO efectos. Fail-closed ante cualquier error de la verificación.
- **El camino público NO cambia:** sin `adminMode`, todo el comportamiento actual debe quedar byte-equivalente (puntos, seña, magic link, aviso al equipo, `visible_reserva`, estados `pending`).
- La plata no se toca: `total_cents`/`deposit_cents` se calculan con las MISMAS funciones de hoy. `paid_cents` sigue 0.
- En modo admin el `authUser` de la sesión (el salón) NUNCA se usa para la clienta: ni `clients.user_id`, ni magic link, ni nada.
- Todo mail/Calendar sigue best-effort (try/catch): una falla no rompe la reserva.
- tsc 0 · `npx vitest run` 189/189 · `npm run lint` sin problemas nuevos (baseline 20) · `npx next build` OK.
- Comentarios en castellano rioplatense, al tono de cada archivo.

### Task 1 — Motor: `adminMode` en `createBooking`

**Files:** Modify `src/lib/staff.ts` (helper exportado), `src/app/reserva/actions.ts` (`BookingInput`, `createBooking`, `planPack`), `src/lib/email/confirm-purchase.ts` (guarda `@noemail.local`).

**Produces:**
```ts
// src/lib/staff.ts — mismo criterio que el requireStaff privado de admin/actions.ts
export async function isActiveStaffSession(): Promise<boolean>
```
(lee el usuario de la sesión SSR y devuelve `isStaffUser(user.id)`; `false` ante ausencia de sesión o cualquier error — fail-closed. NO lanza.)

- `BookingInput`: agregar `adminMode: z.boolean().optional()`; `client.dob` y `client.marketingConsent` pasan a opcionales SÓLO en efecto práctico — mantener el schema compatible: `dob: z.string().optional()`, `marketingConsent: z.boolean().optional()` y usar `?? ""` / `?? false` donde se leen hoy (verificar `parseDob` con string vacío: debe dar null, no romper).
- `createBooking`, apenas parseado el input y ANTES de cualquier otra cosa:
  ```ts
  const adminMode = input.adminMode === true
  if (adminMode && !(await isActiveStaffSession()))
    return { ok: false, error: "Acceso denegado." }
  ```
- `const redeem = ...`: forzar `false` cuando `adminMode` (buscar dónde se calcula hoy y anteponer `!adminMode &&`).
- `planPack`: aceptar un parámetro/flag para no exigir `visible_reserva` cuando es admin (el `.eq("active", true)` se mantiene siempre).
- Insert de `appointments`: `status: adminMode || redeem ? "confirmed" : "pending"`; `deposit_paid: adminMode ? true : p.depositPaid`.
- FASE D: si `adminMode` → `try { await sendGroupConfirmationEmail(supabase, bookingGroupId) } catch {}` (igual que el camino redeem, y compartir esa rama si es natural) y **saltear** `notifyNewPurchase`.
- Bloque del magic link: agregar `!adminMode` a la condición, con comentario.
- Camino de la clienta: cuando `adminMode`, ignorar `authUser` (no vincular `user_id`, no comparar emails). Revisar los 2-3 puntos donde se usa.
- `src/lib/email/confirm-purchase.ts`: donde hoy chequea `!client?.email` para soltar el reclamo y salir, tratar también `email.endsWith("@noemail.local")` como "sin email" (comentario: son clientas cargadas a mano sin mail real).

**Verificar:** camino público sin `adminMode` byte-equivalente (leer los diffs de cada rama tocada); `adminMode: true` sin sesión de staff → sin ningún efecto; con staff → turnos `confirmed` + mail de la clienta + sin aviso al equipo + sin magic link.

**Commit:** `feat(reserva): el motor de reservas acepta modo admin (reservar por la clienta)`

### Task 2 — Asistente: packs en `/admin/nueva-reserva`

**Files:** Modify `src/app/admin/nueva-reserva/page.tsx` (cargar packs), `src/app/admin/nueva-reserva/nueva-reserva-form.tsx` (pasos), y si hace falta un componente nuevo en `src/app/admin/nueva-reserva/_components/`.

- `page.tsx`: además de los servicios, traer los **packs activos** (`packs` con `service:services(...)` y, si el servicio es `per_zone`, sus `service_zones` activas) → nuevo tipo `PackOption` exportado.
- Paso "Servicios" pasa a llamarse **"Qué reserva"**: sección de packs arriba (elegir uno o ninguno; si el servicio del pack es por zona, elegir zonas con las mismas reglas que los servicios) + los tratamientos como hoy.
- Paso "Fecha y hora": si hay pack, elegir fecha/hora de las sesiones con `PackSessionPicker` (`@/app/reserva/_components/pack-session-picker`, ya usado por el admin en `clientas/[id]/pack-sessions.tsx` — mirar ahí cómo se le pasan `businessHours`, `minDate` e `intervalDays`, y cómo se ofrece saltear el intervalo). Se puede dejar sesiones sin agendar. Si hay tratamientos, el buscador de siempre.
- Paso "Confirmar": itinerario cronológico (sesiones del pack + tratamientos) + total; si el email de la clienta está vacío o termina en `@noemail.local`, avisar "Esta clienta no tiene email: no va a recibir la confirmación".
- Submit → `createBooking({ adminMode: true, savedClientId (si existe), client: {...}, packId, packZoneIds, packSlots, packStaff: "auto", packChainedFirst: false, serviceIds, serviceOrder, resolvedStaff, zoneSelections, startsAt, proHint, payChoice: "full" })`. Con pack y sin tratamientos, `serviceIds: []` (el schema lo permite si hay `packId`).
- Al terminar: redirigir a `/admin/turnos` (o a la ficha de la clienta) como hace hoy el asistente.
- **NO tocar** `createAdminBooking` (sigue sirviendo al camino de sólo-tratamientos si el asistente lo mantiene) — si el asistente pasa a usar `createBooking` para TODO, dejar igual `createAdminBooking` sin borrarlo y decirlo en el reporte.

**Verificar:** pack solo; pack + tratamientos; sólo tratamientos (sin regresión); clienta nueva sin email; sesiones parciales (agendar 2 de 4).

**Commit:** `feat(admin): el asistente de reserva permite comprar un pack por la clienta`

### Final
tsc + vitest + build + lint (delta 0) + **revisión de seguridad dedicada** (trazar: visitante anónimo manda `adminMode: true` → ningún efecto; clienta logueada NO staff → ídem; staff → todo el flujo) + revisión final de la rama (camino público byte-equivalente; regla de oro intacta; plata intacta) → deploy.
