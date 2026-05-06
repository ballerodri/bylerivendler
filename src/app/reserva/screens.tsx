"use client"

import { useEffect, useState } from "react"
import {
  DOW_NAMES,
  DOW_SHORT,
  MONTH_NAMES,
  combineDateTime,
  filterFutureSlots,
  fmtDuration,
  fmtPrice,
  formatDob,
  generateAvailability,
  pad2,
  parseYmd,
  ymd,
} from "./data"
import type { BookingState, Category, Professional, Service } from "./data"
import { Check, Icon, Progress, TopBar, Wordmark } from "./primitives"
import { createBooking } from "./actions"
import { sendMagicLink, signInWithGoogle } from "../login/actions"
import { whatsappLink } from "@/lib/whatsapp"
import { ADDRESS_LINE, ADDRESS_AREA, MAPS_LINK } from "@/lib/location"

type Variant = "mobile" | "desktop"

type ScreenProps = {
  state: BookingState
  setState: (s: BookingState) => void
  onNext: () => void
  onBack: () => void
  onClose: () => void
  variant: Variant
  stepNumber: number
  totalSteps: number
}

const stepLabel = (n: number, label: string) =>
  `Paso ${String(n).padStart(2, "0")} — ${label}`

// ---------- Screen 1: Services ----------
export function Screen1Services({
  state,
  setState,
  onNext,
  onClose,
  variant,
  stepNumber,
  totalSteps,
  categories,
  knownFirstName,
}: ScreenProps & { categories: Category[]; knownFirstName: string | null }) {
  const fallbackCat = categories[0]?.id ?? "facial"
  const [activeCat, setActiveCat] = useState(state.activeCat || fallbackCat)
  const selected = state.services || []

  const toggle = (svc: Service) => {
    const exists = selected.find((s) => s.id === svc.id)
    const next = exists ? selected.filter((s) => s.id !== svc.id) : [...selected, svc]
    setState({ ...state, services: next, activeCat })
  }

  const total = selected.reduce((a, s) => a + s.price, 0)
  const totalMin = selected.reduce((a, s) => a + s.duration, 0)
  const activeCategory =
    categories.find((c) => c.id === activeCat) ?? categories[0]
  if (!activeCategory) {
    return (
      <div className="screen">
        <div className="screen__body">
          <p className="lede">No hay tratamientos disponibles en este momento.</p>
        </div>
      </div>
    )
  }

  const Hero = () => (
    <div className="hero">
      <div className="hero__img" />
      <div className="hero__content">
        <p className="eyebrow">
          {knownFirstName ? `Hola, ${knownFirstName}` : "Reservá tu turno"}
        </p>
        <h1 className="headline">
          {knownFirstName ? (
            <>
              ¿Qué te <em>regalás</em> hoy?
            </>
          ) : (
            <>
              Un <em>ritual</em> a tu medida.
            </>
          )}
        </h1>
        <p className="lede">
          Elegí uno o varios tratamientos. Podés combinar categorías; ajustamos
          la duración en tu ficha.
        </p>
      </div>
    </div>
  )

  const CatTabs = () => (
    <div className="cattabs" role="tablist">
      {categories.map((c) => (
        <button
          key={c.id}
          role="tab"
          className={`cattab ${activeCat === c.id ? "is-active" : ""}`}
          onClick={() => setActiveCat(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  )

  const ServiceList = () => (
    <div className="svc-group">
      <div className="svc-group__head">
        <h2 className="svc-group__title">
          {activeCategory.name} <em>— {activeCategory.tagline}</em>
        </h2>
        <span className="svc-group__count">
          {String(activeCategory.services.length).padStart(2, "0")}
        </span>
      </div>
      {activeCategory.services.map((s) => {
        const isSel = !!selected.find((x) => x.id === s.id)
        return (
          <button
            key={s.id}
            className={`svc ${isSel ? "is-selected" : ""}`}
            onClick={() => toggle(s)}
          >
            <div className="svc__top">
              <div style={{ paddingRight: 28, flex: 1 }}>
                <h3 className="svc__name">{s.name}</h3>
                <div className="svc__meta">
                  <Icon.Clock />
                  <span>{fmtDuration(s.duration)}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="svc__price">{fmtPrice(s.price)}</div>
                {s.pointsCost > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--gold)",
                      letterSpacing: "0.04em",
                      marginTop: 2,
                    }}
                  >
                    o {s.pointsCost} pts
                  </div>
                )}
              </div>
            </div>
            <p className="svc__desc">{s.desc}</p>
            <span className="svc__check">
              <Icon.CheckSmall />
            </span>
          </button>
        )
      })}
    </div>
  )

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <div>
          <div className="footer__summary">
            {selected.length === 0 ? (
              "Sin tratamientos seleccionados"
            ) : (
              <span>
                <strong>{selected.length}</strong> tratamiento
                {selected.length > 1 ? "s" : ""} · {fmtDuration(totalMin)}
              </span>
            )}
          </div>
          {selected.length > 0 && (
            <div className="footer__total">{fmtPrice(total)}</div>
          )}
        </div>
        <button
          className="btn btn--primary"
          disabled={selected.length === 0}
          onClick={onNext}
        >
          Continuar
          <span className="btn__arrow">
            <Icon.Arrow />
          </span>
        </button>
      </div>
    </div>
  )

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner">
          <p className="eyebrow">
            {knownFirstName
              ? `Hola, ${knownFirstName}`
              : stepLabel(stepNumber, "Tratamiento")}
          </p>
          <h1 className="headline">
            {knownFirstName ? (
              <>
                ¿Qué te <em>regalás</em> hoy?
              </>
            ) : (
              <>
                Diseñá tu <em>ritual</em>.
              </>
            )}
          </h1>
          <p className="lede">
            Elegí uno o varios tratamientos. Podés combinar categorías; el
            equipo ajusta la secuencia en cabina.
          </p>
          {CatTabs()}
          {ServiceList()}
        </div>
        {FooterCTA()}
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div style={{ width: 40 }} />
        <Wordmark />
        <button className="topbar__close" onClick={onClose} aria-label="Cerrar">
          <Icon.Close />
        </button>
      </div>
      <Progress step={stepNumber} total={totalSteps} />
      <div className="screen__body">
        {Hero()}
        {CatTabs()}
        {ServiceList()}
      </div>
      {FooterCTA()}
    </div>
  )
}

// ---------- Screen 2: Date & Time ----------
export function Screen2DateTime({ state, setState, onNext, onBack, onClose, variant, stepNumber, totalSteps, professionals }: ScreenProps & { professionals: Professional[] }) {
  // `today` snapped to midnight so we compare just dates, not times.
  const [today] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  // Generate availability dynamically for the next ~60 days. Eventually this
  // will come from a server query that respects staff schedules + booked slots.
  const [availability] = useState(() => generateAvailability(60))

  const initialDate = state.selectedDate ? parseYmd(state.selectedDate) : today
  const [viewYear, setViewYear] = useState(initialDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth())

  const selectedDate = state.selectedDate
  const selectedTime = state.selectedTime
  const pro = state.pro || "auto"

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay()
  const firstDayOffset = (firstDayRaw + 6) % 7

  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())

  const selectDay = (d: number) => {
    const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`
    setState({ ...state, selectedDate: dateStr, selectedTime: null })
  }

  const selectTime = (t: string) => setState({ ...state, selectedTime: t })

  const rawSlotsForDay = selectedDate ? availability[selectedDate] || [] : []
  const slotsForDay = selectedDate
    ? filterFutureSlots(selectedDate, rawSlotsForDay)
    : []
  const selectedDateObj = selectedDate ? parseYmd(selectedDate) : null

  const Cal = () => (
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
              if (viewMonth === 0) {
                setViewMonth(11)
                setViewYear(viewYear - 1)
              } else setViewMonth(viewMonth - 1)
            }}
          >
            <Icon.ChevL />
          </button>
          <button
            className="cal__arrow"
            onClick={() => {
              if (viewMonth === 11) {
                setViewMonth(0)
                setViewYear(viewYear + 1)
              } else setViewMonth(viewMonth + 1)
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
          // Only show slots if there's still future availability for that day
          const hasSlots =
            !!availability[dateStr] &&
            !isPast &&
            filterFutureSlots(dateStr, availability[dateStr]).length > 0
          return (
            <button
              key={day}
              className={`cal__day ${hasSlots ? "cal__day--available" : ""} ${
                isSel ? "cal__day--selected" : ""
              } ${isToday ? "cal__day--today" : ""}`}
              disabled={!hasSlots || isPast}
              onClick={() => selectDay(day)}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )

  const Slots = () => {
    if (!selectedDate || !selectedDateObj) {
      return (
        <div className="slots">
          <p
            style={{
              fontSize: 12,
              color: "var(--ink-mute)",
              textAlign: "center",
              padding: "24px 0",
            }}
          >
            Elegí un día para ver horarios disponibles.
          </p>
        </div>
      )
    }
    const dowLabel = DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]
    return (
      <div className="slots">
        <div className="slots__head">
          <h3 className="slots__title">
            {dowLabel}{" "}
            <em>
              {selectedDateObj.getDate()} de{" "}
              {MONTH_NAMES[selectedDateObj.getMonth()].toLowerCase()}
            </em>
          </h3>
          <span className="slots__count">
            {String(slotsForDay.length).padStart(2, "0")} horarios
          </span>
        </div>
        <div className="slots__grid">
          {slotsForDay.map((t) => (
            <button
              key={t}
              className={`slot ${selectedTime === t ? "is-selected" : ""}`}
              onClick={() => selectTime(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const ProPicker = () => (
    <div style={{ marginTop: 24 }}>
      <p className="eyebrow">Profesional · opcional</p>
      {professionals.map((p) => (
        <button
          key={p.id}
          className={`pro-row ${pro === p.id ? "is-selected" : ""}`}
          onClick={() => setState({ ...state, pro: p.id })}
        >
          <div className="pro-avatar">{p.initials}</div>
          <div>
            <div className="pro-name">{p.name}</div>
            <div className="pro-role">{p.role}</div>
          </div>
          <div className="pro-spacer" />
          {p.id === "auto" && pro !== "auto" && (
            <span className="pro-hint">Recomendado</span>
          )}
          {pro === p.id && <Icon.CheckInk style={{ color: "var(--ink)" }} />}
        </button>
      ))}
    </div>
  )

  const FooterCTA = () => (
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
            "Seleccione día y horario"
          )}
        </div>
        <button
          className="btn btn--primary"
          disabled={!selectedDate || !selectedTime}
          onClick={onNext}
        >
          Continuar
          <span className="btn__arrow">
            <Icon.Arrow />
          </span>
        </button>
      </div>
    </div>
  )

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner">
          <p className="eyebrow">{stepLabel(stepNumber, "Fecha y horario")}</p>
          <h1 className="headline">
            ¿Cuándo te <em>esperamos</em>?
          </h1>
          <p className="lede">
            Horario de Buenos Aires (GMT-3). Los días con punto dorado son hoy.
          </p>
          <div className="dcol-2">
            {Cal()}
            <div>
              {Slots()}
              {ProPicker()}
            </div>
          </div>
        </div>
        {FooterCTA()}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={stepNumber} total={totalSteps} />
      <div className="screen__body">
        <p className="eyebrow">{stepLabel(stepNumber, "Fecha y horario")}</p>
        <h1 className="headline">
          ¿Cuándo te <em>esperamos</em>?
        </h1>
        <p className="lede">
          Horario de Buenos Aires. Los días con turnos disponibles son
          seleccionables.
        </p>
        {Cal()}
        {Slots()}
        {ProPicker()}
      </div>
      {FooterCTA()}
    </div>
  )
}

// ---------- Screen 3: Client details ----------
const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dob: "",
  consent: true,
}

export function Screen3Details({
  state,
  setState,
  onNext,
  onBack,
  onClose,
  variant,
  stepNumber,
  totalSteps,
  isAuthenticated,
  authEmail,
}: ScreenProps & { isAuthenticated: boolean; authEmail: string | null }) {
  const [mode, setMode] = useState<"new" | "existing">(state.clientMode || "new")
  const f = state.form || EMPTY_FORM
  const [linkStatus, setLinkStatus] = useState<"idle" | "sending" | "sent">("idle")
  const [linkError, setLinkError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleGoogle = async () => {
    setGoogleLoading(true)
    const r = await signInWithGoogle("/reserva")
    if (r.ok) {
      window.location.href = r.url
    } else {
      setGoogleLoading(false)
      setLinkError(r.error)
    }
  }

  const setF = (patch: Partial<typeof EMPTY_FORM>) =>
    setState({ ...state, form: { ...f, ...patch }, clientMode: mode })

  const requestMagicLink = async () => {
    setLinkStatus("sending")
    setLinkError(null)
    const r = await sendMagicLink({ email: f.email, next: "/portal" })
    if (r.ok) setLinkStatus("sent")
    else {
      setLinkStatus("idle")
      setLinkError(r.error)
    }
  }

  const isValid =
    mode === "new"
      ? !!(f.firstName && f.lastName && f.email && f.phone && f.dob && f.consent)
      : !!f.email

  useEffect(() => {
    setState({ ...state, clientMode: mode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const Segmented = () => (
    <div className="seg-radio" style={{ marginBottom: 20 }}>
      <button
        className={mode === "new" ? "is-active" : ""}
        onClick={() => setMode("new")}
      >
        Primera vez
      </button>
      <button
        className={mode === "existing" ? "is-active" : ""}
        onClick={() => setMode("existing")}
      >
        Ya soy clienta
      </button>
    </div>
  )

  const NewForm = () => (
    <>
      {/* Si ya está autenticada con Google, mostramos solo los campos faltantes */}
      {isAuthenticated ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "var(--linen)",
              borderRadius: 10,
              marginBottom: 20,
              fontSize: 13,
              color: "var(--ink-soft)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden style={{ flexShrink: 0 }}>
              <path d="M17.6 9.2c0-.6 0-1.2-.1-1.7H9v3.3h4.8c-.2 1.1-.8 2-1.7 2.6v2.2h2.7c1.6-1.5 2.5-3.7 2.5-6.4z" fill="#4285F4"/>
              <path d="M9 18c2.3 0 4.2-.8 5.6-2.1l-2.7-2.1c-.8.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H1.4v2.2C2.8 16 5.7 18 9 18z" fill="#34A853"/>
              <path d="M4.2 11.1c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6V5.6H1.4C.5 7 0 8.5 0 9.5s.5 2.5 1.4 3.9l2.8-2.3z" fill="#FBBC04"/>
              <path d="M9 3.6c1.3 0 2.4.4 3.3 1.3l2.4-2.4C13.2.9 11.3 0 9 0 5.7 0 2.8 2 1.4 4.6l2.8 2.2C5 5.1 6.8 3.6 9 3.6z" fill="#EA4335"/>
            </svg>
            <span>
              <strong>{f.firstName} {f.lastName}</strong> · {f.email}
            </span>
          </div>
          <div className="field__row">
            <div className="field">
              <label className="field__label">Teléfono</label>
              <input
                className="field__input"
                inputMode="tel"
                value={f.phone}
                onChange={(e) => setF({ phone: e.target.value })}
                placeholder="11 1234-5678"
              />
            </div>
            <div className="field">
              <label className="field__label">Fecha de nacimiento</label>
              <input
                className="field__input"
                inputMode="numeric"
                value={f.dob}
                onChange={(e) => setF({ dob: formatDob(e.target.value) })}
                placeholder="DD/MM/AAAA"
                maxLength={10}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Botón Google */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="btn btn--full"
            style={{
              background: "#fff",
              color: "var(--ink)",
              border: "1px solid var(--line-strong)",
              gap: 10,
              textTransform: "none",
              letterSpacing: "0.02em",
              fontWeight: 500,
              marginBottom: 4,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden style={{ flexShrink: 0 }}>
              <path d="M17.6 9.2c0-.6 0-1.2-.1-1.7H9v3.3h4.8c-.2 1.1-.8 2-1.7 2.6v2.2h2.7c1.6-1.5 2.5-3.7 2.5-6.4z" fill="#4285F4"/>
              <path d="M9 18c2.3 0 4.2-.8 5.6-2.1l-2.7-2.1c-.8.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H1.4v2.2C2.8 16 5.7 18 9 18z" fill="#34A853"/>
              <path d="M4.2 11.1c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6V5.6H1.4C.5 7 0 8.5 0 9.5s.5 2.5 1.4 3.9l2.8-2.3z" fill="#FBBC04"/>
              <path d="M9 3.6c1.3 0 2.4.4 3.3 1.3l2.4-2.4C13.2.9 11.3 0 9 0 5.7 0 2.8 2 1.4 4.6l2.8 2.2C5 5.1 6.8 3.6 9 3.6z" fill="#EA4335"/>
            </svg>
            {googleLoading ? "Conectando…" : "Continuar con Google"}
          </button>
          <p style={{ fontSize: 11, color: "var(--ink-mute)", textAlign: "center", margin: "0 0 16px" }}>
            Cargamos tu nombre y email automáticamente
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0 16px", color: "var(--ink-mute)", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            o completá tus datos
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>

          <div className="field__row">
            <div className="field">
              <label className="field__label">Nombre</label>
              <input className="field__input" value={f.firstName} onChange={(e) => setF({ firstName: e.target.value })} placeholder="María" />
            </div>
            <div className="field">
              <label className="field__label">Apellido</label>
              <input className="field__input" value={f.lastName} onChange={(e) => setF({ lastName: e.target.value })} placeholder="López" />
            </div>
          </div>
          <div className="field">
            <label className="field__label">Email</label>
            <input className="field__input" type="email" value={f.email} onChange={(e) => setF({ email: e.target.value })} placeholder="maria@ejemplo.com" />
          </div>
          <div className="field__row">
            <div className="field">
              <label className="field__label">Teléfono</label>
              <input className="field__input" inputMode="tel" value={f.phone} onChange={(e) => setF({ phone: e.target.value })} placeholder="11 1234-5678" />
            </div>
            <div className="field">
              <label className="field__label">Fecha de nacimiento</label>
              <input className="field__input" inputMode="numeric" value={f.dob} onChange={(e) => setF({ dob: formatDob(e.target.value) })} placeholder="DD/MM/AAAA" maxLength={10} />
            </div>
          </div>
        </>
      )}

      <div className="info-strip">
        <Icon.Info />
        <span>
          Tu fecha de nacimiento nos permite enviarte un{" "}
          <strong>obsequio sorpresa</strong> en tu mes de cumpleaños.
        </span>
      </div>

      <Check checked={!!f.consent} onChange={(v) => setF({ consent: v })}>
        Acepto recibir recordatorios de turno y novedades por email y Whatsapp.
        Puedo cancelar en cualquier momento.
      </Check>
    </>
  )

  const ExistingForm = () => {
    if (linkStatus === "sent") {
      return (
        <div className="magic">
          <p className="eyebrow">Listo</p>
          <h3 className="magic__title">Revisá tu email.</h3>
          <p className="magic__desc">
            Te enviamos un link a <strong>{f.email}</strong>. Al abrirlo entrás
            directamente a tu portal y podés reservar tu próximo turno con tus
            datos ya cargados.
          </p>
          <button
            className="linkbtn"
            onClick={() => {
              setLinkStatus("idle")
            }}
          >
            Usar otro email
          </button>
        </div>
      )
    }

    return (
      <div className="magic">
        {/* Google */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={googleLoading}
          className="btn btn--full"
          style={{
            background: "#fff",
            color: "var(--ink)",
            border: "1px solid var(--line-strong)",
            gap: 10,
            textTransform: "none",
            letterSpacing: "0.02em",
            fontWeight: 500,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden style={{ flexShrink: 0 }}>
            <path d="M17.6 9.2c0-.6 0-1.2-.1-1.7H9v3.3h4.8c-.2 1.1-.8 2-1.7 2.6v2.2h2.7c1.6-1.5 2.5-3.7 2.5-6.4z" fill="#4285F4"/>
            <path d="M9 18c2.3 0 4.2-.8 5.6-2.1l-2.7-2.1c-.8.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H1.4v2.2C2.8 16 5.7 18 9 18z" fill="#34A853"/>
            <path d="M4.2 11.1c-.2-.5-.3-1.1-.3-1.6s.1-1.1.3-1.6V5.6H1.4C.5 7 0 8.5 0 9.5s.5 2.5 1.4 3.9l2.8-2.3z" fill="#FBBC04"/>
            <path d="M9 3.6c1.3 0 2.4.4 3.3 1.3l2.4-2.4C13.2.9 11.3 0 9 0 5.7 0 2.8 2 1.4 4.6l2.8 2.2C5 5.1 6.8 3.6 9 3.6z" fill="#EA4335"/>
          </svg>
          {googleLoading ? "Conectando…" : "Continuar con Google"}
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            margin: "20px 0 16px",
            color: "var(--ink-mute)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          o con email
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>

        <p className="eyebrow" style={{ marginBottom: 8 }}>Link al correo</p>
        <div className="field" style={{ marginBottom: 12 }}>
          <input
            className="field__input"
            type="email"
            value={f.email}
            onChange={(e) => setF({ email: e.target.value })}
            placeholder="email@ejemplo.com"
          />
        </div>
        {linkError && (
          <div
            role="alert"
            style={{
              background: "var(--rose-wash)",
              border: "1px solid var(--nude)",
              color: "var(--ink)",
              padding: "10px 12px",
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.4,
              marginBottom: 12,
            }}
          >
            {linkError}
          </div>
        )}
        <button
          className="btn btn--primary btn--full"
          disabled={!f.email || linkStatus === "sending"}
          onClick={requestMagicLink}
        >
          {linkStatus === "sending" ? "Enviando…" : "Enviar enlace"}
        </button>
      </div>
    )
  }

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <div className="footer__summary">
          {mode === "new"
            ? "Tus datos son privados y encriptados"
            : "Link enviado al abrir tu email"}
        </div>
        <button className="btn btn--primary" disabled={!isValid} onClick={onNext}>
          Continuar
          <span className="btn__arrow">
            <Icon.Arrow />
          </span>
        </button>
      </div>
    </div>
  )

  const Body = () => {
    if (isAuthenticated) {
      // Logged-in. We already know who they are — just confirm the data.
      return (
        <>
          <p className="eyebrow">{stepLabel(stepNumber, "Tus datos")}</p>
          <h1 className="headline">
            Confirmá tus <em>datos</em>.
          </h1>
          <p className="lede">
            Te logueaste con <strong>{authEmail}</strong>. Revisá que el resto
            esté al día.
          </p>
          {NewForm()}
        </>
      )
    }
    return (
      <>
        <p className="eyebrow">{stepLabel(stepNumber, "Tus datos")}</p>
        {mode === "new" ? (
          <>
            <h1 className="headline">
              Un gusto <em>conocerte</em>.
            </h1>
            <p className="lede">
              Completamos tu ficha una sola vez. En las próximas reservas
              ingresás con un link al email.
            </p>
          </>
        ) : (
          <>
            <h1 className="headline">
              Te <em>estábamos</em> esperando.
            </h1>
            <p className="lede">
              Ingresá tu email y te enviamos un link para confirmar el turno.
              Sin contraseñas.
            </p>
          </>
        )}
        {Segmented()}
        {mode === "new" ? NewForm() : ExistingForm()}
      </>
    )
  }

  // Si está autenticada, siempre mostramos el footer (no hay modo "existing").
  const showFooter = isAuthenticated || mode === "new"

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner dmain--narrow">
          {Body()}
        </div>
        {showFooter && FooterCTA()}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={stepNumber} total={totalSteps} />
      <div className="screen__body">
        {Body()}
      </div>
      {showFooter && FooterCTA()}
    </div>
  )
}

// ---------- Screen 4: Medical form ----------
const EMPTY_MED = {
  allergies: [] as string[],
  allergiesOther: "",
  meds: "no" as "no" | "si",
  medsNote: "",
  pregnancy: "no" as "no" | "embarazo" | "lactancia",
  skin: [] as string[],
  consent: false,
}

export function Screen4Medical({ state, setState, onNext, onBack, onClose, variant, stepNumber, totalSteps }: ScreenProps) {
  const med = state.medical || EMPTY_MED
  const setM = (patch: Partial<typeof EMPTY_MED>) =>
    setState({ ...state, medical: { ...med, ...patch } })

  const toggleArr = (key: "allergies" | "skin", value: string) => {
    const list = med[key] || []
    const next = list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value]
    setM({ [key]: next })
  }

  const isValid = med.consent

  const Body = () => (
    <>
      <p className="eyebrow">{stepLabel(stepNumber, "Ficha inicial")}</p>
      <h1 className="headline">
        Para <em>cuidarte</em> como merecés.
      </h1>
      <p className="lede">
        Esta ficha es confidencial y sólo la consulta el equipo profesional. La
        completás una sola vez.
      </p>

      <div className="med-group">
        <p className="med-q">
          ¿Tiene alergias conocidas?{" "}
          <em>Seleccione las que correspondan.</em>
        </p>
        <div className="chips">
          {["Ninguna", "Látex", "Perfumes", "Ácidos", "Níquel", "Frutos secos"].map(
            (a) => (
              <button
                key={a}
                className={`chip ${med.allergies.includes(a) ? "is-selected" : ""}`}
                onClick={() => toggleArr("allergies", a)}
              >
                {a}
              </button>
            )
          )}
        </div>
        <input
          className="field__input"
          style={{ marginTop: 10 }}
          value={med.allergiesOther}
          onChange={(e) => setM({ allergiesOther: e.target.value })}
          placeholder="Otra alergia (opcional)"
        />
      </div>

      <div className="med-group">
        <p className="med-q">¿Toma medicación actualmente?</p>
        <div className="seg-radio">
          <button
            className={med.meds === "no" ? "is-active" : ""}
            onClick={() => setM({ meds: "no" })}
          >
            No
          </button>
          <button
            className={med.meds === "si" ? "is-active" : ""}
            onClick={() => setM({ meds: "si" })}
          >
            Sí
          </button>
        </div>
        {med.meds === "si" && (
          <input
            className="field__input"
            style={{ marginTop: 10 }}
            value={med.medsNote}
            onChange={(e) => setM({ medsNote: e.target.value })}
            placeholder="Indique cuál"
          />
        )}
      </div>

      <div className="med-group">
        <p className="med-q">¿Está embarazada o en período de lactancia?</p>
        <div className="seg-radio">
          <button
            className={med.pregnancy === "no" ? "is-active" : ""}
            onClick={() => setM({ pregnancy: "no" })}
          >
            No
          </button>
          <button
            className={med.pregnancy === "embarazo" ? "is-active" : ""}
            onClick={() => setM({ pregnancy: "embarazo" })}
          >
            Embarazo
          </button>
          <button
            className={med.pregnancy === "lactancia" ? "is-active" : ""}
            onClick={() => setM({ pregnancy: "lactancia" })}
          >
            Lactancia
          </button>
        </div>
      </div>

      <div className="med-group">
        <p className="med-q">¿Presenta alguna condición cutánea?</p>
        <div className="chips">
          {[
            "Acné activo",
            "Rosácea",
            "Dermatitis",
            "Piel sensible",
            "Melasma",
            "Cicatrices recientes",
            "Ninguna",
          ].map((a) => (
            <button
              key={a}
              className={`chip ${med.skin.includes(a) ? "is-selected" : ""}`}
              onClick={() => toggleArr("skin", a)}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="consent">
        <h3 className="consent__title">Consentimiento informado</h3>
        <p className="consent__body">
          Declaro que los datos brindados son verídicos y autorizo al equipo de
          By Leri Vendler a realizar los tratamientos seleccionados. Entiendo
          que el profesional puede suspender o adaptar cualquier procedimiento
          por motivos clínicos. Tu ficha queda protegida según la Ley 25.326 de
          Protección de Datos Personales.
        </p>
        <Check checked={med.consent} onChange={(v) => setM({ consent: v })}>
          Leí y acepto el consentimiento informado.
        </Check>
      </div>
    </>
  )

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <div className="footer__summary">
          Tus respuestas quedan <strong>bajo secreto profesional</strong>
        </div>
        <button className="btn btn--primary" disabled={!isValid} onClick={onNext}>
          Continuar
          <span className="btn__arrow">
            <Icon.Arrow />
          </span>
        </button>
      </div>
    </div>
  )

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner dmain--narrow">
          {Body()}
        </div>
        {FooterCTA()}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={stepNumber} total={totalSteps} />
      <div className="screen__body">
        {Body()}
      </div>
      {FooterCTA()}
    </div>
  )
}

// ---------- Screen 5: Confirmation ----------
export function Screen5Confirm({
  state,
  setState,
  onBack,
  onClose,
  variant,
  stepNumber,
  totalSteps,
  loyaltyPoints,
  professionals,
}: ScreenProps & { loyaltyPoints: number; professionals: Professional[] }) {
  const services = state.services || []
  const total = services.reduce((a, s) => a + s.price, 0)
  const totalMin = services.reduce((a, s) => a + s.duration, 0)
  const totalPointsCost = services.reduce((a, s) => a + (s.pointsCost ?? 0), 0)
  const canRedeem = loyaltyPoints >= totalPointsCost && totalPointsCost > 0
  const redeeming = !!state.redeemWithPoints && canRedeem
  const deposit = redeeming ? 0 : Math.round(total * 0.3)
  const remaining = redeeming ? 0 : total - deposit

  const toggleRedeem = (v: boolean) => {
    setState({ ...state, redeemWithPoints: v })
  }

  const dateObj = state.selectedDate ? parseYmd(state.selectedDate) : null
  const dow = dateObj ? DOW_NAMES[(dateObj.getDay() + 6) % 7] : ""
  const pro = professionals.find((p) => p.id === (state.pro || "auto")) ?? professionals[0]

  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pay = async () => {
    if (!state.form || !state.selectedDate || !state.selectedTime) {
      setError("Faltan datos del turno. Volvé a los pasos anteriores.")
      return
    }
    setPaying(true)
    setError(null)

    const startsAt = combineDateTime(state.selectedDate, state.selectedTime)

    const result = await createBooking({
      serviceIds: services.map((s) => s.id),
      startsAt: startsAt.toISOString(),
      proHint: state.pro || "auto",
      redeemWithPoints: redeeming,
      client: {
        firstName: state.form.firstName,
        lastName: state.form.lastName,
        email: state.form.email,
        phone: state.form.phone,
        dob: state.form.dob,
        marketingConsent: state.form.consent,
        isExisting: state.clientMode === "existing",
      },
      medical:
        state.clientMode === "existing"
          ? null
          : state.medical
            ? {
                allergies: state.medical.allergies,
                allergiesOther: state.medical.allergiesOther,
                meds: state.medical.meds,
                medsNote: state.medical.medsNote,
                pregnancy: state.medical.pregnancy,
                skin: state.medical.skin,
                consent: state.medical.consent,
              }
            : null,
    })

    if (result.ok) {
      // Limpiar el booking en curso y redirigir a la página de confirmación.
      try {
        localStorage.removeItem("blv_booking")
        localStorage.removeItem("blv_step")
      } catch {}
      window.location.href = `/reserva/exito?id=${result.appointmentId}`
    } else {
      setPaying(false)
      setError(result.error)
    }
  }

  const Body = () => (
    <>
      <p className="eyebrow">{stepLabel(stepNumber, "Confirmación")}</p>
      <h1 className="headline">
        Casi <em>listo</em>.
      </h1>
      <p className="lede">
        Revisá los detalles. Te coordinamos el pago de la seña del 30% por
        WhatsApp para dejar el turno confirmado.
      </p>

      <div className="summary">
        <div className="summary__row">
          <span className="summary__label">
            Tratamiento{services.length > 1 ? "s" : ""}
          </span>
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {services.map((s, i) => (
              <div
                key={s.id}
                style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}
              >
                {s.name}
                <small>
                  {fmtDuration(s.duration)} · {fmtPrice(s.price)}
                </small>
              </div>
            ))}
          </div>
        </div>
        <div className="summary__row">
          <span className="summary__label">Cuándo</span>
          <div className="summary__value">
            {dow} {dateObj && dateObj.getDate()} de{" "}
            {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
            <small>
              {state.selectedTime}hs · {fmtDuration(totalMin)}
            </small>
          </div>
        </div>
        <div className="summary__row">
          <span className="summary__label">Profesional</span>
          <div className="summary__value" style={{ fontSize: 14 }}>
            {pro.name}
            <small>{pro.role}</small>
          </div>
        </div>
        <div className="summary__row">
          <span className="summary__label">Dónde</span>
          <div className="summary__value" style={{ fontSize: 14 }}>
            By Leri Vendler
            <small>
              <a
                href={MAPS_LINK}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                {ADDRESS_LINE} · {ADDRESS_AREA}
              </a>
            </small>
          </div>
        </div>
      </div>

      {canRedeem && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            background: redeeming ? "var(--rose-wash)" : "var(--linen)",
            border: `1px solid ${redeeming ? "var(--nude)" : "var(--line)"}`,
            borderRadius: 12,
            marginBottom: 18,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <input
            type="checkbox"
            checked={redeeming}
            onChange={(e) => toggleRedeem(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: "#b68a5f", cursor: "pointer" }}
          />
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
            <strong
              style={{
                display: "block",
                fontFamily: "var(--serif)",
                fontSize: 15,
                color: "var(--ink)",
              }}
            >
              Pagar con puntos del Programa Cerca
            </strong>
            <span style={{ color: "var(--ink-soft)" }}>
              Tenés <strong>{loyaltyPoints} pts</strong>. Este turno cuesta{" "}
              <strong>{totalPointsCost} pts</strong> — te queda{" "}
              {Math.max(0, loyaltyPoints - totalPointsCost)} pts.
            </span>
          </div>
        </label>
      )}

      <div className="breakdown">
        <div className="breakdown__row">
          <span>Subtotal</span>
          <span>{fmtPrice(total)}</span>
        </div>
        {redeeming ? (
          <>
            <div className="breakdown__row" style={{ color: "var(--gold)" }}>
              <span>Pago con puntos</span>
              <span>− {totalPointsCost} pts</span>
            </div>
            <div className="breakdown__row breakdown__row--total">
              <span>Total a abonar</span>
              <span>$0</span>
            </div>
          </>
        ) : (
          <>
            <div className="breakdown__row">
              <span>Resto a abonar en el local</span>
              <span>{fmtPrice(remaining)}</span>
            </div>
            <div className="breakdown__row breakdown__row--total">
              <span>Seña (30%) hoy</span>
              <span>{fmtPrice(deposit)}</span>
            </div>
          </>
        )}
      </div>

      {!redeeming && (
      <div
        className="mp-badge"
        style={{ background: "#fff", border: "1px solid var(--line)", padding: "16px 18px", display: "block" }}
      >
        <div className="mp-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
          <strong style={{ display: "block", marginBottom: 4, fontFamily: "var(--serif)", fontSize: 15 }}>
            Seña por transferencia
          </strong>
          Alias <strong>leri.vendler</strong> · BBVA Argentina<br />
          A nombre de <strong>Vendler Daiana</strong>
        </div>

        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px dashed var(--line)",
            fontSize: 13,
            color: "var(--ink-soft)",
            lineHeight: 1.55,
          }}
        >
          Después mandanos el comprobante por WhatsApp al{" "}
          <strong style={{ color: "var(--ink)" }}>11 3364-3359</strong>{" "}
          para confirmar tu turno.
          <br />
          <a
            href={whatsappLink("Hola! Te paso el comprobante de la seña.")}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 10,
              padding: "9px 16px",
              borderRadius: 999,
              background: "#25d366",
              color: "#fff",
              fontSize: 12,
              letterSpacing: "0.04em",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17.6 6.3A8 8 0 0 0 4.8 16l-1.1 4.1 4.2-1.1a8 8 0 0 0 11.7-7 8 8 0 0 0-2-5.7zm-5.6 12.3a6.6 6.6 0 0 1-3.4-.9l-.2-.2-2.5.7.7-2.4-.2-.3a6.7 6.7 0 1 1 5.6 3zm3.6-5c-.2-.1-1.2-.6-1.4-.7s-.3-.1-.5.1-.5.7-.6.8-.3.1-.5 0a5.4 5.4 0 0 1-1.6-1 6 6 0 0 1-1.1-1.4c-.1-.2 0-.3.1-.4l.3-.4.2-.3v-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.4a.8.8 0 0 0-.6.3 2.4 2.4 0 0 0-.7 1.7 4.1 4.1 0 0 0 .9 2.2 9.4 9.4 0 0 0 3.6 3.2c1.3.6 2 .6 2.7.5a2.2 2.2 0 0 0 1.5-1.1 1.8 1.8 0 0 0 .1-1c-.1-.1-.2-.1-.4-.2z" />
            </svg>
            Abrir WhatsApp
          </a>
        </div>
      </div>
      )}

      <div className="policy">
        <strong>Política de cancelación ·</strong> Podés reprogramar sin cargo
        hasta <strong>24 horas antes</strong>. Con menos anticipación o
        ausencia sin aviso, la seña no es reembolsable. Es nuestra manera de
        cuidar el tiempo del equipo y el tuyo.
      </div>
    </>
  )

  const FooterCTA = () => (
    <div className="footer">
      {error && (
        <div
          style={{
            background: "var(--rose-wash)",
            color: "var(--ink)",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.4,
            marginBottom: 10,
            border: "1px solid var(--nude)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="footer__row">
        <div>
          <div className="footer__summary">Seña</div>
          <div className="footer__total">{fmtPrice(deposit)}</div>
        </div>
        <button className="btn btn--primary" disabled={paying} onClick={pay}>
          {paying ? (
            "Confirmando…"
          ) : (
            <>
              Confirmar reserva
              <span className="btn__arrow">
                <Icon.Arrow />
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  )

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner dmain--narrow">
          {Body()}
        </div>
        {FooterCTA()}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={stepNumber} total={totalSteps} />
      <div className="screen__body">
        {Body()}
      </div>
      {FooterCTA()}
    </div>
  )
}

// ---------- Screen 6: Success ----------
export function Screen6Success({
  state,
  onClose,
  onRestart,
}: {
  state: BookingState
  onClose: () => void
  onRestart: () => void
}) {
  const services = state.services || []
  const dateObj = state.selectedDate ? parseYmd(state.selectedDate) : null
  const dow = dateObj ? DOW_NAMES[(dateObj.getDay() + 6) % 7] : ""
  const totalMin = services.reduce((a, s) => a + s.duration, 0)

  const Body = () => (
    <div className="success">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
        }}
      >
        <div className="success__seal">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <path
              d="M8 17.5L14.5 24L26 12"
              stroke="#F2EDE6"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="eyebrow" style={{ color: "var(--gold)" }}>
          Reserva confirmada
        </p>
        <h1 className="success__headline">
          Te <em>esperamos</em>.
        </h1>
        <p className="success__note">
          Te enviamos los detalles por email. Vas a recibir un recordatorio 24
          horas antes de tu turno.
        </p>

        <div className="success__card">
          {services.map((s) => (
            <div key={s.id} style={{ marginBottom: 8 }}>
              <div className="success__svc">{s.name}</div>
            </div>
          ))}
          <div
            className="success__when"
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--line)",
            }}
          >
            <strong>
              {dow} {dateObj && dateObj.getDate()} de{" "}
              {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
            </strong>{" "}
            · {state.selectedTime}hs · {fmtDuration(totalMin)}
            <br />
            <span style={{ color: "var(--ink-mute)" }}>
              Sanguinetti 297 · Pilar, Buenos Aires
            </span>
          </div>
        </div>

        <div className="addcal">
          <button className="addcal-btn">
            <Icon.Google /> Google
          </button>
          <button className="addcal-btn">
            <Icon.Apple /> Apple
          </button>
          <button className="addcal-btn">
            <Icon.Cal /> .ics
          </button>
        </div>

        <div className="perks">
          <div className="perk">
            <div className="perk__icon">
              <span className="glyph">01</span>
            </div>
            <div className="perk__text">
              <strong>Programa Cerca</strong>
              Acumula puntos en cada visita. El 6° tratamiento del año es una
              cortesía de la casa.
            </div>
          </div>
          <div className="perk">
            <div className="perk__icon">
              <span className="glyph">02</span>
            </div>
            <div className="perk__text">
              <strong>Ritual de cumpleaños</strong>
              Durante tu mes recibís un tratamiento de obsequio al reservar
              cualquier otro.
            </div>
          </div>
        </div>
      </div>

      <button className="linkbtn" onClick={onRestart}>
        Reservar otro turno
      </button>
    </div>
  )

  // Full-bleed on both mobile and desktop
  return (
    <div className="screen">
      <div className="topbar">
        <div style={{ width: 40 }} />
        <Wordmark />
        <button className="topbar__close" onClick={onClose} aria-label="Cerrar">
          <Icon.Close />
        </button>
      </div>
      {Body()}
    </div>
  )
}
