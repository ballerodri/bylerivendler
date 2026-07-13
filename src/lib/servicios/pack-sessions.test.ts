import { describe, it, expect } from "vitest"
import {
  minStartForNextSession,
  validatePackSlots,
  packSessionPrices,
  arPartsFromUtc,
} from "./pack-sessions"

// Helper: una fecha/hora AR como Date UTC (AR = UTC-3).
const ar = (y: number, m: number, d: number, hh: number, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh + 3, mm))

describe("minStartForNextSession", () => {
  it("suma el intervalo en días", () => {
    const r = minStartForNextSession(ar(2026, 7, 20, 14), 7)
    expect(r.toISOString()).toBe(ar(2026, 7, 27, 14).toISOString())
  })

  it("sin intervalo (null) no suma nada", () => {
    const prev = ar(2026, 7, 20, 14)
    expect(minStartForNextSession(prev, null).toISOString()).toBe(prev.toISOString())
  })

  it("intervalo 0 no suma nada", () => {
    const prev = ar(2026, 7, 20, 14)
    expect(minStartForNextSession(prev, 0).toISOString()).toBe(prev.toISOString())
  })
})

describe("validatePackSlots", () => {
  const opts = { sessionsTotal: 4, intervalDays: 7 }

  it("caso feliz: 2 de 4, respetando 7 días", () => {
    const r = validatePackSlots([ar(2026, 7, 20, 14), ar(2026, 7, 27, 14)], opts)
    expect(r.ok).toBe(true)
  })

  it("una sola sesión es válido (el resto se agenda después)", () => {
    expect(validatePackSlots([ar(2026, 7, 20, 14)], opts).ok).toBe(true)
  })

  it("vacío → error", () => {
    const r = validatePackSlots([], opts)
    expect(r).toEqual({ ok: false, error: "Elegí al menos la fecha de la primera sesión." })
  })

  it("más sesiones que las del pack → error", () => {
    const slots = [
      ar(2026, 7, 6, 14), ar(2026, 7, 13, 14), ar(2026, 7, 20, 14),
      ar(2026, 7, 27, 14), ar(2026, 8, 3, 14),
    ]
    const r = validatePackSlots(slots, opts)
    expect(r.ok).toBe(false)
  })

  it("desordenadas → error", () => {
    const r = validatePackSlots([ar(2026, 7, 27, 14), ar(2026, 7, 20, 14)], opts)
    expect(r).toEqual({ ok: false, error: "Las sesiones tienen que ir en orden." })
  })

  it("intervalo corto (6 días) → error", () => {
    const r = validatePackSlots([ar(2026, 7, 20, 14), ar(2026, 7, 26, 14)], opts)
    expect(r).toEqual({ ok: false, error: "Entre sesiones tienen que pasar al menos 7 días." })
  })

  it("sin intervalo, dos el mismo día en horarios distintos es válido", () => {
    const r = validatePackSlots(
      [ar(2026, 7, 20, 10), ar(2026, 7, 20, 15)],
      { sessionsTotal: 4, intervalDays: null }
    )
    expect(r.ok).toBe(true)
  })

  it("sin intervalo, misma hora exacta → error de orden", () => {
    const r = validatePackSlots(
      [ar(2026, 7, 20, 10), ar(2026, 7, 20, 10)],
      { sessionsTotal: 4, intervalDays: null }
    )
    expect(r.ok).toBe(false)
  })
})

describe("packSessionPrices", () => {
  it("la 1ª lleva el precio del pack + 30% de seña; el resto en 0 y pagadas", () => {
    const r = packSessionPrices(17_000_000, 3)
    expect(r).toEqual([
      { totalCents: 17_000_000, depositCents: 5_100_000, depositPaid: false },
      { totalCents: 0, depositCents: 0, depositPaid: true },
      { totalCents: 0, depositCents: 0, depositPaid: true },
    ])
  })

  it("una sola sesión: lleva todo el precio", () => {
    expect(packSessionPrices(17_000_000, 1)).toEqual([
      { totalCents: 17_000_000, depositCents: 5_100_000, depositPaid: false },
    ])
  })

  it("el total cobrado es el precio del pack, no su múltiplo", () => {
    const total = packSessionPrices(17_000_000, 4).reduce((a, p) => a + p.totalCents, 0)
    expect(total).toBe(17_000_000)
  })

  it("si eligió pagar el TOTAL, la 1ª sesión pide el precio completo del pack", () => {
    const r = packSessionPrices(17_000_000, 3, "full")
    expect(r[0]).toEqual({ totalCents: 17_000_000, depositCents: 17_000_000, depositPaid: false })
    expect(r[1]).toEqual({ totalCents: 0, depositCents: 0, depositPaid: true })
  })

  it("por defecto sigue siendo la seña del 30% (no rompe lo existente)", () => {
    expect(packSessionPrices(17_000_000, 1)[0].depositCents).toBe(5_100_000)
  })
})

describe("arPartsFromUtc", () => {
  it("convierte un Date UTC a fecha/hora/día-de-semana de Argentina", () => {
    // Lunes 20/07/2026 14:00 AR = 17:00 UTC
    const r = arPartsFromUtc(new Date(Date.UTC(2026, 6, 20, 17, 0)))
    expect(r).toEqual({ dateStr: "2026-07-20", timeStr: "14:00", dayOfWeek: 1 })
  })

  it("cruce de medianoche: 01:00 UTC es el día anterior 22:00 en AR", () => {
    const r = arPartsFromUtc(new Date(Date.UTC(2026, 6, 21, 1, 0)))
    expect(r).toEqual({ dateStr: "2026-07-20", timeStr: "22:00", dayOfWeek: 1 })
  })
})
