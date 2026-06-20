import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "../../reserva/data"
import PackActiveToggle from "./active-toggle"
import PackDeleteButton from "./delete-button"

export const dynamic = "force-dynamic"

type PackRow = {
  id: string
  name: string
  sessions: number
  interval_days: number | null
  total_price_cents: number
  active: boolean
  service: { name: string; price_cents: number } | null
}

export default async function AdminPacksPage() {
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

  const { data } = await admin
    .from("packs")
    .select("id, name, sessions, interval_days, total_price_cents, active, service:services(name, price_cents)")
    .order("name", { ascending: true })

  const packs = (data ?? []) as unknown as PackRow[]

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Catálogo</p>
        <Link href="/admin/packs/nuevo" className="adm-btn" style={{ fontSize: 12 }}>+ Nuevo pack</Link>
      </div>
      <h1 className="adm-h1">Pa<em>cks</em></h1>
      <p className="adm-lede">Packs de varias sesiones de un mismo servicio a precio especial. Los activos se muestran en la web.</p>

      <div className="adm-card">
        {packs.length === 0 ? (
          <div className="adm-empty">No hay packs cargados todavía.</div>
        ) : (
          packs.map((p) => {
            const full = (p.service?.price_cents ?? 0) * p.sessions
            const saving = full - p.total_price_cents
            return (
              <div key={p.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <div>
                  <div className="adm-name">{p.name}</div>
                  <div className="adm-sub">
                    {p.service?.name ?? "—"} · {p.sessions} sesiones{p.interval_days ? ` · una cada ${p.interval_days} días` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(p.total_price_cents / 100)}</div>
                  {saving > 0 && (
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", textDecoration: "line-through" }}>{fmtPrice(full / 100)}</div>
                  )}
                </div>
                <div>
                  <span className={`adm-pill ${p.active ? "adm-pill--active" : "adm-pill--inactive"}`}>{p.active ? "Activo" : "Inactivo"}</span>
                </div>
                <div className="adm-actions" style={{ gap: 8 }}>
                  <Link href={`/admin/packs/${p.id}`} className="adm-btn adm-btn--ghost">Editar →</Link>
                  <PackActiveToggle packId={p.id} active={p.active} />
                  <PackDeleteButton packId={p.id} name={p.name} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
