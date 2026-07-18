import { describe, it, expect } from "vitest"
import { gridStepMin, gridStepMinFromMinutes, DEFAULT_STEP_MIN } from "./grid-step"

describe("gridStepMin — el paso de la grilla se deduce de los horarios guardados", () => {
  it("grilla de 1 hora → 60", () => {
    expect(gridStepMin(["09:00", "10:00", "11:00"])).toBe(60)
  })

  it("grilla de media hora → 30", () => {
    expect(gridStepMin(["09:00", "09:30", "10:00", "10:30"])).toBe(30)
  })

  it("LA PAUSA DEL MEDIODÍA NO define el paso (se toma la mínima, no el promedio)", () => {
    // 09:00 09:30 … pausa … 15:00 15:30 → el paso sigue siendo 30
    expect(gridStepMin(["09:00", "09:30", "15:00", "15:30"])).toBe(30)
    // Lo mismo con grilla de 1 hora y pausa de 2
    expect(gridStepMin(["09:00", "10:00", "13:00", "14:00"])).toBe(60)
  })

  it("sin horarios, o con uno solo, no hay nada que deducir → 60", () => {
    expect(gridStepMin([])).toBe(DEFAULT_STEP_MIN)
    expect(gridStepMin(["09:00"])).toBe(DEFAULT_STEP_MIN)
  })

  it("no depende del orden ni de los duplicados", () => {
    expect(gridStepMin(["11:00", "09:00", "10:00"])).toBe(60)
    expect(gridStepMin(["09:00", "09:00", "09:30"])).toBe(30)
    // Sólo duplicados: no hay diferencia positiva → 60
    expect(gridStepMin(["09:00", "09:00"])).toBe(DEFAULT_STEP_MIN)
  })

  it("aguanta un paso raro (por si algún día se configura a mano)", () => {
    expect(gridStepMin(["09:00", "09:20", "09:40"])).toBe(20)
    expect(gridStepMin(["09:00", "09:45"])).toBe(45)
  })

  it("la variante en minutos da lo mismo que la de 'HH:MM'", () => {
    expect(gridStepMinFromMinutes([540, 600, 660])).toBe(60)
    expect(gridStepMinFromMinutes([540, 570, 600])).toBe(30)
    expect(gridStepMinFromMinutes([])).toBe(DEFAULT_STEP_MIN)
    expect(gridStepMinFromMinutes([540])).toBe(DEFAULT_STEP_MIN)
  })
})
