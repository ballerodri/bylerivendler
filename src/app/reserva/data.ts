export type Service = {
  id: string
  name: string
  duration: number
  price: number
  desc: string
}

export type Category = {
  id: string
  name: string
  tagline: string
  services: Service[]
}

export type Professional = {
  id: string
  initials: string
  name: string
  role: string
}

export const CATEGORIES: Category[] = [
  {
    id: "facial",
    name: "Facial",
    tagline: "Rituales de piel",
    services: [
      { id: "f1", name: "Limpieza facial profunda", duration: 60, price: 35000, desc: "Extracción, vapor ozonizado y máscara calmante. Ideal como primer encuentro con la piel." },
      { id: "f2", name: "Hydrafacial signature", duration: 75, price: 78000, desc: "Exfoliación, infusión de sérums y hidratación intensiva con efecto luminoso inmediato." },
      { id: "f3", name: "Radiofrecuencia facial", duration: 50, price: 58000, desc: "Tensado progresivo con aparatología. Serie de 6 sesiones recomendadas." },
      { id: "f4", name: "Peeling químico editorial", duration: 45, price: 54000, desc: "Renovación celular con ácidos seleccionados según ficha dermatológica." },
    ],
  },
  {
    id: "corporal",
    name: "Corporal",
    tagline: "Tratamientos de cuerpo",
    services: [
      { id: "c1", name: "Drenaje linfático manual", duration: 60, price: 38000, desc: "Técnica Vodder clásica. Reduce retención y activa circulación." },
      { id: "c2", name: "Masaje descontracturante", duration: 60, price: 36000, desc: "Presión profunda sobre zonas de tensión. Con aceites esenciales." },
      { id: "c3", name: "Maderoterapia modeladora", duration: 75, price: 48000, desc: "Remodelado de silueta con instrumental de madera. Serie recomendada." },
      { id: "c4", name: "Ritual de espalda", duration: 50, price: 34000, desc: "Limpieza, exfoliación y masaje. Para pieles con acné o tensión crónica." },
    ],
  },
  {
    id: "masaje",
    name: "Masajes",
    tagline: "Relajación y bienestar",
    services: [
      { id: "m1", name: "Masaje relajante", duration: 60, price: 32000, desc: "Maniobras suaves sobre cuerpo completo. Aromaterapia personalizada." },
      { id: "m2", name: "Piedras calientes", duration: 75, price: 44000, desc: "Basaltos termoregulados. Calor que desbloquea tensiones profundas." },
      { id: "m3", name: "Masaje en pareja", duration: 60, price: 62000, desc: "Cabina doble, dos terapeutas, misma sincronía. Con copa de espumante." },
    ],
  },
]

export const PROFESSIONALS: Professional[] = [
  { id: "auto", initials: "BLV", name: "Asignación automática", role: "Se asigna según disponibilidad" },
  { id: "p1", initials: "LV", name: "Leri Vendler", role: "Cosmetóloga · Fundadora" },
  { id: "p2", initials: "SM", name: "Sofía Marsicano", role: "Esteticista corporal" },
  { id: "p3", initials: "CA", name: "Camila Aranda", role: "Especialista facial" },
]

// Slots base por día de la semana (0 = domingo … 6 = sábado).
// Domingo cerrado. Los sábados cerramos antes.
const WEEKDAY_SLOTS = [
  "09:00", "10:30", "12:00", "13:30",
  "15:00", "16:30", "18:00", "19:30",
]
const SATURDAY_SLOTS = ["10:00", "11:30", "13:00", "14:30", "16:00"]

// Cuánta antelación mínima exigimos para reservas (en minutos).
// Evita que alguien intente reservar "para dentro de 10 minutos".
export const MIN_ADVANCE_MIN = 120

/**
 * Genera disponibilidad para los próximos `daysAhead` días desde hoy.
 * Hasta que tengamos lógica real de calendario (staff, turnos ocupados),
 * sirve para mostrar slots actuales y ofrecer una reserva razonable.
 */
export function generateAvailability(daysAhead = 60): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const dow = d.getDay()
    if (dow === 0) continue // domingo cerrado
    result[ymd(d)] = dow === 6 ? SATURDAY_SLOTS : WEEKDAY_SLOTS
  }
  return result
}

/**
 * Filtra los slots de un día que ya pasaron (o que están dentro del margen
 * mínimo de antelación).
 */
export function filterFutureSlots(dateStr: string, slots: string[], now = new Date()): string[] {
  const d = parseYmd(dateStr)
  d.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (d.getTime() > today.getTime()) return slots // día futuro: todos válidos

  const minTs = now.getTime() + MIN_ADVANCE_MIN * 60_000
  return slots.filter((t) => {
    const [hh, mm] = t.split(":").map(Number)
    const slotTs = parseYmd(dateStr).setHours(hh, mm, 0, 0)
    return slotTs >= minTs
  })
}

export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]
export const DOW_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
export const DOW_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

export const fmtPrice = (n: number) => "$" + n.toLocaleString("es-AR")

export const fmtDuration = (m: number) => {
  if (m < 60) return m + " min"
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

export const pad2 = (n: number) => String(n).padStart(2, "0")
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

// Auto-formats a DOB as the user types: "22031988" -> "22/03/1988"
export const formatDob = (raw: string): string => {
  const digits = raw.replace(/\D/g, "").slice(0, 8)
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  if (digits.length <= 2) return dd
  if (digits.length <= 4) return `${dd}/${mm}`
  return `${dd}/${mm}/${yyyy}`
}

export const combineDateTime = (ymdStr: string, hm: string): Date => {
  const [y, m, d] = ymdStr.split("-").map(Number)
  const [hh, mm] = hm.split(":").map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

export type ClientForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  consent: boolean
}

export type MedicalForm = {
  allergies: string[]
  allergiesOther: string
  meds: "no" | "si"
  medsNote: string
  pregnancy: "no" | "embarazo" | "lactancia"
  skin: string[]
  consent: boolean
}

export type BookingState = {
  services: Service[]
  activeCat?: string
  selectedDate?: string
  selectedTime?: string | null
  pro?: string
  clientMode?: "new" | "existing"
  form?: ClientForm
  medical?: MedicalForm
}

export const STEP_LABELS = [
  "Tratamiento",
  "Fecha y horario",
  "Tus datos",
  "Ficha inicial",
  "Confirmación",
  "Listo",
] as const
