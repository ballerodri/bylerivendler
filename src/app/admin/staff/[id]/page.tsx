import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import StaffEditor from "./staff-editor"

export const dynamic = "force-dynamic"

export type StaffRow = {
  id: string
  full_name: string
  role: string
  email: string | null
  active: boolean
  is_professional: boolean
}

export default async function AdminStaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: staffMember } = await admin
    .from("staff")
    .select("id, full_name, role, email, active, is_professional")
    .eq("id", id)
    .maybeSingle<StaffRow>()

  if (!staffMember) notFound()

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/staff" style={{ color: "var(--ink-mute)" }}>
          ← Personal
        </Link>
      </p>
      <h1 className="adm-h1">{staffMember.full_name}</h1>
      <p className="adm-lede">{staffMember.email ?? "Sin email registrado"}</p>

      <StaffEditor staff={staffMember} />
    </>
  )
}
