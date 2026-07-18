/**
 * El PASO de la grilla de horarios: cada cuánto se ofrecen los turnos.
 *
 * No se guarda en ningún lado como ajuste: se DEDUCE de los horarios guardados
 * (`business_hours.slots`), que siempre fueron la única verdad de la grilla.
 * Así el ajuste no puede decir una cosa y los datos otra.
 *
 * PURO: sin base ni fecha real, para poder testearlo y usarlo igual en el
 * editor de horarios, en el motor de reservas y en la conversión de las horas
 * bloqueadas del personal.
 */

/** Paso por defecto cuando no se puede deducir (0 o 1 horario). */
export const DEFAULT_STEP_MIN = 60

/**
 * Devuelve la MÍNIMA diferencia positiva entre horarios consecutivos, en
 * minutos. La mínima y no el promedio: la pausa del mediodía deja un salto
 * grande (13:00 → 15:00) que NO es el paso de la grilla.
 *
 * Con menos de 2 horarios distintos no hay nada que deducir → 60.
 */
export function gridStepMin(slots: string[]): number {
  const mins = [...new Set(slots)]
    .map((s) => {
      const [h, m] = s.split(":").map(Number)
      return h * 60 + m
    })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)

  let step = Infinity
  for (let i = 1; i < mins.length; i++) {
    const d = mins[i] - mins[i - 1]
    if (d > 0 && d < step) step = d
  }
  return Number.isFinite(step) ? step : DEFAULT_STEP_MIN
}

/** Igual que `gridStepMin` pero sobre horarios ya en minutos del día. */
export function gridStepMinFromMinutes(slotsMin: number[]): number {
  const mins = [...new Set(slotsMin)].sort((a, b) => a - b)
  let step = Infinity
  for (let i = 1; i < mins.length; i++) {
    const d = mins[i] - mins[i - 1]
    if (d > 0 && d < step) step = d
  }
  return Number.isFinite(step) ? step : DEFAULT_STEP_MIN
}
