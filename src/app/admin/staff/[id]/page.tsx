import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"
import StaffEditor from "./staff-editor"

export const dynamic = "force-dynamic"

export type StaffRow = {
  id: string
  full_name: string
  role: string
  email: string | null
  active: boolean
  is_professional: boolean
  calendar_color_id: string | null
  /** Si recibe por email los avisos de reserva (sólo aplica a admin/recepción). */
  notify_bookings: boolean
}

export type BlockedSlotRow = {
  day_of_week: number
  slot: string
}

export type BusinessHourRow = {
  day_of_week: number
  is_open: boolean
  slots: string[]
}

export type ServiceRow = {
  id: string
  name: string
  category: string | null
}

export type CommissionRow = {
  service_id: string
  commission_type: "percentage" | "fixed"
  commission_value: number
}

export default async function AdminStaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  const viewerProfile = user ? await getStaffProfile(user.id) : null
  const viewerIsAdmin = viewerProfile?.role === "admin" || viewerProfile?.role === "reception"

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: staffMember }, { data: availData }, { data: bhData }, { data: servicesData }, { data: commissionsData }, { data: assignedData }] = await Promise.all([
    admin
      .from("staff")
      .select("id, full_name, role, email, active, is_professional, calendar_color_id, notify_bookings")
      .eq("id", id)
      .maybeSingle<StaffRow>(),
    admin
      .from("staff_blocked_slots")
      .select("day_of_week, slot")
      .eq("staff_id", id),
    admin
      .from("business_hours")
      .select("day_of_week, is_open, slots")
      .order("day_of_week"),
    admin
      .from("services")
      .select("id, name, category:service_categories(name)")
      .eq("active", true)
      .order("name"),
    admin
      .from("staff_service_commissions")
      .select("service_id, commission_type, commission_value")
      .eq("staff_id", id),
    admin
      .from("staff_services")
      .select("service_id")
      .eq("staff_id", id),
  ])

  if (!staffMember) notFound()

  const blockedSlots = (availData ?? []) as BlockedSlotRow[]
  const businessHours = (bhData ?? []) as BusinessHourRow[]
  // Comisiones sólo de los servicios que esta profesional tiene asignados
  // ("Profesionales habilitadas" en cada servicio).
  const assignedIds = new Set(((assignedData ?? []) as { service_id: string }[]).map((r) => r.service_id))
  const services = ((servicesData ?? []) as unknown as { id: string; name: string; category: { name: string } | null }[])
    .filter((s) => assignedIds.has(s.id))
    .map((s): ServiceRow => ({ id: s.id, name: s.name, category: s.category?.name ?? null }))
  const commissions = (commissionsData ?? []) as CommissionRow[]

  return (
    <>
      <p className="adm-eyebrow">
        {viewerIsAdmin ? (
          <Link href="/admin/staff" style={{ color: "var(--ink-mute)" }}>
            ← Personal
          </Link>
        ) : "Mi disponibilidad"}
      </p>
      <h1 className="adm-h1">{staffMember.full_name}</h1>
      <p className="adm-lede">{staffMember.email ?? "Sin email registrado"}</p>

      <StaffEditor
        staff={staffMember}
        blockedSlots={blockedSlots}
        businessHours={businessHours}
        canEditRole={viewerIsAdmin}
        services={services}
        commissions={commissions}
      />
    </>
  )
}
