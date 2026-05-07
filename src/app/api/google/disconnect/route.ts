import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function POST() {
  const supabase = await createSsrClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const allowed = await isStaffUser(user.id)
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  await admin
    .from("google_calendar_config")
    .update({ refresh_token: null, google_email: null, connected_at: null })
    .eq("id", 1)

  return NextResponse.redirect(`${APP_URL}/admin/configuracion?google=disconnected`)
}
