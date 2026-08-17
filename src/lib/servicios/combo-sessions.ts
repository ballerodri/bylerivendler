// Estado de las sesiones de un PROGRAMA (combo multi-sesión) comprado, POR
// servicio. Igual que un pack trackea sessions_used/total, pero un programa
// tiene varios servicios, cada uno con su cantidad. Las "usadas" son los turnos
// VIVOS (no cancelados/no_show) de esa compra y ese servicio; las restantes son
// las que todavía se pueden agendar. Puro y testeable: quien llama cuenta los
// turnos vivos por servicio y pasa el mapa.

export type ProgramService = { serviceId: string; serviceName: string; sessionsTotal: number }

export type ProgramSessionState = {
  serviceId: string
  serviceName: string
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
}

/**
 * Estado por servicio: usadas (turnos vivos ya agendados) y restantes. Las
 * usadas se topean al total (por si un dato viejo tuviera de más, nunca da
 * restantes negativas).
 */
export function programSessionStates(
  services: ProgramService[],
  usedByService: Record<string, number>
): ProgramSessionState[] {
  return services.map((s) => {
    const used = Math.min(usedByService[s.serviceId] ?? 0, s.sessionsTotal)
    return {
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      sessionsTotal: s.sessionsTotal,
      sessionsUsed: used,
      sessionsRemaining: s.sessionsTotal - used,
    }
  })
}

/** ¿Ya se agendaron TODAS las sesiones del programa? (nada por agendar) */
export function programAllScheduled(states: ProgramSessionState[]): boolean {
  return states.every((s) => s.sessionsRemaining <= 0)
}

/** Total de sesiones del programa que todavía quedan por agendar. */
export function programRemainingTotal(states: ProgramSessionState[]): number {
  return states.reduce((a, s) => a + Math.max(0, s.sessionsRemaining), 0)
}

/** Los servicios que todavía tienen alguna sesión por agendar. */
export function programSchedulableServices(states: ProgramSessionState[]): ProgramSessionState[] {
  return states.filter((s) => s.sessionsRemaining > 0)
}
