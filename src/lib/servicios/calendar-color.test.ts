import { describe, it, expect } from "vitest"
import { pickCalendarColorId, firstServiceIdOfVisit } from "./calendar-color"

describe("pickCalendarColorId — el servicio pesa más que la profesional", () => {
  it("con color del servicio, manda ese", () => {
    expect(pickCalendarColorId("5", "9")).toBe("5")
  })
  it("sin color del servicio, cae al de la profesional", () => {
    expect(pickCalendarColorId(null, "9")).toBe("9")
  })
  it("sin ninguno de los dos, no hay color (queda el del calendario)", () => {
    expect(pickCalendarColorId(null, null)).toBeNull()
    expect(pickCalendarColorId(undefined, undefined)).toBeNull()
  })
  it("un color vacío cuenta como sin color", () => {
    expect(pickCalendarColorId("", "9")).toBe("9")
    expect(pickCalendarColorId("", "")).toBeNull()
  })
})

describe("firstServiceIdOfVisit — manda el tratamiento que arranca la visita", () => {
  it("con varios encadenados, el más temprano", () => {
    expect(
      firstServiceIdOfVisit([
        { serviceId: "masaje", startsAtMs: 3_000 },
        { serviceId: "ultra", startsAtMs: 1_000 },
        { serviceId: "vela", startsAtMs: 2_000 },
      ])
    ).toBe("ultra")
  })
  it("con uno solo, ese", () => {
    expect(firstServiceIdOfVisit([{ serviceId: "ultra", startsAtMs: 1_000 }])).toBe("ultra")
  })
  it("ignora las patas sin servicio (servicio borrado)", () => {
    expect(
      firstServiceIdOfVisit([
        { serviceId: null, startsAtMs: 1_000 },
        { serviceId: "vela", startsAtMs: 2_000 },
      ])
    ).toBe("vela")
  })
  it("empate de horario: gana el primero de la lista (el orden del día)", () => {
    expect(
      firstServiceIdOfVisit([
        { serviceId: "ultra", startsAtMs: 1_000 },
        { serviceId: "vela", startsAtMs: 1_000 },
      ])
    ).toBe("ultra")
  })
  it("sin patas, no hay servicio", () => {
    expect(firstServiceIdOfVisit([])).toBeNull()
    expect(firstServiceIdOfVisit([{ serviceId: null, startsAtMs: 1 }])).toBeNull()
  })
})
