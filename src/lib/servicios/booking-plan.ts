/**
 * El "plan" de una reserva: los turnos que se van a crear, ANTES de crearlos.
 *
 * Existe para que los tres caminos (el pack, los servicios "juntos" y los
 * servicios "separados") puedan CONVIVIR en una misma compra: cada uno arma su
 * parte del plan, se valida TODO junto (sobre todo que no se pisen entre sí), y
 * recién entonces un solo escritor lo crea, todo o nada.
 *
 * Lógica PURA (sin servidor) para poder testearla.
 */

/** Un servicio dentro de un turno. Un turno "juntos" tiene varios; el resto, uno. */
export type PlannedLeg = {
  serviceId: string
  name: string
  durationMin: number
  priceCents: number
  /** Snapshot de zonas (servicios per_zone). `null` si no aplica. */
  zones: unknown | null
  staffId: string | null
  startsAtMs: number
}

/** Un turno a crear. */
export type PlannedAppointment = {
  /** Cómo nombrarlo en los mensajes de error ("Sesión 2 del pack", "Limpieza facial"). */
  label: string
  startsAtMs: number
  durationMin: number
  staffId: string | null
  /** Lo que vale el turno. La sesión 1 del pack lleva el precio DEL PACK; las 2..N, 0. */
  totalCents: number
  /** Lo que hay que pagar AHORA por este turno. La seña total es la SUMA de estos. */
  depositCents: number
  depositPaid: boolean
  notesInternal: string | null
  isPackSession: boolean
  legs: PlannedLeg[]
}

/**
 * Ningún turno puede pisar a otro — **incluidas las sesiones del pack contra los
 * servicios sueltos**. La clienta es una sola y no puede estar en dos lugares a
 * la vez, aunque los atiendan profesionales distintas.
 *
 * Los turnos de este pedido todavía NO están en la base, así que la
 * disponibilidad real no los ve entre sí: hay que chequearlo acá.
 *
 * Pegados exactamente (uno termina cuando empieza el otro) está PERMITIDO.
 */
export function crossOverlapCheck(
  planned: PlannedAppointment[]
): { ok: true } | { ok: false; error: string } {
  for (const p of planned) {
    if (!Number.isFinite(p.startsAtMs))
      return { ok: false, error: `La fecha de ${p.label} no es válida.` }
  }

  // Se ordena una COPIA por comienzo: comparando cada turno con el anterior, el
  // mensaje nombra al que la clienta puso DESPUÉS en el tiempo.
  const sorted = [...planned].sort((a, b) => a.startsAtMs - b.startsAtMs)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const prevEnd = prev.startsAtMs + prev.durationMin * 60_000
    if (cur.startsAtMs < prevEnd)
      return {
        ok: false,
        error: `${cur.label} se superpone con ${prev.label}. No podés estar en dos lugares a la vez.`,
      }
  }

  return { ok: true }
}

/** El importe ÚNICO a transferir: la SUMA de las señas de cada turno. */
export function sumDeposits(planned: PlannedAppointment[]): number {
  return planned.reduce((a, p) => a + p.depositCents, 0)
}

/** Lo que vale la compra entera. */
export function sumTotals(planned: PlannedAppointment[]): number {
  return planned.reduce((a, p) => a + p.totalCents, 0)
}
