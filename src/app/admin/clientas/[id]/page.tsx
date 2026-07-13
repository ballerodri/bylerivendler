import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { fmtPrice } from "../../../reserva/data"
import PhotosManager from "./photos-manager"
import SellPack, { type SellablePack } from "./sell-pack"
import ClientDeleteButton from "./delete-button"
import PackSessions, { type PackPurchaseView } from "./pack-sessions"
import { fetchBusinessHours } from "@/app/reserva/queries"

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

  const businessHours = await fetchBusinessHours()

  const purchaseIds = purchases.map((p) => p.id)
  // Traemos los turnos del pack en CUALQUIER estado (incluidos cancelados):
  // una sesión cancelada igual registró bien cuánto dura una sesión de este
  // pack, y eso es lo único que nos permite calcular la duración cuando el
  // servicio es "por zona" (ver duración más abajo). Para la lista visible
  // de sesiones seguimos mostrando sólo las no canceladas.
  const { data: packApptsData } = purchaseIds.length
    ? await admin
        .from("appointments")
        .select("id, starts_at, status, duration_min, pack_purchase_id")
        .in("pack_purchase_id", purchaseIds)
        .order("starts_at", { ascending: true })
    : { data: [] as { id: string; starts_at: string; status: string; duration_min: number; pack_purchase_id: string }[] }
  const packApptsAll = (packApptsData ?? []) as {
    id: string; starts_at: string; status: string; duration_min: number; pack_purchase_id: string
  }[]
  const packAppts = packApptsAll.filter((a) => a.status !== "cancelled")

  // interval_days + duración/modo de precio del servicio de cada pack comprado
  const { data: packMetaData } = await admin
    .from("pack_purchases")
    .select("id, pack:packs(interval_days, service:services(duration_min, pricing_mode))")
    .in("id", purchaseIds.length ? purchaseIds : ["00000000-0000-0000-0000-000000000000"])
  const packMeta = new Map(
    ((packMetaData ?? []) as unknown as {
      id: string
      pack: {
        interval_days: number | null
        service: { duration_min: number; pricing_mode: "fixed" | "per_zone" } | null
      } | null
    }[]).map((m) => [m.id, m])
  )

  const SCHEDULING_BLOCKED_REASON =
    "Este pack no se puede agendar desde acá todavía: es un servicio por zona y sus zonas nunca quedaron registradas (se vendió sin crear ninguna sesión). Comunicate con soporte, o agendalo como un turno común."

  const purchaseViews: PackPurchaseView[] = purchases.map((p) => {
    const sessions = packAppts
      .filter((a) => a.pack_purchase_id === p.id)
      .map((a) => ({ id: a.id, startsAt: a.starts_at, status: a.status }))
    const meta = packMeta.get(p.id)
    const pricingMode = meta?.pack?.service?.pricing_mode ?? "fixed"
    // Duración: la de CUALQUIER turno ya creado de este pack (aunque esté
    // cancelado). Si no hay ninguno, sólo se puede confiar en la duración
    // del servicio cuando es 'fixed' — para 'per_zone' no hay forma de
    // saberla sin adivinar, así que queda sin resolver (null).
    const anyAppt = packApptsAll.find((a) => a.pack_purchase_id === p.id)
    const knownDuration =
      anyAppt?.duration_min ??
      (pricingMode === "fixed" ? meta?.pack?.service?.duration_min ?? null : null)
    const durationMin = knownDuration && knownDuration > 0 ? knownDuration : 0
    return {
      id: p.id,
      packName: p.pack_name,
      serviceName: p.service_name,
      sessionsTotal: p.sessions_total,
      sessionsUsed: p.sessions_used,
      durationMin,
      schedulingBlockedReason: durationMin > 0 ? null : SCHEDULING_BLOCKED_REASON,
      intervalDays: meta?.pack?.interval_days ?? null,
      sessions,
      lastStartsAt: sessions.length ? sessions[sessions.length - 1].startsAt : null,
    }
  })

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
              <div key={p.id}>
                <div className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
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
                <PackSessions
                  purchase={purchaseViews.find((v) => v.id === p.id)!}
                  businessHours={businessHours}
                />
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

      <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
        <ClientDeleteButton clientId={client.id} name={`${client.first_name} ${client.last_name}`} />
      </div>
    </>
  )
}
