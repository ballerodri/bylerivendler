export type ServiceZone = {
  id: string
  name: string
  durationMin: number
  price: number | null   // precio propio en pesos; null = usa el general del servicio
}

export type Service = {
  id: string
  name: string
  duration: number       // per_zone: 0 (la duración sale de las zonas)
  price: number          // per_zone: precio POR ZONA (pesos)
  desc: string
  pointsCost: number
  pricingMode: "fixed" | "per_zone"
  // per_zone: 'multiple' = se eligen varias zonas y se suman; 'single' = se elige un solo producto.
  zoneSelection: "multiple" | "single"
  zones: ServiceZone[]   // vacío para 'fixed'
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

// Cuánta antelación mínima exigimos para reservas (en minutos).
export const MIN_ADVANCE_MIN = 120

export type BusinessHour = { day_of_week: number; is_open: boolean; slots: string[] }

// Fallback hardcodeado para cuando no hay datos de DB (local dev, etc.)
const FALLBACK_HOURS: BusinessHour[] = [
  { day_of_week: 0, is_open: false, slots: [] },
  { day_of_week: 1, is_open: true, slots: ["09:00","10:30","12:00","13:30","15:00","16:30","18:00","19:30"] },
  { day_of_week: 2, is_open: true, slots: ["09:00","10:30","12:00","13:30","15:00","16:30","18:00","19:30"] },
  { day_of_week: 3, is_open: true, slots: ["09:00","10:30","12:00","13:30","15:00","16:30","18:00","19:30"] },
  { day_of_week: 4, is_open: true, slots: ["09:00","10:30","12:00","13:30","15:00","16:30","18:00","19:30"] },
  { day_of_week: 5, is_open: true, slots: ["09:00","10:30","12:00","13:30","15:00","16:30","18:00","19:30"] },
  { day_of_week: 6, is_open: true, slots: ["10:00","11:30","13:00","14:30","16:00"] },
]

export function generateAvailability(
  daysAhead = 60,
  businessHours?: BusinessHour[]
): Record<string, string[]> {
  const hours = businessHours && businessHours.length > 0 ? businessHours : FALLBACK_HOURS
  const byDow = new Map(hours.map((h) => [h.day_of_week, h]))

  const result: Record<string, string[]> = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const dow = d.getDay()
    const h = byDow.get(dow)
    if (!h || !h.is_open || h.slots.length === 0) continue
    result[ymd(d)] = h.slots
  }
  return result
}

/**
 * Filtra los slots de un día que ya pasaron (o que están dentro del margen
 * mínimo de antelación).
 */
// Argentina is always UTC-3 (no DST since 2008).
// All slot/appointment times in this app are in Argentina local time.
export const AR_UTC_OFFSET = 3 // hours to add to convert Argentina → UTC

/**
 * Returns the UTC timestamp (ms) for a slot time treated as Argentina local time.
 * Works consistently on both server (UTC) and client (any timezone).
 */
export function slotToUtcMs(dateStr: string, timeStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number)
  const [hh, mm] = timeStr.split(":").map(Number)
  return Date.UTC(y, m - 1, d, hh + AR_UTC_OFFSET, mm, 0, 0)
}

export function filterFutureSlots(dateStr: string, slots: string[], now = new Date()): string[] {
  const [y, m, d] = dateStr.split("-").map(Number)
  // Midnight Argentina = 03:00 UTC
  const dayStartUtc = Date.UTC(y, m - 1, d, AR_UTC_OFFSET, 0, 0)
  const todayStartUtc = (() => {
    // Current Argentina date: subtract offset from UTC
    const ar = new Date(now.getTime() - AR_UTC_OFFSET * 3_600_000)
    return Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate(), AR_UTC_OFFSET, 0, 0)
  })()

  if (dayStartUtc > todayStartUtc) return slots // future day: all slots valid

  const minTs = now.getTime() + MIN_ADVANCE_MIN * 60_000
  return slots.filter((t) => slotToUtcMs(dateStr, t) >= minTs)
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

export const combineDateTime = (ymdStr: string, hm: string): Date =>
  new Date(slotToUtcMs(ymdStr, hm))

export type ClientForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  consent: boolean
}

export type Combo = {
  id: string
  name: string
  description: string
  price: number        // total_price_cents / 100
  duration: number     // suma de duraciones de servicios
  services: Service[]  // en order_index
}

export type ReservaPack = {
  id: string
  name: string
  description: string
  priceCents: number
  sessions: number
  serviceId: string
  serviceName: string
  pricingMode: "fixed" | "per_zone"
  zonesCount: number | null
  zones: ServiceZone[]   // zonas activas del servicio (para packs per_zone)
  serviceDurationMin: number   // duración del servicio (para packs de servicio fijo)
}

export type BookingState = {
  services: Service[]
  combo?: Combo | null  // si se eligió un combo, services viene de aquí
  pack?: { pack: ReservaPack; zoneIds: string[] } | null
  activeCat?: string
  selectedDate?: string
  selectedTime?: string | null
  pro?: string
  // Multi-professional sequential booking
  serviceStaff?: Record<string, string>   // serviceId → "auto" | staffId (user preference)
  serviceOrder?: string[]                 // service IDs in execution order (resolved)
  resolvedStaff?: Record<string, string>  // serviceId → actual staffId (resolved after slot pick)
  zoneSelections?: Record<string, string[]>  // serviceId → zoneId[] elegidas (solo pricingMode === "per_zone")
  clientMode?: "new" | "existing"
  form?: ClientForm
  redeemWithPoints?: boolean
  savedClientId?: string
}

export type ScreenId =
  | "details"
  | "services"
  | "date"
  | "confirm"
  | "success"

export const SCREEN_LABEL: Record<ScreenId, string> = {
  details: "Tus datos",
  services: "Tratamiento",
  date: "Fecha y horario",
  confirm: "Confirmación",
  success: "Listo",
}
