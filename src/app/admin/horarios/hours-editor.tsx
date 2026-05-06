"use client"

import { useState, useTransition } from "react"
import { updateBusinessHours } from "../actions"

type BusinessHour = { day_of_week: number; is_open: boolean; slots: string[] }

// Franjas disponibles cada 30 min de 08:00 a 21:00
const ALL_SLOTS: string[] = []
for (let h = 8; h <= 21; h++) {
  ALL_SLOTS.push(`${String(h).padStart(2, "0")}:00`)
  if (h < 21) ALL_SLOTS.push(`${String(h).padStart(2, "0")}:30`)
}

export default function HoursEditor({
  hours,
  dayNames,
}: {
  hours: BusinessHour[]
  dayNames: string[]
}) {
  const [data, setData] = useState<BusinessHour[]>(hours)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (dow: number) => {
    setData((prev) =>
      prev.map((d) => (d.day_of_week === dow ? { ...d, is_open: !d.is_open } : d))
    )
    setStatus("idle")
  }

  const toggleSlot = (dow: number, slot: string) => {
    setData((prev) =>
      prev.map((d) => {
        if (d.day_of_week !== dow) return d
        const slots = d.slots.includes(slot)
          ? d.slots.filter((s) => s !== slot)
          : [...d.slots, slot].sort()
        return { ...d, slots }
      })
    )
    setStatus("idle")
  }

  const save = () => {
    setError(null)
    setStatus("idle")
    startTransition(async () => {
      const r = await updateBusinessHours(data)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  return (
    <div>
      {data.map((day) => (
        <div key={day.day_of_week} className="adm-card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: day.is_open ? 16 : 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={day.is_open}
                onChange={() => toggleDay(day.day_of_week)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500 }}>
                {dayNames[day.day_of_week]}
              </span>
            </label>
            {!day.is_open && (
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>Cerrado</span>
            )}
            {day.is_open && (
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {day.slots.length} {day.slots.length === 1 ? "franja" : "franjas"} activas
              </span>
            )}
          </div>

          {day.is_open && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ALL_SLOTS.map((slot) => {
                const active = day.slots.includes(slot)
                return (
                  <button
                    key={slot}
                    onClick={() => toggleSlot(day.day_of_week, slot)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 20,
                      border: `1px solid ${active ? "var(--ink)" : "var(--line)"}`,
                      background: active ? "var(--ink)" : "transparent",
                      color: active ? "var(--linen)" : "var(--ink-mute)",
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {slot}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar horarios"}
        </button>
        {status === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
        {status === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}
