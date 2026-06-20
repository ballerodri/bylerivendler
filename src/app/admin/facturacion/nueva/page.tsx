import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ManualForm, { type SelectableItem } from "./manual-form"

export const dynamic = "force-dynamic"

export default async function NuevaFacturaPage() {
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

  const [{ data: svc }, { data: pks }] = await Promise.all([
    admin.from("services").select("id, name, price_cents").eq("active", true).order("name", { ascending: true }),
    admin.from("packs").select("id, name, total_price_cents").eq("active", true).order("name", { ascending: true }),
  ])

  const items: SelectableItem[] = [
    ...((svc ?? []) as { id: string; name: string; price_cents: number }[]).map(
      (s): SelectableItem => ({ kind: "service", id: s.id, name: s.name, priceCents: s.price_cents })
    ),
    ...((pks ?? []) as { id: string; name: string; total_price_cents: number }[]).map(
      (p): SelectableItem => ({ kind: "pack", id: p.id, name: p.name, priceCents: p.total_price_cents })
    ),
  ]

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Factura <em>manual</em></h1>
      <p className="adm-lede">Para señas, ventas sueltas o un servicio puntual. Emite una Factura C.</p>
      <ManualForm items={items} />
    </>
  )
}
