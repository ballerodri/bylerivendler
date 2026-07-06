import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { fmtPrice } from "../../../reserva/data"
import PhotosManager from "./photos-manager"
import SellPack, { type SellablePack } from "./sell-pack"

export const dynamic = "force-dynamic"

type ClientRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  notes: string | null
  loyalty_points: number
  created_at: string
}

type ApptRow = {
  id: string
  starts_at: string
  status: string
  duration_min: number
  total_cents: number
  appointment_services: { service: { name: string } | null }[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No vino",
}

export default async function AdminClientDetailPage({
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

  const { data: client } = await admin
    .from("clients")
    .select("id, first_name, last_name, email, phone, date_of_birth, notes, loyalty_points, created_at")
    .eq("id", id)
    .maybeSingle<ClientRow>()
  if (!client) notFound()

  const { data: apptsData } = await admin
    .from("appointments")
    .select(
      "id, starts_at, status, duration_min, total_cents, appointment_services(service:services(name))"
    )
    .eq("client_id", id)
    .order("starts_at", { ascending: false })
    .limit(50)
  const appts = (apptsData ?? []) as unknown as ApptRow[]

  type PurchaseRow = {
    id: string
    pack_name: string
    service_name: string
    sessions_total: number
    sessions_used: number
  }
  const { data: purchasesData } = await admin
    .from("pack_purchases")
    .select("id, pack_name, service_name, sessions_total, sessions_used")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
  const purchases = (purchasesData ?? []) as PurchaseRow[]

  const { data: activePacksData } = await admin
    .from("packs")
    .select("id, name, sessions, total_price_cents")
    .eq("active", true)
    .order("name", { ascending: true })
  const sellablePacks: SellablePack[] = ((activePacksData ?? []) as { id: string; name: string; sessions: number; total_price_cents: number }[])
    .map((p) => ({ id: p.id, label: `${p.name} · ${p.sessions} sesiones · ${fmtPrice(p.total_price_cents / 100)}` }))

  type PhotoRow = { id: string; storage_path: string; type: "before" | "after"; visible_to_client: boolean }
  const { data: photosData } = await admin
    .from("client_photos")
    .select("id, storage_path, type, visible_to_client")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
  const rawPhotos = (photosData ?? []) as PhotoRow[]

  const photos = await Promise.all(
    rawPhotos.map(async (p) => {
      const { data } = await admin.storage
        .from("client-photos")
        .createSignedUrl(p.storage_path, 7200)
      return { ...p, signedUrl: data?.signedUrl ?? "" }
    })
  )

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/clientas" style={{ color: "var(--ink-mute)" }}>← Clientas</Link>
      </p>
      <h1 className="adm-h1">
        {client.first_name} {client.last_name}
      </h1>
      <p className="adm-lede">
        Alta {new Date(client.created_at).toLocaleDateString("es-AR")} · {client.loyalty_points} pts del Programa Cerca
      </p>

      <h2 className="adm-section-title">Datos personales</h2>
      <div className="adm-card" style={{ padding: "8px 16px" }}>
        <div className="adm-row">
          <div className="adm-row__label">Email</div>
          <div>{client.email}</div>
        </div>
        <div className="adm-row">
          <div className="adm-row__label">Teléfono</div>
          <div>{client.phone ?? "—"}</div>
        </div>
        <div className="adm-row">
          <div className="adm-row__label">Cumpleaños</div>
          <div>
            {client.date_of_birth
              ? new Date(client.date_of_birth).toLocaleDateString("es-AR")
              : "—"}
          </div>
        </div>
        <div className="adm-row">
          <div className="adm-row__label">Notas internas</div>
          <div>{client.notes ?? "—"}</div>
        </div>
      </div>

      <h2 className="adm-section-title">Fotos antes / después</h2>
      <PhotosManager clientId={client.id} photos={photos} />

      <h2 className="adm-section-title">Packs</h2>
      <div className="adm-card" style={{ padding: 16 }}>
        {purchases.length === 0 ? (
          <div className="adm-empty" style={{ padding: 16 }}>Sin packs comprados.</div>
        ) : (
          purchases.map((p) => {
            const remaining = p.sessions_total - p.sessions_used
            const done = remaining <= 0
            return (
              <div key={p.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div className="adm-name">{p.pack_name}</div>
                  <div className="adm-sub">{p.service_name}</div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  usó {p.sessions_used} / quedan {Math.max(0, remaining)}
                </div>
                <div>
                  <span className={`adm-pill ${done ? "adm-pill--inactive" : "adm-pill--active"}`}>
                    {done ? "Completado" : "Activo"}
                  </span>
                </div>
              </div>
            )
          })
        )}
        <div style={{ marginTop: 12 }}>
          <SellPack clientId={client.id} packs={sellablePacks} />
        </div>
      </div>

      <h2 className="adm-section-title">Historial de turnos</h2>
      {appts.length === 0 ? (
        <div className="adm-card">
          <div className="adm-empty">Sin turnos registrados.</div>
        </div>
      ) : (
        <div className="adm-card">
          {appts.map((a) => {
            const date = new Date(a.starts_at)
            const services = a.appointment_services
              .map((as) => as.service?.name)
              .filter(Boolean)
              .join(", ")
            return (
              <div key={a.id} className="adm-list-row adm-list-row--turnos">
                <div className="adm-time" style={{ fontSize: 14 }}>
                  {date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-mute)" }}>
                    {date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div>
                  <div className="adm-name" style={{ fontSize: 14 }}>
                    {services || "—"}
                  </div>
                  <div className="adm-sub">
                    {a.duration_min} min · {fmtPrice(a.total_cents / 100)}
                  </div>
                </div>
                <div>
                  <span className={`adm-pill adm-pill--${a.status}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
                <div />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
