import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ComboForm, { type ServiceOption } from "../combo-form"

export const dynamic = "force-dynamic"

type DbService = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: { name: string } | null
}

type DbCombo = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  combo_services: { order_index: number; service_id: string }[]
}

export default async function EditComboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: comboData }, { data: servicesData }] = await Promise.all([
    admin
      .from("combos")
      .select("id, name, description, total_price_cents, combo_services(order_index, service_id)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("services")
      .select("id, name, duration_min, price_cents, category:service_categories(name)")
      .eq("active", true)
      .order("name", { ascending: true }),
  ])

  if (!comboData) notFound()

  const combo = comboData as unknown as DbCombo
  const serviceIds = [...combo.combo_services]
    .sort((a, b) => a.order_index - b.order_index)
    .map((cs) => cs.service_id)

  const services = ((servicesData ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))

  return (
    <>
      <p className="adm-eyebrow">Combos</p>
      <h1 className="adm-h1">Editar <em>combo</em></h1>
      <ComboForm
        services={services}
        initial={{
          id: combo.id,
          name: combo.name,
          description: combo.description ?? "",
          totalPriceCents: combo.total_price_cents,
          serviceIds,
        }}
      />
    </>
  )
}
