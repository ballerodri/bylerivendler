// src/lib/arca/wsfe-payload.test.ts
import { describe, it, expect } from "vitest"
import { pesos, ymd, isoDateAr, buildFeCAEReq, type Auth, type InvoiceInput } from "./wsfe-payload"

const auth: Auth = { Token: "t", Sign: "s", Cuit: "20111111112" }

describe("helpers", () => {
  it("convierte centavos a pesos con 2 decimales", () => {
    expect(pesos(350000)).toBe(3500)
    expect(pesos(199)).toBe(1.99)
  })
  it("formatea fecha yyyymmdd", () => {
    expect(ymd(new Date("2026-06-19T12:00:00Z"))).toBe("20260619")
  })
  it("ymd usa zona horaria Argentina (01:30 UTC = 22:30 ART del día anterior)", () => {
    expect(ymd(new Date("2026-06-20T01:30:00Z"))).toBe("20260619")
  })
  it("isoDateAr devuelve yyyy-mm-dd en zona horaria Argentina", () => {
    expect(isoDateAr(new Date("2026-06-20T01:30:00Z"))).toBe("2026-06-19")
  })
})

describe("buildFeCAEReq", () => {
  const base: InvoiceInput = {
    ptoVta: 1,
    concepto: 2,
    docTipo: 99,
    docNro: "0",
    condIvaReceptor: 5,
    totalCents: 350000,
    fecha: new Date("2026-06-19T12:00:00Z"),
  }

  it("arma Factura C con neto = total e IVA 0", () => {
    const req: ReturnType<typeof buildFeCAEReq> = buildFeCAEReq(auth, base, 151)
    expect(req.FeCAEReq.FeCabReq.CbteTipo).toBe(11)
    expect(req.FeCAEReq.FeCabReq.PtoVta).toBe(1)
    const det = req.FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.CbteDesde).toBe(151)
    expect(det.CbteHasta).toBe(151)
    expect(det.ImpTotal).toBe(3500)
    expect(det.ImpNeto).toBe(3500)
    expect(det.ImpIVA).toBe(0)
    expect(det.CondicionIVAReceptorId).toBe(5)
  })

  it("incluye fechas de servicio cuando el concepto es servicios", () => {
    const det: ReturnType<typeof buildFeCAEReq>["FeCAEReq"]["FeDetReq"]["FECAEDetRequest"] =
      buildFeCAEReq(auth, base, 151).FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.FchServDesde).toBe("20260619")
    expect(det.FchServHasta).toBe("20260619")
    expect(det.FchVtoPago).toBe("20260619")
  })

  it("NO incluye fechas de servicio cuando el concepto es productos", () => {
    const det: ReturnType<typeof buildFeCAEReq>["FeCAEReq"]["FeDetReq"]["FECAEDetRequest"] =
      buildFeCAEReq(auth, { ...base, concepto: 1 }, 151).FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.FchServDesde).toBeUndefined()
  })
})
