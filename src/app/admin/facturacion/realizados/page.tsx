import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "@/app/reserva/data"
import PaidBadge from "../../_components/paid-badge"
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import {
  ESTADOS_REALIZADOS,
  estadoFacturacion,
  numeroComprobante,
  type EstadoFacturacion,
  type InvoiceLite,
} from "@/lib/servicios/billing-status"

export const dynamic = "force-dynamic"

// Vista UNIFICADA de los turnos ya realizados (firmes + hora pasada) con su
// estado de facturación, para no tener que entrar clienta por clienta a ver
// qué falta facturar. Por defecto muestra lo que falta facturar del mes.

const TZ = "America/Argentina/Buenos_Aires"
// Argentina no tiene horario de verano: el offset es fijo.
const AR_OFFSET = "-03:00"
const TOPE = 1000

type ApptRow = {
  id: string
  starts_at: string
  status: string
  total_cents: number
  paid_cents: number
  pack_purchase_id: string | null
  combo_purchase_id: string | null
  client: { id: string; first_name: string; last_name: string } | null
  appointment_services: {
    starts_at: string | null
    service: { name: string } | null
    staff: { full_name: string } | null
  }[]
}

const FILTROS = {
  pendientes: "Sin facturar",
  facturados: "Facturados",
  todos: "Todos",
} as const
type Filtro = keyof typeof FILTROS

const esFecha = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short", timeZone: TZ })
}

function fmtHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ })
}

export default async function TurnosRealizadosPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; fact?: string }>
}) {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const sp = await searchParams
  const nowDate = new Date()
  const nowMs = nowDate.getTime()
  const hoy = arPartsFromUtc(nowDate).dateStr
  // Por defecto, el mes en curso (del 1 a hoy).
  const desde = esFecha(sp.desde) ? sp.desde : `${hoy.slice(0, 8)}01`
  const hasta = esFecha(sp.hasta) ? sp.hasta : hoy
  const filtro: Filtro = sp.fact && sp.fact in FILTROS ? (sp.fact as Filtro) : "pendientes"

  // Fin del rango: el final del día `hasta`, pero nunca después de AHORA (un
  // turno de más tarde hoy todavía no se hizo).
  const finDia = new Date(`${hasta}T23:59:59.999${AR_OFFSET}`)
  const fin = finDia.getTime() < nowMs ? finDia : nowDate

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("appointments")
    .select(
      `
        id, starts_at, status, total_cents, paid_cents, pack_purchase_id, combo_purchase_id,
        client:clients(id, first_name, last_name),
        appointment_services(
          starts_at,
          service:services(name),
          staff:staff(full_name)
        )
      `
    )
    .in("status", [...ESTADOS_REALIZADOS])
    .gte("starts_at", new Date(`${desde}T00:00:00${AR_OFFSET}`).toISOString())
    .lte("starts_at", fin.toISOString())
    .order("starts_at", { ascending: false })
    .limit(TOPE)
  const appts = (data ?? []) as unknown as ApptRow[]

  // Facturas de estos turnos, en tandas: un `.in` con cientos de ids arma una
  // URL demasiado larga para PostgREST.
  const invoicesPorTurno = new Map<string, InvoiceLite[]>()
  const ids = appts.map((a) => a.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data: inv } = await admin
      .from("invoices")
      .select("id, appointment_id, cbte_tipo, cbte_nro, pto_vta, estado, anulada")
      .in("appointment_id", ids.slice(i, i + 100))
    for (const f of (inv ?? []) as InvoiceLite[]) {
      if (!f.appointment_id) continue
      const arr = invoicesPorTurno.get(f.appointment_id) ?? []
      arr.push(f)
      invoicesPorTurno.set(f.appointment_id, arr)
    }
  }

  const filas = appts.map((a) => ({ a, est: estadoFacturacion(a, invoicesPorTurno.get(a.id) ?? []) }))
  const sinFacturar = filas.filter((f) => f.est.tipo === "sin_facturar")
  const facturados = filas.filter((f) => f.est.tipo === "facturado")
  const visibles =
    filtro === "pendientes" ? sinFacturar : filtro === "facturados" ? facturados : filas

  const totalSinFacturar = sinFacturar.reduce((s, f) => s + f.a.total_cents, 0)
  const totalFacturado = facturados.reduce((s, f) => s + f.a.total_cents, 0)

  // Para volver acá (con los mismos filtros) después de emitir la factura.
  const volver = `/admin/facturacion/realizados?${new URLSearchParams({ desde, hasta, fact: filtro })}`

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Facturación</p>
        <Link href="/admin/facturacion" className="adm-btn" style={{ fontSize: 12 }}>
          Ver facturas emitidas
        </Link>
      </div>
      <h1 className="adm-h1">Turnos <em>realizados</em></h1>
      <p className="adm-lede">
        {sinFacturar.length} sin facturar ({fmtPrice(totalSinFacturar / 100)}) · {facturados.length} facturado
        {facturados.length === 1 ? "" : "s"} ({fmtPrice(totalFacturado / 100)})
      </p>

      <form className="adm-toolbar" method="get">
        <label style={{ fontSize: 12, color: "var(--ink-mute)" }}>
          Desde{" "}
          <input className="adm-input" style={{ width: "auto" }} type="date" name="desde" defaultValue={desde} max={hoy} />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-mute)" }}>
          Hasta{" "}
          <input className="adm-input" style={{ width: "auto" }} type="date" name="hasta" defaultValue={hasta} max={hoy} />
        </label>
        <select className="adm-select" name="fact" defaultValue={filtro}>
          {Object.entries(FILTROS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <button className="adm-btn adm-btn--primary" type="submit">
          Filtrar
        </button>
      </form>

      {appts.length >= TOPE && (
        <p style={{ color: "#8c6a3c", fontSize: 13, marginBottom: 12 }}>
          ⚠️ Hay más de {TOPE} turnos en este período y sólo se muestran los {TOPE} más recientes. Achicá las fechas.
        </p>
      )}

      <div className="adm-card">
        {visibles.length === 0 ? (
          <div className="adm-empty">
            {filtro === "pendientes"
              ? "No quedan turnos sin facturar en este período. 🎉"
              : "No hay turnos realizados que cumplan ese filtro."}
          </div>
        ) : (
          visibles.map(({ a, est }) => {
            const servicios = a.appointment_services
              .slice()
              .sort((x, y) => (x.starts_at && y.starts_at ? x.starts_at.localeCompare(y.starts_at) : 0))
            const profesionales = Array.from(
              new Set(servicios.map((s) => s.staff?.full_name).filter(Boolean))
            ).join(", ")
            return (
              <div key={a.id} className="adm-list-row adm-list-row--turnos">
                <div className="adm-time" style={{ fontSize: 15 }}>
                  {fmtFecha(a.starts_at)}
                  <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-mute)" }}>
                    {fmtHora(a.starts_at)}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="adm-name">
                    {a.client ? (
                      <Link href={`/admin/clientas/${a.client.id}`}>
                        {a.client.first_name} {a.client.last_name}
                      </Link>
                    ) : "—"}
                  </div>
                  <div className="adm-sub" style={{ fontSize: 13 }}>
                    {servicios.map((s) => s.service?.name).filter(Boolean).join(", ") || "Servicios"}
                    {profesionales && <> · {profesionales}</>}
                    {" · "}<strong style={{ color: "var(--ink)" }}>{fmtPrice(a.total_cents / 100)}</strong>
                    <PaidBadge paidCents={a.paid_cents} totalCents={a.total_cents} status={a.status} />
                  </div>
                </div>
                <div>
                  <EstadoPill est={est} />
                </div>
                <div className="adm-actions">
                  {est.tipo === "sin_facturar" && (
                    <Link
                      href={`/admin/turnos/${a.id}/facturar?${new URLSearchParams({ volver })}`}
                      className="adm-btn adm-btn--primary"
                    >
                      Facturar
                    </Link>
                  )}
                  {est.tipo === "facturado" && (
                    <a
                      className="adm-btn adm-btn--ghost"
                      href={`/api/admin/facturacion/${est.invoice.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      PDF {numeroComprobante(est.invoice)}
                    </a>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

function EstadoPill({ est }: { est: EstadoFacturacion }) {
  if (est.tipo === "facturado") {
    return <span className="adm-pill" style={{ background: "#dfe9df", color: "#3c6a3c" }}>Facturado</span>
  }
  if (est.tipo === "no_aplica") {
    const label = est.motivo === "pack" ? "Sesión de pack" : est.motivo === "programa" ? "Sesión de programa" : "$0"
    return (
      <span className="adm-pill adm-pill--completed" title="No se factura el turno: se factura la venta del pack/programa (o es un canje)">
        {label}
      </span>
    )
  }
  return (
    <>
      <span className="adm-pill" style={{ background: "#f6ecdf", color: "#8a6a3c" }}>Sin facturar</span>
      {est.anulada && (
        <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>La factura anterior se anuló</div>
      )}
    </>
  )
}
