/**
 * Horarios de una visita "juntos" de la reserva, como texto "HH:MM". PURO
 * (sin fecha real ni zona horaria): trabaja en minutos de reloj de pared
 * desde un arranque "HH:MM", exactamente como el resumen de confirmación lo
 * hacía inline. Se extrae acá para (1) tener UNA sola fuente del cálculo que
 * la pantalla de fecha, el resumen y el servidor tienen que mostrar igual, y
 * (2) poder testearlo: el bug que corrige esto era mostrar los servicios
 * encadenados en el arranque de la visita (T) en vez de después de la 1ª
 * sesión del pack (T + D_pack).
 */

const toMinutes = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number)
  return h * 60 + m
}

const fmtHM = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`

/**
 * Suma `add` minutos a un horario "HH:MM". `add === 0` devuelve el mismo
 * horario tal cual (identidad byte a byte: el caso NO encadenado no puede
 * cambiar). No aplica módulo de 24h a propósito: si la cadena cruzara
 * medianoche devuelve "25:30", igual que el cálculo inline que reemplaza
 * (el salón no agenda cadenas que crucen el día; mantener la MISMA conducta).
 */
export function addMinutesHM(hm: string, add: number): string {
  return fmtHM(toMinutes(hm) + add)
}

/**
 * Dado el arranque "HH:MM" y las duraciones (min) de cada ítem EN ORDEN, el
 * horario de inicio de cada ítem: el primero arranca en `startHM`, cada
 * siguiente cuando termina el anterior (cadena sin huecos, igual que arma el
 * servidor). Devuelve un "HH:MM" por cada duración recibida.
 */
export function sequentialStartTimes(startHM: string, durations: number[]): string[] {
  let mins = toMinutes(startHM)
  return durations.map((d) => {
    const t = fmtHM(mins)
    mins += d
    return t
  })
}
