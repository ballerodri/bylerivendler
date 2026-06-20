import "server-only"
import { Resend } from "resend"
import { fmtPrice } from "@/app/reserva/data"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = "By Leri Vendler <turnos@bylerivendler.com>"

export async function sendInvoiceEmail(data: {
  to: string
  firstName: string
  cbteNro: number
  ptoVta: number
  fecha: string
  totalCents: number
  pdf: Buffer
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const nro = `${String(data.ptoVta).padStart(4, "0")}-${String(data.cbteNro).padStart(8, "0")}`
  const subject = `Tu factura ${nro} · By Leri Vendler`

  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2ede6;font-family:Georgia,serif;color:#2b2623;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-size:26px;font-weight:400;margin:0 0 16px;">Gracias, ${data.firstName}.</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 20px;">
      Adjuntamos tu <strong>Factura C ${nro}</strong> del ${data.fecha} por <strong>${fmtPrice(data.totalCents / 100)}</strong>.
    </p>
    <p style="font-size:13px;color:#7a6e64;margin:0;">By Leri Vendler · Pilar, Buenos Aires</p>
  </div>
</body></html>`

  try {
    await resend.emails.send({
      from: FROM,
      to: data.to,
      subject,
      html,
      attachments: [{ filename: `factura-${nro}.pdf`, content: data.pdf }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
