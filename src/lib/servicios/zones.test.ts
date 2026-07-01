import { describe, it, expect } from "vitest"
import { computeZonePricing, resolveSelectedZones, type Zone } from "./zones"

const ZONES: Zone[] = [
  { id: "a", name: "Abdomen", durationMin: 30 },
  { id: "b", name: "Piernas", durationMin: 45 },
  { id: "c", name: "Brazos", durationMin: 20 },
]

describe("computeZonePricing", () => {
  it("precio = cantidad de zonas × precio por zona; duración = suma", () => {
    const r = computeZonePricing([ZONES[0], ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(5_000_000)
    expect(r.durationMin).toBe(75)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30 },
      { name: "Piernas", duration_min: 45 },
    ])
  })

  it("una sola zona", () => {
    const r = computeZonePricing([ZONES[2]], 2_500_000)
    expect(r.priceCents).toBe(2_500_000)
    expect(r.durationMin).toBe(20)
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
