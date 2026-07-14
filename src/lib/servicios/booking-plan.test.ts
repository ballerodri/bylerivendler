import { describe, it, expect } from "vitest"
import {
  crossOverlapCheck,
  sumDeposits,
  sumTotals,
  type PlannedAppointment,
} from "./booking-plan"

const T0 = Date.parse("2026-08-10T13:00:00.000Z") // lunes 10:00 AR
const HOUR = 3_600_000

function appt(p: Partial<PlannedAppointment> & { label: string; startsAtMs: number }): PlannedAppointment {
  return {
    label: p.label,
    startsAtMs: p.startsAtMs,
    durationMin: p.durationMin ?? 60,
    staffId: p.staffId ?? null,
    totalCents: p.totalCents ?? 0,
    depositCents: p.depositCents ?? 0,
    depositPaid: p.depositPaid ?? false,
    notesInternal: p.notesInternal ?? null,
    isPackSession: p.isPackSession ?? false,
    legs: p.legs ?? [],
  }
}

describe("crossOverlapCheck", () => {
  it("una lista vacía es válida (no hay nada que chocar)", () => {
    expect(crossOverlapCheck([])).toEqual({ ok: true })
  })

  it("un solo turno no se puede superponer con nadie", () => {
    expect(crossOverlapCheck([appt({ label: "Limpieza", startsAtMs: T0 })])).toEqual({ ok: true })
  })

  it("dos turnos separados: OK", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 2 * HOUR, durationMin: 90 }),
    ])
    expect(r).toEqual({ ok: true })
  })

  it("pegados exactamente (uno termina cuando empieza el otro): OK", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + HOUR, durationMin: 30 }),
    ])
    expect(r).toEqual({ ok: true })
  })

  it("EL CASO NUEVO: una sesión del pack pisa un servicio suelto", () => {
    const r = crossOverlapCheck([
      appt({ label: "Sesión 2 del pack", startsAtMs: T0, durationMin: 60, isPackSession: true }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "Limpieza facial se superpone con Sesión 2 del pack. No podés estar en dos lugares a la vez.",
    })
  })

  it("detecta la superposición aunque vengan desordenados", () => {
    const r = crossOverlapCheck([
      appt({ label: "Limpieza facial", startsAtMs: T0 + 30 * 60_000, durationMin: 60 }),
      appt({ label: "Sesión 2 del pack", startsAtMs: T0, durationMin: 60 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "Limpieza facial se superpone con Sesión 2 del pack. No podés estar en dos lugares a la vez.",
    })
  })

  it("tres turnos: el 3º pisa al 1º", () => {
    const r = crossOverlapCheck([
      appt({ label: "A", startsAtMs: T0, durationMin: 60 }),
      appt({ label: "B", startsAtMs: T0 + 5 * HOUR, durationMin: 60 }),
      appt({ label: "C", startsAtMs: T0 + 30 * 60_000, durationMin: 30 }),
    ])
    expect(r).toEqual({
      ok: false,
      error: "C se superpone con A. No podés estar en dos lugares a la vez.",
    })
  })

  it("una fecha inválida (NaN) -> error que nombra el turno", () => {
    const r = crossOverlapCheck([appt({ label: "Limpieza", startsAtMs: NaN })])
    expect(r).toEqual({ ok: false, error: "La fecha de Limpieza no es válida." })
  })
})

describe("sumDeposits / sumTotals", () => {
  it("la seña es la SUMA de las señas de cada turno", () => {
    const plan = [
      appt({ label: "Sesión 1 del pack", startsAtMs: T0, totalCents: 17_000_000, depositCents: 5_100_000 }),
      appt({ label: "Sesión 2 del pack", startsAtMs: T0 + 7 * 24 * HOUR, totalCents: 0, depositCents: 0 }),
      appt({ label: "Limpieza facial", startsAtMs: T0 + 2 * HOUR, totalCents: 5_000_000, depositCents: 1_500_000 }),
    ]
    expect(sumDeposits(plan)).toBe(6_600_000)
    expect(sumTotals(plan)).toBe(22_000_000)
  })

  it("un plan vacío suma 0", () => {
    expect(sumDeposits([])).toBe(0)
    expect(sumTotals([])).toBe(0)
  })
})
