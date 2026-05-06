import { createClient as createAdminClient } from "@supabase/supabase-js"
import NewServiceForm from "./new-service-form"

export const dynamic = "force-dynamic"

export default async function NuevoServicioPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>
}) {
  const { cat } = await searchParams

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("service_categories")
    .select("id, name")
    .eq("active", true)
    .order("sort_order", { ascending: true })

  const categories = (data ?? []) as { id: string; name: string }[]

  return (
    <>
      <p className="adm-eyebrow">Catálogo</p>
      <h1 className="adm-h1">
        Nuevo <em>servicio</em>
      </h1>
      <NewServiceForm categories={categories} defaultCategoryId={cat ?? ""} />
    </>
  )
}
