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

/**
 * Vende un PROGRAMA (combo multi-sesión) a una clienta desde el admin, igual que
 * `venderPack`: registra la compra (congelando el nombre, el total, y los
 * servicios con sus sesiones + snapshot de zona) y, si se pide, emite UNA
 * Factura C por el total. NO agenda ninguna sesión — se agendan después, en $0.
 * El programa NO necesita estar activo online (se puede vender aunque su reserva
 * online todavía no esté encendida).
 */
export async function venderPrograma(input: {
  clientId: string
  comboId: string
  facturar: boolean
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()

  const { data: combo } = await admin
    .from("combos")
    .select("id, name, total_price_cents, combo_services(order_index, service_id, sessions, zones, service:services(name))")
    .eq("id", input.comboId)
    .maybeSingle()
  if (!combo) return { ok: false, error: "Combo no encontrado." }

  type ComboSvc = { order_index: number; service_id: string; sessions: number | null; zones: unknown; service: { name: string } | null }
  const svcs = ((combo.combo_services ?? []) as unknown as ComboSvc[])
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
  if (svcs.length < 2) return { ok: false, error: "El combo tiene que tener al menos 2 servicios." }

  // 1) La compra.
  const { data: purchase, error: purErr } = await admin
    .from("combo_purchases")
    .insert({
      client_id: input.clientId,
      combo_id: combo.id,
      combo_name: combo.name,
      total_price_cents: combo.total_price_cents,
    })
    .select("id")
    .single()
  if (purErr || !purchase) return { ok: false, error: purErr?.message ?? "No se pudo registrar la compra." }

  // 2) Los servicios del programa, congelados en la compra.
  const { error: svcErr } = await admin.from("combo_purchase_services").insert(
    svcs.map((cs) => ({
      combo_purchase_id: purchase.id,
      service_id: cs.service_id,
      service_name: cs.service?.name ?? "",
      sessions: cs.sessions ?? 1,
      zones: cs.zones ?? null,
      order_index: cs.order_index,
    }))
  )
  if (svcErr) {
    await admin.from("combo_purchases").delete().eq("id", purchase.id) // no dejar la compra huérfana
    return { ok: false, error: svcErr.message }
  }

  // 3) La factura: UNA sola, por el total del programa (concepto 2 = servicios).
  //    NO va por un turno portador — se emite acá directa, como venderPack. Las
  //    sesiones que se agenden después van todas en $0 (ya está facturado).
  let facturaError: string | undefined  // la factura NO se pudo emitir
  let linkWarning: string | undefined   // se emitió, pero no se pudo enlazar a la compra
  if (input.facturar) {
    try {
      const { data: client } = await admin
        .from("clients")
        .select("first_name, dni, email")
        .eq("id", input.clientId)
        .maybeSingle()
      const doc = normalizarDoc(client?.dni)
      const docTipo = docTipoParaDocumento(doc)
      const factura = await emitirFactura({
        clientId: input.clientId,
        concepto: 2,
        docTipo,
        docNro: docTipo === 99 ? "0" : doc,
        condIvaReceptor: 5,
        totalCents: combo.total_price_cents,
        descripcion: combo.name,
      })
      // Si el enlace falla (ej. la migración de invoice_id no corrió), NO se
      // traga en silencio: la factura YA se emitió (CAE real), hay que avisar.
      const { error: invUpdErr } = await admin.from("combo_purchases").update({ invoice_id: factura.id }).eq("id", purchase.id)
      if (invUpdErr) linkWarning = invUpdErr.message
      await renderAndEmailInvoice(factura.id, client?.email ?? null, client?.first_name ?? "")
    } catch (e) {
      facturaError = e instanceof Error ? e.message : String(e)
    }
  }

  revalidatePath(`/admin/clientas/${input.clientId}`)
  // La compra quedó registrada aunque la factura falle; se informa el error.
  if (facturaError) return { ok: false, error: `Combo registrado, pero la factura falló: ${facturaError}` }
  if (linkWarning) return { ok: false, error: `Combo registrado y facturado, pero no se pudo enlazar la factura a la compra (avisá a soporte): ${linkWarning}` }
  return { ok: true }
}
