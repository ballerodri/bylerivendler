import "server-only"
import { loadInvoicePdfData } from "./invoice-pdf"
import { renderInvoicePdf } from "./pdf"
import { sendInvoiceEmail } from "@/lib/email/invoice-emails"

// Genera el PDF de una factura y lo envía por email. Best-effort: no lanza.
export async function renderAndEmailInvoice(
  invoiceId: string,
  to: string | null,
  firstName: string
): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "Sin email de destinatario" }
  try {
    const data = await loadInvoicePdfData(invoiceId)
    if (!data) return { ok: false, error: "No se pudo cargar la factura para el PDF" }
    const pdf = await renderInvoicePdf(data)
    return await sendInvoiceEmail({
      to,
      firstName,
      cbteNro: data.nro,
      ptoVta: data.ptoVta,
      fecha: data.fecha,
      totalCents: data.totalCents,
      pdf,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
