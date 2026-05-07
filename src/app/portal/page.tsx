import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import LogoutButton from "./logout-button"
import CancelButton from "./cancel-button"
import "../reserva/reserva.css"

export const dynamic = "force-dynamic"

type ClientRow = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  loyalty_points: number
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
    .select("id, first_name, last_name, email, loyalty_points")
    .eq("user_id", user.id)
    .maybeSingle<ClientRow>()

  let appointments: AppointmentRow[] = []
  type PortalPhoto = { id: string; storage_path: string; type: "before" | "after"; signedUrl: string }
  let photos: PortalPhoto[] = []

  if (client) {
    const [apptRes, photoRes] = await Promise.all([
      admin
        .from("appointments")
        .select("id, starts_at, status, duration_min, total_cents")
        .eq("client_id", client.id)
        .order("starts_at", { ascending: true }),
      admin
        .from("client_photos")
        .select("id, storage_path, type")
        .eq("client_id", client.id)
        .eq("visible_to_client", true)
        .order("created_at", { ascending: true }),
    ])
    appointments = (apptRes.data ?? []) as AppointmentRow[]

    const rawPhotos = (photoRes.data ?? []) as { id: string; storage_path: string; type: "before" | "after" }[]
    photos = await Promise.all(
      rawPhotos.map(async (p) => {
        const { data } = await admin.storage
          .from("client-photos")
          .createSignedUrl(p.storage_path, 7200)
        return { ...p, signedUrl: data?.signedUrl ?? "" }
      })
    )
  }

  const greeting = client?.first_name
    ? `Hola, ${client.first_name}.`
    : "Te esperamos."
  const subtitle = user.email ?? ""

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

        <p className="eyebrow">
          Tu portal · {subtitle}
        </p>
        <h1 className="headline">{greeting}</h1>

        {client && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background: "var(--linen)",
              fontSize: 12,
              letterSpacing: "0.04em",
              color: "var(--ink-soft)",
              marginTop: 4,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                fontFamily: "var(--serif)",
                fontSize: 18,
                fontWeight: 500,
                color: "var(--gold)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {client.loyalty_points}
            </span>
            <span>puntos · Programa Cerca</span>
          </div>
        )}

        {!client && (
          <p className="lede">
            Te dimos de alta con tu cuenta de Google, pero todavía no tenés un
            turno reservado.{" "}
            <a href="/reserva" style={{ color: "var(--gold)" }}>
              Reservá tu primer turno
            </a>{" "}
            y completamos tu ficha.
          </p>
        )}

        {client && appointments.length === 0 && (
          <p className="lede">
            No tenés turnos próximos.{" "}
            <a href="/reserva" style={{ color: "var(--gold)" }}>
              Reservá uno
            </a>
            .
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
              {appointments.map((a) => {
                const startsAt = new Date(a.starts_at)
                const now = new Date()
                const isUpcoming = startsAt.getTime() > now.getTime()
                const cancellable =
                  isUpcoming &&
                  (a.status === "pending" || a.status === "confirmed")
                return (
                <div key={a.id} className="summary__row">
                  <span className="summary__label">
                    {startsAt.toLocaleString("es-AR", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Argentina/Buenos_Aires",
                    })}
                  </span>
                  <div className="summary__value" style={{ fontSize: 13 }}>
                    {labelStatus(a.status)}
                    <small>
                      {a.duration_min} min · ${(a.total_cents / 100).toLocaleString("es-AR")}
                    </small>
                    {cancellable && (
                      <small style={{ marginTop: 6 }}>
                        <CancelButton appointmentId={a.id} />
                      </small>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </>
        )}

        {photos.length > 0 && (
          <>
            <h2
              style={{
                fontFamily: "var(--serif)",
                fontWeight: 500,
                fontSize: 20,
                marginTop: 40,
                marginBottom: 12,
              }}
            >
              Tu evolución
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 10,
                marginBottom: 8,
              }}
            >
              {photos.map((p) => (
                <div
                  key={p.id}
                  style={{ borderRadius: 12, overflow: "hidden", position: "relative" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.signedUrl}
                    alt={p.type === "before" ? "Antes" : "Después"}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 6,
                      left: 6,
                      background: "rgba(43,38,35,0.65)",
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      color: "#f2ede6",
                      textTransform: "uppercase",
                    }}
                  >
                    {p.type === "before" ? "Antes" : "Después"}
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
