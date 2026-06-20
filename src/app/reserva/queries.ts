import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Category, Combo, Professional, Service } from "./data"

export type CurrentClient = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  dateOfBirth: string | null
  hasMedicalRecord: boolean
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
  active: boolean
  visible_public: boolean
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
      services:services(id, slug, name, description, duration_min, price_cents, points_cost, active, visible_public)
    `
    )
    .eq("active", true)
    .order("sort_order", { ascending: true })

  if (error) throw new Error(`fetchCatalog: ${error.message}`)
  if (!data) return []

  return (data as DbCategoryRow[]).map((cat): Category => ({
    id: cat.slug,
    name: cat.name,
    tagline: cat.tagline ?? "",
    services: cat.services
      .filter((s) => s.active && s.visible_public)
      .map(
        (s): Service => ({
          id: s.id,
          name: s.name,
          duration: s.duration_min,
          price: Math.round(s.price_cents / 100),
          desc: s.description ?? "",
          pointsCost: s.points_cost,
        })
      ),
  }))
}

/**
 * Returns the client row linked to a Supabase auth user, plus a flag indicating
 * whether they have a current medical record. Used to skip data entry steps
 * in the booking flow when the user is already known.
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

  const { data: record } = await supabase
    .from("client_records")
    .select("id")
    .eq("client_id", client.id)
    .eq("is_current", true)
    .maybeSingle()

  return {
    id: client.id,
    firstName: client.first_name ?? "",
    lastName: client.last_name ?? "",
    email: client.email,
    phone: client.phone ?? "",
    dateOfBirth: client.date_of_birth ?? null,
    hasMedicalRecord: !!record,
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

  return (data as unknown as DbComboRow[]).map((c): Combo => {
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
