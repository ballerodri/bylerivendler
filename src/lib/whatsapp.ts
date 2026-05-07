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

/**
 * Normaliza un número de teléfono argentino a formato E.164.
 * Ej: "1133643359" → "+5491133643359"
 *     "011 3364 3359" → "+5491133643359"
 *     "+54 9 11 3364-3359" → "+5491133643359"
 */
export function normalizeArPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.startsWith("549")) return `+${digits}`
  if (digits.startsWith("54")) return `+54${digits.slice(2)}`
  if (digits.startsWith("011")) return `+549${digits.slice(3)}`
  if (digits.startsWith("0")) return `+549${digits.slice(1)}`
  if (digits.length >= 8 && digits.length <= 10) return `+549${digits}`
  return null
}

/**
 * Envía un mensaje de WhatsApp vía Twilio.
 * Requiere las variables de entorno:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM  (ej: "whatsapp:+14155238886" para el sandbox,
 *                          o el número aprobado de producción)
 *
 * Para usar el sandbox de Twilio primero la clienta debe mandar "join <keyword>"
 * al número sandbox. En producción se necesitan templates aprobados por Meta.
 */
export async function sendWhatsAppMessage(
  toPhone: string,
  body: string
): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_FROM

  if (!sid || !token || !from) return { ok: false, error: "Twilio no configurado" }

  const toNorm = normalizeArPhone(toPhone)
  if (!toNorm) return { ok: false, error: `Teléfono inválido: ${toPhone}` }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const body64 = Buffer.from(`${sid}:${token}`).toString("base64")

  const params = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: `whatsapp:${toNorm}`,
    Body: body,
  })

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${body64}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: text.slice(0, 200) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
