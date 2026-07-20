import "server-only"
import { getArcaConfig } from "./config"
import { getAuth } from "./auth"
import { createArcaSoapClient } from "./soap-client"
import {
  MENSAJES,
  classifyPadronError,
  elegirCuitParaDocumento,
  mismoDocumento,
  normalizarDoc,
  parseIdPersonaList,
  parsePersona,
  type PadronResult,
} from "./padron-parse"

export type { PadronPersona, PadronResult, PadronErrorKind } from "./padron-parse"

// Nombre del servicio tal cual está autorizado en ARCA. El ticket se pide con
// `getAuth(SERVICIO)`: el token-store ya está indexado por servicio + entorno,
// así que el ticket del padrón NO pisa el de facturación.
const SERVICIO = "ws_sr_padron_a13"

// Si ARCA no contesta en este tiempo cortamos nosotros, en vez de dejar a la
// usuaria mirando un botón que gira hasta que se corta la función de Vercel.
const TIMEOUT_MS = 20_000

function conTimeout<T>(promesa: Promise<T>, que: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout: ARCA no respondió en ${TIMEOUT_MS / 1000} s (${que})`)),
      TIMEOUT_MS
    )
  })
  return Promise.race([promesa, limite]).finally(() => clearTimeout(timer))
}

// Recorta la respuesta cruda para poder loguearla sin llenar el log.
function paraLog(res: unknown): string {
  try {
    return JSON.stringify(res).slice(0, 2000)
  } catch {
    return String(res)
  }
}

const LLAVES_IMPUESTO = ["impuesto", "impuestos", "categoria", "categorias"]

/**
 * Busca en la respuesta cruda las listas de impuestos y categorías, vengan
 * donde vengan. Es sólo para el log: de ahí sale de qué se dedujo la condición
 * frente al IVA.
 */
function impuestosParaLog(raw: unknown, profundidad = 0): unknown[] {
  if (raw == null || profundidad > 6) return []
  if (Array.isArray(raw)) return raw.flatMap((i) => impuestosParaLog(i, profundidad + 1))
  if (typeof raw !== "object") return []
  const out: unknown[] = []
  for (const [llave, valor] of Object.entries(raw as Record<string, unknown>)) {
    if (llave === "metadata") continue
    if (LLAVES_IMPUESTO.includes(llave)) out.push(valor)
    else out.push(...impuestosParaLog(valor, profundidad + 1))
  }
  return out
}

/**
 * Consulta el padrón A13 de ARCA con un DNI (8 dígitos) o un CUIT/CUIL (11).
 *
 * ⚠️ SUPOSICIONES SIN VERIFICAR (no se puede llamar al servicio real desde el
 * entorno de desarrollo). La primera consulta del salón las confirma o las
 * corrige, y el `console.error` de abajo deja el error crudo para poder
 * arreglarlas:
 *   - Los métodos se llaman `getPersona` y `getIdPersonaListByDocumento`.
 *   - Los parámetros son `token`, `sign`, `cuitRepresentada` y, según el
 *     método, `idPersona` o `documento`.
 *   - La respuesta viene envuelta en `personaReturn` / `idPersonaListReturn`
 *     (el parseo de `padron-parse.ts` acepta varias formas por las dudas).
 *
 * NUNCA lanza: siempre devuelve un resultado. Facturar no puede romperse
 * porque el padrón ande mal.
 */
export async function consultarPadron(doc: string): Promise<PadronResult> {
  const documento = normalizarDoc(doc)
  if (documento.length !== 8 && documento.length !== 11) {
    return { ok: false, kind: "entrada", error: MENSAJES.entrada }
  }

  let cfg: ReturnType<typeof getArcaConfig>
  try {
    cfg = getArcaConfig()
  } catch (e) {
    console.error("[padron] falta configuración de ARCA:", e)
    return { ok: false, kind: "config", error: MENSAJES.config }
  }

  try {
    const auth = await conTimeout(getAuth(SERVICIO), "login WSAA")
    const client = await conTimeout(createArcaSoapClient(cfg.padronUrl), "WSDL del padrón")
    const base = { token: auth.Token, sign: auth.Sign, cuitRepresentada: cfg.cuit }

    // Con DNI hay un paso previo: pedirle a ARCA qué CUIT le corresponde.
    let idPersona = documento
    if (documento.length === 8) {
      const [lista] = await conTimeout<unknown[]>(
        client.getIdPersonaListByDocumentoAsync({ ...base, documento }),
        "getIdPersonaListByDocumento"
      )
      const cuits = parseIdPersonaList(lista)
      // De todos los números de 11 dígitos que trajo la respuesta nos quedamos
      // SÓLO con los que llevan adentro el DNI buscado: el resto puede ser el
      // CUIT del salón que ARCA nos devuelve de rebote o un id del pedido, y
      // con ése terminaríamos facturándole a otra persona.
      const elegido = elegirCuitParaDocumento(cuits, documento)
      if (!elegido) {
        console.error(
          "[padron] sin CUIT propio para el DNI",
          documento,
          "- candidatos descartados:",
          cuits.join(","),
          "- respuesta:",
          paraLog(lista)
        )
        return { ok: false, kind: "no-encontrado", error: MENSAJES["no-encontrado"] }
      }
      idPersona = elegido
    }

    const [res] = await conTimeout<unknown[]>(
      client.getPersonaAsync({ ...base, idPersona }),
      "getPersona"
    )
    const persona = parsePersona(res)
    if (!persona) {
      console.error("[padron] respuesta sin persona reconocible:", paraLog(res))
      return { ok: false, kind: "no-encontrado", error: MENSAJES["no-encontrado"] }
    }
    // Última barrera: que la persona que volvió siga siendo la que buscamos.
    // Si el CUIT que usamos no era de ella (o el parseo agarró un documento de
    // otro lado) preferimos "no encontrado" antes que emitir un CAE a nombre
    // equivocado, que sólo se deshace con una nota de crédito.
    if (!mismoDocumento(persona.doc, documento)) {
      console.error(
        `[padron] la persona devuelta (${persona.doc}) no coincide con lo buscado (${documento}) - respuesta:`,
        paraLog(res)
      )
      return { ok: false, kind: "no-encontrado", error: MENSAJES["no-encontrado"] }
    }

    if (!persona.nombre) {
      // Encontramos a alguien pero no le sacamos el nombre: el parseo se quedó
      // corto. Lo dejamos anotado con la respuesta cruda para poder corregirlo.
      console.error("[padron] persona sin nombre, revisar el parseo:", paraLog(res))
    }

    // Log del camino feliz A PROPÓSITO: deducir la condición frente al IVA es
    // la única suposición de todo esto que falla en silencio (sale una factura
    // igual, con la condición equivocada). Dejando acá lo que dedujimos junto a
    // los impuestos/categorías crudos, la primera clienta real que se facture
    // alcanza para confirmar o corregir el mapeo sin tener que reproducir nada.
    console.log(
      `[padron] ok ${persona.doc} cond=${persona.condicionIva ?? "null"} (${persona.condicionIvaTexto ?? "sin dato"}) - impuestos/categorias:`,
      paraLog(impuestosParaLog(res))
    )
    // Sabemos que el A13 no informa el régimen de un contribuyente activo (lo
    // elige el salón: `contribuyenteSinRegimen`). Sólo si NO es ese caso y aún
    // así no hay condición volcamos la respuesta CRUDA — sería una forma nueva
    // e inesperada — sin llenar el log con los datos personales de cada
    // contribuyente que se consulte.
    if (persona.condicionIva == null && !persona.contribuyenteSinRegimen) {
      console.log(`[padron] SIN CONDICION (forma inesperada) — cruda de ${persona.doc}:`, paraLog(res))
    }
    return { ok: true, persona }
  } catch (e) {
    const kind = classifyPadronError(e)
    console.error(`[padron] consulta fallida (${kind}) para ${documento}:`, e)
    return { ok: false, kind, error: MENSAJES[kind] }
  }
}
