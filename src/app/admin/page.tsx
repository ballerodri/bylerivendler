import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"
import StatusActions from "./_components/status-actions"
import PaidBadge from "./_components/paid-badge"
import { fmtPrice } from "../reserva/data"
import { fetchStaffServices } from "../reserva/queries"
import { unbookableServiceIds } from "@/lib/servicios/staff-services"
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
  paid_cents: number
  pack_purchase_id: string | null
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
      id, starts_at, ends_at, status, duration_min, total_cents, paid_cents, pack_purchase_id,
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

  // Aviso: un servicio activo sin NINGUNA profesional asignada en
  // `staff_services` no se puede reservar online y desaparece del catálogo
  // público (regla estricta, rama profesional-por-servicio) — hoy vive sólo
  // en /admin/servicios, así que el salón tiene que ir a buscarlo. Se repite
  // acá, arriba de todo, el mismo día que el deploy pueda hacer desaparecer
  // varios servicios de golpe. Sólo para admin/recepción, igual que el resto
  // de la info de negocio de esta página (los profesionales sólo ven su
  // propia agenda).
  let unbookableServices: { id: string; name: string }[] = []
  if (!staffProfile?.isProfessionalOnly) {
    const { data: svcRows } = await admin
      .from("services")
      .select("id, name")
      .eq("active", true)
    const activeServices = (svcRows ?? []) as { id: string; name: string }[]
    const staffServiceMap = await fetchStaffServices()
    const unbookableIds = new Set(
      unbookableServiceIds(activeServices.map((s) => s.id), staffServiceMap)
    )
    unbookableServices = activeServices.filter((s) => unbookableIds.has(s.id))
  }

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

      {unbookableServices.length > 0 && (
        <div className="adm-alert">
          <strong>
            {unbookableServices.length} servicio{unbookableServices.length === 1 ? "" : "s"} activo
            {unbookableServices.length === 1 ? "" : "s"} sin ninguna profesional asignada
          </strong>{" "}
          — no se pueden reservar online: ya no aparecen en el catálogo de la reserva
          ({unbookableServices.map((s) => s.name).join(", ")}).{" "}
          <Link href="/admin/servicios">Asignar profesional →</Link>
        </div>
      )}

      {appts.length > 0 && (
        <div className="adm-card">
          {appts.map((a) => {
            const time = new Date(a.starts_at).toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
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
                    <PaidBadge paidCents={a.paid_cents} totalCents={a.total_cents} status={a.status} />
                  </div>
                </div>
                <div>
                  <span className={`adm-pill adm-pill--${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <div className="adm-actions">
                  {/* El recordatorio por WhatsApp sólo para turnos confirmados. */}
                  {!staffProfile?.isProfessionalOnly && a.status === "confirmed" && a.client?.phone && (() => {
                    const msg = `Hola ${a.client!.first_name}! Te recordamos que tenés turno *hoy a las ${time}hs* en By Leri Vendler.\n\nEstamos en *Sanguinetti 297, Villa Morra · Pilar*.\n\nCualquier consulta estamos acá. ¡Te esperamos!`
                    const link = clientWhatsappLink(a.client!.phone, msg)
                    return link ? <WhatsAppButton appointmentId={a.id} link={link} /> : null
                  })()}
                  <StatusActions
                    appointmentId={a.id}
                    currentStatus={a.status}
                    totalCents={a.total_cents}
                    paidCents={a.paid_cents}
                    packLinked={!!a.pack_purchase_id}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
