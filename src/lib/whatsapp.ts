// WhatsApp del negocio. Centralizado acá para mantener un solo lugar
// donde actualizar el número.

export const WHATSAPP_DISPLAY = "11 3364-3359"
export const WHATSAPP_E164 = "5491133643359" // sin + ni espacios

/**
 * Genera un link wa.me que abre el chat de WhatsApp con un mensaje
 * pre-cargado. Funciona en mobile (abre la app) y desktop (abre web.whatsapp).
 */
export function whatsappLink(message?: string): string {
  if (!message) return `https://wa.me/${WHATSAPP_E164}`
  return `https://wa.me/${WHATSAPP_E164}?text=${encodeURIComponent(message)}`
}
