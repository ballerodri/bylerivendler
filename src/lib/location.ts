// Datos del local. Centralizado acá para mantener un solo lugar
// donde actualizar la dirección.

export const ADDRESS_LINE = "Sanguinetti 297"
export const ADDRESS_AREA = "Villa Morra · Pilar · Buenos Aires"
export const ADDRESS_FULL = `${ADDRESS_LINE} · ${ADDRESS_AREA}`

/**
 * Link a la FICHA del local en Google Maps (la compartió la usuaria desde la
 * app). Antes se armaba una búsqueda por dirección, que podía caer en un punto
 * aproximado: este link va derecho al negocio ("By Leri Vendler, Sanguinetti
 * 297, B1629 Pilar"). En mobile abre la app, en desktop maps.google.com.
 *
 * Lo usan la portada, la reserva, la confirmación y los mails: cambiarlo acá
 * los actualiza a todos.
 */
export const MAPS_LINK = "https://maps.app.goo.gl/JgGiezLnsxcHMy3z5"
