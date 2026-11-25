import { describe, it, expect } from "vitest"
import {
  PREMIOS,
  CASILLEROS,
  estadoCalendario,
  sortearPremio,
  generarCodigo,
  telefonoParaAdviento,
  telefonoLindo,
  clavePorTelefono,
  partirNombre,
  mensajeParaLeri,
  linkParaLeri,
  premioPorId,
} from "./adviento"

describe("los 24 premios", () => {
  it("son 24, numerados del 1 al 24 y sin texto vacío", () => {
    expect(PREMIOS).toHaveLength(CASILLEROS)
    expect(PREMIOS.map((p) => p.id)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    for (const p of PREMIOS) expect(p.texto.length).toBeGreaterThan(10)
  })
  it("se busca uno por su número", () => {
    expect(premioPorId(1)?.texto).toContain("$30.000")
    expect(premioPorId(99)).toBeNull()
  })
})

describe("estadoCalendario — la ventana de diciembre", () => {
  // 03:00Z = medianoche en Argentina.
  const alMediodiaAR = (iso: string) => new Date(iso + "T15:00:00Z")

  it("antes del 1 de diciembre todavía no arrancó", () => {
    expect(estadoCalendario(alMediodiaAR("2026-11-30"))).toBe("antes")
  })
  it("del 1 al 24 se puede elegir", () => {
    expect(estadoCalendario(alMediodiaAR("2026-12-01"))).toBe("abierto")
    expect(estadoCalendario(alMediodiaAR("2026-12-12"))).toBe("abierto")
    expect(estadoCalendario(alMediodiaAR("2026-12-24"))).toBe("abierto")
  })
  it("del 25 al 31 ya no se elige, pero el premio sigue valiendo", () => {
    expect(estadoCalendario(alMediodiaAR("2026-12-25"))).toBe("solo-canje")
    expect(estadoCalendario(alMediodiaAR("2026-12-31"))).toBe("solo-canje")
  })
  it("en enero se terminó", () => {
    expect(estadoCalendario(alMediodiaAR("2027-01-01"))).toBe("terminado")
  })
  it("el 1 de diciembre a las 23:00 de Argentina todavía es el 1 (no el 2 de UTC)", () => {
    // 2026-12-02T02:00Z = 1/12 23:00 en Argentina.
    expect(estadoCalendario(new Date("2026-12-02T02:00:00Z"))).toBe("abierto")
    // Y el 25 a las 00:30 de Argentina ya no se elige.
    expect(estadoCalendario(new Date("2026-12-25T03:30:00Z"))).toBe("solo-canje")
  })
})

describe("sortearPremio — tiene que ser sorpresa de verdad", () => {
  it("siempre devuelve un premio de la lista", () => {
    for (let i = 0; i < 500; i++) expect(PREMIOS).toContain(sortearPremio())
  })
  it("con muchas tiradas salen los 24 (no siempre el mismo)", () => {
    const vistos = new Set<number>()
    for (let i = 0; i < 5000; i++) vistos.add(sortearPremio().id)
    expect(vistos.size).toBe(24)
  })
  it("no se cae en los bordes del azar", () => {
    expect(sortearPremio(() => 0).id).toBe(1)
    expect(sortearPremio(() => 0.999999).id).toBe(24)
    expect(sortearPremio(() => 1).id).toBe(24)
  })
})

describe("generarCodigo", () => {
  it("lleva el casillero adentro y no tiene letras confusas", () => {
    const c = generarCodigo(7)
    expect(c).toMatch(/^ADV-7[A-Z2-9]{4}$/)
    expect(c).not.toMatch(/[IO01]/)
    expect(generarCodigo(24)).toMatch(/^ADV-24[A-Z2-9]{4}$/)
  })
  it("casi no se repite en 10.000 tiradas", () => {
    const vistos = new Set<string>()
    for (let i = 0; i < 10_000; i++) vistos.add(generarCodigo(7))
    // Con 32^4 combinaciones, los choques son poquísimos; igual la base tiene
    // el código como único y la jugada se reintenta.
    expect(vistos.size).toBeGreaterThan(9_900)
  })
})

describe("telefonoParaAdviento — la llave de una sorpresa por persona", () => {
  it("el mismo celular escrito de cinco formas es LA MISMA persona", () => {
    const formas = ["1123456789", "11 2345-6789", "+54 9 11 2345 6789", "011 2345-6789", "541123456789"]
    const claves = new Set(
      formas.map((f) => {
        const r = telefonoParaAdviento(f)
        expect(r.ok).toBe(true)
        return r.ok ? r.clave : ""
      })
    )
    expect(claves.size).toBe(1)
    expect([...claves][0]).toBe("+5491123456789")
  })
  it("entiende el 15 entre la característica y el número", () => {
    const r = telefonoParaAdviento("11 15 2345-6789")
    expect(r.ok && r.clave).toBe("+5491123456789")
  })
  it("rechaza el 15 solo, sin característica (no dice de qué ciudad es)", () => {
    const r = telefonoParaAdviento("15 1234-5678")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain("característica")
  })
  it("rechaza números cortos o de más", () => {
    expect(telefonoParaAdviento("12345678").ok).toBe(false)
    expect(telefonoParaAdviento("1123456789123").ok).toBe(false)
    expect(telefonoParaAdviento("").ok).toBe(false)
    expect(telefonoParaAdviento("no tengo").ok).toBe(false)
  })
  it("lo muestra lindo para que la persona lo confirme", () => {
    const r = telefonoParaAdviento("1123456789")
    expect(r.ok && r.lindo).toBe("+54 9 11 2345-6789")
  })
  it("no inventa la característica cuando no la sabe (un número de Zárate no es de 348)", () => {
    expect(telefonoLindo("3487654321")).toBe("+54 9 3487 654 321")
    expect(telefonoLindo("2216543210")).toBe("+54 9 2216 543 210")
  })
})

describe("clavePorTelefono — la MISMA cuenta para el calendario y para las clientas", () => {
  it("convierte todas las formas en una sola llave", () => {
    for (const f of ["1123456789", "011 2345-6789", "+54 9 11 2345 6789", "11 15 2345-6789"])
      expect(clavePorTelefono(f)).toBe("+5491123456789")
  })
  it("devuelve null con lo que no es un celular", () => {
    expect(clavePorTelefono("")).toBeNull()
    expect(clavePorTelefono(null)).toBeNull()
    expect(clavePorTelefono("sin telefono")).toBeNull()
    expect(clavePorTelefono("12345")).toBeNull()
  })
})

describe("partirNombre", () => {
  it("separa nombre y apellido", () => {
    expect(partirNombre("María Pérez")).toEqual({ nombre: "María", apellido: "Pérez" })
    expect(partirNombre("  ana   maria  gomez lopez ")).toEqual({
      nombre: "ana",
      apellido: "maria gomez lopez",
    })
  })
  it("pide el apellido si falta", () => {
    expect(partirNombre("María")).toBeNull()
    expect(partirNombre("")).toBeNull()
    expect(partirNombre("M P")).toBeNull()
  })
})

describe("el mensaje para Leri", () => {
  const datos = {
    nombre: "María",
    apellido: "Pérez",
    casillero: 7,
    premio: "Dermapen hidratante: $35.000.",
    codigo: "ADV-7K3M",
  }
  it("dice quién es, qué número eligió, qué le tocó y su código", () => {
    const m = mensajeParaLeri(datos)
    expect(m).toContain("María Pérez")
    expect(m).toContain("número 7")
    expect(m).toContain("Dermapen hidratante")
    expect(m).toContain("ADV-7K3M")
  })
  it("el link abre el WhatsApp del salón con el mensaje adentro", () => {
    const link = linkParaLeri(datos)
    expect(link).toContain("wa.me/5491133643359")
    expect(decodeURIComponent(link)).toContain("ADV-7K3M")
  })
})
