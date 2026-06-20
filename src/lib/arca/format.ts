export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export function ddmmyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

export function receptorDocLabel(docTipo: number, docNro: string): string {
  if (docTipo === 96) return `DNI ${docNro}`
  if (docTipo === 80) return `CUIT ${docNro}`
  return "Consumidor Final"
}
