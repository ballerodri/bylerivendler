import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { ArcaEnv } from "./config"

export interface StoredToken {
  token: string
  sign: string
  expiresAt: Date
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function getStoredToken(
  service: string,
  env: ArcaEnv
): Promise<StoredToken | null> {
  const { data } = await admin()
    .from("arca_tokens")
    .select("token, sign, expires_at")
    .eq("service", service)
    .eq("environment", env)
    .maybeSingle()
  if (!data) return null
  return { token: data.token, sign: data.sign, expiresAt: new Date(data.expires_at) }
}

export async function saveToken(
  service: string,
  env: ArcaEnv,
  t: StoredToken
): Promise<void> {
  const { error } = await admin()
    .from("arca_tokens")
    .upsert({
      service,
      environment: env,
      token: t.token,
      sign: t.sign,
      expires_at: t.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(`No se pudo guardar el token ARCA: ${error.message}`)
}
