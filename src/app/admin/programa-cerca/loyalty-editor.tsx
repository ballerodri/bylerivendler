"use client"

import { useState, useTransition } from "react"
import { updateLoyaltyConfig } from "../actions"

export type LoyaltyService = { id: string; name: string; enabled: boolean; earned: number; cost: number }
type Group = { id: string; name: string; services: LoyaltyService[] }
type Row = { enabled: boolean; earned: string; cost: string }

function init(groups: Group[]): Record<string, Row> {
  const m: Record<string, Row> = {}
  for (const g of groups) for (const s of g.services) {
    m[s.id] = { enabled: s.enabled, earned: String(s.earned), cost: String(s.cost) }
  }
  return m
}

export default function LoyaltyEditor({ groups }: { groups: Group[] }) {
  const [state, setState] = useState<Record<string, Row>>(() => init(groups))
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const set = (id: string, patch: Partial<Row>) => {
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setStatus("idle")
  }

  const setAll = (enabled: boolean) => {
    setState((prev) => {
      const next: Record<string, Row> = {}
      for (const [id, v] of Object.entries(prev)) next[id] = { ...v, enabled }
      return next
    })
    setStatus("idle")
  }

  const save = () => {
    setError(null)
    setStatus("idle")
    startTransition(async () => {
      const rows = Object.entries(state).map(([id, v]) => ({
        id,
        loyalty_enabled: v.enabled,
        points_earned: Math.max(0, parseInt(v.earned, 10) || 0),
        points_cost: Math.max(0, parseInt(v.cost, 10) || 0),
      }))
      const r = await updateLoyaltyConfig(rows)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button type="button" className="adm-btn" onClick={() => setAll(true)}>Marcar todos</button>
        <button type="button" className="adm-btn" onClick={() => setAll(false)}>Desmarcar todos</button>
        <span style={{ fontSize: 12, color: "var(--ink-mute)", alignSelf: "center" }}>
          Tildá el servicio para que participe. <strong>Suma</strong> = puntos que gana la clienta al
          completarlo. <strong>Canje</strong> = puntos para llevárselo gratis.
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {groups.map((g) => (
          <div key={g.id}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
              {g.name}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.services.map((s) => {
                const v = state[s.id]
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={v.enabled}
                        onChange={(e) => set(s.id, { enabled: e.target.checked })}
                        style={{ width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: 14, color: v.enabled ? "var(--ink)" : "var(--ink-mute)" }}>{s.name}</span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-mute)", opacity: v.enabled ? 1 : 0.4 }}>
                      Suma
                      <input
                        type="number"
                        min="0"
                        value={v.earned}
                        disabled={!v.enabled}
                        onChange={(e) => set(s.id, { earned: e.target.value })}
                        className="adm-input"
                        style={{ width: 78, fontSize: 13, textAlign: "right" }}
                      />
                      pts
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-mute)", opacity: v.enabled ? 1 : 0.4 }}>
                      Canje
                      <input
                        type="number"
                        min="0"
                        value={v.cost}
                        disabled={!v.enabled}
                        onChange={(e) => set(s.id, { cost: e.target.value })}
                        className="adm-input"
                        style={{ width: 78, fontSize: 13, textAlign: "right" }}
                      />
                      pts
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ paddingTop: 20, borderTop: "1px solid var(--line)", marginTop: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {status === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
        {status === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}
