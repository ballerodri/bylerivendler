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
import type { BookingState, Category, Combo, Professional, ReservaPack, Service } from "./data"
import { Check, Icon, Progress, TopBar, Wordmark } from "./primitives"
import { createBooking, saveClientEarly, fetchSequentialAvailability, joinWaitlist } from "./actions"
import { sendMagicLink, signInWithGoogle } from "../login/actions"
import { whatsappLink } from "@/lib/whatsapp"
import { ADDRESS_LINE, ADDRESS_AREA, MAPS_LINK } from "@/lib/location"
import PackSessionPicker from "./_components/pack-session-picker"
import { arPartsFromUtc, minStartForNextSession } from "@/lib/servicios/pack-sessions"
import { amountDueNow, type PayChoice } from "@/lib/servicios/payments"
import { totalDueNowSeparate, validateSeparateSlots } from "@/lib/servicios/multi-booking"

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

// Fechas de sesión de pack ya elegidas (`packSlots`), depuradas:
//  - nunca más que las sesiones que el pack ACTUAL tiene (si se cambió de
//    pack a uno con menos sesiones, el estado viejo puede traer de más)
//  - se corta en la primera fecha que ya no está en el futuro (las sesiones
//    siguientes dependen de la anterior, así que también se descartan)
function cleanPackSlots(raw: string[], sessionsTotal: number): string[] {
  const clamped = raw.slice(0, sessionsTotal)
  const now = Date.now()
  const cut = clamped.findIndex((iso) => new Date(iso).getTime() <= now)
  return cut === -1 ? clamped : clamped.slice(0, cut)
}

// Precio (pesos) y duración (min) efectivos de un servicio según el modo.
// Para "per_zone", se calculan a partir de las zonas elegidas (zoneSel[s.id]);
// para "fixed", se usan directamente s.price / s.duration.
function effectiveService(
  s: Service,
  zoneSel: Record<string, string[]>
): { price: number; duration: number; count: number } {
  if (s.pricingMode !== "per_zone") return { price: s.price, duration: s.duration, count: 1 }
  const ids = zoneSel[s.id] ?? []
  const chosen = s.zones.filter((z) => ids.includes(z.id))
  return {
    price: chosen.reduce((a, z) => a + (z.price ?? s.price), 0),
    duration: chosen.reduce((a, z) => a + z.durationMin, 0),
    count: chosen.length,
  }
}

// Modo separados: formatea la fecha/hora elegida de un servicio, en hora AR.
function fmtSlotAR(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  })
}

// ---------- Screen 1: Services ----------
const COMBOS_TAB = "__combos__"
const PACKS_TAB = "__packs__"

export function Screen1Services({
  state,
  setState,
  onNext,
  onClose,
  variant,
  stepNumber,
  totalSteps,
  categories,
  combos,
  packs,
  knownFirstName,
}: ScreenProps & { categories: Category[]; combos: Combo[]; packs: ReservaPack[]; knownFirstName: string | null }) {
  const hasCombos = combos.length > 0
  const hasPacks = packs.length > 0
  const fallbackCat = hasCombos ? COMBOS_TAB : (categories[0]?.id ?? "facial")
  const [activeCat, setActiveCat] = useState(
    state.pack ? PACKS_TAB : state.combo ? COMBOS_TAB : (state.activeCat || fallbackCat)
  )
  const selected = state.services || []
  const selectedCombo = state.combo ?? null
  const selectedPack = state.pack ?? null

  // Nota: cada handler que cambia qué se está comprando limpia `packSlots`
  // (las fechas de sesión ya elegidas) Y, además, `serviceOrder`/`resolvedStaff`
  // (el profesional/orden resuelto para servicios sueltos) y `selectedDate`/
  // `selectedTime` (la fecha/hora ya elegida). Si no se limpiaran, un pack
  // viejo con más sesiones (o zonas, que cambian la duración) dejaría fechas
  // "fantasma" que el paso de fecha intenta reusar y el servidor termina
  // rechazando sin que la clienta pueda corregirlo (ver Screen2DateTime); y un
  // `serviceOrder`/`resolvedStaff` resuelto para una compra anterior (p.ej.
  // servicios sueltos) podría colarse en la compra nueva (p.ej. un pack) y
  // asignarle un profesional que la clienta nunca eligió para eso.
  const clearedResolution = {
    packSlots: undefined,
    serviceSlots: undefined,
    bookingMode: undefined,
    serviceOrder: undefined,
    resolvedStaff: undefined,
    selectedDate: undefined,
    selectedTime: null,
  } as const

  const switchTab = (tab: string) => {
    if (tab !== COMBOS_TAB && tab !== PACKS_TAB && (selectedCombo || selectedPack)) {
      // Al cambiar a servicios individuales, limpiamos el combo y el pack
      setState({ ...state, combo: null, pack: null, services: [], activeCat: tab, ...clearedResolution })
    } else {
      setActiveCat(tab)
    }
    setActiveCat(tab)
  }

  const toggleCombo = (c: Combo) => {
    if (selectedCombo?.id === c.id) {
      setState({ ...state, combo: null, services: [], ...clearedResolution })
    } else {
      // Elegir un combo limpia el pack (excluyente)
      setState({ ...state, combo: c, services: c.services, pack: null, ...clearedResolution })
    }
  }

  const togglePack = (p: ReservaPack) => {
    if (selectedPack?.pack.id === p.id) {
      setState({ ...state, pack: null, ...clearedResolution })
    } else {
      // Elegir un pack limpia servicios sueltos y combo (excluyente)
      setState({ ...state, pack: { pack: p, zoneIds: [] }, services: [], combo: null, ...clearedResolution })
    }
  }

  const togglePackZone = (zoneId: string) => {
    if (!selectedPack) return
    const cur = selectedPack.zoneIds
    const next = cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
    // Cambiar las zonas cambia la duración de la sesión (pricingMode
    // "per_zone"): las fechas ya elegidas podrían quedar superpuestas.
    setState({ ...state, pack: { ...selectedPack, zoneIds: next }, ...clearedResolution })
  }

  const toggle = (svc: Service) => {
    const exists = selected.find((s) => s.id === svc.id)
    const next = exists ? selected.filter((s) => s.id !== svc.id) : [...selected, svc]
    setState({ ...state, combo: null, pack: null, services: next, activeCat, ...clearedResolution })
  }

  // serviceId → zoneId[] elegidas (solo para servicios pricingMode === "per_zone")
  const zoneSel = state.zoneSelections ?? {}
  const toggleZone = (serviceId: string, zoneId: string, single: boolean) => {
    const cur = zoneSel[serviceId] ?? []
    const next = single
      ? [zoneId] // producto: una sola opción, reemplaza la anterior
      : cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
    // La duración (y precio) de ESTE servicio cambió (pricingMode "per_zone"):
    // la fecha que se había elegido para él en modo "separados" se eligió
    // para otra duración y ya no vale. Las fechas de los OTROS servicios
    // siguen siendo válidas, así que no tocamos todo `clearedResolution`
    // (eso también borraría selectedDate/selectedTime del modo "juntos", que
    // hoy se autocorrige solo vía el efecto de `assignmentKey`).
    const slots = { ...(state.serviceSlots ?? {}) }
    delete slots[serviceId]
    setState({
      ...state,
      zoneSelections: { ...zoneSel, [serviceId]: next },
      serviceSlots: Object.keys(slots).length ? slots : undefined,
    })
  }

  const effective = (s: Service) => effectiveService(s, zoneSel)

  const packDurationMin = selectedPack
    ? (selectedPack.pack.pricingMode === "per_zone"
        ? selectedPack.pack.zones.filter((z) => selectedPack.zoneIds.includes(z.id)).reduce((a, z) => a + z.durationMin, 0)
        : selectedPack.pack.serviceDurationMin)
    : 0
  const packZonesOk = !selectedPack || selectedPack.pack.pricingMode !== "per_zone" ||
    selectedPack.zoneIds.length === (selectedPack.pack.zonesCount ?? 0)

  const displayPrice = selectedPack
    ? selectedPack.pack.priceCents / 100
    : selectedCombo
      ? selectedCombo.price
      : selected.reduce((a, s) => a + effective(s).price, 0)
  const displayMin = selectedPack
    ? packDurationMin
    : selectedCombo
      ? selectedCombo.duration
      : selected.reduce((a, s) => a + effective(s).duration, 0)
  const hasSelection = selectedPack !== null || selectedCombo !== null || selected.length > 0
  const zonesOk = selected.every((s) => s.pricingMode !== "per_zone" || (zoneSel[s.id]?.length ?? 0) >= 1)
  const canContinue = hasSelection && zonesOk && packZonesOk

  const activeCategory = activeCat === COMBOS_TAB || activeCat === PACKS_TAB
    ? null
    : (categories.find((c) => c.id === activeCat) ?? categories[0])

  if (!hasCombos && !hasPacks && !activeCategory) {
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
          Elegí un combo o uno a varios tratamientos sueltos.
        </p>
      </div>
    </div>
  )

  const CatTabs = () => (
    <div className="cattabs" role="tablist">
      {hasCombos && (
        <button
          role="tab"
          className={`cattab ${activeCat === COMBOS_TAB ? "is-active" : ""}`}
          onClick={() => switchTab(COMBOS_TAB)}
        >
          Combos
        </button>
      )}
      {hasPacks && (
        <button
          role="tab"
          className={`cattab ${activeCat === PACKS_TAB ? "is-active" : ""}`}
          onClick={() => switchTab(PACKS_TAB)}
        >
          Packs
        </button>
      )}
      {categories.map((c) => (
        <button
          key={c.id}
          role="tab"
          className={`cattab ${activeCat === c.id ? "is-active" : ""}`}
          onClick={() => switchTab(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  )

  const ComboList = () => (
    <div className="svc-group">
      <div className="svc-group__head">
        <h2 className="svc-group__title">
          Combos <em>— precio especial</em>
        </h2>
        <span className="svc-group__count">
          {String(combos.length).padStart(2, "0")}
        </span>
      </div>
      {combos.map((c) => {
        const isSel = selectedCombo?.id === c.id
        const fullPrice = c.services.reduce((a, s) => a + s.price, 0)
        return (
          <button
            key={c.id}
            className={`svc ${isSel ? "is-selected" : ""}`}
            onClick={() => toggleCombo(c)}
          >
            <div className="svc__top">
              <div style={{ paddingRight: 28, flex: 1 }}>
                <h3 className="svc__name">{c.name}</h3>
                <div className="svc__meta">
                  <Icon.Clock />
                  <span>{fmtDuration(c.duration)}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>
                  {c.services.map((s) => s.name).join(" + ")}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="svc__price">{fmtPrice(c.price)}</div>
                {fullPrice > c.price && (
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", textDecoration: "line-through", marginTop: 2 }}>
                    {fmtPrice(fullPrice)}
                  </div>
                )}
              </div>
            </div>
            {c.description && <p className="svc__desc">{c.description}</p>}
            <span className="svc__check">
              <Icon.CheckSmall />
            </span>
          </button>
        )
      })}
    </div>
  )

  const PackList = () => (
    <div>
      {packs.map((p) => {
        const isSel = selectedPack?.pack.id === p.id
        return (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => togglePack(p)}
              style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${isSel ? "var(--gold)" : "var(--line)"}`,
                background: isSel ? "var(--linen)" : "transparent",
              }}
            >
              <strong>{p.name}</strong> · {p.sessions} sesiones
              <span style={{ float: "right" }}>{fmtPrice(p.priceCents / 100)}</span>
              {p.description && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{p.description}</div>}
            </button>
            {isSel && p.pricingMode === "per_zone" && (
              <div style={{ paddingLeft: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  Elegí {p.zonesCount} zona(s) para tu pack:
                </span>
                {p.zones.map((z) => {
                  const checked = selectedPack!.zoneIds.includes(z.id)
                  const atLimit = selectedPack!.zoneIds.length >= (p.zonesCount ?? 0)
                  return (
                    <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", opacity: !checked && atLimit ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && atLimit}
                        onChange={() => togglePackZone(z.id)}
                        style={{ width: 15, height: 15 }}
                      />
                      <span>{z.name} · {z.durationMin} min</span>
                    </label>
                  )
                })}
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  Seña hoy (30%): {fmtPrice(Math.round(p.priceCents * 0.3) / 100)}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const ServiceList = () => {
    if (!activeCategory) return null
    return (
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
          const isSel = !selectedCombo && !!selected.find((x) => x.id === s.id)
          return (
            <div key={s.id}>
              <button
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
                      <div style={{ fontSize: 11, color: "var(--gold)", letterSpacing: "0.04em", marginTop: 2 }}>
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
              {s.pricingMode === "per_zone" && isSel && (() => {
                const single = s.zoneSelection === "single"
                return (
                  <div style={{ marginTop: 8, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                      {single ? "Elegí un producto:" : "Elegí las zonas:"}
                    </span>
                    {s.zones.map((z) => (
                      <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={single ? `zone-${s.id}` : undefined}
                          checked={(zoneSel[s.id] ?? []).includes(z.id)}
                          onChange={() => toggleZone(s.id, z.id, single)}
                          style={{ width: 15, height: 15 }}
                        />
                        <span>{z.name} · {z.durationMin} min · {fmtPrice(z.price ?? s.price)}</span>
                      </label>
                    ))}
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                      {(() => {
                        const e = effective(s)
                        if (!e.count) return single ? "Elegí un producto" : "Elegí al menos una zona"
                        return single
                          ? `${e.duration} min · ${fmtPrice(e.price)}`
                          : `${e.count} zona(s) · ${e.duration} min · ${fmtPrice(e.price)}`
                      })()}
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    )
  }

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <div>
          <div className="footer__summary">
            {!hasSelection ? (
              "Sin tratamientos seleccionados"
            ) : selectedPack ? (
              <span><strong>{selectedPack.pack.name}</strong> · {selectedPack.pack.sessions} sesiones</span>
            ) : selectedCombo ? (
              <span><strong>{selectedCombo.name}</strong> · {fmtDuration(displayMin)}</span>
            ) : (
              <span>
                <strong>{selected.length}</strong> tratamiento
                {selected.length > 1 ? "s" : ""} · {fmtDuration(displayMin)}
              </span>
            )}
          </div>
          {hasSelection && (
            <div className="footer__total">{fmtPrice(displayPrice)}</div>
          )}
        </div>
        <button
          className="btn btn--primary"
          disabled={!canContinue}
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
            Elegí un combo o uno a varios tratamientos sueltos.
          </p>
          {CatTabs()}
          {activeCat === COMBOS_TAB ? ComboList() : activeCat === PACKS_TAB ? PackList() : ServiceList()}
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
        {activeCat === COMBOS_TAB ? ComboList() : activeCat === PACKS_TAB ? PackList() : ServiceList()}
      </div>
      {FooterCTA()}
    </div>
  )
}

// ---------- Screen 2: Date & Time ----------
export function Screen2DateTime({ state, setState, onNext, onBack, onClose, variant, stepNumber, totalSteps, professionals, businessHours }: ScreenProps & { professionals: Professional[]; businessHours: import("./data").BusinessHour[] }) {
  // `today` snapped to midnight so we compare just dates, not times.
  const [today] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [availability] = useState(() => generateAvailability(60, businessHours))

  const initialDate = state.selectedDate ? parseYmd(state.selectedDate) : today
  const [viewYear, setViewYear] = useState(initialDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth())

  const selectedDate = state.selectedDate
  const selectedTime = state.selectedTime

  // Per-service professional preference (defaults all to "auto")
  const serviceStaff: Record<string, string> =
    state.serviceStaff ?? Object.fromEntries(state.services.map((s) => [s.id, "auto"]))

  const updateServiceStaff = (serviceId: string, staffId: string) => {
    // El profesional de ESTE servicio cambió: la fecha que se había elegido
    // para él en modo "separados" se ofreció según la disponibilidad de OTRO
    // profesional y puede no valer para el nuevo. Las de los demás servicios
    // siguen siendo válidas.
    const slots = { ...(state.serviceSlots ?? {}) }
    delete slots[serviceId]
    setState({
      ...state,
      serviceStaff: { ...serviceStaff, [serviceId]: staffId },
      selectedTime: null,
      serviceOrder: undefined,
      resolvedStaff: undefined,
      serviceSlots: Object.keys(slots).length ? slots : undefined,
    })
  }

  // Sequential availability result
  const [seqResult, setSeqResult] = useState<import("./actions").SequentialAvailabilityResult | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [showWaitlist, setShowWaitlist] = useState(false)
  const [waitlistDone, setWaitlistDone] = useState(false)
  // Pack: qué sesión se está eligiendo ahora mismo (null = mostrando la lista)
  const [pickingIdx, setPickingIdx] = useState<number | null>(null)
  // Modo separados: qué servicio se está fechando ahora (null = mostrando la lista)
  const [pickingServiceId, setPickingServiceId] = useState<string | null>(null)
  // "Ahora", congelado al montar: llamar a Date.now() en el render es impuro (el
  // resultado cambiaría entre renders). El chequeo autoritativo de fecha pasada
  // corre igual en pay() (evento) y en el servidor.
  const [mountedAtMs] = useState(() => Date.now())

  const zoneSel = state.zoneSelections ?? {}

  // Pack seleccionado (excluyente con servicios/combo): la disponibilidad se
  // consulta con el servicio del pack y la duración calculada por zonas.
  const selectedPack = state.pack ?? null

  // Elegir "separados" sólo tiene sentido con 2+ servicios sueltos: un combo es
  // un turno por definición, y un pack ya tiene su propia pantalla de fechas.
  const canSeparate = !selectedPack && !state.combo && state.services.length >= 2
  const bookingMode = canSeparate ? (state.bookingMode ?? "juntos") : "juntos"
  const serviceSlots = state.serviceSlots ?? {}

  const packDurationMin = selectedPack
    ? (selectedPack.pack.pricingMode === "per_zone"
        ? selectedPack.pack.zones.filter((z) => selectedPack.zoneIds.includes(z.id)).reduce((a, z) => a + z.durationMin, 0)
        : selectedPack.pack.serviceDurationMin)
    : 0

  // Stable key for service+staff+zone combo to drive effect
  const assignmentKey = selectedPack
    ? `pack:${selectedPack.pack.id}:${selectedPack.zoneIds.join(",")}`
    : state.services
        .map((s) => `${s.id}:${serviceStaff[s.id] ?? "auto"}:${(zoneSel[s.id] ?? []).join(",")}`)
        .join("|")

  useEffect(() => {
    if (!selectedDate) { setSeqResult(null); return }
    const serviceInputs = selectedPack
      ? [{ id: selectedPack.pack.serviceId, name: selectedPack.pack.serviceName, duration: packDurationMin, staffId: "auto" }]
      : state.services.map((s) => ({
          id: s.id,
          name: s.name,
          duration: effectiveService(s, zoneSel).duration,
          staffId: serviceStaff[s.id] ?? "auto",
        }))
    let cancelled = false
    setSlotsLoading(true)
    fetchSequentialAvailability(serviceInputs, selectedDate).then((result) => {
      if (cancelled) return
      setSeqResult(result)
      if (state.selectedTime && !result.slotsForDate.some((r) => r.time === state.selectedTime)) {
        setState({ ...state, selectedTime: null, serviceOrder: undefined, resolvedStaff: undefined })
      }
      setSlotsLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, assignmentKey])

  // Pack: al entrar a este paso, depurar `packSlots` (sesiones vencidas o de
  // más si se cambió de pack — ver `cleanPackSlots`) para que la lista y el
  // botón de continuar nunca muestren/envíen datos que el servidor va a
  // rechazar. El hook corre siempre (regla de hooks); sólo actúa si hay pack.
  useEffect(() => {
    if (!selectedPack) return
    const raw = state.packSlots ?? []
    const cleaned = cleanPackSlots(raw, selectedPack.pack.sessions)
    if (cleaned.length !== raw.length) {
      setState({ ...state, packSlots: cleaned })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPack, state.packSlots])

  const selectSeqSlot = (result: import("./actions").SlotResult) => {
    const d = parseYmd(result.date)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setState({
      ...state,
      selectedDate: result.date,
      selectedTime: result.time,
      serviceOrder: result.serviceOrder,
      resolvedStaff: result.resolvedStaff,
      serviceStaff: { ...serviceStaff, ...result.resolvedStaff },
    })
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayRaw = new Date(viewYear, viewMonth, 1).getDay()
  const firstDayOffset = (firstDayRaw + 6) % 7

  const canPrev = !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())

  const selectDay = (d: number) => {
    const dateStr = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`
    setState({ ...state, selectedDate: dateStr, selectedTime: null, serviceOrder: undefined, resolvedStaff: undefined })
  }
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
          <p style={{ fontSize: 12, color: "var(--ink-mute)", textAlign: "center", padding: "24px 0" }}>
            Elegí un día para ver horarios disponibles.
          </p>
        </div>
      )
    }
    const dowLabel = DOW_NAMES[(selectedDateObj.getDay() + 6) % 7]
    const seqSlots = seqResult?.slotsForDate ?? []
    const next = seqResult?.nextAvailable ?? []
    const individual = seqResult?.individualSlotsForDate ?? []
    const multiPro = state.services.length > 1

    return (
      <div className="slots">
        <div className="slots__head">
          <h3 className="slots__title">
            {dowLabel}{" "}
            <em>{selectedDateObj.getDate()} de {MONTH_NAMES[selectedDateObj.getMonth()].toLowerCase()}</em>
          </h3>
          {!slotsLoading && seqSlots.length > 0 && (
            <span className="slots__count">{String(seqSlots.length).padStart(2, "0")} horarios</span>
          )}
        </div>

        {slotsLoading ? (
          <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "16px 0" }}>
            Verificando disponibilidad…
          </p>
        ) : seqSlots.length > 0 ? (
          <div className="slots__grid">
            {seqSlots.map((r) => (
              <button
                key={r.time}
                className={`slot ${selectedTime === r.time && selectedDate === r.date ? "is-selected" : ""}`}
                onClick={() => selectSeqSlot(r)}
              >
                {r.time}
              </button>
            ))}
          </div>
        ) : (
          <div>
            {multiPro && (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
                No hay turnos consecutivos disponibles para este día.
              </p>
            )}
            {!multiPro && (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
                Sin horarios disponibles para este día.
              </p>
            )}

            {next.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Próximos turnos consecutivos
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {next.map((r, i) => {
                    const d = parseYmd(r.date)
                    const dow = DOW_SHORT[(d.getDay() + 6) % 7]
                    const dateLabel = `${dow} ${d.getDate()}/${pad2(d.getMonth() + 1)}`
                    return (
                      <button
                        key={i}
                        onClick={() => selectSeqSlot(r)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 8,
                          border: "1px solid var(--line)", background: "transparent",
                          cursor: "pointer", fontSize: 13, color: "var(--ink)", textAlign: "left",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{r.time}hs</span>
                        <span style={{ color: "var(--ink-mute)" }}>{dateLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {multiPro && individual.length > 0 && (
              <div>
                <p style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Horarios individuales disponibles hoy
                </p>
                {individual.map((ind) => (
                  <div key={ind.serviceId} style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 4 }}>{ind.serviceName}</p>
                    <div className="slots__grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))" }}>
                      {ind.slots.slice(0, 8).map((t) => (
                        <div key={t} className="slot" style={{ opacity: 0.5, cursor: "default", fontSize: 11 }}>{t}</div>
                      ))}
                      {ind.slots.length === 0 && (
                        <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>Sin horarios</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Lista de espera — se muestra cuando no hay próximos disponibles */}
            {!slotsLoading && next.length === 0 && !waitlistDone && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
                {!showWaitlist ? (
                  <button
                    onClick={() => setShowWaitlist(true)}
                    style={{
                      width: "100%", padding: "10px 16px", borderRadius: 10,
                      border: "1px dashed var(--line)", background: "transparent",
                      fontSize: 13, color: "var(--ink-soft)", cursor: "pointer", textAlign: "center",
                    }}
                  >
                    ¿No encontrás horario? Anotarte en lista de espera →
                  </button>
                ) : (
                  <WaitlistForm
                    serviceNames={state.services.map((s) => s.name)}
                    onSuccess={() => { setShowWaitlist(false); setWaitlistDone(true) }}
                    onCancel={() => setShowWaitlist(false)}
                  />
                )}
              </div>
            )}
            {!slotsLoading && waitlistDone && (
              <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 16, padding: "10px 14px", background: "var(--linen)", borderRadius: 10 }}>
                ¡Listo! Te avisamos en cuanto haya un horario disponible. 🌸
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  const setMode = (m: "juntos" | "separados") => {
    // Al cambiar de modo, lo elegido en el otro modo deja de valer. Incluye
    // `serviceStaff`: si el modo anterior auto-resolvió un profesional
    // (ver `selectSeqSlot`), eso fue el algoritmo, no una preferencia de la
    // clienta, y no debe seguir acotando la disponibilidad en el modo nuevo.
    setState({
      ...state,
      bookingMode: m,
      serviceSlots: undefined,
      serviceOrder: undefined,
      resolvedStaff: undefined,
      serviceStaff: undefined,
      selectedDate: undefined,
      selectedTime: null,
    })
    setPickingServiceId(null)
  }

  const ModeChooser = () =>
    !canSeparate ? null : (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 20px" }}>
        <strong style={{ fontFamily: "var(--serif)", fontSize: 15 }}>
          Elegiste {state.services.length} servicios. ¿Cómo los querés?
        </strong>
        {([
          { v: "juntos" as const, label: "El mismo día, uno después del otro", note: "Venís una sola vez" },
          { v: "separados" as const, label: "Cada uno en su fecha y horario", note: "Elegís cuándo va cada uno" },
        ]).map((o) => (
          <label
            key={o.v}
            style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              padding: "12px 14px", borderRadius: 12, fontSize: 13,
              border: `1px solid ${bookingMode === o.v ? "var(--nude)" : "var(--line)"}`,
              background: bookingMode === o.v ? "var(--rose-wash)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === o.v}
              onChange={() => setMode(o.v)}
              style={{ width: 16, height: 16, accentColor: "#b68a5f" }}
            />
            <span style={{ flex: 1 }}>
              <strong>{o.label}</strong>
              <br />
              <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{o.note}</span>
            </span>
          </label>
        ))}
      </div>
    )

  const ProPicker = () => (
    <div style={{ marginTop: 24 }}>
      <p className="eyebrow">
        {state.services.length > 1 ? "Profesional por tratamiento · opcional" : "Profesional · opcional"}
      </p>
      {state.services.length > 1 ? (
        // Per-service pickers
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {state.services.map((svc) => {
            const current = serviceStaff[svc.id] ?? "auto"
            return (
              <div key={svc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--ink-mute)", flex: 1 }}>{svc.name}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {professionals.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => updateServiceStaff(svc.id, p.id)}
                      style={{
                        padding: "4px 10px", borderRadius: 20, fontSize: 12,
                        border: `1px solid ${current === p.id ? "var(--ink)" : "var(--line)"}`,
                        background: current === p.id ? "var(--ink)" : "transparent",
                        color: current === p.id ? "var(--linen)" : "var(--ink-mute)",
                        cursor: "pointer",
                      }}
                    >
                      {p.id === "auto" ? "Auto" : p.initials}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        // Single picker (original)
        professionals.map((p) => {
          const current = serviceStaff[state.services[0]?.id ?? ""] ?? "auto"
          return (
            <button
              key={p.id}
              className={`pro-row ${current === p.id ? "is-selected" : ""}`}
              onClick={() => state.services[0] && updateServiceStaff(state.services[0].id, p.id)}
            >
              <div className="pro-avatar">{p.initials}</div>
              <div>
                <div className="pro-name">{p.name}</div>
                <div className="pro-role">{p.role}</div>
              </div>
              <div className="pro-spacer" />
              {p.id === "auto" && current !== "auto" && <span className="pro-hint">Recomendado</span>}
              {current === p.id && <Icon.CheckInk style={{ color: "var(--ink)" }} />}
            </button>
          )
        })
      )}
    </div>
  )

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <button className="btn--back" onClick={onBack}>
          ← Atrás
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
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
    </div>
  )

  // ── Pack: se eligen las fechas de las sesiones, no una sola ───────────────
  if (selectedPack) {
    const pack = selectedPack.pack
    // Defensa en profundidad: además del efecto de arriba (que ya depuró y
    // persistió `state.packSlots`), nunca leemos/mostramos más sesiones de
    // las que el pack actual tiene ni fechas que ya pasaron.
    const picked = cleanPackSlots(state.packSlots ?? [], pack.sessions)
    const proHint = state.pro ?? "auto"

    const setSlot = (idx: number, iso: string) => {
      const next = [...picked]
      next[idx] = iso
      setState({ ...state, packSlots: next.slice(0, idx + 1) }) // al cambiar una, se re-eligen las siguientes
      setPickingIdx(null)
    }
    const clearFrom = (idx: number) =>
      setState({ ...state, packSlots: picked.slice(0, idx) })

    const minFor = (idx: number): Date | null => {
      if (idx === 0) return null
      const prev = picked[idx - 1]
      if (!prev) return null
      const prevStart = new Date(prev)
      const intervalMin = minStartForNextSession(prevStart, pack.intervalDays)
      // Sin regla de intervalo (o con una más corta que la sesión), no
      // ofrecer nunca un horario que empiece antes de que la sesión previa
      // termine — si no, el picker deja elegir una sesión que se superpone
      // consigo misma (el servidor la rechaza, pero recién en el pago).
      const noOverlapMin = new Date(prevStart.getTime() + packDurationMin * 60_000)
      return intervalMin.getTime() > noOverlapMin.getTime() ? intervalMin : noOverlapMin
    }

    const backToList = () => setPickingIdx(null)

    if (pickingIdx !== null) {
      const idx = pickingIdx
      const PickerBody = () => (
        <>
          <h1 className="headline">Sesión {idx + 1} de {pack.sessions}</h1>
          {pack.intervalDays && idx > 0 && (
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
              Tiene que haber al menos {pack.intervalDays} días desde la sesión anterior.
            </p>
          )}
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={packDurationMin}
            proHint={proHint}
            minDate={minFor(idx)}
            onPick={(iso) => setSlot(idx, iso)}
            onCancel={backToList}
          />
        </>
      )
      const PickerFooterCTA = () => (
        <div className="footer">
          <div className="footer__row">
            <button className="btn--back" onClick={backToList}>
              ← Atrás
            </button>
          </div>
        </div>
      )

      if (variant === "desktop") {
        return (
          <div className="dmain">
            <div className="dmain__inner">
              {PickerBody()}
            </div>
            {PickerFooterCTA()}
          </div>
        )
      }

      return (
        <div className="screen">
          <TopBar onBack={backToList} onClose={onClose} />
          <Progress step={stepNumber} total={totalSteps} />
          <div className="screen__body">
            {PickerBody()}
          </div>
          {PickerFooterCTA()}
        </div>
      )
    }

    const ListBody = () => (
      <>
        <h1 className="headline">Tus <em>sesiones</em></h1>
        <p className="lede">
          {pack.name} · {pack.sessions} sesiones. Elegí al menos la primera; el resto lo podés
          agendar después.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
          {Array.from({ length: pack.sessions }).map((_, i) => {
            const iso = picked[i]
            const blocked = i > 0 && !picked[i - 1]   // no se puede elegir la 3ª sin la 2ª
            return (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "10px 12px", border: "1px solid var(--line)",
                  borderRadius: 10, opacity: blocked ? 0.45 : 1,
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <strong>Sesión {i + 1}</strong>{" "}
                  {iso
                    ? new Date(iso).toLocaleString("es-AR", {
                        weekday: "short", day: "2-digit", month: "short",
                        hour: "2-digit", minute: "2-digit", hour12: false,
                        timeZone: "America/Argentina/Buenos_Aires",
                      })
                    : <span style={{ color: "var(--ink-mute)" }}>— la agendo después —</span>}
                </span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={blocked} onClick={() => setPickingIdx(i)}>
                    {iso ? "Cambiar" : "Elegir fecha"}
                  </button>
                  {iso && i > 0 && (
                    <button className="btn" onClick={() => clearFrom(i)}>Quitar</button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </>
    )

    const ListFooterCTA = () => (
      <div className="footer">
        <div className="footer__row">
          <button className="btn--back" onClick={onBack}>
            ← Atrás
          </button>
          <button
            className="btn btn--primary"
            disabled={picked.length === 0}
            onClick={onNext}
          >
            {picked.length === 0
              ? "Elegí la fecha de la primera sesión"
              : `Continuar (${picked.length} de ${pack.sessions} agendadas)`}
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
            {ListBody()}
          </div>
          {ListFooterCTA()}
        </div>
      )
    }

    return (
      <div className="screen">
        <TopBar onBack={onBack} onClose={onClose} />
        <Progress step={stepNumber} total={totalSteps} />
        <div className="screen__body">
          {ListBody()}
        </div>
        {ListFooterCTA()}
      </div>
    )
  }

  // ── Separados: cada servicio con SU fecha ─────────────────────────────────
  if (bookingMode === "separados") {
    const picking = pickingServiceId
      ? state.services.find((s) => s.id === pickingServiceId) ?? null
      : null

    if (picking) {
      const eff = effectiveService(picking, zoneSel)
      const backToList = () => setPickingServiceId(null)

      const PickerBody = () => (
        <>
          <h1 className="headline">{picking.name}</h1>
          <p className="lede">Elegí cuándo querés este servicio.</p>
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={eff.duration}
            proHint={serviceStaff[picking.id] ?? "auto"}
            minDate={null}
            onPick={(iso) => {
              setState({ ...state, serviceSlots: { ...serviceSlots, [picking.id]: iso } })
              setPickingServiceId(null)
            }}
            onCancel={backToList}
          />
        </>
      )
      const PickerFooterCTA = () => (
        <div className="footer">
          <div className="footer__row">
            <button className="btn--back" onClick={backToList}>
              ← Atrás
            </button>
          </div>
        </div>
      )

      if (variant === "desktop") {
        return (
          <div className="dmain">
            <div className="dmain__inner">{PickerBody()}</div>
            {PickerFooterCTA()}
          </div>
        )
      }

      return (
        <div className="screen">
          <TopBar onBack={backToList} onClose={onClose} />
          <Progress step={stepNumber} total={totalSteps} />
          <div className="screen__body">{PickerBody()}</div>
          {PickerFooterCTA()}
        </div>
      )
    }

    // Las fechas elegidas, validadas con la MISMA regla que el servidor.
    const chosen = state.services
      .filter((s) => serviceSlots[s.id])
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        startsAtMs: new Date(serviceSlots[s.id]).getTime(),
        durationMin: effectiveService(s, zoneSel).duration,
        priceCents: Math.round(effectiveService(s, zoneSel).price * 100),
      }))
    const overlap =
      chosen.length >= 2 ? validateSeparateSlots(chosen, mountedAtMs) : ({ ok: true } as const)
    const allPicked = state.services.every((s) => serviceSlots[s.id])
    const canContinue = allPicked && overlap.ok

    const SepBody = () => (
      <>
        <h1 className="headline">Tus <em>turnos</em></h1>
        <p className="lede">Elegí la fecha de cada servicio.</p>

        {ModeChooser()}
        {ProPicker()}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "16px 0" }}>
          {state.services.map((s) => {
            const iso = serviceSlots[s.id]
            const eff = effectiveService(s, zoneSel)
            return (
              <div
                key={s.id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "10px 12px", border: "1px solid var(--line)",
                  borderRadius: 10,
                }}
              >
                <span style={{ fontSize: 13 }}>
                  <strong>{s.name}</strong> · {eff.duration} min
                  <br />
                  {iso ? (
                    fmtSlotAR(iso)
                  ) : (
                    <span style={{ color: "var(--ink-mute)" }}>— falta elegir la fecha —</span>
                  )}
                </span>
                <button className="btn" onClick={() => setPickingServiceId(s.id)}>
                  {iso ? "Cambiar" : "Elegir fecha"}
                </button>
              </div>
            )
          })}
        </div>

        {!overlap.ok && (
          <p style={{ fontSize: 12, color: "#8c463c", margin: "0 0 8px" }}>{overlap.error}</p>
        )}
      </>
    )

    const SepFooterCTA = () => (
      <div className="footer">
        <div className="footer__row">
          <button className="btn--back" onClick={onBack}>
            ← Atrás
          </button>
          <button className="btn btn--primary" disabled={!canContinue} onClick={onNext}>
            {!allPicked ? "Elegí la fecha de cada servicio" : "Continuar"}
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
          <div className="dmain__inner">{SepBody()}</div>
          {SepFooterCTA()}
        </div>
      )
    }

    return (
      <div className="screen">
        <TopBar onBack={onBack} onClose={onClose} />
        <Progress step={stepNumber} total={totalSteps} />
        <div className="screen__body">{SepBody()}</div>
        {SepFooterCTA()}
      </div>
    )
  }

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
          {ModeChooser()}
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
        {ModeChooser()}
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

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleContinue = async () => {
    setSaving(true)
    setSaveError(null)
    const r = await saveClientEarly({
      firstName: f.firstName,
      lastName: f.lastName,
      email: f.email,
      phone: f.phone,
      dob: f.dob,
      marketingConsent: f.consent,
    })
    setSaving(false)
    if (!r.ok) { setSaveError(r.error); return }
    setState({ ...state, form: f, clientMode: mode, savedClientId: r.clientId })
    onNext()
  }

  const FooterCTA = () => (
    <div className="footer">
      <div className="footer__row">
        <button className="btn--back" onClick={onBack}>
          ← Atrás
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="footer__summary">
            {saveError
              ? <span style={{ color: "var(--rose)" }}>{saveError}</span>
              : mode === "new"
                ? "Tus datos son privados y encriptados"
                : "Link enviado al abrir tu email"}
          </div>
          <button className="btn btn--primary" disabled={!isValid || saving} onClick={handleContinue}>
            {saving ? "Guardando…" : "Continuar"}
            <span className="btn__arrow">
              <Icon.Arrow />
            </span>
          </button>
        </div>
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
}: ScreenProps & { loyaltyPoints: number; professionals: Professional[]; packs?: ReservaPack[] }) {
  const services = state.services || []
  const combo = state.combo ?? null
  const pack = state.pack ?? null
  const zoneSel = state.zoneSelections ?? {}
  const effective = (s: Service) => effectiveService(s, zoneSel)
  const packZones = pack ? pack.pack.zones.filter((z) => pack.zoneIds.includes(z.id)) : []
  const packDurationMin = pack
    ? (pack.pack.pricingMode === "per_zone"
        ? packZones.reduce((a, z) => a + z.durationMin, 0)
        : pack.pack.serviceDurationMin)
    : 0
  const total = pack ? pack.pack.priceCents / 100 : combo ? combo.price : services.reduce((a, s) => a + effective(s).price, 0)
  const totalMin = pack ? packDurationMin : combo ? combo.duration : services.reduce((a, s) => a + effective(s).duration, 0)
  const totalPointsCost = (pack || combo) ? 0 : services.reduce((a, s) => a + (s.pointsCost ?? 0), 0)
  const canRedeem = !pack && !combo && loyaltyPoints >= totalPointsCost && totalPointsCost > 0
  const redeeming = !!state.redeemWithPoints && canRedeem
  const payChoice: PayChoice = state.payChoice ?? "deposit"
  const separados =
    !pack && !combo && services.length >= 2 && (state.bookingMode ?? "juntos") === "separados"

  // Se calcula en CENTAVOS, igual que el servidor, para que no haya diferencias
  // de redondeo entre lo que ve la clienta y lo que se guarda.
  const totalCents = Math.round(total * 100)
  // En "separados" cada turno lleva su propia seña: lo que transfiere es la
  // SUMA de esas señas, no el 30% del total (cada turno redondea la suya).
  const depositCents = redeeming
    ? 0
    : separados
      ? totalDueNowSeparate(services.map((s) => Math.round(effective(s).price * 100)), payChoice)
      : amountDueNow(totalCents, payChoice)
  const deposit = depositCents / 100
  const remaining = redeeming ? 0 : total - deposit
  const dueNowFor = (c: PayChoice) =>
    separados
      ? totalDueNowSeparate(services.map((s) => Math.round(effective(s).price * 100)), c)
      : amountDueNow(totalCents, c)

  const setPayChoice = (c: PayChoice) => setState({ ...state, payChoice: c })

  const toggleRedeem = (v: boolean) => {
    setState({ ...state, redeemWithPoints: v })
  }

  // Para packs, la fecha se eligió sesión por sesión (`packSlots`); acá
  // mostramos la de la 1ª sesión. `state.selectedDate/selectedTime` no se
  // usan en el flujo de pack (ver Screen2DateTime).
  // Defensa en profundidad, igual que en Screen2DateTime: aplicamos la MISMA
  // limpieza (`cleanPackSlots`) acá, no sólo un slice — si la clienta dejó el
  // flujo parado en esta pantalla, vuelve directo a Screen5Confirm (se
  // restaura el paso persistido) y el paso de fecha nunca llega a montarse,
  // así que su efecto de depuración tampoco corre. Sin esto se le podrían
  // mostrar/enviar sesiones vencidas o de más.
  const packSlotsForDisplay = pack ? cleanPackSlots(state.packSlots ?? [], pack.pack.sessions) : []
  const packFirstSlotAr = packSlotsForDisplay[0] ? arPartsFromUtc(new Date(packSlotsForDisplay[0])) : null
  const dateObj = packFirstSlotAr
    ? parseYmd(packFirstSlotAr.dateStr)
    : (state.selectedDate ? parseYmd(state.selectedDate) : null)
  const dow = dateObj ? DOW_NAMES[(dateObj.getDay() + 6) % 7] : ""
  const displayTime = packFirstSlotAr ? packFirstSlotAr.timeStr : state.selectedTime
  const pro = professionals.find((p) => p.id === (state.pro || "auto")) ?? professionals[0]

  // Per-service schedule for multi-professional bookings
  const isMultiResolved = services.length > 1 && !!state.serviceOrder && !!state.resolvedStaff
  const orderedItems = (() => {
    if (!isMultiResolved || !state.serviceOrder || !state.selectedTime) return []
    const [hh, mm] = state.selectedTime.split(":").map(Number)
    let mins = hh * 60 + mm
    return state.serviceOrder.map((id) => {
      const svc = services.find((s) => s.id === id)
      const staffId = state.resolvedStaff?.[id]
      const assignedPro = professionals.find((p) => p.id === staffId)
      const h = Math.floor(mins / 60), m = mins % 60
      const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      if (svc) mins += effective(svc).duration
      return { svc, assignedPro, startTime }
    }).filter((x): x is { svc: Service; assignedPro: Professional | undefined; startTime: string } => !!x.svc)
  })()

  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pay = async () => {
    // El pack elige sus fechas en `packSlots` (Screen2DateTime), no en
    // `selectedDate/selectedTime` — sólo el flujo sin pack usa esos dos.
    // Depurado con `cleanPackSlots` (mismo motivo que `packSlotsForDisplay`
    // arriba): esta pantalla puede ser la primera en montar tras restaurar el
    // estado persistido, así que no podemos asumir que ya vino limpio.
    const packSlotsPicked = pack ? cleanPackSlots(state.packSlots ?? [], pack.pack.sessions) : []
    const missingDate = pack
      ? packSlotsPicked.length === 0
      : separados
        ? !services.every((s) => state.serviceSlots?.[s.id])
        : (!state.selectedDate || !state.selectedTime)
    if (!state.form || missingDate) {
      setError("Faltan datos del turno. Volvé a los pasos anteriores.")
      return
    }

    // Re-validar las fechas con la MISMA regla que usa el servidor (futuras y
    // sin superposición): el estado puede venir de localStorage y traer
    // fechas que ya pasaron, o que ahora se solapan (p.ej. cambió la duración
    // por una zona elegida distinta). El servidor lo rechaza igual, pero acá
    // se lo decimos ANTES de mostrar el spinner de "Confirmando…".
    if (separados) {
      const items = services.map((s) => ({
        serviceId: s.id,
        name: s.name,
        startsAtMs: new Date(state.serviceSlots![s.id]).getTime(),
        durationMin: effective(s).duration,
        priceCents: Math.round(effective(s).price * 100),
      }))
      const check = validateSeparateSlots(items, Date.now())
      if (!check.ok) {
        setError(check.error)
        return
      }
    }

    // En separados el servidor usa serviceSlots; startsAt va igual porque el
    // schema lo exige: mandamos el más temprano de los elegidos.
    const startsAt = pack
      ? new Date(packSlotsPicked[0])
      : separados
        ? new Date(
            Math.min(...services.map((s) => new Date(state.serviceSlots![s.id]).getTime()))
          )
        : combineDateTime(state.selectedDate!, state.selectedTime!)
    if (Number.isNaN(startsAt.getTime())) {
      // Estado corrupto/persistido viejo: sin esto, `.toISOString()` más
      // abajo tira un RangeError después de `setPaying(true)` y el botón
      // queda trabado en "Confirmando…" para siempre, sin mensaje.
      setError("La fecha del turno no es válida. Volvé al paso de fecha y horario.")
      return
    }

    setPaying(true)
    setError(null)

    const result = await createBooking({
      serviceIds: services.map((s) => s.id),
      startsAt: startsAt.toISOString(),
      proHint: state.pro || "auto",
      // `serviceOrder`/`resolvedStaff` son conceptos de "juntos" (el orden y
      // profesional que el algoritmo resolvió para encadenar servicios en UN
      // turno, ver `selectSeqSlot`) — ni el pack ni "separados" los usan.
      // El pack nunca los resuelve: si quedó seleccionado después de haber
      // resuelto un turno suelto "juntos", esos campos podrían traer un
      // profesional que la clienta nunca eligió para el pack. Y en
      // "separados" cada servicio tiene SU fecha/profesional propios en
      // `serviceSlots`/`serviceStaff`; mandar un `serviceOrder`/`resolvedStaff`
      // viejo (de un "juntos" anterior) no aplica y podría confundir al
      // servidor. Belt-and-braces: nunca los mandamos cuando hay pack o separados.
      serviceOrder: pack || separados ? undefined : state.serviceOrder,
      resolvedStaff: pack || separados ? undefined : state.resolvedStaff,
      serviceSlots: separados ? state.serviceSlots : undefined,
      serviceStaff: separados ? state.serviceStaff : undefined,
      redeemWithPoints: redeeming,
      payChoice,
      savedClientId: state.savedClientId,
      comboId: state.combo?.id,
      packId: state.pack?.pack.id,
      packZoneIds: state.pack?.pack.pricingMode === "per_zone" ? (state.pack?.zoneIds ?? []) : undefined,
      packSlots: pack ? packSlotsPicked : undefined,
      zoneSelections: Object.fromEntries(
        services.filter((s) => s.pricingMode === "per_zone").map((s) => [s.id, zoneSel[s.id] ?? []])
      ),
      client: {
        firstName: state.form.firstName,
        lastName: state.form.lastName,
        email: state.form.email,
        phone: state.form.phone,
        dob: state.form.dob,
        marketingConsent: state.form.consent,
        isExisting: state.clientMode === "existing",
      },
    })

    if (result.ok) {
      // Limpiar el booking en curso y redirigir a la página de confirmación.
      try {
        localStorage.removeItem("blv_booking")
        localStorage.removeItem("blv_step")
      } catch {}
      const ids = result.appointmentIds ?? [result.appointmentId]
      window.location.href = `/reserva/exito?id=${ids.join(",")}`
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
        {payChoice === "full"
          ? "Revisá los detalles. Te coordinamos el pago del total por WhatsApp para dejar el turno confirmado."
          : "Revisá los detalles. Te coordinamos el pago de la seña del 30% por WhatsApp para dejar el turno confirmado."}
      </p>

      <div className="summary">
        <div className="summary__row">
          <span className="summary__label">
            {pack ? "Pack" : `Tratamiento${services.length > 1 ? "s" : ""}`}
          </span>
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {pack ? (
              <div>
                {pack.pack.name} · {pack.pack.sessions} sesiones
                {pack.pack.pricingMode === "per_zone" && packZones.length > 0 && (
                  <small>{packZones.map((z) => z.name).join(", ")}</small>
                )}
              </div>
            ) : isMultiResolved ? (
              orderedItems.map(({ svc, assignedPro, startTime }) => (
                <div key={svc.id} style={{ marginBottom: 8 }}>
                  {svc.name}
                  <small>
                    {startTime}hs · {fmtDuration(effective(svc).duration)} · {fmtPrice(effective(svc).price)}
                    {assignedPro ? ` · ${assignedPro.name}` : ""}
                  </small>
                </div>
              ))
            ) : (
              services.map((s, i) => (
                <div key={s.id} style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}>
                  {s.name}
                  <small>{fmtDuration(effective(s).duration)} · {fmtPrice(effective(s).price)}</small>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="summary__row">
          <span className="summary__label">Cuándo</span>
          <div className="summary__value" style={separados ? { flex: 1, marginLeft: 16 } : undefined}>
            {pack ? (
              <div>
                {packSlotsForDisplay.map((iso, i) => {
                  const parts = arPartsFromUtc(new Date(iso))
                  const d = parseYmd(parts.dateStr)
                  const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                  return (
                    <div key={iso} style={{ marginBottom: i < packSlotsForDisplay.length - 1 ? 6 : 0 }}>
                      <strong>Sesión {i + 1}</strong>
                      <small>
                        {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(totalMin)}
                      </small>
                    </div>
                  )
                })}
                {pack.pack.sessions > packSlotsForDisplay.length && (
                  <small>
                    {`${pack.pack.sessions - packSlotsForDisplay.length} sesión${pack.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} a agendar después`}
                  </small>
                )}
              </div>
            ) : separados ? (
              services.map((s) => {
                const iso = state.serviceSlots?.[s.id]
                return (
                  <div key={s.id} className="breakdown__row">
                    <span>{s.name}</span>
                    <span>{iso ? fmtSlotAR(iso) : "—"}</span>
                  </div>
                )
              })
            ) : (
              <>
                {dow} {dateObj && dateObj.getDate()} de{" "}
                {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
                <small>
                  {displayTime}hs · {fmtDuration(totalMin)}
                </small>
              </>
            )}
          </div>
        </div>
        {separados ? (
        <div className="summary__row">
          <span className="summary__label">Profesional</span>
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {services.map((s, i) => {
              const staffId = state.serviceStaff?.[s.id] ?? "auto"
              const assignedPro = professionals.find((p) => p.id === staffId) ?? professionals[0]
              return (
                <div key={s.id} style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}>
                  {s.name}
                  <small>{assignedPro.name}</small>
                </div>
              )
            })}
          </div>
        </div>
        ) : !isMultiResolved && (
        <div className="summary__row">
          <span className="summary__label">Profesional</span>
          <div className="summary__value" style={{ fontSize: 14 }}>
            {pro.name}
            <small>{pro.role}</small>
          </div>
        </div>
        )}
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
            {remaining > 0 && (
              <div className="breakdown__row">
                <span>Resto a abonar en el local</span>
                <span>{fmtPrice(remaining)}</span>
              </div>
            )}
            <div className="breakdown__row breakdown__row--total">
              <span>{payChoice === "full" ? "Total a pagar hoy" : "Seña (30%) hoy"}</span>
              <span>{fmtPrice(deposit)}</span>
            </div>
          </>
        )}
      </div>

      {!redeeming && total > 0 && (
        <div style={{ margin: "16px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontFamily: "var(--serif)", fontSize: 15 }}>¿Cuánto vas a pagar ahora?</strong>
          {([
            { v: "deposit" as const, label: "La seña (30%)", note: "El resto lo abonás en el local" },
            { v: "full" as const, label: "El total", note: "No debés nada al llegar" },
          ]).map((o) => (
            <label
              key={o.v}
              style={{
                display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                padding: "12px 14px", borderRadius: 12, fontSize: 13,
                border: `1px solid ${payChoice === o.v ? "var(--nude)" : "var(--line)"}`,
                background: payChoice === o.v ? "var(--rose-wash)" : "transparent",
              }}
            >
              <input
                type="radio"
                name="payChoice"
                checked={payChoice === o.v}
                onChange={() => setPayChoice(o.v)}
                style={{ width: 16, height: 16, accentColor: "#b68a5f" }}
              />
              <span style={{ flex: 1 }}>
                <strong>{o.label}</strong>
                <br />
                <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>{o.note}</span>
              </span>
              <strong>{fmtPrice(dueNowFor(o.v) / 100)}</strong>
            </label>
          ))}
        </div>
      )}

      {!redeeming && (
      <div
        className="mp-badge"
        style={{ background: "#fff", border: "1px solid var(--line)", padding: "16px 18px", display: "block" }}
      >
        <div className="mp-text" style={{ fontSize: 13, lineHeight: 1.55 }}>
          <strong style={{ display: "block", marginBottom: 4, fontFamily: "var(--serif)", fontSize: 15 }}>
            {payChoice === "full" ? "Pago por transferencia" : "Seña por transferencia"}
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
            href={whatsappLink(
              payChoice === "full"
                ? "Hola! Te paso el comprobante del pago."
                : "Hola! Te paso el comprobante de la seña."
            )}
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
        <button className="btn--back" onClick={onBack}>
          ← Atrás
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div>
            <div className="footer__summary">{payChoice === "full" ? "Total" : "Seña"}</div>
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
  const zoneSel = state.zoneSelections ?? {}
  const totalMin = services.reduce((a, s) => a + effectiveService(s, zoneSel).duration, 0)

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

// ---------- Waitlist Form ----------
function WaitlistForm({
  serviceNames,
  onSuccess,
  onCancel,
}: {
  serviceNames: string[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [dates, setDates] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setPending(true)
    const r = await joinWaitlist({ name, email, phone, serviceNames, preferredDates: dates })
    setPending(false)
    if (r.ok) onSuccess()
    else setError(r.error ?? "Error al enviar")
  }

  return (
    <div style={{ background: "var(--linen)", borderRadius: 12, padding: 16 }}>
      <p style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 500, margin: "0 0 4px" }}>
        Lista de espera
      </p>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "0 0 14px" }}>
        Te avisamos cuando haya un turno disponible para{" "}
        {serviceNames.join(" + ")}.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          className="field__input"
          placeholder="Tu nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, background: "#fff" }}
        />
        <input
          className="field__input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, background: "#fff" }}
        />
        <input
          className="field__input"
          type="tel"
          placeholder="WhatsApp / teléfono"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, background: "#fff" }}
        />
        <input
          className="field__input"
          placeholder="Días / horarios preferidos (opcional)"
          value={dates}
          onChange={(e) => setDates(e.target.value)}
          style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13, background: "#fff" }}
        />
        {error && <p style={{ fontSize: 12, color: "#8c463c", margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn--primary"
            style={{ flex: 1, fontSize: 13, padding: "10px 16px" }}
            disabled={pending || !name || !email || !phone}
            onClick={submit}
          >
            {pending ? "Enviando…" : "Anotarme"}
          </button>
          <button
            className="btn"
            style={{ fontSize: 13, padding: "10px 16px" }}
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
