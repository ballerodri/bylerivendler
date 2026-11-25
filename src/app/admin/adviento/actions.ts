"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"

/**
 * Las acciones del panel del Calendario de Adviento.
 *
 * Se llegan por POST directo, sin pasar por la pantalla, así que cada una
 * vuelve a preguntar quién es el que llama: marcar un premio como usado o
 * borrar una jugada no puede quedar al alcance de cualquiera.
 */

function db() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/** Devuelve el perfil si puede operar el panel (admin o recepción). */
async function quienLlama() {
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (!user) return null
  const perfil = await getStaffProfile(user.id)
  if (!perfil || perfil.isProfessionalOnly) return null
  return perfil
}

/** Marca (o desmarca) el premio como canjeado. Queda quién y cuándo. */
export async function marcarUsado(id: string, usado: boolean): Promise<{ ok: boolean; error?: string }> {
  const perfil = await quienLlama()
  if (!perfil) return { ok: false, error: "No autorizado." }

  const { error } = await db()
    .from("advent_picks")
    .update(
      usado
        ? { redeemed_at: new Date().toISOString(), redeemed_by: perfil.id }
        : { redeemed_at: null, redeemed_by: null }
    )
    .eq("id", id)

  if (error) {
    console.error("[adviento/admin] marcarUsado:", error.message)
    return { ok: false, error: "No se pudo guardar." }
  }
  revalidatePath("/admin/adviento")
  return { ok: true }
}

/**
 * Borra una jugada: la salida para las pruebas y para la clienta que se
 * equivocó al tipear su celular, que si no queda trabada para siempre (el
 * celular es único).
 *
 * Recepción puede borrar una jugada SIN usar —el caso del mostrador, que pasa
 * con la clienta parada ahí— pero no una ya canjeada: eso lo decide un admin.
 */
export async function borrarJugada(id: string): Promise<{ ok: boolean; error?: string }> {
  const perfil = await quienLlama()
  if (!perfil) return { ok: false, error: "No autorizado." }

  if (perfil.role !== "admin") {
    const { data } = await db().from("advent_picks").select("redeemed_at").eq("id", id).maybeSingle()
    if (data?.redeemed_at)
      return { ok: false, error: "Esa jugada ya se usó: para borrarla tiene que entrar un admin." }
  }

  const { error } = await db().from("advent_picks").delete().eq("id", id)
  if (error) {
    console.error("[adviento/admin] borrar:", error.message)
    return { ok: false, error: "No se pudo borrar." }
  }
  revalidatePath("/admin/adviento")
  return { ok: true }
}
