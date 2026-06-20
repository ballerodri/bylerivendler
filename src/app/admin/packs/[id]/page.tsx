import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import PackForm, { type ServiceOption } from "../pack-form"

export const dynamic = "force-dynamic"

type DbService = {
  id: string
  name: string
  price_cents: number
  category: { name: string } | null
}

export default async function EditarPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: pack }, { data: svcData }] = await Promise.all([
    admin
      .from("packs")
      .select("id, service_id, name, description, sessions, interval_days, total_price_cents")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("services")
      .select("id, name, price_cents, category:service_categories(name)")
      .eq("active", true)
      .order("name", { ascending: true }),
  ])

  if (!pack) return <p className="adm-lede">Pack no encontrado.</p>

  const services = ((svcData ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))

  return (
    <>
      <p className="adm-eyebrow">Packs</p>
      <h1 className="adm-h1">Editar <em>pack</em></h1>
      <PackForm
        services={services}
        initial={{
          id: pack.id,
          serviceId: pack.service_id,
          name: pack.name,
          description: pack.description ?? "",
          sessions: pack.sessions,
          intervalDays: pack.interval_days,
          totalPriceCents: pack.total_price_cents,
        }}
      />
    </>
  )
}
