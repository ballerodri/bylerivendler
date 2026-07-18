"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"
import { renderAndEmailInvoice } from "@/lib/arca/emit-email"
import { pesosToCents } from "@/lib/arca/format"
import { docTipoParaDocumento, normalizarDoc } from "@/lib/arca/padron-parse"

async function requireStaff() {
  const supabase = await createSsrClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) throw new Error("Acceso denegado")
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

const ManualSchema = z.object({
  docTipo: z.union([z.literal(99), z.literal(96), z.literal(80)]),
  docNro: z.string().trim(),
  receptorNombre: z.string().trim(),
  email: z.string().trim(),
  descripcion: z.string().trim().min(1, "Falta la descripción"),
  montoPesos: z.number().positive("El monto debe ser mayor a 0").max(20_000_000, "Monto demasiado alto"),
})

export async function emitirFacturaManual(
  input: z.infer<typeof ManualSchema>
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireStaff()
  const parsed = ManualSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  const v = parsed.data

  try {
    const factura = await emitirFactura({
      concepto: 2,
      docTipo: v.docTipo,
      docNro: v.docTipo === 99 ? "0" : v.docNro,
      receptorNombre: v.receptorNombre || undefined,
      condIvaReceptor: 5,
      totalCents: pesosToCents(v.montoPesos),
      descripcion: v.descripcion,
    })
    await renderAndEmailInvoice(factura.id, v.email || null, v.receptorNombre || "")
    revalidatePath("/admin/facturacion")
    return { ok: true, id: factura.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Datos del receptor traídos del padrón de ARCA en la pantalla de facturar.
// Son OPCIONALES: si no vienen, la factura sale exactamente igual que antes de
// que existiera la búsqueda en el padrón.
export interface ReceptorOverride {
  doc?: string | null
  condIva?: number | null
  nombre?: string | null
}

// Códigos válidos de condición frente al IVA del receptor (RG 5616). Si llega
// cualquier otra cosa la ignoramos y usamos el default de siempre: nunca
// mandamos a ARCA un código que no reconocemos.
const COND_IVA_VALIDAS = new Set([1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16])
const COND_IVA_DEFAULT = 5 // Consumidor Final

export async function emitirFacturaTurno(
  appointmentId: string,
  identificar: boolean,
  receptor?: ReceptorOverride
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { data: appt } = await admin
    .from("appointments")
    .select(`
      id, total_cents, pack_purchase_id, client:clients(id, first_name, last_name, email, dni),
      appointment_services(service:services(name))
    `)
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }

  if (appt.total_cents <= 0) {
    return {
      ok: false,
      error: appt.pack_purchase_id
        ? "Este turno es de $0 (es una sesión de un pack, ya cubierta por la factura del pack). No se puede emitir una factura por $0."
        : "Este turno es de $0. No se puede emitir una factura por $0.",
    }
  }

  const { data: yaFacturada } = await admin
    .from("invoices")
    .select("id")
    .eq("appointment_id", appointmentId)
    .eq("estado", "emitida")
    .maybeSingle()
  if (yaFacturada) return { ok: false, error: "Este turno ya tiene una factura emitida." }

  const client = appt.client as unknown as { id: string; first_name: string; last_name: string; email: string | null; dni: string | null } | null
  const services = (appt.appointment_services ?? []) as unknown as { service: { name: string } | null }[]
  const descripcion = services.map((s) => s.service?.name).filter(Boolean).join(", ") || "Servicios"

  // El documento del receptor sale, por orden: del que se buscó en el padrón
  // en esta misma pantalla, o del que está guardado en la ficha si se tildó
  // "identificar". Sin ninguno de los dos, Consumidor Final (como siempre).
  const docPadron = normalizarDoc(receptor?.doc)
  const docFicha = identificar && client?.dni ? normalizarDoc(client.dni) : ""
  const docReceptor = docPadron || docFicha
  // El tipo ya no está fijo en 96: se deduce del largo (11 = CUIT, si no DNI).
  const docTipo = docTipoParaDocumento(docReceptor)

  // La condición del padrón sólo vale si además tenemos su documento: no tiene
  // sentido facturarle "Responsable Inscripto" a un Consumidor Final sin CUIT.
  const condIva =
    docPadron && receptor?.condIva != null && COND_IVA_VALIDAS.has(receptor.condIva)
      ? receptor.condIva
      : COND_IVA_DEFAULT

  const nombreFicha = client ? `${client.first_name} ${client.last_name}` : undefined
  const nombreReceptor = receptor?.nombre?.trim() || nombreFicha

  try {
    const factura = await emitirFactura({
      clientId: client?.id,
      appointmentId,
      concepto: 2,
      docTipo,
      docNro: docTipo === 99 ? "0" : docReceptor,
      receptorNombre: nombreReceptor,
      condIvaReceptor: condIva,
      totalCents: appt.total_cents,
      descripcion,
    })
    await renderAndEmailInvoice(factura.id, client?.email ?? null, client?.first_name ?? "")
    revalidatePath("/admin/facturacion")
    revalidatePath("/admin/turnos")
    return { ok: true, id: factura.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function reenviarFacturaEmail(
  invoiceId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()
  const { data: inv } = await admin
    .from("invoices")
    .select("client_id, receptor_nombre")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!inv) return { ok: false, error: "Factura no encontrada" }

  let to: string | null = null
  let firstName = inv.receptor_nombre ?? ""
  if (inv.client_id) {
    const { data: c } = await admin
      .from("clients")
      .select("email, first_name")
      .eq("id", inv.client_id)
      .maybeSingle()
    to = c?.email ?? null
    if (c?.first_name) firstName = c.first_name
  }
  if (!to) return { ok: false, error: "La factura no tiene un email asociado" }

  const r = await renderAndEmailInvoice(invoiceId, to, firstName)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
