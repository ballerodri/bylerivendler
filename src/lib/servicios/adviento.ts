import { arPartsFromUtc } from "./pack-sessions"
import { whatsappLink } from "../whatsapp"

/**
 * El Calendario de Adviento: 24 casilleros cerrados, una sorpresa por persona.
 *
 * La regla que manda: el número que elige la persona es la PUERTA, no el
 * premio. La sorpresa se sortea, así que a dos personas que elijan el 7 les
 * puede tocar distinto — y por eso no sirve de nada que se cuenten entre ellas
 * qué les salió.
 *
 * Todo lo que se puede probar vive acá: el sorteo, el código, la ventana de
 * fechas y el teléfono. El sorteo ocurre en el SERVIDOR (ver
 * `src/app/adviento/actions.ts`): si se hiciera en el teléfono, recargar la
 * página sería volver a tirar hasta que salga el premio más caro.
 */

/** Esta edición. Queda guardado en cada jugada para poder repetirlo en 2027. */
export const CAMPANA = "adviento-2026"

/** Se elige del 1 al 24; el premio se canjea hasta el 31. Todo en diciembre. */
export const PRIMER_DIA = "2026-12-01"
export const ULTIMO_DIA_ELECCION = "2026-12-24"
export const ULTIMO_DIA_CANJE = "2026-12-31"

/** Cuántos casilleros tiene el calendario. */
export const CASILLEROS = 24

export type Premio = { id: number; texto: string }

/** Las 24 promociones, tal cual las escribió Leri. */
export const PREMIOS: readonly Premio[] = [
  { id: 1, texto: "Facial a $30.000." },
  { id: 2, texto: "Venite con una amiga nueva: pagan $30.000 cada una por su facial." },
  { id: 3, texto: "Reservá tu facial al precio habitual y llevate un kit de regalo." },
  { id: 4, texto: "Con tu facial, tenés una zona de presoterapia de regalo." },
  {
    id: 5,
    texto:
      "Recovery 2x1: venís con una amiga el mismo día y a la misma hora; las dos disfrutan presoterapia + cabina de ozono.",
  },
  {
    id: 6,
    texto:
      "Radiofrecuencia facial 2x1: dos personas, el mismo día y a la misma hora, por $55.000 entre las dos.",
  },
  { id: 7, texto: "Radiofrecuencia facial individual: 25% de descuento; queda en $41.250." },
  { id: 8, texto: "Vela Slim + electrodos, una zona: 15% de descuento." },
  { id: 9, texto: "Depi definitiva: 15% de descuento en un pack." },
  { id: 10, texto: "Limpieza de espalda + peeling: $40.000." },
  { id: 11, texto: "Oxígeno + radiofrecuencia: 25% de descuento." },
  {
    id: 12,
    texto: "Con un facial, tenés de regalo la aplicación de exosomas nacionales con Dermapen.",
  },
  { id: 13, texto: "HIFU facial o corporal: 20% de descuento." },
  { id: 14, texto: "Bronceado sin sol: 15% de descuento." },
  { id: 15, texto: "Masajes corporales: 15% de descuento." },
  { id: 16, texto: "Dermapen hidratante: $35.000." },
  { id: 17, texto: "Con tu facial, tenés de regalo una sesión de electrodos a elección." },
  { id: 18, texto: "Pack de dos faciales: 15% de descuento." },
  { id: 19, texto: "Vela Slim, una zona: 15% de descuento." },
  { id: 20, texto: "Pack corporal: 25% de descuento." },
  { id: 21, texto: "Una sesión de presoterapia: 20% de descuento." },
  { id: 22, texto: "Pack de electrodos: 15% de descuento." },
  { id: 23, texto: "Masaje + presoterapia: 30% de descuento en el combo." },
  { id: 24, texto: "Elegí una gift card y obtené 20% de descuento." },
] as const

export function premioPorId(id: number): Premio | null {
  return PREMIOS.find((p) => p.id === id) ?? null
}

export type EstadoCalendario =
  | "antes" // todavía no arrancó
  | "abierto" // se puede elegir
  | "solo-canje" // ya no se elige, pero el premio sigue valiendo
  | "terminado" // se acabó

/** En qué momento del calendario estamos, en hora argentina. */
export function estadoCalendario(ahora: Date = new Date()): EstadoCalendario {
  const hoy = arPartsFromUtc(ahora).dateStr
  if (hoy < PRIMER_DIA) return "antes"
  if (hoy <= ULTIMO_DIA_ELECCION) return "abierto"
  if (hoy <= ULTIMO_DIA_CANJE) return "solo-canje"
  return "terminado"
}

/** Sortea una sorpresa. Todas las promos tienen la misma chance. */
export function sortearPremio(azar: () => number = Math.random): Premio {
  const i = Math.floor(azar() * PREMIOS.length)
  // Math.random() nunca devuelve 1, pero si alguien pasa su propio azar no se
  // va a caer por un borde.
  return PREMIOS[Math.min(Math.max(i, 0), PREMIOS.length - 1)]
}

// Sin I, O, 0 ni 1: el código se dicta por teléfono y se lee de una captura.
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Un código corto para que la clienta lo muestre y Leri lo busque. */
export function generarCodigo(casillero: number, azar: () => number = Math.random): string {
  let cola = ""
  for (let i = 0; i < 4; i++) cola += LETRAS[Math.floor(azar() * LETRAS.length) % LETRAS.length]
  return "ADV-" + casillero + cola
}

export type TelefonoOk = { ok: true; clave: string; lindo: string }
export type TelefonoMal = { ok: false; motivo: string }

/**
 * El teléfono es la llave de "una sorpresa por persona", así que acá la cuenta
 * se hace bien y se exige un celular argentino completo.
 *
 * No se usa `normalizeArPhone` (la de las reservas): es a propósito permisiva y
 * se equivoca con dos formas que la gente escribe todo el tiempo — "011
 * 2345-6789" le borra la característica y "15 1234-5678" arma un número que no
 * existe. En una reserva eso se nota enseguida (hay alguien del otro lado); acá
 * el contacto se perdería en silencio, que es justo lo contrario de lo que
 * busca esta acción. Tampoco se la corrige: de ella dependen las reservas y los
 * mails de todo el sitio.
 */
export function telefonoParaAdviento(raw: string): TelefonoOk | TelefonoMal {
  const d = soloDigitos(raw)
  if (!d) return { ok: false, motivo: "Escribí tu celular." }
  // Ninguna característica argentina empieza con 15: eso es el viejo prefijo de
  // celular y, solo, no dice de qué ciudad es.
  if (d.length === 10 && d.startsWith("15"))
    return { ok: false, motivo: "Falta la característica: en vez del 15, poné 11 (o la de tu ciudad)." }
  if (d.length !== 10)
    return {
      ok: false,
      motivo: "Fijate el número: va la característica sin el 0 y el celular sin el 15 (son 10 dígitos).",
    }
  return { ok: true, clave: "+549" + d, lindo: telefonoLindo(d) }
}

/**
 * Los 10 dígitos de un celular argentino, o "" si no se puede. Es la cuenta que
 * convierte todas las formas de escribir el mismo número en una sola.
 */
function soloDigitos(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "")
  if (!d) return ""
  if (d.startsWith("00")) d = d.slice(2) // salió marcado como del exterior
  if (d.startsWith("54")) d = d.slice(2) // país
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1) // el 9 de celular
  if (d.startsWith("0")) d = d.slice(1) // el 0 de larga distancia
  // El viejo 15 metido entre la característica y el número: "11 15 2345-6789".
  if (d.length === 12) {
    for (const car of [2, 3, 4]) {
      if (d.slice(car, car + 2) === "15") {
        d = d.slice(0, car) + d.slice(car + 2)
        break
      }
    }
  }
  return d
}

/**
 * La llave con la que se compara un celular contra otro, venga de donde venga
 * (del calendario o de la ficha de una clienta). UNA sola cuenta: si hubiera
 * dos copias, el día que alguien toque una, el panel empezaría a decir "nueva"
 * de clientas de siempre y nadie se daría cuenta.
 */
export function clavePorTelefono(raw: string | null | undefined): string | null {
  const d = soloDigitos(raw ?? "")
  return d.length === 10 ? "+549" + d : null
}

/**
 * Para mostrar. SÓLO se separa la característica cuando es segura (11, el AMBA):
 * adivinarla con los demás sale mal — un número de Zárate (3487) se veía como
 * "+54 9 348 7654-321", y en la pantalla que pregunta "¿te escribimos acá?" eso
 * hace que la persona conteste que no.
 */
export function telefonoLindo(nacional: string): string {
  if (nacional.length !== 10) return "+54 9 " + nacional
  if (nacional.startsWith("11"))
    return `+54 9 11 ${nacional.slice(2, 6)}-${nacional.slice(6)}`
  return `+54 9 ${nacional.slice(0, 4)} ${nacional.slice(4, 7)} ${nacional.slice(7)}`
}

/**
 * Un solo campo "Nombre y apellido" (en el celular, dos campos es un campo de
 * más): la primera palabra es el nombre y el resto el apellido.
 */
export function partirNombre(raw: string): { nombre: string; apellido: string } | null {
  const partes = (raw ?? "").trim().split(/\s+/).filter(Boolean)
  if (partes.length < 2) return null
  if (partes.some((p) => p.length > 40)) return null
  const nombre = partes[0]
  const apellido = partes.slice(1).join(" ")
  if (nombre.length < 2 || apellido.length < 2) return null
  return { nombre, apellido: apellido.slice(0, 80) }
}

/** El mensaje que la clienta le manda a Leri, ya escrito. */
export function mensajeParaLeri(args: {
  nombre: string
  apellido: string
  casillero: number
  premio: string
  codigo: string
}): string {
  const quien = `${args.nombre} ${args.apellido}`.trim()
  return (
    `¡Hola Leri! Soy ${quien}. En el Calendario de Adviento me tocó el número ` +
    `${args.casillero}: "${args.premio}". Mi código es ${args.codigo}. Quiero reservar.`
  )
}

/** El link que abre el chat del salón con ese mensaje adentro. */
export function linkParaLeri(args: {
  nombre: string
  apellido: string
  casillero: number
  premio: string
  codigo: string
}): string {
  return whatsappLink(mensajeParaLeri(args))
}
