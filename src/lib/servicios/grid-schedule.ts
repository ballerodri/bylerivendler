/**
 * Colocación de los turnos de una visita "uno tras otro" en la GRILLA de
 * horarios. FASE 1: cada turno cae en su propio slot de la grilla (en hora en
 * punto), sin fusión de turnos cortos de la misma profesional (eso es fase 2).
 *
 * PURO: trabaja en minutos-del-día (sin fecha real ni zona horaria), para
 * poder testearlo y usar la MISMA regla en el buscador, la creación de la
 * reserva y la pantalla — la "regla de oro": lo que se ofrece == lo que se
 * reserva == lo que se muestra.
 */

/** "HH:MM" → minutos desde medianoche. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number)
  return h * 60 + m
}

/** Minutos desde medianoche → "HH:MM" (24h, con cero a la izquierda). */
export function minutesToHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`
}

/**
 * Dadas las duraciones (min) de los turnos EN ORDEN, la grilla del día
 * (`gridSlots`: slots de inicio en minutos, ASCENDENTE) y el slot de arranque
 * elegido (`startSlot`, uno de la grilla), devuelve el minuto de inicio de
 * cada turno:
 *  - el 1º arranca en `startSlot`;
 *  - cada siguiente arranca en el PRIMER slot de la grilla ≥ donde terminó el
 *    turno anterior (en hora en punto; queda un hueco si sobra tiempo en la
 *    hora anterior).
 *
 * Devuelve `null` si algún turno no encuentra slot (la cadena se pasa del
 * final del día). Con `durations` vacío devuelve `[]`.
 *
 * FASE 1: sin fusión. Dos turnos cortos de la misma profesional NO comparten
 * hora acá (cada uno toma su slot) — la fusión se agrega en la fase 2.
 */
export function placeOnGrid(
  durations: number[],
  gridSlots: number[],
  startSlot: number
): number[] | null {
  const starts: number[] = []
  let cursor = startSlot
  for (let i = 0; i < durations.length; i++) {
    const start = i === 0 ? startSlot : gridSlots.find((g) => g >= cursor)
    if (start === undefined) return null
    starts.push(start)
    cursor = start + durations[i]
  }
  return starts
}
