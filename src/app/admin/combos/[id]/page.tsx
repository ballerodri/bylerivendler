import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ComboForm from "../combo-form"
import { mapDbServiceToOption, SERVICE_SELECT, type DbService } from "../service-option"

export const dynamic = "force-dynamic"

type DbCombo = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  combo_services: { order_index: number; service_id: string; sessions: number | null; zones: { name: string }[] | null }[]
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
      .select("id, name, description, total_price_cents, combo_services(order_index, service_id, sessions, zones)")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("services")
      .select(SERVICE_SELECT)
      .eq("active", true)
      .order("name", { ascending: true }),
  ])

  if (!comboData) notFound()

  const combo = comboData as unknown as DbCombo
  const initialServices = [...combo.combo_services]
    .sort((a, b) => a.order_index - b.order_index)
    .map((cs) => ({ serviceId: cs.service_id, sessions: cs.sessions ?? 1, zonesSnapshot: cs.zones ?? null }))

  const services = ((servicesData ?? []) as unknown as DbService[]).map(mapDbServiceToOption)

  return (
    <>
      <p className="adm-eyebrow">Programas</p>
      <h1 className="adm-h1">Editar <em>programa</em></h1>
      <ComboForm
        services={services}
        initial={{
          id: combo.id,
          name: combo.name,
          description: combo.description ?? "",
          totalPriceCents: combo.total_price_cents,
          services: initialServices,
        }}
      />
    </>
  )
}
