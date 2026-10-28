// Estado de facturación de un turno YA REALIZADO, para la vista unificada de
// "Turnos realizados" (antes había que entrar clienta por clienta para ver qué
// faltaba facturar).
//
// "Realizado" = el turno quedó firme (confirmado, en curso o completado) y su
// hora ya pasó. Un pendiente que nunca se confirmó, un cancelado o un "no vino"
// no se hicieron, así que no se facturan y no entran en la lista.
//
// "Facturado" usa el MISMO criterio que la guarda de `emitirFacturaTurno`: una
// FACTURA C (11) emitida y NO anulada. Una nota de crédito (13) no cuenta, y
// una factura anulada deja el turno otra vez sin facturar.

export const ESTADOS_REALIZADOS = ["confirmed", "in_progress", "completed"] as const

/** ¿Este turno ya se hizo? (firme + hora pasada) */
export function fueRealizado(status: string, startsAt: string, nowMs: number): boolean {
  return (
    (ESTADOS_REALIZADOS as readonly string[]).includes(status) &&
    new Date(startsAt).getTime() <= nowMs
  )
}

export type InvoiceLite = {
  id: string
  appointment_id: string | null
  cbte_tipo: number
  cbte_nro: number | null
  pto_vta: number
  estado: string
  anulada: boolean
}

export type EstadoFacturacion =
  /** Tiene su Factura C viva. */
  | { tipo: "facturado"; invoice: InvoiceLite }
  /** Turno en $0: sesión de pack / programa (se factura la venta) o canje. */
  | { tipo: "no_aplica"; motivo: "pack" | "programa" | "cero" }
  /** Falta facturar. `anulada` = tuvo una factura pero se anuló. */
  | { tipo: "sin_facturar"; anulada: boolean }

/** Una FACTURA C emitida y viva (no una nota de crédito, no anulada). */
export function esFacturaViva(f: InvoiceLite): boolean {
  return f.cbte_tipo === 11 && f.estado === "emitida" && !f.anulada
}

export function estadoFacturacion(
  appt: { id: string; total_cents: number; pack_purchase_id: string | null; combo_purchase_id: string | null },
  invoicesDelTurno: InvoiceLite[]
): EstadoFacturacion {
  const viva = invoicesDelTurno.find(esFacturaViva)
  // Primero la factura: si por algo un turno en $0 tiene una, se muestra.
  if (viva) return { tipo: "facturado", invoice: viva }
  if (appt.total_cents <= 0) {
    return {
      tipo: "no_aplica",
      motivo: appt.pack_purchase_id ? "pack" : appt.combo_purchase_id ? "programa" : "cero",
    }
  }
  const anulada = invoicesDelTurno.some((f) => f.cbte_tipo === 11 && f.anulada)
  return { tipo: "sin_facturar", anulada }
}

/** "0001-00000123" */
export function numeroComprobante(f: { pto_vta: number; cbte_nro: number | null }): string {
  return `${String(f.pto_vta).padStart(4, "0")}-${String(f.cbte_nro ?? 0).padStart(8, "0")}`
}
