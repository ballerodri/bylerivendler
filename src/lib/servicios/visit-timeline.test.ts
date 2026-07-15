import { describe, it, expect } from "vitest"
import { addMinutesHM, sequentialStartTimes } from "./visit-timeline"

describe("addMinutesHM", () => {
  it("suma 0 -> el mismo horario (identidad: el caso NO encadenado queda byte-idéntico)", () => {
    expect(addMinutesHM("13:00", 0)).toBe("13:00")
    expect(addMinutesHM("09:05", 0)).toBe("09:05")
  })

  it("suma la duración del pack -> el bloque de servicios arranca después de la 1ª sesión", () => {
    expect(addMinutesHM("13:00", 20)).toBe("13:20")
  })

  it("cruza la hora en punto", () => {
    expect(addMinutesHM("13:50", 20)).toBe("14:10")
  })

  it("no aplica módulo de 24h: una cadena que cruza medianoche sigue creciendo (25:30 no 01:30)", () => {
    expect(addMinutesHM("23:50", 20)).toBe("24:10")
  })

  it("mantiene el cero a la izquierda en horas y minutos", () => {
    expect(addMinutesHM("08:00", 5)).toBe("08:05")
    expect(addMinutesHM("08:03", 2)).toBe("08:05")
  })
})

describe("sequentialStartTimes", () => {
  it("cadena sin huecos: cada ítem arranca cuando termina el anterior", () => {
    expect(sequentialStartTimes("13:20", [50, 60])).toEqual(["13:20", "14:10"])
  })

  it("un solo ítem arranca en el inicio", () => {
    expect(sequentialStartTimes("13:00", [30])).toEqual(["13:00"])
  })

  it("sin ítems -> lista vacía", () => {
    expect(sequentialStartTimes("13:00", [])).toEqual([])
  })

  it("el primer ítem SIEMPRE arranca exactamente en el inicio (no suma su propia duración antes)", () => {
    expect(sequentialStartTimes("10:00", [15, 15, 15])).toEqual(["10:00", "10:15", "10:30"])
  })
})
