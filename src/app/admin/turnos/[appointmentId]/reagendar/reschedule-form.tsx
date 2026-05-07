"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  DOW_NAMES,
  DOW_SHORT,
  MONTH_NAMES,
  filterFutureSlots,
  generateAvailability,
  pad2,
  parseYmd,
  ymd,
  combineDateTime,
} from "@/app/reserva/data"
import { rescheduleAppointment } from "@/app/admin/actions"

import type { BusinessHour } from "@/app/reserva/data"

type Props = {
  appointmentId: string
  clientName: string
  serviceNames: string[]
  currentStartsAt: string
  durationMin: number
  businessHours: BusinessHour[]
}

export default function AdminRescheduleForm({
  appointmentId,
  clientName,
  serviceNames,
  currentStartsAt,
  durationMin,
  businessHours,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [today] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [availability] = useState(() => generateAvailability(90, businessHours))

  const currentDate = new Date(currentStartsAt)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay()
  const firstDayOffset = (firstDayRaw + 6) % 7
  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())

  const selectDay = (d: number) => {
    setSelectedDate(`${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`)
    setSelectedTime(null)
  }

  const rawSlots = selectedDate ? availability[selectedDate] || [] : []
  const slots = selectedDate ? filterFutureSlots(selectedDate, rawSlots) : []
  const selectedDateObj = selectedDate ? parseYmd(selectedDate) : null

  const fmtCurrent = currentDate.toLocaleString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  })

  const confirm = () => {
    if (!selectedDate || !selectedTime) return
    setError(null)
    const iso = combineDateTime(selectedDate, selectedTime).toISOString()
    startTransition(async () => {
      const r = await rescheduleAppointment(appointmentId, iso)
      if (r.ok) {
        router.push("/admin/turnos")
        router.refresh()
      } else {
        setError(r.error ?? "Error al reagendar")
      }
    })
  }

  return (
    <div style={{ marginTop: 24 }}>
      {/* Turno actual */}
      <div className="adm-card" style={{ marginBottom: 24 }}>
        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mute)", margin: "0 0 4px" }}>
            Fecha actual
          </p>
          <p style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 500, margin: "0 0 4px" }}>
            {fmtCurrent}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: 0 }}>
            {serviceNames.join(" · ")} · {durationMin} min
          </p>
        </div>
      </div>

      <p className="adm-lede" style={{ marginBottom: 20 }}>
        Elegí la nueva fecha y horario para <strong>{clientName}</strong>. Se enviará un email de aviso automáticamente.
      </p>

      {/* Calendar */}
      <div className="adm-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 500, margin: 0 }}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="adm-btn"
              disabled={!canPrev}
              onClick={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) }
                else setViewMonth(viewMonth - 1)
              }}
            >
              ‹
            </button>
            <button
              className="adm-btn"
              onClick={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
                else setViewMonth(viewMonth + 1)
              }}
            >
              ›
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, textAlign: "center" }}>
          {DOW_SHORT.map((d) => (
            <div key={d} style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-mute)", padding: "4px 0" }}>
              {d}
            </div>
          ))}
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div key={"e" + i} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`
            const isSel = selectedDate === dateStr
            const isToday = dateStr === ymd(today)
            const dateObj = new Date(viewYear, viewMonth, day)
            const isPast = dateObj < today && !isToday
            const hasSlots =
              !!availability[dateStr] &&
              !isPast &&
              filterFutureSlots(dateStr, availability[dateStr]).length > 0
            return (
              <button
                key={day}
                disabled={!hasSlots || isPast}
                onClick={() => selectDay(day)}
                style={{
                  padding: "8px 4px",
                  borderRadius: 8,
                  border: isSel ? "2px solid var(--gold)" : "2px solid transparent",
                  background: isSel ? "var(--gold)" : hasSlots ? "var(--linen)" : "transparent",
                  color: isSel ? "#fff" : isPast ? "var(--ink-faint)" : hasSlots ? "var(--ink)" : "var(--ink-faint)",
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  cursor: hasSlots && !isPast ? "pointer" : "default",
                  fontWeight: isToday ? 700 : 400,
                  opacity: isPast ? 0.35 : 1,
                }}
              >
                {day}
              </button>
            )
          })}
        </div>
      </div>

      {/* Time slots */}
      {selectedDate && selectedDateObj && (
        <div className="adm-card" style={{ padding: 20, marginBottom: 24 }}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>
            {DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]}{" "}
            {selectedDateObj.getDate()} de{" "}
            {MONTH_NAMES[selectedDateObj.getMonth()].toLowerCase()}
            <span style={{ fontFamily: "var(--sans)", fontSize: 12, color: "var(--ink-mute)", marginLeft: 8 }}>
              {slots.length} horarios
            </span>
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {slots.map((t) => (
              <button
                key={t}
                className={`adm-btn ${selectedTime === t ? "adm-btn--primary" : ""}`}
                onClick={() => setSelectedTime(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedDate && (
        <p style={{ fontSize: 13, color: "var(--ink-mute)", margin: "0 0 24px" }}>
          Seleccioná un día para ver los horarios disponibles.
        </p>
      )}

      {error && (
        <div role="alert" style={{ padding: "12px 16px", background: "#fdf0ee", borderRadius: 10, fontSize: 13, color: "#8c463c", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={!selectedDate || !selectedTime || pending}
          onClick={confirm}
        >
          {pending ? "Guardando…" : "Confirmar nuevo horario"}
        </button>
        <a href="/admin/turnos" className="adm-btn">
          Cancelar
        </a>
        {selectedDate && selectedTime && selectedDateObj && (
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            {DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]} {selectedDateObj.getDate()} · {selectedTime}hs
          </span>
        )}
      </div>
    </div>
  )
}
