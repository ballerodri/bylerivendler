"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"
import { renderAndEmailInvoice } from "@/lib/arca/emit-email"

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
  if (!user) throw new Error("Sin sesión")
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

  const { error: insErr } = await admin.from("pack_purchases").insert({
    client_id: input.clientId,
    pack_id: pack.id,
    pack_name: pack.name,
    service_id: service?.id ?? null,
    service_name: service?.name ?? "",
    sessions_total: pack.sessions,
    sessions_used: 0,
  })
  if (insErr) return { ok: false, error: insErr.message }

  let facturaError: string | undefined
  if (input.facturar) {
    const { data: client } = await admin
      .from("clients")
      .select("first_name, dni, email")
      .eq("id", input.clientId)
      .maybeSingle()
    const dni = client?.dni ?? null
    try {
      const factura = await emitirFactura({
        clientId: input.clientId,
        concepto: 2,
        docTipo: dni ? 96 : 99,
        docNro: dni ?? "0",
        condIvaReceptor: 5,
        totalCents: pack.total_price_cents,
        descripcion: pack.name,
      })
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
