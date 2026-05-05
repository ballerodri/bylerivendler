import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

type ClientRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  created_at: string
  loyalty_points: number
}

export default async function AdminClientasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sp = await searchParams
  const search = (sp.q ?? "").trim()

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  let q = admin
    .from("clients")
    .select("id, first_name, last_name, email, phone, created_at, loyalty_points")
    .order("created_at", { ascending: false })
    .limit(200)
  if (search) {
    const term = `%${search}%`
    q = q.or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`)
  }

  const { data } = await q
  const clients = (data ?? []) as ClientRow[]

  return (
    <>
      <p className="adm-eyebrow">Clientas</p>
      <h1 className="adm-h1">
        Todas las <em>clientas</em>
      </h1>
      <p className="adm-lede">{clients.length} resultados.</p>

      <form className="adm-toolbar" method="get">
        <input
          className="adm-input"
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Buscar por nombre o email…"
        />
        <button className="adm-btn adm-btn--primary" type="submit">
          Buscar
        </button>
      </form>

      {clients.length === 0 ? (
        <div className="adm-card">
          <div className="adm-empty">
            {search
              ? `Sin resultados para "${search}".`
              : "Todavía no hay clientas registradas."}
          </div>
        </div>
      ) : (
        <div className="adm-card">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/admin/clientas/${c.id}`}
              className="adm-list-row adm-list-row--clientas"
            >
              <div>
                <div className="adm-name">
                  {c.first_name} {c.last_name}
                </div>
                <div className="adm-sub">
                  Alta {new Date(c.created_at).toLocaleDateString("es-AR")}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {c.email}
                <div className="adm-sub">{c.phone ?? "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {c.loyalty_points} pts
              </div>
              <div className="adm-actions">
                <span className="adm-btn adm-btn--ghost">Ver →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
