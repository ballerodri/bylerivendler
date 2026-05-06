"use server"

import { headers, cookies } from "next/headers"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const Input = z.object({
  email: z.string().email(),
  next: z.string().optional(),
})

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: string }

export type GoogleSignInResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

async function getOrigin() {
  const h = await headers()
  const proto = h.get("x-forwarded-proto") ?? "http"
  const host = h.get("host")
  return `${proto}://${host}`
}

export async function signInWithGoogle(
  next?: string
): Promise<GoogleSignInResult> {
  const supabase = await createClient()
  const origin = await getOrigin()
  const safeNext = next && next.startsWith("/") ? next : null

  // Guardamos el destino en una cookie en lugar de en el redirectTo,
  // porque Supabase rechaza URLs con query params en la lista de permitidos.
  if (safeNext) {
    const cookieStore = await cookies()
    cookieStore.set("auth_next", safeNext, {
      path: "/",
      maxAge: 300,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    })
  }

  const callback = `${origin}/auth/callback`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback,
      // Pedir que aparezca el selector de cuenta cada vez (UX más clara
      // si la persona tiene varias cuentas Google logueadas).
      queryParams: { prompt: "select_account" },
    },
  })

  if (error || !data.url) {
    return { ok: false, error: error?.message ?? "No pudimos iniciar sesión con Google" }
  }
  return { ok: true, url: data.url }
}

export async function sendMagicLink(
  raw: { email: string; next?: string }
): Promise<SendMagicLinkResult> {
  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "Email inválido." }

  const supabase = await createClient()
  const origin = await getOrigin()
  const next = parsed.data.next ?? "/portal"
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email.trim().toLowerCase(),
    options: {
      emailRedirectTo: callbackUrl,
      shouldCreateUser: true,
    },
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
