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

/**
 * FASE 2 — igual que `placeOnGrid` pero CONSCIENTE de la profesional: dos
 * turnos SEGUIDOS de la MISMA profesional que ENTRAN en 1 hora (dentro del
 * mismo slot de grilla) **comparten el bloque** (el 2º arranca pegado, en
 * mitad de la hora); si son de OTRA profesional (o no entran), el turno
 * arranca en el siguiente slot de la grilla (hora en punto).
 *
 * Cada ítem trae su `staffId` YA RESUELTO (id concreto — no "auto"). PURO: la
 * disponibilidad NO entra acá (se chequea aparte). Determinístico dado el
 * staff → buscador, creación y pantalla lo reproducen idéntico (regla de oro).
 *
 * Propiedad clave: con TODOS los `staffId` distintos NUNCA funde → devuelve
 * exactamente lo mismo que `placeOnGrid(durations, …)`. La Fase 1 es el caso
 * "sin fusión".
 *
 * "Entra en la hora" = el ítem termina antes del PRIMER slot de grilla
 * posterior al arranque del bloque (`blockEnd + dur ≤ nextGridSlot(blockStart)`).
 * `null` si la cadena se pasa del final del día.
 */
export function placeOnGridMerged(
  items: { durationMin: number; staffId: string }[],
  gridSlots: number[],
  startSlot: number
): number[] | null {
  const starts: number[] = []
  let blockStart = startSlot
  let blockStaff = ""
  let blockEnd = startSlot
  for (let i = 0; i < items.length; i++) {
    const { durationMin, staffId } = items[i]
    if (i === 0) {
      blockStart = startSlot
      blockStaff = staffId
      blockEnd = startSlot + durationMin
      starts.push(startSlot)
      continue
    }
    // ¿Cabe en el bloque actual? Misma profesional Y termina antes del
    // siguiente slot de grilla (el borde de la hora del bloque).
    const nextGrid = gridSlots.find((g) => g > blockStart)
    const fits = nextGrid !== undefined && blockEnd + durationMin <= nextGrid
    if (staffId === blockStaff && fits) {
      starts.push(blockEnd)
      blockEnd += durationMin
    } else {
      const ns = gridSlots.find((g) => g >= blockEnd)
      if (ns === undefined) return null
      blockStart = ns
      blockStaff = staffId
      blockEnd = ns + durationMin
      starts.push(ns)
    }
  }
  return starts
}
