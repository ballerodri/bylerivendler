import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { ensureStaffLink } from "@/lib/staff"

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

  let isStaff = false
  if (userId && userEmail) {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    // Link existing client (created via the booking flow) to this auth user.
    await admin
      .from("clients")
      .update({ user_id: userId })
      .eq("email", userEmail.toLowerCase())
      .is("user_id", null)

    // Bootstrap staff row si corresponde y reportar si es staff.
    const result = await ensureStaffLink(userId, userEmail)
    isStaff = result.isStaff
  }

  // Routing post-login:
  //   - Staff: respeta cualquier ruta /admin/* explícita; sino va a /admin.
  //   - No staff: si intentaron /admin (no permitido) los mandamos a /portal;
  //     sino respeta el next.
  const finalNext = isStaff
    ? next.startsWith("/admin")
      ? next
      : "/admin"
    : next.startsWith("/admin")
      ? "/portal"
      : next

  return NextResponse.redirect(`${origin}${finalNext}`)
}
