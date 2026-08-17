import { describe, it, expect } from "vitest"
import {
  planServiceCounts,
  planDistinctServices,
  validateComboPlan,
  sortComboRows,
  hasSessionPlan,
  firstSessionIndexes,
  comboVisitCount,
} from "./combo-plan"

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

// Leer un combo GUARDADO: catálogo, motor y admin tienen que coincidir.
describe("filas guardadas del combo", () => {
  // Plan de 2 sesiones, desordenado a propósito (como puede venir de la base).
  const planRows = [
    { session_no: 2, order_index: 0, sessions: 1, id: "s2-ultra" },
    { session_no: 1, order_index: 1, sessions: 1, id: "s1-slim" },
    { session_no: 1, order_index: 0, sessions: 1, id: "s1-ultra" },
    { session_no: 2, order_index: 1, sessions: 1, id: "s2-up" },
  ]
  // Combo del modelo VIEJO: sin session_no, con cantidades.
  const legacyRows = [
    { session_no: null, order_index: 1, sessions: 4, id: "slim" },
    { session_no: null, order_index: 0, sessions: 6, id: "ultra" },
  ]

  it("ordena por (sesión, orden del día)", () => {
    expect(sortComboRows(planRows).map((r) => r.id)).toEqual(["s1-ultra", "s1-slim", "s2-ultra", "s2-up"])
  })

  it("distingue un combo con plan de uno legacy", () => {
    expect(hasSessionPlan(planRows)).toBe(true)
    expect(hasSessionPlan(legacyRows)).toBe(false)
  })

  it("la 1ª sesión del plan son TODAS sus filas, en orden", () => {
    const sorted = sortComboRows(planRows)
    expect(firstSessionIndexes(sorted).map((i) => sorted[i].id)).toEqual(["s1-ultra", "s1-slim"])
  })

  it("en un combo legacy la 1ª sesión es sólo el primer tratamiento", () => {
    const sorted = sortComboRows(legacyRows)
    expect(firstSessionIndexes(sorted).map((i) => sorted[i].id)).toEqual(["ultra"])
  })

  it("cuenta las visitas: el plan sus sesiones, el legacy la suma de cantidades", () => {
    expect(comboVisitCount(planRows)).toBe(2)
    expect(comboVisitCount(legacyRows)).toBe(10)
  })

  it("sin filas no rompe", () => {
    expect(comboVisitCount([])).toBe(0)
    expect(firstSessionIndexes([])).toEqual([])
    expect(sortComboRows([])).toEqual([])
  })
})
