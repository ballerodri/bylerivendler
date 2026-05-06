import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { fmtPrice } from "../../reserva/data"

export const dynamic = "force-dynamic"

type CategoryRow = {
  id: string
  slug: string
  name: string
  tagline: string | null
  sort_order: number
  services: ServiceRow[]
}

type ServiceRow = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  points_earned: number
  points_cost: number
  active: boolean
  visible_public: boolean
}

export default async function AdminServiciosPage() {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("service_categories")
    .select(
      "id, slug, name, tagline, sort_order, services:services(id, name, duration_min, price_cents, points_earned, points_cost, active, visible_public)"
    )
    .order("sort_order", { ascending: true })

  const categories = (data ?? []) as CategoryRow[]

  return (
    <>
      <p className="adm-eyebrow">Catálogo</p>
      <h1 className="adm-h1">
        Tus <em>servicios</em>
      </h1>
      <p className="adm-lede">
        Editá precios, duración y puntos del Programa Cerca por servicio.
      </p>

      {categories.map((cat) => (
        <div key={cat.id} style={{ marginBottom: 32 }}>
          <h2 className="adm-section-title">
            {cat.name}
            {cat.tagline && (
              <span style={{ fontWeight: 400, color: "var(--ink-mute)", fontSize: 13, marginLeft: 8 }}>
                · {cat.tagline}
              </span>
            )}
          </h2>
          <div className="adm-card">
            {cat.services.map((s) => (
              <Link
                key={s.id}
                href={`/admin/servicios/${s.id}`}
                className="adm-list-row"
                style={{
                  gridTemplateColumns: "1fr 100px 110px 110px 80px 80px",
                }}
              >
                <div>
                  <div className="adm-name">{s.name}</div>
                  <div className="adm-sub">
                    {s.active && s.visible_public
                      ? "Visible para clientas"
                      : !s.active
                        ? "Inactivo"
                        : "Oculto del público"}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                  {s.duration_min} min
                </div>
                <div style={{ fontSize: 13, fontFamily: "var(--serif)", fontWeight: 500 }}>
                  {fmtPrice(s.price_cents / 100)}
                </div>
                <div style={{ fontSize: 12, color: "var(--gold)" }}>
                  +{s.points_earned} pts
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  {s.points_cost} pts
                </div>
                <div className="adm-actions">
                  <span className="adm-btn adm-btn--ghost">Editar →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
