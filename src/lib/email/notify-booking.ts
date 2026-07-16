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

/**
 * Avisa UNA compra entera (uno o varios turnos) por email al equipo: mismos
 * destinatarios que `notifyNewBooking` (admins/recepción activos + las
 * profesionales asignadas, sin duplicados, `excludeEmail` opcional), pero en
 * UN solo mail itemizado en vez de uno por turno. Best-effort: nunca lanza.
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

    // UN solo select a staff por los ids de las filas: de ahí salen los
    // nombres para el mail y, de paso, los mails de las profesionales
    // asignadas (destinatarias del aviso, sólo activas y con email).
    let staffRows: { id: string; full_name: string | null; email: string | null; active: boolean }[] = []
    if (staffIds.length) {
      const { data } = await supabase
        .from("staff")
        .select("id, full_name, email, active")
        .in("id", staffIds)
      staffRows = (data ?? []) as typeof staffRows
    }
    const nameById = new Map(staffRows.map((s) => [s.id, s.full_name]))

    const { data: adminRows } = await supabase
      .from("staff")
      .select("email")
      .in("role", ["admin", "reception"])
      .eq("active", true)
      .not("email", "is", null)

    const profRows = staffRows.filter((s) => s.active && s.email).map((s) => ({ email: s.email }))

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
