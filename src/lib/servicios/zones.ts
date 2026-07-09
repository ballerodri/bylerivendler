export type Zone = { id: string; name: string; durationMin: number; priceCents: number | null }
export type ZoneSnapshot = { name: string; duration_min: number; price_cents: number }
export type ZonePricing = { priceCents: number; durationMin: number; zones: ZoneSnapshot[] }

/**
 * Precio y duración de las zonas elegidas. Cada zona cobra su precio propio
 * (priceCents) o, si no tiene, el precio general del servicio (fallback).
 * El snapshot registra lo efectivamente cobrado por zona.
 */
export function computeZonePricing(
  selectedZones: Zone[],
  fallbackPriceCents: number
): ZonePricing {
  const zones = selectedZones.map((z) => ({
    name: z.name,
    duration_min: z.durationMin,
    price_cents: z.priceCents ?? fallbackPriceCents,
  }))
  return {
    priceCents: zones.reduce((a, z) => a + z.price_cents, 0),
    durationMin: selectedZones.reduce((a, z) => a + z.durationMin, 0),
    zones,
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
