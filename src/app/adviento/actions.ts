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
 * Un freno de mano para robots. Dos topes distintos, a propósito.
 *
 * En el salón (o en el wifi de un café, o detrás del CGNAT de una operadora
 * móvil) MUCHAS personas comparten una sola IP. Con un tope chico, la sexta
 * clienta que prueba el calendario en la misma sala se come un "probaste
 * muchas veces": le estaríamos diciendo tramposa a alguien que entró por
 * primera vez, en la página hecha para atraerla. Por eso mirar es casi libre y
 * lo acotado es guardar. La muralla de verdad no es esta: es que el celular es
 * único en la base.
 *
 * Vive en memoria, así que cada instancia del servidor lleva su propia cuenta.
 * Es un amortiguador, no una muralla.
 */
const TOPE_MIRAR = 60 // por IP, en 10 minutos
const TOPE_GUARDAR = 25
const VENTANA_MS = 10 * 60_000
const intentos = new Map<string, { mirar: number; guardar: number; desde: number }>()

async function demasiados(tipo: "mirar" | "guardar"): Promise<boolean> {
  const h = await headers()
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip"
  const ahora = Date.now()
  let actual = intentos.get(ip)
  if (!actual || ahora - actual.desde > VENTANA_MS) {
    actual = { mirar: 0, guardar: 0, desde: ahora }
    intentos.set(ip, actual)
  }
  actual[tipo]++
  if (intentos.size > 5_000) intentos.clear()
  return actual[tipo] > (tipo === "mirar" ? TOPE_MIRAR : TOPE_GUARDAR)
}

type Fila = {
  door: number
  prize_id: number
  code: string
}

/**
 * Arma la pantalla de la sorpresa.
 *
 * El nombre que sale es el que escribió QUIEN ESTÁ PREGUNTANDO, nunca el que
 * quedó guardado. Si se devolviera el guardado, cualquiera podría escribir un
 * nombre inventado con el celular de otra persona y la página le contestaría
 * con el nombre real de esa clienta: un directorio de nombres y teléfonos.
 */
function aSorpresa(f: Fila, nombre: string, apellido: string): Sorpresa {
  const premio = premioPorId(f.prize_id)
  const texto = premio?.texto ?? "Tu sorpresa (preguntale a Leri)."
  return {
    nombre,
    apellido,
    casillero: f.door,
    premio: texto,
    codigo: f.code,
    link: linkParaLeri({
      nombre,
      apellido,
      casillero: f.door,
      premio: texto,
      codigo: f.code,
    }),
  }
}

async function buscarPorTelefono(clave: string): Promise<Fila | null> {
  const { data, error } = await db()
    .from("advent_picks")
    .select("door, prize_id, code")
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
export async function entrar(input: { nombre: string; telefono: string }): Promise<Entrada> {
  // Fuera de diciembre sólo juega el salón, para probar cómo quedó.
  const real = estadoCalendario()
  const estado = real === "abierto" || !(await isActiveStaffSession()) ? real : "abierto"
  if (estado === "antes") return { ok: false, error: "El calendario arranca el 1 de diciembre." }
  if (estado === "terminado") return { ok: false, error: "El calendario terminó el 31 de diciembre." }

  const quien = partirNombre(String(input?.nombre ?? ""))
  if (!quien) return { ok: false, error: "Poné tu nombre y tu apellido." }

  const tel = telefonoParaAdviento(String(input?.telefono ?? ""))
  if (!tel.ok) return { ok: false, error: tel.motivo }

  if (await demasiados("mirar"))
    return { ok: false, error: "Estamos recibiendo muchas consultas desde tu conexión. Probá en unos minutos." }

  const ya = await buscarPorTelefono(tel.clave)
  if (ya)
    return { ok: true, estado: "ya-jugo", sorpresa: aSorpresa(ya, quien.nombre, quien.apellido) }

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
}): Promise<Jugada> {
  if (estadoCalendario() !== "abierto" && !(await isActiveStaffSession()))
    return { ok: false, error: "El calendario no está abierto en este momento." }

  const quien = partirNombre(String(input?.nombre ?? ""))
  if (!quien) return { ok: false, error: "Poné tu nombre y tu apellido." }

  const tel = telefonoParaAdviento(String(input?.telefono ?? ""))
  if (!tel.ok) return { ok: false, error: tel.motivo }

  const casillero = Math.trunc(Number(input?.casillero))
  if (!Number.isFinite(casillero) || casillero < 1 || casillero > CASILLEROS)
    return { ok: false, error: "Elegí un número del 1 al 24." }

  if (await demasiados("guardar"))
    return { ok: false, error: "Estamos recibiendo muchas jugadas desde tu conexión. Probá en unos minutos." }

  const ya = await buscarPorTelefono(tel.clave)
  if (ya) return { ok: true, sorpresa: aSorpresa(ya, quien.nombre, quien.apellido), yaLaTenia: true }

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
        phone: String(input?.telefono ?? "").trim().slice(0, 40),
        phone_key: tel.clave,
        marketing_consent: !!input?.novedades,
        door: casillero,
        prize_id: premio.id,
        code: codigo,
      })
      .select("door, prize_id, code")
      .single<Fila>()

    if (!error && data)
      return { ok: true, sorpresa: aSorpresa(data, quien.nombre, quien.apellido), yaLaTenia: false }

    // 23505 = algo único se repitió.
    if (error?.code === "23505") {
      // Si lo repetido fue el teléfono, es que jugó en el mismo instante desde
      // otra pestaña: se le muestra la que quedó.
      const dePaso = await buscarPorTelefono(tel.clave)
      if (dePaso)
        return { ok: true, sorpresa: aSorpresa(dePaso, quien.nombre, quien.apellido), yaLaTenia: true }
      continue // fue el código: otro intento
    }

    console.error("[adviento] insert:", error?.message)
    return { ok: false, error: "No pude guardar tu jugada. Probá de nuevo en un rato." }
  }

  return { ok: false, error: "No pude guardar tu jugada. Probá de nuevo en un rato." }
}
