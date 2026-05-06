"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingConfirmation } from "@/lib/email/booking-emails"
import { ymd, filterFutureSlots } from "./data"

const BookingInput = z.object({
  serviceIds: z.array(z.string().uuid()).min(1),
  startsAt: z.string().datetime(),
  proHint: z.string(),
  // Multi-professional sequential support
  serviceOrder: z.array(z.string().uuid()).optional(),
  resolvedStaff: z.record(z.string(), z.string()).optional(),
  redeemWithPoints: z.boolean().optional(),
  savedClientId: z.string().uuid().optional(),
  client: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    dob: z.string().min(1),
    marketingConsent: z.boolean(),
    isExisting: z.boolean(),
  }),
  medical: z
    .object({
      allergies: z.array(z.string()),
      allergiesOther: z.string(),
      meds: z.enum(["no", "si"]),
      medsNote: z.string(),
      pregnancy: z.enum(["no", "embarazo", "lactancia"]),
      skin: z.array(z.string()),
      consent: z.boolean(),
    })
    .nullable(),
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
    .select("id, name, duration_min, price_cents, points_cost")
    .in("id", input.serviceIds)

  if (svcErr) return { ok: false, error: `Servicios: ${svcErr.message}` }
  if (!services || services.length !== input.serviceIds.length) {
    return { ok: false, error: "Algún servicio ya no está disponible." }
  }

  const totalDuration = services.reduce((a, s) => a + s.duration_min, 0)
  const totalCents = services.reduce((a, s) => a + s.price_cents, 0)
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

  // 3) Insert medical record — saltear si ya fue guardada por saveMedicalEarly.
  if (!input.savedClientId && input.medical && !input.client.isExisting) {
    const { error: medErr } = await supabase.from("client_records").insert({
      client_id: clientId,
      version: 1,
      is_current: true,
      allergies: input.medical.allergies,
      allergies_other: input.medical.allergiesOther || null,
      medications_status: input.medical.meds,
      medications_note: input.medical.medsNote || null,
      pregnancy: input.medical.pregnancy,
      skin_conditions: input.medical.skin,
    })
    // Non-fatal: a duplicate record (already had one) shouldn't block the booking.
    if (medErr && !medErr.message.includes("duplicate"))
      return { ok: false, error: `Ficha clínica: ${medErr.message}` }
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
      notes_internal: redeem
        ? `Canjeado con ${totalPointsCost} pts del Programa Cerca`
        : null,
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
    const sStartsAt = new Date(serviceMs)
    serviceMs += s.duration_min * 60_000
    return {
      appointment_id: appt.id,
      service_id: s.id,
      duration_min: s.duration_min,
      price_cents: s.price_cents,
      staff_id: input.resolvedStaff?.[s.id] ?? mainStaffId,
      starts_at: sStartsAt.toISOString(),
    }
  })

  const { error: linkErr } = await supabase
    .from("appointment_services")
    .insert(apptServices)

  if (linkErr) return { ok: false, error: `Servicios del turno: ${linkErr.message}` }

  // 7) Email de confirmación con los detalles del turno (no bloqueante).
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

export async function saveMedicalEarly(
  clientId: string,
  medical: {
    allergies: string[]
    allergiesOther: string
    meds: "no" | "si"
    medsNote: string
    pregnancy: "no" | "embarazo" | "lactancia"
    skin: string[]
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = adminClient()

  const { data: existing } = await supabase
    .from("client_records")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_current", true)
    .maybeSingle()

  if (existing) return { ok: true }

  const { error } = await supabase.from("client_records").insert({
    client_id: clientId,
    version: 1,
    is_current: true,
    allergies: medical.allergies,
    allergies_other: medical.allergiesOther || null,
    medications_status: medical.meds,
    medications_note: medical.medsNote || null,
    pregnancy: medical.pregnancy,
    skin_conditions: medical.skin,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
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

  const dayStart = new Date(dateStr + "T00:00:00").toISOString()
  const dayEnd   = new Date(dateStr + "T23:59:59").toISOString()

  let apptQuery = supabase
    .from("appointments")
    .select("starts_at, duration_min, staff_id")
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .in("status", ["pending", "confirmed"])

  if (proHint !== "auto") {
    apptQuery = apptQuery.eq("staff_id", proHint)
  }

  const { data: appointments } = await apptQuery
  if (!appointments?.length) return candidateSlots

  // For "auto": how many active professionals exist in total
  let totalPros = 1
  if (proHint === "auto") {
    const { count } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("is_professional", true)
      .eq("active", true)
    totalPros = count ?? 1
  }

  return candidateSlots.filter((slot) => {
    const [hh, mm] = slot.split(":").map(Number)
    const slotDate = new Date(dateStr + "T00:00:00")
    slotDate.setHours(hh, mm, 0, 0)
    const slotStart = slotDate.getTime()
    const slotEnd   = slotStart + durationMin * 60_000

    if (proHint === "auto") {
      // Count distinct busy professionals in this window.
      // Appointments without staff_id (auto-assigned) count as 1 anonymous slot.
      const busyIds = new Set<string>()
      let anonymousBusy = 0
      for (const appt of appointments) {
        const aStart = new Date(appt.starts_at).getTime()
        const aEnd   = aStart + (appt.duration_min as number) * 60_000
        if (slotStart >= aEnd || slotEnd <= aStart) continue // no overlap
        if (appt.staff_id) busyIds.add(appt.staff_id as string)
        else anonymousBusy++
      }
      return busyIds.size + anonymousBusy < totalPros
    } else {
      return !appointments.some((appt) => {
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

function checkPerm(
  startMs: number,
  perm: number[],
  services: ServiceInput[],
  appts: Appt[],
  allPros: string[]
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
      if (overlaps(svc.staffId)) return null
      assignment[svc.id] = svc.staffId
    } else {
      // Prefer already-assigned professionals (same pro can do sequential services).
      // Among those free, pick any available one.
      const assignedValues = Object.values(assignment)
      const preferred = assignedValues.find((pid) => !overlaps(pid))
      const free = preferred ?? allPros.find((pid) => !overlaps(pid))
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
  allPros: string[]
): SlotResult | null {
  const [hh, mm] = slot.split(":").map(Number)
  const base = new Date(dateStr + "T00:00:00")
  base.setHours(hh, mm, 0, 0)
  const startMs = base.getTime()

  for (const perm of permutations(services.map((_, i) => i))) {
    const assignment = checkPerm(startMs, perm, services, appts, allPros)
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

  const [bhRes, prosRes] = await Promise.all([
    supabase.from("business_hours").select("day_of_week, is_open, slots").order("day_of_week"),
    supabase.from("staff").select("id").eq("is_professional", true).eq("active", true),
  ])

  const byDow = new Map(
    ((bhRes.data ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[]).map(
      (h) => [h.day_of_week, h]
    )
  )
  const allPros = ((prosRes.data ?? []) as { id: string }[]).map((p) => p.id)

  const from = new Date(fromDate + "T00:00:00")
  const to = new Date(fromDate + "T00:00:00")
  to.setDate(to.getDate() + daysAhead)

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

    const bh = byDow.get(d.getDay())
    if (!bh || !bh.is_open || !bh.slots.length) continue

    const candidates = i === 0
      ? filterFutureSlots(dateStr, bh.slots, now)
      : [...bh.slots]

    const dayAppts = allAppts.filter((a) => a.starts_at.slice(0, 10) === dateStr)

    for (const slot of candidates) {
      const result = trySlot(slot, dateStr, services, dayAppts, allPros)
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
    const todayBh = byDow.get(new Date(fromDate + "T00:00:00").getDay())
    if (todayBh?.is_open && todayBh.slots.length) {
      const candidates = filterFutureSlots(fromDate, todayBh.slots, now)
      const dayAppts = allAppts.filter((a) => a.starts_at.slice(0, 10) === fromDate)

      for (const svc of services) {
        const slots = candidates.filter((slot) => {
          const [hh, mm] = slot.split(":").map(Number)
          const base = new Date(fromDate + "T00:00:00")
          base.setHours(hh, mm, 0, 0)
          const sStart = base.getTime()
          const sEnd = sStart + svc.duration * 60_000
          if (svc.staffId === "auto") {
            // Available if at least one pro is free
            return allPros.some(
              (pid) => !dayAppts.some((a) => {
                if (a.staff_id !== pid) return false
                const aS = new Date(a.starts_at).getTime()
                return sStart < aS + a.duration_min * 60_000 && sEnd > aS
              })
            )
          }
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
