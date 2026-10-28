import { describe, it, expect } from "vitest"
import { fueRealizado, estadoFacturacion, numeroComprobante, type InvoiceLite } from "./billing-status"

const NOW = Date.parse("2026-07-20T15:00:00.000Z")
const ANTES = "2026-07-20T14:00:00.000Z"
const DESPUES = "2026-07-20T16:00:00.000Z"

const appt = { id: "a1", total_cents: 1000000, pack_purchase_id: null, combo_purchase_id: null }

function factura(over: Partial<InvoiceLite> = {}): InvoiceLite {
  return { id: "f1", appointment_id: "a1", cbte_tipo: 11, cbte_nro: 123, pto_vta: 1, estado: "emitida", anulada: false, ...over }
}

describe("fueRealizado", () => {
  it("confirmado, en curso y completado con la hora pasada, sí", () => {
    expect(fueRealizado("confirmed", ANTES, NOW)).toBe(true)
    expect(fueRealizado("in_progress", ANTES, NOW)).toBe(true)
    expect(fueRealizado("completed", ANTES, NOW)).toBe(true)
  })

  it("un confirmado que todavía no llegó, no", () => {
    expect(fueRealizado("confirmed", DESPUES, NOW)).toBe(false)
  })

  it("pendiente, cancelado o no vino, nunca", () => {
    expect(fueRealizado("pending", ANTES, NOW)).toBe(false)
    expect(fueRealizado("cancelled", ANTES, NOW)).toBe(false)
    expect(fueRealizado("no_show", ANTES, NOW)).toBe(false)
  })
})

describe("estadoFacturacion", () => {
  it("sin facturas, sin facturar", () => {
    expect(estadoFacturacion(appt, [])).toEqual({ tipo: "sin_facturar", anulada: false })
  })

  it("con una Factura C viva, facturado", () => {
    const f = factura()
    expect(estadoFacturacion(appt, [f])).toEqual({ tipo: "facturado", invoice: f })
  })

  it("una factura anulada + su nota de crédito: otra vez sin facturar, marcada como anulada", () => {
    const r = estadoFacturacion(appt, [
      factura({ anulada: true }),
      factura({ id: "nc", cbte_tipo: 13 }),
    ])
    expect(r).toEqual({ tipo: "sin_facturar", anulada: true })
  })

  it("una factura con error o pendiente de ARCA no cuenta", () => {
    expect(estadoFacturacion(appt, [factura({ estado: "error" })]).tipo).toBe("sin_facturar")
    expect(estadoFacturacion(appt, [factura({ estado: "pendiente" })]).tipo).toBe("sin_facturar")
  })

  it("anulada y vuelta a facturar: facturado con la nueva", () => {
    const nueva = factura({ id: "f2", cbte_nro: 124 })
    expect(estadoFacturacion(appt, [factura({ anulada: true }), nueva])).toEqual({ tipo: "facturado", invoice: nueva })
  })

  it("un turno en $0 no se factura, con el motivo", () => {
    expect(estadoFacturacion({ ...appt, total_cents: 0, pack_purchase_id: "p" }, [])).toEqual({ tipo: "no_aplica", motivo: "pack" })
    expect(estadoFacturacion({ ...appt, total_cents: 0, combo_purchase_id: "c" }, [])).toEqual({ tipo: "no_aplica", motivo: "programa" })
    expect(estadoFacturacion({ ...appt, total_cents: 0 }, [])).toEqual({ tipo: "no_aplica", motivo: "cero" })
  })
})

describe("numeroComprobante", () => {
  it("rellena punto de venta y número", () => {
    expect(numeroComprobante({ pto_vta: 2, cbte_nro: 45 })).toBe("0002-00000045")
  })
})
