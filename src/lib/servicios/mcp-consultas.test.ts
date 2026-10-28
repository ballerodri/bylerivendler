import { describe, it, expect } from "vitest"
import {
  hoyAR,
  rangoDelDiaAR,
  esFechaValida,
  restarDias,
  diasEntre,
  limpiarTexto,
  limpiarFiltro,
  cierreDelDia,
  horariosOfrecibles,
} from "./mcp-consultas"

describe("hoyAR — hoy en hora argentina", () => {
  it("a las 23:00 de Argentina todavía es el mismo día (aunque en UTC ya sea el siguiente)", () => {
    // 2026-10-29T02:00Z = 2026-10-28 23:00 en Argentina.
    expect(hoyAR(new Date("2026-10-29T02:00:00Z"))).toBe("2026-10-28")
  })
  it("a las 00:30 de Argentina ya es el día nuevo", () => {
    expect(hoyAR(new Date("2026-10-29T03:30:00Z"))).toBe("2026-10-29")
  })
})

describe("rangoDelDiaAR — de dónde a dónde va un día", () => {
  it("arranca a las 00:00 argentinas y dura 24 horas", () => {
    const { desde, hasta } = rangoDelDiaAR("2026-10-28")
    expect(desde).toBe("2026-10-28T03:00:00.000Z")
    expect(hasta).toBe("2026-10-29T03:00:00.000Z")
  })
})

describe("esFechaValida", () => {
  it("acepta una fecha real", () => {
    expect(esFechaValida("2026-10-28")).toBe(true)
    expect(esFechaValida("2028-02-29")).toBe(true) // bisiesto
  })
  it("rechaza lo que no es una fecha", () => {
    expect(esFechaValida("2026-13-45")).toBe(false)
    expect(esFechaValida("2026-02-30")).toBe(false)
    expect(esFechaValida("2027-02-29")).toBe(false) // no bisiesto
    expect(esFechaValida("28/10/2026")).toBe(false)
    expect(esFechaValida("")).toBe(false)
    expect(esFechaValida(undefined)).toBe(false)
    expect(esFechaValida(20261028)).toBe(false)
  })
  it("rechaza años absurdos (un año enorme rompe la consulta a la base)", () => {
    expect(esFechaValida("9999-01-01")).toBe(false)
    expect(esFechaValida("0001-01-01")).toBe(false)
  })
})

describe("restarDias", () => {
  it("resta días cruzando el fin de mes", () => {
    expect(restarDias("2026-10-01", 1)).toBe("2026-09-30")
    expect(restarDias("2026-10-28", 6)).toBe("2026-10-22")
  })
  it("cruza el fin de año", () => {
    expect(restarDias("2027-01-02", 3)).toBe("2026-12-30")
  })
})

describe("diasEntre", () => {
  it("cuenta los días de diferencia", () => {
    expect(diasEntre("2026-10-22", "2026-10-28")).toBe(6)
    expect(diasEntre("2026-10-28", "2026-10-28")).toBe(0)
    expect(diasEntre("2026-01-01", "2026-12-31")).toBe(364)
  })
})

describe("limpiarTexto — lo que escribe el asistente antes de tocar la base", () => {
  it("deja pasar un nombre normal", () => {
    expect(limpiarTexto("  Maria  Perez ")).toBe("Maria Perez")
  })
  it("saca los comodines: un '%' solo listaría TODAS las clientas", () => {
    expect(limpiarTexto("%")).toBe("")
    expect(limpiarTexto("*")).toBe("")
    expect(limpiarTexto("ma%ria")).toBe("maria")
    expect(limpiarTexto("a" + "\\" + "b")).toBe("ab")
  })
  it("el guión bajo se vuelve espacio (suele venir en lugar de uno)", () => {
    expect(limpiarTexto("vela_slim")).toBe("vela slim")
  })
  it("NO toca los paréntesis ni las comas: un tratamiento puede llamarse así", () => {
    expect(limpiarTexto("Vela Slim (Premium)")).toBe("Vela Slim (Premium)")
    expect(limpiarTexto("Masaje, 60 min")).toBe("Masaje, 60 min")
  })
})

describe("limpiarFiltro — el texto que va dentro de un or(...)", () => {
  it("ahí la coma y los paréntesis SÍ son sintaxis: se sacan", () => {
    expect(limpiarFiltro("ana,benito")).toBe("ana benito")
    expect(limpiarFiltro("vela slim (premium)")).toBe("vela slim premium")
    expect(limpiarFiltro("x.ilike.%,phone.ilike.%")).toBe("x.ilike. phone.ilike.")
  })
  it("también saca los comodines", () => {
    expect(limpiarFiltro("%")).toBe("")
    expect(limpiarFiltro("ma%ria")).toBe("maria")
  })
})

describe("cierreDelDia", () => {
  it("es el último horario más un paso de la grilla", () => {
    expect(cierreDelDia(["09:00", "10:00", "11:00"])).toBe(12 * 60)
    expect(cierreDelDia(["09:00", "09:30", "10:00"])).toBe(10 * 60 + 30)
  })
  it("con la pausa del mediodía usa el paso chico, no el salto grande", () => {
    expect(cierreDelDia(["09:00", "10:00", "11:00", "15:00", "16:00"])).toBe(17 * 60)
  })
  it("con un solo horario cae al paso de 1 hora", () => {
    expect(cierreDelDia(["10:00"])).toBe(11 * 60)
  })
  it("con la grilla vacía o rota no recorta nada (la web tampoco)", () => {
    expect(cierreDelDia([])).toBe(Number.POSITIVE_INFINITY)
    expect(cierreDelDia(["mediodía"])).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("horariosOfrecibles — la regla más peligrosa del asistente", () => {
  const GRILLA = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30"]
  const CIERRE = 21 * 60 // 19:30 + 1:30
  const base = { slots: GRILLA, duracionMin: 60, cierreMin: CIERRE, margenMin: 120 }

  it("en un día futuro ofrece todos y no marca ninguno", () => {
    const r = horariosOfrecibles({ ...base, ahoraMin: null })
    expect(r.candidatos).toEqual(GRILLA)
    expect(r.soloPanel).toEqual([])
  })

  it("a las 15:00 NO esconde la tarde: la ofrece, y marca lo que la web ya no vende", () => {
    // El caso que importa: el salón está vacío, la clienta llama, y la web no
    // vendería 15:00 ni 16:30 por el margen de 2 h. El salón SÍ puede cargarlos.
    const r = horariosOfrecibles({ ...base, ahoraMin: 15 * 60 })
    expect(r.candidatos).toEqual(["15:00", "16:30", "18:00", "19:30"])
    expect(r.soloPanel).toEqual(["15:00", "16:30"])
  })

  it("lo que ya pasó no se ofrece nunca", () => {
    const r = horariosOfrecibles({ ...base, ahoraMin: 15 * 60 + 1 })
    expect(r.candidatos).not.toContain("15:00")
    expect(r.candidatos[0]).toBe("16:30")
  })

  it("un tratamiento largo no se ofrece si se pasa del cierre", () => {
    const r = horariosOfrecibles({ ...base, duracionMin: 120, ahoraMin: null })
    expect(r.candidatos).toEqual(["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00"])
  })

  it("después del cierre no queda nada (y no se inventa)", () => {
    const r = horariosOfrecibles({ ...base, ahoraMin: 20 * 60 })
    expect(r.candidatos).toEqual([])
    expect(r.soloPanel).toEqual([])
  })

  it("el horario justo en el borde del margen ya lo vende la web", () => {
    // Son las 13:00: 15:00 está a 120 min exactos → la web lo vende.
    const r = horariosOfrecibles({ ...base, ahoraMin: 13 * 60 })
    expect(r.candidatos).toContain("15:00")
    expect(r.soloPanel).toEqual(["13:30"])
  })
})
