"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser, requireAdmin } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"
import { renderAndEmailInvoice } from "@/lib/arca/emit-email"
import { docTipoParaDocumento, normalizarDoc } from "@/lib/arca/padron-parse"

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function requireAdminAction() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) throw new Error("Acceso denegado")
  await requireAdmin(user.id)
}

export async function venderPack(input: {
  clientId: string
  packId: string
  facturar: boolean
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()

  const { data: pack } = await admin
    .from("packs")
    .select("id, name, sessions, total_price_cents, service:services(id, name)")
    .eq("id", input.packId)
    .maybeSingle()
  if (!pack) return { ok: false, error: "Pack no encontrado" }
  const service = pack.service as unknown as { id: string; name: string } | null

  const { data: purchase, error: insErr } = await admin
    .from("pack_purchases")
    .insert({
      client_id: input.clientId,
      pack_id: pack.id,
      pack_name: pack.name,
      service_id: service?.id ?? null,
      service_name: service?.name ?? "",
      sessions_total: pack.sessions,
      sessions_used: 0,
    })
    .select("id")
    .single()
  if (insErr || !purchase) return { ok: false, error: insErr?.message ?? "No se pudo registrar la compra." }

  let facturaError: string | undefined
  if (input.facturar) {
    try {
      const { data: client } = await admin
        .from("clients")
        .select("first_name, dni, email")
        .eq("id", input.clientId)
        .maybeSingle()
      // `clients.dni` guarda DNI **o** CUIT (la búsqueda en el padrón escribe
      // ahí el CUIT tal cual). Si acá dejáramos el 96 fijo, la primera clienta
      // con CUIT guardado se facturaría como "DNI de 11 dígitos" y ARCA
      // rechazaría la venta del pack. El tipo se deduce del largo, igual que en
      // la facturación de turnos.
      const doc = normalizarDoc(client?.dni)
      const docTipo = docTipoParaDocumento(doc)
      const factura = await emitirFactura({
        clientId: input.clientId,
        concepto: 2,
        docTipo,
        docNro: docTipo === 99 ? "0" : doc,
        condIvaReceptor: 5,
        totalCents: pack.total_price_cents,
        descripcion: pack.name,
      })
      // Queda anotada acá (no en `invoices`) para poder bloquear el borrado
      // de este pack más adelante sin tocar el esquema de facturación.
      await admin.from("pack_purchases").update({ invoice_id: factura.id }).eq("id", purchase.id)
      await renderAndEmailInvoice(factura.id, client?.email ?? null, client?.first_name ?? "")
    } catch (e) {
      facturaError = e instanceof Error ? e.message : String(e)
    }
  }

  revalidatePath(`/admin/clientas/${input.clientId}`)
  // La compra quedó registrada aunque la factura falle; se informa el error.
  return facturaError
    ? { ok: false, error: `Pack registrado, pero la factura falló: ${facturaError}` }
    : { ok: true }
}
