import { describe, it, expect } from "vitest"
import { convertBlockedSlots, needsBlockedConversion } from "./blocked-slots-convert"

/** Grilla real del salón: días de semana de 08:00 a 18:00. */
const HOURLY = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
const HALF: string[] = (() => {
  const out: string[] = []
  for (let m = 8 * 60; m <= 18 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)
  }
  return out
})()

const slotsOf = (rows: { staff_id: string; slot: string }[], staffId: string) =>
  rows.filter((r) => r.staff_id === staffId).map((r) => r.slot)

describe("needsBlockedConversion — qué días hay que tocar", () => {
  it("mismo paso → no se toca nada", () => {
    expect(needsBlockedConversion(HOURLY, HOURLY)).toBe(false)
    expect(needsBlockedConversion(HALF, HALF)).toBe(false)
  })

  it("cambia el paso (en cualquier dirección) → hay que convertir", () => {
    expect(needsBlockedConversion(HOURLY, HALF)).toBe(true)
    expect(needsBlockedConversion(HALF, HOURLY)).toBe(true)
  })

  it("el día cambia de horario pero NO de paso → no se toca nada", () => {
    // Abre más tarde, sigue siendo de 1 hora.
    expect(needsBlockedConversion(HOURLY, ["10:00", "11:00", "12:00"])).toBe(false)
  })

  it("día que se cierra (0 o 1 horario) → NO se convierte (el 60 por defecto no es un cambio real)", () => {
    // Si esto devolviera true, cerrar un día borraría los bloqueos del personal
    // y al reabrirlo la profesional figuraría libre en horas que no lo está.
    expect(needsBlockedConversion(HALF, [])).toBe(false)
    expect(needsBlockedConversion(HALF, ["09:00"])).toBe(false)
  })
})

describe("convertBlockedSlots — 1 hora → 30 min conserva la cobertura EXACTA", () => {
  it("el jueves real de Leri (08:00–13:00 bloqueado) pasa de 5 filas a 10", () => {
    const leri = ["08:00", "09:00", "10:00", "11:00", "12:00"].map((slot) => ({
      staff_id: "leri",
      slot,
    }))
    const res = convertBlockedSlots(HOURLY, HALF, leri)
    expect(res.dropped).toBe(0)
    expect(slotsOf(res.rows, "leri")).toEqual([
      "08:00", "08:30",
      "09:00", "09:30",
      "10:00", "10:30",
      "11:00", "11:30",
      "12:00", "12:30",
    ])
    // Cobertura idéntica: seguía libre a partir de las 13:00.
    expect(res.rows.some((r) => r.slot >= "13:00")).toBe(false)
  })

  it("una sola casilla se desdobla y no pisa la hora anterior ni la siguiente", () => {
    const res = convertBlockedSlots(HOURLY, HALF, [{ staff_id: "roman", slot: "16:00" }])
    expect(slotsOf(res.rows, "roman")).toEqual(["16:00", "16:30"])
  })

  it("cada profesional se convierte por separado", () => {
    const res = convertBlockedSlots(HOURLY, HALF, [
      { staff_id: "leri", slot: "08:00" },
      { staff_id: "roman", slot: "17:00" },
    ])
    expect(slotsOf(res.rows, "leri")).toEqual(["08:00", "08:30"])
    expect(slotsOf(res.rows, "roman")).toEqual(["17:00", "17:30"])
  })
})

describe("convertBlockedSlots — 30 min → 1 hora bloquea de más, nunca de menos", () => {
  it("la media hora colapsa al comienzo de su hora y se deduplica", () => {
    const res = convertBlockedSlots(HALF, HOURLY, [
      { staff_id: "leri", slot: "08:00" },
      { staff_id: "leri", slot: "08:30" },
      { staff_id: "leri", slot: "09:30" },
    ])
    expect(res.dropped).toBe(0)
    // 09:30 sola bloquea TODA la hora de las 09:00 (dirección segura).
    expect(slotsOf(res.rows, "leri")).toEqual(["08:00", "09:00"])
  })

  it("ida y vuelta del jueves de Leri: 08–13 sigue siendo 08–13", () => {
    const original = ["08:00", "09:00", "10:00", "11:00", "12:00"].map((slot) => ({
      staff_id: "leri",
      slot,
    }))
    const fina = convertBlockedSlots(HOURLY, HALF, original)
    const gruesa = convertBlockedSlots(HALF, HOURLY, fina.rows)
    expect(gruesa.dropped).toBe(0)
    expect(slotsOf(gruesa.rows, "leri")).toEqual(original.map((r) => r.slot))
  })
})

describe("convertBlockedSlots — filas que no entran en la grilla nueva", () => {
  it("se descartan y se cuentan", () => {
    // La grilla nueva arranca a las 10:00: las 08:00 ya no existen.
    const nueva = ["10:00", "10:30", "11:00", "11:30"]
    const res = convertBlockedSlots(HOURLY, nueva, [
      { staff_id: "leri", slot: "08:00" },
      { staff_id: "leri", slot: "10:00" },
    ])
    expect(res.dropped).toBe(1)
    expect(slotsOf(res.rows, "leri")).toEqual(["10:00", "10:30"])
  })

  it("un horario roto se descuenta en vez de romper todo", () => {
    const res = convertBlockedSlots(HOURLY, HALF, [{ staff_id: "leri", slot: "ninguno" }])
    expect(res.dropped).toBe(1)
    expect(res.rows).toEqual([])
  })

  it("sin grilla nueva (día cerrado) las filas quedan como están", () => {
    const filas = [{ staff_id: "roman", slot: "09:00" }]
    const res = convertBlockedSlots(HOURLY, [], filas)
    expect(res).toEqual({ rows: filas, dropped: 0 })
  })
})

describe("convertBlockedSlots — sin cambio de paso es la identidad", () => {
  it("mismo paso → las mismas filas (por si alguna vez se llama de más)", () => {
    const filas = [
      { staff_id: "roman", slot: "16:00" },
      { staff_id: "roman", slot: "17:00" },
    ]
    const res = convertBlockedSlots(HOURLY, HOURLY, filas)
    expect(res.dropped).toBe(0)
    expect(slotsOf(res.rows, "roman")).toEqual(["16:00", "17:00"])
  })

  it("el sábado de Roman (grilla propia de 09 a 14) también sobrevive la ida y vuelta", () => {
    const sabHora = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]
    const sabMedia = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"]
    const todoElSabado = sabHora.map((slot) => ({ staff_id: "roman", slot }))

    const fina = convertBlockedSlots(sabHora, sabMedia, todoElSabado)
    // 14:00 tapaba 14:00–15:00; en la grilla nueva sólo existe 14:00.
    expect(slotsOf(fina.rows, "roman")).toEqual(sabMedia)
    const gruesa = convertBlockedSlots(sabMedia, sabHora, fina.rows)
    expect(slotsOf(gruesa.rows, "roman")).toEqual(sabHora)
  })
})
