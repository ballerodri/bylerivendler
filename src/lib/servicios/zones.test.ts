import { describe, it, expect } from "vitest"
import { computeZonePricing, resolveSelectedZones, type Zone } from "./zones"

const ZONES: Zone[] = [
  { id: "a", name: "Abdomen", durationMin: 30, priceCents: null },
  { id: "b", name: "Piernas", durationMin: 45, priceCents: 3_500_000 },
  { id: "c", name: "Brazos", durationMin: 20, priceCents: null },
]

describe("computeZonePricing", () => {
  it("zona sin precio propio usa el general (fallback)", () => {
    const r = computeZonePricing([ZONES[0], ZONES[2]], 2_500_000)
    expect(r.priceCents).toBe(5_000_000)
    expect(r.durationMin).toBe(50)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30, price_cents: 2_500_000 },
      { name: "Brazos", duration_min: 20, price_cents: 2_500_000 },
    ])
  })

  it("zona con precio propio lo usa; mezcla suma ambos", () => {
    const r = computeZonePricing([ZONES[0], ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(6_000_000) // 2.5M general + 3.5M propio
    expect(r.durationMin).toBe(75)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30, price_cents: 2_500_000 },
      { name: "Piernas", duration_min: 45, price_cents: 3_500_000 },
    ])
  })

  it("solo zonas con precio propio", () => {
    const r = computeZonePricing([ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(3_500_000)
  })

  it("sin zonas → 0", () => {
    const r = computeZonePricing([], 2_500_000)
    expect(r.priceCents).toBe(0)
    expect(r.durationMin).toBe(0)
    expect(r.zones).toEqual([])
  })
})

describe("resolveSelectedZones", () => {
  it("resuelve IDs válidos preservando el orden pedido", () => {
    const r = resolveSelectedZones(["b", "a"], ZONES)
    expect(r).toEqual([ZONES[1], ZONES[0]])
  })

  it("ID inexistente → null", () => {
    expect(resolveSelectedZones(["a", "zzz"], ZONES)).toBeNull()
  })

  it("selección vacía → null", () => {
    expect(resolveSelectedZones([], ZONES)).toBeNull()
  })
})
