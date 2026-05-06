"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"

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
