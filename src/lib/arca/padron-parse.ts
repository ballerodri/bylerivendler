// Parseo puro de las respuestas del padrón A13 de ARCA (ws_sr_padron_a13).
//
// ⚠️ NADIE PUDO LLAMAR AL SERVICIO REAL TODAVÍA: el certificado de producción
// vive en Vercel y desde acá no se puede consultar. La forma EXACTA de la
// respuesta no está verificada. Por eso todo lo de este archivo es tolerante:
// aceptamos el sobre `personaReturn`, el objeto `persona` suelto, envoltorios
// con `metadata`, listas de un solo elemento y campos que pueden venir como
// número o como texto. La primera consulta real del salón confirma —o corrige—
// estas suposiciones.
//
// Este módulo es puro a propósito (no importa "server-only", no habla con la
// red): así se puede testear con fixtures.

export type PadronDocTipo = 80 | 96 // 80 = CUIT, 96 = DNI

export interface PadronPersona {
  doc: string
  docTipo: PadronDocTipo
  nombre: string
  condicionIva: number | null
  condicionIvaTexto: string | null
}

export type PadronErrorKind =
  | "no-autorizado"
  | "no-encontrado"
  | "arca-caido"
  | "config"
  | "entrada"

export type PadronResult =
  | { ok: true; persona: PadronPersona }
  | { ok: false; kind: PadronErrorKind; error: string }

// Los textos que ve la usuaria. Están acá para que sean uno solo y no se
// desincronicen entre la consulta y la pantalla.
export const MENSAJES: Record<PadronErrorKind, string> = {
  "no-autorizado":
    "El servicio de padrón todavía no está habilitado para este certificado. Puede tardar hasta 24 h desde que lo autorizaste en ARCA.",
  "no-encontrado": "ARCA no tiene a nadie con ese documento.",
  "arca-caido": "ARCA no responde. Probá de nuevo en un rato.",
  config:
    "Falta configurar ARCA en el servidor (certificado o variables de entorno). Avisale a soporte.",
  entrada: "Ingresá un DNI (8 dígitos) o un CUIT/CUIL (11 dígitos).",
}

// ---------------------------------------------------------------- utilidades

/** Deja sólo los dígitos: "20-30.123.456-7" -> "20301234567". */
export function normalizarDoc(input: string | null | undefined): string {
  return (input ?? "").replace(/\D+/g, "")
}

/**
 * Tipo de documento que hay que mandarle a ARCA en la factura según el largo
 * del documento que tengamos guardado o consultado.
 *   vacío                -> 99 (Consumidor Final, sin identificar)
 *   11 dígitos           -> 80 (CUIT/CUIL)
 *   cualquier otro largo -> 96 (DNI)
 * Los DNI viejos tienen 7 dígitos y son válidos, por eso no exigimos 8: el
 * único caso que cae en Consumidor Final es el documento vacío, igual que hoy.
 */
export function docTipoParaDocumento(doc: string | null | undefined): 99 | 96 | 80 {
  const d = normalizarDoc(doc)
  if (!d) return 99
  return d.length === 11 ? 80 : 96
}

function texto(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "number") return String(v)
  if (typeof v === "object" && "_" in (v as Record<string, unknown>)) {
    // xml2js a veces devuelve { _: "valor", $: { ...atributos } }
    return texto((v as Record<string, unknown>)._)
  }
  return ""
}

/**
 * MAYÚSCULAS y sin acentos, para comparar textos de ARCA sin sorpresas.
 * Sacamos las marcas de acento por código (U+0300 a U+036F) en vez de con una
 * expresión regular, para no meter caracteres combinantes en el código fuente.
 */
function clave(s: string): string {
  let out = ""
  for (const ch of s.normalize("NFD")) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x300 && cp <= 0x36f) continue
    out += ch
  }
  return out.toUpperCase()
}

function lista(v: unknown): unknown[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

// ------------------------------------------------------ condición ante el IVA

// Códigos de "condición frente al IVA del receptor" que exige ARCA en el
// comprobante (tabla FEParamGetCondicionIvaReceptor, RG 5616):
//    1 = IVA Responsable Inscripto
//    4 = IVA Sujeto Exento
//    5 = Consumidor Final
//    6 = Responsable Monotributo
//   13 = Monotributista Social
//   15 = Monotributo Trabajador Independiente Promovido
//
// El padrón A13 NO devuelve "la condición" en un campo: devuelve la lista de
// impuestos y categorías en las que la persona está inscripta. La deducimos de
// ahí mirando PRIMERO la descripción (más estable que los ids) y usando los ids
// conocidos sólo como respaldo:
//   idImpuesto 30 = IVA         -> Responsable Inscripto (1)
//   idImpuesto 32 = IVA EXENTO  -> Sujeto Exento (4)
//   idImpuesto 20 = Monotributo -> Responsable Monotributo (6)
//
// ⚠️ SUPOSICIÓN SIN VERIFICAR: tanto los ids como los textos exactos salen de
// la documentación del padrón, no de una respuesta real. Si no hay ninguna
// señal clara devolvemos null y el que factura cae al default de siempre
// (5 = Consumidor Final), que es exactamente lo que hace la app hoy.
const ETIQUETA_IVA: Record<number, string> = {
  1: "Responsable Inscripto",
  4: "Exento",
  5: "Consumidor Final",
  6: "Monotributista",
  13: "Monotributista social",
  15: "Monotributista promovido",
}

/** Nombre legible de un código de condición frente al IVA. */
export function etiquetaCondicionIva(codigo: number | null): string | null {
  if (codigo == null) return null
  return ETIQUETA_IVA[codigo] ?? `Código ${codigo}`
}

function estaActivo(entrada: Record<string, unknown>): boolean {
  const estado = clave(texto(entrada.estado ?? entrada.estadoImpuesto ?? entrada.estadoCategoria))
  if (!estado) return true // sin dato asumimos activo: ARCA no siempre lo manda
  return !(estado.includes("BAJA") || estado.includes("INACTIV") || estado.includes("EXCLU"))
}

function codigoPorTexto(desc: string, id: number | null): number | null {
  const t = clave(desc)
  // El orden importa: "MONOTRIBUTO SOCIAL" también contiene "MONOTRIBUTO".
  if (t.includes("MONOTRIBUTO SOCIAL")) return 13
  if (t.includes("TRABAJADOR INDEPENDIENTE PROMOVIDO") || t.includes("PROMOVIDO")) return 15
  if (t.includes("MONOTRIBUT") || t.includes("REGIMEN SIMPLIFICADO") || t.includes("SIMPLIF")) return 6
  if (/\bIVA\b/.test(t) && t.includes("EXENT")) return 4
  if (/\bIVA\b/.test(t)) return 1
  // Respaldo por id conocido, sólo si el texto no dijo nada.
  if (id === 20) return 6
  if (id === 32) return 4
  if (id === 30) return 1
  return null
}

/**
 * Deduce la condición frente al IVA a partir de los impuestos y categorías que
 * devuelve el padrón. Devuelve null si no hay señal clara (y entonces el que
 * factura cae al default de hoy: 5 = Consumidor Final).
 */
export function deducirCondicionIva(
  persona: Record<string, unknown>
): { codigo: number; texto: string } | null {
  const entradas = [
    ...lista(persona.impuesto ?? persona.impuestos),
    ...lista(persona.categoria ?? persona.categorias),
  ].filter(esObjeto)

  const codigos: number[] = []
  for (const e of entradas) {
    if (!estaActivo(e)) continue
    const desc = texto(e.descripcionImpuesto ?? e.descripcionCategoria ?? e.descripcion)
    const idTexto = texto(e.idImpuesto ?? e.idCategoria ?? e.id)
    const idNum = idTexto ? Number(idTexto) : NaN
    const codigo = codigoPorTexto(desc, Number.isFinite(idNum) ? idNum : null)
    if (codigo != null) codigos.push(codigo)
  }

  // Prioridad: si una persona figura a la vez como monotributista y como otra
  // cosa (pasa cuando quedan inscripciones viejas sin dar de baja), manda el
  // monotributo.
  for (const preferido of [13, 15, 6, 1, 4]) {
    if (codigos.includes(preferido)) {
      return { codigo: preferido, texto: ETIQUETA_IVA[preferido] }
    }
  }

  // Sin impuestos relevantes: si la clave es un CUIL (persona que sólo trabaja
  // en relación de dependencia) es Consumidor Final. SUPOSICIÓN documentada; en
  // la factura da lo mismo que devolver null, porque el default también es 5.
  if (clave(texto(persona.tipoClave)) === "CUIL") return { codigo: 5, texto: ETIQUETA_IVA[5] }

  return null
}

// ------------------------------------------------------------- persona (A13)

const LLAVES_SOBRE = ["personaReturn", "persona", "return", "personaList", "resultado"]

function pareceUnaPersona(o: Record<string, unknown>): boolean {
  return (
    "idPersona" in o ||
    "numeroDocumento" in o ||
    "razonSocial" in o ||
    "apellido" in o ||
    "tipoPersona" in o ||
    "nombre" in o
  )
}

function desenvolverPersona(raw: unknown, profundidad = 0): Record<string, unknown> | null {
  if (raw == null || profundidad > 6) return null
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const hallado = desenvolverPersona(item, profundidad + 1)
      if (hallado) return hallado
    }
    return null
  }
  if (!esObjeto(raw)) return null
  if (pareceUnaPersona(raw)) return raw

  // Primero los nombres de sobre conocidos, después cualquier hijo (menos
  // `metadata`, que es el sello de fecha/servidor y nunca trae a la persona).
  for (const llave of LLAVES_SOBRE) {
    if (llave in raw) {
      const hallado = desenvolverPersona(raw[llave], profundidad + 1)
      if (hallado) return hallado
    }
  }
  for (const [llave, valor] of Object.entries(raw)) {
    if (llave === "metadata") continue
    const hallado = desenvolverPersona(valor, profundidad + 1)
    if (hallado) return hallado
  }
  return null
}

function armarNombre(p: Record<string, unknown>): string {
  const razonSocial = texto(p.razonSocial)
  if (razonSocial) return razonSocial
  const nombre = texto(p.nombre)
  const apellido = texto(p.apellido)
  if (nombre && apellido) return `${nombre} ${apellido}`
  // Las personas jurídicas a veces traen la razón social en `nombre`.
  return nombre || apellido || ""
}

function elegirDocumento(p: Record<string, unknown>): { doc: string; docTipo: PadronDocTipo } | null {
  const idPersona = normalizarDoc(texto(p.idPersona) || texto(p.cuit) || texto(p.cuil))
  if (idPersona.length === 11) return { doc: idPersona, docTipo: 80 }

  const nroDoc = normalizarDoc(
    texto(p.numeroDocumento) || texto(p.nroDocumento) || texto(p.documento)
  )
  if (nroDoc.length === 11) return { doc: nroDoc, docTipo: 80 }
  if (nroDoc.length >= 6 && nroDoc.length <= 8) return { doc: nroDoc, docTipo: 96 }
  if (idPersona.length >= 6 && idPersona.length <= 8) return { doc: idPersona, docTipo: 96 }
  return null
}

/**
 * Saca la persona de la respuesta de `getPersona`, venga como venga.
 * Devuelve null si no hay nadie reconocible o si no tiene documento (que para
 * facturar es lo mismo que no haber encontrado a nadie).
 *
 * Ojo: si encontramos documento pero NO nombre, igual devolvemos la persona.
 * Es a propósito: mostrar "sin nombre + CUIT" le dice al salón que la consulta
 * anduvo y que lo que falló fue este parseo — mucho mejor para diagnosticar que
 * decirle "ARCA no tiene a nadie", que sería mentira.
 */
export function parsePersona(raw: unknown): PadronPersona | null {
  const p = desenvolverPersona(raw)
  if (!p) return null

  const doc = elegirDocumento(p)
  if (!doc) return null

  const condicion = deducirCondicionIva(p)
  return {
    doc: doc.doc,
    docTipo: doc.docTipo,
    nombre: armarNombre(p),
    condicionIva: condicion?.codigo ?? null,
    condicionIvaTexto: condicion?.texto ?? null,
  }
}

/**
 * Saca los CUIT de la respuesta de `getIdPersonaListByDocumento`. Junta
 * cualquier número de 11 dígitos que aparezca (menos dentro de `metadata`),
 * porque no sabemos si vienen como `{ idPersonaListReturn: { idPersona: [...] } }`,
 * como lista suelta o como un valor único.
 */
export function parseIdPersonaList(raw: unknown): string[] {
  const encontrados: string[] = []
  recolectarCuits(raw, encontrados, 0)
  return [...new Set(encontrados)]
}

function recolectarCuits(raw: unknown, out: string[], profundidad: number): void {
  if (raw == null || profundidad > 6) return
  if (Array.isArray(raw)) {
    for (const item of raw) recolectarCuits(item, out, profundidad + 1)
    return
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d = normalizarDoc(String(raw))
    if (d.length === 11) out.push(d)
    return
  }
  if (!esObjeto(raw)) return
  for (const [llave, valor] of Object.entries(raw)) {
    if (llave === "metadata") continue
    recolectarCuits(valor, out, profundidad + 1)
  }
}

// -------------------------------------------------- clasificación de errores

const PATRONES_NO_ENCONTRADO = [
  "no existe persona",
  "no existe la persona",
  "persona no encontrada",
  "id persona no encontrada",
  "sin datos para",
]

const PATRONES_NO_AUTORIZADO = [
  "no autorizado",
  "no esta autorizado",
  "no se encuentra autorizado",
  "sin autorizacion",
  "no posee autorizacion",
  "no tiene autorizacion",
  "acceso denegado",
  "notauthorized",
  "not authorized",
  "unauthorized",
  "access denied",
  "forbidden",
  "cee.notauthorized",
  "computador no autorizado",
  "delegacion",
]

const PATRONES_CONFIG = ["falta la variable de entorno"]

/**
 * Traduce el error crudo (excepción de red, fault de SOAP, mensaje de ARCA) a
 * uno de nuestros tipos. Todo lo que no reconocemos cuenta como "ARCA caído":
 * es el mensaje que invita a reintentar y nunca miente sobre la persona.
 */
export function classifyPadronError(e: unknown): PadronErrorKind {
  const crudo = e instanceof Error ? `${e.message} ${String(e.cause ?? "")}` : String(e)
  const msg = clave(crudo).toLowerCase()

  if (PATRONES_CONFIG.some((p) => msg.includes(p))) return "config"
  if (PATRONES_NO_ENCONTRADO.some((p) => msg.includes(p))) return "no-encontrado"
  if (PATRONES_NO_AUTORIZADO.some((p) => msg.includes(p))) return "no-autorizado"
  return "arca-caido"
}
