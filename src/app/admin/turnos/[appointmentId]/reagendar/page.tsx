import { redirect, notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { isStaffUser } from "@/lib/staff"
import AdminRescheduleForm from "./reschedule-form"
import { fetchBusinessHours } from "@/app/reserva/queries"
import "../../../admin.css"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ appointmentId: string }> }

export default async function AdminReschedulePage({ params }: Props) {
  const { appointmentId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (!(await isStaffUser(user.id))) redirect("/portal")

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
        `id, status, starts_at, duration_min, total_cents,
         client:clients(first_name, last_name),
         appointment_services(service:services(name))`
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
    client: { first_name: string | null; last_name: string | null } | null
    appointment_services: { service: { name: string } | null }[]
  }
  const a = appt as unknown as ApptShape

  if (a.status !== "pending" && a.status !== "confirmed") {
    redirect("/admin/turnos")
  }

  const clientName = a.client
    ? `${a.client.first_name ?? ""} ${a.client.last_name ?? ""}`.trim()
    : "Sin clienta"

  const serviceNames = a.appointment_services
    .map((as) => as.service?.name)
    .filter((n): n is string => Boolean(n))

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 24 }}>
        <a
          href="/admin/turnos"
          style={{ fontSize: 13, color: "var(--ink-soft)", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          ← Volver a turnos
        </a>
      </div>

      <p className="adm-eyebrow">Reagendar turno</p>
      <h1 className="adm-h1">{clientName}</h1>

      <AdminRescheduleForm
        appointmentId={appointmentId}
        clientName={clientName}
        serviceNames={serviceNames}
        currentStartsAt={a.starts_at}
        durationMin={a.duration_min}
        businessHours={businessHours}
      />
    </div>
  )
}
