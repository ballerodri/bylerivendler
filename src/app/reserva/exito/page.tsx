import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { DOW_NAMES, MONTH_NAMES, fmtDuration, fmtPrice } from "../data"
import { ADDRESS_LINE, ADDRESS_AREA, MAPS_LINK } from "@/lib/location"
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
    <div
      className="blv"
      style={{
        background: "var(--paper)",
        minHeight: "100vh",
        padding: "32px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        {/* Logo */}
        <Link
          href="/"
          style={{ display: "inline-block", marginBottom: 32 }}
          aria-label="Inicio"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/logo-crop.png"
            alt="By Leri Vendler"
            style={{ height: 64, width: "auto", display: "block" }}
          />
        </Link>

        {/* Seal */}
        <div className="success__seal" style={{ margin: "0 auto 24px" }}>
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

        {/* Eyebrow + Headline */}
        <p className="eyebrow" style={{ color: "var(--gold)" }}>
          Reserva confirmada
        </p>
        <h1
          className="success__headline"
          style={{ marginBottom: 12 }}
        >
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
        <p className="success__note" style={{ marginBottom: 32 }}>
          Te enviamos los detalles por email. Vas a recibir un recordatorio
          24 horas antes de tu turno.
        </p>

        {/* Card with appointment details */}
        <div className="success__card" style={{ textAlign: "left", marginBottom: 24 }}>
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
            <a
              href={MAPS_LINK}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              {ADDRESS_LINE} · {ADDRESS_AREA}
            </a>
          </div>
        </div>

        {/* Perks */}
        <div className="perks" style={{ marginBottom: 32 }}>
          <div className="perk">
            <div className="perk__icon">
              <span className="glyph">01</span>
            </div>
            <div className="perk__text">
              <strong>Programa Cerca</strong>
              Cada turno completado te suma puntos que después podés canjear
              por tratamientos.
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

        {/* Action buttons */}
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
          <Link href="/reserva" className="btn btn--primary">
            Reservar otro
          </Link>
        </div>
      </div>
    </div>
  )
}
