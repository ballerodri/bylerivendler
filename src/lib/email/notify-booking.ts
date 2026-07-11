import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendNewBookingAlert } from "./booking-emails"

/**
 * Avisa una nueva reserva por email a los admins (Leri / recepción) y al
 * personal asignado, sin duplicar destinatarios. `excludeEmail` evita avisarle
 * a quien creó la reserva (ej. la admin que la carga a mano). Best-effort: no
 * bloquea la reserva si algo falla.
 */
export async function notifyNewBooking(
  supabase: SupabaseClient,
  opts: {
    clientName: string
    clientPhone?: string | null
    servicesNames: string[]
    startsAt: Date
    durationMin: number
    totalCents: number
    assignedStaffIds?: (string | null)[]
    excludeEmail?: string | null
  }
): Promise<void> {
  try {
    const { data: adminRows } = await supabase
      .from("staff")
      .select("email")
      .in("role", ["admin", "reception"])
      .eq("active", true)
      .not("email", "is", null)

    const staffIds = [...new Set((opts.assignedStaffIds ?? []).filter((id): id is string => !!id))]
    let profRows: { email: string | null }[] = []
    if (staffIds.length) {
      const { data } = await supabase
        .from("staff")
        .select("email")
        .in("id", staffIds)
        .eq("active", true)
        .not("email", "is", null)
      profRows = (data ?? []) as { email: string | null }[]
    }

    const exclude = (opts.excludeEmail ?? "").toLowerCase()
    const seen = new Set<string>()
    const to: string[] = []
    for (const row of [...((adminRows ?? []) as { email: string | null }[]), ...profRows]) {
      const e = row.email
      if (!e) continue
      const k = e.toLowerCase()
      if (k === exclude || seen.has(k)) continue
      seen.add(k)
      to.push(e)
    }

    if (to.length) {
      await sendNewBookingAlert({
        to,
        clientName: opts.clientName,
        clientPhone: opts.clientPhone,
        servicesNames: opts.servicesNames,
        startsAt: opts.startsAt,
        durationMin: opts.durationMin,
        totalCents: opts.totalCents,
      })
    }
  } catch {
    // no bloquea la reserva
  }
}
