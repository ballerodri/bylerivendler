import { describe, it, expect } from "vitest"
import {
  classifyPadronError,
  deducirCondicionIva,
  docTipoParaDocumento,
  elegirCuitParaDocumento,
  etiquetaCondicionIva,
  mismoDocumento,
  normalizarDoc,
  parseIdPersonaList,
  parsePersona,
} from "./padron-parse"

// Las respuestas del padrón A13 no están verificadas contra el servicio real.
// Estos fixtures son las formas PLAUSIBLES que puede tomar la respuesta; el
// parseo tiene que aguantar todas.

describe("normalizarDoc", () => {
  it("deja sólo los dígitos", () => {
    expect(normalizarDoc("20-30.123.456-7")).toBe("20301234567")
    expect(normalizarDoc(" 30.123.456 ")).toBe("30123456")
    expect(normalizarDoc(null)).toBe("")
    expect(normalizarDoc("abc")).toBe("")
  })
})

describe("docTipoParaDocumento", () => {
  it("deduce el tipo por el largo", () => {
    expect(docTipoParaDocumento("")).toBe(99)
    expect(docTipoParaDocumento(null)).toBe(99)
    expect(docTipoParaDocumento("30123456")).toBe(96)
    expect(docTipoParaDocumento("20301234567")).toBe(80)
  })

  it("un DNI viejo de 7 dígitos sigue siendo DNI, no Consumidor Final", () => {
    expect(docTipoParaDocumento("6123456")).toBe(96)
  })

  it("normaliza antes de medir el largo", () => {
    expect(docTipoParaDocumento("20-30.123.456-7")).toBe(80)
  })

  it("sólo el largo 11 es CUIT; el resto de los largos raros son DNI", () => {
    expect(docTipoParaDocumento("6123456")).toBe(96) // 7
    expect(docTipoParaDocumento("30123456")).toBe(96) // 8
    expect(docTipoParaDocumento("3012345678")).toBe(96) // 10
    expect(docTipoParaDocumento("20301234567")).toBe(80) // 11
    expect(docTipoParaDocumento("203012345678")).toBe(96) // 12
  })

  it("la basura sin dígitos es Consumidor Final", () => {
    expect(docTipoParaDocumento("abc")).toBe(99)
    expect(docTipoParaDocumento("  ")).toBe(99)
    expect(docTipoParaDocumento("-.-")).toBe(99)
    expect(docTipoParaDocumento(undefined)).toBe(99)
  })
})

describe("parsePersona — formas posibles del sobre", () => {
  const fisica = {
    idPersona: 20301234567,
    tipoPersona: "FISICA",
    tipoClave: "CUIT",
    estadoClave: "ACTIVO",
    apellido: "GOMEZ",
    nombre: "LUCIA",
    tipoDocumento: "DNI",
    numeroDocumento: "30123456",
  }

  it("lee la persona envuelta en personaReturn", () => {
    const p = parsePersona({ personaReturn: { metadata: { fechaActualizacion: "2026-07-18" }, persona: fisica } })
    expect(p).toEqual({
      doc: "20301234567",
      docTipo: 80,
      nombre: "LUCIA GOMEZ",
      condicionIva: null,
      condicionIvaTexto: null,
    })
  })

  it("lee la persona con los campos colgando de personaReturn", () => {
    const p = parsePersona({ personaReturn: fisica })
    expect(p?.doc).toBe("20301234567")
    expect(p?.nombre).toBe("LUCIA GOMEZ")
  })

  it("lee la persona suelta, sin sobre", () => {
    expect(parsePersona(fisica)?.doc).toBe("20301234567")
  })

  it("lee la persona dentro de un array", () => {
    expect(parsePersona({ persona: [fisica] })?.doc).toBe("20301234567")
  })

  it("lee la persona con doble sobre y metadata primero", () => {
    const p = parsePersona({
      personaReturn: { metadata: { servidor: "aws", fechaActualizacion: "2026-07-18" }, persona: { ...fisica } },
    })
    expect(p?.nombre).toBe("LUCIA GOMEZ")
  })

  it("devuelve null si no hay nadie", () => {
    expect(parsePersona(null)).toBeNull()
    expect(parsePersona({})).toBeNull()
    expect(parsePersona({ personaReturn: { metadata: { fechaActualizacion: "2026-07-18" } } })).toBeNull()
  })

  it("devuelve null si hay persona pero sin documento usable", () => {
    expect(parsePersona({ persona: { apellido: "GOMEZ", nombre: "LUCIA" } })).toBeNull()
  })
})

describe("parsePersona — nombre", () => {
  it("persona jurídica: usa la razón social", () => {
    const p = parsePersona({
      persona: {
        idPersona: "30712345678",
        tipoPersona: "JURIDICA",
        razonSocial: "ESTETICA DEL SUR S.R.L.",
      },
    })
    expect(p?.nombre).toBe("ESTETICA DEL SUR S.R.L.")
    expect(p?.docTipo).toBe(80)
  })

  it("persona jurídica sin razonSocial: cae en nombre", () => {
    const p = parsePersona({ persona: { idPersona: "30712345678", tipoPersona: "JURIDICA", nombre: "ESTETICA SA" } })
    expect(p?.nombre).toBe("ESTETICA SA")
  })

  it("sólo apellido", () => {
    expect(parsePersona({ persona: { idPersona: "20301234567", apellido: "GOMEZ" } })?.nombre).toBe("GOMEZ")
  })

  it("devuelve la persona aunque no haya nombre (para poder diagnosticar)", () => {
    const p = parsePersona({ persona: { idPersona: "20301234567" } })
    expect(p?.doc).toBe("20301234567")
    expect(p?.nombre).toBe("")
  })

  it("acepta campos envueltos por xml2js como { _: valor }", () => {
    const p = parsePersona({
      persona: { idPersona: { _: "20301234567", $: { tipo: "long" } }, apellido: { _: "GOMEZ" }, nombre: { _: "LUCIA" } },
    })
    expect(p?.doc).toBe("20301234567")
    expect(p?.nombre).toBe("LUCIA GOMEZ")
  })
})

describe("parsePersona — documento", () => {
  it("si no hay idPersona usa numeroDocumento como DNI", () => {
    const p = parsePersona({ persona: { apellido: "GOMEZ", nombre: "LUCIA", numeroDocumento: "30123456" } })
    expect(p).toMatchObject({ doc: "30123456", docTipo: 96 })
  })

  it("acepta el CUIT con guiones", () => {
    expect(parsePersona({ persona: { idPersona: "20-30123456-7" } })?.doc).toBe("20301234567")
  })

  it("acepta un DNI viejo de 7 dígitos", () => {
    const p = parsePersona({ persona: { numeroDocumento: "6123456", apellido: "PEREZ" } })
    expect(p).toMatchObject({ doc: "6123456", docTipo: 96 })
  })
})

describe("deducirCondicionIva", () => {
  it("responsable inscripto por descripción", () => {
    expect(deducirCondicionIva({ impuesto: [{ idImpuesto: 30, descripcionImpuesto: "IVA", estado: "ACTIVO" }] }))
      .toEqual({ codigo: 1, texto: "Responsable Inscripto" })
  })

  it("exento le gana a responsable inscripto (el texto dice IVA EXENTO)", () => {
    expect(deducirCondicionIva({ impuesto: { idImpuesto: 32, descripcionImpuesto: "IVA EXENTO", estado: "ACTIVO" } }))
      .toEqual({ codigo: 4, texto: "Exento" })
  })

  it("monotributista por descripción", () => {
    expect(
      deducirCondicionIva({
        impuesto: [{ idImpuesto: 20, descripcionImpuesto: "REGIMEN SIMPLIFICADO (MONOTRIBUTO)", estado: "ACTIVO" }],
      })
    ).toEqual({ codigo: 6, texto: "Monotributista" })
  })

  it("monotributo social tiene su propio código", () => {
    expect(deducirCondicionIva({ impuesto: [{ idImpuesto: 21, descripcionImpuesto: "MONOTRIBUTO SOCIAL" }] }))
      .toEqual({ codigo: 13, texto: "Monotributista social" })
  })

  it("el monotributo le gana a una inscripción vieja de IVA", () => {
    const r = deducirCondicionIva({
      impuesto: [
        { idImpuesto: 30, descripcionImpuesto: "IVA", estado: "ACTIVO" },
        { idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO", estado: "ACTIVO" },
      ],
    })
    expect(r?.codigo).toBe(6)
  })

  it("ignora los impuestos dados de baja", () => {
    expect(
      deducirCondicionIva({ impuesto: [{ idImpuesto: 30, descripcionImpuesto: "IVA", estado: "BAJA DEFINITIVA" }] })
    ).toBeNull()
  })

  it("usa el id cuando no viene descripción", () => {
    expect(deducirCondicionIva({ impuesto: [{ idImpuesto: 30 }] })?.codigo).toBe(1)
    expect(deducirCondicionIva({ impuesto: [{ idImpuesto: 32 }] })?.codigo).toBe(4)
    expect(deducirCondicionIva({ impuesto: [{ idImpuesto: 20 }] })?.codigo).toBe(6)
  })

  it("acepta la lista con nombre plural (impuestos)", () => {
    expect(deducirCondicionIva({ impuestos: [{ idImpuesto: 30, descripcionImpuesto: "IVA" }] })?.codigo).toBe(1)
  })

  it("mira también las categorías", () => {
    expect(
      deducirCondicionIva({ categoria: [{ idCategoria: 3, descripcionCategoria: "MONOTRIBUTO CATEGORIA C" }] })?.codigo
    ).toBe(6)
  })

  it("una clave CUIL sin impuestos es Consumidor Final", () => {
    expect(deducirCondicionIva({ tipoClave: "CUIL" })).toEqual({ codigo: 5, texto: "Consumidor Final" })
  })

  it("sin señales devuelve null (el que factura cae al default)", () => {
    expect(deducirCondicionIva({})).toBeNull()
    expect(deducirCondicionIva({ tipoClave: "CUIT", impuesto: [{ idImpuesto: 11, descripcionImpuesto: "GANANCIAS" }] }))
      .toBeNull()
  })

  it("no confunde impuestos que no son IVA", () => {
    expect(
      deducirCondicionIva({ impuesto: [{ idImpuesto: 10, descripcionImpuesto: "GANANCIAS PERSONAS FISICAS" }] })
    ).toBeNull()
  })

  it("la persona completa llega con su condición hasta parsePersona", () => {
    const p = parsePersona({
      personaReturn: {
        persona: {
          idPersona: "27301234564",
          apellido: "GOMEZ",
          nombre: "LUCIA",
          impuesto: [{ idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO", estado: "ACTIVO" }],
        },
      },
    })
    expect(p).toMatchObject({ condicionIva: 6, condicionIvaTexto: "Monotributista" })
  })
})

describe("deducirCondicionIva — monotributista promovido (RG 5616 = 16)", () => {
  // El error que motivó estos tests: devolvía 15, que en la tabla de ARCA es
  // "IVA No Alcanzado". ARCA lo acepta igual en una Factura C, así que la
  // factura salía con CAE real y la condición fiscal equivocada.
  it("el trabajador independiente promovido es 16, NUNCA 15", () => {
    const r = deducirCondicionIva({
      impuesto: [
        { idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO", estado: "ACTIVO" },
      ],
    })
    expect(r).toEqual({ codigo: 16, texto: "Monotributista promovido" })
    expect(r?.codigo).not.toBe(15)
  })

  it("le gana al monotributo común aunque la descripción diga las dos cosas", () => {
    expect(
      deducirCondicionIva({
        impuesto: [
          { idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO", estado: "ACTIVO" },
          { idImpuesto: 21, descripcionImpuesto: "TRABAJADOR INDEPENDIENTE PROMOVIDO", estado: "ACTIVO" },
        ],
      })?.codigo
    ).toBe(16)
  })

  it("un 'PROMOVIDO' suelto no se lleva puesto el código: exige la frase entera", () => {
    // Antes, cualquier descripción con la palabra suelta caía en promovido
    // porque el chequeo corría ANTES del de monotributo.
    expect(
      deducirCondicionIva({ impuesto: [{ idImpuesto: 20, descripcionImpuesto: "MONOTRIBUTO REGIMEN PROMOVIDO PROVINCIAL", estado: "ACTIVO" }] })?.codigo
    ).toBe(6)
    expect(
      deducirCondicionIva({ impuesto: [{ idImpuesto: 11, descripcionImpuesto: "ACTIVIDAD PROMOVIDA LEY 22021" }] })
    ).toBeNull()
  })

  it("el monotributo social sigue siendo 13 y le gana a todo", () => {
    expect(
      deducirCondicionIva({
        impuesto: [
          { idImpuesto: 21, descripcionImpuesto: "MONOTRIBUTO SOCIAL" },
          { idImpuesto: 20, descripcionImpuesto: "TRABAJADOR INDEPENDIENTE PROMOVIDO" },
        ],
      })?.codigo
    ).toBe(13)
  })

  it("nunca deduce 15 (IVA No Alcanzado) del padrón", () => {
    const descripciones = [
      "IVA",
      "IVA EXENTO",
      "MONOTRIBUTO",
      "MONOTRIBUTO SOCIAL",
      "REGIMEN SIMPLIFICADO (MONOTRIBUTO)",
      "MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO",
      "GANANCIAS",
    ]
    for (const d of descripciones) {
      expect(deducirCondicionIva({ impuesto: [{ descripcionImpuesto: d }] })?.codigo).not.toBe(15)
    }
  })
})

describe("etiquetaCondicionIva — tabla RG 5616 completa", () => {
  // Si alguno de estos se mueve, se está informando una condición fiscal
  // distinta de la que dice el PDF que recibe la clienta.
  const TABLA: Record<number, string> = {
    1: "Responsable Inscripto",
    4: "Exento",
    5: "Consumidor Final",
    6: "Monotributista",
    7: "Sujeto No Categorizado",
    8: "Proveedor del Exterior",
    9: "Cliente del Exterior",
    10: "IVA Liberado - Ley 19.640",
    13: "Monotributista social",
    15: "IVA No Alcanzado",
    16: "Monotributista promovido",
  }

  it("nombra los once códigos de la tabla de ARCA", () => {
    for (const [codigo, etiqueta] of Object.entries(TABLA)) {
      expect(etiquetaCondicionIva(Number(codigo))).toBe(etiqueta)
    }
  })

  it("15 y 16 no se confunden entre sí", () => {
    expect(etiquetaCondicionIva(15)).toBe("IVA No Alcanzado")
    expect(etiquetaCondicionIva(16)).toBe("Monotributista promovido")
  })

  it("los códigos que no existen se muestran crudos, sin inventar", () => {
    expect(etiquetaCondicionIva(null)).toBeNull()
    expect(etiquetaCondicionIva(99)).toBe("Código 99")
    expect(etiquetaCondicionIva(2)).toBe("Código 2")
  })
})

describe("mismoDocumento", () => {
  it("un DNI y su CUIT son la misma persona", () => {
    expect(mismoDocumento("20301234567", "30123456")).toBe(true)
    expect(mismoDocumento("30123456", "27301234564")).toBe(true)
  })

  it("el mismo documento igual a sí mismo", () => {
    expect(mismoDocumento("30123456", "30123456")).toBe(true)
    expect(mismoDocumento("20-30.123.456-7", "20301234567")).toBe(true)
  })

  it("un DNI viejo de 7 dígitos coincide con su CUIT (que lo lleva con un 0 adelante)", () => {
    expect(mismoDocumento("20061234563", "6123456")).toBe(true)
  })

  it("el CUIT del salón NO es la clienta", () => {
    expect(mismoDocumento("27123456789", "30123456")).toBe(false)
    expect(mismoDocumento("30712345678", "30123456")).toBe(false)
  })

  it("vacío o basura nunca coincide", () => {
    expect(mismoDocumento("", "30123456")).toBe(false)
    expect(mismoDocumento("30123456", null)).toBe(false)
    expect(mismoDocumento("abc", "30123456")).toBe(false)
  })
})

describe("elegirCuitParaDocumento", () => {
  it("descarta los CUIT que no llevan adentro el DNI buscado", () => {
    // El segundo es el CUIT del salón que ARCA devuelve de rebote.
    expect(elegirCuitParaDocumento(["20301234567", "27999999995"], "30123456")).toBe("20301234567")
  })

  it("con varios CUIT propios elige siempre el mismo (el menor)", () => {
    expect(elegirCuitParaDocumento(["27301234564", "20301234567"], "30123456")).toBe("20301234567")
    expect(elegirCuitParaDocumento(["20301234567", "27301234564"], "30123456")).toBe("20301234567")
  })

  it("si ninguno es de esa persona devuelve null en vez de adivinar", () => {
    expect(elegirCuitParaDocumento(["27999999995"], "30123456")).toBeNull()
    expect(elegirCuitParaDocumento([], "30123456")).toBeNull()
  })
})

describe("parseIdPersonaList", () => {
  it("lee la lista envuelta", () => {
    expect(
      parseIdPersonaList({ idPersonaListReturn: { metadata: { fechaActualizacion: "2026-07-18" }, idPersona: [20301234567, 27301234564] } })
    ).toEqual(["20301234567", "27301234564"])
  })

  it("lee un único CUIT sin lista", () => {
    expect(parseIdPersonaList({ idPersonaListReturn: { idPersona: "20301234567" } })).toEqual(["20301234567"])
  })

  it("lee un array pelado", () => {
    expect(parseIdPersonaList([20301234567])).toEqual(["20301234567"])
  })

  it("ignora la metadata y las fechas", () => {
    expect(
      parseIdPersonaList({ metadata: { fechaActualizacion: "2026-07-18", servidor: "20301234567" }, idPersona: [] })
    ).toEqual([])
  })

  it("no repite CUIT", () => {
    expect(parseIdPersonaList({ idPersona: [20301234567, "20-30123456-7"] })).toEqual(["20301234567"])
  })

  it("devuelve vacío cuando no hay nadie", () => {
    expect(parseIdPersonaList({ idPersonaListReturn: {} })).toEqual([])
    expect(parseIdPersonaList(null)).toEqual([])
  })
})

describe("classifyPadronError", () => {
  it("detecta el servicio no autorizado", () => {
    expect(classifyPadronError(new Error("ns1:cee.notAuthorized: El CUIT no está autorizado"))).toBe("no-autorizado")
    expect(classifyPadronError(new Error("El computador no está autorizado a acceder al servicio"))).toBe("no-autorizado")
    expect(classifyPadronError("Request failed with status code 403 Forbidden")).toBe("no-autorizado")
  })

  it("detecta la persona inexistente", () => {
    expect(classifyPadronError(new Error("No existe persona con ese Id"))).toBe("no-encontrado")
  })

  it("detecta la falta de configuración", () => {
    expect(classifyPadronError(new Error("Falta la variable de entorno ARCA_CERT"))).toBe("config")
  })

  it("todo lo demás es ARCA caído", () => {
    expect(classifyPadronError(new Error("connect ETIMEDOUT 200.1.2.3:443"))).toBe("arca-caido")
    expect(classifyPadronError(new Error("socket hang up"))).toBe("arca-caido")
    expect(classifyPadronError(new Error("timeout: ARCA no respondió en 20 s (getPersona)"))).toBe("arca-caido")
    expect(classifyPadronError(new Error("Error: connect ECONNREFUSED"))).toBe("arca-caido")
    expect(classifyPadronError(undefined)).toBe("arca-caido")
  })

  it("no se confunde con acentos ni mayúsculas", () => {
    expect(classifyPadronError(new Error("SIN AUTORIZACIÓN para el servicio"))).toBe("no-autorizado")
  })
})
