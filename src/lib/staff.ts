import "server-only"
import { redirect } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"

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
 * Redirige a /admin si el usuario es profesional puro (role !== admin/reception).
 * Llamar al inicio de páginas que solo admins pueden ver.
 */
export async function requireAdmin(userId: string): Promise<void> {
  const admin = adminClient()
  const { data } = await admin
    .from("staff")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle()
  if (data?.role === "professional") redirect("/admin")
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
 * ¿Hay en ESTE request una sesión de staff activo? Mismo criterio que el
 * `requireStaff` privado de `admin/actions.ts` (usuario de la sesión SSR +
 * `isStaffUser`), pero devuelve un booleano en vez de lanzar: sirve para
 * proteger una server action PÚBLICA (`createBooking` en modo admin) sin
 * convertir un "no sos staff" en un error 500.
 *
 * FAIL-CLOSED, y esto es lo importante: sin sesión, sin usuario, con la sesión
 * vencida o ante CUALQUIER error (cookies rotas, Supabase caído, la consulta a
 * `staff` que falla) devuelve `false`. Nunca lanza. La ÚNICA forma de que
 * devuelva `true` es que haya un usuario autenticado con una fila `staff`
 * activa — nada que pueda mandar quien llama influye en la respuesta.
 */
export async function isActiveStaffSession(): Promise<boolean> {
  try {
    const supabase = await createSsrClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user) return false
    return await isStaffUser(data.user.id)
  } catch {
    return false
  }
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
