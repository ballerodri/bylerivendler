import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import RescheduleFlow from "./reschedule-flow"
import { fetchBusinessHours } from "@/app/reserva/queries"
import "../../reserva.css"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ appointmentId: string }> }

export default async function ReschedulePage({ params }: Props) {
  const { appointmentId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/reserva/reagendar/${appointmentId}`)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [businessHours, { data: appt }] = await Promise.all([
    fetchBusinessHours(),
    admin
      .from("appointments")
      .select(
        `id, status, starts_at, duration_min, total_cents, staff_id,
         client:clients(user_id, first_name),
         appointment_services(service_id, staff_id, starts_at, duration_min, service:services(name))`
      )
      .eq("id", appointmentId)
      .maybeSingle(),
  ])

  if (!appt) notFound()

  type ApptShape = {
    id: string
    status: string
    starts_at: string
    duration_min: number
    total_cents: number
    staff_id: string | null
    client: { user_id: string | null; first_name: string | null } | null
    appointment_services: {
      service_id: string
      staff_id: string | null
      starts_at: string | null
      duration_min: number
      service: { name: string } | null
    }[]
  }
  const a = appt as unknown as ApptShape

  if (!a.client || a.client.user_id !== user.id) notFound()
  if (a.status !== "pending" && a.status !== "confirmed") {
    redirect("/portal")
  }

  const serviceNames = a.appointment_services
    .map((as) => as.service?.name)
    .filter((n): n is string => Boolean(n))

  // Para el buscador de horarios (autoritativo, ver `fetchDayAvailability`):
  // se usa la PRIMERA pata (por horario) como referencia — su servicio, su
  // duración y su profesional. El chequeo por-pata del servidor
  // (`rescheduleMyAppointment`) es el que manda si el turno tiene varias.
  const orderedSvcs = a.appointment_services
    .slice()
    .sort((x, y) => {
      if (!x.starts_at || !y.starts_at) return 0
      return new Date(x.starts_at).getTime() - new Date(y.starts_at).getTime()
    })
  const firstLeg = orderedSvcs[0] ?? null

  return (
    <RescheduleFlow
      appointmentId={appointmentId}
      firstName={a.client.first_name ?? ""}
      serviceNames={serviceNames}
      currentStartsAt={a.starts_at}
      durationMin={a.duration_min}
      businessHours={businessHours}
      firstServiceId={firstLeg?.service_id ?? null}
      firstServiceDurationMin={firstLeg?.duration_min ?? a.duration_min}
      firstServiceProHint={firstLeg?.staff_id ?? a.staff_id ?? "auto"}
    />
  )
}
