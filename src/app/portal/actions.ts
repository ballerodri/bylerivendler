"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingCancellation, sendBookingReschedule } from "@/lib/email/booking-emails"
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { fetchDayAvailability } from "@/app/reserva/actions"

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
      `id, status, starts_at, ends_at, duration_min, total_cents, google_event_id, staff_id,
       client:clients(id, user_id, email, first_name, last_name),
       staff:staff(full_name),
       appointment_services(service_id, staff_id, starts_at, duration_min, service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type ApptShape = {
    id: string
    status: string
    starts_at: string
    ends_at: string
    duration_min: number
    total_cents: number
    google_event_id: string | null
    staff_id: string | null
    client: {
      id: string
      user_id: string | null
      email: string
      first_name: string | null
      last_name: string | null
    } | null
    appointment_services: {
      service_id: string
      staff_id: string | null
      starts_at: string | null
      duration_min: number
      service: { name: string } | null
    }[]
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

  // Orden actual de las patas (preservado por el reagendado, igual que antes).
  const orderedSvcs = a.appointment_services
    .slice()
    .sort((x, y) => {
      if (!x.starts_at || !y.starts_at) return 0
      return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
    })

  // Ventana escalonada de CADA pata a partir del horario nuevo — la MISMA
  // cuenta se usa para validar disponibilidad (abajo) y para reescribir
  // `appointment_services.starts_at` una vez confirmado el cambio.
  let legMs = newDate.getTime()
  const legs = orderedSvcs.map((svc) => {
    const startMs = legMs
    legMs += svc.duration_min * 60_000
    return {
      serviceId: svc.service_id,
      durationMin: svc.duration_min,
      staffId: svc.staff_id ?? a.staff_id ?? null,
      startMs,
    }
  })

  // ── Revalidar CADA pata contra la disponibilidad real (autoritativo) ──────
  // La pantalla arma su lista de horarios sólo con horario comercial (sin
  // mirar turnos existentes de nadie): el servidor tiene la última palabra.
  // Se excluye el propio turno (`excludeAppointmentId`): se está moviendo a
  // sí mismo, no puede bloquearse a sí mismo.
  const { data: bhRows, error: bhErr } = await admin
    .from("business_hours")
    .select("day_of_week, is_open, slots")
  if (bhErr) return { ok: false, error: "No pudimos verificar el horario. Probá de nuevo." }
  const bhByDow = new Map(
    ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
      .map((h) => [h.day_of_week, h])
  )

  for (const leg of legs) {
    const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(new Date(leg.startMs))
    const bh = bhByDow.get(dayOfWeek)
    if (!bh?.is_open || !bh.slots.includes(timeStr))
      return { ok: false, error: "Ese horario ya no está disponible. Elegí otro." }
    const free = await fetchDayAvailability(
      dateStr, leg.durationMin, leg.staffId ?? "auto", [timeStr], leg.serviceId, appointmentId
    )
    if (!free.includes(timeStr))
      return { ok: false, error: "El horario se ocupó. Elegí otro." }
  }

  const prevStartsAt = a.starts_at
  const prevEndsAt = a.ends_at

  const { error } = await admin
    .from("appointments")
    .update({ starts_at: newDate.toISOString(), ends_at: endsAt.toISOString() })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }

  // Re-escalonar cada servicio (`appointment_services.starts_at`) a partir del
  // nuevo inicio, preservando su orden actual. El solver de disponibilidad
  // (`buildBusyLegs`) lee la ventana de CADA pata acá, no la del turno: si no
  // se actualizara, las patas quedarían en el horario VIEJO mientras el turno
  // dice el nuevo, mostrando a la profesional libre justo cuando en realidad
  // sigue con esta clienta — mismo loop que `rescheduleAppointment` (admin).
  //
  // Si ALGUNA pata falla a mitad de camino, el turno queda con el header en
  // el horario NUEVO pero alguna pata en el VIEJO — exactamente lo que lee el
  // solver, así que la profesional parecería libre en el horario nuevo. Se
  // revierte el header al horario anterior en vez de dejar la agenda
  // inconsistente.
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const svc = orderedSvcs[i]
    const { error: legErr } = await admin
      .from("appointment_services")
      .update({ starts_at: new Date(leg.startMs).toISOString() })
      .eq("appointment_id", appointmentId)
      .eq("service_id", svc.service_id)
    if (legErr) {
      await admin
        .from("appointments")
        .update({ starts_at: prevStartsAt, ends_at: prevEndsAt })
        .eq("id", appointmentId)
      return { ok: false, error: "No pudimos reagendar. Probá de nuevo." }
    }
  }

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
      startsAt: newDate,
      endsAt,
      notes: null,
    }).catch(() => {})
  }

  revalidatePath("/portal")
  return { ok: true }
}
