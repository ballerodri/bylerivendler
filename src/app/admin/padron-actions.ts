"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { consultarPadron } from "@/lib/arca/padron"
import { normalizarDoc, type PadronResult } from "@/lib/arca/padron-parse"

// Las dos acciones de acá son sólo para el admin: consultar el padrón de ARCA
// gasta el ticket del certificado del salón y guardar el documento toca la
// ficha de la clienta. Nada de esto se expone al público.
async function requireStaff() {
  const supabase = await createSsrClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Sin sesión")
  if (!(await isStaffUser(user.id))) throw new Error("Acceso denegado")
  return user
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/** Le pregunta a ARCA quién es el dueño de ese DNI o CUIT. Nunca lanza. */
export async function buscarEnPadron(doc: string): Promise<PadronResult> {
  await requireStaff()
  return consultarPadron(doc)
}

/**
 * Guarda el documento en la ficha de la clienta (columna `clients.dni`, que
 * guarda tanto DNI como CUIT: el tipo se deduce después por el largo).
 */
export async function guardarDocumentoClienta(
  clientId: string,
  doc: string
): Promise<{ ok: boolean; error?: string; doc?: string }> {
  await requireStaff()

  const id = z.string().uuid().safeParse(clientId)
  if (!id.success) return { ok: false, error: "Clienta inválida" }

  const documento = normalizarDoc(doc)
  if (documento.length !== 8 && documento.length !== 11) {
    return { ok: false, error: "Ingresá un DNI (8 dígitos) o un CUIT/CUIL (11 dígitos)." }
  }

  const { error } = await adminClient().from("clients").update({ dni: documento }).eq("id", id.data)
  if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` }

  revalidatePath(`/admin/clientas/${id.data}`)
  revalidatePath("/admin/clientas")
  return { ok: true, doc: documento }
}
