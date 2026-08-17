import { describe, it, expect } from "vitest"
import { slotHitsBlocked } from "./staff-blocks"

// Casilla bloqueada de 60 min: "14:00" tapa 14:00–15:00 (840–900).
describe("slotHitsBlocked", () => {
  it("un servicio dentro de la casilla la pisa", () => {
    // 14:00–14:45 (840–885) cae dentro de 14:00–15:00
    expect(slotHitsBlocked(840, 885, [840], 60)).toBe(true)
  })

  it("un servicio que arranca antes y entra en la casilla la pisa", () => {
    // 13:30–14:30 (810–870) se solapa con 14:00–15:00
    expect(slotHitsBlocked(810, 870, [840], 60)).toBe(true)
  })

  it("un servicio que termina JUSTO cuando arranca la casilla NO la pisa (pegado)", () => {
    // 13:00–14:00 (780–840) termina en 840 = arranque de la casilla → no pisa
    expect(slotHitsBlocked(780, 840, [840], 60)).toBe(false)
  })

  it("un servicio que arranca JUSTO cuando termina la casilla NO la pisa (pegado)", () => {
    // 15:00–16:00 (900–960) arranca en 900 = fin de la casilla → no pisa
    expect(slotHitsBlocked(900, 960, [840], 60)).toBe(false)
  })

  it("sin casillas bloqueadas nunca pisa", () => {
    expect(slotHitsBlocked(840, 900, [], 60)).toBe(false)
  })

  it("respeta el paso de la grilla: casilla de 30 min tapa menos", () => {
    // "14:00" con paso 30 tapa 14:00–14:30 (840–870). Un servicio 14:30–15:00 NO pisa.
    expect(slotHitsBlocked(870, 900, [840], 30)).toBe(false)
    // pero 14:15–14:45 sí
    expect(slotHitsBlocked(855, 885, [840], 30)).toBe(true)
  })

  it("un servicio largo pisa cualquiera de varias casillas", () => {
    // 14:00–17:00 pisa la casilla de las 16:00 aunque haya varias
    expect(slotHitsBlocked(840, 1020, [600, 960], 60)).toBe(true)
  })
})
