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

export default async function NuevoComboPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("services")
    .select("id, name, duration_min, price_cents, category:service_categories(name)")
    .eq("active", true)
    .order("name", { ascending: true })

  const services = ((data ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))

  return (
    <>
      <p className="adm-eyebrow">Combos</p>
      <h1 className="adm-h1">Nuevo <em>combo</em></h1>
      <p className="adm-lede">Seleccioná los tratamientos, definí el orden y el precio especial.</p>
      <ComboForm services={services} />
    </>
  )
}
