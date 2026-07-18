import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fetchBusinessHours } from "@/app/reserva/queries"
import { serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
import NuevaReservaForm from "./nueva-reserva-form"

export const dynamic = "force-dynamic"

export type ZoneOption = { id: string; name: string; durationMin: number; priceCents: number | null }

export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
  zone_selection: "multiple" | "single"
  zones: ZoneOption[]
  // ¿Hay alguna profesional cargada en `staff_services` para este servicio?
  // El camino de sólo tratamientos (`createAdminBooking`) NO lo mira — el
  // salón siempre pudo cargar a mano un servicio sin asignar. Se usa sólo
  // cuando la reserva lleva un pack: ahí la escribe `createBooking`, que es
  // fail-closed y rechazaría el servicio.
  bookable: boolean
}

/** Un pack que el salón puede venderle a la clienta desde el asistente. */
export type PackOption = {
  id: string
  name: string
  sessions: number
  intervalDays: number | null
  priceCents: number
  // Cuántas zonas hay que elegir (sólo si el servicio del pack es por zona).
  zonesCount: number
  serviceId: string
  serviceName: string
  pricingMode: "fixed" | "per_zone"
  zoneSelection: "multiple" | "single"
  serviceDurationMin: number
  zones: ZoneOption[]
  // Igual que en `ServiceOption`: sin ninguna profesional en `staff_services`,
  // `planPack` rechaza el pack (fail-closed, también en modo admin). Se lista
  // igual, deshabilitado y con el motivo a la vista.
  bookable: boolean
}

export default async function NuevaReservaPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // Los packs se traen SIN filtrar por `visible_reserva`: el salón puede
  // venderle a la clienta un pack que no se muestra en la web (`planPack`
  // relaja esa condición en modo admin y exige `active`, igual que acá).
  const [{ data }, { data: packRows }, { data: linkRows }, businessHours] = await Promise.all([
    admin
      .from("services")
      .select("id, name, duration_min, price_cents, pricing_mode, zone_selection, category:service_categories(name), service_zones(id, name, duration_min, price_cents, active, order_index)")
      .eq("active", true)
      .order("name"),
    admin
      .from("packs")
      .select("id, name, sessions, interval_days, total_price_cents, zones_count, service:services(id, name, pricing_mode, zone_selection, duration_min, service_zones(id, name, duration_min, price_cents, active, order_index))")
      .eq("active", true)
      .order("name"),
    // Crudo, sin filtrar por profesional activa: es EXACTAMENTE el mapa que lee
    // el servidor (`createBooking`/`planPack`/`fetchDayAvailability`). Un mapa
    // más chico marcaría como no vendible algo que el servidor sí acepta.
    admin.from("staff_services").select("service_id, staff_id"),
    fetchBusinessHours(),
  ])

  const staffMap: StaffServiceMap = {}
  for (const r of ((linkRows ?? []) as { service_id: string; staff_id: string }[])) {
    ;(staffMap[r.service_id] ??= []).push(r.staff_id)
  }

  const mapZones = (rows: { id: string; name: string; duration_min: number; price_cents: number | null; active: boolean; order_index: number }[] | undefined): ZoneOption[] =>
    (rows ?? [])
      .filter((z) => z.active)
      .sort((a, b) => a.order_index - b.order_index)
      .map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null }))

  const services: ServiceOption[] = ((data ?? []) as unknown as {
    id: string
    name: string
    duration_min: number
    price_cents: number
    category: { name: string } | null
    pricing_mode: "fixed" | "per_zone"
    zone_selection: "multiple" | "single"
  }[]).map((s) => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: s.category?.name ?? "Sin categoría",
    pricing_mode: s.pricing_mode,
    zone_selection: s.zone_selection ?? "multiple",
    zones: mapZones((s as unknown as { service_zones?: Parameters<typeof mapZones>[0] }).service_zones),
    bookable: serviceIsBookable(s.id, staffMap),
  }))

  const packs: PackOption[] = ((packRows ?? []) as unknown as {
    id: string
    name: string
    sessions: number
    interval_days: number | null
    total_price_cents: number
    zones_count: number | null
    service: {
      id: string
      name: string
      pricing_mode: "fixed" | "per_zone"
      zone_selection: "multiple" | "single" | null
      duration_min: number
      service_zones?: Parameters<typeof mapZones>[0]
    } | null
  }[])
    .filter((p) => p.service)
    .map((p) => ({
      id: p.id,
      name: p.name,
      sessions: p.sessions,
      intervalDays: p.interval_days,
      priceCents: p.total_price_cents,
      zonesCount: p.zones_count ?? 0,
      serviceId: p.service!.id,
      serviceName: p.service!.name,
      pricingMode: p.service!.pricing_mode,
      zoneSelection: p.service!.zone_selection ?? "multiple",
      serviceDurationMin: p.service!.duration_min,
      zones: mapZones(p.service!.service_zones),
      bookable: serviceIsBookable(p.service!.id, staffMap),
    }))

  return (
    <>
      <p className="adm-eyebrow">Agenda</p>
      <h1 className="adm-h1">Nueva <em>reserva</em></h1>
      <p className="adm-lede">Creá un turno o vendé un pack en nombre de una clienta.</p>
      <NuevaReservaForm services={services} packs={packs} businessHours={businessHours} />
    </>
  )
}
