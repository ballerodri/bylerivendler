/**
 * Qué color lleva el evento de Google Calendar de un turno.
 *
 * Manda el color del SERVICIO; si ese servicio no tiene uno propio, cae al de la
 * profesional; si tampoco hay, el evento queda con el color por defecto del
 * calendario (no se manda `colorId`).
 *
 * PURO, y la MISMA regla la usan los cinco lugares que crean o actualizan
 * eventos (reserva online, turno cargado por el salón, reprogramado del admin,
 * reprogramado del portal, y el helper de packs/combos). Si divergieran, un
 * turno cambiaría de color con sólo reprogramarlo.
 */
export function pickCalendarColorId(
  serviceColorId: string | null | undefined,
  staffColorId: string | null | undefined
): string | null {
  // `||` a propósito: un color vacío ("") es tan "sin color" como null.
  return serviceColorId || staffColorId || null
}

/**
 * De qué tratamiento sale el color cuando la visita tiene VARIOS encadenados
 * (servicios "juntos", una sesión de combo): del PRIMERO de la visita, porque
 * el evento de Calendar es uno solo. Empate de horario → el orden de la lista.
 * Ignora las patas sin servicio (un servicio borrado).
 */
export function firstServiceIdOfVisit(
  legs: { serviceId: string | null; startsAtMs: number }[]
): string | null {
  let best: { serviceId: string | null; startsAtMs: number } | null = null
  for (const leg of legs) {
    if (!leg.serviceId) continue
    if (!best || leg.startsAtMs < best.startsAtMs) best = leg
  }
  return best?.serviceId ?? null
}
