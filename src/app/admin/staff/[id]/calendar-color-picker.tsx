"use client"

import { useState, useTransition } from "react"
import { updateStaffCalendarColor } from "../../actions"
import CalendarColorSwatches, { calendarColorHex, calendarColorName } from "../../_components/calendar-color-swatches"

export default function CalendarColorPicker({
  staffId,
  initialColorId,
}: {
  staffId: string
  initialColorId: string | null
}) {
  const [selected, setSelected] = useState<string | null>(initialColorId)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")

  const save = (colorId: string | null) => {
    setSelected(colorId)
    setStatus("idle")
    startTransition(async () => {
      const r = await updateStaffCalendarColor(staffId, colorId)
      if (r.ok) setStatus("saved")
      else setStatus("error")
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24, marginTop: 24 }}>
      <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
        Color en Google Calendar
      </h3>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
        Los turnos de esta profesional aparecen con este color en el calendario, salvo que
        el tratamiento tenga uno propio: <strong>el color del servicio pesa más</strong>.
      </p>

      <div style={{ marginBottom: 16 }}>
        <CalendarColorSwatches value={selected} onChange={save} disabled={pending} />
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-mute)", display: "flex", alignItems: "center", gap: 8 }}>
        {selected ? (
          <>
            <span
              style={{
                display: "inline-block", width: 12, height: 12, borderRadius: "50%",
                background: calendarColorHex(selected) ?? undefined,
              }}
            />
            {calendarColorName(selected)}
          </>
        ) : (
          "Color por defecto del calendario"
        )}
        {pending && <span style={{ marginLeft: 8 }}>Guardando…</span>}
        {status === "saved" && !pending && <span style={{ color: "#4d6b3e", marginLeft: 8 }}>✓ Guardado</span>}
        {status === "error" && !pending && <span style={{ color: "#8c463c", marginLeft: 8 }}>No se pudo guardar</span>}
      </div>
    </div>
  )
}
