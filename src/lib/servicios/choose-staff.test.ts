import { describe, it, expect } from "vitest"
import { chooseStaff } from "./choose-staff"

describe("chooseStaff", () => {
  it("sin candidatas devuelve null", () => {
    expect(chooseStaff([], {})).toBeNull()
  })

  it("una sola candidata: esa", () => {
    expect(chooseStaff(["leri"], { leri: 3 })).toBe("leri")
  })

  it("varias libres: la que tiene MENOS turnos ese día", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 5, marina: 2 })).toBe("marina")
  })

  it("empate de turnos: la primera de la lista (determinista)", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 2, marina: 2 })).toBe("roman")
  })

  it("una candidata sin turnos ese día cuenta como 0", () => {
    // marina no aparece en el mapa -> 0 turnos -> gana
    expect(chooseStaff(["roman", "marina"], { roman: 1 })).toBe("marina")
  })

  it("CONTINUIDAD: si la preferida está entre las candidatas, se la elige aunque tenga más turnos", () => {
    // marina es la preferida (sesión anterior del pack) y sigue disponible:
    // se la mantiene aunque roman tenga menos turnos.
    expect(chooseStaff(["roman", "marina"], { roman: 1, marina: 9 }, "marina")).toBe("marina")
  })

  it("la preferida ya NO está disponible: se cae al desempate normal", () => {
    // marina era la preferida pero no quedó entre las candidatas de este slot.
    expect(chooseStaff(["roman", "leri"], { roman: 4, leri: 1 }, "marina")).toBe("leri")
  })

  it("preferida null (primera sesión, sin preferencia): desempate normal", () => {
    expect(chooseStaff(["roman", "marina"], { roman: 3, marina: 1 }, null)).toBe("marina")
  })
})
