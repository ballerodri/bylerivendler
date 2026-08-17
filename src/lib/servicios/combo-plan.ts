// El PLAN DE SESIONES de un combo: qué tratamientos se hacen en cada sesión
// (visita) y en qué orden. `plan[s][i]` = el serviceId que va en la posición
// `i` (orden del día) de la sesión `s+1`. Puro: lo usan el formulario de
// armado, createCombo/updateCombo (validación server) y el catálogo.

export type ComboPlan = string[][]

// ── Leer un combo GUARDADO (filas de combo_services / combo_purchase_services)
// Estas tres cosas TIENEN que dar igual en el catálogo, en el motor de reserva
// y en el asistente del admin: si divergen, la pantalla ofrece una cosa y el
// servidor reserva otra. Por eso viven acá, en un solo lugar con tests.

/** Una fila guardada del combo: su sesión (null = combo del modelo viejo) y su orden. */
export type ComboRowLike = { session_no: number | null; order_index: number }

/** Orden del plan: (sesión, orden del día). Las filas legacy van al final. */
export function sortComboRows<T extends ComboRowLike>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((a, b) => (a.session_no ?? 999) - (b.session_no ?? 999) || a.order_index - b.order_index)
}

/** ¿El combo tiene PLAN de sesiones? (alguna fila con `session_no`) */
export function hasSessionPlan(rows: ComboRowLike[]): boolean {
  return rows.some((r) => r.session_no !== null)
}

/**
 * Los índices (sobre las filas YA ordenadas con `sortComboRows`) que forman la
 * 1ª sesión: con plan, todas las de `session_no === 1`; sin plan (legacy), la
 * primera fila sola — el modelo viejo agendaba un tratamiento por vez.
 */
export function firstSessionIndexes(sorted: ComboRowLike[]): number[] {
  if (!sorted.length) return []
  if (!hasSessionPlan(sorted)) return [0]
  return sorted.map((r, i) => (r.session_no === 1 ? i : -1)).filter((i) => i !== -1)
}

/**
 * Cuántas SESIONES (visitas) tiene el combo: con plan, la cantidad de sesiones
 * del plan; legacy, la suma de las cantidades por tratamiento (modelo viejo).
 */
export function comboVisitCount(rows: (ComboRowLike & { sessions?: number | null })[]): number {
  if (!rows.length) return 0
  if (!hasSessionPlan(rows)) return rows.reduce((a, r) => a + (r.sessions ?? 1), 0)
  return Math.max(0, ...rows.map((r) => r.session_no ?? 0))
}

/** Veces TOTALES de cada tratamiento en el plan (para el precio individual). */
export function planServiceCounts(plan: ComboPlan): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const session of plan) {
    for (const id of session) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/** Cada tratamiento una sola vez, en orden de aparición en el plan. */
export function planDistinctServices(plan: ComboPlan): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const session of plan) {
    for (const id of session) {
      if (!seen.has(id)) { seen.add(id); out.push(id) }
    }
  }
  return out
}

/**
 * Valida el armado de un combo con plan de sesiones. `null` = válido; si no,
 * el mensaje para la usuaria. Reglas: nombre, precio > 0, al menos 1 sesión,
 * cada sesión con al menos 1 tratamiento y sin repetir el MISMO tratamiento
 * dentro de la sesión, y al menos 2 tratamientos distintos en el plan (un
 * combo de un solo tratamiento es un pack).
 */
export function validateComboPlan(input: {
  name: string
  totalPriceCents: number
  sessions: ComboPlan
}): string | null {
  if (!input.name?.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.totalPriceCents) || input.totalPriceCents <= 0)
    return "Ingresá el precio del combo."
  if (input.sessions.length < 1) return "Armá al menos una sesión."
  for (let s = 0; s < input.sessions.length; s++) {
    const session = input.sessions[s]
    if (session.length < 1) return `La sesión ${s + 1} no tiene tratamientos.`
    const inSession = new Set<string>()
    for (const id of session) {
      if (inSession.has(id)) return `La sesión ${s + 1} tiene el mismo tratamiento dos veces.`
      inSession.add(id)
    }
  }
  if (planDistinctServices(input.sessions).length < 2)
    return "El combo tiene que tener al menos 2 tratamientos distintos (si no, es un pack)."
  return null
}
