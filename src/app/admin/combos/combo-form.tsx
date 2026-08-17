"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createCombo, updateCombo, type ComboInput } from "../actions"
import { fmtPrice } from "../../reserva/data"
import { computeZonePricing } from "@/lib/servicios/zones"
import { comboIndividualCents, comboSavingsCents } from "@/lib/servicios/combo-pricing"
import { planServiceCounts, planDistinctServices, validateComboPlan, type ComboPlan } from "@/lib/servicios/combo-plan"

export type ComboZone = { id: string; name: string; durationMin: number; priceCents: number | null }

export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
  zone_selection: "multiple" | "single"
  zones: ComboZone[]
}

// Un tratamiento que PARTICIPA del combo (con sus zonas elegidas, una vez).
type PickedSvc = { serviceId: string; zoneIds: string[] }

type Props = {
  services: ServiceOption[]
  initial?: {
    id: string
    name: string
    description: string
    totalPriceCents: number
    // Las filas guardadas del combo. Con `sessionNo` (modelo nuevo) se
    // reconstruye el plan; todo null = combo del modelo viejo → los
    // tratamientos y zonas se prefillean, y el plan arranca vacío para que
    // la usuaria lo arme (guardar EXIGE el plan).
    rows: { serviceId: string; sessionNo: number | null; zonesSnapshot: { name: string }[] | null }[]
  }
}

/** Precio efectivo de UNA sesión del servicio (fijo, o suma de las zonas elegidas). */
function lineUnitCents(s: ServiceOption, zoneIds: string[]): number {
  if (s.pricing_mode !== "per_zone") return s.price_cents
  const selected = s.zones.filter((z) => zoneIds.includes(z.id))
  return computeZonePricing(
    selected.map((z) => ({ id: z.id, name: z.name, durationMin: z.durationMin, priceCents: z.priceCents })),
    s.price_cents,
  ).priceCents
}

export default function ComboForm({ services, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [priceInput, setPriceInput] = useState(
    initial ? String(Math.round(initial.totalPriceCents / 100)) : ""
  )

  const svcById = new Map(services.map((s) => [s.id, s]))
  const legacyInitial = !!initial && initial.rows.length > 0 && initial.rows.every((r) => r.sessionNo === null)

  // Prefill de los tratamientos participantes (con el snapshot de zona
  // re-mapeado a ids por nombre contra las zonas actuales del servicio).
  const [pickedSvcs, setPickedSvcs] = useState<PickedSvc[]>(() => {
    const seen = new Set<string>()
    const out: PickedSvc[] = []
    for (const r of initial?.rows ?? []) {
      if (seen.has(r.serviceId) || !svcById.has(r.serviceId)) continue
      seen.add(r.serviceId)
      const svc = svcById.get(r.serviceId)!
      const zoneIds = (r.zonesSnapshot ?? [])
        .map((snap) => svc.zones.find((z) => z.name === snap.name)?.id)
        .filter((id): id is string => !!id)
      out.push({ serviceId: r.serviceId, zoneIds })
    }
    return out
  })

  // Prefill del PLAN (modelo nuevo): agrupar por session_no en orden. Un combo
  // del modelo viejo arranca con el plan vacío (se arma acá y se guarda).
  const [plan, setPlan] = useState<ComboPlan>(() => {
    const rows = (initial?.rows ?? []).filter((r) => r.sessionNo !== null && svcById.has(r.serviceId))
    if (!rows.length) return []
    const bysession = new Map<number, string[]>()
    for (const r of rows) {
      const list = bysession.get(r.sessionNo!) ?? []
      list.push(r.serviceId) // las filas ya vienen ordenadas por order_index
      bysession.set(r.sessionNo!, list)
    }
    return [...bysession.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list)
  })

  const isPicked = (id: string) => pickedSvcs.some((p) => p.serviceId === id)
  const pickedFor = (id: string) => pickedSvcs.find((p) => p.serviceId === id)

  const toggleService = (id: string) => {
    setError(null)
    if (isPicked(id)) {
      setPickedSvcs((prev) => prev.filter((p) => p.serviceId !== id))
      // Si sale del combo, sale también de TODAS las sesiones del plan.
      setPlan((prev) => prev.map((session) => session.filter((sid) => sid !== id)))
    } else {
      setPickedSvcs((prev) => [...prev, { serviceId: id, zoneIds: [] }])
    }
  }

  const toggleZone = (id: string, zoneId: string, single: boolean) =>
    setPickedSvcs((prev) =>
      prev.map((p) => {
        if (p.serviceId !== id) return p
        if (single) return { ...p, zoneIds: [zoneId] }
        return {
          ...p,
          zoneIds: p.zoneIds.includes(zoneId) ? p.zoneIds.filter((z) => z !== zoneId) : [...p.zoneIds, zoneId],
        }
      })
    )

  // ── El plan ────────────────────────────────────────────────────────────────
  const addSession = () => { setError(null); setPlan((prev) => [...prev, []]) }
  const removeSession = (s: number) => setPlan((prev) => prev.filter((_, i) => i !== s))
  const duplicateSession = (s: number) => setPlan((prev) => [...prev.slice(0, s + 1), [...prev[s]], ...prev.slice(s + 1)])
  const addToSession = (s: number, serviceId: string) =>
    setPlan((prev) => prev.map((session, i) => (i === s ? [...session, serviceId] : session)))
  const removeFromSession = (s: number, idx: number) =>
    setPlan((prev) => prev.map((session, i) => (i === s ? session.filter((_, j) => j !== idx) : session)))
  const moveInSession = (s: number, idx: number, dir: -1 | 1) =>
    setPlan((prev) =>
      prev.map((session, i) => {
        if (i !== s) return session
        const j = idx + dir
        if (j < 0 || j >= session.length) return session
        const next = [...session]
        ;[next[idx], next[j]] = [next[j], next[idx]]
        return next
      })
    )

  // ── Derivados (precio individual / ahorro / detalle) ──────────────────────
  const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
  const counts = planServiceCounts(plan)
  const lines = Object.entries(counts).map(([id, veces]) => {
    const s = svcById.get(id)
    const p = pickedFor(id)
    return { priceCents: s ? lineUnitCents(s, p?.zoneIds ?? []) : 0, sessions: veces }
  })
  const fullPriceCents = comboIndividualCents(lines)
  const saving = comboSavingsCents(fullPriceCents, totalPriceCents)

  const detalle = planDistinctServices(plan)
    .map((id) => {
      const s = svcById.get(id)
      if (!s) return null
      const p = pickedFor(id)
      const zonas = s.pricing_mode === "per_zone" && p?.zoneIds.length
        ? ` (${s.zones.filter((z) => p.zoneIds.includes(z.id)).map((z) => z.name).join(", ")})`
        : ""
      return `${s.name}${zonas} ×${counts[id]}`
    })
    .filter(Boolean)
    .join(", ")

  const handleSubmit = () => {
    // Misma validación que el servidor (módulo puro compartido) + zonas.
    const planErr = validateComboPlan({ name, totalPriceCents, sessions: plan })
    if (planErr) { setError(planErr); return }
    for (const id of planDistinctServices(plan)) {
      const s = svcById.get(id)
      if (s?.pricing_mode === "per_zone" && !(pickedFor(id)?.zoneIds.length))
        { setError(`Elegí la(s) zona(s) de "${s.name}".`); return }
    }

    setError(null)
    startTransition(async () => {
      const zonesByService: Record<string, string[]> = {}
      for (const id of planDistinctServices(plan)) {
        if (svcById.get(id)?.pricing_mode === "per_zone")
          zonesByService[id] = pickedFor(id)?.zoneIds ?? []
      }
      const input: ComboInput = { name, description, totalPriceCents, sessions: plan, zonesByService }
      const r = initial ? await updateCombo(initial.id, input) : await createCombo(input)
      if (r.ok) router.push("/admin/combos")
      else setError(r.error ?? "Error al guardar.")
    })
  }

  // Group services by category for the picker.
  const byCategory = services.reduce<Record<string, ServiceOption[]>>((acc, s) => {
    ;(acc[s.category] ??= []).push(s)
    return acc
  }, {})

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Name & description & price */}
      <div className="adm-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 0 }}>Datos del combo</h2>
        <div>
          <label className="adm-label">Nombre *</label>
          <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Programa Reductor Pretemporada" />
        </div>
        <div>
          <label className="adm-label">Descripción (opcional)</label>
          <input className="adm-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve descripción para la clienta" />
        </div>
        <div>
          <label className="adm-label">Precio del combo *</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 12, fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)" }}>$</span>
              <input className="adm-input" type="number" min="0" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={{ paddingLeft: 28, width: 160 }} placeholder="0" />
            </div>
            {fullPriceCents > 0 && totalPriceCents > 0 && (
              <span style={{ fontSize: 13, color: saving > 0 ? "#4d6b3e" : saving < 0 ? "#8c463c" : "var(--ink-mute)" }}>
                {saving > 0
                  ? `${fmtPrice(saving / 100)} de ahorro`
                  : saving < 0
                  ? `${fmtPrice(Math.abs(saving) / 100)} más caro que por separado`
                  : "igual al precio individual"}
              </span>
            )}
          </div>
          {fullPriceCents > 0 && (
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>
              Precio individual ({plan.length} sesion{plan.length === 1 ? "" : "es"}): {fmtPrice(fullPriceCents / 100)}
              {detalle && <><br />{detalle}</>}
            </p>
          )}
        </div>
      </div>

      {/* Tratamientos que participan (+ zonas, una vez por tratamiento) */}
      <div className="adm-card" style={{ padding: 24 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 4 }}>Tratamientos del combo *</h2>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
          Tildá los tratamientos que forman parte del combo. En los que se cobran por zona, elegí la(s) zona(s) — valen para todas sus sesiones. Después armá el plan de sesiones abajo.
        </p>
        {Object.entries(byCategory).map(([cat, svcs]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 8 }}>{cat}</p>
            {svcs.map((s) => {
              const p = pickedFor(s.id)
              return (
                <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={isPicked(s.id)} onChange={() => toggleService(s.id)} style={{ width: 16, height: 16, accentColor: "var(--gold)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 14 }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: "var(--ink-mute)", marginLeft: 8 }}>
                        {s.pricing_mode === "per_zone" ? "por zona" : `${s.duration_min} min · ${fmtPrice(s.price_cents / 100)}`}
                      </span>
                    </div>
                    {p && counts[s.id] > 0 && (
                      <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>×{counts[s.id]} en el plan</span>
                    )}
                  </label>
                  {p && s.pricing_mode === "per_zone" && (
                    <div style={{ marginLeft: 28, marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {s.zones.length === 0 && (
                        <span style={{ fontSize: 12, color: "#8c463c" }}>Este servicio no tiene zonas cargadas.</span>
                      )}
                      {s.zones.map((z) => {
                        const on = p.zoneIds.includes(z.id)
                        const single = s.zone_selection === "single"
                        return (
                          <label key={z.id} style={{
                            display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer",
                            padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line-strong)",
                            background: on ? "var(--rose-wash, #f6e9de)" : "var(--paper)",
                          }}>
                            <input type={single ? "radio" : "checkbox"} name={`zone-${s.id}`} checked={on}
                              onChange={() => toggleZone(s.id, z.id, single)} style={{ width: 14, height: 14 }} />
                            {z.name} · {fmtPrice((z.priceCents ?? s.price_cents) / 100)}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* EL PLAN DE SESIONES */}
      <div className="adm-card" style={{ padding: 24 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 4 }}>Plan de sesiones *</h2>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
          Armá cada sesión (visita) con sus tratamientos en el orden en que se hacen ese día.
          {legacyInitial && plan.length === 0 && (
            <><br /><strong style={{ color: "#8c463c" }}>Este combo es del modelo anterior: armá su plan de sesiones para poder guardar.</strong></>
          )}
        </p>

        {plan.map((session, s) => {
          const addable = pickedSvcs.filter((p) => !session.includes(p.serviceId))
          return (
            <div key={s} style={{ border: "1px solid var(--line-strong)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 16 }}>Sesión {s + 1}</span>
                <span style={{ flex: 1 }} />
                <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => duplicateSession(s)}>Duplicar</button>
                <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={() => removeSession(s)}>Quitar sesión</button>
              </div>
              {session.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "4px 0 8px" }}>Sin tratamientos todavía — agregá al menos uno.</p>
              )}
              {session.map((id, idx) => {
                const svc = svcById.get(id)
                return (
                  <div key={`${id}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontFamily: "var(--serif)", fontSize: 15, color: "var(--gold)", minWidth: 20, textAlign: "center" }}>{idx + 1}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{svc?.name ?? "(servicio borrado)"}</span>
                    <button onClick={() => moveInSession(s, idx, -1)} disabled={idx === 0} className="adm-btn" style={{ fontSize: 11, padding: "2px 8px", opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                    <button onClick={() => moveInSession(s, idx, 1)} disabled={idx === session.length - 1} className="adm-btn" style={{ fontSize: 11, padding: "2px 8px", opacity: idx === session.length - 1 ? 0.3 : 1 }}>↓</button>
                    <button onClick={() => removeFromSession(s, idx)} className="adm-btn" style={{ fontSize: 11, padding: "2px 8px" }}>✕</button>
                  </div>
                )
              })}
              {addable.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <select
                    className="adm-input"
                    style={{ fontSize: 12, width: "auto", paddingRight: 28 }}
                    value=""
                    onChange={(e) => { if (e.target.value) addToSession(s, e.target.value) }}
                  >
                    <option value="">+ Agregar tratamiento…</option>
                    {addable.map((p) => (
                      <option key={p.serviceId} value={p.serviceId}>{svcById.get(p.serviceId)?.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {addable.length === 0 && pickedSvcs.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>Tildá tratamientos arriba para poder agregarlos.</p>
              )}
            </div>
          )
        })}

        <button className="adm-btn" onClick={addSession} style={{ fontSize: 13, padding: "6px 16px" }}>
          + Agregar sesión
        </button>
      </div>

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleSubmit} disabled={pending} className="adm-btn" style={{ fontSize: 14, padding: "10px 24px", background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" }}>
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Crear combo"}
        </button>
        <button onClick={() => router.push("/admin/combos")} disabled={pending} className="adm-btn" style={{ fontSize: 14, padding: "10px 24px" }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
