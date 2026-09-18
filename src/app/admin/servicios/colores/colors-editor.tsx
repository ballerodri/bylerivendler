"use client"

import { useState, useTransition } from "react"
import { updateServiceCalendarColors } from "../../actions"
import CalendarColorSwatches, { calendarColorHex, calendarColorName } from "../../_components/calendar-color-swatches"
import type { ColorServiceRow } from "./page"

export default function ServiceColorsEditor({ services }: { services: ColorServiceRow[] }) {
  // Los colores en edición (service_id → color). Se guardan todos juntos.
  const [state, setState] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(services.map((s) => [s.id, s.calendar_color_id]))
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  // Qué fila está mostrando la paleta (una por vez: 20 paletas abiertas serían
  // una pared de círculos).
  const [openFor, setOpenFor] = useState<string | null>(null)

  const set = (serviceId: string, colorId: string | null) => {
    setState((prev) => ({ ...prev, [serviceId]: colorId }))
    setStatus("idle")
    setOpenFor(null)
  }

  const save = () => {
    setStatus("idle")
    setError(null)
    startTransition(async () => {
      // Sólo lo que cambió: si no tocó nada, no se escribe nada.
      const rows = services
        .filter((s) => state[s.id] !== s.calendar_color_id)
        .map((s) => ({ serviceId: s.id, colorId: state[s.id] ?? null }))
      if (rows.length === 0) { setStatus("saved"); return }
      const r = await updateServiceCalendarColors(rows)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  const changedCount = services.filter((s) => state[s.id] !== s.calendar_color_id).length
  const categories = [...new Set(services.map((s) => s.category ?? "Sin categoría"))]

  if (services.length === 0) {
    return (
      <div className="adm-card" style={{ padding: 24 }}>
        <div className="adm-empty">No hay servicios activos para colorear.</div>
      </div>
    )
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
        Tocá el círculo de cada tratamiento para elegir su color, y al final <strong>Guardar colores</strong>.
        El color del servicio <strong>pesa más</strong> que el de la profesional: sin color propio, el turno
        toma el de quien lo atiende.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {categories.map((cat) => (
          <div key={cat}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
              {cat}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {services.filter((s) => (s.category ?? "Sin categoría") === cat).map((s) => {
                const colorId = state[s.id]
                const changed = colorId !== s.calendar_color_id
                const isOpen = openFor === s.id
                return (
                  <div key={s.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, flex: 1, minWidth: 180 }}>
                        {s.name}
                        {changed && <span style={{ fontSize: 11, color: "var(--gold)", marginLeft: 8 }}>· sin guardar</span>}
                      </span>
                      <button
                        type="button"
                        className="adm-btn"
                        onClick={() => setOpenFor(isOpen ? null : s.id)}
                        disabled={pending}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block", width: 14, height: 14, borderRadius: "50%",
                            background: calendarColorHex(colorId) ?? "#e5dac9",
                            border: "1px solid var(--line-strong)",
                          }}
                        />
                        {calendarColorName(colorId) ?? "Sin color"}
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ marginTop: 10 }}>
                        <CalendarColorSwatches
                          value={colorId}
                          onChange={(c) => set(s.id, c)}
                          disabled={pending}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar colores"}
        </button>
        {changedCount > 0 && !pending && (
          <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            {changedCount} cambio{changedCount > 1 ? "s" : ""} sin guardar
          </span>
        )}
        {status === "saved" && !pending && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
        {status === "error" && !pending && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}
