"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingConfirmation } from "@/lib/email/booking-emails"

const BookingInput = z.object({
  serviceIds: z.array(z.string().uuid()).min(1),
  startsAt: z.string().datetime(),
  proHint: z.string(),
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

  // 5) Create appointment
  const { data: appt, error: apptErr } = await supabase
    .from("appointments")
    .insert({
      client_id: clientId,
      staff_id: input.proHint !== "auto" ? input.proHint : null,
      room_id: room?.id ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      duration_min: totalDuration,
      total_cents: redeem ? 0 : totalCents,
      deposit_cents: redeem ? 0 : depositCents,
      deposit_paid: redeem, // canje = ya cubierto, sin seña pendiente
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
