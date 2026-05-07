import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "../../reserva/data"
import ComboActiveToggle from "./active-toggle"
import ComboDeleteButton from "./delete-button"

export const dynamic = "force-dynamic"

type ComboRow = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  active: boolean
  combo_services: {
    order_index: number
    service: { name: string; duration_min: number; price_cents: number } | null
  }[]
}

export default async function AdminCombosPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("combos")
    .select(`
      id, name, description, total_price_cents, active,
      combo_services(order_index, service:services(name, duration_min, price_cents))
    `)
    .order("name", { ascending: true })

  const combos = (data ?? []) as unknown as ComboRow[]

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Catálogo</p>
        <Link href="/admin/combos/nuevo" className="adm-btn" style={{ fontSize: 12 }}>
          + Nuevo combo
        </Link>
      </div>
      <h1 className="adm-h1">
        Com<em>bos</em>
      </h1>
      <p className="adm-lede">
        Agrupá tratamientos con un precio especial. Solo los combos activos aparecen en la reserva online.
      </p>

      <div className="adm-card">
        {combos.length === 0 ? (
          <div className="adm-empty">No hay combos cargados todavía.</div>
        ) : (
          combos.map((c) => {
            const services = [...c.combo_services]
              .sort((a, b) => a.order_index - b.order_index)
              .map((cs) => cs.service)
              .filter(Boolean)
            const fullPrice = services.reduce((a, s) => a + (s?.price_cents ?? 0), 0)
            const saving = fullPrice - c.total_price_cents

            return (
              <div key={c.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <div>
                  <div className="adm-name">{c.name}</div>
                  <div className="adm-sub">
                    {services.map((s) => s?.name).join(" + ")}
                  </div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>
                    {fmtPrice(c.total_price_cents / 100)}
                  </div>
                  {saving > 0 && (
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", textDecoration: "line-through" }}>
                      {fmtPrice(fullPrice / 100)}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`adm-pill ${c.active ? "adm-pill--active" : "adm-pill--inactive"}`}>
                    {c.active ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="adm-actions" style={{ gap: 8 }}>
                  <Link href={`/admin/combos/${c.id}`} className="adm-btn adm-btn--ghost">
                    Editar →
                  </Link>
                  <ComboActiveToggle comboId={c.id} active={c.active} />
                  <ComboDeleteButton comboId={c.id} name={c.name} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
