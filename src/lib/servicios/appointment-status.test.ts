import { describe, it, expect } from "vitest"
import { haComenzado, estadoEfectivo } from "./appointment-status"

// Un instante fijo de referencia (no usamos Date.now() para que el test sea
// determinístico). "Ahora" = 2026-07-20T15:00:00Z.
const NOW = Date.parse("2026-07-20T15:00:00.000Z")
const ANTES = "2026-07-20T14:00:00.000Z" // una hora antes de NOW
const DESPUES = "2026-07-20T16:00:00.000Z" // una hora después de NOW

describe("haComenzado", () => {
  it("un confirmado cuya hora ya pasó, comenzó", () => {
    expect(haComenzado("confirmed", ANTES, NOW)).toBe(true)
  })

  it("un confirmado cuya hora todavía no llegó, NO comenzó", () => {
    expect(haComenzado("confirmed", DESPUES, NOW)).toBe(false)
  })

  it("justo a la hora en punto ya comenzó (<=)", () => {
    expect(haComenzado("confirmed", "2026-07-20T15:00:00.000Z", NOW)).toBe(true)
  })

  it("sólo aplica a confirmados: un pendiente cuya hora pasó NO comenzó", () => {
    expect(haComenzado("pending", ANTES, NOW)).toBe(false)
  })

  it("un in_progress real no lo toca esta función (ya lo maneja estadoEfectivo)", () => {
    expect(haComenzado("in_progress", ANTES, NOW)).toBe(false)
  })

  it("un completado/cancelado/no_show cuya hora pasó NO se considera comenzado", () => {
    expect(haComenzado("completed", ANTES, NOW)).toBe(false)
    expect(haComenzado("cancelled", ANTES, NOW)).toBe(false)
    expect(haComenzado("no_show", ANTES, NOW)).toBe(false)
  })
})

describe("estadoEfectivo", () => {
  it("un confirmado pasado se muestra como en curso", () => {
    expect(estadoEfectivo("confirmed", ANTES, NOW)).toBe("in_progress")
  })

  it("un confirmado futuro queda confirmado", () => {
    expect(estadoEfectivo("confirmed", DESPUES, NOW)).toBe("confirmed")
  })

  it("un in_progress real queda en curso", () => {
    expect(estadoEfectivo("in_progress", ANTES, NOW)).toBe("in_progress")
  })

  it("el resto de los estados no se tocan", () => {
    expect(estadoEfectivo("pending", ANTES, NOW)).toBe("pending")
    expect(estadoEfectivo("completed", ANTES, NOW)).toBe("completed")
    expect(estadoEfectivo("cancelled", DESPUES, NOW)).toBe("cancelled")
    expect(estadoEfectivo("no_show", ANTES, NOW)).toBe("no_show")
  })
})
