import { amountDueNow, type PayChoice } from "./payments"

/**
 * Reglas del modo "separados": varios servicios, cada uno con SU fecha, cada
 * uno en SU turno, con UNA sola seña. Lógica PURA (sin servidor) para poder
 * testearla y usar la MISMA regla en la pantalla y en el servidor.
 */

/** Un servicio con la fecha que la clienta le eligió. */
export type SlotItem = {
  serviceId: string
  name: string
  /** Comienzo del turno, en ms UTC. */
  startsAtMs: number
  durationMin: number
  priceCents: number
}

/**
 * La seña de CADA turno, calculada sobre el precio de SU propio servicio.
 * La plata no se mueve entre turnos: cada uno es autosuficiente.
 */
export function separateDeposits(priceCentsList: number[], choice: PayChoice): number[] {
  return priceCentsList.map((p) => amountDueNow(p, choice))
}

/**
 * El importe ÚNICO que se le pide transferir: la SUMA de las señas de cada
 * turno.
 *
 * ⚠️ NO es `amountDueNow(suma de los precios)`. Cada turno redondea su propia
 * seña, y la suma de los redondeos puede diferir del redondeo de la suma. Lo
 * que la clienta transfiere tiene que ser exactamente lo que suman los
 * `deposit_cents` que quedan guardados.
 */
export function totalDueNowSeparate(priceCentsList: number[], choice: PayChoice): number {
  return separateDeposits(priceCentsList, choice).reduce((a, d) => a + d, 0)
}

/**
 * Valida las fechas elegidas: todas futuras y **ninguna se superpone con otra**.
 *
 * La no-superposición es obligatoria aunque los turnos sean con profesionales
 * distintas: la clienta es una sola. Los turnos todavía no existen en la base,
 * así que la disponibilidad real no los ve entre sí — hay que chequearlo acá.
 */
export function validateSeparateSlots(
  items: SlotItem[],
  nowMs: number
): { ok: true } | { ok: false; error: string } {
  if (items.length === 0)
    return { ok: false, error: "Elegí fecha y hora para cada servicio." }

  for (const it of items) {
    if (!Number.isFinite(it.startsAtMs))
      return { ok: false, error: `La fecha de ${it.name} no es válida.` }
    if (it.startsAtMs <= nowMs)
      return { ok: false, error: `${it.name} tiene que ser en una fecha futura.` }
  }

  // Se ordena una copia por comienzo: así, al comparar cada turno con el
  // anterior, el mensaje nombra al que la clienta puso DESPUÉS en el tiempo.
  const sorted = [...items].sort((a, b) => a.startsAtMs - b.startsAtMs)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const prevEnd = prev.startsAtMs + prev.durationMin * 60_000
    // Pegados exactamente (prevEnd === cur.startsAtMs) está permitido.
    if (cur.startsAtMs < prevEnd)
      return {
        ok: false,
        error: `${cur.name} se superpone con ${prev.name}. No podés estar en dos servicios a la vez.`,
      }
  }

  return { ok: true }
}
