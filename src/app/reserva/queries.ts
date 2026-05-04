import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Category, Service } from "./data"

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
