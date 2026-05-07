"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { sendBookingReschedule } from "@/lib/email/booking-emails"

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

export async function updateAppointmentStatus(
  appointmentId: string,
  status: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = StatusSchema.safeParse(status)
  if (!parsed.success) return { ok: false, error: "Estado inválido" }

  const admin = adminClient()

  // Estado anterior, para detectar transición a "completed" y sumar puntos
  // exactamente una vez.
  const { data: prev } = await admin
    .from("appointments")
    .select("status, client_id")
    .eq("id", appointmentId)
    .maybeSingle()

  const { error } = await admin
    .from("appointments")
    .update({ status: parsed.data })
    .eq("id", appointmentId)

  if (error) return { ok: false, error: error.message }

  // Si pasó a `completed` (y antes no lo estaba), sumar puntos del Programa Cerca.
  if (
    parsed.data === "completed" &&
    prev &&
    prev.status !== "completed" &&
    prev.client_id
  ) {
    type EarnedRow = { service: { points_earned: number } | null }
    const { data: rows } = await admin
      .from("appointment_services")
      .select("service:services(points_earned)")
      .eq("appointment_id", appointmentId)
    const earned = ((rows as unknown as EarnedRow[] | null) ?? []).reduce(
      (sum, r) => sum + (r.service?.points_earned ?? 0),
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

  revalidatePath("/admin")
  revalidatePath("/admin/turnos")
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

  const { data: appt } = await admin
    .from("appointments")
    .select(
      `id, status, duration_min, total_cents,
       client:clients(email, first_name),
       appointment_services(id, starts_at, duration_min, service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  type SvcShape = { id: string; starts_at: string | null; duration_min: number; service: { name: string } | null }
  type ApptShape = {
    id: string
    status: string
    duration_min: number
    total_cents: number
    client: { email: string; first_name: string | null } | null
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
      .eq("id", svc.id)
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

const ServicePatch = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().nonnegative(),
  points_earned: z.number().int().nonnegative(),
  points_cost: z.number().int().nonnegative(),
  active: z.boolean(),
  visible_public: z.boolean(),
})

export async function updateService(
  serviceId: string,
  patch: z.infer<typeof ServicePatch>
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = ServicePatch.safeParse(patch)
  if (!parsed.success) return { ok: false, error: "Datos inválidos" }

  const admin = adminClient()
  const { error } = await admin
    .from("services")
    .update(parsed.data)
    .eq("id", serviceId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/servicios")
  revalidatePath(`/admin/servicios/${serviceId}`)
  return { ok: true }
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

const RecordPatch = z.object({
  allergies: z.array(z.string()),
  allergies_other: z.string().nullable(),
  medications_status: z.enum(["no", "si"]),
  medications_note: z.string().nullable(),
  pregnancy: z.enum(["no", "embarazo", "lactancia"]),
  skin_conditions: z.array(z.string()),
  alert_flags: z.array(z.string()),
})

export async function updateClientRecord(
  clientId: string,
  patch: z.infer<typeof RecordPatch>
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = RecordPatch.safeParse(patch)
  if (!parsed.success) return { ok: false, error: "Datos inválidos" }

  const admin = adminClient()

  // Ficha vigente (si existe)
  const { data: current } = await admin
    .from("client_records")
    .select("id, version")
    .eq("client_id", clientId)
    .eq("is_current", true)
    .maybeSingle()

  if (current) {
    // Marcamos la actual como no vigente y creamos una versión nueva — versionado.
    await admin
      .from("client_records")
      .update({ is_current: false })
      .eq("id", current.id)

    const { error } = await admin.from("client_records").insert({
      client_id: clientId,
      version: (current.version ?? 1) + 1,
      is_current: true,
      ...parsed.data,
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await admin.from("client_records").insert({
      client_id: clientId,
      version: 1,
      is_current: true,
      ...parsed.data,
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath(`/admin/clientas/${clientId}`)
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
    duration_min: number
    price_cents: number
    points_earned: number
    points_cost: number
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireStaff()
  if (!data.name.trim()) return { ok: false, error: "El nombre es obligatorio" }
  if (data.duration_min < 1) return { ok: false, error: "La duración debe ser mayor a 0" }

  const admin = adminClient()
  const slug = toSlug(data.name) + "-" + Date.now()
  const { data: created, error } = await admin
    .from("services")
    .insert({
      category_id: categoryId,
      slug,
      name: data.name.trim(),
      description: data.description.trim() || null,
      duration_min: data.duration_min,
      price_cents: data.price_cents,
      points_earned: data.points_earned,
      points_cost: data.points_cost,
      active: true,
      visible_public: true,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }
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

export type StaffAvailabilityInput = {
  day_of_week: number
  from_time: string
  to_time: string
}

export async function updateStaffAvailability(
  staffId: string,
  availRows: StaffAvailabilityInput[]
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { error: delErr } = await admin
    .from("staff_availability")
    .delete()
    .eq("staff_id", staffId)
  if (delErr) return { ok: false, error: delErr.message }

  if (availRows.length > 0) {
    const { error: insErr } = await admin
      .from("staff_availability")
      .insert(availRows.map((r) => ({ staff_id: staffId, ...r })))
    if (insErr) return { ok: false, error: insErr.message }
  }

  revalidatePath("/admin/staff")
  revalidatePath("/admin")
  return { ok: true }
}
