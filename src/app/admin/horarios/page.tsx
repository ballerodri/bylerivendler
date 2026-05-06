import { createClient as createAdminClient } from "@supabase/supabase-js"
import HoursEditor from "./hours-editor"

export const dynamic = "force-dynamic"

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]

type BusinessHourRow = {
  day_of_week: number
  is_open: boolean
  slots: string[]
}

export default async function AdminHorariosPage() {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("business_hours")
    .select("day_of_week, is_open, slots")
    .order("day_of_week", { ascending: true })

  const rows = (data ?? []) as BusinessHourRow[]

  // Garantizar 7 entradas (0-6)
  const hours: BusinessHourRow[] = Array.from({ length: 7 }, (_, i) => {
    const found = rows.find((r) => r.day_of_week === i)
    return found ?? { day_of_week: i, is_open: i !== 0, slots: [] }
  })

  return (
    <>
      <p className="adm-eyebrow">Configuración</p>
      <h1 className="adm-h1">
        Días y <em>horarios</em>
      </h1>
      <p className="adm-lede">
        Definí qué días atendés y en qué franjas. Los cambios se reflejan de inmediato en el flujo de reserva.
      </p>

      <HoursEditor hours={hours} dayNames={DAY_NAMES} />
    </>
  )
}
