import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import RescheduleFlow from "./reschedule-flow"
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

  const { data: appt } = await admin
    .from("appointments")
    .select(
      `id, status, starts_at, duration_min, total_cents,
       client:clients(user_id, first_name),
       appointment_services(service:services(name))`
    )
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) notFound()

  type ApptShape = {
    id: string
    status: string
    starts_at: string
    duration_min: number
    total_cents: number
    client: { user_id: string | null; first_name: string | null } | null
    appointment_services: { service: { name: string } | null }[]
  }
  const a = appt as unknown as ApptShape

  if (!a.client || a.client.user_id !== user.id) notFound()
  if (a.status !== "pending" && a.status !== "confirmed") {
    redirect("/portal")
  }

  const serviceNames = a.appointment_services
    .map((as) => as.service?.name)
    .filter((n): n is string => Boolean(n))

  return (
    <RescheduleFlow
      appointmentId={appointmentId}
      firstName={a.client.first_name ?? ""}
      serviceNames={serviceNames}
      currentStartsAt={a.starts_at}
      durationMin={a.duration_min}
    />
  )
}
