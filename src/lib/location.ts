// Datos del local. Centralizado acá para mantener un solo lugar
// donde actualizar la dirección.

export const ADDRESS_LINE = "Sanguinetti 297"
export const ADDRESS_AREA = "Villa Morra · Pilar · Buenos Aires"
export const ADDRESS_FULL = `${ADDRESS_LINE} · ${ADDRESS_AREA}`

const MAPS_QUERY = encodeURIComponent(
  "Sanguinetti 297 Villa Morra Pilar Buenos Aires"
)

/**
 * Link al buscador de Google Maps para la dirección del local.
 * En mobile abre la app, en desktop abre maps.google.com.
 */
export const MAPS_LINK = `https://www.google.com/maps/search/?api=1&query=${MAPS_QUERY}`
