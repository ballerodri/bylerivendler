"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser, requireAdmin } from "@/lib/staff"
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from "@/lib/google-calendar"
import { sendBookingReschedule } from "@/lib/email/booking-emails"
import { computeZonePricing, resolveSelectedZones, type Zone, type ZoneSnapshot } from "@/lib/servicios/zones"
import { notifyNewBooking } from "@/lib/email/notify-booking"
import { minStartForNextSession, arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { fetchDayAvailability } from "@/app/reserva/actions"

const StatusSchema = z.enum([
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
])

async function requireStaff() {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Sin sesión")
  const ok = await isStaffUser(user.id)
  if (!ok) throw new Error("Acceso denegado")
  return user
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// "Vivo" = no cancelado ni no_show. Un turno cancelado/no_show no cuenta
// como sesión ocupada del pack a efectos de plata (estadísticas ya los
// excluye de la facturación) ni de superposición de horarios.
function isAliveStatus(status: string): boolean {
  return status !== "cancelled" && status !== "no_show"
}

/**
 * Garantiza que el precio del pack esté puesto en EXACTAMENTE un turno VIVO
 * (ver `isAliveStatus`). Se llama después de cualquier cambio de estado que
 * pueda matar o resucitar un turno de un pack (cancelar, no_show, reactivar,
 * eliminar) y también al agendar una sesión nueva.
 *
 * El blanqueo de turnos MUERTOS que todavía llevaran precio (`zeroDeadCarriers`)
 * corre en TODAS las ramas, no sólo en la 2: un turno muerto nunca debe
 * conservar el precio, porque un "Reactivar" posterior lo resucitaría como
 * SEGUNDO portador (plata duplicada + segunda Factura C a ARCA). No hay
 * riesgo de perder la plata: el precio siempre se re-deriva de
 * `packs.total_price_cents`, nunca se acarrea en una variable entre filas.
 *
 * Reglas (en este orden):
 *  1. Si algún turno VIVO ya tiene total_cents > 0 → no se lo toca (nunca se
 *     mueve un precio ya bien puesto — en particular nunca se le saca el
 *     precio a un turno "completed", cuya plata ya está contabilizada), pero
 *     igual se blanquean los muertos.
 *  2. Si no, y hay al menos un turno vivo → el VIVO más antiguo (por
 *     starts_at) pasa a ser el portador (turno + su appointment_services).
 *     Si la promoción falla, NO se blanquean los muertos (la plata todavía
 *     vive ahí; blanquearlos la haría desaparecer del todo).
 *  3. Si no hay NINGÚN turno vivo → no hay a quién pasarle el precio todavía
 *     (la próxima sesión que se agende lo va a recoger, ver
 *     `schedulePackSession`), pero igual se blanquean los muertos.
 */
async function syncPackPriceCarrier(
  admin: ReturnType<typeof adminClient>,
  packPurchaseId: string
): Promise<void> {
  const { data: pp } = await admin
    .from("pack_purchases")
    .select("pack_id")
    .eq("id", packPurchaseId)
    .maybeSingle()
  if (!pp) return

  const { data: pack } = await admin
    .from("packs")
    .select("total_price_cents")
    .eq("id", pp.pack_id)
    .maybeSingle()
  const packPriceCents = pack?.total_price_cents ?? 0

  const { data: apptsData } = await admin
    .from("appointments")
    .select("id, status, total_cents, starts_at")
    .eq("pack_purchase_id", packPurchaseId)
  const appts = (apptsData ?? []) as { id: string; status: string; total_cents: number; starts_at: string }[]

  const alive = appts.filter((a) => isAliveStatus(a.status))

  const zeroDeadCarriers = async () => {
    for (const d of appts.filter((a) => !isAliveStatus(a.status) && a.total_cents > 0)) {
      await admin.from("appointments").update({ total_cents: 0 }).eq("id", d.id)
      await admin.from("appointment_services").update({ price_cents: 0 }).eq("appointment_id", d.id)
    }
  }

  if (alive.some((a) => a.total_cents > 0)) {
    await zeroDeadCarriers() // regla 1
    return
  }

  if (!alive.length) {
    await zeroDeadCarriers() // regla 3
    return
  }

  // regla 2: promover al vivo más antiguo y blanquear muertos con precio.
  const carrier = [...alive].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  )[0]
  const { error: promoteErr } = await admin
    .from("appointments")
    .update({ total_cents: packPriceCents })
    .eq("id", carrier.id)
  if (promoteErr) return // la plata no quedó en un vivo: no blanquear los muertos
  await admin
    .from("appointment_services")
    .update({ price_cents: packPriceCents })
    .eq("appointment_id", carrier.id)
  await zeroDeadCarriers()
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: string,
  packPurchaseId?: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = StatusSchema.safeParse(status)
  if (!parsed.success) return { ok: false, error: "Estado inválido" }

  const admin = adminClient()

  // Estado anterior, para detectar transición a "completed" y sumar puntos
  // exactamente una vez.
  const { data: prev } = await admin
    .from("appointments")
    .select("status, client_id, google_event_id, pack_purchase_id")
    .eq("id", appointmentId)
    .maybeSingle()

  // Reactivar (mover de cancelled/no_show hacia cualquier otro estado) un
  // turno de un pack: si el pack ya tiene sessions_total turnos VIVOS sin
  // contar este, reactivarlo le regalaría una sesión de más a la clienta
  // (ya pagó por sessions_total nomás). Se rechaza acá, ANTES de tocar nada.
  const wasDead = prev?.status === "cancelled" || prev?.status === "no_show"
  const reactivating = wasDead && isAliveStatus(parsed.data)
  if (reactivating && prev?.pack_purchase_id) {
    const { data: pp } = await admin
      .from("pack_purchases")
      .select("sessions_total")
      .eq("id", prev.pack_purchase_id)
      .maybeSingle()
    if (pp) {
      const { count, error: countErr } = await admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("pack_purchase_id", prev.pack_purchase_id)
        .neq("id", appointmentId)
        .not("status", "in", "(cancelled,no_show)")
      // Fail closed: si no podemos leer cuántas sesiones vivas tiene el pack,
      // no arriesgamos regalar una sesión de más — se rechaza la reactivación.
      if (countErr) {
        return {
          ok: false,
          error: "No pudimos verificar las sesiones de este pack. Probá de nuevo en un momento.",
        }
      }
      if ((count ?? 0) >= pp.sessions_total) {
        return {
          ok: false,
          error: "Este pack ya tiene agendadas todas sus sesiones pagas: no podés reactivar esta sin cancelar otra primero.",
        }
      }
    }
  }

  const { error } = await admin
    .from("appointments")
    .update({ status: parsed.data })
    .eq("id", appointmentId)

  if (error) return { ok: false, error: error.message }

  // Al cancelar: borrar el evento de Google Calendar (no bloqueante)
  if (parsed.data === "cancelled" && prev?.google_event_id) {
    deleteCalendarEvent(prev.google_event_id).catch(() => {})
  }

  // Si pasó a `completed` (y antes no lo estaba), sumar puntos del Programa Cerca.
  if (
    parsed.data === "completed" &&
    prev &&
    prev.status !== "completed" &&
    prev.client_id
  ) {
    type EarnedRow = { service: { points_earned: number; loyalty_enabled: boolean } | null }
    const { data: rows } = await admin
      .from("appointment_services")
      .select("service:services(points_earned, loyalty_enabled)")
      .eq("appointment_id", appointmentId)
    const earned = ((rows as unknown as EarnedRow[] | null) ?? []).reduce(
      (sum, r) => sum + (r.service?.loyalty_enabled ? (r.service.points_earned ?? 0) : 0),
      0
    )
    if (earned > 0) {
      // increment via RPC-style: select current and update.
      const { data: client } = await admin
        .from("clients")
        .select("loyalty_points")
        .eq("id", prev.client_id)
        .maybeSingle()
      const currentPoints = (client?.loyalty_points as number | null) ?? 0
      await admin
        .from("clients")
        .update({ loyalty_points: currentPoints + earned })
        .eq("id", prev.client_id)
    }
  }

  // ── Packs: descontar al entrar a completed; devolver al salir ──
  const enteringCompleted = parsed.data === "completed" && prev?.status !== "completed"
  const leavingCompleted = prev?.status === "completed" && parsed.data !== "completed"

  // Pack al que quedó ligado este turno al terminar esta llamada (para
  // sincronizar el portador del precio más abajo). Normalmente es el que ya
  // traía (`prev.pack_purchase_id`); si recién se ligó acá abajo (turno
  // suelto que eligió un pack al completarse), se actualiza también.
  let linkedPackId: string | null = prev?.pack_purchase_id ?? null

  if (enteringCompleted) {
    // Un turno que YA nace de un pack (sesión pre-agendada) descuenta SOLO.
    // Un turno suelto descuenta sólo si quien llama eligió un pack a mano.
    const linkedId = prev?.pack_purchase_id ?? packPurchaseId ?? null
    if (linkedId) {
      linkedPackId = linkedId
      const { data: pp } = await admin
        .from("pack_purchases")
        .select("sessions_total, sessions_used")
        .eq("id", linkedId)
        .maybeSingle()
      if (pp && pp.sessions_used < pp.sessions_total) {
        await admin
          .from("pack_purchases")
          .update({ sessions_used: pp.sessions_used + 1 })
          .eq("id", linkedId)
        if (!prev?.pack_purchase_id) {
          await admin
            .from("appointments")
            .update({ pack_purchase_id: linkedId })
            .eq("id", appointmentId)
        }
      }
    }
  }

  if (leavingCompleted && prev?.pack_purchase_id) {
    const { data: pp } = await admin
      .from("pack_purchases")
      .select("sessions_used")
      .eq("id", prev.pack_purchase_id)
      .maybeSingle()
    if (pp && pp.sessions_used > 0) {
      await admin
        .from("pack_purchases")
        .update({ sessions_used: pp.sessions_used - 1 })
        .eq("id", prev.pack_purchase_id)
    }
    // NO se limpia pack_purchase_id: las sesiones de un pack nacen ligadas
    // (se pre-crean al comprar el pack) y el vínculo es intrínseco al turno,
    // esté completado o no. Si lo borráramos, la sesión desaparecería de la
    // lista del pack y "sesiones por agendar" (total − ligadas) subiría,
    // permitiendo agendar de más sobre lo pagado.
  }

  // Cancelar, marcar no_show o reactivar puede matar o resucitar el turno
  // que lleva la plata del pack: sincronizar el portador después de aplicar
  // el cambio de estado (ver `syncPackPriceCarrier`).
  if (linkedPackId) {
    await syncPackPriceCarrier(admin, linkedPackId)
  }

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
  revalidatePath("/admin/clientas")
  revalidatePath("/portal")
  return { ok: true }
}

export async function deleteAppointment(
  appointmentId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  // Borrar evento de Google Calendar si existe
  const { data: appt } = await admin
    .from("appointments")
    .select("google_event_id, pack_purchase_id, status")
    .eq("id", appointmentId)
    .maybeSingle()
  if (appt?.google_event_id) {
    deleteCalendarEvent(appt.google_event_id).catch(() => {})
  }

  const { error } = await admin
    .from("appointments")
    .delete()
    .eq("id", appointmentId)

  if (error) return { ok: false, error: error.message }

  // Devolver la sesión al pack SOLO si el turno llegó a consumirla (status
  // "completed"). Las sesiones de un pack se pre-crean al comprar el pack,
  // ya ligadas (pack_purchase_id) pero SIN haber descontado sessions_used
  // todavía — eso pasa recién al completarse. Si devolviéramos la sesión
  // por cualquier turno ligado sin importar su estado, borrar una sesión
  // "pending" (nunca completada) le regalaría a la clienta una sesión que
  // nunca gastó.
  if (appt?.pack_purchase_id && appt.status === "completed") {
    const { data: pp } = await admin
      .from("pack_purchases")
      .select("sessions_used")
      .eq("id", appt.pack_purchase_id)
      .maybeSingle()
    if (pp && pp.sessions_used > 0) {
      await admin
        .from("pack_purchases")
        .update({ sessions_used: pp.sessions_used - 1 })
        .eq("id", appt.pack_purchase_id)
    }
  }

  // Borrar el turno puede haberse llevado puesto al portador del precio del
  // pack (p.ej. el turno "completed" que lo cargaba): sincronizar para que la
  // plata se re-derive sobre los turnos que quedan vivos (ver
  // `syncPackPriceCarrier`). Si no se hiciera esto, un pack ya completado
  // cuyo portador se elimina se queda con TODOS sus turnos en $0 y nada lo
  // vuelve a sincronizar → la plata del pack desaparece de estadísticas.
  if (appt?.pack_purchase_id) {
    await syncPackPriceCarrier(admin, appt.pack_purchase_id)
  }

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
  revalidatePath("/admin/clientas")
  revalidatePath("/portal")
  return { ok: true }
}

export async function rescheduleAppointment(
  appointmentId: string,
  newStartsAt: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()

  const newDate = new Date(newStartsAt)
  if (isNaN(newDate.getTime())) return { ok: false, error: "Fecha inválida" }

  const admin = adminClient()

  const { data: appt, error: apptErr } = await admin
    .from("appointments")
    .select(
      `id, status, duration_min, total_cents, google_event_id, staff_id,
       client:clients(email, first_name, last_name),
       staff:staff(full_name, email),
       appointment_services(service_id, starts_at, duration_min, service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (apptErr) return { ok: false, error: apptErr.message }
  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type SvcShape = { service_id: string; starts_at: string | null; duration_min: number; service: { name: string } | null }
  type ApptShape = {
    id: string
    status: string
    duration_min: number
    total_cents: number
    google_event_id: string | null
    staff_id: string | null
    client: { email: string; first_name: string | null; last_name: string | null } | null
    staff: { full_name: string; email: string | null } | null
    appointment_services: SvcShape[]
  }
  const a = appt as unknown as ApptShape

  const endsAt = new Date(newDate.getTime() + a.duration_min * 60_000)

  const { error } = await admin
    .from("appointments")
    .update({ starts_at: newDate.toISOString(), ends_at: endsAt.toISOString() })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }

  // Update per-service starts_at sequentially (preserve existing order by their current starts_at)
  const orderedSvcs = a.appointment_services
    .slice()
    .sort((x, y) => {
      if (!x.starts_at || !y.starts_at) return 0
      return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
    })
  let svcMs = newDate.getTime()
  for (const svc of orderedSvcs) {
    await admin
      .from("appointment_services")
      .update({ starts_at: new Date(svcMs).toISOString() })
      .eq("appointment_id", appointmentId)
      .eq("service_id", svc.service_id)
    svcMs += svc.duration_min * 60_000
  }

  if (a.client) {
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
      staffName: a.staff?.full_name ?? null,
      staffEmail: a.staff?.email ?? null,
      staffColorId: a.staff_id
        ? ((await admin.from("staff").select("calendar_color_id").eq("id", a.staff_id).maybeSingle()).data as any)?.calendar_color_id ?? null
        : null,
      startsAt: newDate,
      endsAt,
      notes: null,
    }).catch(() => {})
  }

  revalidatePath("/admin/turnos")
  revalidatePath("/portal")
  return { ok: true }
}

const StaffInput = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.enum(["admin", "professional", "reception"]),
})

export async function inviteStaff(
  raw: { email: string; full_name: string; role: string }
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = StaffInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "Datos inválidos" }

  const admin = adminClient()
  const lower = parsed.data.email.toLowerCase()

  const { data: existing } = await admin
    .from("staff")
    .select("id")
    .ilike("email", lower)
    .maybeSingle()
  if (existing) return { ok: false, error: "Ya existe un staff con ese email" }

  const { error } = await admin.from("staff").insert({
    email: lower,
    full_name: parsed.data.full_name,
    role: parsed.data.role,
    active: true,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/staff")
  return { ok: true }
}

export async function setStaffActive(
  staffId: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireStaff()
  const admin = adminClient()

  // No te dejes desactivar a vos misma sin querer.
  const { data: row } = await admin
    .from("staff")
    .select("user_id")
    .eq("id", staffId)
    .maybeSingle()
  if (row?.user_id === user.id && !active) {
    return { ok: false, error: "No podés desactivar tu propia cuenta" }
  }

  const { error } = await admin
    .from("staff")
    .update({ active })
    .eq("id", staffId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/staff")
  return { ok: true }
}

const ZoneInput = z.object({
  name: z.string().trim().min(1),
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().nonnegative().nullable(),
})

const ServicePatch = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  pricing_mode: z.enum(["fixed", "per_zone"]),
  zone_selection: z.enum(["multiple", "single"]).default("multiple"),
  duration_min: z.number().int().nonnegative(),
  price_cents: z.number().int().nonnegative(),
  points_earned: z.number().int().nonnegative().optional(),
  points_cost: z.number().int().nonnegative().optional(),
  active: z.boolean(),
  visible_public: z.boolean(),
  zones: z.array(ZoneInput).default([]),
})

export async function updateService(
  serviceId: string,
  patch: z.infer<typeof ServicePatch>
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = ServicePatch.safeParse(patch)
  if (!parsed.success) return { ok: false, error: "Datos inválidos" }
  const v = parsed.data
  if (v.pricing_mode === "per_zone" && v.zones.length === 0)
    return { ok: false, error: "Un servicio por zona necesita al menos una zona." }
  if (v.pricing_mode === "fixed" && v.duration_min < 1)
    return { ok: false, error: "La duración debe ser mayor a 0" }

  const admin = adminClient()
  const { zones, ...serviceFields } = v
  const { error } = await admin
    .from("services")
    .update({ ...serviceFields, duration_min: v.pricing_mode === "per_zone" ? 0 : v.duration_min })
    .eq("id", serviceId)
  if (error) return { ok: false, error: error.message }

  const syncErr = await syncServiceZones(admin, serviceId, v.pricing_mode, zones)
  if (syncErr) return { ok: false, error: syncErr }

  revalidatePath("/admin/servicios")
  revalidatePath(`/admin/servicios/${serviceId}`)
  return { ok: true }
}

// Reemplaza todas las zonas del servicio por la lista dada (delete-all + insert).
// Para servicios 'fixed' deja la tabla sin zonas.
async function syncServiceZones(
  admin: ReturnType<typeof adminClient>,
  serviceId: string,
  pricingMode: "fixed" | "per_zone",
  zones: { name: string; duration_min: number; price_cents: number | null }[]
): Promise<string | null> {
  const { error: delErr } = await admin.from("service_zones").delete().eq("service_id", serviceId)
  if (delErr) return delErr.message
  if (pricingMode !== "per_zone" || zones.length === 0) return null
  const rows = zones.map((z, i) => ({
    service_id: serviceId,
    name: z.name.trim(),
    duration_min: z.duration_min,
    price_cents: z.price_cents,
    order_index: i,
  }))
  const { error: insErr } = await admin.from("service_zones").insert(rows)
  return insErr ? insErr.message : null
}

export async function uploadClientPhoto(
  clientId: string,
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()

  const file = formData.get("file")
  const type = formData.get("type")

  if (!(file instanceof File) || !file.size) return { ok: false, error: "Archivo requerido" }
  if (type !== "before" && type !== "after") return { ok: false, error: "Tipo inválido" }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const path = `${clientId}/${crypto.randomUUID()}.${ext}`
  const buffer = await file.arrayBuffer()

  const admin = adminClient()

  const { error: storageErr } = await admin.storage
    .from("client-photos")
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (storageErr) return { ok: false, error: storageErr.message }

  const { error: dbErr } = await admin.from("client_photos").insert({
    client_id: clientId,
    storage_path: path,
    type,
    visible_to_client: false,
  })

  if (dbErr) {
    await admin.storage.from("client-photos").remove([path])
    return { ok: false, error: dbErr.message }
  }

  revalidatePath(`/admin/clientas/${clientId}`)
  return { ok: true }
}

export async function deleteClientPhoto(
  photoId: string,
  clientId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()

  const admin = adminClient()
  const { data: photo } = await admin
    .from("client_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle()

  if (!photo) return { ok: false, error: "Foto no encontrada" }

  await admin.storage.from("client-photos").remove([photo.storage_path])
  await admin.from("client_photos").delete().eq("id", photoId)

  revalidatePath(`/admin/clientas/${clientId}`)
  return { ok: true }
}

export async function togglePhotoVisibility(
  photoId: string,
  clientId: string,
  visible: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()

  const admin = adminClient()
  const { error } = await admin
    .from("client_photos")
    .update({ visible_to_client: visible })
    .eq("id", photoId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/admin/clientas/${clientId}`)
  revalidatePath("/portal")
  return { ok: true }
}

// Elimina una clienta y todo su historial (turnos, fichas, fotos, packs).
// Los turnos tienen FK "restrict", así que se borran primero (cascadea
// appointment_services). El resto cae por cascada; las facturas se conservan
// (invoices.client_id → null).
export async function deleteClient(
  clientId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { error: apptErr } = await admin.from("appointments").delete().eq("client_id", clientId)
  if (apptErr) return { ok: false, error: `No se pudieron borrar los turnos: ${apptErr.message}` }

  const { error } = await admin.from("clients").delete().eq("id", clientId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/clientas")
  return { ok: true }
}


// ─── Categorías ───────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function createCategory(
  name: string,
  tagline: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireStaff()
  if (!name.trim()) return { ok: false, error: "El nombre es obligatorio" }

  const admin = adminClient()
  const { data: last } = await admin
    .from("service_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()

  const slug = toSlug(name)
  const { data, error } = await admin
    .from("service_categories")
    .insert({
      slug,
      name: name.trim(),
      tagline: tagline.trim() || null,
      sort_order: (last?.sort_order ?? 0) + 10,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/servicios")
  return { ok: true, id: data.id }
}

export async function deleteCategory(
  categoryId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff()
  const admin = adminClient()

  const { count } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId)

  if ((count ?? 0) > 0)
    return { ok: false, error: "La categoría tiene servicios. Eliminá los servicios primero." }

  const { error } = await admin
    .from("service_categories")
    .delete()
    .eq("id", categoryId)

  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/servicios")
  return { ok: true }
}

// ─── Servicios ────────────────────────────────────────────────────────────────

export async function createService(
  categoryId: string,
  data: {
    name: string
    description: string
    pricing_mode: "fixed" | "per_zone"
    zone_selection?: "multiple" | "single"
    duration_min: number
    price_cents: number
    points_earned?: number
    points_cost?: number
    zones: { name: string; duration_min: number; price_cents: number | null }[]
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireStaff()
  if (!data.name.trim()) return { ok: false, error: "El nombre es obligatorio" }
  if (data.pricing_mode === "fixed" && data.duration_min < 1)
    return { ok: false, error: "La duración debe ser mayor a 0" }
  if (data.pricing_mode === "per_zone" && data.zones.length === 0)
    return { ok: false, error: "Un servicio por zona necesita al menos una zona." }

  const admin = adminClient()
  const slug = toSlug(data.name) + "-" + Date.now()
  const { data: created, error } = await admin
    .from("services")
    .insert({
      category_id: categoryId,
      slug,
      name: data.name.trim(),
      description: data.description.trim() || null,
      pricing_mode: data.pricing_mode,
      zone_selection: data.zone_selection ?? "multiple",
      duration_min: data.pricing_mode === "per_zone" ? 0 : data.duration_min,
      price_cents: data.price_cents,
      points_earned: data.points_earned ?? 0,
      points_cost: data.points_cost ?? 0,
      active: true,
      visible_public: true,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }

  const syncErr = await syncServiceZones(admin, created.id, data.pricing_mode, data.zones)
  if (syncErr) return { ok: false, error: syncErr }

  revalidatePath("/admin/servicios")
  return { ok: true, id: created.id }
}

export async function deleteService(
  serviceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff()
  const admin = adminClient()
  const { error } = await admin.from("services").delete().eq("id", serviceId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/servicios")
  return { ok: true }
}

// ─── Staff ────────────────────────────────────────────────────────────────────

export async function updateStaffProfessional(
  staffId: string,
  isProfessional: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()
  const { error } = await admin
    .from("staff")
    .update({ is_professional: isProfessional })
    .eq("id", staffId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/staff")
  return { ok: true }
}

// ─── Profesionales por servicio ───────────────────────────────────────────────

// Programa Cerca: participación + puntos (suma/canje) de todos los servicios de una.
export async function updateLoyaltyConfig(
  rows: { id: string; loyalty_enabled: boolean; points_earned: number; points_cost: number }[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()
  const results = await Promise.all(
    rows.map((r) =>
      admin
        .from("services")
        .update({
          loyalty_enabled: r.loyalty_enabled,
          points_earned: Math.max(0, r.points_earned),
          points_cost: Math.max(0, r.points_cost),
        })
        .eq("id", r.id)
    )
  )
  const failed = results.find((res) => res.error)
  if (failed?.error) return { ok: false, error: failed.error.message }
  revalidatePath("/admin/programa-cerca")
  revalidatePath("/admin/servicios")
  return { ok: true }
}

export async function updateServiceStaff(
  serviceId: string,
  staffIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  // Reemplazamos la asignación completa: borramos y volvemos a insertar.
  const { error: delErr } = await admin
    .from("staff_services")
    .delete()
    .eq("service_id", serviceId)
  if (delErr) return { ok: false, error: delErr.message }

  if (staffIds.length > 0) {
    const rows = staffIds.map((sid) => ({ staff_id: sid, service_id: serviceId }))
    const { error: insErr } = await admin.from("staff_services").insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath(`/admin/servicios/${serviceId}`)
  return { ok: true }
}

// ─── Horarios ─────────────────────────────────────────────────────────────────

export async function updateBusinessHours(
  hours: { day_of_week: number; is_open: boolean; slots: string[] }[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  for (const h of hours) {
    const { error } = await admin
      .from("business_hours")
      .upsert({ day_of_week: h.day_of_week, is_open: h.is_open, slots: h.slots })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath("/admin/horarios")
  revalidatePath("/reserva")
  return { ok: true }
}

// ─── Reglas de orden entre servicios ──────────────────────────────────────────

/**
 * Reemplaza todas las reglas donde serviceId es el PRIMERO
 * (i.e. "serviceId debe ir antes que X").
 */
export async function updateServiceOrderRules(
  serviceId: string,
  mustBeforeIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  // Borrar reglas existentes donde este servicio es el primero
  const { error: delErr } = await admin
    .from("service_order_rules")
    .delete()
    .eq("service_first_id", serviceId)

  if (delErr) return { ok: false, error: delErr.message }

  if (mustBeforeIds.length > 0) {
    const rows = mustBeforeIds.map((id) => ({
      service_first_id: serviceId,
      service_second_id: id,
    }))
    const { error: insErr } = await admin.from("service_order_rules").insert(rows)
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath("/admin/servicios")
  return { ok: true }
}

// ─── Disponibilidad por profesional ───────────────────────────────────────────

export type StaffBlockedSlotInput = {
  day_of_week: number
  slot: string
}

// Reemplaza las horas bloqueadas del profesional (delete-all + insert).
// Sin filas = disponible en todos los horarios del negocio.
export async function updateStaffBlockedSlots(
  staffId: string,
  blockedRows: StaffBlockedSlotInput[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { error: delErr } = await admin
    .from("staff_blocked_slots")
    .delete()
    .eq("staff_id", staffId)
  if (delErr) return { ok: false, error: delErr.message }

  if (blockedRows.length > 0) {
    const { error: insErr } = await admin
      .from("staff_blocked_slots")
      .insert(blockedRows.map((r) => ({ staff_id: staffId, ...r })))
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath("/admin/staff")
  revalidatePath("/admin")
  return { ok: true }
}

// ─── Color de calendario ──────────────────────────────────────────────────────

export async function updateStaffCalendarColor(
  staffId: string,
  colorId: string | null
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()
  const { error } = await admin
    .from("staff")
    .update({ calendar_color_id: colorId })
    .eq("id", staffId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/staff/${staffId}`)
  return { ok: true }
}

// ─── Comisiones por servicio ──────────────────────────────────────────────────

export type CommissionInput = {
  service_id: string
  commission_type: "percentage" | "fixed"
  commission_value: number
}

export async function updateStaffCommissions(
  staffId: string,
  rows: CommissionInput[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { error: delErr } = await admin
    .from("staff_service_commissions")
    .delete()
    .eq("staff_id", staffId)
  if (delErr) return { ok: false, error: delErr.message }

  if (rows.length > 0) {
    const { error: insErr } = await admin
      .from("staff_service_commissions")
      .insert(rows.map((r) => ({ staff_id: staffId, ...r })))
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath(`/admin/staff/${staffId}`)
  return { ok: true }
}

// ─── Búsqueda de clientas ─────────────────────────────────────────────────────

export type ClientSearchResult = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
}

export async function searchClients(q: string): Promise<ClientSearchResult[]> {
  await requireStaff()
  if (!q.trim()) return []
  const admin = adminClient()
  const term = `%${q.trim()}%`
  const { data } = await admin
    .from("clients")
    .select("id, first_name, last_name, email, phone")
    .or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`)
    .order("last_name")
    .limit(10)
  return (data ?? []) as ClientSearchResult[]
}

// ─── Crear turno desde admin ──────────────────────────────────────────────────

export type AdminBookingInput = {
  clientId?: string
  newClient?: { firstName: string; lastName: string; phone: string; email?: string }
  serviceIds: string[]
  serviceOrder: string[]
  resolvedStaff: Record<string, string>
  startsAt: string
  notes?: string
  zoneSelections?: Record<string, string[]>
}

export async function createAdminBooking(
  input: AdminBookingInput
): Promise<{ ok: boolean; error?: string; appointmentId?: string }> {
  const creator = await requireStaff()
  const admin = adminClient()

  // 1) Resolve services
  const { data: services, error: svcErr } = await admin
    .from("services")
    .select("id, name, duration_min, price_cents, pricing_mode, zone_selection")
    .in("id", input.serviceIds)
  if (svcErr || !services?.length) return { ok: false, error: "Servicios no encontrados." }

  const perZoneIds = services.filter((s) => s.pricing_mode === "per_zone").map((s) => s.id)
  const zonesByService: Record<string, Zone[]> = {}
  if (perZoneIds.length) {
    const { data: zoneRows } = await admin
      .from("service_zones")
      .select("id, service_id, name, duration_min, price_cents")
      .in("service_id", perZoneIds)
      .eq("active", true)
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null })
    }
  }

  const computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }> = {}
  for (const s of services) {
    if (s.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(input.zoneSelections?.[s.id] ?? [], zonesByService[s.id] ?? [])
      if (!selected) return { ok: false, error: "Elegí al menos una opción válida para el servicio." }
      if (s.zone_selection === "single" && selected.length !== 1)
        return { ok: false, error: `El servicio "${s.name}" admite un solo producto.` }
      const p = computeZonePricing(selected, s.price_cents)
      computed[s.id] = { durationMin: p.durationMin, priceCents: p.priceCents, zones: p.zones }
    } else {
      computed[s.id] = { durationMin: s.duration_min, priceCents: s.price_cents, zones: null }
    }
  }

  const totalDuration = services.reduce((a, s) => a + computed[s.id].durationMin, 0)
  const totalCents = services.reduce((a, s) => a + computed[s.id].priceCents, 0)
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000)

  // 2) Find or create client
  let clientId: string
  if (input.clientId) {
    clientId = input.clientId
  } else if (input.newClient) {
    const nc = input.newClient
    const email = nc.email?.trim().toLowerCase() || null

    // Check if client already exists by email
    let existing = null
    if (email) {
      const { data } = await admin.from("clients").select("id").eq("email", email).maybeSingle()
      existing = data
    }

    if (existing) {
      clientId = existing.id
    } else {
      const { data: created, error: insErr } = await admin
        .from("clients")
        .insert({
          first_name: nc.firstName.trim(),
          last_name: nc.lastName.trim(),
          email: email ?? `admin_created_${Date.now()}@noemail.local`,
          phone: nc.phone.trim(),
          source: "admin",
        })
        .select("id")
        .single()
      if (insErr || !created) return { ok: false, error: `No se pudo crear la clienta: ${insErr?.message}` }
      clientId = created.id
    }
  } else {
    return { ok: false, error: "Falta clienta." }
  }

  // 3) Room
  const { data: room } = await admin
    .from("rooms")
    .select("id")
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  // 4) Main staff (first service in order)
  const mainStaffId = input.serviceOrder[0]
    ? (input.resolvedStaff[input.serviceOrder[0]] ?? null)
    : Object.values(input.resolvedStaff)[0] ?? null

  // 5) Create appointment
  const { data: appt, error: apptErr } = await admin
    .from("appointments")
    .insert({
      client_id: clientId,
      staff_id: mainStaffId,
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: totalDuration,
      total_cents: totalCents,
      deposit_cents: Math.round(totalCents * 0.3),
      deposit_paid: true,
      status: "confirmed",
      source: "admin",
      notes_internal: input.notes?.trim() || null,
    })
    .select("id")
    .single()
  if (apptErr || !appt) return { ok: false, error: `Turno: ${apptErr?.message}` }

  // 6) Link services sequentially
  const orderedServices = input.serviceOrder
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  let ms = startsAt.getTime()
  const apptServices = orderedServices.map((s) => {
    const c = computed[s.id]
    const sStartsAt = new Date(ms)
    ms += c.durationMin * 60_000
    return {
      appointment_id: appt.id,
      service_id: s.id,
      duration_min: c.durationMin,
      price_cents: c.priceCents,
      zones: c.zones,
      staff_id: input.resolvedStaff[s.id] ?? mainStaffId,
      starts_at: sStartsAt.toISOString(),
    }
  })

  const { error: linkErr } = await admin.from("appointment_services").insert(apptServices)
  if (linkErr) return { ok: false, error: `Servicios del turno: ${linkErr.message}` }

  // Google Calendar event (no bloqueante)
  try {
    const { data: clientRow } = await admin
      .from("clients")
      .select("first_name, last_name")
      .eq("id", clientId)
      .maybeSingle()
    const { data: staffRow } = mainStaffId
      ? await admin.from("staff").select("full_name, email, calendar_color_id").eq("id", mainStaffId).maybeSingle()
      : { data: null }
    const eventId = await createCalendarEvent({
      appointmentId: appt.id,
      clientName: `${clientRow?.first_name ?? ""} ${clientRow?.last_name ?? ""}`.trim(),
      serviceNames: services.map((s) => s.name),
      staffName: staffRow?.full_name ?? null,
      staffEmail: staffRow?.email ?? null,
      staffColorId: (staffRow as any)?.calendar_color_id ?? null,
      startsAt,
      endsAt,
      notes: input.notes || null,
    })
    if (eventId) {
      await admin
        .from("appointments")
        .update({ google_event_id: eventId })
        .eq("id", appt.id)
    }
  } catch {
    // Non-fatal
  }

  // Aviso a Leri + profesional(es) asignado(s) — no a quien la cargó (best-effort).
  const { data: notifClient } = await admin
    .from("clients")
    .select("first_name, last_name, phone")
    .eq("id", clientId)
    .maybeSingle()
  await notifyNewBooking(admin, {
    clientName: `${notifClient?.first_name ?? ""} ${notifClient?.last_name ?? ""}`.trim() || "Clienta",
    clientPhone: notifClient?.phone ?? null,
    servicesNames: services.map((s) => s.name),
    startsAt,
    durationMin: totalDuration,
    totalCents,
    assignedStaffIds: [mainStaffId, ...Object.values(input.resolvedStaff ?? {})],
    excludeEmail: creator.email,
  })

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
  return { ok: true, appointmentId: appt.id }
}

// ─── Eliminar miembro del personal ───────────────────────────────────────────

export async function deleteStaff(
  staffId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  // Verificar si tiene turnos futuros asignados
  const { count } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staffId)
    .gte("starts_at", new Date().toISOString())
    .in("status", ["pending", "confirmed"])

  if (count && count > 0) {
    return {
      ok: false,
      error: `Tiene ${count} turno${count === 1 ? "" : "s"} futuro${count === 1 ? "" : "s"} asignado${count === 1 ? "" : "s"}. Reasigná o cancelá los turnos antes de eliminar.`,
    }
  }

  const { error } = await admin.from("staff").delete().eq("id", staffId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/staff")
  return { ok: true }
}

// ─── Reset de fábrica ─────────────────────────────────────────────────────────

export async function factoryReset(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSsrClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sin sesión." }

  const admin = adminClient()

  // Solo el admin principal puede hacer esto
  const { data: staffRow } = await admin
    .from("staff")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle()
  if (staffRow?.role !== "admin") return { ok: false, error: "Solo el admin puede hacer esto." }

  // 1. Borrar appointment_services primero (FK a appointments)
  await admin.from("appointment_services").delete().gte("created_at", "2000-01-01")

  // 2. Borrar turnos
  await admin.from("appointments").delete().gte("created_at", "2000-01-01")

  // 3. Borrar fichas médicas
  await admin.from("client_records").delete().gte("created_at", "2000-01-01")

  // 4. Borrar clientas
  await admin.from("clients").delete().gte("created_at", "2000-01-01")

  // 5. Borrar lista de espera
  await admin.from("waitlist_entries").delete().gte("created_at", "2000-01-01")

  // 6. Borrar staff excepto Leri Vendler
  await admin.from("staff").delete().neq("email", "bylerivendler@gmail.com")

  // 7. Asegurar que Leri queda como admin + profesional activa
  await admin
    .from("staff")
    .update({ role: "admin", is_professional: true, active: true })
    .ilike("email", "bylerivendler@gmail.com")

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
  revalidatePath("/admin/clientas")
  return { ok: true }
}

// ─── Combos ───────────────────────────────────────────────────────────────────

export type ComboInput = {
  name: string
  description?: string
  totalPriceCents: number
  serviceIds: string[]  // en orden
}

export async function createCombo(input: ComboInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireAdmin_action()
  const admin = adminClient()

  const { data: combo, error: comboErr } = await admin
    .from("combos")
    .insert({ name: input.name.trim(), description: input.description?.trim() || null, total_price_cents: input.totalPriceCents, active: false })
    .select("id")
    .single()
  if (comboErr || !combo) return { ok: false, error: comboErr?.message }

  if (input.serviceIds.length > 0) {
    const { error: linkErr } = await admin.from("combo_services").insert(
      input.serviceIds.map((sid, i) => ({ combo_id: combo.id, service_id: sid, order_index: i }))
    )
    if (linkErr) return { ok: false, error: linkErr.message }
  }

  revalidatePath("/admin/combos")
  return { ok: true, id: combo.id }
}

export async function updateCombo(id: string, input: ComboInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin_action()
  const admin = adminClient()

  const { error: updateErr } = await admin
    .from("combos")
    .update({ name: input.name.trim(), description: input.description?.trim() || null, total_price_cents: input.totalPriceCents })
    .eq("id", id)
  if (updateErr) return { ok: false, error: updateErr.message }

  // Replace services
  await admin.from("combo_services").delete().eq("combo_id", id)
  if (input.serviceIds.length > 0) {
    const { error: linkErr } = await admin.from("combo_services").insert(
      input.serviceIds.map((sid, i) => ({ combo_id: id, service_id: sid, order_index: i }))
    )
    if (linkErr) return { ok: false, error: linkErr.message }
  }

  revalidatePath("/admin/combos")
  revalidatePath(`/admin/combos/${id}`)
  return { ok: true }
}

export async function toggleComboActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin_action()
  const admin = adminClient()
  const { error } = await admin.from("combos").update({ active }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/combos")
  return { ok: true }
}

export async function deleteCombo(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin_action()
  const admin = adminClient()
  const { error } = await admin.from("combos").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/combos")
  return { ok: true }
}

async function requireAdmin_action() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) throw new Error("Sin sesión")
  await requireAdmin(user.id)
}

// ─── Sesiones de un pack ──────────────────────────────────────────────────────

/**
 * Agenda UNA sesión pendiente de un pack ya comprado. El turno va en 0 (el pack
 * ya está pagado). El intervalo del pack se respeta salvo que se pida saltearlo.
 */
export async function schedulePackSession(
  packPurchaseId: string,
  startsAtIso: string,
  opts?: { allowIntervalOverride?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { data: pp } = await admin
    .from("pack_purchases")
    .select("id, client_id, pack_id, service_id, sessions_total")
    .eq("id", packPurchaseId)
    .maybeSingle()
  if (!pp) return { ok: false, error: "No encontramos ese pack." }

  const { data: pack } = await admin
    .from("packs")
    .select("interval_days, total_price_cents, service:services(duration_min, pricing_mode)")
    .eq("id", pp.pack_id)
    .maybeSingle()
  const intervalDays = (pack?.interval_days as number | null) ?? null
  const totalPriceCents = pack?.total_price_cents ?? 0
  const svc = pack?.service as unknown as { duration_min: number; pricing_mode: "fixed" | "per_zone" } | null
  const svcDuration = svc?.duration_min ?? 0
  const pricingMode = svc?.pricing_mode ?? "fixed"

  // Turnos de este pack en CUALQUIER estado (incluidos cancelados), con su
  // instantánea de zonas y su precio. De acá salen tres cosas:
  //  - la duración real de una sesión (Finding 1): una sesión cancelada
  //    igual registró bien cuánto dura, así que sirve como referencia;
  //  - si el pack YA tiene su precio puesto en algún turno (Finding 2):
  //    cancelar un turno no le borra el total_cents, así que el precio
  //    sigue "ocupado" ahí y no se vuelve a poner en otro;
  //  - la instantánea de zonas a repetir en la nueva sesión (Finding 4).
  const { data: allExisting } = await admin
    .from("appointments")
    .select("id, starts_at, duration_min, status, total_cents, appointment_services(zones)")
    .eq("pack_purchase_id", packPurchaseId)
    .order("starts_at", { ascending: true })
  type ExistingRow = {
    id: string
    starts_at: string
    duration_min: number
    status: string
    total_cents: number
    appointment_services: { zones: ZoneSnapshot[] | null }[]
  }
  const allRows = (allExisting ?? []) as unknown as ExistingRow[]
  const rows = allRows.filter((r) => r.status !== "cancelled")

  if (rows.length >= pp.sessions_total)
    return { ok: false, error: "Este pack ya tiene todas sus sesiones agendadas." }

  const startsAt = new Date(startsAtIso)
  if (isNaN(startsAt.getTime())) return { ok: false, error: "Fecha inválida." }
  if (startsAt.getTime() <= Date.now())
    return { ok: false, error: "La sesión tiene que ser en una fecha futura." }

  // Duración: la de CUALQUIER sesión ya creada de este pack (ver arriba). Si
  // no hay ninguna, sólo podemos confiar en la duración del servicio cuando
  // es 'fixed' — un servicio 'per_zone' no tiene duración propia (depende de
  // las zonas elegidas, y una venta en persona nunca las registra). Nunca
  // hay que adivinar: hay que pedir que la primera sesión se cree desde
  // "Nueva reserva", donde sí se eligen las zonas.
  const reference = allRows[0]
  let durationMin: number
  if (reference) {
    durationMin = reference.duration_min
  } else if (pricingMode === "fixed") {
    durationMin = svcDuration
  } else {
    return {
      ok: false,
      error:
        "Este pack no se puede agendar desde acá todavía: es un servicio por zona y sus zonas nunca quedaron registradas (se vendió sin crear ninguna sesión). Comunicate con soporte, o agendalo como un turno común.",
    }
  }
  if (durationMin <= 0) return { ok: false, error: "No pudimos calcular la duración de la sesión." }

  // Que esta sesión NO se superponga con ninguna otra sesión VIVA (no
  // cancelada/no_show) de este MISMO pack. Independiente del chequeo de
  // intervalo de abajo: aplica AUNQUE se tilde "Saltear el mínimo", que sólo
  // excusa la regla de los N días entre sesiones, no el doble turno.
  const aliveRows = allRows.filter((r) => isAliveStatus(r.status))
  const newStartMs = startsAt.getTime()
  const newEndMs = newStartMs + durationMin * 60_000
  const conflict = aliveRows.find((r) => {
    const rStart = new Date(r.starts_at).getTime()
    const rEnd = rStart + r.duration_min * 60_000
    return newStartMs < rEnd && newEndMs > rStart
  })
  if (conflict) {
    const when = new Date(conflict.starts_at).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    return {
      ok: false,
      error: `Ese horario se superpone con otra sesión de este mismo pack (${when}hs). Elegí otro horario.`,
    }
  }

  // Intervalo contra la sesión inmediatamente anterior (salvo override).
  if (!opts?.allowIntervalOverride && intervalDays && rows.length) {
    const previous = rows
      .map((r) => new Date(r.starts_at))
      .filter((d) => d.getTime() < startsAt.getTime())
      .sort((a, b) => b.getTime() - a.getTime())[0]
    if (previous && startsAt.getTime() < minStartForNextSession(previous, intervalDays).getTime())
      return { ok: false, error: `Entre sesiones tienen que pasar al menos ${intervalDays} días.` }
  }

  // Horario del negocio (mismo criterio que la compra online): la fecha
  // elegida tiene que caer en un slot que el salón realmente atiende.
  const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(startsAt)
  const { data: bh } = await admin
    .from("business_hours")
    .select("is_open, slots")
    .eq("day_of_week", dayOfWeek)
    .maybeSingle()
  if (!bh?.is_open || !bh.slots.includes(timeStr))
    return { ok: false, error: "Ese horario está fuera del horario de atención." }

  // Disponibilidad real (turnos ya existentes).
  const free = await fetchDayAvailability(dateStr, durationMin, "auto", [timeStr])
  if (!free.includes(timeStr)) return { ok: false, error: "Ese horario no está disponible." }

  // El precio del pack aparece UNA sola vez entre todos sus turnos VIVOS: si
  // ninguno de los turnos VIVOS lo tiene todavía (venta en persona sin turno
  // "portador" aún, o el portador se canceló y nadie lo reemplazó todavía),
  // esta sesión lo lleva; si ya está en otro turno vivo (venta online), va
  // en 0 como siempre. Ojo: un turno CANCELADO puede seguir teniendo
  // total_cents > 0 (no se le borra al cancelar) — por eso filtramos SÓLO
  // los vivos acá, si no la plata quedaría "atrapada" en un turno que
  // estadísticas ya no cuenta. NUNCA se usa packSessionPrices() acá: esa
  // función reparte el precio de un LOTE nuevo (índice 0 = portador) y
  // llamarla para agendar sesiones sueltas pondría el precio completo de
  // nuevo, duplicándolo.
  const priceAlreadyCarried = aliveRows.some((r) => r.total_cents > 0)
  const sessionTotalCents = priceAlreadyCarried ? 0 : totalPriceCents
  const zonesSnapshot = reference?.appointment_services?.[0]?.zones ?? null

  const { data: room } = await admin.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)

  const { data: appt, error: apptErr } = await admin
    .from("appointments")
    .insert({
      client_id: pp.client_id,
      staff_id: null,
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: durationMin,
      total_cents: sessionTotalCents,
      deposit_cents: 0,
      deposit_paid: true,     // el pack ya está pagado (online o en persona)
      status: "pending",
      source: "admin",
      pack_purchase_id: packPurchaseId,
      notes_internal: `Pack: sesión ${rows.length + 1} de ${pp.sessions_total}`,
    })
    .select("id")
    .single()
  if (apptErr || !appt) return { ok: false, error: `No pudimos crear la sesión: ${apptErr?.message}` }

  const { error: linkErr } = await admin.from("appointment_services").insert({
    appointment_id: appt.id,
    service_id: pp.service_id,
    duration_min: durationMin,
    price_cents: sessionTotalCents,
    zones: zonesSnapshot,
    staff_id: null,
    starts_at: startsAt.toISOString(),
  })
  if (linkErr) {
    await admin.from("appointments").delete().eq("id", appt.id)
    return { ok: false, error: `Servicio de la sesión: ${linkErr.message}` }
  }

  // Blanquea cualquier turno MUERTO que todavía cargara el precio (ver
  // `syncPackPriceCarrier`): con la sesión recién creada ya viva, no hace
  // falta promover a nadie más, pero sí conviene limpiar restos.
  await syncPackPriceCarrier(admin, packPurchaseId)

  revalidatePath(`/admin/clientas/${pp.client_id}`)
  revalidatePath("/admin/turnos")
  return { ok: true }
}

/**
 * Confirma de una vez TODAS las sesiones pendientes de un pack (se usa después
 * de verificar que la seña está pagada). No toca canceladas ni completadas.
 */
export async function confirmPackSessions(
  packPurchaseId: string
): Promise<{ ok: boolean; error?: string; confirmed?: number }> {
  await requireStaff()
  const admin = adminClient()

  const { data: pending } = await admin
    .from("appointments")
    .select("id, client_id")
    .eq("pack_purchase_id", packPurchaseId)
    .eq("status", "pending")
  const rows = (pending ?? []) as { id: string; client_id: string }[]
  if (!rows.length) return { ok: true, confirmed: 0 }

  const { error } = await admin
    .from("appointments")
    .update({ status: "confirmed" })
    .in("id", rows.map((r) => r.id))
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/admin/clientas/${rows[0].client_id}`)
  revalidatePath("/admin/turnos")
  revalidatePath("/admin")
  return { ok: true, confirmed: rows.length }
}
