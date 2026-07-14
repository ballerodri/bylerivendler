import { describe, it, expect } from "vitest"
import { assignableStaff, type BusyLeg } from "./availability"
import type { StaffServiceMap } from "./staff-services"

// facial: sólo Leri. masaje: Roman y Marina. depilacion: nadie cargado.
// hifu: sólo Ines, pero Ines está dada de baja (no aparece en ACTIVE).
const MAP: StaffServiceMap = {
  facial: ["leri"],
  masaje: ["roman", "marina"],
  depilacion: [],
  hifu: ["ines"],
}

const ACTIVE = ["leri", "roman", "marina"] // ines NO está activa

function leg(partial: Partial<BusyLeg>): BusyLeg {
  return { staffId: null, serviceId: "masaje", startMs: 0, endMs: 60, ...partial }
}

describe("assignableStaff", () => {
  it("sin ninguna pata encima, todas las candidatas quedan libres", () => {
    expect(assignableStaff(["leri", "roman"], [], MAP, ACTIVE)).toEqual(["leri", "roman"])
  })

  it("una pata CON nombre no hace nada acá: el llamador ya la sacó de candidates", () => {
    // "roman" ya no está en `candidates` porque el llamador lo filtró por
    // tener un turno propio encima; la pata con nombre es un no-op para
    // assignableStaff (sólo mira las anónimas).
    const legs = [leg({ staffId: "roman", serviceId: "masaje" })]
    expect(assignableStaff(["marina"], legs, MAP, ACTIVE)).toEqual(["marina"])
  })

  it("pata anónima de un servicio que hace UNA sola profesional: se la descuenta por nombre", () => {
    // La pata es de "facial" (sólo Leri lo hace). Leri es candidata para el
    // servicio que se está pidiendo ahora (ej: también hace "masaje").
    const legs = [leg({ staffId: null, serviceId: "facial" })]
    expect(assignableStaff(["leri", "roman"], legs, MAP, ACTIVE)).toEqual(["roman"])
  })

  it("pata anónima de un servicio que NINGUNA candidata hace: no reduce nada (bug corregido)", () => {
    // "hifu" lo hace Ines, que ni siquiera es una de nuestras candidatas.
    // Antes esto restaba una candidata "genérica"; ahora no debe afectar.
    const legs = [leg({ staffId: null, serviceId: "hifu" })]
    // Ines está dada de baja, así que ni siquiera cuenta como posible ocupante,
    // pero aunque estuviera activa tampoco debería afectar: no es candidata.
    expect(assignableStaff(["leri", "roman"], legs, MAP, ACTIVE)).toEqual(["leri", "roman"])
  })

  it("pata anónima ambigua (dos posibles) con dos candidatas: queda al menos una asignable", () => {
    const legs = [leg({ staffId: null, serviceId: "masaje" })] // roman o marina
    const result = assignableStaff(["roman", "marina"], legs, MAP, ACTIVE)
    expect(result.length).toBeGreaterThan(0)
  })

  it("la misma pata ambigua con UNA sola candidata: se rechaza el horario", () => {
    const legs = [leg({ staffId: null, serviceId: "masaje" })] // podría ser roman o marina
    expect(assignableStaff(["roman"], legs, MAP, ACTIVE)).toEqual([])
  })

  it("pata anónima de un servicio SIN nadie cargado: no reduce (possible vacío)", () => {
    const legs = [leg({ staffId: null, serviceId: "depilacion" })]
    expect(assignableStaff(["leri", "roman"], legs, MAP, ACTIVE)).toEqual(["leri", "roman"])
  })

  it("una profesional dada de baja queda excluida de `possible`: no reduce", () => {
    // "hifu" está asignado a Ines en el mapa, pero Ines no está en ACTIVE.
    const legs = [leg({ staffId: null, serviceId: "hifu" })]
    expect(assignableStaff(["roman"], legs, MAP, ACTIVE)).toEqual(["roman"])
  })
})
