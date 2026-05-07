import { redirect } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import LogoutButton from "@/app/portal/logout-button"
import "./admin.css"

type StaffRow = {
  id: string
  full_name: string
  role: string
  email: string | null
}

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/admin")

  const allowed = await isStaffUser(user.id)
  if (!allowed) redirect("/portal")

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data: staffRow } = await admin
    .from("staff")
    .select("id, full_name, role, email")
    .eq("user_id", user.id)
    .maybeSingle<StaffRow>()

  const isProfessionalOnly = staffRow?.role === "professional"

  return (
    <div className="admin">
      <div className="adm-shell">
        <aside className="adm-side">
          <Link href="/admin" className="adm-side__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo-crop.png" alt="By Leri Vendler" />
          </Link>

          <nav className="adm-nav">
            <Link href="/admin" className="adm-nav__item">
              Hoy
            </Link>
            <Link href="/admin/turnos" className="adm-nav__item">
              Turnos
            </Link>
            {isProfessionalOnly ? (
              <>
                <Link href="/admin/estadisticas" className="adm-nav__item">
                  Estadísticas
                </Link>
                <Link href={`/admin/staff/${staffRow!.id}`} className="adm-nav__item">
                  Mi disponibilidad
                </Link>
              </>
            ) : (
              <>
                <Link href="/admin/nueva-reserva" className="adm-nav__item">
                  Nueva reserva
                </Link>
                <Link href="/admin/clientas" className="adm-nav__item">
                  Clientas
                </Link>
                <Link href="/admin/servicios" className="adm-nav__item">
                  Servicios
                </Link>
                <Link href="/admin/staff" className="adm-nav__item">
                  Personal
                </Link>
                <Link href="/admin/horarios" className="adm-nav__item">
                  Horarios
                </Link>
                <Link href="/admin/estadisticas" className="adm-nav__item">
                  Estadísticas
                </Link>
                <Link href="/admin/espera" className="adm-nav__item">
                  Lista de espera
                </Link>
              </>
            )}
          </nav>

          <div className="adm-side__user">
            <strong>{staffRow?.full_name ?? user.email}</strong>
            <span style={{ display: "block", marginBottom: 8 }}>
              {staffRow?.role ?? ""}
            </span>
            <LogoutButton />
          </div>
        </aside>

        <main className="adm-main">{children}</main>
      </div>
    </div>
  )
}
