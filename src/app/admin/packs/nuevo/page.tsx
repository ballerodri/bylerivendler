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

async function fetchServices(): Promise<ServiceOption[]> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data } = await admin
    .from("services")
    .select("id, name, price_cents, category:service_categories(name)")
    .eq("active", true)
    .order("name", { ascending: true })
  return ((data ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))
}

export default async function NuevoPackPage() {
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const services = await fetchServices()

  return (
    <>
      <p className="adm-eyebrow">Packs</p>
      <h1 className="adm-h1">Nuevo <em>pack</em></h1>
      <p className="adm-lede">Elegí el servicio, la cantidad de sesiones, cada cuánto se hacen y el precio.</p>
      <PackForm services={services} />
    </>
  )
}
