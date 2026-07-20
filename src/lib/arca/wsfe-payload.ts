export interface Auth {
  Token: string
  Sign: string
  Cuit: string
}

export type DocTipo = 99 | 96 | 80 // 99=Consumidor Final, 96=DNI, 80=CUIT

/** Un comprobante al que este apunta (una nota de crédito referencia la
 *  factura que anula). ARCA lo exige en las notas de crédito. */
export interface CbteAsociado {
  tipo: number // 11 = Factura C
  ptoVta: number
  nro: number
  cuit: string // CUIT del emisor (el mismo salón)
  fecha: Date // fecha de emisión del comprobante original
}

export interface InvoiceInput {
  ptoVta: number
  concepto: 1 | 2 | 3 // 1=Productos, 2=Servicios, 3=Productos y Servicios
  docTipo: DocTipo
  docNro: string
  condIvaReceptor: number // 5 = Consumidor Final
  totalCents: number
  fecha: Date
  servDesde?: Date
  servHasta?: Date
  vtoPago?: Date
  /** 11 = Factura C (default), 13 = Nota de Crédito C. */
  cbteTipo?: number
  /** Sólo en una nota de crédito: la factura que anula. */
  cbteAsoc?: CbteAsociado
}

export function pesos(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

const AR_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export function isoDateAr(d: Date): string {
  return AR_FORMATTER.format(d) // yyyy-mm-dd
}

export function ymd(d: Date): string {
  return isoDateAr(d).replace(/-/g, "") // yyyymmdd
}

export function buildFeCAEReq(auth: Auth, input: InvoiceInput, cbteNro: number) {
  const importe = pesos(input.totalCents)
  const det: Record<string, unknown> = {
    Concepto: input.concepto,
    DocTipo: input.docTipo,
    DocNro: input.docNro,
    CbteDesde: cbteNro,
    CbteHasta: cbteNro,
    CbteFch: ymd(input.fecha),
    ImpTotal: importe,
    ImpTotConc: 0,
    ImpNeto: importe, // Factura C: neto = total, sin IVA discriminado
    ImpOpEx: 0,
    ImpIVA: 0,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: input.condIvaReceptor,
  }
  if (input.concepto === 2 || input.concepto === 3) {
    det.FchServDesde = ymd(input.servDesde ?? input.fecha)
    det.FchServHasta = ymd(input.servHasta ?? input.fecha)
    det.FchVtoPago = ymd(input.vtoPago ?? input.fecha)
  }
  // Nota de crédito: apunta a la factura que anula (ARCA lo exige).
  if (input.cbteAsoc) {
    det.CbtesAsoc = {
      CbteAsoc: {
        Tipo: input.cbteAsoc.tipo,
        PtoVta: input.cbteAsoc.ptoVta,
        Nro: input.cbteAsoc.nro,
        Cuit: input.cbteAsoc.cuit,
        CbteFch: ymd(input.cbteAsoc.fecha),
      },
    }
  }
  return {
    Auth: auth,
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: input.ptoVta, CbteTipo: input.cbteTipo ?? 11 },
      FeDetReq: { FECAEDetRequest: det },
    },
  }
}
