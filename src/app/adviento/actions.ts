"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { isActiveStaffSession } from "@/lib/staff"
import {
  CAMPANA,
  CASILLEROS,
  estadoCalendario,
  generarCodigo,
  linkParaLeri,
  partirNombre,
  premioPorId,
  sortearPremio,
  telefonoParaAdviento,
} from "@/lib/servicios/adviento"

/**
 * El servidor del Calendario de Adviento.
 *
 * Estas funciones son PÚBLICAS: se llegan por POST directo, sin pasar por la
 * página (lo avisa la documentación de Next). Así que todo se vuelve a validar
 * acá —la fecha, el teléfono, el casillero— y el sorteo ocurre acá: si se
 * hiciera en el navegador, recargar sería volver a tirar hasta que salga el
 * premio más caro.
 */

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export type Sorpresa = {
  nombre: string
  apellido: string
  casillero: number
  premio: string
  codigo: string
  link: string
}

export type Entrada =
  | { ok: true; estado: "puede-jugar"; nombre: string; apellido: string; telefono: string }
  | { ok: true; estado: "ya-jugo"; sorpresa: Sorpresa }
  | { ok: false; error: string }

export type Jugada = { ok: true; sorpresa: Sorpresa; yaLaTenia: boolean } | { ok: false; error: string }

/**
 * Un freno de mano para robots, sin molestar a nadie: tantos intentos por IP
 * en diez minutos. Vive en memoria, así que cada instancia del servidor tiene
 * su propia cuenta — no es una muralla, es un amortiguador. La muralla de
 * verdad es que el celular es único en la base.
 */
const TOPE_POR_IP = 12
const VENTANA_MS = 10 * 60_000
const intentos = new Map<string, { n: number; desde: number }>()

async function demasiadosIntentos(): Promise<boolean> {
  const h = await headers()
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip"
  const ahora = Date.now()
  const actual = intentos.get(ip)
  if (!actual || ahora - actual.desde > VENTANA_MS) {
    intentos.set(ip, { n: 1, desde: ahora })
    return false
  }
  actual.n++
  // Que no crezca para siempre si el servidor vive mucho.
  if (intentos.size > 5_000) intentos.clear()
  return actual.n > TOPE_POR_IP
}

type Fila = {
  first_name: string
  last_name: string
  door: number
  prize_id: number
  code: string
}

function aSorpresa(f: Fila): Sorpresa {
  const premio = premioPorId(f.prize_id)
  const texto = premio?.texto ?? "Tu sorpresa (preguntale a Leri)."
  return {
    nombre: f.first_name,
    apellido: f.last_name,
    casillero: f.door,
    premio: texto,
    codigo: f.code,
    link: linkParaLeri({
      nombre: f.first_name,
      apellido: f.last_name,
      casillero: f.door,
      premio: texto,
      codigo: f.code,
    }),
  }
}

async function buscarPorTelefono(clave: string): Promise<Fila | null> {
  const { data, error } = await db()
    .from("advent_picks")
    .select("first_name, last_name, door, prize_id, code")
    .eq("campaign", CAMPANA)
    .eq("phone_key", clave)
    .maybeSingle<Fila>()
  if (error) {
    console.error("[adviento] buscar:", error.message)
    throw new Error("No pude consultar en este momento. Probá de nuevo en un rato.")
  }
  return data
}

/**
 * Paso 1: los datos. Todavía no elige casillero ni se guarda nada. Si ese
 * celular ya jugó, se le muestra su sorpresa en vez de dejarla elegir otra vez.
 */
export async function entrar(input: {
  nombre: string
  telefono: string
  trampa?: string
}): Promise<Entrada> {
  // Campo invisible: una persona nunca lo completa, un robot sí.
  if (input.trampa) return { ok: false, error: "No pude guardar tu jugada." }
  if (await demasiadosIntentos())
    return { ok: false, error: "Probaste muchas veces seguidas. Esperá unos minutos." }

  // Fuera de diciembre sólo juega el salón, para probar cómo quedó.
  const real = estadoCalendario()
  const estado = real === "abierto" || !(await isActiveStaffSession()) ? real : "abierto"
  if (estado === "antes") return { ok: false, error: "El calendario arranca el 1 de diciembre." }
  if (estado === "terminado") return { ok: false, error: "El calendario terminó el 31 de diciembre." }

  const quien = partirNombre(input.nombre)
  if (!quien) return { ok: false, error: "Poné tu nombre y tu apellido." }

  const tel = telefonoParaAdviento(input.telefono)
  if (!tel.ok) return { ok: false, error: tel.motivo }

  const ya = await buscarPorTelefono(tel.clave)
  if (ya) return { ok: true, estado: "ya-jugo", sorpresa: aSorpresa(ya) }

  if (estado === "solo-canje")
    return {
      ok: false,
      error: "La elección cerró el 24 de diciembre. Si ya jugaste, poné el mismo celular para ver tu sorpresa.",
    }

  return { ok: true, estado: "puede-jugar", nombre: quien.nombre, apellido: quien.apellido, telefono: tel.lindo }
}

/** Paso 2: eligió un casillero. Acá se sortea y se guarda, todo de una. */
export async function jugar(input: {
  nombre: string
  telefono: string
  casillero: number
  novedades: boolean
  trampa?: string
}): Promise<Jugada> {
  if (input.trampa) return { ok: false, error: "No pude guardar tu jugada." }
  if (await demasiadosIntentos())
    return { ok: false, error: "Probaste muchas veces seguidas. Esperá unos minutos." }

  if (estadoCalendario() !== "abierto" && !(await isActiveStaffSession()))
    return { ok: false, error: "El calendario no está abierto en este momento." }

  const quien = partirNombre(input.nombre)
  if (!quien) return { ok: false, error: "Poné tu nombre y tu apellido." }

  const tel = telefonoParaAdviento(input.telefono)
  if (!tel.ok) return { ok: false, error: tel.motivo }

  const casillero = Math.trunc(Number(input.casillero))
  if (!Number.isFinite(casillero) || casillero < 1 || casillero > CASILLEROS)
    return { ok: false, error: "Elegí un número del 1 al 24." }

  const ya = await buscarPorTelefono(tel.clave)
  if (ya) return { ok: true, sorpresa: aSorpresa(ya), yaLaTenia: true }

  // El sorteo: acá, en el servidor, una sola vez.
  const premio = sortearPremio()

  // El código podría chocar con uno ya dado (la base no deja repetirlo):
  // se reintenta con otro.
  for (let intento = 0; intento < 5; intento++) {
    const codigo = generarCodigo(casillero)
    const { data, error } = await db()
      .from("advent_picks")
      .insert({
        campaign: CAMPANA,
        first_name: quien.nombre,
        last_name: quien.apellido,
        phone: input.telefono.trim().slice(0, 40),
        phone_key: tel.clave,
        marketing_consent: !!input.novedades,
        door: casillero,
        prize_id: premio.id,
        code: codigo,
      })
      .select("first_name, last_name, door, prize_id, code")
      .single<Fila>()

    if (!error && data) return { ok: true, sorpresa: aSorpresa(data), yaLaTenia: false }

    // 23505 = algo único se repitió.
    if (error?.code === "23505") {
      // Si lo repetido fue el teléfono, es que jugó en el mismo instante desde
      // otra pestaña: se le muestra la que quedó.
      const dePaso = await buscarPorTelefono(tel.clave)
      if (dePaso) return { ok: true, sorpresa: aSorpresa(dePaso), yaLaTenia: true }
      continue // fue el código: otro intento
    }

    console.error("[adviento] insert:", error?.message)
    return { ok: false, error: "No pude guardar tu jugada. Probá de nuevo en un rato." }
  }

  return { ok: false, error: "No pude guardar tu jugada. Probá de nuevo en un rato." }
}
