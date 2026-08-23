import { describe, it, expect } from "vitest"
import { diaFestejado, esCumpleHoy, cumplesDelMes, cumplesDeHoy } from "./birthdays"

const clienta = (over: Partial<{ id: string; first_name: string; last_name: string; phone: string | null; date_of_birth: string }>) => ({
  id: "c1",
  first_name: "Ana",
  last_name: "Pérez",
  phone: "1133643359",
  date_of_birth: "1990-08-23",
  ...over,
})

describe("diaFestejado", () => {
  it("un cumpleaños común se festeja el mismo día", () => {
    expect(diaFestejado("1990-08-23", 2026)).toBe("08-23")
  })
  it("el 29/02 se festeja el 28/02 en año no bisiesto", () => {
    expect(diaFestejado("1992-02-29", 2026)).toBe("02-28")
  })
  it("el 29/02 se festeja el 29/02 en año bisiesto", () => {
    expect(diaFestejado("1992-02-29", 2028)).toBe("02-29")
  })
})

describe("esCumpleHoy", () => {
  it("coincide por mes y día, sin importar el año de nacimiento", () => {
    expect(esCumpleHoy("1990-08-23", "2026-08-23")).toBe(true)
    expect(esCumpleHoy("1990-08-23", "2026-08-24")).toBe(false)
  })
  it("la nacida un 29/02 cumple el 28/02 en año no bisiesto", () => {
    expect(esCumpleHoy("1992-02-29", "2026-02-28")).toBe(true)
    expect(esCumpleHoy("1992-02-29", "2026-03-01")).toBe(false)
  })
})

describe("cumplesDelMes", () => {
  it("filtra por mes y ordena por día", () => {
    const res = cumplesDelMes(
      [
        clienta({ id: "a", first_name: "Zoe", date_of_birth: "1985-08-30" }),
        clienta({ id: "b", first_name: "Ana", date_of_birth: "1990-08-05" }),
        clienta({ id: "c", first_name: "Mia", date_of_birth: "1993-07-23" }),
      ],
      "2026-08-23"
    )
    expect(res.map((c) => c.id)).toEqual(["b", "a"])
    expect(res[0].day).toBe(5)
  })
  it("marca la que cumple hoy y calcula la edad", () => {
    const res = cumplesDelMes([clienta({ date_of_birth: "1990-08-23" })], "2026-08-23")
    expect(res[0].esHoy).toBe(true)
    expect(res[0].age).toBe(36)
  })
  it("no muestra edad con un año de nacimiento de relleno", () => {
    const res = cumplesDelMes([clienta({ date_of_birth: "1900-08-23" })], "2026-08-23")
    expect(res[0].age).toBeNull()
  })
  it("ordena por nombre dentro del mismo día", () => {
    const res = cumplesDelMes(
      [
        clienta({ id: "a", first_name: "Zoe" }),
        clienta({ id: "b", first_name: "Ana" }),
      ],
      "2026-08-01"
    )
    expect(res.map((c) => c.id)).toEqual(["b", "a"])
  })
})

describe("cumplesDeHoy", () => {
  it("sólo las del día", () => {
    const res = cumplesDeHoy(
      [
        clienta({ id: "a", date_of_birth: "1990-08-23" }),
        clienta({ id: "b", date_of_birth: "1990-08-24" }),
      ],
      "2026-08-23"
    )
    expect(res.map((c) => c.id)).toEqual(["a"])
  })
})
