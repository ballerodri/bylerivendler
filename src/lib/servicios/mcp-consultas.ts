import { arPartsFromUtc } from "./pack-sessions"
import { hmToMinutes } from "./grid-schedule"
import { gridStepMin } from "./grid-step"

/**
 * Las cuentas y los formatos de las consultas del asistente del salón (el
 * servidor MCP). Están acá, sin tocar la base ni Next, para poder probarlas:
 * una fecha mal interpretada le haría contestar con seguridad una agenda
 * equivocada.
 */

const AR_OFFSET_H = 3 // Argentina = UTC-3 (fijo, sin horario de verano)

/** Hoy en Argentina, "YYYY-MM-DD". */
export function hoyAR(now: Date = new Date()): string {
  return arPartsFromUtc(now).dateStr
}

/** "YYYY-MM-DD" → el instante en que arranca y en que termina ese día en Argentina. */
export function rangoDelDiaAR(dateStr: string): { desde: string; hasta: string } {
  const [y, m, d] = dateStr.split("-").map(Number)
  const start = Date.UTC(y, m - 1, d, AR_OFFSET_H, 0, 0)
  return { desde: new Date(start).toISOString(), hasta: new Date(start + 24 * 3_600_000).toISOString() }
}

/**
 * Valida "YYYY-MM-DD", que sea una fecha REAL (no "2026-02-30") y que esté en
 * un rango sensato. Un año como 9999 genera un ISO de año extendido que la base
 * no entiende y termina en un error feo.
 */
export function esFechaValida(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  if (y < 2000 || y > 2100) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Resta días a una fecha "YYYY-MM-DD" (en hora argentina). */
export function restarDias(dateStr: string, dias: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d, AR_OFFSET_H, 0, 0) - dias * 24 * 3_600_000
  return arPartsFromUtc(new Date(ms)).dateStr
}

/** Cuántos días hay entre dos fechas "YYYY-MM-DD" (para acotar consultas). */
export function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number)
  const [y2, m2, d2] = hasta.split("-").map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

export const fmtPesos = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("es-AR")
export const horaAR = (iso: string) => arPartsFromUtc(new Date(iso)).timeStr
export const fechaAR = (iso: string) => arPartsFromUtc(new Date(iso)).dateStr

/** "miércoles, 28 de octubre de 2026" — con año, para que no quede ambiguo. */
export function fechaLegible(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * Saca los comodines de LIKE del texto que escribe el asistente. La búsqueda ya
 * es "contiene", así que un comodín no suma nada y sí permitiría listar la
 * agenda entera de a pedazos: `%` solo trae TODO. El `_` se cambia por un
 * espacio (suele venir en lugar de uno) y el resto se borra, así "ma%ria"
 * encuentra a Maria. Los paréntesis y las comas se dejan: en un filtro de un
 * solo campo son letras comunes, y un tratamiento se puede llamar
 * "Vela Slim (Premium)".
 */
export function limpiarTexto(texto: string): string {
  return texto.replace(/_/g, " ").replace(/[%*\\]/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Lo mismo, pero para el texto que va dentro de un filtro `or(...)`, donde la
 * coma y los paréntesis SÍ son sintaxis (separan condiciones): ahí también hay
 * que sacarlos para que el texto no pueda cambiar lo que pregunta la consulta.
 */
export function limpiarFiltro(texto: string): string {
  return limpiarTexto(texto).replace(/[(),]/g, " ").replace(/\s+/g, " ").trim()
}

/** El minuto del día (hora argentina) en que estamos: 14:30 → 870. */
export function minutosAhoraAR(now: Date = new Date()): number {
  return hmToMinutes(arPartsFromUtc(now).timeStr)
}

/**
 * El minuto en que cierra el día, igual que lo calcula la reserva online: el
 * último horario de la grilla más un paso. Si la grilla viniera rota devuelve
 * Infinity (no recorta nada), porque la web tampoco recorta: contestar "no hay
 * lugar" por un dato roto sería el peor error.
 */
export function cierreDelDia(slots: string[]): number {
  if (!slots.length) return Number.POSITIVE_INFINITY
  const crudo = Math.max(...slots.map(hmToMinutes)) + gridStepMin(slots)
  return Number.isFinite(crudo) ? crudo : Number.POSITIVE_INFINITY
}

/**
 * Qué horarios se pueden ofrecer para un tratamiento, y cuáles de ellos la web
 * ya no vende.
 *
 * Son DOS reglas distintas a propósito:
 *  · lo que YA PASÓ no se ofrece nunca, y lo que se pasa del cierre tampoco;
 *  · lo que entra en el margen de antelación de la web (2 h) SÍ se ofrece,
 *    aparte: la web no lo vende, pero el salón carga ese turno a mano. Decirle
 *    "no hay lugar" a las 15:00 con la tarde libre, sólo porque la web no lo
 *    vendería, es el peor error que puede cometer el asistente.
 *
 * Todo en minutos del día; `ahoraMin` en null significa "no es hoy" (no se
 * filtra por hora).
 */
export function horariosOfrecibles(args: {
  slots: string[]
  duracionMin: number
  cierreMin: number
  ahoraMin: number | null
  margenMin: number
}): { candidatos: string[]; soloPanel: string[] } {
  const { slots, duracionMin, cierreMin, ahoraMin, margenMin } = args
  const entranEnElDia = slots.filter((s) => hmToMinutes(s) + duracionMin <= cierreMin)
  if (ahoraMin === null) return { candidatos: entranEnElDia, soloPanel: [] }
  const noPasados = entranEnElDia.filter((s) => hmToMinutes(s) >= ahoraMin)
  return {
    candidatos: noPasados,
    soloPanel: noPasados.filter((s) => hmToMinutes(s) < ahoraMin + margenMin),
  }
}
