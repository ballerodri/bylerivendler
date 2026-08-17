import "server-only"
import { createClient } from "@supabase/supabase-js"
import { serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
import type { Category, Combo, ComboProgramService, Professional, Service } from "./data"

export type CurrentClient = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  dateOfBirth: string | null
  loyaltyPoints: number
}

export type AuthProfile = {
  email: string
  fullName: string | null
}

type DbCategoryRow = {
  id: string
  slug: string
  name: string
  tagline: string | null
  sort_order: number
  services: DbServiceRow[]
}

type DbServiceRow = {
  id: string
  slug: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number
  points_cost: number
  loyalty_enabled: boolean
  active: boolean
  visible_public: boolean
  pricing_mode: "fixed" | "per_zone"
  zone_selection: "multiple" | "single"
  service_zones: { id: string; name: string; duration_min: number; active: boolean; order_index: number; price_cents: number | null }[]
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Returns the public catalog (categories with their visible+active services)
 * mapped to the UI shape that the prototype expects.
 */
export async function fetchCatalog(): Promise<Category[]> {
  const supabase = adminClient()

  const { data, error } = await supabase
    .from("service_categories")
    .select(
      `
      id, slug, name, tagline, sort_order,
      services:services(id, slug, name, description, duration_min, price_cents, points_cost, loyalty_enabled, active, visible_public, pricing_mode, zone_selection, service_zones(id, name, duration_min, active, order_index, price_cents))
    `
    )
    .eq("active", true)
    .order("sort_order", { ascending: true })

  if (error) throw new Error(`fetchCatalog: ${error.message}`)
  if (!data) return []

  const map = await fetchStaffServices()

  return (data as DbCategoryRow[])
    .map((cat): Category => ({
      id: cat.slug,
      name: cat.name,
      tagline: cat.tagline ?? "",
      services: cat.services
        .filter((s) => s.active && s.visible_public && serviceIsBookable(s.id, map))
        .map(
          (s): Service => ({
            id: s.id,
            name: s.name,
            duration: s.duration_min,
            price: Math.round(s.price_cents / 100),
            desc: s.description ?? "",
            pointsCost: s.loyalty_enabled ? s.points_cost : 0,
            pricingMode: s.pricing_mode,
            zoneSelection: s.zone_selection ?? "multiple",
            zones: (s.service_zones ?? [])
              .filter((z) => z.active)
              .sort((a, b) => a.order_index - b.order_index)
              .map((z) => ({
                id: z.id,
                name: z.name,
                durationMin: z.duration_min,
                price: z.price_cents != null ? Math.round(z.price_cents / 100) : null,
              })),
          })
        ),
    }))
    .filter((cat) => cat.services.length > 0)
}

/**
 * Returns the client row linked to a Supabase auth user. Used to skip data
 * entry steps in the booking flow when the user is already known.
 */
export async function fetchCurrentClient(
  userId: string
): Promise<CurrentClient | null> {
  const supabase = adminClient()

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, first_name, last_name, email, phone, date_of_birth, loyalty_points")
    .eq("user_id", userId)
    .maybeSingle()

  if (error || !client) return null

  return {
    id: client.id,
    firstName: client.first_name ?? "",
    lastName: client.last_name ?? "",
    email: client.email,
    phone: client.phone ?? "",
    dateOfBirth: client.date_of_birth ?? null,
    loyaltyPoints: (client.loyalty_points as number | null) ?? 0,
  }
}

const AUTO_PROFESSIONAL: Professional = {
  id: "auto",
  initials: "BLV",
  name: "Asignación automática",
  role: "Se asigna según disponibilidad",
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase()
}

export type BusinessHour = {
  day_of_week: number
  is_open: boolean
  slots: string[]
}

export async function fetchBusinessHours(): Promise<BusinessHour[]> {
  const supabase = adminClient()
  const { data } = await supabase
    .from("business_hours")
    .select("day_of_week, is_open, slots")
    .order("day_of_week", { ascending: true })

  return ((data ?? []) as BusinessHour[])
}

export async function fetchProfessionals(): Promise<Professional[]> {
  const supabase = adminClient()

  const { data } = await supabase
    .from("staff")
    .select("id, full_name, role")
    .eq("active", true)
    .eq("is_professional", true)
    .order("full_name", { ascending: true })

  const staff = ((data ?? []) as { id: string; full_name: string; role: string }[]).map(
    (s): Professional => ({
      id: s.id,
      initials: deriveInitials(s.full_name),
      name: s.full_name,
      role: "Profesional BLV",
    })
  )

  return [AUTO_PROFESSIONAL, ...staff]
}

/**
 * serviceId → profesionales que lo hacen (`staff_services`), contando SÓLO
 * staff activo y profesional (una profesional dada de baja no puede atender).
 */
export async function fetchStaffServices(): Promise<StaffServiceMap> {
  const supabase = adminClient()

  const { data } = await supabase
    .from("staff_services")
    .select("service_id, staff:staff(id, active, is_professional)")

  const map: StaffServiceMap = {}
  for (const row of (data ?? []) as unknown as {
    service_id: string
    staff: { id: string; active: boolean; is_professional: boolean } | null
  }[]) {
    if (!row.staff?.active || !row.staff.is_professional) continue
    ;(map[row.service_id] ??= []).push(row.staff.id)
  }
  return map
}

type DbComboRow = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  combo_services: {
    order_index: number
    sessions: number | null
    session_no: number | null
    zones: { name: string; duration_min: number; price_cents: number }[] | null
    service: {
      id: string
      name: string
      description: string | null
      duration_min: number
      price_cents: number
      points_cost: number
      active: boolean
      visible_public: boolean
      pricing_mode: "fixed" | "per_zone"
    } | null
  }[]
}

export async function fetchCombos(): Promise<Combo[]> {
  const supabase = adminClient()
  const { data } = await supabase
    .from("combos")
    .select(`
      id, name, description, total_price_cents,
      combo_services(order_index, sessions, session_no, zones, service:services(id, name, description, duration_min, price_cents, points_cost, active, visible_public, pricing_mode))
    `)
    .eq("active", true)
    .order("name", { ascending: true })

  if (!data) return []

  const map = await fetchStaffServices()

  return (data as unknown as DbComboRow[])
    .map((c): Combo | null => {
      // Sólo los servicios miembros que se pueden reservar (activos, públicos,
      // con profesional). Si falta alguno, el combo no se muestra: el precio
      // total presupone TODOS los servicios. Orden: (sesión del plan, orden del
      // día); las filas legacy (session_no null) usan el order_index viejo.
      const rows = c.combo_services
        .slice()
        .sort((a, b) => (a.session_no ?? 999) - (b.session_no ?? 999) || a.order_index - b.order_index)
      if (rows.some((cs) => !cs.service || !cs.service.active || !cs.service.visible_public || !serviceIsBookable(cs.service.id, map)))
        return null

      const isPlan = rows.some((cs) => cs.session_no !== null)

      // Precio/duración EFECTIVOS por servicio DISTINTO (agrupando apariciones
      // del plan): para un por-zona, las zonas congeladas al armar el combo;
      // para uno fijo, los del servicio. Las "veces" de cada tratamiento salen
      // de sumar sus apariciones (plan) o su cantidad (legacy). Un por-zona SIN
      // zonas congeladas no se puede reservar online → el combo no se ofrece.
      const byService = new Map<string, ComboProgramService>()
      let unbookable = false
      for (const cs of rows) {
        const svc = cs.service!
        const veces = cs.sessions ?? 1
        // El chequeo por-zona corre para CADA aparición (no sólo la primera):
        // una fila sin snapshot haría fallar la reserva aunque otra lo tenga.
        const frozen = Array.isArray(cs.zones) && cs.zones.length ? cs.zones : null
        if (!frozen && svc.pricing_mode === "per_zone") {
          unbookable = true // por zona sin zonas congeladas: no reservable online
          break
        }
        const existing = byService.get(svc.id)
        if (existing) { existing.sessions += veces; continue }
        let durationMin: number
        let priceCents: number
        if (frozen) {
          durationMin = frozen.reduce((a, z) => a + (z.duration_min ?? 0), 0)
          priceCents = frozen.reduce((a, z) => a + (z.price_cents ?? 0), 0)
        } else {
          durationMin = svc.duration_min
          priceCents = svc.price_cents
        }
        byService.set(svc.id, {
          serviceId: svc.id,
          serviceName: svc.name,
          sessions: veces,
          durationMin,
          priceCents,
          zones: frozen,
        })
      }
      const programServices = [...byService.values()]
      if (unbookable || programServices.length < 2) return null

      // La 1ª sesión que reserva la web: en el plan, TODOS los tratamientos de
      // la sesión 1 (la visita completa, con su duración real); legacy, el 1er
      // tratamiento solo (modelo viejo). La duración por aparición sale del
      // mismo criterio de arriba (snapshot congelado o servicio fijo).
      const durOf = (cs: (typeof rows)[number]): number => {
        const frozen = Array.isArray(cs.zones) && cs.zones.length ? cs.zones : null
        if (frozen) return frozen.reduce((a, z) => a + (z.duration_min ?? 0), 0)
        return cs.service!.duration_min
      }
      const s1Rows = isPlan ? rows.filter((cs) => cs.session_no === 1) : rows.slice(0, 1)
      if (!s1Rows.length) return null // plan sin sesión 1: mal armado, no se ofrece
      const firstSession = {
        label: s1Rows.map((cs) => cs.service!.name).join(" + "),
        durationMin: s1Rows.reduce((a, cs) => a + durOf(cs), 0),
      }

      const services = programServices.map((ps): Service => {
        const svc = rows.find((cs) => cs.service!.id === ps.serviceId)!.service!
        return {
          id: svc.id,
          name: svc.name,
          duration: svc.duration_min,
          price: Math.round(svc.price_cents / 100),
          desc: svc.description ?? "",
          pointsCost: svc.points_cost,
          pricingMode: "fixed",
          zoneSelection: "multiple",
          zones: [],
        }
      })
      return {
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        price: Math.round(c.total_price_cents / 100),
        duration: firstSession.durationMin,
        services,
        programServices,
        // Plan: K sesiones (visitas). Legacy: la suma de cantidades (modelo viejo).
        totalSessions: isPlan
          ? Math.max(0, ...rows.map((cs) => cs.session_no ?? 0))
          : programServices.reduce((a, ps) => a + ps.sessions, 0),
        firstSession,
      }
    })
    .filter((c): c is Combo => c !== null)
}

/**
 * Cantidad de packs activos. Se usa para mostrar (o no) el banner de packs
 * en la página de reserva.
 */
export async function countActivePacks(): Promise<number> {
  const supabase = adminClient()
  const { count } = await supabase
    .from("packs")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
  return count ?? 0
}

type DbReservaPackRow = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  sessions: number
  zones_count: number | null
  interval_days: number | null
  service: {
    id: string
    name: string
    pricing_mode: "fixed" | "per_zone"
    duration_min: number
    service_zones: { id: string; name: string; duration_min: number; active: boolean; order_index: number; price_cents: number | null }[]
  } | null
}

export async function fetchReservaPacks(): Promise<import("./data").ReservaPack[]> {
  const supabase = adminClient()
  const { data } = await supabase
    .from("packs")
    .select(`
      id, name, description, total_price_cents, sessions, zones_count, interval_days,
      service:services(id, name, pricing_mode, duration_min, service_zones(id, name, duration_min, active, order_index, price_cents))
    `)
    .eq("active", true)
    .eq("visible_reserva", true)
    .order("name", { ascending: true })

  if (!data) return []

  const map = await fetchStaffServices()

  return (data as unknown as DbReservaPackRow[])
    .filter((p) => p.service && serviceIsBookable(p.service.id, map))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      priceCents: p.total_price_cents,
      sessions: p.sessions,
      intervalDays: p.interval_days,
      serviceId: p.service!.id,
      serviceName: p.service!.name,
      pricingMode: p.service!.pricing_mode,
      zonesCount: p.zones_count,
      serviceDurationMin: p.service!.duration_min ?? 0,
      zones: (p.service!.service_zones ?? [])
        .filter((z) => z.active)
        .sort((a, b) => a.order_index - b.order_index)
        .map((z) => ({
          id: z.id,
          name: z.name,
          durationMin: z.duration_min,
          price: z.price_cents != null ? Math.round(z.price_cents / 100) : null,
        })),
    }))
}
