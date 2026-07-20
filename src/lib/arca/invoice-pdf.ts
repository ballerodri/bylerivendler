import "server-only"
import { createClient } from "@supabase/supabase-js"
import { getArcaConfig } from "./config"
import { ddmmyyyy, receptorDocLabel } from "./format"
import type { InvoicePdfData } from "./pdf"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function loadInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
  const { data: row } = await admin()
    .from("invoices")
    .select(
      "cbte_tipo, pto_vta, cbte_nro, fecha_emision, cae, cae_vto, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, receptor_cond_iva, descripcion, total_cents, qr_url, estado"
    )
    .eq("id", invoiceId)
    .maybeSingle()

  if (!row || row.estado !== "emitida") return null

  const cfg = getArcaConfig()
  return {
    emisor: {
      razonSocial: cfg.emisor.razonSocial,
      cuit: cfg.cuit,
      domicilio: cfg.emisor.domicilio,
      inicioActividades: cfg.emisor.inicioActividades,
      iibb: cfg.emisor.iibb,
    },
    cbteTipo: row.cbte_tipo,
    ptoVta: row.pto_vta,
    nro: row.cbte_nro,
    fecha: ddmmyyyy(row.fecha_emision),
    cae: row.cae,
    caeVto: ddmmyyyy(row.cae_vto),
    receptorDoc: receptorDocLabel(row.receptor_doc_tipo, row.receptor_doc_nro),
    receptorNombre: row.receptor_nombre ?? "Consumidor Final",
    // Las facturas viejas (anteriores a la columna) son todas Consumidor Final:
    // en esa época la app mandaba 5 fijo. Por eso el null cae en 5 y no en
    // "desconocido".
    receptorCondIva: row.receptor_cond_iva ?? 5,
    descripcion: row.descripcion ?? "Servicios",
    totalCents: row.total_cents,
    qrUrl: row.qr_url,
  }
}
