import "server-only"
import { createClient } from "@supabase/supabase-js"
import { serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
import type { Category, Combo, Professional, Service } from "./data"

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
    service: {
      id: string
      name: string
      description: string | null
      duration_min: number
      price_cents: number
      points_cost: number
      active: boolean
      visible_public: boolean
    } | null
  }[]
}

export async function fetchCombos(): Promise<Combo[]> {
  const supabase = adminClient()
  const { data } = await supabase
    .from("combos")
    .select(`
      id, name, description, total_price_cents,
      combo_services(order_index, service:services(id, name, description, duration_min, price_cents, points_cost, active, visible_public))
    `)
    .eq("active", true)
    .order("name", { ascending: true })

  if (!data) return []

  const map = await fetchStaffServices()

  return (data as unknown as DbComboRow[])
    .filter((c) =>
      c.combo_services.every((cs) => !cs.service || serviceIsBookable(cs.service.id, map))
    )
    .map((c): Combo => {
      const services = c.combo_services
        .filter((cs) => cs.service?.active && cs.service?.visible_public)
        .sort((a, b) => a.order_index - b.order_index)
        .map((cs): Service => ({
          id: cs.service!.id,
          name: cs.service!.name,
          duration: cs.service!.duration_min,
          price: Math.round(cs.service!.price_cents / 100),
          desc: cs.service!.description ?? "",
          pointsCost: cs.service!.points_cost,
          pricingMode: "fixed",
          zoneSelection: "multiple",
          zones: [],
        }))
      const duration = services.reduce((a, s) => a + s.duration, 0)
      return {
        id: c.id,
        name: c.name,
        description: c.description ?? "",
        price: Math.round(c.total_price_cents / 100),
        duration,
        services,
      }
    })
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
