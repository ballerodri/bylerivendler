"use client"

import { useState, useEffect } from "react"
import { fetchDayAvailability } from "../actions"
import {
  generateAvailability,
  filterFutureSlots,
  MONTH_NAMES,
  DOW_SHORT,
  DOW_NAMES,
  pad2,
  ymd,
  parseYmd,
  slotToUtcMs,
  type BusinessHour,
} from "../data"

/**
 * Elige fecha y hora de UNA sesión de pack. Se usa al comprar el pack y desde
 * el admin. Bloquea todo lo anterior a `minDate` (la regla del intervalo) y
 * sólo ofrece horarios realmente libres (los pide al servidor).
 */
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  minDate,
  onPick,
  onCancel,
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
  minDate: Date | null
  onPick: (startsAtIso: string) => void
  onCancel: () => void
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [availability] = useState(() => generateAvailability(60, businessHours))
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // El día mínimo permitido (por la regla del intervalo). Si no hay, hoy.
  const minDay = (() => {
    if (!minDate) return today
    const d = new Date(minDate)
    d.setHours(0, 0, 0, 0)
    return d > today ? d : today
  })()

  useEffect(() => {
    if (!selectedDate) { setSlots([]); return }
    const candidates = filterFutureSlots(selectedDate, availability[selectedDate] ?? [])
    if (!candidates.length) { setSlots([]); return }
    let cancelled = false
    setLoading(true)
    fetchDayAvailability(selectedDate, durationMin, proHint, candidates).then((free) => {
      if (cancelled) return
      // Además del cupo, respetar el mínimo exacto (hora incluida) del intervalo.
      const okByInterval = minDate
        ? free.filter((t) => slotToUtcMs(selectedDate, t) >= minDate.getTime())
        : free
      setSlots(okByInterval)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedDate, durationMin, proHint, availability, minDate])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())
  const selectedObj = selectedDate ? parseYmd(selectedDate) : null

  return (
    <div>
      <div className="cal">
        <div className="cal__monthnav">
          <h2 className="cal__monthname">
            {MONTH_NAMES[viewMonth]} <span>{viewYear}</span>
          </h2>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              className="cal__arrow"
              disabled={!canPrev}
              onClick={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
                else setViewMonth(viewMonth - 1)
              }}
            >
              ‹
            </button>
            <button
              className="cal__arrow"
              onClick={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
                else setViewMonth(viewMonth + 1)
              }}
            >
              ›
            </button>
          </div>
        </div>

        <div className="cal__grid">
          {DOW_SHORT.map((d) => (
            <div key={d} className="cal__dowheader">{d}</div>
          ))}
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div key={"e" + i} className="cal__day cal__day--empty" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`
            const dateObj = new Date(viewYear, viewMonth, day)
            const isSel = selectedDate === dateStr
            const isToday = dateStr === ymd(today)
            const tooEarly = dateObj < minDay
            const hasSlots =
              !tooEarly &&
              !!availability[dateStr] &&
              filterFutureSlots(dateStr, availability[dateStr]).length > 0
            return (
              <button
                key={day}
                className={`cal__day ${hasSlots ? "cal__day--available" : ""} ${
                  isSel ? "cal__day--selected" : ""
                } ${isToday ? "cal__day--today" : ""}`}
                disabled={!hasSlots}
                onClick={() => setSelectedDate(dateStr)}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      <div className="slots">
        {!selectedDate || !selectedObj ? (
          <p style={{ fontSize: 12, color: "var(--ink-mute)", textAlign: "center", padding: "24px 0" }}>
            Elegí un día para ver horarios disponibles.
          </p>
        ) : (
          <>
            <div className="slots__head">
              <h3 className="slots__title">
                {DOW_NAMES[(selectedObj.getDay() + 6) % 7]}{" "}
                <em>{selectedObj.getDate()} de {MONTH_NAMES[selectedObj.getMonth()].toLowerCase()}</em>
              </h3>
            </div>
            {loading ? (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "16px 0" }}>
                Verificando disponibilidad…
              </p>
            ) : slots.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "16px 0" }}>
                No hay horarios disponibles ese día. Probá con otro.
              </p>
            ) : (
              <div className="slots__grid">
                {slots.map((t) => (
                  <button
                    key={t}
                    className="slot"
                    onClick={() => onPick(new Date(slotToUtcMs(selectedDate, t)).toISOString())}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <button className="btn" onClick={onCancel} style={{ marginTop: 12 }}>
        Cancelar
      </button>
    </div>
  )
}
