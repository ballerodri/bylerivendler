import "server-only"
import * as soap from "soap"
import { getArcaConfig } from "./config"
import { getAuth } from "./auth"
import { buildFeCAEReq, type Auth, type InvoiceInput } from "./wsfe-payload"

export interface CaeResult {
  cae: string
  caeVto: string // yyyymmdd
  cbteNro: number
}

export async function getUltimoComprobante(
  auth: Auth,
  ptoVta: number,
  cbteTipo = 11,
  client?: soap.Client
): Promise<number> {
  const cfg = getArcaConfig()
  const soapClient = client ?? await soap.createClientAsync(cfg.wsfeUrl)
  const [res] = await soapClient.FECompUltimoAutorizadoAsync({
    Auth: auth,
    PtoVta: ptoVta,
    CbteTipo: cbteTipo,
  })
  return Number(res.FECompUltimoAutorizadoResult.CbteNro)
}

export async function solicitarCae(input: InvoiceInput): Promise<CaeResult> {
  const cfg = getArcaConfig()
  const auth = await getAuth("wsfe")
  const client = await soap.createClientAsync(cfg.wsfeUrl)
  const ultimo = await getUltimoComprobante(auth, input.ptoVta, 11, client)
  const cbteNro = ultimo + 1

  const [res] = await client.FECAESolicitarAsync(buildFeCAEReq(auth, input, cbteNro))
  const result = res.FECAESolicitarResult

  type ArcaItem = { Code: string | number; Msg: string }

  if (result.Errors) {
    const raw = result.Errors.Err
    const errs = (Array.isArray(raw) ? raw : [raw] as ArcaItem[])
      .map((e: ArcaItem) => `${e.Code}: ${e.Msg}`)
      .join("; ")
    throw new Error(`ARCA rechazó la factura: ${errs}`)
  }

  const detRaw = result.FeDetResp?.FECAEDetResponse
  const det = Array.isArray(detRaw) ? detRaw[0] : detRaw
  if (!det || det.Resultado !== "A") {
    const rawObs = det?.Observaciones?.Obs
    const obs = rawObs
      ? (Array.isArray(rawObs) ? rawObs : [rawObs] as ArcaItem[])
          .map((o: ArcaItem) => `${o.Code}: ${o.Msg}`)
          .join("; ")
      : "rechazada sin detalle"
    throw new Error(`ARCA no aprobó la factura: ${obs}`)
  }

  return { cae: det.CAE, caeVto: det.CAEFchVto, cbteNro }
}
