import { describe, it, expect } from "vitest"
import { pesosToCents, ddmmyyyy, receptorDocLabel, fmtMoneyCents } from "./format"

describe("pesosToCents", () => {
  it("convierte pesos a centavos redondeando", () => {
    expect(pesosToCents(3500)).toBe(350000)
    expect(pesosToCents(19.99)).toBe(1999)
    expect(pesosToCents(0.1)).toBe(10)
  })
})

describe("ddmmyyyy", () => {
  it("formatea una fecha ISO a dd/mm/yyyy", () => {
    expect(ddmmyyyy("2026-06-19")).toBe("19/06/2026")
  })
})

describe("receptorDocLabel", () => {
  it("etiqueta según el tipo de documento", () => {
    expect(receptorDocLabel(99, "0")).toBe("Consumidor Final")
    expect(receptorDocLabel(96, "30123456")).toBe("DNI 30123456")
    expect(receptorDocLabel(80, "20304050607")).toBe("CUIT 20304050607")
  })
})

describe("fmtMoneyCents", () => {
  it("formatea centavos con 2 decimales en es-AR", () => {
    expect(fmtMoneyCents(350050)).toBe("$3.500,50")
    expect(fmtMoneyCents(100)).toBe("$1,00")
  })
})
