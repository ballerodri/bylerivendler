import { describe, it, expect } from "vitest"
import {
  handleRpcMessage,
  negotiateProtocolVersion,
  secretsMatch,
  MIN_SECRET_LEN,
  ErrorParaElAsistente,
  LATEST_PROTOCOL_VERSION,
  RPC_METHOD_NOT_FOUND,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  type McpTool,
} from "./protocol"

const tools: McpTool[] = [
  {
    name: "agenda_del_dia",
    description: "Los turnos de un día.",
    inputSchema: { type: "object", properties: { fecha: { type: "string" } } },
    run: async (args) => `agenda de ${args.fecha ?? "hoy"}`,
  },
  {
    name: "rompe",
    description: "Falla siempre con algo que NO se puede mostrar afuera.",
    inputSchema: { type: "object", properties: {} },
    run: async () => { throw new Error("relation \"clients\" does not exist") },
  },
  {
    name: "avisa",
    description: "Falla con un mensaje escrito a propósito.",
    inputSchema: { type: "object", properties: {} },
    run: async () => { throw new ErrorParaElAsistente("Esa fecha ya pasó.") },
  },
]

describe("initialize", () => {
  it("responde con la versión que pide el cliente si la sabemos hablar", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      tools
    )
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05")
  })
  it("con una versión desconocida ofrece la nuestra", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
      tools
    )
    expect((r!.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })
  it("avisa que tiene herramientas", async () => {
    const r = await handleRpcMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, tools)
    expect((r!.result as { capabilities: object }).capabilities).toEqual({ tools: {} })
  })
})

describe("notificaciones (sin id) no se contestan", () => {
  it("notifications/initialized", async () => {
    expect(await handleRpcMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, tools)).toBeNull()
  })
  it("un método cualquiera sin id tampoco", async () => {
    expect(await handleRpcMessage({ jsonrpc: "2.0", method: "lo/que/sea" }, tools)).toBeNull()
  })
})

describe("tools/list", () => {
  it("lista las herramientas con su esquema", async () => {
    const r = await handleRpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools)
    const listed = (r!.result as { tools: { name: string }[] }).tools
    expect(listed.map((t) => t.name)).toEqual(["agenda_del_dia", "rompe", "avisa"])
  })
  it("NO expone la función interna, sólo lo que el modelo necesita", async () => {
    const r = await handleRpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools)
    const first = (r!.result as { tools: Record<string, unknown>[] }).tools[0]
    expect(Object.keys(first).sort()).toEqual(["description", "inputSchema", "name"])
  })
})

describe("tools/call", () => {
  it("ejecuta y devuelve el texto", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agenda_del_dia", arguments: { fecha: "2026-10-28" } } },
      tools
    )
    expect(r!.result).toEqual({ content: [{ type: "text", text: "agenda de 2026-10-28" }] })
  })
  it("sin argumentos usa un objeto vacío (no rompe)", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agenda_del_dia" } },
      tools
    )
    expect(r!.result).toEqual({ content: [{ type: "text", text: "agenda de hoy" }] })
  })
  it("una herramienta que falla devuelve isError, no un error de protocolo", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rompe" } },
      tools
    )
    expect(r!.error).toBeUndefined()
    expect(r!.result).toEqual({
      content: [{ type: "text", text: "No pude completar esa consulta. Probá de nuevo en un rato." }],
      isError: true,
    })
  })
  it("un error inesperado NO cuenta nada del sistema (ni tablas ni columnas)", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "rompe" } },
      tools
    )
    const texto = (r!.result as { content: { text: string }[] }).content[0].text
    expect(texto).not.toContain("clients")
    expect(texto).not.toContain("relation")
  })
  it("un mensaje escrito a propósito SÍ sale tal cual", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 45, method: "tools/call", params: { name: "avisa" } },
      tools
    )
    expect(r!.result).toEqual({ content: [{ type: "text", text: "Esa fecha ya pasó." }], isError: true })
  })
  it("una herramienta inexistente es error de parámetros", async () => {
    const r = await handleRpcMessage(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "borrar_todo" } },
      tools
    )
    expect(r!.error?.code).toBe(RPC_INVALID_PARAMS)
  })
})

describe("mensajes inválidos", () => {
  it("método desconocido", async () => {
    const r = await handleRpcMessage({ jsonrpc: "2.0", id: 6, method: "resources/list" }, tools)
    expect(r!.error?.code).toBe(RPC_METHOD_NOT_FOUND)
  })
  it("sin jsonrpc 2.0", async () => {
    const r = await handleRpcMessage({ id: 7, method: "ping" }, tools)
    expect(r!.error?.code).toBe(RPC_INVALID_REQUEST)
  })
})

describe("secretsMatch — la puerta de entrada", () => {
  const BUENO = "secreto-largo-de-prueba-0123456789"
  it("acepta el secreto correcto", () => {
    expect(secretsMatch(BUENO, BUENO)).toBe(true)
  })
  it("rechaza uno distinto, uno vacío o la falta de configuración", () => {
    expect(secretsMatch(BUENO.slice(0, -1) + "X", BUENO)).toBe(false)
    expect(secretsMatch("", BUENO)).toBe(false)
    expect(secretsMatch(BUENO, "")).toBe(false)
    expect(secretsMatch(null, BUENO)).toBe(false)
    expect(secretsMatch(BUENO, undefined)).toBe(false)
    expect(secretsMatch(undefined, undefined)).toBe(false)
  })
  it("rechaza un prefijo correcto (no alcanza con adivinar el principio)", () => {
    expect(secretsMatch(BUENO.slice(0, 5), BUENO)).toBe(false)
  })
  it("rechaza un secreto corto aunque coincida: mejor cerrado que adivinable", () => {
    expect(secretsMatch("hola", "hola")).toBe(false)
    expect("x".repeat(MIN_SECRET_LEN).length).toBe(MIN_SECRET_LEN)
    expect(secretsMatch("x".repeat(MIN_SECRET_LEN), "x".repeat(MIN_SECRET_LEN))).toBe(true)
    expect(secretsMatch("x".repeat(MIN_SECRET_LEN - 1), "x".repeat(MIN_SECRET_LEN - 1))).toBe(false)
  })
})

describe("negotiateProtocolVersion", () => {
  it("cae a la nuestra con basura", () => {
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(42)).toBe(LATEST_PROTOCOL_VERSION)
  })
})
