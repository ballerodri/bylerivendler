import "server-only"
import { Resend } from "resend"
import { WHATSAPP_DISPLAY, whatsappLink } from "@/lib/whatsapp"
import { ADDRESS_FULL, MAPS_LINK } from "@/lib/location"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM = "By Leri Vendler <turnos@bylerivendler.com>"
const SITE = "https://bylerivendler.com"

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
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
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
      Si necesitás algo más, escribinos por
      <a href="${whatsappLink()}" style="color:#7a6e64;">WhatsApp</a>
      al <strong>${WHATSAPP_DISPLAY}</strong>.<br>
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
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 6px;">${formattedDate}</p>
      ${calChip(gcalLink(data))}
      <div style="height:16px;"></div>

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
        <a href="${MAPS_LINK}" style="font-size:13px;color:#b68a5f;font-family:Helvetica,Arial,sans-serif;text-decoration:underline;">${ADDRESS_FULL}</a>
      </p>
    </div>

    <div style="background:#eae2d7;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#b68a5f;margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;">Recordá</p>
      <p style="font-size:13px;line-height:1.5;color:#4a423d;margin:0;font-family:Helvetica,Arial,sans-serif;">
        Podés <strong>reprogramar o cancelar sin cargo</strong> hasta 24 horas antes de tu turno desde tu portal.
      </p>
    </div>

    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
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

/** Aviso al equipo (admins) cuando una clienta reserva por la web. */
export async function sendNewBookingAlert(data: {
  to: string[]
  clientName: string
  clientPhone?: string | null
  servicesNames: string[]
  startsAt: Date
  durationMin: number
  totalCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }
  const to = data.to.filter(Boolean)
  if (!to.length) return { ok: false, error: "Sin destinatarios" }

  const formattedDate = fmtDateAR(data.startsAt)
  const subject = `Nueva reserva · ${data.clientName} · ${formattedDate}`
  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Nueva reserva</p>
    <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:400;line-height:1.15;margin:0 0 16px;">
      Reservó <em style="color:#b68a5f;">${escape(data.clientName)}</em>
    </h1>
    <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:24px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Cuándo</p>
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 16px;">${formattedDate}</p>
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Tratamiento${data.servicesNames.length > 1 ? "s" : ""}</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0 0 4px;">${data.servicesNames.map((n) => escape(n)).join("<br>")}</p>
      <p style="font-size:13px;color:#7a6e64;margin:0 0 ${data.clientPhone ? "16px" : "0"};">${data.durationMin} min · ${fmtPrice(data.totalCents)}</p>
      ${data.clientPhone ? `<p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Contacto</p><p style="font-family:Georgia,serif;font-size:15px;margin:0;">${escape(data.clientPhone)}</p>` : ""}
    </div>
    ${ctaButtons(SITE + "/admin/turnos", "Ver en la agenda")}
  `
  try {
    await resend.emails.send({ from: FROM, to, subject, html: shell(subject, body) })
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

export async function sendBookingReminder(
  data: BookingEmailData
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const formattedDate = fmtDateAR(data.startsAt)
  const subject = `Te esperamos mañana · ${formattedDate}`

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Recordatorio de turno</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;">
      Te <em style="color:#b68a5f;">esperamos</em> mañana, ${escape(data.firstName)}.
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 24px;">
      Este es un recordatorio de tu turno de mañana:
    </p>
    <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:24px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Cuándo</p>
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 6px;">${formattedDate}</p>
      ${calChip(gcalLink(data))}
      <div style="height:16px;"></div>

      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Tratamiento${data.servicesNames.length > 1 ? "s" : ""}</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0 0 4px;">
        ${data.servicesNames.map((n) => escape(n)).join("<br>")}
      </p>
      <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">
        ${data.durationMin} min
      </p>

      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Dónde</p>
      <p style="font-family:Georgia,serif;font-size:15px;margin:0;">
        By Leri Vendler<br>
        <a href="${MAPS_LINK}" style="font-size:13px;color:#b68a5f;font-family:Helvetica,Arial,sans-serif;text-decoration:underline;">${ADDRESS_FULL}</a>
      </p>
    </div>

    <div style="background:#eae2d7;border-radius:10px;padding:16px;margin-bottom:24px;">
      <p style="font-size:13px;line-height:1.5;color:#4a423d;margin:0;font-family:Helvetica,Arial,sans-serif;">
        Si necesitás cancelar o reprogramar, escribinos por <a href="${whatsappLink()}" style="color:#b68a5f;">WhatsApp</a> con al menos 24 hs de anticipación.
      </p>
    </div>

    ${ctaButtons(MAPS_LINK, "Ver cómo llegar")}
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

export async function sendBookingReschedule(
  data: BookingEmailData
): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const formattedDate = fmtDateAR(data.startsAt)
  const subject = `Tu turno fue reprogramado · ${formattedDate}`

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Turno reprogramado</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.1;letter-spacing:-0.01em;margin:0 0 16px;">
      Listo, ${escape(data.firstName)}.
    </h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 24px;">
      Reprogramamos tu turno. Tu nueva fecha quedó confirmada:
    </p>
    <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:24px;margin-bottom:24px;">
      <p style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6e64;margin:0 0 4px;">Nueva fecha</p>
      <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 6px;">${formattedDate}</p>
      ${calChip(gcalLink(data))}
      <div style="height:16px;"></div>

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
        <a href="${MAPS_LINK}" style="font-size:13px;color:#b68a5f;font-family:Helvetica,Arial,sans-serif;text-decoration:underline;">${ADDRESS_FULL}</a>
      </p>
    </div>

    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
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

function ctaButtons(primaryHref: string, primaryLabel: string): string {
  return `
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${primaryHref}" style="display:inline-block;background:#2b2623;color:#f2ede6;padding:14px 32px;border-radius:999px;text-decoration:none;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;font-family:Helvetica,Arial,sans-serif;">
        ${primaryLabel}
      </a>
    </div>
  `
}

function calChip(calHref: string): string {
  return `
    <a href="${calHref}" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:6px 12px;border:1px solid #dadce0;border-radius:999px;text-decoration:none;font-size:12px;color:#3c4043;font-family:Helvetica,Arial,sans-serif;background:#f8f9fa;">
      <img src="https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png" alt="" width="14" height="14" style="display:inline-block;vertical-align:middle;">
      Agregar al calendario
    </a>
  `
}

function gcalLink(data: BookingEmailData): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const endsAt = new Date(data.startsAt.getTime() + data.durationMin * 60_000)
  const text = encodeURIComponent(`Turno en By Leri Vendler — ${data.servicesNames.join(" + ")}`)
  const dates = `${fmt(data.startsAt)}/${fmt(endsAt)}`
  const location = encodeURIComponent("Sanguinetti 297, Villa Morra, Pilar, Buenos Aires")
  const details = encodeURIComponent(`Tratamiento: ${data.servicesNames.join(" + ")}\nDuración: ${data.durationMin} min`)
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&location=${location}&details=${details}`
}

// Minimal HTML escape for user-provided strings inside email content.
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export async function sendPackConfirmation(data: {
  to: string
  firstName: string
  packName: string
  sessionsTotal: number
  startsAtList: Date[]
  totalCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const subject = `Tu pack está reservado · ${data.packName}`
  const missing = data.sessionsTotal - data.startsAtList.length

  const rows = data.startsAtList
    .map(
      (d, i) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">Sesión ${i + 1}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(d))}</td></tr>`
    )
    .join("")

  const missingNote =
    missing > 0
      ? `<p style="font-size:13px;color:#7a6e64;">Te quedan <strong>${missing}</strong> sesión(es) por agendar. Coordinamos con vos para fijarlas.</p>`
      : ""

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Pack reservado</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;">${escape(data.packName)}</h1>
    <p style="font-size:14px;margin:0 0 16px;">Hola ${escape(data.firstName)}, reservamos tu pack de ${data.sessionsTotal} sesiones.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
    ${missingNote}
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Total del pack: <strong>${fmtPrice(data.totalCents)}</strong></p>
    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
  `

  try {
    await resend.emails.send({ from: FROM, to: data.to, subject, html: shell(subject, body) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al enviar" }
  }
}

/**
 * Confirmación de una reserva con VARIOS turnos, cada uno en su fecha.
 *
 * Es UN solo mail con UNA sola seña **a propósito**: mandar uno por turno le
 * haría creer a la clienta que debe una seña por cada servicio, que es justo el
 * problema que este modo viene a resolver.
 */
export async function sendMultiBookingConfirmation(data: {
  to: string
  firstName: string
  /** Un ítem por turno: qué servicio y cuándo. */
  items: { serviceName: string; startsAt: Date }[]
  /** La suma de lo que valen los turnos. */
  totalCents: number
  /**
   * Lo que tiene que transferir AHORA, UNA sola vez: la suma de las señas de
   * cada turno (o la suma de los totales, si eligió pagar todo).
   */
  dueNowCents: number
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const subject = `Tus turnos están reservados (${data.items.length})`

  const rows = data.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 0;color:#7a6e64;font-size:13px;">${escape(it.serviceName)}</td>` +
        `<td style="padding:6px 0;text-align:right;font-size:13px;">${escape(fmtDateAR(it.startsAt))}</td></tr>`
    )
    .join("")

  // Si canjeó con puntos, `dueNowCents` llega en 0: no hay nada que
  // transferir ni comprobante que mandar, y el turno ya está confirmado
  // (no "te lo confirmamos" cuando ya lo está).
  const transferBlock =
    data.dueNowCents > 0
      ? `
    <p style="font-size:14px;margin:0 0 16px;">A transferir ahora: <strong>${fmtPrice(data.dueNowCents)}</strong></p>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Es <strong>una sola transferencia</strong> por los ${data.items.length} turnos. Mandanos el comprobante por WhatsApp y te los confirmamos.</p>
    `
      : `
    <p style="font-size:13px;color:#7a6e64;margin:0 0 16px;">Tus turnos ya están <strong>confirmados</strong>: los pagaste con tus puntos del Programa Cerca, no debés nada.</p>
    `

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Reserva confirmada</p>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 16px;">Tus turnos</h1>
    <p style="font-size:14px;margin:0 0 16px;">Hola ${escape(data.firstName)}, reservamos tus ${data.items.length} turnos.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${rows}</table>
    <p style="font-size:13px;color:#7a6e64;margin:0 0 4px;">Total: <strong>${fmtPrice(data.totalCents)}</strong></p>
    ${transferBlock}
    ${ctaButtons(SITE + "/portal", "Ver mis turnos")}
  `

  try {
    await resend.emails.send({ from: FROM, to: data.to, subject, html: shell(subject, body) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error al enviar" }
  }
}
