import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildAuthUrl } from "@/lib/google-oauth"
import { isStaffUser } from "@/lib/staff"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL!))

  const allowed = await isStaffUser(user.id)
  if (!allowed) return NextResponse.redirect(new URL("/admin", process.env.NEXT_PUBLIC_APP_URL!))

  const url = buildAuthUrl(user.id)
  return NextResponse.redirect(url)
}
