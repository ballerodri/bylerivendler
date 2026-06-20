import { createClient } from "@supabase/supabase-js"
import { fmtPrice } from "@/app/reserva/data"
import { whatsappLink } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

type PackRow = {
  id: string
  name: string
  description: string | null
  sessions: number
  interval_days: number | null
  total_price_cents: number
  service: { name: string; price_cents: number } | null
}

export default async function PacksPublicPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await supabase
    .from("packs")
    .select("id, name, description, sessions, interval_days, total_price_cents, service:services(name, price_cents)")
    .eq("active", true)
    .order("name", { ascending: true })

  const packs = (data ?? []) as unknown as PackRow[]

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px", fontFamily: "Georgia, serif", color: "#2b2623" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.22em", textTransform: "uppercase", color: "#7a6e64", margin: "0 0 8px" }}>By Leri Vendler</p>
      <h1 style={{ fontSize: 36, fontWeight: 400, margin: "0 0 8px" }}>Packs de sesiones</h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#4a423d", margin: "0 0 32px" }}>
        Tratamientos de varias sesiones a precio especial. Para reservar tu pack, escribinos por WhatsApp.
      </p>

      {packs.length === 0 ? (
        <p style={{ color: "#7a6e64" }}>Por el momento no hay packs disponibles. ¡Escribinos y te contamos las promos vigentes!</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {packs.map((p) => {
            const full = (p.service?.price_cents ?? 0) * p.sessions
            const saving = full - p.total_price_cents
            const msg = `Hola! Me interesa el pack "${p.name}". ¿Me pasás más info?`
            return (
              <div key={p.id} style={{ background: "#fff", border: "1px solid rgba(43,38,35,0.12)", borderRadius: 14, padding: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 500, margin: "0 0 4px" }}>{p.name}</h2>
                <p style={{ fontSize: 13, color: "#7a6e64", margin: "0 0 10px" }}>
                  {p.service?.name ?? ""} · {p.sessions} sesiones{p.interval_days ? ` · una cada ${p.interval_days} días` : ""}
                </p>
                {p.description && (
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: "#4a423d", margin: "0 0 12px" }}>{p.description}</p>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 24, fontWeight: 500 }}>{fmtPrice(p.total_price_cents / 100)}</span>
                  {saving > 0 && (
                    <>
                      <span style={{ fontSize: 14, color: "#7a6e64", textDecoration: "line-through" }}>{fmtPrice(full / 100)}</span>
                      <span style={{ fontSize: 13, color: "#4d6b3e" }}>{fmtPrice(saving / 100)} de ahorro</span>
                    </>
                  )}
                </div>
                <a href={whatsappLink(msg)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-block", background: "#2b2623", color: "#f2ede6", padding: "12px 24px", borderRadius: 999, textDecoration: "none", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Helvetica, Arial, sans-serif" }}>
                  Consultar por WhatsApp
                </a>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
