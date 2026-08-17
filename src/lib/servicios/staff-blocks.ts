/**
 * ¿Una hora de servicio pisa alguna casilla bloqueada del personal?
 *
 * Una casilla bloqueada (`staff_blocked_slots` semanal o `staff_date_exceptions`
 * por fecha) guarda sólo el arranque ("14:00"); su duración es el paso de la
 * grilla de ese día (`stepMin`). El servicio ocupa `[startMin, endMin)`. Pisa
 * la casilla si se superponen. PEGADO (el servicio termina justo cuando arranca
 * la casilla, o al revés) NO pisa — igual criterio que el resto del motor.
 *
 * PURO para poder testearlo una vez y usarlo en los dos orígenes (semanal + fecha).
 */
export function slotHitsBlocked(
  startMin: number,
  endMin: number,
  blockedStartMins: number[],
  stepMin: number
): boolean {
  for (const b0 of blockedStartMins) {
    const b1 = b0 + stepMin
    if (startMin < b1 && endMin > b0) return true
  }
  return false
}
