/**
 * Solapamiento de horarios en la reserva "cada uno en su fecha". PURO (trabaja
 * en milisegundos UTC), para poder testearlo y usar la MISMA regla que la
 * validación final (`validateSeparateSlots`/`crossOverlapCheck`): solapamiento
 * ESTRICTO — pegados (fin == inicio) NO cuentan como pisado.
 */

export type BlockedInterval = { startMs: number; endMs: number; name: string }

/**
 * Si el tramo `[startMs, startMs + durationMin*60000)` se pisa con algún
 * intervalo bloqueado, devuelve el PRIMERO (para poder mostrar su nombre como
 * motivo); si está libre, `null`.
 */
export function overlappingBlock(
  startMs: number,
  durationMin: number,
  blocked: BlockedInterval[]
): BlockedInterval | null {
  const endMs = startMs + durationMin * 60_000
  for (const b of blocked) {
    if (startMs < b.endMs && endMs > b.startMs) return b
  }
  return null
}
