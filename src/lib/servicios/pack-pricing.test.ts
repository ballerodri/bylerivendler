import { describe, it, expect } from "vitest"
import { packReferenceCents } from "./pack-pricing"

describe("packReferenceCents", () => {
  it("servicio fijo (zonesCount null): precio × sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, null)).toBe(10_000_000)
  })

  it("servicio por zona: precio/zona × zonas × sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, 2)).toBe(20_000_000)
  })

  it("una zona × 4 sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, 1)).toBe(10_000_000)
  })

  it("zonesCount 0 se trata como servicio fijo (defensivo)", () => {
    expect(packReferenceCents(2_500_000, 4, 0)).toBe(10_000_000)
  })
})
