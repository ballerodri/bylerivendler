/**
 * Elige UNA profesional entre las que pueden tomar un horario.
 *
 * `candidates` ya viene de `assignableStaff` (la MISMA función que decide la
 * disponibilidad): son las que hacen el servicio, están activas, trabajan a esa
 * hora y no tienen un turno encima. Acá sólo se desempata.
 *
 * Reglas:
 *  1. Si la `preferredStaffId` (la que ya se eligió en una sesión anterior de
 *     este mismo pack) sigue entre las candidatas, se la mantiene — continuidad,
 *     sin forzarla: si ya no está disponible, se cae al desempate normal.
 *  2. Desempate: la que tenga MENOS turnos ese día (reparte la carga). Si aún
 *     hay empate, la primera de la lista (determinista).
 *
 * Lógica PURA (sin servidor) para poder testearla.
 */
export function chooseStaff(
  candidates: string[],
  countsByStaff: Record<string, number>,
  preferredStaffId?: string | null
): string | null {
  if (candidates.length === 0) return null

  // Continuidad: la preferida gana si sigue disponible.
  if (preferredStaffId && candidates.includes(preferredStaffId)) return preferredStaffId

  // Desempate por menos turnos ese día. `reduce` conserva la PRIMERA ante un
  // empate, así que el resultado es determinista respecto del orden de entrada.
  return candidates.reduce((best, pid) =>
    (countsByStaff[pid] ?? 0) < (countsByStaff[best] ?? 0) ? pid : best
  )
}
