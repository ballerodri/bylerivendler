import { describe, it, expect } from "vitest"
import { parseDob } from "./dob"

describe("parseDob", () => {
  it("acepta DD/MM/YYYY y lo pasa a ISO", () => {
    expect(parseDob("12/05/1990")).toBe("1990-05-12")
  })

  it("rellena con cero un día/mes de un dígito", () => {
    expect(parseDob("3/7/1988")).toBe("1988-07-03")
  })

  it("ignora espacios", () => {
    expect(parseDob(" 12 / 05 / 1990 ")).toBe("1990-05-12")
  })

  it("acepta lo que manda un <input type=date> (YYYY-MM-DD)", () => {
    expect(parseDob("1990-05-12")).toBe("1990-05-12")
  })

  it("recorta una hora pegada a la fecha ISO", () => {
    expect(parseDob("1990-05-12T00:00:00")).toBe("1990-05-12")
  })

  it("vacío o inválido devuelve null", () => {
    expect(parseDob("")).toBeNull()
    expect(parseDob("   ")).toBeNull()
    expect(parseDob("no es fecha")).toBeNull()
    expect(parseDob("12-05-1990")).toBeNull()
  })
})
