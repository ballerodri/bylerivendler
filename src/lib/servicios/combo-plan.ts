// El PLAN DE SESIONES de un combo: qué tratamientos se hacen en cada sesión
// (visita) y en qué orden. `plan[s][i]` = el serviceId que va en la posición
// `i` (orden del día) de la sesión `s+1`. Puro: lo usan el formulario de
// armado, createCombo/updateCombo (validación server) y el catálogo.

export type ComboPlan = string[][]

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
