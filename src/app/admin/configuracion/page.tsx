import { createClient as createSsrClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/staff"
import ResetForm from "./reset-form"
import GoogleCalendarCard from "./google-calendar-card"

export const dynamic = "force-dynamic"

export default async function ConfiguracionPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: gcal } = await admin
    .from("google_calendar_config")
    .select("refresh_token, google_email, connected_at")
    .eq("id", 1)
    .maybeSingle()

  const connected = !!gcal?.refresh_token

  return (
    <>
      <p className="adm-eyebrow">Admin</p>
      <h1 className="adm-h1">Configura<em>ción</em></h1>

      <GoogleCalendarCard
        connected={connected}
        googleEmail={gcal?.google_email ?? null}
        connectedAt={gcal?.connected_at ?? null}
      />

      <div className="adm-card" style={{ padding: 28, border: "1px solid #d9534f", marginTop: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, color: "#8c463c", marginBottom: 8 }}>
          Zona de peligro
        </h3>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 20, lineHeight: 1.6 }}>
          El <strong>reset de fábrica</strong> elimina permanentemente todos los turnos, clientas y lista de espera.
          El personal queda solo con <strong>Leri Vendler</strong> (admin + profesional).
          Los servicios, horarios y configuración del negocio se conservan.
        </p>

        <div style={{ background: "#fdf3f2", borderRadius: 8, padding: "14px 16px", marginBottom: 20, fontSize: 12, color: "#8c463c" }}>
          <strong>Se elimina:</strong> turnos · clientas · fichas médicas · lista de espera · resto del personal<br />
          <strong>Se conserva:</strong> servicios · horarios · disponibilidad · precios
        </div>

        <ResetForm />
      </div>
    </>
  )
}
