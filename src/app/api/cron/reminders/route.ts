import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sendBookingReminder } from "@/lib/email/booking-emails"
import { sendWhatsAppMessage } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

// Vercel sends "Authorization: Bearer <CRON_SECRET>" when triggering cron jobs.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const auth = req.headers.get("authorization") ?? ""
  return auth === `Bearer ${expected}`
}

type ApptRow = {
  id: string
  starts_at: string
  duration_min: number
  total_cents: number
  client: { email: string; first_name: string | null; phone: string | null } | null
  appointment_services: { service: { name: string } | null }[]
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // Cron runs once daily at 09:00 UTC (06:00 Buenos Aires).
  // Window: 18h–42h from now → catches every appointment in the next day,
  // regardless of time. reminder_sent_at IS NULL prevents duplicates.
  const now = new Date()
  const windowStart = new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 42 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from("appointments")
    .select(
      `id, starts_at, duration_min, total_cents,
       client:clients(email, first_name, phone),
       appointment_services(service:services(name))`
    )
    .gte("starts_at", windowStart)
    .lte("starts_at", windowEnd)
    .in("status", ["pending", "confirmed"])
    .is("reminder_sent_at", null)

  if (error) {
    console.error("[cron/reminders] query error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const appts = (data ?? []) as unknown as ApptRow[]
  let sent = 0
  let failed = 0
  let waSent = 0

  for (const a of appts) {
    if (!a.client) continue

    const services = a.appointment_services
      .map((as) => as.service?.name)
      .filter((n): n is string => Boolean(n))

    const startsAt = new Date(a.starts_at)
    const dateStr = startsAt.toLocaleString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    })

    // Email reminder
    const emailResult = await sendBookingReminder({
      to: a.client.email,
      firstName: a.client.first_name ?? "",
      servicesNames: services,
      startsAt,
      durationMin: a.duration_min,
      totalCents: a.total_cents,
      appointmentId: a.id,
    })

    // WhatsApp reminder (non-blocking; skip if no phone or Twilio not configured)
    if (a.client.phone) {
      const waBody =
        `¡Hola${a.client.first_name ? `, ${a.client.first_name}` : ""}! 👋\n\n` +
        `Te recordamos tu turno en *By Leri Vendler* 🌸\n\n` +
        `📅 *${dateStr}*\n` +
        (services.length > 0 ? `💆‍♀️ ${services.join(" + ")}\n` : "") +
        `\n📍 Podés ver los detalles en bylerivendler.com/portal\n\n` +
        `Si necesitás reprogramar, escribinos con al menos 24 hs de anticipación. ¡Te esperamos! ✨`

      const waResult = await sendWhatsAppMessage(a.client.phone, waBody)
      if (waResult.ok) waSent++
      else console.error(`[cron/reminders] WhatsApp failed for ${a.id}:`, waResult.error)
    }

    // Mark as reminded regardless of email/WA success, to avoid retrying on next run.
    await admin
      .from("appointments")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", a.id)

    if (emailResult.ok) sent++
    else {
      console.error(`[cron/reminders] email failed for ${a.id}:`, emailResult.error)
      failed++
    }
  }

  return NextResponse.json({ sent, failed, waSent, total: appts.length })
}
