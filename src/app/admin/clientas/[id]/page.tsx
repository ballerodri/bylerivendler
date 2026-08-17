import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "../../../reserva/data"
// El agendador de sesiones de pack (PackSessionPicker) usa las clases del
// calendario de la reserva pública. Sin esto se ve como texto plano. No pisa
// nada del admin: reserva.css no tiene selectores globales (sus variables
// viven bajo `.blv`, el wrapper que pone pack-sessions.tsx). Mismo patrón que
// Admin → Nueva reserva.
import "@/app/reserva/reserva.css"
import PhotosManager from "./photos-manager"
import ConsentManager from "./consent-manager"
import ClientDataEditor from "./client-data-editor"
import SellPack, { type SellablePack } from "./sell-pack"
import SellPrograma, { type SellablePrograma } from "./sell-programa"
import ProgramaSessions from "./programa-sessions"
import { programSessionStates, programAllScheduled } from "@/lib/servicios/combo-sessions"
import ClientDeleteButton from "./delete-button"
import PackDeleteButton from "./pack-delete-button"
import PackSessions, { type PackPurchaseView } from "./pack-sessions"
import PadronLookup from "@/app/admin/_components/padron-lookup"
import { fetchBusinessHours } from "@/app/reserva/queries"

export const dynamic = "force-dynamic"

// Esta página corre en el SERVIDOR (UTC en Vercel): toda fecha que se muestre
// tiene que pedir explícitamente la zona de Argentina, o sale 3 horas adelante.
const TZ = "America/Argentina/Buenos_Aires"

type ClientRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  date_of_birth: string | null
  dni: string | null
  notes: string | null
  marketing_consent: boolean
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
  // La ficha tiene datos personales, notas y el CONSENTIMIENTO firmado (ficha
  // médica): sólo admin/recepción. La lista de clientas ya se protegía así,
  // pero a la ficha se llegaba igual escribiendo la dirección a mano.
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const { id } = await params
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: client } = await admin
    .from("clients")
    .select("id, first_name, last_name, email, phone, date_of_birth, dni, notes, marketing_consent, loyalty_points, created_at")
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

  // Turnos vinculados a cada pack (CUALQUIER estado): si se borra el pack,
  // todos estos se desvinculan (no se borran). Se lo mostramos a la clienta
  // antes de confirmar el borrado.
  const linkedApptsCount = new Map<string, number>()
  for (const a of packApptsAll) {
    linkedApptsCount.set(a.pack_purchase_id, (linkedApptsCount.get(a.pack_purchase_id) ?? 0) + 1)
  }

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

  // ── Programas (combos multi-sesión) comprados por esta clienta ──
  type ComboPurchaseRow = {
    id: string; combo_name: string; total_price_cents: number; created_at: string
    combo_purchase_services: { service_id: string; service_name: string; sessions: number; order_index: number; zones: { duration_min: number }[] | null }[]
  }
  const { data: comboPurchasesData } = await admin
    .from("combo_purchases")
    .select("id, combo_name, total_price_cents, created_at, combo_purchase_services(service_id, service_name, sessions, order_index, zones)")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
  const comboPurchases = (comboPurchasesData ?? []) as unknown as ComboPurchaseRow[]

  // Duración/pricing de los servicios de los programas (para el agendador: la
  // duración sale del snapshot de zonas congelado, o del servicio si es fijo).
  const programServiceIds = Array.from(new Set(comboPurchases.flatMap((p) => p.combo_purchase_services.map((s) => s.service_id))))
  const { data: progSvcData } = programServiceIds.length
    ? await admin.from("services").select("id, duration_min, pricing_mode").in("id", programServiceIds)
    : { data: [] as { id: string; duration_min: number; pricing_mode: string }[] }
  const progSvcById = new Map(((progSvcData ?? []) as { id: string; duration_min: number; pricing_mode: string }[]).map((s) => [s.id, s]))
  function programSvcDuration(cps: { service_id: string | null; zones: { duration_min: number }[] | null }): number {
    if (!cps.service_id) return 0 // servicio borrado (service_id null) → no agendable
    if (cps.zones && cps.zones.length) return cps.zones.reduce((a, z) => a + (z.duration_min ?? 0), 0)
    const svc = progSvcById.get(cps.service_id)
    if (svc?.pricing_mode === "per_zone") return 0 // por-zona sin zonas → no agendable desde acá
    return svc?.duration_min ?? 0
  }

  // Sesiones VIVAS (no canceladas/no_show) ya agendadas, por (compra, servicio).
  const comboPurchaseIds = comboPurchases.map((p) => p.id)
  const { data: comboApptsData } = comboPurchaseIds.length
    ? await admin.from("appointments")
        .select("combo_purchase_id, status, appointment_services(service_id)")
        .in("combo_purchase_id", comboPurchaseIds)
    : { data: [] as unknown[] }
  const usedByPurchaseService = new Map<string, Record<string, number>>()
  for (const a of (comboApptsData ?? []) as { combo_purchase_id: string; status: string; appointment_services: { service_id: string }[] }[]) {
    if (a.status === "cancelled" || a.status === "no_show") continue
    const svcId = a.appointment_services?.[0]?.service_id
    if (!svcId) continue
    const rec = usedByPurchaseService.get(a.combo_purchase_id) ?? {}
    rec[svcId] = (rec[svcId] ?? 0) + 1
    usedByPurchaseService.set(a.combo_purchase_id, rec)
  }

  // Programas para vender (TODOS: se pueden vender aunque su reserva online no
  // esté encendida todavía).
  const { data: allCombosData } = await admin
    .from("combos")
    .select("id, name, total_price_cents, combo_services(sessions)")
    .order("name", { ascending: true })
  const sellableProgramas: SellablePrograma[] = ((allCombosData ?? []) as { id: string; name: string; total_price_cents: number; combo_services: { sessions: number | null }[] }[])
    // Un programa vendible tiene al menos 2 servicios (venderPrograma lo rechaza
    // si no) — no se ofrecen combos a medio armar.
    .filter((c) => c.combo_services.length >= 2)
    .map((c) => {
      const totalS = c.combo_services.reduce((a, s) => a + (s.sessions ?? 1), 0)
      return { id: c.id, label: `${c.name} · ${totalS} sesiones · ${fmtPrice(c.total_price_cents / 100)}` }
    })

  // Misma tabla y mismo bucket privado para las fotos antes/después y para las
  // hojas del consentimiento en papel (type='consent'); se separan más abajo
  // para que cada cosa viva en SU sección.
  type PhotoRow = {
    id: string
    storage_path: string
    type: "before" | "after" | "consent"
    visible_to_client: boolean
    note: string | null
    created_at: string
  }
  const { data: photosData } = await admin
    .from("client_photos")
    .select("id, storage_path, type, visible_to_client, note, created_at")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
  const rawPhotos = (photosData ?? []) as PhotoRow[]

  const firmadas = await Promise.all(
    rawPhotos.map(async (p) => {
      const { data } = await admin.storage
        .from("client-photos")
        .createSignedUrl(p.storage_path, 7200)
      return { ...p, signedUrl: data?.signedUrl ?? "" }
    })
  )

  const photos = firmadas.filter(
    (p): p is typeof p & { type: "before" | "after" } => p.type !== "consent"
  )
  // Las hojas del consentimiento, al revés que las fotos: de la más vieja a la
  // más nueva, para que se lean en el orden en que se subieron (hoja 1, 2, 3).
  const consentPages = firmadas
    .filter((p) => p.type === "consent")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  return (
    <>
      <p className="adm-eyebrow">
        <Link href="/admin/clientas" style={{ color: "var(--ink-mute)" }}>← Clientas</Link>
      </p>
      <h1 className="adm-h1">
        {client.first_name} {client.last_name}
      </h1>
      <p className="adm-lede">
        Alta {new Date(client.created_at).toLocaleDateString("es-AR", { timeZone: TZ })} · {client.loyalty_points} pts del Programa Cerca
      </p>

      <h2 className="adm-section-title">Datos personales</h2>
      <ClientDataEditor
        client={{
          id: client.id,
          first_name: client.first_name,
          last_name: client.last_name,
          email: client.email,
          phone: client.phone,
          date_of_birth: client.date_of_birth,
          notes: client.notes,
          marketing_consent: client.marketing_consent,
        }}
      />

      <h2 className="adm-section-title">DNI o CUIT (para facturar)</h2>
      <div className="adm-card" style={{ padding: 24, maxWidth: 560 }}>
        <PadronLookup
          clientId={client.id}
          docInicial={client.dni}
          ayuda={
            client.dni
              ? "Con esto la factura sale identificada en vez de Consumidor Final."
              : "Cargalo una vez y las facturas de esta clienta salen identificadas."
          }
        />
      </div>

      <h2 className="adm-section-title">Ficha y consentimiento (en papel)</h2>
      <ConsentManager clientId={client.id} pages={consentPages} />

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
                <div style={{ padding: "0 12px 12px", display: "flex", justifyContent: "flex-end" }}>
                  <PackDeleteButton
                    purchaseId={p.id}
                    linkedAppointmentsCount={linkedApptsCount.get(p.id) ?? 0}
                  />
                </div>
              </div>
            )
          })
        )}
        <div style={{ marginTop: 12 }}>
          <SellPack clientId={client.id} packs={sellablePacks} />
        </div>
      </div>

      <h2 className="adm-section-title">Combos</h2>
      <div className="adm-card" style={{ padding: 16 }}>
        {comboPurchases.length === 0 ? (
          <div className="adm-empty" style={{ padding: 16 }}>Sin combos comprados.</div>
        ) : (
          comboPurchases.map((p) => {
            const states = programSessionStates(
              [...p.combo_purchase_services]
                .sort((a, b) => a.order_index - b.order_index)
                .map((s) => ({ serviceId: s.service_id, serviceName: s.service_name, sessionsTotal: s.sessions })),
              usedByPurchaseService.get(p.id) ?? {}
            )
            const allDone = programAllScheduled(states)
            return (
              <div key={p.id} style={{ borderBottom: "1px solid var(--line)", padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="adm-name">{p.combo_name}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(p.total_price_cents / 100)}</span>
                    <span className={`adm-pill ${allDone ? "adm-pill--inactive" : "adm-pill--active"}`}>{allDone ? "Completo" : "Activo"}</span>
                  </div>
                </div>
                <ProgramaSessions
                  comboPurchaseId={p.id}
                  businessHours={businessHours}
                  services={[...p.combo_purchase_services]
                    .sort((a, b) => a.order_index - b.order_index)
                    .map((cps) => {
                      const st = states.find((x) => x.serviceId === cps.service_id)!
                      return {
                        serviceId: cps.service_id,
                        serviceName: cps.service_name,
                        sessionsTotal: st.sessionsTotal,
                        sessionsUsed: st.sessionsUsed,
                        sessionsRemaining: st.sessionsRemaining,
                        durationMin: programSvcDuration(cps),
                      }
                    })}
                />
              </div>
            )
          })
        )}
        <div style={{ marginTop: 12 }}>
          <SellPrograma clientId={client.id} programas={sellableProgramas} />
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
                {/* SIEMPRE con timeZone AR: esta página corre en el servidor
                    (UTC en Vercel) y sin la zona mostraba 3 horas de más — el
                    mismo turno figuraba 08:00 arriba (bloque del pack) y
                    "11:00 a. m." acá. Y en 24h, como el resto del admin. */}
                <div className="adm-time" style={{ fontSize: 14 }}>
                  {date.toLocaleDateString("es-AR", { day: "2-digit", month: "short", timeZone: TZ })}
                  <div style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-mute)" }}>
                    {date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })}
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
