import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import LoyaltyEditor, { type LoyaltyService } from "./loyalty-editor"

export const dynamic = "force-dynamic"

type CatRow = {
  id: string
  name: string
  sort_order: number
  services: {
    id: string
    name: string
    active: boolean
    loyalty_enabled: boolean
    points_earned: number
    points_cost: number
  }[]
}

export default async function ProgramaCercaPage() {
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
    .select("id, name, sort_order, services:services(id, name, active, loyalty_enabled, points_earned, points_cost)")
    .order("sort_order", { ascending: true })

  const groups = ((data ?? []) as CatRow[])
    .map((c) => ({
      id: c.id,
      name: c.name,
      services: (c.services ?? [])
        .filter((s) => s.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s): LoyaltyService => ({
          id: s.id,
          name: s.name,
          enabled: s.loyalty_enabled,
          earned: s.points_earned,
          cost: s.points_cost,
        })),
    }))
    .filter((g) => g.services.length > 0)

  return (
    <>
      <p className="adm-eyebrow">Fidelización</p>
      <h1 className="adm-h1">Programa <em>Cerca</em></h1>
      <p className="adm-lede">
        Elegí qué servicios participan del programa de puntos, cuántos puntos suman al
        completarse y cuántos cuestan para canjearse gratis.
      </p>
      <LoyaltyEditor groups={groups} />
    </>
  )
}
