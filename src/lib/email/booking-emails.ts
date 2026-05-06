import "server-only"
import { Resend } from "resend"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM = "By Leri Vendler <turnos@bylerivendler.com>"
const SITE = "https://bylerivendler.com"
const ADDRESS = "Sanguinetti 297 · Pilar, Buenos Aires"
const WHATSAPP = "+54 9 11 3364-3359"

export type BookingEmailData = {
  to: string
  firstName: string
  servicesNames: string[]
  startsAt: Date
  durationMin: number
  totalCents: number
  appointmentId: string
}

function fmtDateAR(d: Date): string {
  return d.toLocaleString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function fmtPrice(cents: number): string {
  return "$" + (cents / 100).toLocaleString("es-AR")
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f2ede6;font-family:Georgia,serif;color:#2b2623;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <img src="${SITE}/assets/logo-oauth.png" alt="By Leri Vendler" style="height:80px;width:auto;display:inline-block;">
    </div>
    ${body}
    <hr style="border:none;border-top:1px solid rgba(43,38,35,0.1);margin:32px 0;">
    <p style="font-size:11px;color:#7a6e64;line-height:1.5;text-align:center;margin:0;">
      Si necesitás algo más, escribinos por WhatsApp al <strong>${WHATSAPP}</strong>.<br>
      © By Leri Vendler · Pilar, Buenos Aires
    </p>
  </div>
</body>
</html>`
}

export async function sendBookingConfirmation(
  data: BookingEmailData
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const formattedDate = fmtDateAR(data.startsAt)
  const subject = `Tu turno está confirmado · ${formattedDate}`

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Reserva confirmada</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;">
      Te <em style="color:#b68a5f;">esperamos</em>, ${data.firstName}.
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 24px;">
      Tu turno quedó confirmado. Acá están los detalles:
    </p>
    <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:24px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Cuándo</p>
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 16px;">${formattedDate}</p>

      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Tratamiento${data.servicesNames.length > 1 ? "s" : ""}</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0 0 4px;">
        ${data.servicesNames.map((n) => escape(n)).join("<br>")}
      </p>
      <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">
        ${data.durationMin} min · ${fmtPrice(data.totalCents)}
      </p>

      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Dónde</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0;">
        By Leri Vendler<br>
        <span style="font-size:13px;color:#7a6e64;font-family:Helvetica,Arial,sans-serif;">${ADDRESS}</span>
      </p>
    </div>

    <div style="background:#eae2d7;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#b68a5f;margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;">Recordá</p>
      <p style="font-size:13px;line-height:1.5;color:#4a423d;margin:0;font-family:Helvetica,Arial,sans-serif;">
        Podés <strong>reprogramar o cancelar sin cargo</strong> hasta 24 horas antes de tu turno desde tu portal.
      </p>
    </div>

    <div style="text-align:center;margin-bottom:24px;">
      <a href="${SITE}/portal" style="display:inline-block;background:#2b2623;color:#f2ede6;padding:14px 28px;border-radius:999px;text-decoration:none;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;font-family:Helvetica,Arial,sans-serif;">
        Ver mis turnos
      </a>
    </div>
  `

  try {
    await resend.emails.send({
      from: FROM,
      to: data.to,
      subject,
      html: shell(subject, body),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function sendBookingCancellation(
  data: BookingEmailData
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const formattedDate = fmtDateAR(data.startsAt)
  const subject = `Tu turno fue cancelado · ${formattedDate}`

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Turno cancelado</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;">
      Listo, ${data.firstName}.
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 24px;">
      Cancelamos tu turno del <strong>${formattedDate}</strong>. Si querés reprogramarlo, podés reservar uno nuevo cuando gustes.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${SITE}/reserva" style="display:inline-block;background:#2b2623;color:#f2ede6;padding:14px 28px;border-radius:999px;text-decoration:none;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;font-family:Helvetica,Arial,sans-serif;">
        Reservar otro turno
      </a>
    </div>
  `

  try {
    await resend.emails.send({
      from: FROM,
      to: data.to,
      subject,
      html: shell(subject, body),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Minimal HTML escape for user-provided strings inside email content.
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
