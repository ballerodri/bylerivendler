import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import NuevaReservaForm from "./nueva-reserva-form"

export const dynamic = "force-dynamic"

export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
}

export default async function NuevaReservaPage() {
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
    .order("name")

  const services: ServiceOption[] = ((data ?? []) as unknown as {
    id: string
    name: string
    duration_min: number
    price_cents: number
    category: { name: string } | null
  }[]).map((s) => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: s.category?.name ?? "Sin categoría",
  }))

  return (
    <>
      <p className="adm-eyebrow">Agenda</p>
      <h1 className="adm-h1">Nueva <em>reserva</em></h1>
      <p className="adm-lede">Creá un turno en nombre de una clienta.</p>
      <NuevaReservaForm services={services} />
    </>
  )
}
