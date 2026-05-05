import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type")
  const rawNext = url.searchParams.get("next") ?? "/portal"
  // Only allow same-origin paths to avoid open-redirects
  const next = rawNext.startsWith("/") ? rawNext : "/portal"
  const origin = url.origin

  const supabase = await createClient()

  let userId: string | null = null
  let userEmail: string | null = null

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=invalid_code`)
    }
    userId = data.user?.id ?? null
    userEmail = data.user?.email ?? null
  } else if (tokenHash && type) {
    // Older email-link flow (token_hash + type)
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "magiclink" | "signup" | "invite" | "recovery" | "email_change",
    })
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=invalid_code`)
    }
    userId = data.user?.id ?? null
    userEmail = data.user?.email ?? null
  } else {
    return NextResponse.redirect(`${origin}/login?error=invalid_code`)
  }

  // Link an existing client (created via the booking flow) to this auth user
  // by matching the email.
  if (userId && userEmail) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    await admin
      .from("clients")
      .update({ user_id: userId })
      .eq("email", userEmail.toLowerCase())
      .is("user_id", null)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
