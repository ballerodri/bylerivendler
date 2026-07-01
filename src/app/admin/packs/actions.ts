"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"

export type PackInput = {
  serviceId: string
  name: string
  description?: string
  sessions: number
  intervalDays?: number | null
  totalPriceCents: number
  zonesCount: number | null
  visibleReserva: boolean
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function requireAdminAction() {
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) throw new Error("Sin sesión")
  await requireAdmin(user.id)
}

function row(input: PackInput) {
  return {
    service_id: input.serviceId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sessions: input.sessions,
    interval_days: input.intervalDays ?? null,
    total_price_cents: input.totalPriceCents,
    zones_count: input.zonesCount,
    visible_reserva: input.visibleReserva,
  }
}

export async function createPack(
  input: PackInput
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { data, error } = await admin
    .from("packs")
    .insert({ ...row(input), active: false })
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message }
  revalidatePath("/admin/packs")
  return { ok: true, id: data.id }
}

export async function updatePack(
  id: string,
  input: PackInput
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").update(row(input)).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath(`/admin/packs/${id}`)
  return { ok: true }
}

export async function togglePackActive(
  id: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").update({ active }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath("/packs")
  return { ok: true }
}

export async function deletePack(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath("/packs")
  return { ok: true }
}
