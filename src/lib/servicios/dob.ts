// Normaliza una fecha de nacimiento a "YYYY-MM-DD" (lo que espera una columna
// DATE de Postgres) o null si viene vacía / inválida. Acepta lo que tipea la
// gente ("12/5/1990") y lo que manda un <input type="date"> ("1990-05-12").
// Pura y compartida por la reserva (web y admin) y la carga manual de clientas.
export function parseDob(raw: string): string | null {
  const cleaned = (raw ?? "").replace(/\s/g, "")
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10)
  return null
}
