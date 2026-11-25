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
 * Borra una jugada. Sólo admin: es la salida para las pruebas y para la que
 * se equivocó al tipear su celular (y quedaría trabada para siempre, porque el
 * celular es único).
 */
export async function borrarJugada(id: string): Promise<{ ok: boolean; error?: string }> {
  const perfil = await quienLlama()
  if (!perfil || perfil.role !== "admin") return { ok: false, error: "Esto lo puede hacer sólo un admin." }

  const { error } = await db().from("advent_picks").delete().eq("id", id)
  if (error) {
    console.error("[adviento/admin] borrar:", error.message)
    return { ok: false, error: "No se pudo borrar." }
  }
  revalidatePath("/admin/adviento")
  return { ok: true }
}
