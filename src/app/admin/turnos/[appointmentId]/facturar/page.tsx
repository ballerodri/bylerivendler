import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "@/app/reserva/data"
import FacturarForm from "./facturar-form"

export const dynamic = "force-dynamic"

export default async function FacturarTurnoPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: appt } = await admin
    .from("appointments")
    .select(`total_cents, client:clients(first_name, last_name, dni, email), appointment_services(service:services(name))`)
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return <p className="adm-lede">Turno no encontrado.</p>

  const client = appt.client as unknown as { first_name: string; last_name: string; dni: string | null; email: string | null } | null
  const services = (appt.appointment_services ?? []) as unknown as { service: { name: string } | null }[]
  const descripcion = services.map((s) => s.service?.name).filter(Boolean).join(", ") || "Servicios"

  const { data: yaFacturada } = await admin
    .from("invoices")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle()

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Facturar <em>turno</em></h1>

      {yaFacturada && (
        <p style={{ color: "#8c6a3c", fontSize: 13, marginBottom: 12 }}>
          ⚠️ Este turno ya tiene una factura emitida. Si emitís otra, se duplicará.
        </p>
      )}

      <div className="adm-card" style={{ marginBottom: 16 }}>
        <div className="adm-list-row" style={{ gridTemplateColumns: "1fr auto" }}>
          <div>
            <div className="adm-name">{client ? `${client.first_name} ${client.last_name}` : "—"}</div>
            <div className="adm-sub">{descripcion}</div>
            <div className="adm-sub">{client?.dni ? `DNI ${client.dni}` : "Sin DNI"}{client?.email ? ` · ${client.email}` : ""}</div>
          </div>
          <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(appt.total_cents / 100)}</div>
        </div>
      </div>

      <FacturarForm appointmentId={appointmentId} tieneDni={!!client?.dni} />
    </>
  )
}
