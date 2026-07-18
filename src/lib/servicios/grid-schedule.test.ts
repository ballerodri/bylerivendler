import { describe, it, expect } from "vitest"
import { hmToMinutes, minutesToHm, placeOnGrid, placeOnGridMerged } from "./grid-schedule"

describe("hmToMinutes / minutesToHm", () => {
  it("convierte ida y vuelta manteniendo el cero a la izquierda", () => {
    expect(hmToMinutes("14:00")).toBe(840)
    expect(hmToMinutes("09:05")).toBe(545)
    expect(minutesToHm(840)).toBe("14:00")
    expect(minutesToHm(545)).toBe("09:05")
    expect(minutesToHm(0)).toBe("00:00")
  })
})

// Grilla de a 1 hora, 14:00–18:00 (el caso típico del salón).
const GRID = [840, 900, 960, 1020, 1080] // 14:00 15:00 16:00 17:00 18:00

describe("placeOnGrid — fase 1 (cada turno en su slot de grilla, sin fusión)", () => {
  it("sin turnos → lista vacía", () => {
    expect(placeOnGrid([], GRID, 840)).toEqual([])
  })

  it("un solo turno arranca en el slot elegido", () => {
    expect(placeOnGrid([60], GRID, 840)).toEqual([840])
  })

  it("dos turnos de 1h → back-to-back en la grilla (sin hueco, ambos en hora)", () => {
    // 14:00–15:00 y 15:00–16:00
    expect(placeOnGrid([60, 60], GRID, 840)).toEqual([840, 900])
  })

  it("turno corto + turno de 1h → el 2º salta a la hora siguiente (queda hueco)", () => {
    // sesión 20 min 14:00–14:20; el siguiente NO arranca 14:20, salta a 15:00
    expect(placeOnGrid([20, 60], GRID, 840)).toEqual([840, 900])
  })

  it("el ejemplo de la usuaria: 20min + 1h + 1h → 14:00 · 15:00 · 16:00", () => {
    expect(placeOnGrid([20, 60, 60], GRID, 840)).toEqual([840, 900, 960])
  })

  it("un turno más largo que la hora ocupa varias horas y el siguiente salta al slot ≥ su fin", () => {
    // 90 min 14:00–15:30; el siguiente arranca 16:00 (primer slot ≥ 15:30)
    expect(placeOnGrid([90, 60], GRID, 840)).toEqual([840, 960])
  })

  it("arranca en un slot del medio de la grilla", () => {
    // desde las 15:00
    expect(placeOnGrid([60, 60], GRID, 900)).toEqual([900, 960])
  })

  it("devuelve null si la cadena se pasa del final del día", () => {
    // desde las 17:00, dos de 1h: 17:00 y 18:00 ok; tres no entra
    expect(placeOnGrid([60, 60], GRID, 1020)).toEqual([1020, 1080])
    expect(placeOnGrid([60, 60, 60], GRID, 1020)).toBeNull()
  })

  it("el fin exacto en un slot NO deja hueco (el siguiente arranca ahí mismo)", () => {
    // 60 min 14:00–15:00; el siguiente arranca justo 15:00
    expect(placeOnGrid([60, 30], GRID, 840)).toEqual([840, 900])
  })

  // INVARIANTE "sin memoria del ancla" — la REGLA DE ORO del encadenado depende
  // de esto: el buscador coloca la cadena COMPLETA [pack, ...sueltos] desde T,
  // y el servidor coloca SÓLo los sueltos desde el 1er slot suelto. Los dos
  // tienen que dar los MISMOS horarios para los sueltos. Como cada turno
  // depende sólo del fin del anterior (no del ancla), esto se cumple.
  it("regla de oro: colocar [pack, ...sueltos] desde T == colocar [...sueltos] desde el 1er slot suelto", () => {
    const packDur = 60
    const looseDurs = [45, 45, 30]
    const T = 840 // 14:00
    const full = placeOnGrid([packDur, ...looseDurs], GRID, T)
    expect(full).not.toBeNull()
    const firstLooseStart = full![1]
    const looseOnly = placeOnGrid(looseDurs, GRID, firstLooseStart)
    expect(looseOnly).toEqual(full!.slice(1))
  })

  it("regla de oro también con el pack ocupando varias horas", () => {
    const full = placeOnGrid([90, 60, 60], GRID, 840) // pack 90 min
    expect(full).not.toBeNull()
    expect(placeOnGrid([60, 60], GRID, full![1])).toEqual(full!.slice(1))
  })
})

// Fase 3 — misma profesional → PEGADOS siempre; distinta → hora en punto.
const it2 = (durationMin: number, staffId: string) => ({ durationMin, staffId })

describe("placeOnGridMerged — fase 3 (misma profesional pegados siempre)", () => {
  it("misma profesional → pegados (10:00 y 10:20)", () => {
    expect(placeOnGridMerged([it2(20, "A"), it2(30, "A")], GRID, 840)).toEqual([840, 860])
  })

  it("EL CASO DE LA USUARIA: 30 min + 50 min misma profesional → 10:00 y 10:30 (cruza la hora, pegados)", () => {
    // Vela 30 min 10:00–10:30 → HIFU 50 min arranca 10:30 (hasta 11:20)
    expect(placeOnGridMerged([it2(30, "A"), it2(50, "A")], GRID, 840)).toEqual([840, 870])
  })

  it("distinta profesional → el 2º arranca en hora en punto (10:00 y 11:00), nunca a mitad de hora", () => {
    expect(placeOnGridMerged([it2(20, "A"), it2(30, "B")], GRID, 840)).toEqual([840, 900])
  })

  it("misma profesional aunque NO entren en 1 hora → pegados igual (ya no existe el tope de la Fase 2)", () => {
    // 40 min@A + 40 min@A → 10:00 y 10:40 (antes saltaba a 11:00)
    expect(placeOnGridMerged([it2(40, "A"), it2(40, "A")], GRID, 840)).toEqual([840, 880])
  })

  it("dos de 1h de la misma profesional → 11:00 y 12:00 (pegados; caen en punto porque duran justo 1h)", () => {
    expect(placeOnGridMerged([it2(60, "A"), it2(60, "A")], GRID, 900)).toEqual([900, 960])
  })

  it("tres de la misma profesional → todos de corrido", () => {
    // 15+20+30 → 10:00, 10:15, 10:35 (pegados, sin saltar a la hora)
    expect(placeOnGridMerged([it2(15, "A"), it2(20, "A"), it2(30, "A")], GRID, 840)).toEqual([840, 855, 875])
  })

  it("cambia de profesional → hora en punto; después la misma vuelve a pegarse", () => {
    // 20@A (10:00), 20@B distinta → 11:00, 20@B misma que la anterior → 11:20
    expect(placeOnGridMerged([it2(20, "A"), it2(20, "B"), it2(20, "B")], GRID, 840)).toEqual([840, 900, 920])
  })

  it("el cambio de profesional tras una cadena que cruza la hora cae en el siguiente punto", () => {
    // A: 30+50 → 10:00, 10:30 (fin 11:20); B → primer slot ≥ 11:20 = 12:00
    expect(placeOnGridMerged([it2(30, "A"), it2(50, "A"), it2(60, "B")], GRID, 840)).toEqual([840, 870, 960])
  })

  it("sin ítems → lista vacía; se pasa del día → null", () => {
    expect(placeOnGridMerged([], GRID, 840)).toEqual([])
    // desde 17:00: 60@A (17:00-18:00), 60@B → primer slot ≥ 18:00 = none (GRID llega a 18:00=1080) → null
    expect(placeOnGridMerged([it2(60, "A"), it2(60, "B")], GRID, 1080)).toBeNull()
  })

  it("tope del día: una cadena de la MISMA profesional tampoco se extiende más allá del cierre", () => {
    // 60@A en el último slot (18:00–19:00) + otro 60@A pegado arrancaría 19:00,
    // fuera de la última hora reservable (18:00 + 60) → null (no se ofrece).
    expect(placeOnGridMerged([it2(60, "A"), it2(60, "A")], GRID, 1080)).toBeNull()
    // Tres de 1h desde 17:00: la 3ª arrancaría 19:00 → null también.
    expect(placeOnGridMerged([it2(60, "A"), it2(60, "A"), it2(60, "A")], GRID, 1020)).toBeNull()
  })

  it("tope del día con grilla de MEDIA HORA: el tope es el último slot + 30, no + 60", () => {
    // Grilla 14:00–15:30 de a 30 min. Último slot 15:30 → tope 16:00.
    const G30 = [840, 870, 900, 930]
    // 20@A 15:30–15:50 + 20@A pegado 15:50 (< 16:00) → OK
    expect(placeOnGridMerged([it2(20, "A"), it2(20, "A")], G30, 930)).toEqual([930, 950])
    // 40@A 15:30–16:10 + otro pegado arrancaría 16:10 (≥ 16:00) → null
    expect(placeOnGridMerged([it2(40, "A"), it2(20, "A")], G30, 930)).toBeNull()
  })

  it("tope del día: un pegado DENTRO de la última hora sigue OK (y un turno solo largo en el último slot también)", () => {
    // 30@A 18:00–18:30 + 20@A pegado 18:30 (< 19:00) → OK
    expect(placeOnGridMerged([it2(30, "A"), it2(20, "A")], GRID, 1080)).toEqual([1080, 1110])
    // Un solo turno de 75 min en el último slot NO es pegado → sigue permitido (igual que Fase 1)
    expect(placeOnGridMerged([it2(75, "A")], GRID, 1080)).toEqual([1080])
  })

  it("PROPIEDAD CLAVE: con todas las profesionales distintas == placeOnGrid (Fase 1 es el caso sin fusión)", () => {
    const durs = [20, 45, 60, 30]
    const merged = placeOnGridMerged(
      [it2(20, "A"), it2(45, "B"), it2(60, "C"), it2(30, "D")],
      GRID,
      840
    )
    expect(merged).toEqual(placeOnGrid(durs, GRID, 840))
  })

  // Anclada-sin-memoria CON el pack encadenable (Fase 3): colocar
  // [pack, ...sueltos] desde T da, para los sueltos, lo MISMO que colocar
  // [...sueltos] desde el inicio del 1er suelto — sea PEGADO al pack (misma
  // profesional, mitad de hora) o en punto (distinta). La regla de oro del
  // encadenado con pack depende de esto.
  it("regla de oro: pack + 1er suelto de la MISMA profesional → el suelto arranca pegado (T+D_pack) y el server lo reproduce", () => {
    const full = placeOnGridMerged([it2(30, "A"), it2(50, "A"), it2(60, "B")], GRID, 840)
    expect(full).toEqual([840, 870, 960]) // pack 10:00, HIFU 10:30, masaje 12:00
    const looseOnly = placeOnGridMerged([it2(50, "A"), it2(60, "B")], GRID, full![1])
    expect(looseOnly).toEqual(full!.slice(1))
  })

  it("regla de oro: pack + 1er suelto de OTRA profesional → el suelto arranca en punto y el server lo reproduce", () => {
    const full = placeOnGridMerged([it2(30, "A"), it2(60, "B"), it2(60, "B")], GRID, 840)
    expect(full).toEqual([840, 900, 960]) // pack 10:00, B 11:00 y 12:00
    const looseOnly = placeOnGridMerged([it2(60, "B"), it2(60, "B")], GRID, full![1])
    expect(looseOnly).toEqual(full!.slice(1))
  })
})
