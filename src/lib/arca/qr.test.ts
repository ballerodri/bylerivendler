import { describe, it, expect } from "vitest"
import { buildQrUrl } from "./qr"

describe("buildQrUrl", () => {
  it("codifica el payload oficial en base64 dentro de la URL de ARCA", () => {
    const url = buildQrUrl({
      fecha: "2026-06-19",
      cuit: 20111111112,
      ptoVta: 1,
      tipoCmp: 11,
      nroCmp: 150,
      importe: 3500,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      codAut: 73429843294823,
    })
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true)
    const b64 = url.split("?p=")[1]
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    expect(json.ver).toBe(1)
    expect(json.tipoCodAut).toBe("E")
    expect(json.codAut).toBe(73429843294823)
    expect(json.importe).toBe(3500)
  })
})
