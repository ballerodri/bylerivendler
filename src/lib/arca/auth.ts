import "server-only"
import * as soap from "soap"
import { parseStringPromise } from "xml2js"
import { getArcaConfig } from "./config"
import { buildTra, signTra } from "./wsaa-sign"
import { getStoredToken, saveToken } from "./token-store"
import type { Auth } from "./wsfe-payload"

export type { Auth } from "./wsfe-payload"

// Refresca 10 min antes del vencimiento real.
const SAFETY_MS = 10 * 60 * 1000

export async function getAuth(service = "wsfe"): Promise<Auth> {
  const cfg = getArcaConfig()

  const stored = await getStoredToken(service, cfg.env)
  if (stored && stored.expiresAt.getTime() - SAFETY_MS > Date.now()) {
    return { Token: stored.token, Sign: stored.sign, Cuit: cfg.cuit }
  }

  const tra = buildTra(service)
  const cms = signTra(tra, cfg.cert, cfg.key)

  let xml: string
  try {
    const client = await soap.createClientAsync(cfg.wsaaUrl)
    const [res] = await client.loginCmsAsync({ in0: cms })
    xml = res.loginCmsReturn as string
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("ya posee un TA") || msg.includes("alreadyAuthenticated")) {
      throw new Error(
        "ARCA aún tiene una sesión válida de antes pero no la tenemos guardada. " +
          "Esperá unos minutos y reintentá."
      )
    }
    throw new Error(`Error autenticando con ARCA (WSAA): ${msg}`)
  }

  const parsed = await parseStringPromise(xml, { explicitArray: false })
  const creds = parsed.loginTicketResponse.credentials
  const expiration = parsed.loginTicketResponse.header.expirationTime

  await saveToken(service, cfg.env, {
    token: creds.token,
    sign: creds.sign,
    expiresAt: new Date(expiration),
  })

  return { Token: creds.token, Sign: creds.sign, Cuit: cfg.cuit }
}
