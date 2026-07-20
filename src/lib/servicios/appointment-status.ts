// Un turno CONFIRMADO empieza "solo" cuando llega su hora: se muestra y se
// opera como "en curso" sin que nadie apriete "Iniciar" y SIN tocar la base
// —el estado guardado sigue siendo "confirmed" hasta que se complete o se
// marque no vino—. Así el salón deja de olvidarse de iniciar los turnos, y
// facturación / estadísticas / mails siguen leyendo el estado real de siempre.
//
// La comparación es por instante absoluto (todo en UTC), así que no depende de
// la zona horaria: `starts_at` es un timestamp UTC y `nowMs` es Date.now().

/** ¿Este turno confirmado ya llegó a su horario? (confirmado + hora pasada) */
export function haComenzado(status: string, startsAt: string, nowMs: number): boolean {
  return status === "confirmed" && new Date(startsAt).getTime() <= nowMs
}

/**
 * El estado a MOSTRAR/OPERAR. Un confirmado cuya hora ya pasó se ve como
 * "en curso"; cualquier otro estado queda igual (un `in_progress` real, un
 * `completed`, etc. no se tocan).
 */
export function estadoEfectivo(status: string, startsAt: string, nowMs: number): string {
  return haComenzado(status, startsAt, nowMs) ? "in_progress" : status
}
