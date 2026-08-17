import type { ServiceOption } from "./combo-form"

// Mapeo compartido por las páginas de alta y edición del programa: de la fila
// de `services` (con sus zonas) a la `ServiceOption` que consume el formulario.

export type DbZone = { id: string; name: string; duration_min: number; price_cents: number | null; active: boolean; order_index: number }
export type DbService = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  pricing_mode: "fixed" | "per_zone"
  zone_selection: "multiple" | "single" | null
  category: { name: string } | null
  service_zones: DbZone[]
}

/** Columnas a traer de `services` para armar un programa (incluye las zonas). */
export const SERVICE_SELECT =
  "id, name, duration_min, price_cents, pricing_mode, zone_selection, category:service_categories(name), service_zones(id, name, duration_min, price_cents, active, order_index)"

export function mapDbServiceToOption(s: DbService): ServiceOption {
  return {
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
    pricing_mode: s.pricing_mode,
    zone_selection: s.zone_selection ?? "multiple",
    zones: (s.service_zones ?? [])
      .filter((z) => z.active)
      .sort((a, b) => a.order_index - b.order_index)
      .map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents })),
  }
}
