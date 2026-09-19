"use client"

import { useState, useTransition } from "react"
import { updateCategoryCalendarColors } from "../../actions"
import CalendarColorSwatches, { calendarColorHex, calendarColorName } from "../../_components/calendar-color-swatches"
import type { ColorCategoryRow } from "./page"

export default function CategoryColorsEditor({ categories }: { categories: ColorCategoryRow[] }) {
  // Los colores en edición (category_id → color). Se guardan todos juntos.
  const [state, setState] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, c.calendar_color_id]))
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const set = (categoryId: string, colorId: string | null) => {
    setState((prev) => ({ ...prev, [categoryId]: colorId }))
    setStatus("idle")
  }

  const save = () => {
    setStatus("idle")
    setError(null)
    startTransition(async () => {
      // Sólo lo que cambió: si no tocó nada, no se escribe nada.
      const rows = categories
        .filter((c) => state[c.id] !== c.calendar_color_id)
        .map((c) => ({ categoryId: c.id, colorId: state[c.id] ?? null }))
      if (rows.length === 0) { setStatus("saved"); return }
      const r = await updateCategoryCalendarColors(rows)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  const changedCount = categories.filter((c) => state[c.id] !== c.calendar_color_id).length

  if (categories.length === 0) {
    return (
      <div className="adm-card" style={{ padding: 24 }}>
        <div className="adm-empty">No hay categorías cargadas todavía.</div>
      </div>
    )
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
        Elegí un color por categoría. El color de la categoría <strong>pesa más</strong> que el de
        la profesional: sin color, el turno toma el de quien lo atiende.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {categories.map((c) => {
          const colorId = state[c.id]
          const changed = colorId !== c.calendar_color_id
          return (
            <div key={c.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block", width: 16, height: 16, borderRadius: "50%",
                    background: calendarColorHex(colorId) ?? "#e5dac9",
                    border: "1px solid var(--line-strong)",
                  }}
                />
                <span style={{ fontSize: 14, fontFamily: "var(--serif)" }}>{c.name}</span>
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  {calendarColorName(colorId) ?? "Sin color"}
                </span>
                {changed && <span style={{ fontSize: 11, color: "var(--gold)" }}>· sin guardar</span>}
              </div>

              <CalendarColorSwatches
                value={colorId}
                onChange={(col) => set(c.id, col)}
                disabled={pending}
              />

              {c.services.length > 0 && (
                <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 8 }}>
                  {c.services.length} tratamiento{c.services.length > 1 ? "s" : ""}: {c.services.join(" · ")}
                </p>
              )}
              {c.services.length === 0 && (
                <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 8 }}>
                  Sin tratamientos activos todavía.
                </p>
              )}
            </div>
          )
        })}
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
