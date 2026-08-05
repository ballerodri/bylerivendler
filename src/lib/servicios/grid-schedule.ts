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

import { gridStepMinFromMinutes } from "./grid-step"

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
  // Cierre del día = último slot + el paso de la grilla (18:30 + 30 = 19:00).
  // NINGÚN turno puede TERMINAR pasado el cierre.
  const dayEnd =
    gridSlots.length > 0
      ? gridSlots[gridSlots.length - 1] + gridStepMinFromMinutes(gridSlots)
      : Infinity
  const starts: number[] = []
  let cursor = startSlot
  for (let i = 0; i < durations.length; i++) {
    const start = i === 0 ? startSlot : gridSlots.find((g) => g >= cursor)
    if (start === undefined) return null
    if (start + durations[i] > dayEnd) return null // termina pasado el cierre
    starts.push(start)
    cursor = start + durations[i]
  }
  return starts
}

/**
 * FASE 3 — igual que `placeOnGrid` pero CONSCIENTE de la profesional: un turno
 * de la MISMA profesional que el anterior arranca **PEGADO** (en el fin del
 * anterior, aunque sea mitad de hora y cruce la hora en punto: 10:30, 11:20…);
 * uno de OTRA profesional arranca en el **siguiente slot de la grilla** (hora
 * en punto). Regla de la usuaria: cada profesional atiende de corrido, y los
 * cambios de profesional caen en punto. (La Fase 2 limitaba el pegado a
 * "entran juntos en 1 hora" — ese tope ya no existe.)
 *
 * Cada ítem trae su `staffId` YA RESUELTO (id concreto — no "auto"). PURO: la
 * disponibilidad NO entra acá (se chequea aparte). Determinístico dado el
 * staff → buscador, creación y pantalla lo reproducen idéntico (regla de oro).
 *
 * Propiedades (testeadas):
 * - Con TODOS los `staffId` distintos NUNCA pega → devuelve exactamente lo
 *   mismo que `placeOnGrid(durations, …)` (la Fase 1 es el caso sin fusión).
 * - Anclada-sin-memoria: cada paso depende sólo del fin y la profesional del
 *   anterior → colocar `[pack, ...sueltos]` desde T da, para los sueltos, lo
 *   mismo que colocar `[...sueltos]` desde el inicio del 1er suelto.
 *
 * `null` si la cadena se pasa del final del día.
 */
export function placeOnGridMerged(
  items: { durationMin: number; staffId: string }[],
  gridSlots: number[],
  startSlot: number
): number[] | null {
  // Cierre del día = último slot de la grilla + su paso (18:30 + 30 = 19:00).
  // Regla de la usuaria: TODO turno (solo o encadenado) tiene que TERMINAR
  // dentro del horario. Antes se chequeaba sólo el ARRANQUE del pegado, así que
  // un turno largo en el último slot, o el último de una cadena, podía terminar
  // pasado el cierre (ej. arranca 18:30, dura 75 → 19:45). Ahora se acota el
  // FIN de cada tramo, uniforme para todos (mismo criterio en el buscador).
  const dayEnd =
    gridSlots.length > 0
      ? gridSlots[gridSlots.length - 1] + gridStepMinFromMinutes(gridSlots)
      : Infinity
  const starts: number[] = []
  let prevStaff = ""
  let prevEnd = startSlot
  for (let i = 0; i < items.length; i++) {
    const { durationMin, staffId } = items[i]
    let start: number
    if (i === 0) {
      start = startSlot
    } else if (staffId === prevStaff) {
      start = prevEnd // misma profesional → pegado, aunque cruce la hora
    } else {
      const ns = gridSlots.find((g) => g >= prevEnd)
      if (ns === undefined) return null
      start = ns // otra profesional → hora en punto
    }
    if (start + durationMin > dayEnd) return null // termina pasado el cierre
    starts.push(start)
    prevStaff = staffId
    prevEnd = start + durationMin
  }
  return starts
}
