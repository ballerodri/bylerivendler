"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

const BookingInput = z.object({
  serviceIds: z.array(z.string().uuid()).min(1),
  startsAt: z.string().datetime(),
  proHint: z.string(),
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
    .select("id, name, duration_min, price_cents")
    .in("id", input.serviceIds)

  if (svcErr) return { ok: false, error: `Servicios: ${svcErr.message}` }
  if (!services || services.length !== input.serviceIds.length) {
    return { ok: false, error: "Algún servicio ya no está disponible." }
  }

  const totalDuration = services.reduce((a, s) => a + s.duration_min, 0)
  const totalCents = services.reduce((a, s) => a + s.price_cents, 0)
  const depositCents = Math.round(totalCents * 0.3)
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000)

  // 2) Find or create client (by email)
  const email = input.client.email.trim().toLowerCase()
  const { data: existing, error: findErr } = await supabase
    .from("clients")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  if (findErr) return { ok: false, error: `Clientes: ${findErr.message}` }

  let clientId: string
  if (existing) {
    clientId = existing.id
  } else {
    const dob = parseDob(input.client.dob)
    const { data: created, error: insErr } = await supabase
      .from("clients")
      .insert({
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
  }

  // 3) Insert medical record if first-time client and form provided
  if (input.medical && !input.client.isExisting) {
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

  // 5) Create appointment
  const { data: appt, error: apptErr } = await supabase
    .from("appointments")
    .insert({
      client_id: clientId,
      staff_id: null, // auto-asignación; el equipo asigna luego
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: totalDuration,
      total_cents: totalCents,
      deposit_cents: depositCents,
      deposit_paid: false,
      status: "pending",
      source: "web",
    })
    .select("id")
    .single()

  if (apptErr || !appt)
    return { ok: false, error: `Turno: ${apptErr?.message}` }

  // 6) Link services to appointment
  const apptServices = services.map((s) => ({
    appointment_id: appt.id,
    service_id: s.id,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
  }))

  const { error: linkErr } = await supabase
    .from("appointment_services")
    .insert(apptServices)

  if (linkErr) return { ok: false, error: `Servicios del turno: ${linkErr.message}` }

  // 7) Send magic link so the clienta gets her portal access automatically.
  // Use a plain (non-SSR) client to avoid touching the current request's
  // session cookies. Non-fatal: a failure here doesn't undo the booking.
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
    // ignore — booking is saved; staff can resend the link later.
  }

  return { ok: true, appointmentId: appt.id }
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
