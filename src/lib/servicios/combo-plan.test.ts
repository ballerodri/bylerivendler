import { describe, it, expect } from "vitest"
import { planServiceCounts, planDistinctServices, validateComboPlan } from "./combo-plan"

// EL CASO DE LA USUARIA: 4 sesiones; Ultra en todas, Vela Slim en 1-2, Vela Up en 3-4.
const PLAN = [
  ["ultra", "slim"],
  ["ultra", "slim"],
  ["ultra", "up"],
  ["ultra", "up"],
]

describe("planServiceCounts", () => {
  it("cuenta las veces totales de cada tratamiento en el plan", () => {
    expect(planServiceCounts(PLAN)).toEqual({ ultra: 4, slim: 2, up: 2 })
  })
  it("plan vacío → sin cuentas", () => {
    expect(planServiceCounts([])).toEqual({})
  })
})

describe("planDistinctServices", () => {
  it("lista cada tratamiento una vez, en orden de aparición", () => {
    expect(planDistinctServices(PLAN)).toEqual(["ultra", "slim", "up"])
  })
})

describe("validateComboPlan", () => {
  const base = { name: "Reductor", totalPriceCents: 15_000_000, sessions: PLAN }

  it("el plan de la usuaria es válido", () => {
    expect(validateComboPlan(base)).toBeNull()
  })
  it("sin nombre → error", () => {
    expect(validateComboPlan({ ...base, name: "  " })).toMatch(/nombre/i)
  })
  it("precio 0 o negativo → error", () => {
    expect(validateComboPlan({ ...base, totalPriceCents: 0 })).toMatch(/precio/i)
    expect(validateComboPlan({ ...base, totalPriceCents: -5 })).toMatch(/precio/i)
  })
  it("sin sesiones → error", () => {
    expect(validateComboPlan({ ...base, sessions: [] })).toMatch(/sesión/i)
  })
  it("una sesión vacía → error que dice cuál", () => {
    expect(validateComboPlan({ ...base, sessions: [["ultra"], [], ["up"]] })).toMatch(/sesión 2/i)
  })
  it("un solo tratamiento distinto → error (eso es un pack)", () => {
    expect(validateComboPlan({ ...base, sessions: [["ultra"], ["ultra"]] })).toMatch(/2 tratamientos/i)
  })
  it("el mismo tratamiento DOS veces en la MISMA sesión → error que dice cuál", () => {
    expect(validateComboPlan({ ...base, sessions: [["ultra", "ultra"], ["slim"]] })).toMatch(/sesión 1/i)
  })
})
