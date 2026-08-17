"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createCombo, updateCombo, type ComboInput } from "../actions"
import { fmtPrice } from "../../reserva/data"
import { computeZonePricing } from "@/lib/servicios/zones"
import { comboIndividualCents, comboSavingsCents, comboTotalSessions } from "@/lib/servicios/combo-pricing"

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

// Un servicio del programa, tal como lo edita la usuaria: su cantidad de
// sesiones y (si es por-zona) las zonas elegidas.
type Picked = { serviceId: string; sessions: number; zoneIds: string[] }

type Props = {
  services: ServiceOption[]
  initial?: {
    id: string
    name: string
    description: string
    totalPriceCents: number
    // El snapshot guardado NO trae ids de zona (guarda nombre/precio); se
    // re-mapea a ids por nombre contra las zonas actuales del servicio.
    services: { serviceId: string; sessions: number; zonesSnapshot: { name: string }[] | null }[]
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

  // Prefill: re-mapear el snapshot guardado (por nombre) a ids de zona actuales.
  const [picked, setPicked] = useState<Picked[]>(() =>
    (initial?.services ?? [])
      .filter((it) => svcById.has(it.serviceId))
      .map((it) => {
        const svc = svcById.get(it.serviceId)!
        const zoneIds = (it.zonesSnapshot ?? [])
          .map((snap) => svc.zones.find((z) => z.name === snap.name)?.id)
          .filter((id): id is string => !!id)
        return { serviceId: it.serviceId, sessions: it.sessions || 1, zoneIds }
      })
  )

  const isPicked = (id: string) => picked.some((p) => p.serviceId === id)

  const toggleService = (id: string) => {
    setError(null)
    setPicked((prev) =>
      prev.some((p) => p.serviceId === id)
        ? prev.filter((p) => p.serviceId !== id)
        : [...prev, { serviceId: id, sessions: 1, zoneIds: [] }]
    )
  }

  const setSessions = (id: string, n: number) =>
    setPicked((prev) => prev.map((p) => (p.serviceId === id ? { ...p, sessions: n } : p)))

  const toggleZone = (id: string, zoneId: string, single: boolean) =>
    setPicked((prev) =>
      prev.map((p) => {
        if (p.serviceId !== id) return p
        if (single) return { ...p, zoneIds: [zoneId] }
        return {
          ...p,
          zoneIds: p.zoneIds.includes(zoneId) ? p.zoneIds.filter((z) => z !== zoneId) : [...p.zoneIds, zoneId],
        }
      })
    )

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= picked.length) return
    setPicked((prev) => {
      const next = [...prev]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
  const lines = picked.map((p) => {
    const s = svcById.get(p.serviceId)
    return { priceCents: s ? lineUnitCents(s, p.zoneIds) : 0, sessions: p.sessions }
  })
  const fullPriceCents = comboIndividualCents(lines)
  const saving = comboSavingsCents(fullPriceCents, totalPriceCents)
  const totalSessions = comboTotalSessions(lines)

  const handleSubmit = () => {
    if (!name.trim()) { setError("El nombre es obligatorio."); return }
    if (picked.length < 2) { setError("Elegí al menos 2 servicios."); return }
    if (totalPriceCents <= 0) { setError("Ingresá el precio del programa."); return }
    for (const p of picked) {
      const s = svcById.get(p.serviceId)
      if (!s) continue
      if (!Number.isInteger(p.sessions) || p.sessions < 1) {
        setError("Las sesiones de cada servicio tienen que ser 1 o más."); return
      }
      if (s.pricing_mode === "per_zone" && p.zoneIds.length < 1) {
        setError(`Elegí la(s) zona(s) de "${s.name}".`); return
      }
    }

    setError(null)
    startTransition(async () => {
      const input: ComboInput = {
        name,
        description,
        totalPriceCents,
        services: picked.map((p) => ({
          serviceId: p.serviceId,
          sessions: p.sessions,
          zoneIds: svcById.get(p.serviceId)?.pricing_mode === "per_zone" ? p.zoneIds : undefined,
        })),
      }
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

  const detalle = picked
    .map((p) => {
      const s = svcById.get(p.serviceId)
      if (!s) return null
      const zonas = s.pricing_mode === "per_zone" && p.zoneIds.length
        ? ` (${s.zones.filter((z) => p.zoneIds.includes(z.id)).map((z) => z.name).join(", ")})`
        : ""
      return `${s.name}${zonas} ×${p.sessions}`
    })
    .filter(Boolean)
    .join(", ")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Name & description & price */}
      <div className="adm-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 0 }}>Datos del programa</h2>
        <div>
          <label className="adm-label">Nombre *</label>
          <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Programa Reductor Pretemporada" />
        </div>
        <div>
          <label className="adm-label">Descripción (opcional)</label>
          <input className="adm-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve descripción para la clienta" />
        </div>
        <div>
          <label className="adm-label">Precio del programa *</label>
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
              Precio individual ({totalSessions} sesion{totalSessions === 1 ? "" : "es"} en total): {fmtPrice(fullPriceCents / 100)}
              {detalle && <><br />{detalle}</>}
            </p>
          )}
        </div>
      </div>

      {/* Service selection with sessions + zones */}
      <div className="adm-card" style={{ padding: 24 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 4 }}>Tratamientos incluidos *</h2>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
          Tildá cada tratamiento y poné cuántas sesiones incluye el programa. En los que se cobran por zona, elegí la(s) zona(s).
        </p>
        {Object.entries(byCategory).map(([cat, svcs]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 8 }}>{cat}</p>
            {svcs.map((s) => {
              const p = picked.find((x) => x.serviceId === s.id)
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
                    {p && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-soft)" }}
                        onClick={(e) => e.preventDefault()}>
                        sesiones
                        <input
                          type="number" min="1" value={p.sessions}
                          onChange={(e) => setSessions(s.id, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                          style={{ width: 64 }} className="adm-input"
                        />
                      </span>
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

      {/* Order */}
      {picked.length > 1 && (
        <div className="adm-card" style={{ padding: 24 }}>
          <h2 className="adm-section-title" style={{ marginBottom: 4 }}>Orden</h2>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>El orden en que se listan los tratamientos del programa.</p>
          {picked.map((p, i) => {
            const s = svcById.get(p.serviceId)
            if (!s) return null
            return (
              <div key={p.serviceId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 18, color: "var(--gold)", minWidth: 24, textAlign: "center" }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{s.name} <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>×{p.sessions}</span></span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="adm-btn" style={{ fontSize: 11, padding: "2px 8px", opacity: i === 0 ? 0.3 : 1 }}>↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === picked.length - 1} className="adm-btn" style={{ fontSize: 11, padding: "2px 8px", opacity: i === picked.length - 1 ? 0.3 : 1 }}>↓</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleSubmit} disabled={pending} className="adm-btn" style={{ fontSize: 14, padding: "10px 24px", background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" }}>
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Crear programa"}
        </button>
        <button onClick={() => router.push("/admin/combos")} disabled={pending} className="adm-btn" style={{ fontSize: 14, padding: "10px 24px" }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
