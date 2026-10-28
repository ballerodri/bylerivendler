/**
 * El protocolo MCP (Model Context Protocol) sobre HTTP, en lo que necesita un
 * servidor de SÓLO LECTURA: initialize, tools/list, tools/call y ping. Es
 * JSON-RPC 2.0.
 *
 * Está escrito a mano (sin SDK) a propósito: la superficie es chica, no suma
 * dependencias a una app en producción, y deja la autenticación y los errores
 * bajo control. PURO: no toca la red ni la base — recibe un mensaje y una lista
 * de herramientas, y devuelve qué contestar. Así se puede testear entero.
 */

/** Versiones del protocolo que sabemos hablar (de más nueva a más vieja). */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

export const SERVER_INFO = { name: "bylerivendler", version: "1.0.0" } as const

/** Una herramienta: cómo se describe y qué hace. */
/**
 * Un error cuyo mensaje SÍ se le puede mostrar al asistente (y por lo tanto a
 * quien le escriba). Todo lo demás que se rompa se cuenta genérico.
 */
export class ErrorParaElAsistente extends Error {}

export type McpTool = {
  name: string
  /** Lo que lee el modelo para decidir cuándo usarla. En español: lo usa ella. */
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
  /** Devuelve el texto que ve el modelo. Si tira, se informa como error de herramienta. */
  run: (args: Record<string, unknown>) => Promise<string>
}

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// Códigos estándar de JSON-RPC 2.0.
export const RPC_PARSE_ERROR = -32700
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

/** La versión a usar: la que pide el cliente si la sabemos; si no, la nuestra. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION
}

/**
 * Contesta UN mensaje JSON-RPC. `null` significa "no se contesta nada" (es una
 * notificación: en JSON-RPC las notificaciones —sin `id`— no llevan respuesta).
 */
export async function handleRpcMessage(
  msg: JsonRpcRequest,
  tools: McpTool[]
): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined
  const id: JsonRpcId = msg.id ?? null

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? null : rpcError(id, RPC_INVALID_REQUEST, "Mensaje JSON-RPC inválido.")
  }

  switch (msg.method) {
    case "initialize": {
      if (isNotification) return null
      return ok(id, {
        protocolVersion: negotiateProtocolVersion(msg.params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }

    // Avisos del cliente que no esperan respuesta.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null

    case "ping":
      return isNotification ? null : ok(id, {})

    case "tools/list": {
      if (isNotification) return null
      return ok(id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })
    }

    case "tools/call": {
      if (isNotification) return null
      const name = msg.params?.name
      if (typeof name !== "string")
        return rpcError(id, RPC_INVALID_PARAMS, "Falta el nombre de la herramienta.")
      const tool = tools.find((t) => t.name === name)
      if (!tool) return rpcError(id, RPC_INVALID_PARAMS, `No existe la herramienta "${name}".`)

      const rawArgs = msg.params?.arguments
      const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>
      try {
        const text = await tool.run(args)
        return ok(id, { content: [{ type: "text", text }] })
      } catch (e) {
        // Un error DE LA HERRAMIENTA no es un error de protocolo: va como
        // resultado con `isError`, para que el modelo pueda leerlo y reintentar.
        // Pero sólo salen los mensajes escritos a propósito: cualquier otra
        // excepción (un fallo de red, una variable de entorno que falta) podría
        // contar cómo está armado el sistema, así que queda en el log del
        // servidor y afuera va algo genérico.
        if (e instanceof ErrorParaElAsistente)
          return ok(id, { content: [{ type: "text", text: e.message }], isError: true })
        console.error("[mcp] falló la herramienta " + String(name) + ":", e)
        return ok(id, {
          content: [{ type: "text", text: "No pude completar esa consulta. Probá de nuevo en un rato." }],
          isError: true,
        })
      }
    }

    default:
      return isNotification ? null : rpcError(id, RPC_METHOD_NOT_FOUND, `Método desconocido: ${msg.method}`)
  }
}

/** Un secreto más corto que esto se adivina probando: no se acepta nunca. */
export const MIN_SECRET_LEN = 24

/**
 * Compara dos secretos sin filtrar por CUÁNTO tardó la comparación (un `===`
 * corta en la primera letra distinta y deja adivinar el secreto de a poco).
 * Devuelve false si falta alguno: sin secreto configurado, no se entra. También
 * rechaza un secreto corto: si alguien configura `MCP_SECRET=hola`, el endpoint
 * queda cerrado en lugar de quedar abierto de hecho.
 */
export function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false
  if (expected.length < MIN_SECRET_LEN) return false
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
