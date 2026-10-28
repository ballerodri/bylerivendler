import { NextRequest, NextResponse } from "next/server"
import {
  handleRpcMessage,
  rpcError,
  secretsMatch,
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
 * Puerta de entrada: un secreto (`MCP_SECRET`). Sin él no se contesta NADA —
 * ni la lista de herramientas. Se acepta de dos formas porque no todos los
 * clientes dejan mandar encabezados:
 *   1. `Authorization: Bearer <secreto>`  ← preferida
 *   2. `?k=<secreto>` en la URL           ← para clientes que sólo piden una URL
 * La (2) deja el secreto en los registros del servidor: usar la (1) si se puede,
 * y rotar el secreto (cambiar la variable en Vercel) si alguna vez se filtra.
 */

export const dynamic = "force-dynamic"
// Las herramientas usan el cliente de servicio de Supabase y el buscador de
// disponibilidad: necesitan Node, no el runtime edge.
export const runtime = "nodejs"

function estaAutorizado(req: NextRequest): boolean {
  const esperado = process.env.MCP_SECRET
  // Sin secreto configurado, el endpoint queda cerrado (nunca abierto).
  if (!esperado) return false

  const auth = req.headers.get("authorization") ?? ""
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null
  if (secretsMatch(bearer, esperado)) return true

  return secretsMatch(req.nextUrl.searchParams.get("k"), esperado)
}

function noAutorizado() {
  return NextResponse.json(
    { error: "No autorizado." },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="bylerivendler-mcp"' } }
  )
}

export async function POST(req: NextRequest) {
  if (!estaAutorizado(req)) return noAutorizado()

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
    const respuestas = []
    for (const msg of body) {
      const r = await handleRpcMessage((msg ?? {}) as JsonRpcRequest, tools)
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
 * endpoint exista no debería poder confirmarse sin él.
 */
export async function GET(req: NextRequest) {
  if (!estaAutorizado(req)) return noAutorizado()
  return NextResponse.json(
    { error: "Este servidor no abre canal de eventos; mandá los pedidos por POST." },
    { status: 405 }
  )
}
