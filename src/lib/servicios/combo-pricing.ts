// El precio de un PROGRAMA (combo multi-sesión): el "precio individual" con el
// que se compara el ahorro es la suma de UNA sesión de cada servicio POR su
// cantidad de sesiones (antes se ignoraba la cantidad y el programa parecía
// carísimo). Puro y testeable; el precio efectivo por servicio (fijo o suma de
// zonas) lo calcula quien llama.

export type ComboPriceLine = { priceCents: number; sessions: number }

/** Σ precio_de_una_sesión × sesiones, sobre todos los servicios del programa. */
export function comboIndividualCents(lines: ComboPriceLine[]): number {
  return lines.reduce((a, l) => a + l.priceCents * l.sessions, 0)
}

/** Ahorro vs el precio individual (positivo = ahorra; negativo = más caro). */
export function comboSavingsCents(individualCents: number, totalCents: number): number {
  return individualCents - totalCents
}

/** Total de sesiones del programa (Σ sesiones de cada servicio). */
export function comboTotalSessions(lines: { sessions: number }[]): number {
  return lines.reduce((a, l) => a + l.sessions, 0)
}
