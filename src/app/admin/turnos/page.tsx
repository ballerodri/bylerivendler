import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import StatusActions from "../_components/status-actions"
import { fmtPrice } from "../../reserva/data"

export const dynamic = "force-dynamic"

type ApptService = {
  service: { name: string } | null
  staff: { full_name: string } | null
  starts_at: string | null
}

type ApptRow = {
  id: string
  starts_at: string
  status: string
  duration_min: number
  total_cents: number
  client: { id: string; first_name: string; last_name: string } | null
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
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
}

export default async function AdminTurnosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; range?: string }>
}) {
  const sp = await searchParams
  const statusFilter = sp.status ?? "all"
  const range = sp.range ?? "upcoming"

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  let q = admin.from("appointments").select(
    `
      id, starts_at, status, duration_min, total_cents,
      client:clients(id, first_name, last_name),
      appointment_services(
        starts_at,
        service:services(name),
        staff:staff(full_name)
      )
    `
  )

  const now = new Date().toISOString()
  if (range === "upcoming") q = q.gte("starts_at", now).order("starts_at", { ascending: true })
  else if (range === "past") q = q.lt("starts_at", now).order("starts_at", { ascending: false })
  else q = q.order("starts_at", { ascending: false })

  if (statusFilter !== "all") q = q.eq("status", statusFilter)

  const { data } = await q.limit(200)
  const appts = (data ?? []) as unknown as ApptRow[]

  return (
    <>
      <p className="adm-eyebrow">Agenda</p>
      <h1 className="adm-h1">
        Todos los <em>turnos</em>
      </h1>
      <p className="adm-lede">
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
          {appts.map((a) => {
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
                <div className="adm-time" style={{ fontSize: 14 }}>
                  {dateLabel}
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-mute)" }}>
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
                      <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>
                        {a.duration_min} min · {fmtPrice(a.total_cents / 100)}
                      </div>
                    </div>
                  ) : (
                    <div className="adm-sub">
                      {svcItems.map((s) => s.service?.name).filter(Boolean).join(", ")}
                      {svcItems[0]?.staff?.full_name && (
                        <> · {svcItems[0].staff.full_name}</>
                      )}
                      {" · "}{a.duration_min} min · {fmtPrice(a.total_cents / 100)}
                    </div>
                  )}
                </div>
                <div>
                  <span className={`adm-pill adm-pill--${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <div className="adm-actions">
                  <StatusActions appointmentId={a.id} currentStatus={a.status} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
