import { allowedStaffFor, type StaffServiceMap } from "./staff-services"

/** Una "pata" ocupada: UN servicio de UN turno, con SU profesional y SU ventana. */
export type BusyLeg = {
  /** null = el turno se reservó en "auto" y nunca se resolvió a nadie. */
  staffId: string | null
  serviceId: string
  startMs: number
  endMs: number
}

/**
 * Quiénes de `candidates` pueden realmente tomar esta ventana.
 *
 * `candidates` ya viene filtrado: son las que hacen el servicio pedido, están
 * activas, trabajan a esa hora y no tienen un turno PROPIO encima.
 *
 * El problema son las patas ANÓNIMAS (sin profesional asignada): ocupan a
 * alguien, pero no sabemos a quién. Sí sabemos DE QUÉ SERVICIO son, así que
 * sabemos a quiénes PODRÍA estar ocupando:
 *   - si ese servicio lo hace UNA sola profesional, la pata es de ella: se la
 *     descuenta con nombre y apellido;
 *   - si lo hacen varias, se cuenta como "una candidata menos" sólo si alguna
 *     de ellas está entre nuestras candidatas (una pata anónima de un servicio
 *     que ninguna de nuestras candidatas hace NO nos afecta).
 *
 * Devuelve las candidatas asignables. Vacío = el horario no se puede ofrecer.
 */
export function assignableStaff(
  candidates: string[],
  overlappingLegs: BusyLeg[],
  allowedByService: StaffServiceMap,
  activePros: string[]
): string[] {
  const anon = overlappingLegs.filter((l) => !l.staffId)

  // A quiénes podría estar ocupando cada pata anónima.
  const possible = anon.map((l) =>
    allowedStaffFor(l.serviceId, allowedByService).filter((p) => activePros.includes(p))
  )

  // Si sólo una profesional puede hacer ese servicio, la pata es de ella: seguro ocupada.
  const definitelyBusy = new Set(
    possible.filter((p) => p.length === 1).map((p) => p[0])
  )

  const free = candidates.filter((p) => !definitelyBusy.has(p))

  // Las patas anónimas ambiguas que podrían llevarse a alguna de las que quedan libres.
  const pressure = possible.filter(
    (p) => p.length > 1 && p.some((id) => free.includes(id))
  ).length

  return free.length > pressure ? free : []
}
