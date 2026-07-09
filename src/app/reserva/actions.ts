"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingConfirmation } from "@/lib/email/booking-emails"
import { ymd, filterFutureSlots, slotToUtcMs, AR_UTC_OFFSET } from "./data"
import { createCalendarEvent } from "@/lib/google-calendar"
import { computeZonePricing, resolveSelectedZones, type Zone, type ZoneSnapshot } from "@/lib/servicios/zones"

const BookingInput = z.object({
  serviceIds: z.array(z.string().uuid()),
  startsAt: z.string().datetime(),
  proHint: z.string(),
  // Multi-professional sequential support
  serviceOrder: z.array(z.string().uuid()).optional(),
  resolvedStaff: z.record(z.string(), z.string()).optional(),
  redeemWithPoints: z.boolean().optional(),
  savedClientId: z.string().uuid().optional(),
  comboId: z.string().uuid().optional(),
  zoneSelections: z.record(z.string().uuid(), z.array(z.string().uuid())).optional(),
  packId: z.string().uuid().optional(),
  packZoneIds: z.array(z.string().uuid()).optional(),
  client: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    dob: z.string().min(1),
    marketingConsent: z.boolean(),
    isExisting: z.boolean(),
  }),
}).refine((v) => v.serviceIds.length > 0 || !!v.packId, {
  message: "Elegí al menos un servicio o un pack.",
})

export type CreateBookingInput = z.infer<typeof BookingInput>

export type CreateBookingResult =
  | { ok: true; appointmentId: string }
  | { ok: false; error: string }

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function createBooking(
  raw: CreateBookingInput
): Promise<CreateBookingResult> {
  const parsed = BookingInput.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Revisá el formulario." }
  }
  const input = parsed.data
  const supabase = adminClient()

  // 1) Resolve services to compute totals + ends_at
  const { data: services, error: svcErr } = await supabase
    .from("services")
    .select("id, name, duration_min, price_cents, points_cost, pricing_mode")
    .in("id", input.serviceIds)

  if (svcErr) return { ok: false, error: `Servicios: ${svcErr.message}` }
  if (!services || services.length !== input.serviceIds.length) {
    return { ok: false, error: "Algún servicio ya no está disponible." }
  }

  // Para servicios por zona, traer sus zonas activas y resolver la selección.
  const perZoneIds = services.filter((s) => s.pricing_mode === "per_zone").map((s) => s.id)
  const zonesByService: Record<string, Zone[]> = {}
  if (perZoneIds.length) {
    const { data: zoneRows, error: zErr } = await supabase
      .from("service_zones")
      .select("id, service_id, name, duration_min, price_cents")
      .in("service_id", perZoneIds)
      .eq("active", true)
    if (zErr) return { ok: false, error: `Zonas: ${zErr.message}` }
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null })
    }
  }

  // Precio/duración efectivos por servicio (+ snapshot de zonas para per_zone).
  const computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }> = {}
  for (const s of services) {
    if (s.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(input.zoneSelections?.[s.id] ?? [], zonesByService[s.id] ?? [])
      if (!selected) return { ok: false, error: "Elegí al menos una zona válida para el servicio por zona." }
      const p = computeZonePricing(selected, s.price_cents)
      computed[s.id] = { durationMin: p.durationMin, priceCents: p.priceCents, zones: p.zones }
    } else {
      computed[s.id] = { durationMin: s.duration_min, priceCents: s.price_cents, zones: null }
    }
  }

  const totalDuration = services.reduce((a, s) => a + computed[s.id].durationMin, 0)
  let totalCents = services.reduce((a, s) => a + computed[s.id].priceCents, 0)

  // Si es un combo, reemplazamos el precio por el del combo
  if (input.comboId) {
    const { data: combo } = await supabase
      .from("combos")
      .select("total_price_cents, active")
      .eq("id", input.comboId)
      .eq("active", true)
      .maybeSingle()
    if (combo) totalCents = combo.total_price_cents
  }

  const depositCents = Math.round(totalCents * 0.3)
  const totalPointsCost = services.reduce(
    (a, s) => a + (s.points_cost ?? 0),
    0
  )
  const redeem = !!input.redeemWithPoints
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000)

  // 2) Find or create client. Si ya fue guardada por saveClientEarly usamos
  // ese ID directamente y salteamos la creación.
  const ssr = await createSsrClient()
  const {
    data: { user: authUser },
  } = await ssr.auth.getUser()

  const email = input.client.email.trim().toLowerCase()
  let clientId: string
  let alreadyLinked: boolean

  if (input.savedClientId) {
    clientId = input.savedClientId
    const { data: saved } = await supabase
      .from("clients")
      .select("user_id")
      .eq("id", clientId)
      .maybeSingle()
    alreadyLinked = !!(saved?.user_id)
  } else {
    const { data: existing, error: findErr } = await supabase
      .from("clients")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (findErr) return { ok: false, error: `Clientes: ${findErr.message}` }

    if (existing) {
      clientId = existing.id
      if (authUser && !existing.user_id && authUser.email?.toLowerCase() === email) {
        await supabase.from("clients").update({ user_id: authUser.id }).eq("id", clientId)
      }
      alreadyLinked = !!existing.user_id
    } else {
      const dob = parseDob(input.client.dob)
      const { data: created, error: insErr } = await supabase
        .from("clients")
        .insert({
          user_id:
            authUser && authUser.email?.toLowerCase() === email
              ? authUser.id
              : null,
          first_name: input.client.firstName.trim(),
          last_name: input.client.lastName.trim(),
          email,
          phone: input.client.phone.trim(),
          date_of_birth: dob,
          marketing_consent: input.client.marketingConsent,
          source: "web",
        })
        .select("id")
        .single()
      if (insErr || !created)
        return { ok: false, error: `No pudimos crear tu ficha: ${insErr?.message}` }
      clientId = created.id
      alreadyLinked = false
    }
  }

  // ── Reserva de un PACK (excluyente): crea la compra + primer turno portador ──
  if (input.packId) {
    const { data: pack } = await supabase
      .from("packs")
      .select("id, name, sessions, total_price_cents, zones_count, active, visible_reserva, service:services(id, name, pricing_mode, duration_min, price_cents)")
      .eq("id", input.packId)
      .eq("active", true)
      .eq("visible_reserva", true)
      .maybeSingle()
    if (!pack) return { ok: false, error: "Ese pack ya no está disponible." }
    const svc = pack.service as unknown as { id: string; name: string; pricing_mode: "fixed" | "per_zone"; duration_min: number; price_cents: number } | null
    if (!svc) return { ok: false, error: "El pack no tiene servicio asociado." }

    // Duración de la 1ª sesión + snapshot de zonas
    let firstDuration = svc.duration_min
    let zonesSnapshot: ZoneSnapshot[] | null = null
    if (svc.pricing_mode === "per_zone") {
      const { data: zoneRows } = await supabase
        .from("service_zones")
        .select("id, name, duration_min, price_cents")
        .eq("service_id", svc.id)
        .eq("active", true)
      const avail: Zone[] = (zoneRows ?? []).map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null }))
      const selected = resolveSelectedZones(input.packZoneIds ?? [], avail)
      if (!selected || selected.length !== (pack.zones_count ?? 0))
        return { ok: false, error: `Elegí exactamente ${pack.zones_count} zona(s) para el pack.` }
      const p = computeZonePricing(selected, svc.price_cents)
      firstDuration = p.durationMin
      zonesSnapshot = p.zones
    }

    const packStartsAt = new Date(input.startsAt)
    const packEndsAt = new Date(packStartsAt.getTime() + firstDuration * 60_000)
    const packDeposit = Math.round(pack.total_price_cents * 0.3)

    // Crear la compra del pack
    const { data: purchase, error: purErr } = await supabase
      .from("pack_purchases")
      .insert({
        client_id: clientId,
        pack_id: pack.id,
        pack_name: pack.name,
        service_id: svc.id,
        service_name: svc.name,
        sessions_total: pack.sessions,
        sessions_used: 0,
      })
      .select("id")
      .single()
    if (purErr || !purchase) return { ok: false, error: `No pudimos registrar el pack: ${purErr?.message}` }

    // Sala + staff (mismo criterio que el turno normal)
    const { data: packRoom } = await supabase.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
    const packStaffId = input.resolvedStaff
      ? (input.serviceOrder?.[0] ? (input.resolvedStaff[input.serviceOrder[0]] ?? null) : Object.values(input.resolvedStaff)[0] ?? null)
      : (input.proHint !== "auto" ? input.proHint : null)

    const { data: packAppt, error: packApptErr } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        staff_id: packStaffId,
        room_id: packRoom?.id ?? null,
        starts_at: packStartsAt.toISOString(),
        ends_at: packEndsAt.toISOString(),
        duration_min: firstDuration,
        total_cents: pack.total_price_cents,
        deposit_cents: packDeposit,
        deposit_paid: false,
        status: "pending",
        source: "web",
        pack_purchase_id: purchase.id,
        notes_internal: `Pack: ${pack.name} (sesión 1 de ${pack.sessions})`,
      })
      .select("id")
      .single()
    if (packApptErr || !packAppt) return { ok: false, error: `Turno del pack: ${packApptErr?.message}` }

    const { error: packLinkErr } = await supabase.from("appointment_services").insert({
      appointment_id: packAppt.id,
      service_id: svc.id,
      duration_min: firstDuration,
      price_cents: pack.total_price_cents,
      zones: zonesSnapshot,
      staff_id: packStaffId,
      starts_at: packStartsAt.toISOString(),
    })
    if (packLinkErr) return { ok: false, error: `Servicio del turno: ${packLinkErr.message}` }

    // Email de confirmación (best-effort, no bloqueante)
    try {
      await sendBookingConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        servicesNames: [`${pack.name} (sesión 1 de ${pack.sessions})`],
        startsAt: packStartsAt,
        durationMin: firstDuration,
        totalCents: pack.total_price_cents,
        appointmentId: packAppt.id,
      })
    } catch {}

    return { ok: true, appointmentId: packAppt.id }
  }

  // 4) Default room (first active room)
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  // 4b) Validar y descontar puntos si pidió canjear con Programa Cerca.
  if (redeem) {
    if (totalPointsCost <= 0) {
      return { ok: false, error: "Estos servicios no se pueden canjear por puntos." }
    }
    const { data: c } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    const balance = (c?.loyalty_points as number | null) ?? 0
    if (balance < totalPointsCost) {
      return {
        ok: false,
        error: `Te faltan ${totalPointsCost - balance} pts para canjear este turno.`,
      }
    }
    await supabase
      .from("clients")
      .update({ loyalty_points: balance - totalPointsCost })
      .eq("id", clientId)
  }

  // 5) Determine main staff (first service's resolved pro, or proHint)
  const mainStaffId = input.resolvedStaff
    ? (input.serviceOrder?.[0]
        ? (input.resolvedStaff[input.serviceOrder[0]] ?? null)
        : Object.values(input.resolvedStaff)[0] ?? null)
    : (input.proHint !== "auto" ? input.proHint : null)

  // 5) Create appointment
  const { data: appt, error: apptErr } = await supabase
    .from("appointments")
    .insert({
      client_id: clientId,
      staff_id: mainStaffId,
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: totalDuration,
      total_cents: redeem ? 0 : totalCents,
      deposit_cents: redeem ? 0 : depositCents,
      deposit_paid: redeem,
      status: redeem ? "confirmed" : "pending",
      source: "web",
      notes_internal: redeem ? `Canjeado con ${totalPointsCost} pts del Programa Cerca` : null,
    })
    .select("id")
    .single()

  if (apptErr || !appt)
    return { ok: false, error: `Turno: ${apptErr?.message}` }

  // 6) Link services — respecting sequential order and per-service staff/starts_at
  const orderedIds = input.serviceOrder ?? services.map((s) => s.id)
  const orderedServices = orderedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  let serviceMs = startsAt.getTime()
  const apptServices = orderedServices.map((s) => {
    const c = computed[s.id]
    const sStartsAt = new Date(serviceMs)
    serviceMs += c.durationMin * 60_000
    return {
      appointment_id: appt.id,
      service_id: s.id,
      duration_min: c.durationMin,
      price_cents: c.priceCents,
      zones: c.zones,
      staff_id: input.resolvedStaff?.[s.id] ?? mainStaffId,
      starts_at: sStartsAt.toISOString(),
    }
  })

  const { error: linkErr } = await supabase
    .from("appointment_services")
    .insert(apptServices)

  if (linkErr) return { ok: false, error: `Servicios del turno: ${linkErr.message}` }

  // 7) Google Calendar event (no bloqueante)
  try {
    let staffName: string | null = null
    let staffEmail: string | null = null
    let staffColorId: string | null = null
    if (mainStaffId) {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("full_name, email, calendar_color_id")
        .eq("id", mainStaffId)
        .maybeSingle()
      staffName = staffRow?.full_name ?? null
      staffEmail = staffRow?.email ?? null
      staffColorId = (staffRow as any)?.calendar_color_id ?? null
    }
    const eventId = await createCalendarEvent({
      appointmentId: appt.id,
      clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
      serviceNames: services.map((s) => s.name),
      staffName,
      staffEmail,
      staffColorId,
      startsAt,
      endsAt,
      notes: null,
    })
    if (eventId) {
      await supabase
        .from("appointments")
        .update({ google_event_id: eventId })
        .eq("id", appt.id)
    }
  } catch {
    // Non-fatal: el turno ya está creado
  }

  // 8) Email de confirmación con los detalles del turno (no bloqueante).
  try {
    await sendBookingConfirmation({
      to: email,
      firstName: input.client.firstName.trim(),
      servicesNames: services.map((s) => s.name),
      startsAt,
      durationMin: totalDuration,
      totalCents,
      appointmentId: appt.id,
    })
  } catch {
    // ignore — la reserva ya está; el equipo puede reenviar manualmente.
  }

  // 8) Magic link para portal — solo si:
  //   - no hay sesión activa
  //   - Y el clients row no está ya linkeado a un auth user
  if (!authUser && !alreadyLinked) {
    try {
      const h = await headers()
      const proto = h.get("x-forwarded-proto") ?? "http"
      const host = h.get("host")
      const origin = `${proto}://${host}`
      const plain = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      await plain.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/portal`,
          shouldCreateUser: true,
        },
      })
    } catch {
      // ignore
    }
  }

  return { ok: true, appointmentId: appt.id }
}

export type SaveClientResult =
  | { ok: true; clientId: string }
  | { ok: false; error: string }

export async function saveClientEarly(data: {
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  marketingConsent: boolean
}): Promise<SaveClientResult> {
  const supabase = adminClient()
  const ssr = await createSsrClient()
  const { data: { user: authUser } } = await ssr.auth.getUser()

  const email = data.email.trim().toLowerCase()
  const { data: existing } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    if (authUser && !existing.user_id && authUser.email?.toLowerCase() === email) {
      await supabase.from("clients").update({ user_id: authUser.id }).eq("id", existing.id)
    }
    return { ok: true, clientId: existing.id }
  }

  const dob = parseDob(data.dob)
  const { data: created, error } = await supabase
    .from("clients")
    .insert({
      user_id: authUser && authUser.email?.toLowerCase() === email ? authUser.id : null,
      first_name: data.firstName.trim(),
      last_name: data.lastName.trim(),
      email,
      phone: data.phone.trim(),
      date_of_birth: dob,
      marketing_consent: data.marketingConsent,
      source: "web",
    })
    .select("id")
    .single()

  if (error || !created) return { ok: false, error: error?.message ?? "Error al guardar datos" }
  return { ok: true, clientId: created.id }
}

/**
 * Returns the candidate slots (from business hours) that are actually free,
 * considering existing appointments for the day and the total duration of
 * the new appointment.
 *
 * proHint === "auto"  → slot is free if at least one professional is free
 * proHint === <uuid>  → slot is free if that professional has no overlap
 */
export async function fetchDayAvailability(
  dateStr: string,
  durationMin: number,
  proHint: string,
  candidateSlots: string[]
): Promise<string[]> {
  if (!candidateSlots.length) return []

  const supabase = adminClient()

  const [dy, dm, dd] = dateStr.split("-").map(Number)
  const dayStartMs = Date.UTC(dy, dm - 1, dd, AR_UTC_OFFSET, 0, 0)
  const dayStart = new Date(dayStartMs).toISOString()
  const dayEnd = new Date(dayStartMs + 24 * 3_600_000).toISOString()
  const dayOfWeek = new Date(dayStartMs).getUTCDay()

  let apptQuery = supabase
    .from("appointments")
    .select("starts_at, duration_min, staff_id")
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .in("status", ["pending", "confirmed"])

  if (proHint !== "auto") {
    apptQuery = apptQuery.eq("staff_id", proHint)
  }

  let availQuery = supabase
    .from("staff_availability")
    .select("staff_id, day_of_week, from_time, to_time")
  if (proHint !== "auto") availQuery = availQuery.eq("staff_id", proHint)

  const [{ data: appointments }, { data: prosData }, { data: availData }] = await Promise.all([
    apptQuery,
    proHint === "auto"
      ? supabase.from("staff").select("id").eq("is_professional", true).eq("active", true)
      : Promise.resolve({ data: [] as { id: string }[] }),
    availQuery,
  ])

  const activePros = (prosData ?? []).map((p: { id: string }) => p.id)
  const availRows = (availData ?? []) as { staff_id: string; day_of_week: number; from_time: string; to_time: string }[]
  const staffHasAvail = new Set(availRows.map((r) => r.staff_id))
  const availMap: AvailMap = new Map(
    availRows.map((r) => [`${r.staff_id}|${r.day_of_week}`, { from_time: r.from_time, to_time: r.to_time }])
  )

  return candidateSlots.filter((slot) => {
    const slotStart = slotToUtcMs(dateStr, slot)
    const slotEnd   = slotStart + durationMin * 60_000

    if (proHint === "auto") {
      // Count pros actually available at this slot (day + hours)
      const availableAtSlot = activePros.filter(
        (pid) => proWorksAtSlot(pid, dayOfWeek, slotStart, slotEnd, staffHasAvail, availMap)
      )
      if (!availableAtSlot.length) return false

      // Count distinct busy professionals in this window
      const busyIds = new Set<string>()
      let anonymousBusy = 0
      for (const appt of (appointments ?? [])) {
        const aStart = new Date(appt.starts_at).getTime()
        const aEnd   = aStart + (appt.duration_min as number) * 60_000
        if (slotStart >= aEnd || slotEnd <= aStart) continue
        if (appt.staff_id) busyIds.add(appt.staff_id as string)
        else anonymousBusy++
      }
      return busyIds.size + anonymousBusy < availableAtSlot.length
    } else {
      if (!proWorksAtSlot(proHint, dayOfWeek, slotStart, slotEnd, staffHasAvail, availMap)) return false
      return !(appointments ?? []).some((appt) => {
        const aStart = new Date(appt.starts_at).getTime()
        const aEnd   = aStart + (appt.duration_min as number) * 60_000
        return slotStart < aEnd && slotEnd > aStart
      })
    }
  })
}

// ─── Sequential availability ──────────────────────────────────────────────────

export type ServiceInput = { id: string; name: string; duration: number; staffId: string }

export type SlotResult = {
  date: string
  time: string
  serviceOrder: string[]
  resolvedStaff: Record<string, string>
}

export type SequentialAvailabilityResult = {
  slotsForDate: SlotResult[]
  nextAvailable: SlotResult[]
  hasSequentialToday: boolean
  individualSlotsForDate: { serviceId: string; serviceName: string; slots: string[] }[]
}

function permutations(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr.slice()]
  const result: number[][] = []
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) result.push([arr[i], ...p])
  }
  return result
}

type Appt = { starts_at: string; duration_min: number; staff_id: string | null }

type AvailMap = Map<string, { from_time: string; to_time: string }>

function utcMsToArTime(ms: number): string {
  const arMs = ms - AR_UTC_OFFSET * 3_600_000
  const d = new Date(arMs)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

function proWorksAtSlot(
  staffId: string,
  dayOfWeek: number,
  slotStartMs: number,
  slotEndMs: number,
  staffHasAvail: Set<string>,
  availMap: AvailMap
): boolean {
  if (!staffHasAvail.has(staffId)) return true // no availability config = always available
  const avail = availMap.get(`${staffId}|${dayOfWeek}`)
  if (!avail) return false // configured for other days but not this one
  const startStr = utcMsToArTime(slotStartMs)
  const endStr = utcMsToArTime(slotEndMs)
  return avail.from_time <= startStr && endStr <= avail.to_time
}

function checkPerm(
  startMs: number,
  perm: number[],
  services: ServiceInput[],
  appts: Appt[],
  allPros: string[],
  dayOfWeek: number,
  staffHasAvail: Set<string>,
  availMap: AvailMap
): Record<string, string> | null {
  const assignment: Record<string, string> = {}
  // Tracks which professionals are concurrently busy within THIS permutation's
  // time windows. Since services run sequentially (one ends before the next starts),
  // the same professional CAN appear in multiple services — no concurrency conflict.
  // We only block concurrent overlap with EXISTING appointments in `appts`.
  let ms = startMs

  for (const idx of perm) {
    const svc = services[idx]
    const sStart = ms
    const sEnd = ms + svc.duration * 60_000

    const overlaps = (pid: string) =>
      appts.some((a) => {
        if (a.staff_id !== pid) return false
        const aS = new Date(a.starts_at).getTime()
        return sStart < aS + a.duration_min * 60_000 && sEnd > aS
      })

    if (svc.staffId !== "auto") {
      if (!proWorksAtSlot(svc.staffId, dayOfWeek, sStart, sEnd, staffHasAvail, availMap)) return null
      if (overlaps(svc.staffId)) return null
      assignment[svc.id] = svc.staffId
    } else {
      // Prefer already-assigned professionals (same pro can do sequential services).
      // Among those free and available, pick one.
      const assignedValues = Object.values(assignment)
      const preferred = assignedValues.find(
        (pid) => proWorksAtSlot(pid, dayOfWeek, sStart, sEnd, staffHasAvail, availMap) && !overlaps(pid)
      )
      const free = preferred ?? allPros.find(
        (pid) => proWorksAtSlot(pid, dayOfWeek, sStart, sEnd, staffHasAvail, availMap) && !overlaps(pid)
      )
      if (!free) return null
      assignment[svc.id] = free
    }
    ms = sEnd
  }
  return assignment
}

function trySlot(
  slot: string,
  dateStr: string,
  services: ServiceInput[],
  appts: Appt[],
  allPros: string[],
  dayOfWeek: number,
  staffHasAvail: Set<string>,
  availMap: AvailMap,
  isValidOrder: (perm: number[]) => boolean = () => true
): SlotResult | null {
  const startMs = slotToUtcMs(dateStr, slot)

  for (const perm of permutations(services.map((_, i) => i))) {
    if (!isValidOrder(perm)) continue
    const assignment = checkPerm(startMs, perm, services, appts, allPros, dayOfWeek, staffHasAvail, availMap)
    if (assignment) {
      return {
        date: dateStr,
        time: slot,
        serviceOrder: perm.map((i) => services[i].id),
        resolvedStaff: assignment,
      }
    }
  }
  return null
}

export async function fetchSequentialAvailability(
  services: ServiceInput[],
  fromDate: string,
  daysAhead = 30
): Promise<SequentialAvailabilityResult> {
  const empty: SequentialAvailabilityResult = {
    slotsForDate: [],
    nextAvailable: [],
    hasSequentialToday: false,
    individualSlotsForDate: [],
  }
  if (!services.length) return empty

  const supabase = adminClient()

  const serviceIds = services.map((s) => s.id)

  const [bhRes, prosRes, rulesRes, availRes] = await Promise.all([
    supabase.from("business_hours").select("day_of_week, is_open, slots").order("day_of_week"),
    supabase.from("staff").select("id").eq("is_professional", true).eq("active", true),
    supabase
      .from("service_order_rules")
      .select("service_first_id, service_second_id")
      .in("service_first_id", serviceIds)
      .in("service_second_id", serviceIds),
    supabase.from("staff_availability").select("staff_id, day_of_week, from_time, to_time"),
  ])

  const byDow = new Map(
    ((bhRes.data ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[]).map(
      (h) => [h.day_of_week, h]
    )
  )
  const allPros = ((prosRes.data ?? []) as { id: string }[]).map((p) => p.id)

  const seqAvailRows = (availRes.data ?? []) as { staff_id: string; day_of_week: number; from_time: string; to_time: string }[]
  const seqStaffHasAvail = new Set(seqAvailRows.map((r) => r.staff_id))
  const seqAvailMap: AvailMap = new Map(
    seqAvailRows.map((r) => [`${r.staff_id}|${r.day_of_week}`, { from_time: r.from_time, to_time: r.to_time }])
  )

  // Set of "first_id|second_id" — first must go before second
  const orderRules = new Set<string>(
    ((rulesRes.data ?? []) as { service_first_id: string; service_second_id: string }[]).map(
      (r) => `${r.service_first_id}|${r.service_second_id}`
    )
  )

  // Filter permutations that violate order rules
  const isValidOrder = (perm: number[]): boolean => {
    for (let i = 0; i < perm.length; i++) {
      for (let j = i + 1; j < perm.length; j++) {
        const a = services[perm[i]].id
        const b = services[perm[j]].id
        // If rule says b must come before a, this ordering is invalid
        if (orderRules.has(`${b}|${a}`)) return false
      }
    }
    return true
  }

  const [fy, fm, fd] = fromDate.split("-").map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd, AR_UTC_OFFSET, 0, 0)
  const from = new Date(fromMs)
  const to = new Date(fromMs + daysAhead * 24 * 3_600_000)

  const { data: apptData } = await supabase
    .from("appointments")
    .select("starts_at, duration_min, staff_id")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .in("status", ["pending", "confirmed"])
  const allAppts = (apptData ?? []) as Appt[]

  const slotsForDate: SlotResult[] = []
  const nextAvailable: SlotResult[] = []
  const now = new Date()

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(fromDate + "T00:00:00")
    d.setDate(d.getDate() + i)
    const dateStr = ymd(d)
    const dayOfWeek = d.getDay()

    const bh = byDow.get(dayOfWeek)
    if (!bh || !bh.is_open || !bh.slots.length) continue

    const candidates = i === 0
      ? filterFutureSlots(dateStr, bh.slots, now)
      : [...bh.slots]

    const dayAppts = allAppts.filter((a) => a.starts_at.slice(0, 10) === dateStr)

    for (const slot of candidates) {
      const result = trySlot(slot, dateStr, services, dayAppts, allPros, dayOfWeek, seqStaffHasAvail, seqAvailMap, isValidOrder)
      if (!result) continue
      if (i === 0) {
        slotsForDate.push(result)
      } else {
        nextAvailable.push(result)
        if (nextAvailable.length >= 5) break
      }
    }
    if (i > 0 && nextAvailable.length >= 5) break
  }

  // Individual slots per service when no sequential slots today
  const individualSlotsForDate: SequentialAvailabilityResult["individualSlotsForDate"] = []
  if (!slotsForDate.length) {
    const todayDow = new Date(fromDate + "T00:00:00").getDay()
    const todayBh = byDow.get(todayDow)
    if (todayBh?.is_open && todayBh.slots.length) {
      const candidates = filterFutureSlots(fromDate, todayBh.slots, now)
      const dayAppts = allAppts.filter((a) => a.starts_at.slice(0, 10) === fromDate)

      for (const svc of services) {
        const slots = candidates.filter((slot) => {
          const sStart = slotToUtcMs(fromDate, slot)
          const sEnd = sStart + svc.duration * 60_000
          if (svc.staffId === "auto") {
            // Available if at least one pro is free AND available today
            return allPros.some(
              (pid) =>
                proWorksAtSlot(pid, todayDow, sStart, sEnd, seqStaffHasAvail, seqAvailMap) &&
                !dayAppts.some((a) => {
                  if (a.staff_id !== pid) return false
                  const aS = new Date(a.starts_at).getTime()
                  return sStart < aS + a.duration_min * 60_000 && sEnd > aS
                })
            )
          }
          if (!proWorksAtSlot(svc.staffId, todayDow, sStart, sEnd, seqStaffHasAvail, seqAvailMap)) return false
          return !dayAppts.some((a) => {
            if (a.staff_id !== svc.staffId) return false
            const aS = new Date(a.starts_at).getTime()
            return sStart < aS + a.duration_min * 60_000 && sEnd > aS
          })
        })
        individualSlotsForDate.push({ serviceId: svc.id, serviceName: svc.name, slots })
      }
    }
  }

  return { slotsForDate, nextAvailable, hasSequentialToday: slotsForDate.length > 0, individualSlotsForDate }
}

export async function joinWaitlist(data: {
  name: string
  email: string
  phone: string
  serviceNames: string[]
  preferredDates?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!data.name.trim() || !data.email.trim() || !data.phone.trim()) {
    return { ok: false, error: "Nombre, email y teléfono son obligatorios." }
  }
  const supabase = adminClient()
  const { error } = await supabase.from("waitlist_entries").insert({
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    phone: data.phone.trim(),
    service_names: data.serviceNames,
    preferred_dates: data.preferredDates?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Parses "DD / MM / AAAA" or "DD/MM/YYYY" or ISO; returns ISO date or null.
function parseDob(raw: string): string | null {
  const cleaned = raw.replace(/\s/g, "")
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10)
  return null
}
