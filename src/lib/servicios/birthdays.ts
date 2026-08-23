// Cumpleaños de clientas: qué se festeja HOY y qué se festeja este MES,
// a partir del `date_of_birth` ("YYYY-MM-DD") y de la fecha argentina del
// momento ("YYYY-MM-DD", la misma que da `arPartsFromUtc().dateStr`).
// Puro y compartido por el panel del admin y el cron del aviso diario.

export type ClientaConCumple = {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  date_of_birth: string
}

export type CumpleDelMes = ClientaConCumple & {
  // Día del mes en que se festeja ESTE año (un 29/02 en año no bisiesto se
  // festeja el 28/02).
  day: number
  esHoy: boolean
  // La edad que cumple. null si el año de nacimiento es claramente de
  // relleno (algunas fichas viejas no tienen el año real).
  age: number | null
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// "MM-DD" en que se festeja el cumpleaños en `year`: el nacimiento tal cual,
// salvo el 29/02 en años no bisiestos, que pasa al 28/02 (si no, esas
// clientas no tendrían cumpleaños 3 de cada 4 años).
export function diaFestejado(dobIso: string, year: number): string {
  const mmdd = dobIso.slice(5, 10)
  if (mmdd === "02-29" && !isLeap(year)) return "02-28"
  return mmdd
}

export function esCumpleHoy(dobIso: string, todayIso: string): boolean {
  const year = Number(todayIso.slice(0, 4))
  return diaFestejado(dobIso, year) === todayIso.slice(5, 10)
}

function edad(dobIso: string, year: number): number | null {
  const birthYear = Number(dobIso.slice(0, 4))
  const age = year - birthYear
  // Un año de relleno (1900) o un tipeo imposible no es una edad para mostrar.
  if (age <= 0 || age >= 110) return null
  return age
}

/**
 * Las clientas que cumplen años en el mes de `todayIso`, ordenadas por día
 * (y por nombre dentro del mismo día), con el día festejado y su edad.
 */
export function cumplesDelMes(
  clientas: ClientaConCumple[],
  todayIso: string
): CumpleDelMes[] {
  const year = Number(todayIso.slice(0, 4))
  const month = todayIso.slice(5, 7)
  const today = todayIso.slice(5, 10)
  return clientas
    .filter((c) => diaFestejado(c.date_of_birth, year).slice(0, 2) === month)
    .map((c) => {
      const festejo = diaFestejado(c.date_of_birth, year)
      return {
        ...c,
        day: Number(festejo.slice(3, 5)),
        esHoy: festejo === today,
        age: edad(c.date_of_birth, year),
      }
    })
    .sort((a, b) => a.day - b.day || a.first_name.localeCompare(b.first_name))
}

/** Las que cumplen HOY (para el aviso diario por mail). */
export function cumplesDeHoy(
  clientas: ClientaConCumple[],
  todayIso: string
): CumpleDelMes[] {
  return cumplesDelMes(clientas, todayIso).filter((c) => c.esHoy)
}
