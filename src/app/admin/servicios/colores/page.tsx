import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import CategoryColorsEditor from "./colors-editor"

export const dynamic = "force-dynamic"

export type ColorCategoryRow = {
  id: string
  name: string
  calendar_color_id: string | null
  /** Los tratamientos que van a usar ese color (para ver qué se está pintando). */
  services: string[]
}

export default async function CategoryColorsPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("service_categories")
    .select("id, name, calendar_color_id, services(name, active)")
    .order("name")

  const categories: ColorCategoryRow[] = ((data ?? []) as unknown as {
    id: string; name: string; calendar_color_id: string | null; services: { name: string; active: boolean }[] | null
  }[]).map((c) => ({
    id: c.id,
    name: c.name,
    calendar_color_id: c.calendar_color_id,
    // Sólo los activos: los dados de baja no se reservan, no aportan a la vista.
    services: (c.services ?? []).filter((s) => s.active).map((s) => s.name).sort(),
  }))

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/servicios" style={{ color: "var(--ink-mute)" }}>← Servicios</Link>
      </p>
      <h1 className="adm-h1">Colores del <em>calendario</em></h1>
      <p className="adm-lede">
        Un color por categoría: todos sus tratamientos aparecen con ese color en Google Calendar.
      </p>
      <CategoryColorsEditor categories={categories} />
    </>
  )
}
