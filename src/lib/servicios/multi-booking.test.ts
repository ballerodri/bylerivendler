import { describe, it, expect } from "vitest"
import { separateDeposits, totalDueNowSeparate, validateSeparateSlots, type SlotItem } from "./multi-booking"

const T0 = Date.parse("2026-08-10T13:00:00.000Z") // lunes 10:00 AR
const HOUR = 3_600_000

function item(p: Partial<SlotItem> & { name: string; startsAtMs: number }): SlotItem {
  return {
    serviceId: p.serviceId ?? p.name,
    name: p.name,
    startsAtMs: p.startsAtMs,
    durationMin: p.durationMin ?? 60,
    priceCents: p.priceCents ?? 1_000_000,
  }
}

describe("separateDeposits", () => {
  it("cada turno lleva la seña de SU propio precio", () => {
    expect(separateDeposits([10_000_000, 5_000_000], "deposit")).toEqual([3_000_000, 1_500_000])
  })

  it("si eligió pagar el total, cada turno pide su precio completo", () => {
    expect(separateDeposits([10_000_000, 5_000_000], "full")).toEqual([10_000_000, 5_000_000])
  })

  it("un turno en 0 (canje) no pide nada", () => {
    expect(separateDeposits([0, 5_000_000], "deposit")).toEqual([0, 1_500_000])
  })

  it("sin servicios devuelve una lista vacía", () => {
    expect(separateDeposits([], "deposit")).toEqual([])
  })
})

describe("totalDueNowSeparate", () => {
  it("es la SUMA de las señas de cada turno", () => {
    expect(totalDueNowSeparate([10_000_000, 5_000_000], "deposit")).toBe(4_500_000)
  })

  it("pagando el total, es la suma de los precios", () => {
    expect(totalDueNowSeparate([10_000_000, 5_000_000], "full")).toBe(15_000_000)
  })

  it("la suma de los redondeos NO siempre es el redondeo de la suma (por eso existe esta función)", () => {
    // 5*0.3 = 1,5 -> Math.round redondea a 2 en cada turno = 4
    // (5+5)*0.3 = 3 -> redondear la suma daría 3. La clienta transfiere lo que
    // suman los turnos, así que la fuente de verdad es la suma de los redondeos.
    expect(totalDueNowSeparate([5, 5], "deposit")).toBe(4)
  })
})

describe("validateSeparateSlots", () => {
  const now = T0 - 24 * HOUR

  it("dos turnos que no se pisan: OK", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + 2 * HOUR, durationMin: 90 })],
      now
    )
    expect(r).toEqual({ ok: true })
  })

  it("pegados exactamente (uno termina cuando empieza el otro): OK", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + HOUR, durationMin: 30 })],
      now
    )
    expect(r).toEqual({ ok: true })
  })

  it("se superponen -> error que nombra los DOS servicios", () => {
    const r = validateSeparateSlots(
      [item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 }),
       item({ name: "Masaje", startsAtMs: T0 + 30 * 60_000, durationMin: 60 })],
      now
    )
    expect(r).toEqual({
      ok: false,
      error: "Masaje se superpone con Limpieza. No podés estar en dos servicios a la vez.",
    })
  })

  it("detecta la superposición aunque vengan desordenados", () => {
    const r = validateSeparateSlots(
      [item({ name: "Masaje", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
       item({ name: "Limpieza", startsAtMs: T0, durationMin: 60 })],
      now
    )
    expect(r.ok).toBe(false)
  })

  it("una fecha en el pasado -> error que nombra el servicio", () => {
    const r = validateSeparateSlots([item({ name: "Limpieza", startsAtMs: now - HOUR })], now)
    expect(r).toEqual({ ok: false, error: "Limpieza tiene que ser en una fecha futura." })
  })

  it("una fecha inválida (NaN) -> error", () => {
    const r = validateSeparateSlots([item({ name: "Limpieza", startsAtMs: NaN })], now)
    expect(r.ok).toBe(false)
  })

  it("un solo servicio: no hay con qué superponerse", () => {
    expect(validateSeparateSlots([item({ name: "Limpieza", startsAtMs: T0 })], now)).toEqual({ ok: true })
  })

  it("sin servicios -> error (en este modo las fechas son obligatorias)", () => {
    expect(validateSeparateSlots([], now)).toEqual({
      ok: false,
      error: "Elegí fecha y hora para cada servicio.",
    })
  })

  it("tres turnos, el 3º pisa al 1º", () => {
    const r = validateSeparateSlots(
      [item({ name: "A", startsAtMs: T0, durationMin: 60 }),
       item({ name: "B", startsAtMs: T0 + 5 * HOUR, durationMin: 60 }),
       item({ name: "C", startsAtMs: T0 + 30 * 60_000, durationMin: 30 })],
      now
    )
    expect(r).toEqual({
      ok: false,
      error: "C se superpone con A. No podés estar en dos servicios a la vez.",
    })
  })
})
