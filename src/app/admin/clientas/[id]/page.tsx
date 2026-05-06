import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { fmtPrice } from "../../../reserva/data"
import RecordEditor from "./record-editor"
import PhotosManager from "./photos-manager"

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

export type RecordRow = {
  id: string
  version: number
  is_current: boolean
  allergies: string[]
  allergies_other: string | null
  medications_status: "no" | "si"
  medications_note: string | null
  pregnancy: "no" | "embarazo" | "lactancia"
  skin_conditions: string[]
  alert_flags: string[]
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

  const { data: record } = await admin
    .from("client_records")
    .select(
      "id, version, is_current, allergies, allergies_other, medications_status, medications_note, pregnancy, skin_conditions, alert_flags, created_at"
    )
    .eq("client_id", id)
    .eq("is_current", true)
    .maybeSingle<RecordRow>()

  const { data: apptsData } = await admin
    .from("appointments")
    .select(
      "id, starts_at, status, duration_min, total_cents, appointment_services(service:services(name))"
    )
    .eq("client_id", id)
    .order("starts_at", { ascending: false })
    .limit(50)
  const appts = (apptsData ?? []) as unknown as ApptRow[]

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

  const hasAlerts =
    !!record &&
    (record.pregnancy !== "no" ||
      record.medications_status === "si" ||
      record.allergies.length > 0 ||
      record.skin_conditions.length > 0 ||
      record.alert_flags.length > 0)

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

      {hasAlerts && record && (
        <div className="adm-alert">
          <strong>Alertas en ficha · </strong>
          {record.pregnancy === "embarazo" && "🤰 Embarazo. "}
          {record.pregnancy === "lactancia" && "🤱 Lactancia. "}
          {record.medications_status === "si" && (
            <>💊 Medicación: {record.medications_note ?? "sí"}. </>
          )}
          {record.allergies.length > 0 && (
            <>🌿 Alergias: {record.allergies.join(", ")}
            {record.allergies_other ? `, ${record.allergies_other}` : ""}. </>
          )}
          {record.skin_conditions.length > 0 && (
            <>🔍 Piel: {record.skin_conditions.join(", ")}.</>
          )}
        </div>
      )}

      <div className="adm-grid">
        <div>
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
        </div>

        <div>
          <h2 className="adm-section-title">
            Ficha clínica {record && `(v${record.version})`}
          </h2>
          <RecordEditor clientId={client.id} record={record} />
        </div>
      </div>

      <h2 className="adm-section-title">Fotos antes / después</h2>
      <PhotosManager clientId={client.id} photos={photos} />

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
