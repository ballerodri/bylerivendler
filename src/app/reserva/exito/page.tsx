import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { DOW_NAMES, MONTH_NAMES, fmtDuration, fmtPrice } from "../data"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { ADDRESS_LINE, ADDRESS_AREA, MAPS_LINK } from "@/lib/location"
import "../reserva.css"

export const dynamic = "force-dynamic"

type ApptRow = {
  id: string
  starts_at: string
  duration_min: number
  total_cents: number
  deposit_cents: number
  status: string
  pack_purchase_id: string | null
  client: { first_name: string | null } | null
  appointment_services: {
    starts_at: string | null
    duration_min: number | null
    service: { name: string } | null
  }[]
}

export default async function ReservaExitoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  if (!id) notFound()
  // El modo "separados" crea varios turnos: llegan como "id1,id2,id3".
  const ids = id.split(",").map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) notFound()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("appointments")
    .select(
      "id, starts_at, duration_min, total_cents, deposit_cents, status, pack_purchase_id, client:clients(first_name), appointment_services(starts_at, duration_min, service:services(name))"
    )
    .in("id", ids)
    .order("starts_at", { ascending: true })

  const appts = (data ?? []) as unknown as ApptRow[]
  if (appts.length === 0) notFound()

  const appt = appts[0]
  const firstName = appt.client?.first_name ?? ""
  const dueNowCents = appts.reduce((acc, a) => acc + a.deposit_cents, 0)
  // Con turnos pendientes (falta la seña) el mail de confirmación sale recién
  // cuando el salón confirma el último — la nota de abajo no puede prometer
  // "te enviamos los detalles" que todavía no salieron. Con todo confirmado
  // (canje con puntos), el mail ya salió y la nota de siempre es la correcta.
  const allConfirmed = appts.every((a) => a.status === "confirmed")

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
          {allConfirmed ? (
            <>
              Te enviamos los detalles por email. Vas a recibir un recordatorio
              24 horas antes de tu turno.
            </>
          ) : (
            <>
              Cuando confirmemos tu seña te mandamos la confirmación por email.
              Vas a recibir también un recordatorio 24 horas antes de tu turno.
            </>
          )}
        </p>

        {/* Card with appointment details — una por turno. OJO: este componente
            corre en el SERVIDOR (UTC en Vercel), así que la fecha/hora se saca
            SIEMPRE con `arPartsFromUtc` (hora argentina), nunca con getDay()/
            toLocaleTimeString a secas — eso mostraba 10:00 como "01:00 p. m.". */}
        {appts.map((a) => {
          const aParts = arPartsFromUtc(new Date(a.starts_at))
          const [, aMonth, aDay] = aParts.dateStr.split("-").map(Number)
          const aDow = DOW_NAMES[(aParts.dayOfWeek + 6) % 7]
          const priceLabel =
            a.total_cents > 0
              ? fmtPrice(a.total_cents / 100)
              : a.pack_purchase_id
              ? "Incluida en el pack"
              : "Canjeada con puntos"
          const legs = a.appointment_services
            .map((as) => ({
              name: as.service?.name ?? "",
              startsAt: as.starts_at,
              durationMin: as.duration_min,
            }))
            .filter((l) => l.name)
          // Itinerario por servicio: sólo cuando el turno "juntos" tiene 2+
          // servicios y cada pata trae su hora real — con la grilla puede haber
          // huecos (10:20 · 12:00 · 13:00), así que una sola hora engaña.
          const showItinerary =
            legs.length > 1 && legs.every((l) => l.startsAt && l.durationMin)
          if (showItinerary) {
            const sorted = [...legs].sort(
              (x, y) =>
                new Date(x.startsAt!).getTime() - new Date(y.startsAt!).getTime()
            )
            return (
              <div
                key={a.id}
                className="success__card"
                style={{ textAlign: "left", marginBottom: 24 }}
              >
                <div className="success__svc" style={{ marginBottom: 10 }}>
                  {aDow} {aDay} de {MONTH_NAMES[aMonth - 1].toLowerCase()}
                </div>
                {sorted.map((l) => {
                  const lParts = arPartsFromUtc(new Date(l.startsAt!))
                  return (
                    <div
                      key={l.name + l.startsAt}
                      style={{ display: "flex", gap: 12, marginBottom: 6 }}
                    >
                      <span
                        style={{
                          color: "var(--gold)",
                          fontVariantNumeric: "tabular-nums",
                          minWidth: 44,
                        }}
                      >
                        {lParts.timeStr}
                      </span>
                      <span>
                        {l.name}
                        <span style={{ color: "var(--muted, #7a6e64)" }}>
                          {" "}
                          · {fmtDuration(l.durationMin!)}
                        </span>
                      </span>
                    </div>
                  )
                })}
                <div
                  className="success__when"
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  {priceLabel}
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
            )
          }
          return (
            <div
              key={a.id}
              className="success__card"
              style={{ textAlign: "left", marginBottom: 24 }}
            >
              {legs.map((l) => (
                <div key={l.name} style={{ marginBottom: 8 }}>
                  <div className="success__svc">{l.name}</div>
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
                  {aDow} {aDay} de {MONTH_NAMES[aMonth - 1].toLowerCase()}
                </strong>{" "}
                · {aParts.timeStr}hs · {fmtDuration(a.duration_min)} · {priceLabel}
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
          )
        })}

        {/* Con varios turnos, la seña es UNA sola: hay que decirlo. Si no hay
            nada que transferir (canjeó con puntos), no hay comprobante que
            mandar ni turno que "confirmar": ya está confirmado. */}
        {appts.length > 1 && dueNowCents > 0 && (
          <div
            className="success__card"
            style={{ textAlign: "left", marginBottom: 24 }}
          >
            <div className="success__when">
              <strong>A transferir ahora: {fmtPrice(dueNowCents / 100)}</strong>
              <br />
              Es <strong>una sola transferencia</strong> por los {appts.length} turnos.
            </div>
          </div>
        )}
        {appts.length > 1 && dueNowCents <= 0 && (
          <div
            className="success__card"
            style={{ textAlign: "left", marginBottom: 24 }}
          >
            <div className="success__when">
              <strong>Tus turnos ya están confirmados.</strong>
              <br />
              Los pagaste con tus puntos del Programa Cerca: no debés nada.
            </div>
          </div>
        )}

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
