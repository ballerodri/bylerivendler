import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import StaffForm from "./staff-form"
import StaffActiveToggle from "./active-toggle"
import StaffDeleteButton from "./delete-button"

export const dynamic = "force-dynamic"

type StaffRow = {
  id: string
  user_id: string | null
  full_name: string
  role: string
  email: string | null
  active: boolean
  is_professional: boolean
  created_at: string
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  professional: "Profesional",
  reception: "Recepción",
}

export default async function AdminStaffPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("staff")
    .select("id, user_id, full_name, role, email, active, is_professional, created_at")
    .order("created_at", { ascending: true })
  const staff = (data ?? []) as StaffRow[]

  return (
    <>
      <p className="adm-eyebrow">Personal</p>
      <h1 className="adm-h1">
        Tu <em>equipo</em>
      </h1>
      <p className="adm-lede">
        Sumá nuevas profesionales y recepcionistas. Reciben acceso al panel
        cuando inician sesión con su email por primera vez.
      </p>

      <StaffForm />

      <h2 className="adm-section-title">Equipo</h2>
      {staff.length === 0 ? (
        <div className="adm-card">
          <div className="adm-empty">No hay personal cargado todavía.</div>
        </div>
      ) : (
        <div className="adm-card">
          {staff.map((s) => (
            <div key={s.id} className="adm-list-row adm-list-row--staff">
              <div>
                <div className="adm-name">{s.full_name}</div>
                <div className="adm-sub">
                  {s.user_id ? "Conectado ✓" : "Esperando primer login"}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {s.email ?? "—"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className={`adm-pill ${s.role === "admin" ? "adm-pill--admin" : "adm-pill--inactive"}`}>
                  {ROLE_LABEL[s.role] ?? s.role}
                </span>
                {s.is_professional && (
                  <span className="adm-pill adm-pill--active" style={{ background: "#e8f0e5", color: "#4d6b3e" }}>
                    Profesional
                  </span>
                )}
              </div>
              <div>
                <span className={`adm-pill ${s.active ? "adm-pill--active" : "adm-pill--inactive"}`}>
                  {s.active ? "Activa" : "Inactiva"}
                </span>
              </div>
              <div className="adm-actions" style={{ gap: 8 }}>
                <Link href={`/admin/staff/${s.id}`} className="adm-btn adm-btn--ghost">
                  Editar →
                </Link>
                <StaffActiveToggle staffId={s.id} active={s.active} />
                <StaffDeleteButton staffId={s.id} name={s.full_name} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
