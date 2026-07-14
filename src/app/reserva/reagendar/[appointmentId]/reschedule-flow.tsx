"use client"

import { useEffect, useState, useTransition } from "react"
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
} from "../../data"
import { Icon, Wordmark } from "../../primitives"
import { rescheduleMyAppointment, fetchRescheduleSlots } from "@/app/portal/actions"

import type { BusinessHour } from "../../data"

type Props = {
  appointmentId: string
  firstName: string
  serviceNames: string[]
  currentStartsAt: string
  durationMin: number
  businessHours: BusinessHour[]
}

export default function RescheduleFlow({
  appointmentId,
  firstName,
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
  // Sólo horario comercial (sin mirar turnos existentes): se usa nada más
  // para saber qué DÍAS mostrar como "con horarios" en el calendario. La
  // lista REAL de horarios de un día (`slotsForDay`, más abajo) viene del
  // servidor vía `fetchRescheduleSlots` — ésa sí mira los turnos existentes
  // y es la autoridad. Antes esta pantalla ofrecía horarios ya ocupados: el
  // click confirmaba igual, porque el servidor nunca los revalidaba.
  const [availability] = useState(() => generateAvailability(60, businessHours))

  const currentDate = new Date(currentStartsAt)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  // Resultado del último día efectivamente consultado al servidor, con su
  // fecha adjunta: mientras `selectedDate` no coincida con `slotsResult.date`
  // (recién elegido un día nuevo, todavía sin respuesta) se considera
  // "cargando" — derivado en el render, sin un estado aparte que haya que
  // sincronizar a mano. `error` (turno no encontrado/ajeno/sin servicios/etc)
  // viaja en el mismo objeto: antes se perdía en silencio y la pantalla se
  // quedaba en "Buscando…" para siempre.
  const [slotsResult, setSlotsResult] = useState<{ date: string; slots: string[]; error?: string } | null>(null)

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay()
  const firstDayOffset = (firstDayRaw + 6) % 7
  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())

  const selectDay = (d: number) => {
    const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`
    setSelectedDate(dateStr)
    setSelectedTime(null)
  }

  // Horarios REALES del día elegido, calculados por el servidor (autoritativo)
  // vía `fetchRescheduleSlots`: verifica que el turno sea de esta clienta y
  // recién ahí llama a `fetchDayAvailability` con la exclusión de este mismo
  // turno — a diferencia de llamar a `fetchDayAvailability` directo desde acá
  // (una acción pública, sin dueño), que dejaba a cualquiera pedirle que
  // ignore CUALQUIER turno.
  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false
    fetchRescheduleSlots(appointmentId, selectedDate).then((res) => {
      if (cancelled) return
      if (res.ok) {
        setSlotsResult({ date: selectedDate, slots: res.slots })
      } else {
        setSlotsResult({ date: selectedDate, slots: [], error: res.error })
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedDate, appointmentId])

  const loadingSlots = selectedDate !== null && slotsResult?.date !== selectedDate
  const slotsForDay = slotsResult && slotsResult.date === selectedDate ? slotsResult.slots : []
  const slotsError = slotsResult && slotsResult.date === selectedDate ? slotsResult.error ?? null : null
  const selectedDateObj = selectedDate ? parseYmd(selectedDate) : null

  const fmtCurrent = currentDate.toLocaleString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })

  const confirm = () => {
    if (!selectedDate || !selectedTime) return
    setError(null)
    const newStartsAt = combineDateTime(selectedDate, selectedTime).toISOString()
    startTransition(async () => {
      const r = await rescheduleMyAppointment(appointmentId, newStartsAt)
      if (r.ok) {
        router.push("/portal")
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <div className="blv" style={{ minHeight: "100vh", padding: "32px 20px 120px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-crop.png" alt="By Leri Vendler" style={{ height: 44, width: "auto" }} />
          <a href="/portal" style={{ fontSize: 13, color: "var(--ink-soft)", textDecoration: "underline", textUnderlineOffset: 3 }}>
            Volver
          </a>
        </div>

        <p className="eyebrow">Reagendar turno</p>
        <h1 className="headline">
          {firstName ? <>Elegí tu nueva <em>fecha</em>, {firstName}.</> : <>Elegí tu nueva <em>fecha</em>.</>}
        </h1>

        {/* Current appointment card */}
        <div style={{ background: "var(--linen)", borderRadius: 12, padding: "16px 20px", marginBottom: 28 }}>
          <p style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-mute)", margin: "0 0 4px" }}>
            Turno actual
          </p>
          <p style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500, margin: "0 0 4px" }}>
            {fmtCurrent}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: 0 }}>
            {serviceNames.join(" · ")} · {durationMin} min
          </p>
        </div>

        {/* Calendar */}
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
                <Icon.ChevL />
              </button>
              <button
                className="cal__arrow"
                onClick={() => {
                  if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) }
                  else setViewMonth(viewMonth + 1)
                }}
              >
                <Icon.ChevR />
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
                  className={`cal__day ${hasSlots ? "cal__day--available" : ""} ${isSel ? "cal__day--selected" : ""} ${isToday ? "cal__day--today" : ""}`}
                  disabled={!hasSlots || isPast}
                  onClick={() => selectDay(day)}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>

        {/* Time slots */}
        {selectedDate && selectedDateObj && (
          <div className="slots" style={{ marginTop: 20 }}>
            <div className="slots__head">
              <h3 className="slots__title">
                {DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]}{" "}
                <em>
                  {selectedDateObj.getDate()} de{" "}
                  {MONTH_NAMES[selectedDateObj.getMonth()].toLowerCase()}
                </em>
              </h3>
              <span className="slots__count">
                {loadingSlots ? "Buscando…" : slotsError ? "" : `${String(slotsForDay.length).padStart(2, "0")} horarios`}
              </span>
            </div>
            {slotsError ? (
              <p role="alert" style={{ fontSize: 13, color: "#8c463c", background: "#fdf0ee", borderRadius: 10, padding: "12px 16px" }}>
                {slotsError}
              </p>
            ) : (
              <div className="slots__grid">
                {!loadingSlots && slotsForDay.map((t) => (
                  <button
                    key={t}
                    className={`slot ${selectedTime === t ? "is-selected" : ""}`}
                    onClick={() => setSelectedTime(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!selectedDate && (
          <p style={{ fontSize: 13, color: "var(--ink-mute)", textAlign: "center", padding: "24px 0" }}>
            Elegí un día para ver horarios disponibles.
          </p>
        )}

        {error && (
          <div role="alert" style={{ marginTop: 16, padding: "12px 16px", background: "#fdf0ee", borderRadius: 10, fontSize: 13, color: "#8c463c" }}>
            {error}
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="footer">
        <div className="footer__row">
          <div className="footer__summary">
            {selectedDate && selectedTime && selectedDateObj ? (
              <span>
                <strong>
                  {DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]}{" "}
                  {selectedDateObj.getDate()}
                </strong>{" "}
                · {selectedTime}hs
              </span>
            ) : (
              "Seleccioná día y horario"
            )}
          </div>
          <button
            className="btn btn--primary"
            disabled={!selectedDate || !selectedTime || pending}
            onClick={confirm}
          >
            {pending ? "Guardando…" : "Confirmar cambio"}
            {!pending && (
              <span className="btn__arrow">
                <Icon.Arrow />
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
