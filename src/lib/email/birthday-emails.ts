import "server-only"
import { Resend } from "resend"
import { FROM, SITE, shell, escape } from "./booking-emails"
import { clientWhatsappLink } from "@/lib/whatsapp"
import type { CumpleDelMes } from "@/lib/servicios/birthdays"

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

/**
 * Aviso diario al equipo (Leri / recepción) con las clientas que cumplen años
 * HOY, para saludarlas por WhatsApp. Un solo mail con todas las del día, con
 * el link de WhatsApp listo (y el saludo pre-cargado) para cada una.
 */
export async function sendBirthdayAlert(data: {
  to: string[]
  cumpleaneras: CumpleDelMes[]
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }
  const to = data.to.filter(Boolean)
  if (!to.length) return { ok: false, error: "Sin destinatarios" }
  if (!data.cumpleaneras.length) return { ok: false, error: "Sin cumpleañeras" }

  const nombres = data.cumpleaneras.map((c) => c.first_name).join(", ")
  const subject =
    data.cumpleaneras.length === 1
      ? `🎂 Hoy cumple años ${data.cumpleaneras[0].first_name} ${data.cumpleaneras[0].last_name}`
      : `🎂 Hoy cumplen años ${nombres}`

  const filas = data.cumpleaneras
    .map((c) => {
      const nombre = `${c.first_name} ${c.last_name}`
      const saludo = `¡Feliz cumpleaños, ${c.first_name}! 🎂 Todo el equipo de By Leri Vendler te desea un día hermoso. ¡Te esperamos para festejarlo con un mimo!`
      const link = c.phone ? clientWhatsappLink(c.phone, saludo) : null
      return `
      <div style="background:#fff;border:1px solid rgba(43,38,35,0.1);border-radius:14px;padding:20px 24px;margin-bottom:12px;">
        <p style="font-family:Georgia,serif;font-size:18px;font-weight:500;margin:0 0 4px;">${escape(nombre)}${c.age !== null ? ` <span style="font-size:14px;color:#7a6e64;font-weight:400;">· cumple ${c.age}</span>` : ""}</p>
        ${
          link
            ? `<a href="${link}" style="display:inline-block;margin-top:8px;background:#b68a5f;color:#fff;text-decoration:none;font-size:13px;padding:10px 18px;border-radius:999px;">Saludarla por WhatsApp →</a>`
            : `<p style="font-size:13px;color:#7a6e64;margin:0;">No tiene teléfono cargado en su ficha.</p>`
        }
      </div>`
    })
    .join("")

  const body = `
    <p style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a6e64;margin:0 0 8px;">Cumpleaños de hoy</p>
    <h1 style="font-family:Georgia,serif;font-size:30px;font-weight:400;line-height:1.15;margin:0 0 16px;">
      ${data.cumpleaneras.length === 1 ? "Hoy cumple años" : "Hoy cumplen años"} <em style="color:#b68a5f;">${escape(nombres)}</em> 🎉
    </h1>
    <p style="font-size:14px;color:#7a6e64;margin:0 0 20px;">Un toque en el botón abre WhatsApp con el saludo listo para mandar (lo podés retocar antes de enviarlo).</p>
    ${filas}
    <p style="font-size:12px;color:#7a6e64;margin:16px 0 0;">También las ves en <a href="${SITE}/admin" style="color:#7a6e64;">el panel</a>, en "Cumpleaños del mes".</p>
  `
  try {
    await resend.emails.send({ from: FROM, to, subject, html: shell(subject, body) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
