import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { cumplesDeHoy, type ClientaConCumple } from "@/lib/servicios/birthdays"
import { sendBirthdayAlert } from "@/lib/email/birthday-emails"

export const dynamic = "force-dynamic"

// Vercel sends "Authorization: Bearer <CRON_SECRET>" when triggering cron jobs.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const auth = req.headers.get("authorization") ?? ""
  return auth === `Bearer ${expected}`
}

// Corre una vez por día, 12:00 UTC (09:00 Buenos Aires), igual que el cron de
// recordatorios: un solo mail al equipo con TODAS las clientas que cumplen
// años hoy, para que las saluden por WhatsApp. Si hoy no cumple nadie, no
// manda nada.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // El "hoy" ARGENTINO: a las 12:00 UTC en Buenos Aires todavía es la mañana
  // del mismo día, pero la fecha se calcula en su zona igual, por las dudas.
  const { dateStr } = arPartsFromUtc(new Date())

  // date_of_birth es una columna date ("YYYY-MM-DD"); el filtro por mes/día
  // (con el caso 29/02) es del módulo compartido con el panel.
  const { data: clientRows, error } = await admin
    .from("clients")
    .select("id, first_name, last_name, phone, date_of_birth")
    .not("date_of_birth", "is", null)
  if (error) {
    console.error("[cron/birthdays] query error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const cumpleaneras = cumplesDeHoy((clientRows ?? []) as ClientaConCumple[], dateStr)
  if (!cumpleaneras.length) {
    return NextResponse.json({ sent: 0, birthdays: 0 })
  }

  // Mismos destinatarios que el aviso de nueva reserva: admins/recepción
  // activos que eligieron recibir avisos en Admin → Personal.
  const { data: adminRows } = await admin
    .from("staff")
    .select("email")
    .in("role", ["admin", "reception"])
    .eq("active", true)
    .eq("notify_bookings", true)
    .not("email", "is", null)
  const to = [...new Set(
    ((adminRows ?? []) as { email: string | null }[])
      .map((r) => r.email)
      .filter((e): e is string => !!e)
  )]
  if (!to.length) {
    console.error("[cron/birthdays] sin destinatarios (ningún admin con avisos activados)")
    return NextResponse.json({ sent: 0, birthdays: cumpleaneras.length, error: "sin destinatarios" })
  }

  const result = await sendBirthdayAlert({ to, cumpleaneras })
  if (!result.ok) {
    console.error("[cron/birthdays] email failed:", result.error)
    return NextResponse.json({ sent: 0, birthdays: cumpleaneras.length, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ sent: to.length, birthdays: cumpleaneras.length })
}
