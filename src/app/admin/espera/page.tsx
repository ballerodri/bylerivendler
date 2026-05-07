import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"

export const dynamic = "force-dynamic"

type WaitlistRow = {
  id: string
  created_at: string
  name: string
  email: string
  phone: string
  service_names: string[]
  preferred_dates: string | null
  notified_at: string | null
}

const TZ = "America/Argentina/Buenos_Aires"

export default async function ListaEsperaPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("waitlist_entries")
    .select("id, created_at, name, email, phone, service_names, preferred_dates, notified_at")
    .order("created_at", { ascending: false })
    .limit(200)

  const entries = (data ?? []) as WaitlistRow[]
  const pending = entries.filter((e) => !e.notified_at)
  const notified = entries.filter((e) => e.notified_at)

  return (
    <>
      <p className="adm-eyebrow">Disponibilidad</p>
      <h1 className="adm-h1">
        Lista de <em>espera</em>
      </h1>
      <p className="adm-lede">
        Clientas que se anotaron cuando no había turnos disponibles.
      </p>

      {pending.length === 0 && notified.length === 0 && (
        <div className="adm-card">
          <div className="adm-empty">La lista de espera está vacía.</div>
        </div>
      )}

      {pending.length > 0 && (
        <>
          <p className="adm-eyebrow" style={{ marginBottom: 8 }}>Sin avisar ({pending.length})</p>
          <div className="adm-card" style={{ marginBottom: 24 }}>
            {pending.map((e) => (
              <WaitlistRow key={e.id} entry={e} />
            ))}
          </div>
        </>
      )}

      {notified.length > 0 && (
        <>
          <p className="adm-eyebrow" style={{ marginBottom: 8, color: "var(--ink-mute)" }}>
            Ya avisadas ({notified.length})
          </p>
          <div className="adm-card">
            {notified.map((e) => (
              <WaitlistRow key={e.id} entry={e} dimmed />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function WaitlistRow({ entry: e, dimmed }: { entry: WaitlistRow; dimmed?: boolean }) {
  const createdDate = new Date(e.created_at).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    timeZone: TZ,
  })
  return (
    <div
      className="adm-list-row"
      style={{
        opacity: dimmed ? 0.55 : 1,
        display: "flex",
        gap: 16,
        padding: "14px 20px",
        alignItems: "flex-start",
      }}
    >
      <div style={{ minWidth: 48, fontSize: 12, color: "var(--ink-mute)", paddingTop: 2 }}>
        {createdDate}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="adm-name">{e.name}</div>
        <div className="adm-sub">
          <a href={`mailto:${e.email}`} style={{ color: "var(--ink-soft)" }}>{e.email}</a>
          {" · "}
          <a href={`https://wa.me/${e.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink-soft)" }}>
            {e.phone}
          </a>
        </div>
        {e.service_names.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>
            {e.service_names.join(" + ")}
          </div>
        )}
        {e.preferred_dates && (
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2, fontStyle: "italic" }}>
            Prefiere: {e.preferred_dates}
          </div>
        )}
      </div>
      {!dimmed && (
        <a
          href={`https://wa.me/${e.phone.replace(/\D/g, "")}?text=${encodeURIComponent(
            `¡Hola ${e.name}! Tenemos un horario disponible para ${e.service_names.join(" + ")}. ¿Te viene bien coordinar? 🌸`
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="adm-btn"
          style={{ fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Avisar →
        </a>
      )}
    </div>
  )
}
