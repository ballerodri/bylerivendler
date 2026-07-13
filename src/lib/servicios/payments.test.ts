import { describe, it, expect } from "vitest"
import { amountDueNow, paymentSummary, validatePayment, DEPOSIT_PCT } from "./payments"

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
