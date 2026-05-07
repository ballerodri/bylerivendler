"use client"

import { useState, useTransition } from "react"
import { updateStaffCommissions } from "../../actions"
import type { ServiceRow, CommissionRow } from "./page"

type CommissionState = {
  type: "percentage" | "fixed"
  value: string
}

function initState(services: ServiceRow[], commissions: CommissionRow[]): Record<string, CommissionState> {
  const map: Record<string, CommissionState> = {}
  for (const s of services) {
    const existing = commissions.find((c) => c.service_id === s.id)
    map[s.id] = existing
      ? { type: existing.commission_type, value: String(existing.commission_value) }
      : { type: "percentage", value: "" }
  }
  return map
}

export default function CommissionsEditor({
  staffId,
  services,
  commissions,
}: {
  staffId: string
  services: ServiceRow[]
  commissions: CommissionRow[]
}) {
  const [state, setState] = useState<Record<string, CommissionState>>(() =>
    initState(services, commissions)
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const set = (serviceId: string, patch: Partial<CommissionState>) =>
    setState((prev) => ({ ...prev, [serviceId]: { ...prev[serviceId], ...patch } }))

  const save = () => {
    setStatus("idle")
    setError(null)
    startTransition(async () => {
      const rows = Object.entries(state)
        .filter(([, v]) => v.value !== "" && Number(v.value) > 0)
        .map(([service_id, v]) => ({
          service_id,
          commission_type: v.type,
          commission_value: Number(v.value),
        }))
      const r = await updateStaffCommissions(staffId, rows)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  // Group by category
  const categories = [...new Set(services.map((s) => s.category ?? "Sin categoría"))]

  if (services.length === 0) {
    return (
      <div className="adm-card" style={{ padding: 24, marginTop: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 8 }}>Comisiones</h3>
        <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>No hay servicios activos.</p>
      </div>
    )
  }

  return (
    <div className="adm-card" style={{ padding: 24, marginTop: 24 }}>
      <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
        Comisiones por servicio
      </h3>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
        Definí el porcentaje o monto fijo que recibe esta profesional por cada servicio. Dejá en blanco si no aplica.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {categories.map((cat) => (
          <div key={cat}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
              {cat}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {services.filter((s) => (s.category ?? "Sin categoría") === cat).map((s) => {
                const c = state[s.id]
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, minWidth: 180, flex: 1 }}>{s.name}</span>
                    <select
                      className="adm-select"
                      value={c.type}
                      onChange={(e) => { set(s.id, { type: e.target.value as "percentage" | "fixed" }); setStatus("idle") }}
                      style={{ fontSize: 13, width: 110 }}
                    >
                      <option value="percentage">Porcentaje</option>
                      <option value="fixed">Monto fijo</option>
                    </select>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {c.type === "fixed" && (
                        <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>$</span>
                      )}
                      <input
                        type="number"
                        min="0"
                        max={c.type === "percentage" ? 100 : undefined}
                        step={c.type === "percentage" ? 1 : 100}
                        value={c.value}
                        placeholder="—"
                        onChange={(e) => { set(s.id, { value: e.target.value }); setStatus("idle") }}
                        className="adm-select"
                        style={{ fontSize: 13, width: 90, textAlign: "right" }}
                      />
                      {c.type === "percentage" && (
                        <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>%</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ paddingTop: 20, borderTop: "1px solid var(--line)", marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar comisiones"}
        </button>
        {status === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
        {status === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}
