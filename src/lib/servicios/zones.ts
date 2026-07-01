export type Zone = { id: string; name: string; durationMin: number }
export type ZoneSnapshot = { name: string; duration_min: number }
export type ZonePricing = { priceCents: number; durationMin: number; zones: ZoneSnapshot[] }

/** Precio (cantidad × precio-por-zona) y duración (suma) de las zonas elegidas. */
export function computeZonePricing(
  selectedZones: Zone[],
  pricePerZoneCents: number
): ZonePricing {
  return {
    priceCents: selectedZones.length * pricePerZoneCents,
    durationMin: selectedZones.reduce((a, z) => a + z.durationMin, 0),
    zones: selectedZones.map((z) => ({ name: z.name, duration_min: z.durationMin })),
  }
}

/**
 * Resuelve los IDs elegidos contra las zonas disponibles del servicio.
 * Devuelve null si la selección está vacía o algún ID no pertenece al servicio.
 */
export function resolveSelectedZones(zoneIds: string[], available: Zone[]): Zone[] | null {
  if (zoneIds.length === 0) return null
  const byId = new Map(available.map((z) => [z.id, z]))
  const resolved: Zone[] = []
  for (const id of zoneIds) {
    const z = byId.get(id)
    if (!z) return null
    resolved.push(z)
  }
  return resolved
}
