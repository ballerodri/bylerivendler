import "server-only"
import { createClient } from "@supabase/supabase-js"
import { getArcaConfig } from "./config"
import { solicitarCae } from "./wsfe"
import { buildQrUrl } from "./qr"
import { pesos, isoDateAr, type InvoiceInput, type DocTipo } from "./wsfe-payload"

export interface EmitInput {
  clientId?: string
  appointmentId?: string
  concepto: 1 | 2 | 3
  docTipo: DocTipo
  docNro: string
  receptorNombre?: string
  condIvaReceptor: number
  totalCents: number
  servDesde?: Date
  servHasta?: Date
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// yyyymmdd (de ARCA) -> yyyy-mm-dd (para columna date)
function caeVtoToDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export async function emitirFactura(input: EmitInput) {
  const cfg = getArcaConfig()
  const fecha = new Date()

  const wsInput: InvoiceInput = {
    ptoVta: cfg.ptoVta,
    concepto: input.concepto,
    docTipo: input.docTipo,
    docNro: input.docNro,
    condIvaReceptor: input.condIvaReceptor,
    totalCents: input.totalCents,
    fecha,
    servDesde: input.servDesde,
    servHasta: input.servHasta,
  }

  const cae = await solicitarCae(wsInput)

  const qrUrl = buildQrUrl({
    fecha: isoDateAr(fecha),
    cuit: Number(cfg.cuit),
    ptoVta: cfg.ptoVta,
    tipoCmp: 11,
    nroCmp: cae.cbteNro,
    importe: pesos(input.totalCents),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: input.docTipo,
    nroDocRec: Number(input.docNro),
    codAut: Number(cae.cae),
  })

  const { data, error } = await admin()
    .from("invoices")
    .insert({
      client_id: input.clientId ?? null,
      appointment_id: input.appointmentId ?? null,
      cbte_tipo: 11,
      pto_vta: cfg.ptoVta,
      cbte_nro: cae.cbteNro,
      concepto: input.concepto,
      receptor_doc_tipo: input.docTipo,
      receptor_doc_nro: input.docNro,
      receptor_nombre: input.receptorNombre ?? null,
      receptor_cond_iva: input.condIvaReceptor,
      total_cents: input.totalCents,
      cae: cae.cae,
      cae_vto: caeVtoToDate(cae.caeVto),
      fecha_emision: isoDateAr(fecha),
      estado: "emitida",
      qr_url: qrUrl,
    })
    .select("id, cbte_nro, cae, qr_url")
    .single()

  if (error) throw new Error(`Factura autorizada pero falló al guardar: ${error.message}`)
  return data
}
