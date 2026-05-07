import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"
import StatusActions from "./_components/status-actions"
import { fmtPrice } from "../reserva/data"
import { clientWhatsappLink } from "@/lib/whatsapp"
import WhatsAppButton from "./_components/whatsapp-button"

export const dynamic = "force-dynamic"

type ApptRow = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  duration_min: number
  total_cents: number
  client: { id: string; first_name: string; last_name: string; phone: string | null } | null
  appointment_services: { service: { name: string } | null; staff: { full_name: string } | null }[]
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

export default async function AdminTodayPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  const staffProfile = user ? await getStaffProfile(user.id) : null

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // Argentina today bounds in UTC
  const now = new Date()
  const arNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }))
  const arStart = new Date(Date.UTC(
    arNow.getFullYear(), arNow.getMonth(), arNow.getDate(), 3, 0, 0
  ))
  const arEnd = new Date(arStart.getTime() + 24 * 3_600_000)

  let q = admin
    .from("appointments")
    .select(`
      id, starts_at, ends_at, status, duration_min, total_cents,
      client:clients(id, first_name, last_name, phone),
      appointment_services(service:services(name), staff:staff(full_name))
    `)
    .gte("starts_at", arStart.toISOString())
    .lt("starts_at", arEnd.toISOString())
    .order("starts_at", { ascending: true })

  // Profesionales solo ven sus propios turnos
  if (staffProfile?.isProfessionalOnly) {
    q = q.eq("staff_id", staffProfile.id)
  }

  const { data } = await q
  const appts = (data ?? []) as unknown as ApptRow[]

  const dateLabel = arNow.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  })

  return (
    <>
      <p className="adm-eyebrow">
        {staffProfile?.isProfessionalOnly ? `${staffProfile.full_name} · ` : ""}Hoy · {dateLabel}
      </p>
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
            const time = new Date(a.starts_at).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: TZ,
            })
            const services = a.appointment_services
              .map((as) => as.service?.name)
              .filter(Boolean)
              .join(", ")
            const pros = [...new Set(
              a.appointment_services.map((as) => as.staff?.full_name).filter(Boolean)
            )].join(", ")
            return (
              <div key={a.id} className="adm-list-row adm-list-row--turnos">
                <div className="adm-time">{time}</div>
                <div>
                  <div className="adm-name">
                    {a.client ? (
                      staffProfile?.isProfessionalOnly ? (
                        `${a.client.first_name} ${a.client.last_name}`
                      ) : (
                        <Link href={`/admin/clientas/${a.client.id}`}>
                          {a.client.first_name} {a.client.last_name}
                        </Link>
                      )
                    ) : "—"}
                  </div>
                  <div className="adm-sub">
                    {services}
                    {!staffProfile?.isProfessionalOnly && pros && ` · ${pros}`}
                    {" · "}{a.duration_min} min · {fmtPrice(a.total_cents / 100)}
                  </div>
                </div>
                <div>
                  <span className={`adm-pill adm-pill--${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <div className="adm-actions">
                  {!staffProfile?.isProfessionalOnly && a.client?.phone && (() => {
                    const msg = `Hola ${a.client!.first_name}, te recordamos que tenés turno *hoy a las ${time}* en By Leri Vendler. ¡Te esperamos! 🌸`
                    const link = clientWhatsappLink(a.client!.phone, msg)
                    return link ? <WhatsAppButton appointmentId={a.id} link={link} /> : null
                  })()}
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
