import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fetchBusinessHours } from "@/app/reserva/queries"
import { serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
import { sortComboRows, firstSessionIndexes, comboVisitCount } from "@/lib/servicios/combo-plan"
import NuevaReservaForm from "./nueva-reserva-form"
// El selector de sesiones del pack es el MISMO componente de la reserva
// pública: necesita su hoja de estilos, o el calendario se ve como texto
// plano. No pisa nada del admin — `reserva.css` no tiene selectores globales
// y sus clases (`cal*`, `slot*`, `btn`) no se usan acá (el admin usa `adm-*`).
import "@/app/reserva/reserva.css"

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

/** Un combo que el salón puede venderle a la clienta desde el asistente. */
export type ComboOption = {
  id: string
  name: string
  priceCents: number
  /** Cuántas sesiones (visitas) tiene: el plan, o la suma de cantidades (legacy). */
  sessions: number
  /** Los tratamientos de la 1ª sesión ("Ultra + Vela Slim") y su duración total. */
  firstSessionLabel: string
  firstSessionDurationMin: number
  /** El 1er tratamiento de la sesión 1: ancla de la búsqueda de horarios. */
  firstServiceId: string
  /** ¿Se muestra en la web? (el salón puede venderlo igual). */
  active: boolean
  /** Sin esto no se puede vender: `planCombo` lo rechaza. Con el motivo a la vista. */
  bookable: boolean
  unbookableReason: string | null
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
  // Los combos se traen SIN filtrar por `active`: el salón puede venderle a la
  // clienta un combo que todavía no se muestra en la web (`planCombo` relaja esa
  // condición en modo admin, igual que el pack con `visible_reserva`).
  const [{ data }, { data: packRows }, { data: comboRows }, { data: linkRows }, businessHours] = await Promise.all([
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
    admin
      .from("combos")
      .select("id, name, total_price_cents, active, combo_services(order_index, session_no, sessions, zones, service:services(id, name, duration_min, pricing_mode, active, visible_public))")
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

  // Los combos, con lo que el asistente necesita: cuántas visitas tiene y qué
  // es la 1ª sesión (la única que se agenda al vender). La derivación sale del
  // módulo compartido (`combo-plan`), el MISMO que usa `planCombo` al confirmar
  // — así lo que se ofrece acá y lo que el servidor reserva no pueden diferir.
  type ComboSvcRow = {
    order_index: number
    session_no: number | null
    sessions: number | null
    zones: { duration_min: number }[] | null
    service: { id: string; name: string; duration_min: number; pricing_mode: "fixed" | "per_zone"; active: boolean; visible_public: boolean } | null
  }
  const combos: ComboOption[] = ((comboRows ?? []) as unknown as {
    id: string; name: string; total_price_cents: number; active: boolean; combo_services: ComboSvcRow[]
  }[])
    .filter((c) => (c.combo_services?.length ?? 0) >= 2)
    .map((c): ComboOption => {
      const rows = sortComboRows(c.combo_services)
      const s1 = firstSessionIndexes(rows).map((i) => rows[i])
      // La duración de cada tratamiento: el snapshot de zona congelado, o la del
      // servicio si es fijo (mismo criterio que `planCombo`).
      const durOf = (r: ComboSvcRow): number =>
        r.zones?.length ? r.zones.reduce((a, z) => a + (z.duration_min ?? 0), 0) : (r.service?.duration_min ?? 0)

      // Motivos por los que `planCombo` lo rechazaría al confirmar. Se listan
      // igual, deshabilitados y con el motivo a la vista (como los packs).
      let unbookableReason: string | null = null
      const faltante = rows.find((r) => !r.service || !r.service.active || !r.service.visible_public)
      const sinZonas = rows.find((r) => r.service?.pricing_mode === "per_zone" && !r.zones?.length)
      const sinProfe = rows.find((r) => r.service && !serviceIsBookable(r.service.id, staffMap))
      if (!s1.length) unbookableReason = "Este combo no tiene armada su 1ª sesión: revisalo en Combos."
      else if (faltante) unbookableReason = `“${faltante.service?.name ?? "Un tratamiento"}” está inactivo u oculto: revisalo en Servicios.`
      else if (sinZonas) unbookableReason = `“${sinZonas.service?.name}” se cobra por zona y no tiene zonas elegidas en el combo: editalo en Combos.`
      else if (sinProfe) unbookableReason = `“${sinProfe.service?.name}” no tiene ninguna profesional asignada: asignala en Personal.`
      // Última guarda de `planCombo`: sin duración no hay nada que agendar (un
      // dato viejo o editado a mano). Sin esto la tarjeta se ofrecía y recién
      // fallaba al confirmar, con la clienta y la fecha ya elegidas.
      else if (s1.some((r) => durOf(r) <= 0) || s1.reduce((a, r) => a + durOf(r), 0) <= 0)
        unbookableReason = "No pudimos calcular la duración de la 1ª sesión de este combo: revisalo en Combos."

      return {
        id: c.id,
        name: c.name,
        priceCents: c.total_price_cents,
        sessions: comboVisitCount(rows),
        firstSessionLabel: s1.map((r) => r.service?.name ?? "?").join(" + "),
        firstSessionDurationMin: s1.reduce((a, r) => a + durOf(r), 0),
        firstServiceId: s1[0]?.service?.id ?? "",
        active: c.active,
        bookable: !unbookableReason,
        unbookableReason,
      }
    })

  return (
    <>
      <p className="adm-eyebrow">Agenda</p>
      <h1 className="adm-h1">Nueva <em>reserva</em></h1>
      <p className="adm-lede">Creá un turno o vendé un pack o un combo en nombre de una clienta.</p>
      <NuevaReservaForm services={services} packs={packs} combos={combos} businessHours={businessHours} />
    </>
  )
}
