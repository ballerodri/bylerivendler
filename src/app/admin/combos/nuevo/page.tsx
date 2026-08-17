import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ComboForm from "../combo-form"
import { mapDbServiceToOption, SERVICE_SELECT, type DbService } from "../service-option"

export const dynamic = "force-dynamic"

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
    .select(SERVICE_SELECT)
    .eq("active", true)
    .order("name", { ascending: true })

  const services = ((data ?? []) as unknown as DbService[]).map(mapDbServiceToOption)

  return (
    <>
      <p className="adm-eyebrow">Combos</p>
      <h1 className="adm-h1">Nuevo <em>combo</em></h1>
      <p className="adm-lede">Elegí los tratamientos, cuántas sesiones de cada uno y el precio del combo.</p>
      <ComboForm services={services} />
    </>
  )
}
