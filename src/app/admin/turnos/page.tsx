import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"
import StatusActions from "../_components/status-actions"
import ConfirmPurchaseButton from "../_components/confirm-purchase-button"
import PaidBadge from "../_components/paid-badge"
import { fmtPrice } from "../../reserva/data"
import { clientWhatsappLink } from "@/lib/whatsapp"
import WhatsAppButton from "../_components/whatsapp-button"

export const dynamic = "force-dynamic"

type ApptService = {
  service: { id: string; name: string } | null
  staff: { id: string; full_name: string } | null
  starts_at: string | null
}

type ApptRow = {
  id: string
  starts_at: string
  status: string
  duration_min: number
  total_cents: number
  paid_cents: number
  pack_purchase_id: string | null
  booking_group_id: string | null
  /** Cuándo salió el mail de confirmación de la compra (null = no salió). */
  confirmation_email_sent_at: string | null
  client: { id: string; first_name: string; last_name: string; phone: string | null } | null
  appointment_services: ApptService[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No vino",
}

const TZ = "America/Argentina/Buenos_Aires"

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })
}

function fmtDateLong(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })
}

/**
 * Si a la clienta ya le salió el mail de confirmación de esta compra.
 * `confirmation_email_sent_at` lo marca `sendGroupConfirmationEmail` al
 * mandarlo (y lo suelta si el envío falla, para poder reintentar), así que
 * "Mail enviado" quiere decir que Resend lo aceptó de verdad.
 *
 * Sólo se muestra en turnos confirmados: mientras están pendientes, que no
 * haya salido es lo ESPERADO (sale recién al confirmar el último de la
 * compra) y un cartelito de "sin mail" ahí sería ruido.
 */
function MailPill({ sentAt, status }: { sentAt: string | null; status: string }) {
  if (status !== "confirmed" && status !== "in_progress" && status !== "completed") return null
  if (sentAt) {
    return (
      <span
        className="adm-pill"
        title={`Enviado el ${new Date(sentAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })}`}
        style={{ marginLeft: 6, background: "#dfe9df", color: "#3c6a3c", fontSize: 10 }}
      >
        Mail enviado
      </span>
    )
  }
  return (
    <span
      className="adm-pill"
      title="Confirmá la compra de nuevo para reintentar el envío"
      style={{ marginLeft: 6, background: "#f6ecdf", color: "#8a6a3c", fontSize: 10 }}
    >
      Sin mail
    </span>
  )
}

export default async function AdminTurnosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; range?: string }>
}) {
  const sp = await searchParams
  const statusFilter = sp.status ?? "all"
  const range = sp.range ?? "upcoming"

  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  const staffProfile = user ? await getStaffProfile(user.id) : null

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  let q = admin.from("appointments").select(
    `
      id, starts_at, status, duration_min, total_cents, paid_cents, pack_purchase_id, booking_group_id,
      confirmation_email_sent_at,
      client:clients(id, first_name, last_name, phone),
      appointment_services(
        starts_at,
        service:services(id, name),
        staff:staff(id, full_name)
      )
    `
  )

  const now = new Date().toISOString()
  if (range === "upcoming") q = q.gte("starts_at", now).order("starts_at", { ascending: true })
  else if (range === "past") q = q.lt("starts_at", now).order("starts_at", { ascending: false })
  else q = q.order("starts_at", { ascending: false })

  if (statusFilter !== "all") q = q.eq("status", statusFilter)
  if (staffProfile?.isProfessionalOnly) q = q.eq("staff_id", staffProfile.id)

  const { data } = await q.limit(200)
  const appts = (data ?? []) as unknown as ApptRow[]

  const { data: facturadas } = await admin
    .from("invoices")
    .select("appointment_id")
    .in("appointment_id", appts.map((a) => a.id))
  const facturadasSet = new Set((facturadas ?? []).map((f) => f.appointment_id as string))

  const clientIds = Array.from(new Set(appts.map((a) => a.client?.id).filter(Boolean))) as string[]
  type ActivePackRow = { id: string; client_id: string; service_id: string | null; pack_name: string; sessions_total: number; sessions_used: number }
  const { data: ppData } = clientIds.length
    ? await admin
        .from("pack_purchases")
        .select("id, client_id, service_id, pack_name, sessions_total, sessions_used")
        .in("client_id", clientIds)
    : { data: [] as ActivePackRow[] }
  const activePacks = ((ppData ?? []) as ActivePackRow[]).filter((p) => p.sessions_used < p.sessions_total)

  // Profesionales activas, para el selector de "Cambiar profesional".
  const { data: professionalsData } = await admin
    .from("staff")
    .select("id, full_name")
    .eq("is_professional", true)
    .eq("active", true)
    .order("full_name")
  const professionals = (professionalsData ?? []) as { id: string; full_name: string }[]

  function packsForAppt(a: ApptRow): { id: string; label: string }[] {
    if (!a.client) return []
    const svcIds = new Set(a.appointment_services.map((s) => s.service?.id).filter(Boolean))
    return activePacks
      .filter((p) => p.client_id === a.client!.id && p.service_id && svcIds.has(p.service_id))
      .map((p) => ({ id: p.id, label: `${p.pack_name} · quedan ${p.sessions_total - p.sessions_used}` }))
  }

  // ── Agrupar por COMPRA ────────────────────────────────────────────────────
  // Agrupamos los turnos que comparten booking_group_id para que la seña se
  // confirme UNA sola vez (botón "Confirmar compra") y el mail único a la
  // clienta salga sí o sí — confirmando turno por turno era fácil dejar el
  // último colgado y el mail no salía nunca. La PLATA queda POR TURNO (cada
  // turno factura su propia Factura C), así que no se suma nada: cada
  // sub-bloque muestra su precio y sus cobros.
  //
  // Una profesional (isProfessionalOnly) ve la agenda SIN agrupar: sólo ve
  // sus propios turnos, y una tarjeta parcial con un botón que confirma
  // turnos invisibles de otras profesionales sería confuso.
  const groups: ApptRow[][] = staffProfile?.isProfessionalOnly
    ? appts.map((a) => [a])
    : groupPurchases(appts)

  /** UNA fila de turno, tal cual fue siempre (turnos sueltos o sin grupo). */
  function renderTurno(a: ApptRow) {
    const date = new Date(a.starts_at)
    const dateLabel = date.toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: TZ,
    })
    const time = fmtTime(a.starts_at)
    const svcItems = a.appointment_services
      .slice()
      .sort((x, y) => {
        if (!x.starts_at) return 0
        if (!y.starts_at) return 0
        return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
      })
    const isMulti = svcItems.length > 1 && svcItems.some((s) => s.starts_at)

    return (
      <div key={a.id} className="adm-list-row adm-list-row--turnos">
        <div className="adm-time" style={{ fontSize: 15 }}>
          {dateLabel}
          <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)" }}>
            {time}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="adm-name">
            {a.client ? (
              <Link href={`/admin/clientas/${a.client.id}`}>
                {a.client.first_name} {a.client.last_name}
              </Link>
            ) : "—"}
          </div>
          {isMulti ? (
            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {svcItems.map((as, i) => (
                <div key={i} style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {as.starts_at && (
                    <span style={{ fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
                      {fmtTime(as.starts_at)}
                    </span>
                  )}
                  {as.service?.name}
                  {as.staff?.full_name && (
                    <span style={{ color: "var(--ink-mute)" }}> · {as.staff.full_name}</span>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 2 }}>
                {a.duration_min} min · <strong style={{ color: "var(--ink)" }}>{fmtPrice(a.total_cents / 100)}</strong>
                <PaidBadge paidCents={a.paid_cents} totalCents={a.total_cents} status={a.status} />
              </div>
            </div>
          ) : (
            <div className="adm-sub" style={{ fontSize: 13 }}>
              {svcItems.map((s) => s.service?.name).filter(Boolean).join(", ")}
              {svcItems[0]?.staff?.full_name && (
                <> · {svcItems[0].staff.full_name}</>
              )}
              {" · "}{a.duration_min} min · <strong style={{ color: "var(--ink)" }}>{fmtPrice(a.total_cents / 100)}</strong>
              <PaidBadge paidCents={a.paid_cents} totalCents={a.total_cents} status={a.status} />
            </div>
          )}
        </div>
        <div>
          <span className={`adm-pill adm-pill--${a.status}`}>
            {STATUS_LABEL[a.status] ?? a.status}
          </span>
          {facturadasSet.has(a.id) && (
            <span className="adm-pill" style={{ marginLeft: 6, background: "#dfe9df", color: "#3c6a3c", fontSize: 10 }}>Facturada</span>
          )}
          <MailPill sentAt={a.confirmation_email_sent_at} status={a.status} />
        </div>
        <div className="adm-actions">
          {/* El recordatorio por WhatsApp sólo para turnos confirmados. */}
          {!staffProfile?.isProfessionalOnly && a.status === "confirmed" && a.client?.phone && (() => {
            const isToday = new Date(a.starts_at).toLocaleDateString("sv", { timeZone: TZ }) === new Date().toLocaleDateString("sv", { timeZone: TZ })
            const when = isToday ? `hoy a las ${time}hs` : `el ${fmtDateLong(a.starts_at)} a las ${time}hs`
            const msg = `Hola ${a.client!.first_name}! Te recordamos que tenés turno *${when}* en By Leri Vendler.\n\nEstamos en *Sanguinetti 297, Villa Morra · Pilar*.\n\nCualquier consulta estamos acá. ¡Te esperamos!`
            const link = clientWhatsappLink(a.client!.phone, msg)
            return link ? <WhatsAppButton appointmentId={a.id} link={link} /> : null
          })()}
          <StatusActions
            appointmentId={a.id}
            currentStatus={a.status}
            totalCents={a.total_cents}
            paidCents={a.paid_cents}
            matchingPacks={packsForAppt(a)}
            packLinked={!!a.pack_purchase_id}
            professionals={professionals}
            services={svcItems
              .filter((s) => s.service)
              .map((s) => ({
                serviceId: s.service!.id,
                serviceName: s.service!.name,
                staffId: s.staff?.id ?? null,
                staffName: s.staff?.full_name ?? null,
              }))}
          />
        </div>
      </div>
    )
  }

  /** UNA tarjeta por COMPRA (2+ turnos que comparten booking_group_id):
   *  clienta una sola vez, un sub-bloque por turno con SU plata y SUS
   *  acciones, y un solo "Confirmar compra" a la derecha. */
  function renderCompra(group: ApptRow[]) {
    // Dentro del grupo SIEMPRE ascendente por horario: con range=past la
    // consulta viene descendente y la compra se leería al revés.
    const sorted = [...group].sort(
      (x, y) => new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
    )
    const first = sorted[0]
    const dateLabel = new Date(first.starts_at).toLocaleDateString("es-AR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: TZ,
    })
    const allSameStatus = sorted.every((a) => a.status === first.status)
    const groupHasPending = sorted.some((a) => a.status === "pending")

    return (
      <div key={first.booking_group_id ?? first.id} className="adm-list-row adm-list-row--turnos">
        <div className="adm-time" style={{ fontSize: 15 }}>
          {dateLabel}
          <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)" }}>
            {fmtTime(first.starts_at)}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="adm-name">
            {first.client ? (
              <Link href={`/admin/clientas/${first.client.id}`}>
                {first.client.first_name} {first.client.last_name}
              </Link>
            ) : "—"}
          </div>
          {sorted.map((a) => {
            const time = fmtTime(a.starts_at)
            const svcItems = a.appointment_services
              .slice()
              .sort((x, y) => {
                if (!x.starts_at) return 0
                if (!y.starts_at) return 0
                return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
              })
            const isMulti = svcItems.length > 1 && svcItems.some((s) => s.starts_at)
            return (
              <div key={a.id} style={{ marginTop: 8 }}>
                {isMulti ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {svcItems.map((as, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                        {as.starts_at && (
                          <span style={{ fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
                            {fmtTime(as.starts_at)}
                          </span>
                        )}
                        {as.service?.name}
                        {as.staff?.full_name && (
                          <span style={{ color: "var(--ink-mute)" }}> · {as.staff.full_name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", marginRight: 4 }}>
                      {time}
                    </span>
                    {svcItems.map((s) => s.service?.name).filter(Boolean).join(", ")}
                    {svcItems[0]?.staff?.full_name && (
                      <span style={{ color: "var(--ink-mute)" }}> · {svcItems[0].staff.full_name}</span>
                    )}
                  </div>
                )}
                {/* La plata de ESTE turno: no se suma nada porque la factura
                    (ARCA) es por turno — cada uno con su precio y sus cobros. */}
                <div style={{ fontSize: 13, color: "var(--ink-mute)", marginTop: 2 }}>
                  {a.duration_min} min · <strong style={{ color: "var(--ink)" }}>{fmtPrice(a.total_cents / 100)}</strong>
                  <PaidBadge paidCents={a.paid_cents} totalCents={a.total_cents} status={a.status} />
                  {facturadasSet.has(a.id) && (
                    <span className="adm-pill" style={{ marginLeft: 6, background: "#dfe9df", color: "#3c6a3c", fontSize: 10 }}>Facturada</span>
                  )}
                  {!allSameStatus && (
                    <span className={`adm-pill adm-pill--${a.status}`} style={{ marginLeft: 6 }}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  )}
                </div>
                <div className="adm-actions" style={{ justifyContent: "flex-start", marginTop: 4 }}>
                  {/* El recordatorio por WhatsApp sólo para turnos confirmados. */}
                  {!staffProfile?.isProfessionalOnly && a.status === "confirmed" && a.client?.phone && (() => {
                    const isToday = new Date(a.starts_at).toLocaleDateString("sv", { timeZone: TZ }) === new Date().toLocaleDateString("sv", { timeZone: TZ })
                    const when = isToday ? `hoy a las ${time}hs` : `el ${fmtDateLong(a.starts_at)} a las ${time}hs`
                    const msg = `Hola ${a.client!.first_name}! Te recordamos que tenés turno *${when}* en By Leri Vendler.\n\nEstamos en *Sanguinetti 297, Villa Morra · Pilar*.\n\nCualquier consulta estamos acá. ¡Te esperamos!`
                    const link = clientWhatsappLink(a.client!.phone, msg)
                    return link ? <WhatsAppButton appointmentId={a.id} link={link} /> : null
                  })()}
                  <StatusActions
                    appointmentId={a.id}
                    currentStatus={a.status}
                    totalCents={a.total_cents}
                    paidCents={a.paid_cents}
                    matchingPacks={packsForAppt(a)}
                    packLinked={!!a.pack_purchase_id}
                    professionals={professionals}
                    services={svcItems
                      .filter((s) => s.service)
                      .map((s) => ({
                        serviceId: s.service!.id,
                        serviceName: s.service!.name,
                        staffId: s.staff?.id ?? null,
                        staffName: s.staff?.full_name ?? null,
                      }))}
                    hideConfirmButton={groupHasPending}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div>
          {/* Un solo pill cuando toda la compra está pareja; si no, cada
              sub-bloque ya mostró el suyo. */}
          {allSameStatus && (
            <span className={`adm-pill adm-pill--${first.status}`}>
              {STATUS_LABEL[first.status] ?? first.status}
            </span>
          )}
          <MailPill sentAt={group.find((a) => a.confirmation_email_sent_at)?.confirmation_email_sent_at ?? null} status={first.status} />
        </div>
        <div className="adm-actions">
          {groupHasPending && first.booking_group_id && (
            <ConfirmPurchaseButton bookingGroupId={first.booking_group_id} />
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <p className="adm-eyebrow">Agenda</p>
      <h1 className="adm-h1">
        {staffProfile?.isProfessionalOnly ? "Mis " : "Todos los "}<em>turnos</em>
      </h1>
      <p className="adm-lede">
        {staffProfile?.isProfessionalOnly
          ? `Tus turnos asignados · `
          : ""
        }
        {appts.length} resultado{appts.length === 1 ? "" : "s"}.
      </p>

      <form className="adm-toolbar" method="get">
        <select className="adm-select" name="range" defaultValue={range}>
          <option value="upcoming">Próximos</option>
          <option value="past">Pasados</option>
          <option value="all">Todos</option>
        </select>
        <select className="adm-select" name="status" defaultValue={statusFilter}>
          <option value="all">Cualquier estado</option>
          <option value="pending">Pendientes</option>
          <option value="confirmed">Confirmados</option>
          <option value="in_progress">En curso</option>
          <option value="completed">Completados</option>
          <option value="cancelled">Cancelados</option>
          <option value="no_show">No vino</option>
        </select>
        <button className="adm-btn adm-btn--primary" type="submit">
          Filtrar
        </button>
      </form>

      {appts.length === 0 ? (
        <div className="adm-card">
          <div className="adm-empty">No hay turnos que cumplan ese filtro.</div>
        </div>
      ) : (
        <div className="adm-card">
          {groups.map((group) =>
            group.length === 1 ? renderTurno(group[0]) : renderCompra(group)
          )}
        </div>
      )}
    </>
  )
}

/** Agrupa los turnos por compra (booking_group_id); sin grupo, cada uno va
 *  solo. El orden de las tarjetas = primera aparición (la lista ya viene
 *  ordenada por la consulta). Mismo criterio que el portal. */
function groupPurchases(appts: ApptRow[]): ApptRow[][] {
  const groups: ApptRow[][] = []
  const byGroup = new Map<string, ApptRow[]>()
  for (const a of appts) {
    const key = a.booking_group_id ?? a.id
    let arr = byGroup.get(key)
    if (!arr) {
      arr = []
      byGroup.set(key, arr)
      groups.push(arr)
    }
    arr.push(a)
  }
  return groups
}
