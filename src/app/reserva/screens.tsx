"use client"

import { useEffect, useState } from "react"
import {
  AVAILABILITY,
  DOW_NAMES,
  DOW_SHORT,
  MONTH_NAMES,
  PROFESSIONALS,
  combineDateTime,
  fmtDuration,
  fmtPrice,
  pad2,
  parseYmd,
  ymd,
} from "./data"
import type { BookingState, Category, Service } from "./data"
import { Check, Icon, Progress, TopBar, Wordmark } from "./primitives"
import { createBooking } from "./actions"

type Variant = "mobile" | "desktop"

type ScreenProps = {
  state: BookingState
  setState: (s: BookingState) => void
  onNext: () => void
  onBack: () => void
  onClose: () => void
  variant: Variant
}

// ---------- Screen 1: Services ----------
export function Screen1Services({
  state,
  setState,
  onNext,
  onClose,
  variant,
  categories,
}: ScreenProps & { categories: Category[] }) {
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
        <p className="eyebrow">Reservá tu turno</p>
        <h1 className="headline">
          Un <em>ritual</em> a tu medida.
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
              <div className="svc__price">{fmtPrice(s.price)}</div>
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
          <p className="eyebrow">Paso 01 — Tratamiento</p>
          <h1 className="headline">
            Diseñá tu <em>ritual</em>.
          </h1>
          <p className="lede">
            Elegí uno o varios tratamientos. Podés combinar categorías; el
            equipo ajusta la secuencia en cabina.
          </p>
          <CatTabs />
          <ServiceList />
        </div>
        <FooterCTA />
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
      <Progress step={1} />
      <div className="screen__body">
        <Hero />
        <CatTabs />
        <ServiceList />
      </div>
      <FooterCTA />
    </div>
  )
}

// ---------- Screen 2: Date & Time ----------
export function Screen2DateTime({ state, setState, onNext, onBack, onClose, variant }: ScreenProps) {
  const today = new Date(2026, 3, 20) // April 20, 2026 — same as design
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

  const slotsForDay = selectedDate ? AVAILABILITY[selectedDate] || [] : []
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
          const hasSlots = !!AVAILABILITY[dateStr]
          const isSel = selectedDate === dateStr
          const isToday = dateStr === ymd(today)
          const dateObj = new Date(viewYear, viewMonth, day)
          const isPast = dateObj < today && !isToday
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
      {PROFESSIONALS.map((p) => (
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
          <p className="eyebrow">Paso 02 — Fecha y horario</p>
          <h1 className="headline">
            ¿Cuándo te <em>esperamos</em>?
          </h1>
          <p className="lede">
            Horario de Buenos Aires (GMT-3). Los días con punto dorado son hoy.
          </p>
          <div className="dcol-2">
            <Cal />
            <div>
              <Slots />
              <ProPicker />
            </div>
          </div>
        </div>
        <FooterCTA />
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={2} />
      <div className="screen__body">
        <p className="eyebrow">Paso 02 — Fecha y horario</p>
        <h1 className="headline">
          ¿Cuándo te <em>esperamos</em>?
        </h1>
        <p className="lede">
          Horario de Buenos Aires. Los días con turnos disponibles son
          seleccionables.
        </p>
        <Cal />
        <Slots />
        <ProPicker />
      </div>
      <FooterCTA />
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

export function Screen3Details({ state, setState, onNext, onBack, onClose, variant }: ScreenProps) {
  const [mode, setMode] = useState<"new" | "existing">(state.clientMode || "new")
  const f = state.form || EMPTY_FORM

  const setF = (patch: Partial<typeof EMPTY_FORM>) =>
    setState({ ...state, form: { ...f, ...patch }, clientMode: mode })

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
      <div className="field__row">
        <div className="field">
          <label className="field__label">Nombre</label>
          <input
            className="field__input"
            value={f.firstName}
            onChange={(e) => setF({ firstName: e.target.value })}
            placeholder="María"
          />
        </div>
        <div className="field">
          <label className="field__label">Apellido</label>
          <input
            className="field__input"
            value={f.lastName}
            onChange={(e) => setF({ lastName: e.target.value })}
            placeholder="López"
          />
        </div>
      </div>
      <div className="field">
        <label className="field__label">Email</label>
        <input
          className="field__input"
          type="email"
          value={f.email}
          onChange={(e) => setF({ email: e.target.value })}
          placeholder="maria@ejemplo.com"
        />
      </div>
      <div className="field__row">
        <div className="field">
          <label className="field__label">Teléfono</label>
          <input
            className="field__input"
            value={f.phone}
            onChange={(e) => setF({ phone: e.target.value })}
            placeholder="+54 9 11 ..."
          />
        </div>
        <div className="field">
          <label className="field__label">Fecha de nacimiento</label>
          <input
            className="field__input"
            value={f.dob}
            onChange={(e) => setF({ dob: e.target.value })}
            placeholder="DD / MM / AAAA"
          />
        </div>
      </div>

      <div className="info-strip">
        <Icon.Info />
        <span>
          Tu fecha de nacimiento nos permite enviarte un{" "}
          <strong>obsequio sorpresa</strong> en tu mes de cumpleaños.
        </span>
      </div>

      <Check checked={!!f.consent} onChange={(v) => setF({ consent: v })}>
        Acepto recibir recordatorios de turno y novedades por email y SMS.
        Puedo cancelar en cualquier momento.
      </Check>
    </>
  )

  const ExistingForm = () => (
    <div className="magic">
      <p className="eyebrow">Acceso rápido</p>
      <h3 className="magic__title">Te enviamos un link al correo.</h3>
      <p className="magic__desc">
        Sin contraseñas. Al abrir el email desde tu celular, entrás
        directamente al turno.
      </p>
      <div className="field" style={{ marginBottom: 12 }}>
        <input
          className="field__input"
          type="email"
          value={f.email}
          onChange={(e) => setF({ email: e.target.value })}
          placeholder="email@ejemplo.com"
        />
      </div>
      <button
        className="btn btn--primary btn--full"
        disabled={!f.email}
        onClick={onNext}
      >
        Enviar enlace
      </button>
    </div>
  )

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

  const Body = () => (
    <>
      <p className="eyebrow">Paso 03 — Tus datos</p>
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
      <Segmented />
      {mode === "new" ? <NewForm /> : <ExistingForm />}
    </>
  )

  if (variant === "desktop") {
    return (
      <div className="dmain">
        <div className="dmain__inner dmain--narrow">
          <Body />
        </div>
        {mode === "new" && <FooterCTA />}
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={3} />
      <div className="screen__body">
        <Body />
      </div>
      {mode === "new" && <FooterCTA />}
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

export function Screen4Medical({ state, setState, onNext, onBack, onClose, variant }: ScreenProps) {
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
      <p className="eyebrow">Paso 04 — Ficha inicial</p>
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
          <Body />
        </div>
        <FooterCTA />
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={4} />
      <div className="screen__body">
        <Body />
      </div>
      <FooterCTA />
    </div>
  )
}

// ---------- Screen 5: Confirmation ----------
export function Screen5Confirm({ state, onNext, onBack, onClose, variant }: ScreenProps) {
  const services = state.services || []
  const total = services.reduce((a, s) => a + s.price, 0)
  const totalMin = services.reduce((a, s) => a + s.duration, 0)
  const deposit = Math.round(total * 0.3)
  const remaining = total - deposit

  const dateObj = state.selectedDate ? parseYmd(state.selectedDate) : null
  const dow = dateObj ? DOW_NAMES[(dateObj.getDay() + 6) % 7] : ""
  const pro = PROFESSIONALS.find((p) => p.id === (state.pro || "auto"))!

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

    setPaying(false)
    if (result.ok) {
      onNext()
    } else {
      setError(result.error)
    }
  }

  const Body = () => (
    <>
      <p className="eyebrow">Paso 05 — Confirmación</p>
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
            <small>Soler 3892, Palermo · Buenos Aires</small>
          </div>
        </div>
      </div>

      <div className="breakdown">
        <div className="breakdown__row">
          <span>Subtotal</span>
          <span>{fmtPrice(total)}</span>
        </div>
        <div className="breakdown__row">
          <span>Resto a abonar en el local</span>
          <span>{fmtPrice(remaining)}</span>
        </div>
        <div className="breakdown__row breakdown__row--total">
          <span>Seña (30%) hoy</span>
          <span>{fmtPrice(deposit)}</span>
        </div>
      </div>

      <div className="mp-badge">
        <div className="mp-logo">MP</div>
        <div className="mp-text">
          <strong>Mercado Pago</strong>
          <br />
          Abona con tarjeta, transferencia o saldo en cuenta.
        </div>
      </div>

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
          <Body />
        </div>
        <FooterCTA />
      </div>
    )
  }

  return (
    <div className="screen">
      <TopBar onBack={onBack} onClose={onClose} />
      <Progress step={5} />
      <div className="screen__body">
        <Body />
      </div>
      <FooterCTA />
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
              Soler 3892 · Palermo, Buenos Aires
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
      <Body />
    </div>
  )
}
