/**
 * Quién hace qué: la regla de `staff_services`. Lógica PURA (sin servidor) para
 * poder testearla y usar la MISMA regla en la pantalla, en el buscador de
 * horarios y en el servidor.
 *
 * Regla estricta (decisión del salón): un servicio SIN ninguna profesional
 * asignada **no se puede reservar** online. Fail-closed: ante la duda, no.
 * (En el admin la regla no se aplica: el salón tiene que poder cargar a mano un
 * servicio todavía sin asignar.)
 */

/** serviceId → ids de las profesionales que hacen ese servicio. */
export type StaffServiceMap = Record<string, string[]>

/** Las profesionales que pueden hacer este servicio. Vacío = nadie. */
export function allowedStaffFor(serviceId: string, map: StaffServiceMap): string[] {
  return map[serviceId] ?? []
}

/** ¿Se puede reservar? Sólo si hay al menos una profesional que lo haga. */
export function serviceIsBookable(serviceId: string, map: StaffServiceMap): boolean {
  return allowedStaffFor(serviceId, map).length > 0
}

/**
 * ¿Esta profesional hace este servicio? `"auto"` NO es una profesional: quien
 * quiera resolver el "auto" tiene que elegir de `allowedStaffFor`.
 */
export function canStaffDoService(
  staffId: string,
  serviceId: string,
  map: StaffServiceMap
): boolean {
  return allowedStaffFor(serviceId, map).includes(staffId)
}

/** De estos servicios, cuáles NO se pueden reservar (para avisarle al salón). */
export function unbookableServiceIds(serviceIds: string[], map: StaffServiceMap): string[] {
  return serviceIds.filter((id) => !serviceIsBookable(id, map))
}
