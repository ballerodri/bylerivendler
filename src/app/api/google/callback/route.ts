import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exchangeCode } from "@/lib/google-oauth"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get("code")
  const error = searchParams.get("error")

  if (error || !code) {
    return NextResponse.redirect(`${APP_URL}/admin/configuracion?google=denied`)
  }

  try {
    const tokens = await exchangeCode(code)

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${APP_URL}/admin/configuracion?google=error`)
    }

    let googleEmail: string | null = null
    if (tokens.id_token) {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64").toString()
      )
      googleEmail = payload.email ?? null
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    await admin
      .from("google_calendar_config")
      .update({
        refresh_token: tokens.refresh_token,
        google_email: googleEmail,
        connected_at: new Date().toISOString(),
      })
      .eq("id", 1)

    return NextResponse.redirect(`${APP_URL}/admin/configuracion?google=connected`)
  } catch {
    return NextResponse.redirect(`${APP_URL}/admin/configuracion?google=error`)
  }
}
