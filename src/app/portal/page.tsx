import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import LogoutButton from "./logout-button"
import "../reserva/reserva.css"

export const dynamic = "force-dynamic"

type ClientRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
}

type AppointmentRow = {
  id: string
  starts_at: string
  status: string
  duration_min: number
  total_cents: number
}

export default async function PortalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/portal")

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: client } = await admin
    .from("clients")
    .select("id, first_name, last_name, email")
    .eq("user_id", user.id)
    .maybeSingle<ClientRow>()

  let appointments: AppointmentRow[] = []
  if (client) {
    const { data } = await admin
      .from("appointments")
      .select("id, starts_at, status, duration_min, total_cents")
      .eq("client_id", client.id)
      .order("starts_at", { ascending: true })
    appointments = (data ?? []) as AppointmentRow[]
  }

  const greeting = client?.first_name ? `Hola, ${client.first_name}.` : "Bienvenida."

  return (
    <div className="blv" style={{ minHeight: "100vh", padding: "32px 20px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo-crop.png"
            alt="By Leri Vendler"
            style={{ height: 48, width: "auto" }}
          />
          <LogoutButton />
        </div>

        <p className="eyebrow">Tu portal</p>
        <h1 className="headline">{greeting}</h1>

        {!client && (
          <p className="lede">
            Todavía no tenemos una ficha tuya. <a href="/reserva" style={{ color: "var(--gold)" }}>Reservá tu primer turno</a> para crearla.
          </p>
        )}

        {client && appointments.length === 0 && (
          <p className="lede">
            No tenés turnos próximos. <a href="/reserva" style={{ color: "var(--gold)" }}>Reservá uno</a>.
          </p>
        )}

        {appointments.length > 0 && (
          <>
            <h2
              style={{
                fontFamily: "var(--serif)",
                fontWeight: 500,
                fontSize: 20,
                marginTop: 32,
                marginBottom: 12,
              }}
            >
              Tus turnos
            </h2>
            <div className="summary">
              {appointments.map((a) => (
                <div key={a.id} className="summary__row">
                  <span className="summary__label">
                    {new Date(a.starts_at).toLocaleString("es-AR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <div className="summary__value" style={{ fontSize: 13 }}>
                    {labelStatus(a.status)}
                    <small>
                      {a.duration_min} min · ${(a.total_cents / 100).toLocaleString("es-AR")}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 40 }}>
          <a href="/reserva" className="btn btn--primary">
            Reservar otro turno
          </a>
        </div>
      </div>
    </div>
  )
}

function labelStatus(s: string) {
  const map: Record<string, string> = {
    pending: "Pendiente",
    confirmed: "Confirmado",
    in_progress: "En curso",
    completed: "Completado",
    cancelled: "Cancelado",
    no_show: "No asistió",
  }
  return map[s] ?? s
}
