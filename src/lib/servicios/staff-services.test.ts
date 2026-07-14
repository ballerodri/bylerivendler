import { describe, it, expect } from "vitest"
import {
  allowedStaffFor,
  serviceIsBookable,
  canStaffDoService,
  unbookableServiceIds,
  type StaffServiceMap,
} from "./staff-services"

const MAP: StaffServiceMap = {
  hifu: ["leri"],
  masaje: ["roman", "marina"],
  laser: [], // cargado pero sin nadie
}

describe("allowedStaffFor", () => {
  it("devuelve las profesionales que hacen el servicio", () => {
    expect(allowedStaffFor("masaje", MAP)).toEqual(["roman", "marina"])
  })

  it("un servicio sin nadie asignado devuelve vacío", () => {
    expect(allowedStaffFor("laser", MAP)).toEqual([])
  })

  it("un servicio que no está en el mapa devuelve vacío (fail-closed)", () => {
    expect(allowedStaffFor("desconocido", MAP)).toEqual([])
  })
})

describe("serviceIsBookable", () => {
  it("con al menos una profesional, sí", () => {
    expect(serviceIsBookable("hifu", MAP)).toBe(true)
  })

  it("sin nadie asignado, NO (regla estricta)", () => {
    expect(serviceIsBookable("laser", MAP)).toBe(false)
  })

  it("un servicio ausente del mapa, NO", () => {
    expect(serviceIsBookable("desconocido", MAP)).toBe(false)
  })
})

describe("canStaffDoService", () => {
  it("la profesional asignada, sí", () => {
    expect(canStaffDoService("roman", "masaje", MAP)).toBe(true)
  })

  it("una profesional que NO hace ese servicio, no", () => {
    // Este es EL bug: Roman no hace faciales.
    expect(canStaffDoService("roman", "hifu", MAP)).toBe(false)
  })

  it("nadie puede hacer un servicio sin asignaciones", () => {
    expect(canStaffDoService("leri", "laser", MAP)).toBe(false)
  })

  it('"auto" no es una profesional: no pasa el chequeo', () => {
    expect(canStaffDoService("auto", "hifu", MAP)).toBe(false)
  })
})

describe("unbookableServiceIds", () => {
  it("lista los que no tienen a nadie", () => {
    expect(unbookableServiceIds(["hifu", "masaje", "laser"], MAP)).toEqual(["laser"])
  })

  it("si están todos asignados, la lista es vacía", () => {
    expect(unbookableServiceIds(["hifu", "masaje"], MAP)).toEqual([])
  })

  it("conserva el orden en que se pidieron", () => {
    expect(unbookableServiceIds(["laser", "hifu", "otro"], MAP)).toEqual(["laser", "otro"])
  })
})
