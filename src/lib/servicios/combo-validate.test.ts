import { describe, it, expect } from "vitest"
import { validateComboInput, type ComboInputShape } from "./combo-validate"

const base: ComboInputShape = {
  name: "Programa Reductor",
  totalPriceCents: 150_000_00,
  services: [
    { serviceId: "a", sessions: 4 },
    { serviceId: "b", sessions: 4 },
  ],
}

describe("validateComboInput", () => {
  it("un input válido devuelve null", () => {
    expect(validateComboInput(base)).toBeNull()
  })
  it("nombre vacío", () => {
    expect(validateComboInput({ ...base, name: "  " })).toMatch(/nombre/i)
  })
  it("precio 0 o negativo", () => {
    expect(validateComboInput({ ...base, totalPriceCents: 0 })).toMatch(/precio/i)
  })
  it("menos de 2 servicios", () => {
    expect(validateComboInput({ ...base, services: [{ serviceId: "a", sessions: 1 }] })).toMatch(/2 servicios/i)
  })
  it("servicio duplicado", () => {
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 1 }, { serviceId: "a", sessions: 2 },
    ] })).toMatch(/duplicad/i)
  })
  it("sesiones menor a 1 o no entero", () => {
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 0 }, { serviceId: "b", sessions: 1 },
    ] })).toMatch(/sesiones/i)
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 1.5 }, { serviceId: "b", sessions: 1 },
    ] })).toMatch(/sesiones/i)
  })
})
