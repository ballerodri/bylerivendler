"use client"

import { useState, useTransition } from "react"
import { updateStaffCalendarColor } from "../../actions"

const COLORS: { id: string; name: string; hex: string }[] = [
  { id: "1",  name: "Lavanda",    hex: "#7986CB" },
  { id: "2",  name: "Salvia",     hex: "#33B679" },
  { id: "3",  name: "Uva",        hex: "#8E24AA" },
  { id: "4",  name: "Flamingo",   hex: "#E67C73" },
  { id: "5",  name: "Banana",     hex: "#F6BF26" },
  { id: "6",  name: "Mandarina",  hex: "#F4511E" },
  { id: "7",  name: "Pavo real",  hex: "#039BE5" },
  { id: "8",  name: "Grafito",    hex: "#616161" },
  { id: "9",  name: "Arándano",   hex: "#3F51B5" },
  { id: "10", name: "Albahaca",   hex: "#0B8043" },
  { id: "11", name: "Tomate",     hex: "#D50000" },
]

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
        Los turnos de esta profesional aparecerán con este color en el calendario.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        {/* Sin color */}
        <button
          title="Sin color"
          onClick={() => save(null)}
          disabled={pending}
          style={{
            width: 32, height: 32, borderRadius: "50%",
            background: "#e5dac9",
            border: selected === null ? "3px solid var(--ink)" : "2px solid transparent",
            cursor: "pointer",
            position: "relative",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--ink-mute)" }}>—</span>
        </button>

        {COLORS.map((c) => (
          <button
            key={c.id}
            title={c.name}
            onClick={() => save(c.id)}
            disabled={pending}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: c.hex,
              border: selected === c.id ? "3px solid var(--ink)" : "2px solid transparent",
              outline: selected === c.id ? `2px solid ${c.hex}` : "none",
              outlineOffset: 2,
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      <div style={{ fontSize: 12, color: "var(--ink-mute)", display: "flex", alignItems: "center", gap: 8 }}>
        {selected ? (
          <>
            <span
              style={{
                display: "inline-block", width: 12, height: 12, borderRadius: "50%",
                background: COLORS.find((c) => c.id === selected)?.hex,
              }}
            />
            {COLORS.find((c) => c.id === selected)?.name}
          </>
        ) : (
          "Color por defecto del calendario"
        )}
        {pending && <span style={{ marginLeft: 8 }}>Guardando…</span>}
        {status === "saved" && !pending && <span style={{ color: "#4d6b3e", marginLeft: 8 }}>✓ Guardado</span>}
      </div>
    </div>
  )
}
