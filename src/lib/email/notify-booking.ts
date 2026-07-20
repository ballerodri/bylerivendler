import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { sendNewBookingAlert, sendNewPurchaseAlert } from "./booking-emails"

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
      // Quién quiere recibir estos avisos: se elige en Admin → Personal. Sin
      // esto los recibía todo el que tuviera rol admin, sin forma de optar.
      .eq("notify_bookings", true)
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
    // Acá SÍ van las profesionales asignadas: este aviso es de un turno que el
    // salón cargó a mano, y esos nacen CONFIRMADOS — o sea que la profesional
    // se entera igual que la clienta, cuando el turno ya es firme.
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

/**
 * Avisa UNA compra entera (uno o varios turnos) por email al equipo, en UN
 * solo mail itemizado en vez de uno por turno. Best-effort: nunca lanza.
 *
 * Destinatarios: SÓLO admins/recepción activos (sin duplicados, con
 * `excludeEmail` opcional). Las profesionales NO entran acá: se enteran
 * cuando el turno queda confirmado (`sendGroupConfirmationEmail`), porque
 * hasta que no está la seña la compra puede caerse.
 */
export async function notifyNewPurchase(
  supabase: SupabaseClient,
  opts: {
    clientName: string
    clientPhone?: string | null
    rows: { startsAt: Date; label: string; durationMin: number; staffId: string | null }[]
    totalCents: number
    dueNowCents: number
    excludeEmail?: string | null
  }
): Promise<void> {
  try {
    const staffIds = [...new Set(opts.rows.map((r) => r.staffId).filter((id): id is string => !!id))]

    // Un select a staff por los ids de las filas, SÓLO para poner el nombre de
    // cada profesional en el mail. Las profesionales NO reciben este aviso: se
    // enteran recién cuando el turno queda confirmado, igual que la clienta
    // (hasta entonces la compra puede caerse por falta de seña, y no tiene
    // sentido mandarles a agendar algo que todavía no es firme).
    let staffRows: { id: string; full_name: string | null }[] = []
    if (staffIds.length) {
      const { data } = await supabase.from("staff").select("id, full_name").in("id", staffIds)
      staffRows = (data ?? []) as typeof staffRows
    }
    const nameById = new Map(staffRows.map((s) => [s.id, s.full_name]))

    const { data: adminRows } = await supabase
      .from("staff")
      .select("email")
      .in("role", ["admin", "reception"])
      .eq("active", true)
      // Quién quiere recibir estos avisos: se elige en Admin → Personal. Sin
      // esto los recibía todo el que tuviera rol admin, sin forma de optar.
      .eq("notify_bookings", true)
      .not("email", "is", null)

    const exclude = (opts.excludeEmail ?? "").toLowerCase()
    const seen = new Set<string>()
    const to: string[] = []
    for (const row of (adminRows ?? []) as { email: string | null }[]) {
      const e = row.email
      if (!e) continue
      const k = e.toLowerCase()
      if (k === exclude || seen.has(k)) continue
      seen.add(k)
      to.push(e)
    }

    if (to.length) {
      await sendNewPurchaseAlert({
        to,
        clientName: opts.clientName,
        clientPhone: opts.clientPhone,
        rows: opts.rows.map((r) => ({
          startsAt: r.startsAt,
          label: r.label,
          durationMin: r.durationMin,
          staffName: (r.staffId ? nameById.get(r.staffId) : null) ?? null,
        })),
        totalCents: opts.totalCents,
        dueNowCents: opts.dueNowCents,
      })
    }
  } catch {
    // no bloquea la compra
  }
}
