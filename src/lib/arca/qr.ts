export interface QrData {
  fecha: string // yyyy-mm-dd
  cuit: number
  ptoVta: number
  tipoCmp: number
  nroCmp: number
  importe: number
  moneda: string
  ctz: number
  tipoDocRec: number
  nroDocRec: number
  codAut: number // CAE como número
}

export function buildQrUrl(d: QrData): string {
  const payload = {
    ver: 1,
    fecha: d.fecha,
    cuit: d.cuit,
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    importe: d.importe,
    moneda: d.moneda,
    ctz: d.ctz,
    tipoDocRec: d.tipoDocRec,
    nroDocRec: d.nroDocRec,
    tipoCodAut: "E",
    codAut: d.codAut,
  }
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}
