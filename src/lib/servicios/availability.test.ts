import { describe, it, expect } from "vitest"
import { assignableStaff, buildBusyLegs, type BusyLeg, type ApptRow } from "./availability"
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

  it("pata anónima ambigua (dos posibles) con dos candidatas: quedan AMBAS asignables", () => {
    const legs = [leg({ staffId: null, serviceId: "masaje" })] // roman o marina
    // Ninguna de las dos está "seguro ocupada" (la pata podría ser de
    // cualquiera): con las DOS candidatas todavía en pie, no hay "presión"
    // real que saque a alguna — se ofrecen las dos.
    expect(assignableStaff(["roman", "marina"], legs, MAP, ACTIVE)).toEqual(["roman", "marina"])
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

  // ── "No más sobre-conservadurismo": ejercitan el guard
  // `possible.length > 1 && !some(id => free.includes(id))`, no el de
  // `possible.length === 0`. Borrando ese guard (volviendo a contar CUALQUIER
  // pata ambigua como "presión", pertenezca o no a nuestras candidatas) estos
  // dos casos empiezan a fallar (antes pasaban igual sin ejercitarlo). ──
  it("una pata anónima ambigua de un servicio que NINGUNA de nuestras candidatas hace no resta presión", () => {
    // La pata es de "masaje" (roman o marina): ninguna de las dos es
    // candidata acá (se pide un servicio que sólo hace Leri). La pata es
    // ambigua en abstracto, pero no nos afecta: no ejerce presión sobre "leri".
    const legs = [leg({ staffId: null, serviceId: "masaje" })]
    expect(assignableStaff(["leri"], legs, MAP, ACTIVE)).toEqual(["leri"])
  })

  it("misma situación con TRES patas anónimas ambiguas superpuestas: sigue sin afectar", () => {
    const legs = [
      leg({ staffId: null, serviceId: "masaje" }),
      leg({ staffId: null, serviceId: "masaje" }),
      leg({ staffId: null, serviceId: "masaje" }),
    ]
    expect(assignableStaff(["leri"], legs, MAP, ACTIVE)).toEqual(["leri"])
  })

  // ── Bug #2: una pata anónima "acorralada" por una profesional ya ocupada
  // con nombre en la MISMA ventana tiene que contarse como "seguro de la
  // otra", no como ambigua. ──
  it("pata anónima ambigua ACORRALADA: si una de sus posibles dueñas ya está ocupada con nombre, la pata es de la otra", () => {
    // Roman tiene un masaje CON SU NOMBRE en esta ventana. Hay además una
    // pata ANÓNIMA de masaje superpuesta: sólo puede ser de Roman o Marina,
    // pero Roman ya está descartada ⇒ tiene que ser de Marina.
    const legs = [
      leg({ staffId: "roman", serviceId: "masaje" }),
      leg({ staffId: null, serviceId: "masaje" }),
    ]
    // Se pide un servicio que hacen (hipotéticamente) Marina y Leri.
    expect(assignableStaff(["marina", "leri"], legs, MAP, ACTIVE)).toEqual(["leri"])
  })

  it("si TODAS las posibles dueñas de una pata anónima ya están ocupadas con nombre, la pata no resta nada extra", () => {
    // Tanto Roman como Marina ya están ocupados con nombre en esta ventana:
    // la pata anónima de masaje no puede ser de nadie más (ya estaban
    // descontados por su propio nombre, no por esta pata).
    const legs = [
      leg({ staffId: "roman", serviceId: "masaje" }),
      leg({ staffId: "marina", serviceId: "masaje" }),
      leg({ staffId: null, serviceId: "masaje" }),
    ]
    expect(assignableStaff(["leri"], legs, MAP, ACTIVE)).toEqual(["leri"])
  })
})

describe("buildBusyLegs", () => {
  const APPT_START = "2026-07-13T17:00:00.000Z" // 14:00 ART
  const APPT_DURATION = 120

  it("una cadena partida (facial 14-15 + masaje 15-16) produce DOS patas, cada una con su propia profesional y ventana", () => {
    const rows: ApptRow[] = [
      {
        id: "a1",
        starts_at: APPT_START,
        duration_min: APPT_DURATION, // el turno "portador" suma 120 min
        staff_id: "leri", // y sólo guarda la profesional del PRIMER servicio
        appointment_services: [
          { service_id: "facial", staff_id: "leri", starts_at: APPT_START, duration_min: 60 },
          { service_id: "masaje", staff_id: "roman", starts_at: "2026-07-13T18:00:00.000Z", duration_min: 60 },
        ],
      },
    ]
    const legs = buildBusyLegs(rows)
    expect(legs).toEqual([
      {
        staffId: "leri",
        serviceId: "facial",
        startMs: new Date("2026-07-13T17:00:00.000Z").getTime(),
        endMs: new Date("2026-07-13T18:00:00.000Z").getTime(),
      },
      {
        staffId: "roman",
        serviceId: "masaje",
        startMs: new Date("2026-07-13T18:00:00.000Z").getTime(),
        endMs: new Date("2026-07-13T19:00:00.000Z").getTime(),
      },
    ])
  })

  it("un turno SIN filas en appointment_services cae a UNA pata con el turno entero y serviceId desconocido", () => {
    const rows: ApptRow[] = [
      { id: "a2", starts_at: APPT_START, duration_min: APPT_DURATION, staff_id: "leri", appointment_services: [] },
    ]
    expect(buildBusyLegs(rows)).toEqual([
      {
        staffId: "leri",
        serviceId: "",
        startMs: new Date(APPT_START).getTime(),
        endMs: new Date(APPT_START).getTime() + APPT_DURATION * 60_000,
      },
    ])
  })

  it("una pata con staff_id null queda anónima", () => {
    const rows: ApptRow[] = [
      {
        id: "a3",
        starts_at: APPT_START,
        duration_min: 60,
        staff_id: null,
        appointment_services: [
          { service_id: "masaje", staff_id: null, starts_at: APPT_START, duration_min: 60 },
        ],
      },
    ]
    expect(buildBusyLegs(rows)[0].staffId).toBeNull()
  })

  it("si a CUALQUIER pata del turno le falta starts_at, TODAS sus patas usan la ventana completa del turno (no la de cada servicio)", () => {
    const rows: ApptRow[] = [
      {
        id: "a4",
        starts_at: APPT_START,
        duration_min: APPT_DURATION, // 120 min: 14:00-16:00
        staff_id: "leri",
        appointment_services: [
          { service_id: "facial", staff_id: "leri", starts_at: APPT_START, duration_min: 60 },
          // Sin starts_at (columna agregada por una migración posterior): no
          // se puede confiar en re-escalonar cada pata por separado sin dejar
          // la COLA del turno (este masaje) libre por error.
          { service_id: "masaje", staff_id: "roman", starts_at: null, duration_min: 60 },
        ],
      },
    ]
    const apptStart = new Date(APPT_START).getTime()
    const apptEnd = apptStart + APPT_DURATION * 60_000
    expect(buildBusyLegs(rows)).toEqual([
      { staffId: "leri", serviceId: "facial", startMs: apptStart, endMs: apptEnd },
      { staffId: "roman", serviceId: "masaje", startMs: apptStart, endMs: apptEnd },
    ])
  })
})
