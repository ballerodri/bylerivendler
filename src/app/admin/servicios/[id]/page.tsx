import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import ServiceEditor from "./service-editor"

export const dynamic = "force-dynamic"

export type ServiceRow = {
  id: string
  category_id: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number
  points_earned: number
  points_cost: number
  active: boolean
  visible_public: boolean
}

type CategoryRow = { id: string; name: string }

export type ProfessionalRow = {
  id: string
  full_name: string
  assigned: boolean
}

export default async function AdminServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: service }, { data: allStaff }, { data: assigned }, { data: category }] =
    await Promise.all([
      admin
        .from("services")
        .select("id, category_id, name, description, duration_min, price_cents, points_earned, points_cost, active, visible_public")
        .eq("id", id)
        .maybeSingle<ServiceRow>(),
      admin
        .from("staff")
        .select("id, full_name")
        .eq("active", true)
        .eq("is_professional", true)
        .order("full_name", { ascending: true }),
      admin
        .from("staff_services")
        .select("staff_id")
        .eq("service_id", id),
      admin
        .from("service_categories")
        .select("id, name")
        .maybeSingle<CategoryRow>(),
    ])

  if (!service) notFound()

  const assignedIds = new Set((assigned ?? []).map((r: { staff_id: string }) => r.staff_id))
  const professionals: ProfessionalRow[] = (allStaff ?? []).map(
    (s: { id: string; full_name: string }) => ({
      id: s.id,
      full_name: s.full_name,
      assigned: assignedIds.has(s.id),
    })
  )

  // Re-fetch category by service's category_id
  const { data: cat } = await admin
    .from("service_categories")
    .select("id, name")
    .eq("id", service.category_id)
    .maybeSingle<CategoryRow>()

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/servicios" style={{ color: "var(--ink-mute)" }}>
          ← Servicios
        </Link>
      </p>
      <h1 className="adm-h1">{service.name}</h1>
      <p className="adm-lede">
        {cat?.name ?? "Servicio"} · Cambios se reflejan inmediatamente en el catálogo público.
      </p>

      <ServiceEditor service={service} professionals={professionals} />
    </>
  )
}
