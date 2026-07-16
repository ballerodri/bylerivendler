import { describe, it, expect } from "vitest"
import { buildItinerary, spansMultipleDays, type PurchaseAppt } from "./purchase-itinerary"

// Helpers: instantes UTC que en Argentina (UTC-3) caen el 2026-07-17.
const AR = (hm: string) => `2026-07-17T${hm}:00.000Z` // 13:00Z = 10:00 AR
const leg = (
  startsAt: string | null,
  durationMin: number | null,
  serviceName: string | null,
  staffName: string | null = null
) => ({ startsAt, durationMin, serviceName, staffName })

// LA COMPRA DE LA USUARIA: pack (sesión 10:00) + portador con 3 patas
// (HIFU 10:30 · masaje 12:00 · reflexo 13:00). El itinerario NO separa
// pack de tratamientos: 4 filas cronológicas.
const packSession: PurchaseAppt = {
  id: "pack-1",
  startsAt: AR("13:00"), // 10:00 AR
  durationMin: 30,
  packPurchaseId: "pp-1",
  legs: [leg(AR("13:00"), 30, "Vela Slim Plus - 1 Zona", "Leri Vendler")],
}
const carrier: PurchaseAppt = {
  id: "carrier-1",
  startsAt: AR("13:30"), // 10:30 AR
  durationMin: 210,
  packPurchaseId: null,
  legs: [
    leg(AR("13:30"), 50, "HIFU Facial", "Leri Vendler"),
    leg(AR("15:00"), 60, "Masaje relajante", "Roman Otero"),
    leg(AR("16:00"), 60, "Reflexología", "Roman Otero"),
  ],
}

describe("buildItinerary — el itinerario unificado de la compra", () => {
  it("EL CASO DE LA USUARIA: pack + portador → 4 filas cronológicas, sin separar", () => {
    const rows = buildItinerary([carrier, packSession], "Vela Slim Plus")
    expect(rows.map((r) => [r.hm, r.label])).toEqual([
      ["10:00", "Sesión 1 · Vela Slim Plus"],
      ["10:30", "HIFU Facial"],
      ["12:00", "Masaje relajante"],
      ["13:00", "Reflexología"],
    ])
    // Cada fila sabe de qué turno salió (para cancelar / estados).
    expect(rows[0].apptId).toBe("pack-1")
    expect(rows[1].apptId).toBe("carrier-1")
    // Duración y profesional reales por fila.
    expect(rows[1].durationMin).toBe(50)
    expect(rows[2].staffName).toBe("Roman Otero")
  })

  it("las sesiones del pack se numeran por fecha (sesión 1 = la más temprana)", () => {
    const s2: PurchaseAppt = { ...packSession, id: "pack-2", startsAt: "2026-07-24T13:00:00.000Z" }
    const rows = buildItinerary([s2, packSession], "Vela")
    expect(rows[0].label).toBe("Sesión 1 · Vela")
    expect(rows[1].label).toBe("Sesión 2 · Vela")
  })

  it("sin nombre de pack usa 'Pack' (no rompe)", () => {
    const rows = buildItinerary([packSession], null)
    expect(rows[0].label).toBe("Sesión 1 · Pack")
  })

  it("turno de un solo servicio → una fila con la hora del turno", () => {
    const single: PurchaseAppt = {
      id: "a1",
      startsAt: AR("17:00"), // 14:00 AR
      durationMin: 60,
      packPurchaseId: null,
      legs: [leg(AR("17:00"), 60, "Masaje relajante", "Roman Otero")],
    }
    const rows = buildItinerary([single], null)
    expect(rows).toHaveLength(1)
    expect(rows[0].hm).toBe("14:00")
    expect(rows[0].label).toBe("Masaje relajante")
  })

  it("patas viejas sin hora → UNA fila con los nombres unidos a la hora del turno (no inventa horas)", () => {
    const old: PurchaseAppt = {
      id: "a2",
      startsAt: AR("17:00"),
      durationMin: 90,
      packPurchaseId: null,
      legs: [leg(null, 30, "Limpieza", null), leg(null, 60, "Masaje", null)],
    }
    const rows = buildItinerary([old], null)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe("Limpieza + Masaje")
    expect(rows[0].hm).toBe("14:00")
    expect(rows[0].durationMin).toBe(90)
  })

  it("separados en días distintos → filas ordenadas y spansMultipleDays = true", () => {
    const otherDay: PurchaseAppt = {
      id: "a3",
      startsAt: "2026-07-18T13:00:00.000Z",
      durationMin: 60,
      packPurchaseId: null,
      legs: [leg("2026-07-18T13:00:00.000Z", 60, "Masaje relajante", null)],
    }
    const rows = buildItinerary([otherDay, carrier], null)
    expect(rows[0].dateStr).toBe("2026-07-17")
    expect(rows[rows.length - 1].dateStr).toBe("2026-07-18")
    expect(spansMultipleDays(rows)).toBe(true)
    expect(spansMultipleDays(buildItinerary([carrier], null))).toBe(false)
  })

  it("patas sin nombre de servicio se ignoran; sin ninguna queda 'Tu tratamiento'", () => {
    const broken: PurchaseAppt = {
      id: "a4",
      startsAt: AR("17:00"),
      durationMin: 45,
      packPurchaseId: null,
      legs: [leg(AR("17:00"), 45, null, null)],
    }
    const rows = buildItinerary([broken], null)
    expect(rows[0].label).toBe("Tu tratamiento")
    expect(rows[0].durationMin).toBe(45)
  })
})
