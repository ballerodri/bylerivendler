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
  descripcion: string
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
      environment: cfg.env,
      descripcion: input.descripcion,
    })
    .select("id, cbte_nro, cae, qr_url")
    .single()

  if (error) throw new Error(`Factura autorizada pero falló al guardar: ${error.message}`)
  return data
}

/**
 * Anula una factura ya emitida con una NOTA DE CRÉDITO C. En ARCA una factura
 * con CAE no se borra ni edita: se la cancela con una nota de crédito por el
 * mismo importe, que la referencia. La nota de crédito es un comprobante
 * propio (cbte_tipo 13) con su propio CAE y su propia numeración; se guarda
 * como una fila más de `invoices` apuntando a la original, y la original queda
 * marcada `anulada`.
 *
 * Copia EXACTO el receptor, el total y el concepto de la original (la
 * descripción se reemplaza por "Anula Factura C …" para que quede claro en el
 * PDF): la nota de crédito refleja lo mismo que anula.
 */
export async function anularFactura(invoiceId: string) {
  const cfg = getArcaConfig()
  const db = admin()

  const { data: orig, error: readErr } = await db
    .from("invoices")
    .select(
      "id, cbte_tipo, pto_vta, cbte_nro, concepto, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, receptor_cond_iva, total_cents, descripcion, cae, fecha_emision, estado, anulada, environment, client_id, appointment_id"
    )
    .eq("id", invoiceId)
    .maybeSingle()
  if (readErr) throw new Error(`No se pudo leer la factura: ${readErr.message}`)
  if (!orig) throw new Error("No encontramos la factura.")

  // Barreras: sólo se anula una FACTURA (11) EMITIDA que no esté ya anulada, y
  // que sea del entorno actual (no anular una de homologación desde producción).
  if (orig.cbte_tipo !== 11) throw new Error("Sólo se puede anular una factura, no una nota de crédito.")
  if (orig.estado !== "emitida" || !orig.cae) throw new Error("Esta factura no está emitida.")
  if (orig.anulada) throw new Error("Esta factura ya fue anulada.")
  if (orig.environment !== cfg.env) throw new Error("Esta factura es de otro entorno de ARCA.")

  // RECLAMO ATÓMICO antes de llamar a ARCA: marca la original anulada SÓLO si
  // todavía no lo estaba (`.eq("anulada", false)`). Si dos clics entran a la
  // vez (dos pestañas), uno reclama y el otro ve 0 filas y corta ACÁ, antes de
  // emitir — así nunca se emiten DOS notas de crédito (sobre-crédito). Si ARCA
  // falla después, se suelta el reclamo (abajo) para poder reintentar.
  const { data: reclamada } = await db
    .from("invoices")
    .update({ anulada: true })
    .eq("id", orig.id)
    .eq("anulada", false)
    .select("id")
  if (!reclamada?.length) throw new Error("Esta factura ya fue anulada (o se está anulando).")
  const soltarReclamo = async () => {
    try {
      await db.from("invoices").update({ anulada: false }).eq("id", orig.id)
    } catch {
      // best-effort
    }
  }

  const fecha = new Date()
  const wsInput: InvoiceInput = {
    ptoVta: cfg.ptoVta,
    concepto: orig.concepto as 1 | 2 | 3,
    docTipo: orig.receptor_doc_tipo as DocTipo,
    docNro: orig.receptor_doc_nro,
    condIvaReceptor: orig.receptor_cond_iva,
    totalCents: orig.total_cents,
    fecha,
    cbteTipo: 13, // Nota de Crédito C
    cbteAsoc: {
      tipo: orig.cbte_tipo,
      ptoVta: orig.pto_vta,
      nro: Number(orig.cbte_nro),
      cuit: cfg.cuit,
      fecha: new Date(`${orig.fecha_emision}T12:00:00-03:00`),
    },
  }

  let cae
  try {
    cae = await solicitarCae(wsInput)
  } catch (e) {
    // ARCA rechazó o falló: la factura NO quedó anulada. Se suelta el reclamo
    // para poder reintentar, y se propaga el error.
    await soltarReclamo()
    throw e
  }

  const qrUrl = buildQrUrl({
    fecha: isoDateAr(fecha),
    cuit: Number(cfg.cuit),
    ptoVta: cfg.ptoVta,
    tipoCmp: 13,
    nroCmp: cae.cbteNro,
    importe: pesos(orig.total_cents),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: orig.receptor_doc_tipo,
    nroDocRec: Number(orig.receptor_doc_nro),
    codAut: Number(cae.cae),
  })

  // La nota de crédito, como comprobante propio.
  const { data: nc, error: insErr } = await db
    .from("invoices")
    .insert({
      client_id: orig.client_id,
      appointment_id: orig.appointment_id,
      cbte_tipo: 13,
      pto_vta: cfg.ptoVta,
      cbte_nro: cae.cbteNro,
      concepto: orig.concepto,
      receptor_doc_tipo: orig.receptor_doc_tipo,
      receptor_doc_nro: orig.receptor_doc_nro,
      receptor_nombre: orig.receptor_nombre,
      receptor_cond_iva: orig.receptor_cond_iva,
      total_cents: orig.total_cents,
      cae: cae.cae,
      cae_vto: caeVtoToDate(cae.caeVto),
      fecha_emision: isoDateAr(fecha),
      estado: "emitida",
      qr_url: qrUrl,
      environment: cfg.env,
      descripcion: `Anula Factura C ${String(orig.pto_vta).padStart(4, "0")}-${String(orig.cbte_nro).padStart(8, "0")}`,
      anula_invoice_id: orig.id,
    })
    .select("id, cbte_nro")
    .single()
  // La nota de crédito YA tiene CAE de ARCA: si falla el guardado local, el
  // comprobante existe igual en ARCA. Se avisa para no re-emitir (sería una
  // segunda nota de crédito), pero no se marca la original como anulada porque
  // no quedó registro local — hay que resolverlo a mano.
  if (insErr)
    // El CAE ya existe en ARCA. La original quedó marcada `anulada` desde el
    // reclamo, así que el botón "Anular" YA NO aparece: no se puede re-emitir
    // por accidente. Sólo falta el registro local de la nota de crédito, que
    // se resuelve a mano.
    throw new Error(
      `La nota de crédito se emitió en ARCA (N° ${cae.cbteNro}) pero falló al guardar: ${insErr.message}. No re-emitas: avisá a soporte.`
    )

  // La original ya quedó `anulada` en el reclamo de arriba; no hay nada más
  // que marcar.
  return nc
}
