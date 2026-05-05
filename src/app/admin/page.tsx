import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import StatusActions from "./_components/status-actions"
import { fmtPrice } from "../reserva/data"

export const dynamic = "force-dynamic"

type ApptRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  duration_min: number
  total_cents: number
  client: { id: string; first_name: string; last_name: string; phone: string | null } | null
  appointment_services: { service: { name: string } | null }[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No vino",
}

export default async function AdminTodayPage() {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data } = await admin
    .from("appointments")
    .select(
      `
      id, starts_at, ends_at, status, duration_min, total_cents,
      client:clients(id, first_name, last_name, phone),
      appointment_services(service:services(name))
    `
    )
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at", { ascending: true })

  const appts = (data ?? []) as unknown as ApptRow[]

  const dateLabel = start.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <>
      <p className="adm-eyebrow">Hoy · {dateLabel}</p>
      <h1 className="adm-h1">
        Agenda del <em>día</em>
      </h1>
      <p className="adm-lede">
        {appts.length === 0
          ? "Sin turnos programados para hoy."
          : `${appts.length} turno${appts.length === 1 ? "" : "s"} para hoy.`}
      </p>

      {appts.length > 0 && (
        <div className="adm-card">
          {appts.map((a) => {
            const date = new Date(a.starts_at)
            const time = date.toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })
            const services = a.appointment_services
              .map((as) => as.service?.name)
              .filter(Boolean)
              .join(", ")
            return (
              <div key={a.id} className="adm-list-row adm-list-row--turnos">
                <div className="adm-time">{time}</div>
                <div>
                  <div className="adm-name">
                    {a.client ? (
                      <Link href={`/admin/clientas/${a.client.id}`}>
                        {a.client.first_name} {a.client.last_name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="adm-sub">
                    {services} · {a.duration_min} min · {fmtPrice(a.total_cents / 100)}
                  </div>
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
