import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ServiceColorsEditor from "./colors-editor"

export const dynamic = "force-dynamic"

export type ColorServiceRow = {
  id: string
  name: string
  category: string | null
  calendar_color_id: string | null
}

export default async function ServiceColorsPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // Sólo los activos: colorear uno dado de baja no sirve para nada (no se
  // reserva). El orden es por categoría y nombre, igual que la lista.
  const { data } = await admin
    .from("services")
    .select("id, name, calendar_color_id, category:service_categories(name)")
    .eq("active", true)
    .order("name")

  const services: ColorServiceRow[] = ((data ?? []) as unknown as {
    id: string; name: string; calendar_color_id: string | null; category: { name: string } | null
  }[]).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category?.name ?? null,
    calendar_color_id: s.calendar_color_id,
  }))

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/servicios" style={{ color: "var(--ink-mute)" }}>← Servicios</Link>
      </p>
      <h1 className="adm-h1">Colores del <em>calendario</em></h1>
      <p className="adm-lede">
        El color con el que aparece cada tratamiento en Google Calendar, todos en una pantalla.
      </p>
      <ServiceColorsEditor services={services} />
    </>
  )
}
