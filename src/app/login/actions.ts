"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const Input = z.object({
  email: z.string().email(),
  next: z.string().optional(),
})

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: string }

async function getOrigin() {
  const h = await headers()
  const proto = h.get("x-forwarded-proto") ?? "http"
  const host = h.get("host")
  return `${proto}://${host}`
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
