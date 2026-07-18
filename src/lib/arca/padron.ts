import "server-only"
import { getArcaConfig } from "./config"
import { getAuth } from "./auth"
import { createArcaSoapClient } from "./soap-client"
import {
  MENSAJES,
  classifyPadronError,
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
      if (cuits.length === 0) {
        console.error("[padron] sin CUIT para el DNI", documento, "- respuesta:", paraLog(lista))
        return { ok: false, kind: "no-encontrado", error: MENSAJES["no-encontrado"] }
      }
      // Si hay más de uno (pasa con CUIT/CUIL duplicados) va el primero.
      idPersona = cuits[0]
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
    if (!persona.nombre) {
      // Encontramos a alguien pero no le sacamos el nombre: el parseo se quedó
      // corto. Lo dejamos anotado con la respuesta cruda para poder corregirlo.
      console.error("[padron] persona sin nombre, revisar el parseo:", paraLog(res))
    }
    return { ok: true, persona }
  } catch (e) {
    const kind = classifyPadronError(e)
    console.error(`[padron] consulta fallida (${kind}) para ${documento}:`, e)
    return { ok: false, kind, error: MENSAJES[kind] }
  }
}
