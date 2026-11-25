import { createClient } from "@supabase/supabase-js"

/**
 * Interruptores globales del sitio: opciones que no pertenecen a ninguna
 * entidad (un servicio, una clienta) y que el salón prende y apaga desde el
 * panel, sin tener que desplegar nada.
 *
 * Son pocas filas y se leen desde el servidor. Para datos, no.
 */

/** Abre el Calendario de Adviento aunque no estemos en diciembre, para probar. */
export const ADVIENTO_PRUEBA = "adviento_prueba"

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * ¿Está prendido ese interruptor?
 *
 * Ante la duda, NO: si la consulta falla, un interruptor que abre algo al
 * público tiene que quedarse cerrado, no abierto.
 */
export async function flagPrendido(key: string): Promise<boolean> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", key).maybeSingle()
  if (error) {
    console.error("[app_settings] leyendo " + key + ":", error.message)
    return false
  }
  return data?.value === "on"
}

/** Prende o apaga el interruptor, dejando quién fue. */
export async function guardarFlag(key: string, prendido: boolean, staffId: string | null): Promise<void> {
  const { error } = await db()
    .from("app_settings")
    .upsert(
      { key, value: prendido ? "on" : "off", updated_at: new Date().toISOString(), updated_by: staffId },
      { onConflict: "key" }
    )
  if (error) {
    console.error("[app_settings] guardando " + key + ":", error.message)
    throw new Error("No se pudo guardar la opción.")
  }
}
