import { NextRequest, NextResponse } from "next/server"
import {
  handleRpcMessage,
  rpcError,
  secretsMatch,
  MIN_SECRET_LEN,
  RPC_PARSE_ERROR,
  RPC_INVALID_REQUEST,
  type JsonRpcRequest,
} from "@/lib/mcp/protocol"
import { buildTools } from "@/lib/mcp/tools"

/**
 * El servidor MCP del salón: le deja a un asistente externo (el ChatGPT de
 * Leri) CONSULTAR la agenda, la disponibilidad, las clientas y los números.
 *
 * SÓLO LECTURA: las herramientas viven en `@/lib/mcp/tools`, donde no hay
 * ninguna escritura. Este endpoint no expone nada más.
 *
 * Puerta de entrada: un secreto (`MCP_SECRET`). Sin él no se contesta NADA:
 * ni la lista de herramientas, ni que este endpoint exista — sin secreto todo
 * responde 404, igual que una URL que no existe. Se acepta de dos formas
 * porque no todos los clientes dejan mandar encabezados:
 *   1. `Authorization: Bearer <secreto>`  ← preferida
 *   2. `?k=<secreto>` en la URL           ← para clientes que sólo piden una URL
 * La (2) deja el secreto en los registros del servidor: usar la (1) si se puede,
 * y rotar el secreto (cambiar la variable en Vercel) si alguna vez se filtra.
 */

// Las herramientas usan el cliente de servicio de Supabase y el buscador de
// disponibilidad: necesitan Node, no el runtime edge.
export const runtime = "nodejs"
// Tope de tiempo: una consulta que se cuelga no deja la función corriendo sola.
export const maxDuration = 30

/** Cuántos mensajes se aceptan en un lote. Más que esto es abuso, no uso. */
const MAX_LOTE = 20

/**
 * El resultado del control de la puerta. El motivo NO sale nunca por la red
 * (afuera siempre es el mismo 404), pero sí queda en el log: sin esto, "no
 * encuentro nada" puede ser el secreto sin configurar en Vercel, uno demasiado
 * corto o uno equivocado, y son tres arreglos distintos.
 */
type Puerta = { ok: true } | { ok: false; motivo: string }

function controlarPuerta(req: NextRequest): Puerta {
  const esperado = process.env.MCP_SECRET
  // Sin secreto configurado, el endpoint queda cerrado (nunca abierto).
  if (!esperado) return { ok: false, motivo: "falta la variable MCP_SECRET en el servidor" }
  if (esperado.length < MIN_SECRET_LEN)
    return {
      ok: false,
      motivo:
        "el MCP_SECRET configurado es demasiado corto (" + esperado.length + " caracteres, " +
        "mínimo " + MIN_SECRET_LEN + "): el endpoint queda cerrado a propósito",
    }

  const auth = req.headers.get("authorization") ?? ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null
  const enLaUrl = req.nextUrl.searchParams.get("k")
  if (!bearer && !enLaUrl) return { ok: false, motivo: "no vino ningún secreto (ni encabezado ni ?k=)" }
  if (secretsMatch(bearer, esperado) || secretsMatch(enLaUrl, esperado)) return { ok: true }
  return { ok: false, motivo: "el secreto no coincide" }
}

/**
 * Sin el secreto, este endpoint se comporta como si no existiera: 404 pelado.
 * Un 401 confirmaría que acá hay algo; el 404 no dice nada. El motivo va al log
 * (nunca el valor del secreto, ni la URL con el `?k=`).
 */
function noExiste(metodo: string, motivo: string) {
  console.warn("[mcp] " + metodo + " rechazado: " + motivo)
  return new NextResponse("Not Found", { status: 404 })
}

export async function POST(req: NextRequest) {
  const puerta = controlarPuerta(req)
  if (!puerta.ok) return noExiste("POST", puerta.motivo)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, RPC_PARSE_ERROR, "El cuerpo no es JSON válido."), { status: 400 })
  }

  const tools = buildTools()

  // JSON-RPC permite mandar varios mensajes juntos (un lote).
  if (Array.isArray(body)) {
    if (body.length === 0)
      return NextResponse.json(rpcError(null, RPC_INVALID_REQUEST, "Lote vacío."), { status: 400 })
    if (body.length > MAX_LOTE)
      return NextResponse.json(
        rpcError(null, RPC_INVALID_REQUEST, "El lote trae demasiados mensajes (tope " + MAX_LOTE + ")."),
        { status: 400 }
      )
    const respuestas = []
    for (const msg of body) {
      // Un mensaje mal formado dentro del lote se contesta como error de ESE
      // mensaje y no tumba el lote entero.
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
        respuestas.push(rpcError(null, RPC_INVALID_REQUEST, "Mensaje JSON-RPC inválido."))
        continue
      }
      const r = await handleRpcMessage(msg as JsonRpcRequest, tools)
      if (r) respuestas.push(r)
    }
    // Un lote de puras notificaciones no lleva respuesta.
    if (respuestas.length === 0) return new NextResponse(null, { status: 202 })
    return NextResponse.json(respuestas)
  }

  if (!body || typeof body !== "object")
    return NextResponse.json(rpcError(null, RPC_INVALID_REQUEST, "Mensaje JSON-RPC inválido."), { status: 400 })

  const respuesta = await handleRpcMessage(body as JsonRpcRequest, tools)
  // Una notificación (sin `id`) no se contesta: 202 y nada más.
  if (!respuesta) return new NextResponse(null, { status: 202 })
  return NextResponse.json(respuesta)
}

/**
 * El transporte de MCP permite abrir un canal de eventos por GET. Este servidor
 * no lo necesita (contesta cada pedido al instante), y el protocolo dice que en
 * ese caso hay que devolver 405. Igual se exige el secreto antes: que el
 * endpoint exista no se confirma sin él.
 */
export async function GET(req: NextRequest) {
  const puerta = controlarPuerta(req)
  if (!puerta.ok) return noExiste("GET", puerta.motivo)
  return NextResponse.json(
    { error: "Este servidor no abre canal de eventos; mandá los pedidos por POST." },
    { status: 405 }
  )
}

/**
 * Los métodos que no se usan se declaran a propósito. Si no, Next los contesta
 * solo (OPTIONS devuelve la lista de métodos; el resto, 405) ANTES de pasar por
 * el control del secreto, y eso ya delata que acá hay un endpoint. Con el
 * secreto correcto sí se contesta 405, que es lo que espera un cliente de MCP.
 */
function cerrado(req: NextRequest) {
  const puerta = controlarPuerta(req)
  if (!puerta.ok) return noExiste(req.method, puerta.motivo)
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } })
}
export const OPTIONS = cerrado
export const HEAD = cerrado
export const PUT = cerrado
export const PATCH = cerrado
export const DELETE = cerrado
