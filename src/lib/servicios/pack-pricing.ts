/**
 * Precio "por separado" de referencia de un pack, para mostrar el ahorro.
 * Servicio fijo → unitPrice × sessions. Servicio por zona → unitPrice (precio
 * por zona) × zonesCount × sessions. zonesCount null/0 se trata como fijo.
 */
export function packReferenceCents(
  unitPriceCents: number,
  sessions: number,
  zonesCount: number | null
): number {
  const zones = zonesCount && zonesCount > 0 ? zonesCount : 1
  return unitPriceCents * zones * sessions
}
