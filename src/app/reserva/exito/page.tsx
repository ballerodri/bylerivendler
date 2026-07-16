import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { DOW_NAMES, MONTH_NAMES, fmtDuration, fmtPrice } from "../data"
import { buildItinerary } from "@/lib/servicios/purchase-itinerary"
import { TRANSFER_ALIAS, TRANSFER_BANK, TRANSFER_HOLDER } from "@/lib/payment-info"
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
  pack: { pack_name: string; sessions_total: number } | null
  appointment_services: {
    starts_at: string | null
    duration_min: number | null
    service: { name: string } | null
    staff: { full_name: string } | null
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
      "id, starts_at, duration_min, total_cents, deposit_cents, status, pack_purchase_id, client:clients(first_name), pack:pack_purchases(pack_name, sessions_total), appointment_services(starts_at, duration_min, service:services(name), staff:staff(full_name))"
    )
    .in("id", ids)
    .order("starts_at", { ascending: true })

  const appts = (data ?? []) as unknown as ApptRow[]
  if (appts.length === 0) notFound()

  const appt = appts[0]
  const firstName = appt.client?.first_name ?? ""
  const dueNowCents = appts.reduce((acc, a) => acc + a.deposit_cents, 0)
  const totalCents = appts.reduce((acc, a) => acc + a.total_cents, 0)

  // El ITINERARIO UNIFICADO de la compra (módulo puro compartido con el mail
  // de confirmación y el portal): todas las filas cronológicas juntas, SIN
  // separar el pack de los tratamientos.
  const withPack = appts.find((a) => a.pack)
  const packName = withPack?.pack?.pack_name ?? null
  const packScheduled = appts.filter((a) => a.pack_purchase_id).length
  const packRemaining = withPack
    ? Math.max(0, (withPack.pack?.sessions_total ?? packScheduled) - packScheduled)
    : 0
  const rows = buildItinerary(
    appts.map((a) => ({
      id: a.id,
      startsAt: a.starts_at,
      durationMin: a.duration_min,
      packPurchaseId: a.pack_purchase_id,
      legs: a.appointment_services.map((as) => ({
        startsAt: as.starts_at,
        durationMin: as.duration_min,
        serviceName: as.service?.name ?? null,
        staffName: as.staff?.full_name ?? null,
      })),
    })),
    packName
  )
  // Agrupadas por día (una compra "separados" puede cruzar días).
  const days: { dateStr: string; rows: typeof rows }[] = []
  for (const r of rows) {
    const last = days[days.length - 1]
    if (!last || last.dateStr !== r.dateStr) days.push({ dateStr: r.dateStr, rows: [r] })
    else last.rows.push(r)
  }
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

        {/* UNA sola tarjeta con el itinerario completo de la compra (pack +
            tratamientos JUNTOS, cronológico) — la usuaria no quiere la
            división pack/tratamientos. Este componente corre en el SERVIDOR
            (UTC en Vercel): la fecha/hora viene SIEMPRE del itinerario (hora
            argentina vía arPartsFromUtc), nunca de getDay()/toLocaleTimeString
            a secas — eso mostraba 10:00 como "01:00 p. m.". */}
        <div
          className="success__card"
          style={{ textAlign: "left", marginBottom: 24 }}
        >
          {days.map((day) => {
            const [, dMonth, dDay] = day.dateStr.split("-").map(Number)
            // El día de la semana del calendario argentino: medianoche UTC de
            // esa fecha tiene el mismo día de calendario.
            const dow = new Date(`${day.dateStr}T00:00:00Z`).getUTCDay()
            return (
              <div key={day.dateStr} style={{ marginBottom: 10 }}>
                <div className="success__svc" style={{ marginBottom: 10 }}>
                  {DOW_NAMES[(dow + 6) % 7]} {dDay} de{" "}
                  {MONTH_NAMES[dMonth - 1].toLowerCase()}
                </div>
                {day.rows.map((r) => (
                  <div
                    key={r.apptId + r.hm + r.label}
                    style={{ display: "flex", gap: 12, marginBottom: 6 }}
                  >
                    <span
                      style={{
                        color: "var(--gold)",
                        fontVariantNumeric: "tabular-nums",
                        minWidth: 44,
                      }}
                    >
                      {r.hm}
                    </span>
                    <span>
                      {r.label}
                      <span style={{ color: "var(--muted, #7a6e64)" }}>
                        {r.durationMin ? <> · {fmtDuration(r.durationMin)}</> : null}
                        {r.staffName ? <> · {r.staffName}</> : null}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )
          })}
          {packRemaining > 0 && (
            <div style={{ fontSize: 13, color: "var(--muted, #7a6e64)", marginBottom: 10 }}>
              Te quedan <strong>{packRemaining}</strong> sesión(es) del pack por
              agendar. Coordinamos con vos para fijarlas.
            </div>
          )}
          <div
            className="success__when"
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--line)",
            }}
          >
            {totalCents > 0 ? <>Total · {fmtPrice(totalCents / 100)}</> : "Canjeada con puntos"}
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

        {/* Con algo que transferir, los datos completos: cuánto, a dónde y a
            nombre de quién (pedido de la usuaria — antes solo decía que era
            "una sola transferencia"). Si no hay nada que transferir (canjeó
            con puntos), no hay comprobante que mandar. */}
        {dueNowCents > 0 && (
          <div
            className="success__card"
            style={{ textAlign: "left", marginBottom: 24 }}
          >
            <div className="success__when">
              <strong>A transferir ahora: {fmtPrice(dueNowCents / 100)}</strong>
              <br />
              Alias <strong>{TRANSFER_ALIAS}</strong> · {TRANSFER_BANK}
              <br />
              A nombre de <strong>{TRANSFER_HOLDER}</strong>
              <br />
              <span style={{ color: "var(--muted, #7a6e64)" }}>
                Una sola transferencia por toda tu compra. Mandanos el
                comprobante por WhatsApp y confirmamos tus turnos.
              </span>
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
