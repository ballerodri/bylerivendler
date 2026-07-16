/**
 * El ITINERARIO UNIFICADO de una compra: todos los turnos (sesión de pack +
 * tratamientos sueltos) aplanados en filas cronológicas "hora · qué · cuánto
 * dura · con quién", SIN separar el pack de los tratamientos — la usuaria no
 * quiere esa división en lo que ve la clienta. Lo usan la pantalla de éxito,
 * el mail de confirmación y el portal: las tres muestran LO MISMO.
 *
 * PURO (sin base ni HTML) para poder testearlo una vez y confiar en las tres.
 */

import { arPartsFromUtc } from "./pack-sessions"

/** Una pata (servicio) de un turno, como viene de `appointment_services`. */
export type PurchaseLeg = {
  startsAt: string | null
  durationMin: number | null
  serviceName: string | null
  staffName: string | null
}

/** Un turno de la compra, como viene de `appointments`. */
export type PurchaseAppt = {
  id: string
  startsAt: string
  durationMin: number | null
  packPurchaseId: string | null
  legs: PurchaseLeg[]
}

/** Una fila del itinerario, lista para dibujar. */
export type ItineraryRow = {
  /** El turno del que salió (para "cancelar" o estados por turno). */
  apptId: string
  ms: number
  /** "HH:MM" en hora argentina. */
  hm: string
  /** "YYYY-MM-DD" en hora argentina (para agrupar por día). */
  dateStr: string
  label: string
  durationMin: number | null
  staffName: string | null
}

/**
 * Aplana los turnos en filas cronológicas:
 * - Sesión de pack → UNA fila "Sesión i · {pack}" (numerada por fecha entre
 *   las sesiones de la compra).
 * - Turno "juntos" con 2+ patas con hora propia → una fila POR PATA con su
 *   hora real (la grilla puede dejar huecos: 10:20 · 12:00 · 13:00, una sola
 *   hora engaña).
 * - Turno de un servicio → una fila con la hora del turno.
 * - Patas viejas sin hora (datos pre-bloqueo-real) → una sola fila con los
 *   nombres unidos, a la hora del turno (nunca inventamos horas).
 */
export function buildItinerary(
  appts: PurchaseAppt[],
  packName: string | null
): ItineraryRow[] {
  const sorted = [...appts].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  )

  // Numera las sesiones del pack por fecha (sesión 1 = la más temprana).
  const sessionNumber = new Map<string, number>()
  sorted
    .filter((a) => a.packPurchaseId)
    .forEach((a, i) => sessionNumber.set(a.id, i + 1))

  const rows: ItineraryRow[] = []
  for (const a of sorted) {
    const apptMs = new Date(a.startsAt).getTime()
    const legs = [...a.legs]
      .filter((l) => l.serviceName)
      .sort((x, y) => {
        const tx = x.startsAt ? new Date(x.startsAt).getTime() : apptMs
        const ty = y.startsAt ? new Date(y.startsAt).getTime() : apptMs
        return tx - ty
      })

    const sn = sessionNumber.get(a.id)
    if (sn) {
      rows.push(
        row(a.id, apptMs, `Sesión ${sn} · ${packName ?? "Pack"}`, legs[0]?.durationMin ?? a.durationMin, legs[0]?.staffName ?? null)
      )
      continue
    }

    if (legs.length > 1 && legs.every((l) => l.startsAt)) {
      for (const l of legs) {
        rows.push(
          row(a.id, new Date(l.startsAt!).getTime(), l.serviceName!, l.durationMin, l.staffName)
        )
      }
      continue
    }

    if (legs.length > 1) {
      rows.push(
        row(a.id, apptMs, legs.map((l) => l.serviceName).join(" + "), a.durationMin, null)
      )
      continue
    }

    const l = legs[0]
    rows.push(
      row(a.id, apptMs, l?.serviceName ?? "Tu tratamiento", l?.durationMin ?? a.durationMin, l?.staffName ?? null)
    )
  }

  return rows.sort((x, y) => x.ms - y.ms)
}

function row(
  apptId: string,
  ms: number,
  label: string,
  durationMin: number | null,
  staffName: string | null
): ItineraryRow {
  const parts = arPartsFromUtc(new Date(ms))
  return { apptId, ms, hm: parts.timeStr, dateStr: parts.dateStr, label, durationMin, staffName }
}

/** ¿La compra cruza más de un día? (para prefijar el día en cada fila) */
export function spansMultipleDays(rows: ItineraryRow[]): boolean {
  return new Set(rows.map((r) => r.dateStr)).size > 1
}
