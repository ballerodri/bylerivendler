import "server-only"
import { createClient as createAdminClient } from "@supabase/supabase-js"

/**
 * Email "bootstrap" de la primera admin (Leri). Solo se usa una vez,
 * en su primer login, para crearle el row inicial en `staff`. Después de
 * eso, la tabla `staff` es la única fuente de verdad para los permisos.
 */
function initialAdminEmails(): string[] {
  const raw = process.env.INITIAL_ADMIN_EMAIL ?? ""
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export type StaffProfile = {
  id: string
  full_name: string
  role: string
  isProfessionalOnly: boolean // true si es professional y no admin/reception
}

/**
 * Devuelve el perfil de staff del usuario, o null si no es staff activo.
 */
export async function getStaffProfile(userId: string): Promise<StaffProfile | null> {
  const admin = adminClient()
  const { data } = await admin
    .from("staff")
    .select("id, full_name, role, active")
    .eq("user_id", userId)
    .maybeSingle()
  if (!data?.active) return null
  return {
    id: data.id,
    full_name: data.full_name,
    role: data.role,
    isProfessionalOnly: data.role === "professional",
  }
}

/**
 * ¿El user actual es staff activo? Consulta la tabla, no el env var.
 * Usar después de tener una sesión autenticada.
 */
export async function isStaffUser(userId: string): Promise<boolean> {
  const admin = adminClient()
  const { data } = await admin
    .from("staff")
    .select("id, active")
    .eq("user_id", userId)
    .maybeSingle()
  return !!data?.active
}

/**
 * Llamado en el callback de auth. Estrategia:
 *   1) Si el user ya tiene un row staff con su user_id → nada que hacer.
 *   2) Si existe un row staff con el mismo email pero sin user_id → reclamarlo.
 *   3) Si el email está en INITIAL_ADMIN_EMAIL (bootstrap) → crear nuevo row admin.
 *   4) Sino → no es staff (no hace nada).
 */
export async function ensureStaffLink(
  userId: string,
  email: string | null | undefined
): Promise<{ isStaff: boolean }> {
  if (!email) return { isStaff: false }
  const admin = adminClient()
  const lower = email.toLowerCase()

  // 1. ¿Ya está linkeado?
  const { data: linked } = await admin
    .from("staff")
    .select("id, active")
    .eq("user_id", userId)
    .maybeSingle()
  if (linked) return { isStaff: !!linked.active }

  // 2. ¿Existe un row con su email sin user_id?
  const { data: byEmail } = await admin
    .from("staff")
    .select("id, active")
    .ilike("email", lower)
    .is("user_id", null)
    .maybeSingle()
  if (byEmail) {
    await admin
      .from("staff")
      .update({ user_id: userId, active: true })
      .eq("id", byEmail.id)
    return { isStaff: true }
  }

  // 3. Bootstrap inicial vía env var.
  if (initialAdminEmails().includes(lower)) {
    await admin.from("staff").insert({
      user_id: userId,
      email: lower,
      full_name: lower.split("@")[0],
      role: "admin",
      active: true,
    })
    return { isStaff: true }
  }

  // 4. Cliente normal, no staff.
  return { isStaff: false }
}
