"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingCancellation, sendBookingReschedule } from "@/lib/email/booking-emails"
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar"

type CancelResult = { ok: true } | { ok: false; error: string }

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function cancelMyAppointment(
  appointmentId: string
): Promise<CancelResult> {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión expirada" }

  const admin = adminClient()

  // Verificar que el turno pertenezca a la clienta autenticada.
  const { data: appt } = await admin
    .from("appointments")
    .select(
      `id, status, starts_at, duration_min, total_cents, google_event_id,
       client:clients(id, user_id, email, first_name),
       appointment_services(service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type ApptShape = {
    id: string
    status: string
    starts_at: string
    duration_min: number
    total_cents: number
    google_event_id: string | null
    client: {
      id: string
      user_id: string | null
      email: string
      first_name: string | null
    } | null
    appointment_services: { service: { name: string } | null }[]
  }
  const a = appt as unknown as ApptShape

  if (!a.client || a.client.user_id !== user.id) {
    return { ok: false, error: "No podés cancelar este turno" }
  }

  if (a.status === "cancelled" || a.status === "completed" || a.status === "no_show") {
    return { ok: false, error: "Este turno ya no se puede cancelar" }
  }

  const { error } = await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }

  // Email de aviso a la clienta (no bloqueante).
  try {
    const services = a.appointment_services
      .map((as) => as.service?.name)
      .filter((n): n is string => Boolean(n))
    await sendBookingCancellation({
      to: a.client.email,
      firstName: a.client.first_name ?? "",
      servicesNames: services,
      startsAt: new Date(a.starts_at),
      durationMin: a.duration_min,
      totalCents: a.total_cents,
      appointmentId: a.id,
    })
  } catch {
    // ignore
  }

  // Borrar evento de Google Calendar (no bloqueante)
  if (a.google_event_id) {
    deleteCalendarEvent(a.google_event_id).catch(() => {})
  }

  revalidatePath("/portal")
  return { ok: true }
}

export type RescheduleResult = { ok: true } | { ok: false; error: string }

export async function rescheduleMyAppointment(
  appointmentId: string,
  newStartsAt: string
): Promise<RescheduleResult> {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión expirada" }

  const admin = adminClient()

  const { data: appt } = await admin
    .from("appointments")
    .select(
      `id, status, duration_min, total_cents, google_event_id,
       client:clients(id, user_id, email, first_name, last_name),
       staff:staff(full_name, calendar_color_id),
       appointment_services(service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type ApptShape = {
    id: string
    status: string
    duration_min: number
    total_cents: number
    google_event_id: string | null
    client: {
      id: string
      user_id: string | null
      email: string
      first_name: string | null
      last_name: string | null
    } | null
    appointment_services: { service: { name: string } | null }[]
  }
  const a = appt as unknown as ApptShape

  if (!a.client || a.client.user_id !== user.id) {
    return { ok: false, error: "No podés reagendar este turno" }
  }

  if (a.status !== "pending" && a.status !== "confirmed") {
    return { ok: false, error: "Este turno ya no se puede reagendar" }
  }

  const newDate = new Date(newStartsAt)
  if (isNaN(newDate.getTime())) return { ok: false, error: "Fecha inválida" }

  const endsAt = new Date(newDate.getTime() + a.duration_min * 60_000)

  const { error } = await admin
    .from("appointments")
    .update({ starts_at: newDate.toISOString(), ends_at: endsAt.toISOString() })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }

  try {
    const services = a.appointment_services
      .map((as) => as.service?.name)
      .filter((n): n is string => Boolean(n))
    await sendBookingReschedule({
      to: a.client.email,
      firstName: a.client.first_name ?? "",
      servicesNames: services,
      startsAt: newDate,
      durationMin: a.duration_min,
      totalCents: a.total_cents,
      appointmentId: a.id,
    })
  } catch {
    // ignore — el turno ya fue movido
  }

  // Actualizar evento en Google Calendar (no bloqueante)
  if (a.google_event_id) {
    const serviceNames = a.appointment_services
      .map((s) => s.service?.name)
      .filter((n): n is string => Boolean(n))
    updateCalendarEvent(a.google_event_id, {
      appointmentId,
      clientName: `${a.client?.first_name ?? ""} ${a.client?.last_name ?? ""}`.trim(),
      serviceNames,
      staffName: (a as any).staff?.full_name ?? null,
      staffEmail: null,
      staffColorId: (a as any).staff?.calendar_color_id ?? null,
      startsAt: newDate,
      endsAt,
      notes: null,
    }).catch(() => {})
  }

  revalidatePath("/portal")
  return { ok: true }
}
