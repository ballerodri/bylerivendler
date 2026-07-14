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

  // Profesionales que YA están ocupadas CON NOMBRE en esta misma ventana (por
  // cualquier otra pata). Una pata anónima nunca puede resultar ser una de
  // ellas: ya sabemos que están ocupadas por otro motivo, así que no pueden
  // ser además la dueña de la pata anónima. Esto sólo ACHICA `possible`
  // (nunca lo agranda): si un conjunto queda vacío es porque TODAS sus
  // integrantes ya estaban ocupadas con nombre, y ninguna de ellas era
  // asignable de todos modos — sigue siendo seguro (nunca ofrece de más).
  // Sin esto, una pata anónima con dos posibles dueñas donde UNA ya está
  // ocupada con nombre se seguía contando como "ambigua" (2 candidatas) en
  // vez de "seguro de la otra", y la otra podía quedar doble-reservada.
  const busyNamed = new Set(
    overlappingLegs.filter((l) => l.staffId).map((l) => l.staffId as string)
  )

  // A quiénes podría estar ocupando cada pata anónima.
  const possible = anon.map((l) =>
    allowedStaffFor(l.serviceId, allowedByService).filter(
      (p) => activePros.includes(p) && !busyNamed.has(p)
    )
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

// ─── buildBusyLegs ────────────────────────────────────────────────────────
// Movido desde src/app/reserva/actions.ts: es puro (sin DB) y es la pieza que
// arma las `BusyLeg[]` que consume `assignableStaff` de arriba, así que vive
// (y se testea) en el mismo módulo puro.

// Fila de `appointment_services` embebida en un turno.
export type ApptServiceLegRow = {
  service_id: string
  staff_id: string | null
  starts_at: string | null
  duration_min: number | null
}

// Turno crudo tal como lo devuelve Supabase con `appointment_services(...)` embebido.
export type ApptRow = {
  id: string
  starts_at: string
  duration_min: number
  staff_id: string | null
  appointment_services: ApptServiceLegRow[] | null
}

/**
 * Convierte turnos crudos en patas ocupadas (`BusyLeg[]`): UNA por CADA
 * servicio del turno, con SU PROPIA profesional, inicio y duración — no la
 * del turno "portador" (que en una cadena "juntos" sólo guarda la de la
 * PRIMERA profesional y la duración SUMADA de todos los servicios).
 *
 * Si un turno no tiene NINGUNA fila en `appointment_services` (no debería
 * pasar, pero un turno invisible es un doble-booking), se emite UNA pata con
 * el turno entero y `serviceId: ""` (servicio desconocido ⇒ `allowedStaffFor`
 * da `[]` ⇒ `possible` queda vacío ⇒ sólo bloquea si coincide el nombre —
 * la lectura segura).
 *
 * `appointment_services.starts_at` es nullable (columna agregada por una
 * migración posterior). Si a ALGUNA pata de un turno le falta `starts_at`, no
 * se puede confiar en re-escalonar cada pata por separado: colapsarían todas
 * sobre el inicio del turno y la COLA de la cadena (los últimos servicios)
 * quedaría libre por error — el mismo agujero que el bug de "reagendar desde
 * el portal". En ese caso se emite CADA pata de ese turno cubriendo la
 * VENTANA COMPLETA del turno (conservador: nunca angosta menos de lo real),
 * conservando el `serviceId`/`staffId` propio de cada una para poder seguir
 * resolviendo patas anónimas por servicio.
 */
export function buildBusyLegs(rows: ApptRow[]): BusyLeg[] {
  const legs: BusyLeg[] = []
  for (const r of rows) {
    const svcRows = r.appointment_services ?? []
    if (!svcRows.length) {
      const startMs = new Date(r.starts_at).getTime()
      legs.push({
        staffId: r.staff_id,
        serviceId: "",
        startMs,
        endMs: startMs + r.duration_min * 60_000,
      })
      continue
    }
    const missingStartsAt = svcRows.some((s) => !s.starts_at)
    const apptStartMs = new Date(r.starts_at).getTime()
    const apptEndMs = apptStartMs + r.duration_min * 60_000
    for (const s of svcRows) {
      if (missingStartsAt) {
        legs.push({
          staffId: s.staff_id ?? r.staff_id,
          serviceId: s.service_id,
          startMs: apptStartMs,
          endMs: apptEndMs,
        })
        continue
      }
      const startMs = new Date(s.starts_at as string).getTime()
      const durationMin = s.duration_min ?? r.duration_min
      legs.push({
        staffId: s.staff_id ?? r.staff_id,
        serviceId: s.service_id,
        startMs,
        endMs: startMs + durationMin * 60_000,
      })
    }
  }
  return legs
}
