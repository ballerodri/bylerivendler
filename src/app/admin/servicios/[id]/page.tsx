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

type CategoryRow = {
  id: string
  name: string
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

  const { data: service } = await admin
    .from("services")
    .select(
      "id, category_id, name, description, duration_min, price_cents, points_earned, points_cost, active, visible_public"
    )
    .eq("id", id)
    .maybeSingle<ServiceRow>()

  if (!service) notFound()

  const { data: category } = await admin
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
        {category?.name ?? "Servicio"} · Cambios se reflejan inmediatamente en el catálogo público.
      </p>

      <ServiceEditor service={service} />
    </>
  )
}
