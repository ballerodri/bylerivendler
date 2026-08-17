import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "../../reserva/data"
import { comboIndividualCents, comboTotalSessions } from "@/lib/servicios/combo-pricing"
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
    sessions: number | null
    zones: { price_cents: number }[] | null
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
      combo_services(order_index, sessions, zones, service:services(name, duration_min, price_cents))
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
        Combos de varias sesiones de varios tratamientos, a un precio especial. Solo los combos activos aparecen en la reserva online.
      </p>

      <div className="adm-card">
        {combos.length === 0 ? (
          <div className="adm-empty">No hay combos cargados todavía.</div>
        ) : (
          combos.map((c) => {
            const items = [...c.combo_services].sort((a, b) => a.order_index - b.order_index)
            // Precio individual con las CANTIDADES (y el snapshot de zona si lo
            // tiene): Σ precio_de_una_sesión × sesiones. Sin esto un programa de
            // varias sesiones se ve al precio de 1 sesión de cada uno.
            const lines = items.map((cs) => ({
              priceCents: cs.zones?.length
                ? cs.zones.reduce((a, z) => a + z.price_cents, 0)
                : cs.service?.price_cents ?? 0,
              sessions: cs.sessions ?? 1,
            }))
            const fullPrice = comboIndividualCents(lines)
            const totalSessions = comboTotalSessions(lines)
            const saving = fullPrice - c.total_price_cents

            return (
              <div key={c.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <div>
                  <div className="adm-name">{c.name}</div>
                  <div className="adm-sub">
                    {items.map((cs) => `${cs.service?.name ?? "?"} ×${cs.sessions ?? 1}`).join(" + ")}
                    {totalSessions > 0 && <> · {totalSessions} sesiones</>}
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
