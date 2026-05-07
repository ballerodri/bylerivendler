import { NextRequest, NextResponse } from "next/server"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { isStaffUser } from "@/lib/staff"

const TZ = "America/Argentina/Buenos_Aires"

export async function GET(req: NextRequest) {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const since = req.nextUrl.searchParams.get("since")

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  // New bookings since the given timestamp
  let newBookings: { id: string; clientName: string; serviceName: string; startsAt: string }[] = []
  if (since) {
    const { data } = await admin
      .from("appointments")
      .select(`
        id, starts_at, created_at,
        client:clients(first_name, last_name),
        appointment_services(service:services(name))
      `)
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20)

    newBookings = (data ?? []).map((a: any) => ({
      id: a.id,
      clientName: a.client ? `${a.client.first_name} ${a.client.last_name}` : "Cliente",
      serviceName: a.appointment_services?.[0]?.service?.name ?? "Turno",
      startsAt: a.starts_at,
    }))
  }

  // Today's pending/confirmed appointments (WhatsApp badge)
  const now = new Date()
  const arNow = new Date(now.toLocaleString("en-US", { timeZone: TZ }))
  const arStart = new Date(Date.UTC(arNow.getFullYear(), arNow.getMonth(), arNow.getDate(), 3, 0, 0))
  const arEnd = new Date(arStart.getTime() + 24 * 3_600_000)

  const { count } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .gte("starts_at", arStart.toISOString())
    .lt("starts_at", arEnd.toISOString())
    .in("status", ["pending", "confirmed"])

  return NextResponse.json({
    newBookings,
    todayPending: count ?? 0,
  })
}
