import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { getStaffProfile } from "@/lib/staff"
import { fmtPrice } from "../../reserva/data"

export const dynamic = "force-dynamic"

const TZ = "America/Argentina/Buenos_Aires"
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

type ApptRow = {
  id: string
  starts_at: string
  status: string
  total_cents: number
  appointment_services: {
    price_cents: number | null
    service: { id: string; name: string } | null
    staff: { id: string; full_name: string } | null
  }[]
}

export default async function EstadisticasPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  const staffProfile = user ? await getStaffProfile(user.id) : null
  const isProfessionalOnly = staffProfile?.isProfessionalOnly ?? false

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const since = new Date()
  since.setMonth(since.getMonth() - 11)
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  let q = admin
    .from("appointments")
    .select(`
      id, starts_at, status, total_cents,
      appointment_services(price_cents, service:services(id, name), staff:staff(id, full_name))
    `)
    .gte("starts_at", since.toISOString())
    .not("status", "in", '("cancelled","no_show")')
    .order("starts_at", { ascending: true })

  if (isProfessionalOnly && staffProfile) {
    q = q.eq("staff_id", staffProfile.id)
  }

  const { data } = await q
  const appts = (data ?? []) as unknown as ApptRow[]

  // Comisiones configuradas por (profesional, servicio). El porcentaje/monto
  // es lo que se queda EL SALÓN; el resto es de la profesional.
  const { data: comisionesData } = await admin
    .from("staff_service_commissions")
    .select("staff_id, service_id, commission_type, commission_value")
  const comisiones = new Map(
    ((comisionesData ?? []) as {
      staff_id: string; service_id: string
      commission_type: "percentage" | "fixed"; commission_value: number
    }[]).map((c) => [`${c.staff_id}|${c.service_id}`, c])
  )

  /**
   * Cuánto de esta pata se queda el salón. Sin comisión configurada se asume
   * que NO hay comisión que pagar (el salón se queda con todo): es el caso de
   * la dueña con sus propios turnos. Los servicios sin configurar se cuentan
   * aparte para poder avisarlo — si a una profesional le corresponde un corte
   * y nadie lo cargó, acá figuraría de más para el salón.
   */
  function parteDelSalon(precioCents: number, staffId: string, serviceId: string | null): { salon: number; sinConfigurar: boolean } {
    const c = serviceId ? comisiones.get(`${staffId}|${serviceId}`) : undefined
    if (!c) return { salon: precioCents, sinConfigurar: true }
    const salon =
      c.commission_type === "percentage"
        ? Math.round((precioCents * Number(c.commission_value)) / 100)
        : Math.min(Math.round(Number(c.commission_value) * 100), precioCents)
    return { salon: Math.max(0, Math.min(salon, precioCents)), sinConfigurar: false }
  }

  const byMonth: Record<string, { count: number; revenue: number }> = {}
  const serviceCounts: Record<string, number> = {}

  for (const a of appts) {
    const d = new Date(a.starts_at)
    const arDate = new Date(d.toLocaleString("en-US", { timeZone: TZ }))
    const key = `${arDate.getFullYear()}-${String(arDate.getMonth() + 1).padStart(2, "0")}`
    if (!byMonth[key]) byMonth[key] = { count: 0, revenue: 0 }
    byMonth[key].count++
    if (a.status === "completed") byMonth[key].revenue += a.total_cents

    for (const as of a.appointment_services) {
      // For professionals: only count services they performed
      if (isProfessionalOnly && staffProfile && as.staff?.id !== staffProfile.id) continue
      const name = as.service?.name
      if (name) serviceCounts[name] = (serviceCounts[name] ?? 0) + 1
    }
  }

  const months: { key: string; label: string; count: number; revenue: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = d.getMonth()
    const key = `${y}-${String(m + 1).padStart(2, "0")}`
    months.push({
      key,
      label: `${MONTH_NAMES[m]} ${y !== new Date().getFullYear() ? y : ""}`.trim(),
      count: byMonth[key]?.count ?? 0,
      revenue: byMonth[key]?.revenue ?? 0,
    })
  }

  // ── Rendimiento por profesional ──────────────────────────────────────────
  // Los turnos se cuentan UNA vez por profesional (un turno con dos servicios
  // de la misma persona es un turno, no dos), y la plata se atribuye POR PATA
  // (`appointment_services.price_cents`): en un turno compartido, cada una
  // suma lo suyo en vez de llevarse el total.
  const porProfesional: Record<string, {
    nombre: string; turnos: Set<string>; servicios: number
    ingresos: number; salon: number; sinConfigurar: number
  }> = {}
  for (const a of appts) {
    for (const as of a.appointment_services) {
      const st = as.staff
      if (!st) continue
      const p = (porProfesional[st.id] ??= {
        nombre: st.full_name, turnos: new Set(), servicios: 0, ingresos: 0, salon: 0, sinConfigurar: 0,
      })
      p.turnos.add(a.id)
      p.servicios++
      if (a.status === "completed") {
        const precio = as.price_cents ?? 0
        p.ingresos += precio
        const { salon, sinConfigurar } = parteDelSalon(precio, st.id, as.service?.id ?? null)
        p.salon += salon
        if (sinConfigurar && precio > 0) p.sinConfigurar++
      }
    }
  }
  const ranking = Object.values(porProfesional)
    .map((p) => ({
      nombre: p.nombre, turnos: p.turnos.size, servicios: p.servicios,
      ingresos: p.ingresos, salon: p.salon, profesional: p.ingresos - p.salon,
      sinConfigurar: p.sinConfigurar,
    }))
    .sort((x, y) => y.turnos - x.turnos)
  const totalSinConfigurar = ranking.reduce((a, r) => a + r.sinConfigurar, 0)
  const maxTurnosProf = Math.max(...ranking.map((r) => r.turnos), 1)

  const topServices = Object.entries(serviceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  const totalAppts = appts.length
  const totalRevenue = appts.filter((a) => a.status === "completed").reduce((s, a) => s + a.total_cents, 0)
  const maxCount = Math.max(...months.map((m) => m.count), 1)

  return (
    <>
      <p className="adm-eyebrow">
        {isProfessionalOnly ? `${staffProfile!.full_name} · ` : ""}Resumen
      </p>
      <h1 className="adm-h1">
        {isProfessionalOnly ? "Mis " : ""}Estadís<em>ticas</em>
      </h1>
      <p className="adm-lede">
        {isProfessionalOnly
          ? "Tus turnos de los últimos 12 meses (excluye cancelados y no-shows)."
          : "Últimos 12 meses · turnos activos (excluye cancelados y no-shows)."}
      </p>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 32 }}>
        <div className="adm-card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-mute)", margin: "0 0 6px" }}>
            Turnos totales
          </p>
          <p style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 500, margin: 0 }}>{totalAppts}</p>
        </div>
        {!isProfessionalOnly && (
          <div className="adm-card" style={{ padding: "20px 24px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-mute)", margin: "0 0 6px" }}>
              Ingresos completados
            </p>
            <p style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 500, margin: 0 }}>{fmtPrice(totalRevenue / 100)}</p>
          </div>
        )}
        <div className="adm-card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-mute)", margin: "0 0 6px" }}>
            Promedio / mes
          </p>
          <p style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 500, margin: 0 }}>
            {Math.round(totalAppts / 12)}
          </p>
        </div>
      </div>

      {/* Bar chart: turnos por mes */}
      <div className="adm-card" style={{ padding: 24, marginBottom: 24 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 16 }}>Turnos por mes</p>
        {/* La altura de la barra va en PÍXELES, no en %. En porcentaje se
            calculaba contra la columna, que no tiene altura propia (la define
            su contenido), así que resolvía a 0 y NINGUNA barra se dibujaba:
            se veía sólo el número flotando. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140, marginBottom: 8 }}>
          {months.map((m) => (
            <div
              key={m.key}
              title={`${m.label}: ${m.count} turno${m.count === 1 ? "" : "s"}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}
            >
              <span style={{ fontSize: 11, color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                {m.count || ""}
              </span>
              <div
                style={{
                  width: "100%",
                  background: m.count > 0 ? "var(--gold)" : "var(--linen)",
                  borderRadius: "4px 4px 0 0",
                  height: m.count > 0 ? Math.max(Math.round((m.count / maxCount) * 112), 6) : 2,
                  transition: "height 0.3s",
                }}
              />
            </div>
          ))}
        </div>
        {/* Línea de base: sin ella las barras cortas flotan y no se lee de
            dónde arrancan. */}
        <div style={{ borderTop: "1px solid var(--line)", marginBottom: 6 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {months.map((m) => (
            <div
              key={m.key}
              style={{
                flex: 1,
                fontSize: 9,
                color: m.count > 0 ? "var(--ink-soft)" : "var(--ink-mute)",
                textAlign: "center",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {m.label.slice(0, 3)}
            </div>
          ))}
        </div>
      </div>

      {/* Ingresos por mes — solo admins */}
      {!isProfessionalOnly && (
        <div className="adm-card" style={{ padding: 24, marginBottom: 24 }}>
          <p className="adm-eyebrow" style={{ marginBottom: 12 }}>Ingresos por mes (completados)</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {months.filter((m) => m.revenue > 0).reverse().slice(0, 6).reverse().map((m) => (
              <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                <span style={{ width: 90, color: "var(--ink-mute)", flexShrink: 0 }}>{m.label}</span>
                <div style={{ flex: 1, background: "var(--linen)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "var(--gold)",
                      width: `${(m.revenue / Math.max(...months.map((x) => x.revenue), 1)) * 100}%`,
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-soft)" }}>
                  {fmtPrice(m.revenue / 100)}
                </span>
              </div>
            ))}
            {months.every((m) => m.revenue === 0) && (
              <p style={{ fontSize: 13, color: "var(--ink-mute)", margin: 0 }}>
                Los ingresos se registran al completar los turnos.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Rendimiento por profesional — sólo admins (una profesional ve su
          propia página filtrada, ahí un ranking de una sola fila no aporta). */}
      {!isProfessionalOnly && ranking.length > 0 && (
        <div className="adm-card" style={{ padding: 24, marginBottom: 24 }}>
          <p className="adm-eyebrow" style={{ marginBottom: 12 }}>Por profesional</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ranking.map((r) => (
              <div key={r.nombre} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--ink)", minWidth: 0 }}>{r.nombre}</span>
                <div style={{ width: 120, background: "var(--linen)", borderRadius: 4, height: 8, overflow: "hidden", flexShrink: 0 }}>
                  <div
                    style={{
                      height: "100%",
                      background: "var(--gold)",
                      width: `${(r.turnos / maxTurnosProf) * 100}%`,
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span
                  style={{ width: 108, textAlign: "right", color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                  title={`${r.servicios} servicio${r.servicios === 1 ? "" : "s"} realizados`}
                >
                  {r.turnos} turno{r.turnos === 1 ? "" : "s"}
                </span>
                <span
                  style={{ width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                  title="Lo que generó en total"
                >
                  {fmtPrice(r.ingresos / 100)}
                </span>
                <span
                  style={{ width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--gold)", flexShrink: 0 }}
                  title="Le queda al salón, según las comisiones cargadas"
                >
                  {fmtPrice(r.salon / 100)}
                </span>
                <span
                  style={{ width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-mute)", flexShrink: 0 }}
                  title="Le corresponde a la profesional"
                >
                  {fmtPrice(r.profesional / 100)}
                </span>
              </div>
            ))}
            {/* Encabezado de las columnas de plata, abajo para no competir con
                los nombres. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em", paddingTop: 4, borderTop: "1px solid var(--line)" }}>
              <span style={{ flex: 1 }} />
              <span style={{ width: 120, flexShrink: 0 }} />
              <span style={{ width: 108, flexShrink: 0 }} />
              <span style={{ width: 100, textAlign: "right", flexShrink: 0 }}>Generó</span>
              <span style={{ width: 100, textAlign: "right", flexShrink: 0 }}>Salón</span>
              <span style={{ width: 100, textAlign: "right", flexShrink: 0 }}>Profesional</span>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "12px 0 0" }}>
            Sobre turnos completados, atribuido por servicio: en un turno compartido cada una
            suma lo suyo. El reparto sale de las comisiones cargadas en Personal (el porcentaje
            es lo que se queda el salón).
          </p>
          {totalSinConfigurar > 0 && (
            <p style={{ fontSize: 11, color: "#8a6a3c", margin: "6px 0 0" }}>
              Ojo: {totalSinConfigurar} servicio{totalSinConfigurar === 1 ? "" : "s"} sin comisión
              cargada — ahí se está contando todo para el salón. Se configura en{" "}
              <strong>Personal → la profesional → Comisiones</strong>.
            </p>
          )}
        </div>
      )}

      {/* Servicios más pedidos */}
      {topServices.length > 0 && (
        <div className="adm-card" style={{ padding: 24, marginBottom: 24 }}>
          <p className="adm-eyebrow" style={{ marginBottom: 12 }}>
            {isProfessionalOnly ? "Mis servicios más realizados" : "Servicios más pedidos"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {topServices.map(([name, count]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--ink)" }}>{name}</span>
                <div style={{ width: 120, background: "var(--linen)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "var(--nude)",
                      width: `${(count / (topServices[0]?.[1] ?? 1)) * 100}%`,
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span style={{ width: 32, textAlign: "right", color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topServices.length === 0 && (
        <div className="adm-card">
          <div className="adm-empty">Sin datos de servicios en los últimos 12 meses.</div>
        </div>
      )}
    </>
  )
}
