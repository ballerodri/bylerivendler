import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { DOW_NAMES, MONTH_NAMES, fmtDuration, fmtPrice } from "../data"
import "../reserva.css"

export const dynamic = "force-dynamic"

type ApptRow = {
  id: string
  starts_at: string
  duration_min: number
  total_cents: number
  client: { first_name: string | null } | null
  appointment_services: { service: { name: string } | null }[]
}

export default async function ReservaExitoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  if (!id) notFound()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("appointments")
    .select(
      "id, starts_at, duration_min, total_cents, client:clients(first_name), appointment_services(service:services(name))"
    )
    .eq("id", id)
    .maybeSingle()

  const appt = data as unknown as ApptRow | null
  if (!appt) notFound()

  const date = new Date(appt.starts_at)
  const dow = DOW_NAMES[(date.getDay() + 6) % 7]
  const services = appt.appointment_services
    .map((as) => as.service?.name)
    .filter((n): n is string => Boolean(n))
  const firstName = appt.client?.first_name ?? ""

  return (
    <div className="blv">
      <div className="screen">
        <div className="topbar">
          <div style={{ width: 40 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="topbar__logo"
            src="/assets/logo-crop.png"
            alt="By Leri Vendler"
          />
          <Link
            href="/"
            className="topbar__close"
            aria-label="Cerrar"
            style={{ fontSize: 14, color: "var(--ink)", textDecoration: "none" }}
          >
            ×
          </Link>
        </div>

        <div className="success">
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              width: "100%",
            }}
          >
            <div className="success__seal">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <path
                  d="M8 17.5L14.5 24L26 12"
                  stroke="#F2EDE6"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="eyebrow" style={{ color: "var(--gold)" }}>
              Reserva confirmada
            </p>
            <h1 className="success__headline">
              {firstName ? (
                <>
                  Te <em>esperamos</em>, {firstName}.
                </>
              ) : (
                <>
                  Te <em>esperamos</em>.
                </>
              )}
            </h1>
            <p className="success__note">
              Te enviamos los detalles por email. Vas a recibir un recordatorio
              24 horas antes de tu turno.
            </p>

            <div className="success__card">
              {services.map((name) => (
                <div key={name} style={{ marginBottom: 8 }}>
                  <div className="success__svc">{name}</div>
                </div>
              ))}
              <div
                className="success__when"
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <strong>
                  {dow} {date.getDate()} de{" "}
                  {MONTH_NAMES[date.getMonth()].toLowerCase()}
                </strong>{" "}
                ·{" "}
                {date.toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                hs · {fmtDuration(appt.duration_min)} ·{" "}
                {fmtPrice(appt.total_cents / 100)}
                <br />
                <span style={{ color: "var(--ink-mute)" }}>
                  Sanguinetti 297 · Pilar, Buenos Aires
                </span>
              </div>
            </div>

            <div className="perks">
              <div className="perk">
                <div className="perk__icon">
                  <span className="glyph">01</span>
                </div>
                <div className="perk__text">
                  <strong>Programa Cerca</strong>
                  Acumula puntos en cada visita. El 6° tratamiento del año es
                  una cortesía de la casa.
                </div>
              </div>
              <div className="perk">
                <div className="perk__icon">
                  <span className="glyph">02</span>
                </div>
                <div className="perk__text">
                  <strong>Ritual de cumpleaños</strong>
                  Durante tu mes recibís un tratamiento de obsequio al reservar
                  cualquier otro.
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <Link href="/portal" className="btn btn--primary">
              Ver mis turnos
            </Link>
            <Link href="/reserva" className="linkbtn">
              Reservar otro
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
