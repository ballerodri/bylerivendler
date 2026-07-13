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
