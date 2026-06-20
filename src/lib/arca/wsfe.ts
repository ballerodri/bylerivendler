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
  cbteTipo = 11
): Promise<number> {
  const cfg = getArcaConfig()
  const client = await soap.createClientAsync(cfg.wsfeUrl)
  const [res] = await client.FECompUltimoAutorizadoAsync({
    Auth: auth,
    PtoVta: ptoVta,
    CbteTipo: cbteTipo,
  })
  return Number(res.FECompUltimoAutorizadoResult.CbteNro)
}

export async function solicitarCae(input: InvoiceInput): Promise<CaeResult> {
  const cfg = getArcaConfig()
  const auth = await getAuth("wsfe")
  const ultimo = await getUltimoComprobante(auth, input.ptoVta)
  const cbteNro = ultimo + 1

  const client = await soap.createClientAsync(cfg.wsfeUrl)
  const [res] = await client.FECAESolicitarAsync(buildFeCAEReq(auth, input, cbteNro))
  const result = res.FECAESolicitarResult

  if (result.Errors) {
    const errs = ([] as any[])
      .concat(result.Errors.Err)
      .map((e) => `${e.Code}: ${e.Msg}`)
      .join("; ")
    throw new Error(`ARCA rechazó la factura: ${errs}`)
  }

  const det = result.FeDetResp.FECAEDetResponse
  if (det.Resultado !== "A") {
    const obs = det.Observaciones
      ? ([] as any[])
          .concat(det.Observaciones.Obs)
          .map((o) => `${o.Code}: ${o.Msg}`)
          .join("; ")
      : "rechazada sin detalle"
    throw new Error(`ARCA no aprobó la factura: ${obs}`)
  }

  return { cae: det.CAE, caeVto: det.CAEFchVto, cbteNro }
}
