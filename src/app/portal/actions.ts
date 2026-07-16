"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendPurchaseCancellation, sendBookingReschedule } from "@/lib/email/booking-emails"
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { fetchDayAvailability } from "@/app/reserva/actions"
import { filterFutureSlots, AR_UTC_OFFSET } from "@/app/reserva/data"

type CancelResult = { ok: true } | { ok: false; error: string }

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Cancela de una vez TODOS los turnos cancelables de una compra — el link
 * único "Cancelar turnos" del portal. Sale UN solo mail con una línea por
 * turno (antes era un mail por turno, y la clienta recibía tres iguales).
 *
 * La propiedad se chequea con TODO o NADA: si UNO solo de los ids no existe
 * o no es de la clienta logueada, no se cancela ninguno.
 */
export async function cancelMyAppointments(
  appointmentIds: string[]
): Promise<CancelResult> {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión expirada" }

  // Sanidad: sin vacíos, sin repetidos y con un tope defensivo (una compra
  // real tiene un puñado de turnos; más que eso huele a abuso del endpoint).
  const ids = [...new Set(appointmentIds.filter((id) => typeof id === "string" && id.trim() !== ""))]
  if (!ids.length || ids.length > 20) {
    return { ok: false, error: "No podés cancelar estos turnos" }
  }

  const admin = adminClient()

  // Verificar que TODOS los turnos existan y pertenezcan a la clienta
  // autenticada — mismo chequeo de dueño que el resto de las acciones del
  // portal, pero sobre el lote entero.
  const { data } = await admin
    .from("appointments")
    .select(
      `id, status, starts_at, duration_min, total_cents, google_event_id,
       client:clients(id, user_id, email, first_name),
       appointment_services(service:services(name))`
    )
    .in("id", ids)

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
  const appts = (data ?? []) as unknown as ApptShape[]

  if (
    appts.length !== ids.length ||
    appts.some((a) => !a.client || a.client.user_id !== user.id)
  ) {
    return { ok: false, error: "No podés cancelar estos turnos" }
  }

  // Cancelable = todavía vivo. Los que ya no se pueden tocar (cancelados,
  // completados, no_show) se saltean sin cortar el resto.
  const cancellable = appts.filter(
    (a) => a.status !== "cancelled" && a.status !== "completed" && a.status !== "no_show"
  )
  if (!cancellable.length) {
    return { ok: false, error: "Estos turnos ya no se pueden cancelar" }
  }

  const { error } = await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .in("id", cancellable.map((a) => a.id))
  if (error) return { ok: false, error: error.message }

  // UN solo email de aviso a la clienta, con todos los turnos (no bloqueante).
  try {
    const c = cancellable[0].client!
    await sendPurchaseCancellation({
      to: c.email,
      firstName: c.first_name ?? "",
      items: cancellable
        .slice()
        .sort((x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime())
        .map((a) => ({
          startsAt: new Date(a.starts_at),
          servicesNames: a.appointment_services
            .map((as) => as.service?.name)
            .filter((n): n is string => Boolean(n)),
        })),
    })
  } catch {
    // ignore
  }

  // Borrar los eventos de Google Calendar (no bloqueante)
  for (const a of cancellable) {
    if (a.google_event_id) {
      deleteCalendarEvent(a.google_event_id).catch(() => {})
    }
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

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(new Date(leg.startMs))
    const bh = bhByDow.get(dayOfWeek)
    // Sólo la PRIMERA pata tiene que caer en la grilla de horarios reservables
    // (`bh.slots`): es el horario que la clienta eligió en pantalla. Las
    // patas 2..n arrancan encadenadas (`inicio + duraciones anteriores`) y
    // casi nunca caen en la grilla — el buscador no se lo exige, así que
    // exigírselo acá rechazaría cualquier reagendado de un turno con varios
    // servicios. Todas las patas sí tienen que caer en un día abierto.
    if (!bh?.is_open || (i === 0 && !bh.slots.includes(timeStr)))
      return { ok: false, error: "Ese horario ya no está disponible. Elegí otro." }
    const free = await fetchDayAvailability(
      dateStr, leg.durationMin, leg.staffId ?? "auto", [timeStr],
      {
        serviceId: leg.serviceId,
        excludeAppointmentId: appointmentId,
        // El turno ya existe con esta profesional (podría ser una que el
        // admin cargó a mano sin vincular en `staff_services`, el escape
        // hatch). No corresponde exigirle acá una regla que nunca tuvo que
        // cumplir para tener este turno.
        skipStaffServiceCheck: true,
      }
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
      // Deshacer TODAS las patas ya escritas en iteraciones anteriores (no
      // sólo el header): si la pata 1 ya quedó en el horario NUEVO y sólo se
      // revirtiera el header, el solver (`buildBusyLegs`) leería a esa
      // profesional libre en el horario VIEJO — el que la clienta todavía
      // tiene — y otra clienta podría reservarle encima.
      for (let j = 0; j < i; j++) {
        await admin
          .from("appointment_services")
          .update({ starts_at: orderedSvcs[j].starts_at })
          .eq("appointment_id", appointmentId)
          .eq("service_id", orderedSvcs[j].service_id)
      }
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

export type RescheduleSlotsResult = { ok: true; slots: string[] } | { ok: false; error: string }

/**
 * Horarios REALES de un día, para reagendar UN turno propio — la contraparte
 * AUTENTICADA de `fetchDayAvailability` para la pantalla de reagendado.
 *
 * Antes, la pantalla (componente cliente) llamaba directo a
 * `fetchDayAvailability` pasándole `excludeAppointmentId` a mano. Como esa
 * acción es pública (`"use server"`, sin chequeo de dueño), cualquiera podía
 * invocarla con el id de OTRO turno y usarla para sondear la disponibilidad
 * real de otra persona. Acá se verifica primero que la clienta sea DUEÑA del
 * turno (mismo chequeo que `rescheduleMyAppointment`) y recién después se
 * llama a `fetchDayAvailability` con la exclusión — la duración, el servicio y
 * la profesional se recalculan siempre del lado del servidor, nunca se
 * confía en lo que mande el cliente.
 */
export async function fetchRescheduleSlots(
  appointmentId: string,
  dateStr: string
): Promise<RescheduleSlotsResult> {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sesión expirada" }

  const admin = adminClient()

  const { data: appt } = await admin
    .from("appointments")
    .select(
      `id, status, duration_min, staff_id,
       client:clients(user_id),
       appointment_services(service_id, staff_id, starts_at, duration_min)`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type Shape = {
    id: string
    status: string
    duration_min: number
    staff_id: string | null
    client: { user_id: string | null } | null
    appointment_services: {
      service_id: string
      staff_id: string | null
      starts_at: string | null
      duration_min: number
    }[]
  }
  const a = appt as unknown as Shape

  if (!a.client || a.client.user_id !== user.id) {
    return { ok: false, error: "No podés reagendar este turno" }
  }
  if (a.status !== "pending" && a.status !== "confirmed") {
    return { ok: false, error: "Este turno ya no se puede reagendar" }
  }

  // Misma referencia que `rescheduleMyAppointment`: la PRIMERA pata por
  // horario. Un turno sin ninguna (no debería pasar, pero sería un turno
  // huérfano) se avisa en vez de dejar la pantalla "Buscando…" para siempre.
  const firstLeg = a.appointment_services
    .slice()
    .sort((x, y) => {
      if (!x.starts_at || !y.starts_at) return 0
      return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
    })[0]
  if (!firstLeg) {
    return { ok: false, error: "Este turno no tiene servicios asociados. Comunicate con el salón." }
  }

  const [dy, dm, dd] = dateStr.split("-").map(Number)
  if (!dy || !dm || !dd) return { ok: false, error: "Fecha inválida." }
  const dayOfWeek = new Date(Date.UTC(dy, dm - 1, dd, AR_UTC_OFFSET, 0, 0)).getUTCDay()

  const { data: bh, error: bhErr } = await admin
    .from("business_hours")
    .select("is_open, slots")
    .eq("day_of_week", dayOfWeek)
    .maybeSingle()
  if (bhErr) return { ok: false, error: "No pudimos verificar el horario. Probá de nuevo." }
  if (!bh?.is_open || !bh.slots.length) return { ok: true, slots: [] }

  const candidates = filterFutureSlots(dateStr, bh.slots)
  if (!candidates.length) return { ok: true, slots: [] }

  const slots = await fetchDayAvailability(
    dateStr,
    firstLeg.duration_min,
    firstLeg.staff_id ?? a.staff_id ?? "auto",
    candidates,
    {
      serviceId: firstLeg.service_id,
      excludeAppointmentId: appointmentId,
      skipStaffServiceCheck: true,
    }
  )
  return { ok: true, slots }
}
