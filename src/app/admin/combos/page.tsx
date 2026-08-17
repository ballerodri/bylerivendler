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
    session_no: number | null
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
      combo_services(order_index, sessions, session_no, zones, service:services(name, duration_min, price_cents))
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
            // Plan nuevo: (sesión, orden del día). Legacy (session_no null): el
            // order_index viejo.
            const items = [...c.combo_services].sort(
              (a, b) => (a.session_no ?? 999) - (b.session_no ?? 999) || a.order_index - b.order_index
            )
            const isPlan = items.some((cs) => cs.session_no !== null)
            // Sesiones a mostrar: el plan tiene K sesiones (visitas); un combo
            // legacy suma las cantidades por tratamiento (modelo viejo).
            const planK = isPlan ? Math.max(0, ...items.map((cs) => cs.session_no ?? 0)) : 0
            // Precio individual: Σ precio × veces. En el plan cada fila vale 1
            // (las veces son las apariciones), en legacy la fila trae la cantidad
            // — la MISMA cuenta sirve para los dos.
            const lines = items.map((cs) => ({
              priceCents: cs.zones?.length
                ? cs.zones.reduce((a, z) => a + z.price_cents, 0)
                : cs.service?.price_cents ?? 0,
              sessions: cs.sessions ?? 1,
            }))
            const fullPrice = comboIndividualCents(lines)
            const totalSessions = isPlan ? planK : comboTotalSessions(lines)
            const saving = fullPrice - c.total_price_cents

            // Detalle por tratamiento con sus veces derivadas (sirve para los
            // dos modelos: en el plan suma apariciones, en legacy la cantidad).
            const detail = new Map<string, number>()
            for (const cs of items) {
              const n = cs.service?.name ?? "?"
              detail.set(n, (detail.get(n) ?? 0) + (cs.sessions ?? 1))
            }
            const detalle = [...detail.entries()].map(([n, v]) => `${n} ×${v}`).join(" + ")

            return (
              <div key={c.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <div>
                  <div className="adm-name">{c.name}</div>
                  <div className="adm-sub">
                    {detalle}
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
