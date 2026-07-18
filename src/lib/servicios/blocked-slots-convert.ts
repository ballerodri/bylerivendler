/**
 * Conversión de las horas bloqueadas del personal cuando cambia el PASO de la
 * grilla de un día (ej. de 1 hora a 30 min).
 *
 * Cada fila de `staff_blocked_slots` significa "esta profesional NO está
 * disponible durante UN PASO desde ese horario". El paso no está guardado en la
 * fila: sale de la grilla del día (`business_hours.slots`). Por eso, si la
 * grilla cambia de paso, las filas viejas pasan a significar otra cosa y hay
 * que reacomodarlas EN LA MISMA OPERACIÓN, o la disponibilidad miente.
 *
 * PURO: sin base ni fecha real, para poder testearlo. Es la pieza más delicada
 * de todo el cambio (si se equivoca, alguien figura libre cuando no lo está).
 */

import { gridStepMin } from "./grid-step"

export type BlockedSlotRow = { staff_id: string; slot: string }

export type ConvertBlockedResult = {
  /** Las filas que reemplazan a las viejas: ordenadas y sin repetidos. */
  rows: BlockedSlotRow[]
  /** Cuántas filas viejas no cayeron en NINGÚN horario de la grilla nueva. */
  dropped: number
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  const n = h * 60 + m
  return Number.isFinite(n) ? n : NaN
}

function toHhmm(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/**
 * ¿Hay que convertir los bloqueos de este día?
 *
 * Sólo si el paso cambió Y la grilla nueva tiene un paso deducible de verdad
 * (2 horarios o más). Con 0 o 1 horario `gridStepMin` devuelve 60 por defecto,
 * y ese 60 es una suposición, no un cambio real: si tomáramos ese caso como
 * "cambió el paso" borraríamos los bloqueos de un día que se cierra por un rato
 * (y al reabrirlo la profesional quedaría disponible en horas que no lo está).
 */
export function needsBlockedConversion(oldSlots: string[], newSlots: string[]): boolean {
  if (newSlots.length < 2) return false
  return gridStepMin(oldSlots) !== gridStepMin(newSlots)
}

/**
 * Reacomoda las filas bloqueadas de UN día a la grilla nueva.
 *
 * La regla, una sola para las dos direcciones: la fila vieja tapaba el tramo
 * `[base, base + pasoViejo)`. Se bloquea TODO horario de la grilla nueva cuyo
 * propio tramo `[nuevo, nuevo + pasoNuevo)` se pise con ese tramo viejo.
 *
 * De ahí salen solas las dos direcciones que pide el diseño:
 *  - MÁS FINA (60 → 30): `08:00` tapaba 08:00–09:00 → quedan `08:00` y `08:30`.
 *    La cobertura queda EXACTAMENTE igual que antes.
 *  - MÁS GRUESA (30 → 60): `08:30` tapaba 08:30–09:00, y el único horario nuevo
 *    que se pisa con eso es `08:00` (que tapa 08:00–09:00) → colapsa a `08:00`.
 *    Bloquea DE MÁS, que es la dirección segura: nadie queda "libre" sin estarlo.
 *
 * Una fila que no se pisa con ningún horario nuevo se descarta (y se cuenta):
 * es una hora que la grilla nueva ya no ofrece, así que no hay nada que
 * bloquear ahí. Ante cualquier duda la regla bloquea, nunca afloja.
 */
export function convertBlockedSlots(
  oldSlots: string[],
  newSlots: string[],
  rows: BlockedSlotRow[]
): ConvertBlockedResult {
  const oldStep = gridStepMin(oldSlots)
  const newStep = gridStepMin(newSlots)

  const newMins = [...new Set(newSlots.map(toMin).filter((n) => Number.isFinite(n)))].sort(
    (a, b) => a - b
  )

  // Sin grilla nueva no hay dónde bloquear: no tocamos nada (mejor dejar las
  // filas como están que perderlas).
  if (newMins.length === 0) return { rows, dropped: 0 }

  // staff_id → horarios nuevos bloqueados (Set: la tabla tiene único
  // (staff_id, day_of_week, slot), así que no puede haber repetidos).
  const byStaff = new Map<string, Set<number>>()
  let dropped = 0

  for (const r of rows) {
    const base = toMin(r.slot)
    if (!Number.isFinite(base)) {
      dropped++
      continue
    }
    const oldEnd = base + oldStep
    const hits = newMins.filter((m) => m < oldEnd && m + newStep > base)
    if (hits.length === 0) {
      dropped++
      continue
    }
    let set = byStaff.get(r.staff_id)
    if (!set) {
      set = new Set<number>()
      byStaff.set(r.staff_id, set)
    }
    for (const m of hits) set.add(m)
  }

  const out: BlockedSlotRow[] = []
  for (const [staffId, set] of byStaff) {
    for (const m of [...set].sort((a, b) => a - b)) {
      out.push({ staff_id: staffId, slot: toHhmm(m) })
    }
  }
  return { rows: out, dropped }
}
