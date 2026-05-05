import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Category, Service } from "./data"

export type CurrentClient = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  dateOfBirth: string | null
  hasMedicalRecord: boolean
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
      services:services(id, slug, name, description, duration_min, price_cents, active, visible_public)
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
    .select("id, first_name, last_name, email, phone, date_of_birth")
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
  }
}
