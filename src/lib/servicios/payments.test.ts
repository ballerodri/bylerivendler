import { describe, it, expect } from "vitest"
import { amountDueNow, paymentSummary, validatePayment, distributePayment, DEPOSIT_PCT } from "./payments"

describe("amountDueNow", () => {
  it("seña = 30% del total", () => {
    expect(amountDueNow(10_000_000, "deposit")).toBe(3_000_000)
  })

  it("total = el total completo", () => {
    expect(amountDueNow(10_000_000, "full")).toBe(10_000_000)
  })

  it("redondea al centavo (no deja fracciones)", () => {
    // 5.555.500 * 0.3 = 1.666.650 exacto
    expect(amountDueNow(5_555_500, "deposit")).toBe(1_666_650)
    // 3.333.333 * 0.3 = 999.999,9 -> redondea
    expect(amountDueNow(3_333_333, "deposit")).toBe(1_000_000)
  })

  it("total 0 (canje con puntos) -> no se paga nada, elija lo que elija", () => {
    expect(amountDueNow(0, "deposit")).toBe(0)
    expect(amountDueNow(0, "full")).toBe(0)
  })

  it("total negativo -> 0 (defensivo)", () => {
    expect(amountDueNow(-100, "deposit")).toBe(0)
  })

  it("DEPOSIT_PCT es 0.3", () => {
    expect(DEPOSIT_PCT).toBe(0.3)
  })
})

describe("paymentSummary", () => {
  it("sin cobrar", () => {
    expect(paymentSummary(0, 10_000_000)).toEqual({
      paidCents: 0, totalCents: 10_000_000, pendingCents: 10_000_000,
      isPaidInFull: false, isUnpaid: true,
    })
  })

  it("cobrada la seña (parcial)", () => {
    expect(paymentSummary(3_000_000, 10_000_000)).toEqual({
      paidCents: 3_000_000, totalCents: 10_000_000, pendingCents: 7_000_000,
      isPaidInFull: false, isUnpaid: false,
    })
  })

  it("cobrado todo", () => {
    expect(paymentSummary(10_000_000, 10_000_000)).toEqual({
      paidCents: 10_000_000, totalCents: 10_000_000, pendingCents: 0,
      isPaidInFull: true, isUnpaid: false,
    })
  })

  it("cobrado de más -> pendiente no baja de 0", () => {
    const r = paymentSummary(12_000_000, 10_000_000)
    expect(r.pendingCents).toBe(0)
    expect(r.isPaidInFull).toBe(true)
  })

  it("turno en 0 (canje/sesión de pack) no cuenta como pagado por defecto", () => {
    const r = paymentSummary(0, 0)
    expect(r.isPaidInFull).toBe(false)
    expect(r.pendingCents).toBe(0)
  })
})

describe("validatePayment", () => {
  it("monto válido", () => {
    expect(validatePayment(3_000_000, 10_000_000)).toEqual({ ok: true })
  })

  it("cobrar el total exacto es válido", () => {
    expect(validatePayment(10_000_000, 10_000_000)).toEqual({ ok: true })
  })

  it("cero es válido (desmarcar un cobro)", () => {
    expect(validatePayment(0, 10_000_000)).toEqual({ ok: true })
  })

  it("negativo -> error", () => {
    const r = validatePayment(-1, 10_000_000)
    expect(r.ok).toBe(false)
  })

  it("más que el total -> error", () => {
    const r = validatePayment(10_000_001, 10_000_000)
    expect(r).toEqual({ ok: false, error: "No podés registrar más de lo que vale el turno." })
  })

  it("no entero -> error", () => {
    const r = validatePayment(100.5, 10_000_000)
    expect(r.ok).toBe(false)
  })
})

describe("distributePayment — repartir UN cobro entre los turnos de una compra", () => {
  const t = (id: string, totalCents: number, paidCents = 0) => ({ id, totalCents, paidCents })

  it("llena el primer turno antes de pasar al siguiente", () => {
    const r = distributePayment([t("a", 10000), t("b", 10000)], 15000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aplicaciones).toEqual([
      { id: "a", deCents: 0, aCents: 10000 },
      { id: "b", deCents: 0, aCents: 5000 },
    ])
  })

  it("LO QUE MÁS IMPORTA: lo repartido suma EXACTAMENTE el monto cobrado", () => {
    const appts = [t("a", 17000), t("b", 13500, 500), t("c", 4000)]
    for (const monto of [1, 500, 17000, 17001, 29999, 34000]) {
      const r = distributePayment(appts, monto)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const sumado = r.aplicaciones.reduce((a, x) => a + (x.aCents - x.deCents), 0)
      expect(sumado).toBe(monto)
    }
  })

  it("ningún turno queda cobrado por encima de su total", () => {
    const r = distributePayment([t("a", 5000, 4000), t("b", 9000)], 10000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aplicaciones).toEqual([
      { id: "a", deCents: 4000, aCents: 5000 },
      { id: "b", deCents: 0, aCents: 9000 },
    ])
  })

  it("saltea los turnos de $0 (sesiones 2..N de un pack) y los ya saldados", () => {
    const r = distributePayment([t("saldado", 5000, 5000), t("pack0", 0), t("real", 8000)], 3000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aplicaciones).toEqual([{ id: "real", deCents: 0, aCents: 3000 }])
  })

  it("se pasa de lo que falta cobrar → no reparte NADA y dice cuánto falta", () => {
    const r = distributePayment([t("a", 5000, 1000), t("b", 2000)], 7000)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faltaCents).toBe(6000)
  })

  it("montos inválidos se rechazan (0, negativo, con centavos partidos)", () => {
    for (const m of [0, -100, 100.5, NaN, Infinity]) {
      expect(distributePayment([t("a", 5000)], m).ok).toBe(false)
    }
  })

  it("cubrir el total exacto deja todo saldado", () => {
    const r = distributePayment([t("a", 5000), t("b", 3000)], 8000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.aplicaciones.map((x) => x.aCents)).toEqual([5000, 3000])
  })
})
