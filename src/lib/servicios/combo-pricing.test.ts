import { describe, it, expect } from "vitest"
import { comboIndividualCents, comboSavingsCents, comboTotalSessions } from "./combo-pricing"

describe("comboIndividualCents", () => {
  it("suma precio × sesiones por servicio", () => {
    // Ultra $30.000 ×4 + Vela $25.000 ×4 = 120.000 + 100.000 = 220.000
    expect(comboIndividualCents([
      { priceCents: 3_000_000, sessions: 4 },
      { priceCents: 2_500_000, sessions: 4 },
    ])).toBe(3_000_000 * 4 + 2_500_000 * 4)
  })
  it("una sola sesión = el precio del servicio", () => {
    expect(comboIndividualCents([{ priceCents: 5_000_000, sessions: 1 }])).toBe(5_000_000)
  })
  it("lista vacía = 0", () => {
    expect(comboIndividualCents([])).toBe(0)
  })
})

describe("comboSavingsCents", () => {
  it("individual mayor que total = ahorro positivo", () => {
    expect(comboSavingsCents(220_000_00, 150_000_00)).toBe(70_000_00)
  })
  it("total mayor que individual = negativo (más caro)", () => {
    expect(comboSavingsCents(80_000_00, 150_000_00)).toBe(-70_000_00)
  })
})

describe("comboTotalSessions", () => {
  it("suma las sesiones de todos los servicios", () => {
    expect(comboTotalSessions([{ sessions: 4 }, { sessions: 4 }, { sessions: 6 }])).toBe(14)
  })
  it("lista vacía = 0", () => {
    expect(comboTotalSessions([])).toBe(0)
  })
})
