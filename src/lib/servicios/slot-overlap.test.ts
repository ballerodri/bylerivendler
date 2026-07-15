import { describe, it, expect } from "vitest"
import { overlappingBlock, type BlockedInterval } from "./slot-overlap"

const MIN = 60_000
// Bloque en minutos-desde-cero (ej: 900 = las 15:00 si contás minutos del día).
const block = (startMin: number, endMin: number, name: string): BlockedInterval => ({
  startMs: startMin * MIN,
  endMs: endMin * MIN,
  name,
})

describe("overlappingBlock", () => {
  it("sin bloqueos -> libre (null)", () => {
    expect(overlappingBlock(900 * MIN, 60, [])).toBeNull()
  })

  it("pegado por delante (el candidato termina justo cuando arranca el bloque) -> libre", () => {
    // candidato 14:00-15:00, bloque 15:00-16:00
    expect(overlappingBlock(840 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })

  it("pegado por detrás (el candidato arranca justo cuando termina el bloque) -> libre", () => {
    // candidato 16:00-17:00, bloque 15:00-16:00
    expect(overlappingBlock(960 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })

  it("mismo tramo -> se pisa, devuelve el bloque (para el motivo)", () => {
    expect(overlappingBlock(900 * MIN, 60, [block(900, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("el candidato arranca dentro del bloque -> se pisa", () => {
    // candidato 15:30-16:30, bloque 15:00-16:00
    expect(overlappingBlock(930 * MIN, 60, [block(900, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("el bloque queda dentro del candidato -> se pisa", () => {
    // candidato 15:00-17:00, bloque 15:30-16:00
    expect(overlappingBlock(900 * MIN, 120, [block(930, 960, "Masaje")])?.name).toBe("Masaje")
  })

  it("varios bloques -> devuelve el primero que se pisa", () => {
    const blocks = [block(600, 660, "Reflexo"), block(900, 960, "Masaje")]
    expect(overlappingBlock(900 * MIN, 60, blocks)?.name).toBe("Masaje")
  })

  it("candidato lejos de todos -> libre", () => {
    expect(overlappingBlock(600 * MIN, 60, [block(900, 960, "Masaje")])).toBeNull()
  })
})
