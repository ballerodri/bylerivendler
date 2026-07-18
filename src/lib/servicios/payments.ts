/**
 * Reglas de pago. Lógica PURA (sin servidor) para poder testearla y usar la
 * MISMA regla en la pantalla y en el servidor.
 *
 * OJO: en esta app NO hay pasarela de pago. La clienta transfiere por fuera y
 * manda el comprobante por WhatsApp. Estas funciones sólo definen CUÁNTO se le
 * pide pagar ahora, y cuánto se cobró.
 */

/** Porcentaje de la seña. */
export const DEPOSIT_PCT = 0.3

/** Qué eligió pagar ahora la clienta. */
export type PayChoice = "deposit" | "full"

/**
 * Cuánto tiene que pagar AHORA (va a `appointments.deposit_cents`).
 *  - "deposit" → la seña (30%); el resto lo abona en el local.
 *  - "full"    → el total; no debe nada al llegar.
 */
export function amountDueNow(totalCents: number, choice: PayChoice): number {
  if (totalCents <= 0) return 0
  return choice === "full" ? totalCents : Math.round(totalCents * DEPOSIT_PCT)
}

export type PaymentSummary = {
  paidCents: number
  totalCents: number
  /** Lo que falta cobrar (nunca negativo). */
  pendingCents: number
  isPaidInFull: boolean
  isUnpaid: boolean
}

/** Estado de cobro de un turno, para mostrarlo en el admin. */
export function paymentSummary(paidCents: number, totalCents: number): PaymentSummary {
  const paid = Math.max(0, paidCents)
  const total = Math.max(0, totalCents)
  return {
    paidCents: paid,
    totalCents: total,
    pendingCents: Math.max(0, total - paid),
    isPaidInFull: total > 0 && paid >= total,
    isUnpaid: paid === 0,
  }
}

/** Valida un cobro que el salón quiere registrar. */
export function validatePayment(
  paidCents: number,
  totalCents: number
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(paidCents))
    return { ok: false, error: "El monto tiene que ser un número entero." }
  if (paidCents < 0) return { ok: false, error: "El monto no puede ser negativo." }
  if (paidCents > totalCents)
    return { ok: false, error: "No podés registrar más de lo que vale el turno." }
  return { ok: true }
}

/** Un turno al que se le puede aplicar plata (lo mínimo que hace falta). */
export type PayableAppt = { id: string; totalCents: number; paidCents: number }

/**
 * Reparte UN cobro entre los turnos de una compra, EN EL ORDEN RECIBIDO
 * (cronológico): llena cada turno hasta su total antes de pasar al siguiente.
 *
 * Existe porque el salón cobra por compra ("me pagó $50.000") pero la plata se
 * guarda por turno (cada turno factura lo suyo). Es PURO para poder testear la
 * cuenta: es la única parte de este camino donde un error se traduce en que
 * los registros digan que la clienta pagó de más o de menos.
 *
 * - Un turno ya saldado (o de $0, como las sesiones 2..N de un pack) se saltea.
 * - `ok: false` si el monto no entra en lo que falta cobrar: NO se reparte
 *   nada a medias, el llamador decide.
 * - Cuando devuelve `ok`, la suma de los `sumaCents` es EXACTAMENTE el monto.
 */
export function distributePayment(
  appts: PayableAppt[],
  montoCents: number
):
  | { ok: true; aplicaciones: { id: string; deCents: number; aCents: number }[] }
  | { ok: false; error: string; faltaCents: number } {
  if (!Number.isInteger(montoCents) || montoCents <= 0)
    return { ok: false, error: "El monto tiene que ser un número entero mayor a 0.", faltaCents: 0 }

  const falta = appts.reduce((a, r) => a + Math.max(0, r.totalCents - r.paidCents), 0)
  if (montoCents > falta)
    return { ok: false, error: "El monto supera lo que falta cobrar de esta compra.", faltaCents: falta }

  const aplicaciones: { id: string; deCents: number; aCents: number }[] = []
  let resto = montoCents
  for (const r of appts) {
    if (resto <= 0) break
    const suma = Math.min(resto, Math.max(0, r.totalCents - r.paidCents))
    if (suma <= 0) continue
    aplicaciones.push({ id: r.id, deCents: r.paidCents, aCents: r.paidCents + suma })
    resto -= suma
  }
  return { ok: true, aplicaciones }
}
