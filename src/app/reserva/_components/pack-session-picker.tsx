"use client"

import { useState, useEffect, useRef } from "react"
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
import { arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import { overlappingBlock, type BlockedInterval } from "@/lib/servicios/slot-overlap"

/**
 * De los slots candidatos de un día, cuáles quedan realmente disponibles:
 * ni pasados/dentro del margen de antelación (`filterFutureSlots`) ni
 * anteriores al corte EXACTO (fecha+hora) de `minDate` (la regla del
 * intervalo entre sesiones). Usado tanto por el calendario (para decidir si
 * un día se pinta disponible) como por el efecto que pide el detalle al
 * servidor, para que ambos nunca puedan desalinearse.
 *
 * No contempla los turnos ya ocupados por otras reservas: eso requiere la
 * ida y vuelta al servidor que hace el efecto.
 */
function allowedSlotsForDay(
  dateStr: string,
  daySlots: string[],
  minDate: Date | null,
  /** Admin registrando algo que ya pasó: no se filtra por "futuro". */
  allowPast = false
): string[] {
  const base = allowPast ? daySlots : filterFutureSlots(dateStr, daySlots)
  if (!minDate) return base
  return base.filter((t) => slotToUtcMs(dateStr, t) >= minDate.getTime())
}

/**
 * Elige fecha y hora de UNA sesión de pack. Se usa al comprar el pack y desde
 * el admin. Bloquea todo lo anterior a `minDate` (la regla del intervalo) y
 * sólo ofrece horarios realmente libres (los pide al servidor).
 */
export default function PackSessionPicker({
  businessHours,
  durationMin,
  proHint,
  serviceId,
  minDate,
  onPick,
  onCancel,
  blockedIntervals = [],
  allowPast = false,
  variant = "calendar",
}: {
  businessHours: BusinessHour[]
  durationMin: number
  proHint: string
  // Tramos que la clienta YA ocupa ese día (en ms UTC). Opcional: sin pasarlo
  // (o `[]`), el picker se comporta idéntico a hoy — el admin no lo pasa.
  blockedIntervals?: BlockedInterval[]
  // Requerido (pero nullable): así ningún call site público puede olvidarse
  // de pasarlo y perder la regla en silencio. Con serviceId: se aplica la
  // regla estricta de `staff_services` (caminos públicos, en screens.tsx).
  // Con null (admin, ver pack-sessions.tsx): ninguna regla — el salón tiene
  // que poder agendar una sesión de un servicio todavía sin profesional
  // asignada, igual que en `schedulePackSession`.
  serviceId: string | null
  minDate: Date | null
  onPick: (startsAtIso: string) => void
  onCancel: () => void
  /**
   * SÓLO admin: permite elegir días y horarios que YA PASARON, para registrar
   * una compra vieja que nunca se cargó al sistema. Por defecto `false` — la
   * reserva pública nunca debe ofrecer el pasado.
   */
  allowPast?: boolean
  /**
   * Cómo se eligen los días:
   *  - "calendar" (default): el calendario mensual de siempre — lo usa el admin
   *    (necesita meses viejos con `allowPast`).
   *  - "strip": una fila deslizable con los próximos días CON LUGAR, el primero
   *    ya elegido y los horarios a la vista — la reserva online de la web.
   */
  variant?: "calendar" | "strip"
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Con `allowPast` el calendario también trae los últimos 60 días: es el
  // admin REGISTRANDO una compra vieja que nunca se cargó.
  const [availability] = useState(() =>
    generateAvailability(60, businessHours, allowPast ? 60 : 0)
  )

  // El día mínimo permitido (por la regla del intervalo), como "YYYY-MM-DD"
  // en hora de Argentina (fija UTC-3) — no en la zona horaria del navegador.
  // Si no hay `minDate`, hoy. (Antes de los estados: la tira lo necesita para
  // auto-elegir el primer día con lugar.)
  const todayStr = ymd(today)
  const minDayStr = (() => {
    // Registrando algo pasado no hay piso "hoy": el único corte posible es el
    // intervalo entre sesiones, si es que aplica.
    if (allowPast) return minDate ? arPartsFromUtc(minDate).dateStr : ""
    if (!minDate) return todayStr
    const arDayStr = arPartsFromUtc(minDate).dateStr
    return arDayStr > todayStr ? arDayStr : todayStr
  })()

  // Los días CON LUGAR para la tira, en orden: EXACTAMENTE el mismo filtro con
  // el que el calendario pinta un día como disponible — así las dos vistas
  // nunca pueden divergir.
  const stripDays =
    variant === "strip"
      ? Object.keys(availability)
          .sort()
          .filter((d) => d >= minDayStr && allowedSlotsForDay(d, availability[d] ?? [], minDate, allowPast).length > 0)
      : []

  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  // En la tira el primer día con lugar ya viene elegido: los horarios se ven
  // de entrada, sin "elegí un día para ver horarios".
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    variant === "strip" ? stripDays[0] ?? null : null
  )
  const [slots, setSlots] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedDate) { setSlots([]); return }
    const candidates = allowedSlotsForDay(selectedDate, availability[selectedDate] ?? [], minDate, allowPast)
    if (!candidates.length) { setSlots([]); return }
    let cancelled = false
    setLoading(true)
    fetchDayAvailability(selectedDate, durationMin, proHint, candidates, { serviceId }).then((free) => {
      if (cancelled) return
      setSlots(free)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedDate, durationMin, proHint, availability, minDate, serviceId, allowPast])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
  // Registrando algo pasado se puede retroceder de mes; en la reserva normal
  // no tiene sentido ir a meses que ya fueron.
  const canPrev = allowPast || !(viewYear === today.getFullYear() && viewMonth <= today.getMonth())
  const selectedObj = selectedDate ? parseYmd(selectedDate) : null

  // Para cada horario libre que trae el servidor, ¿se pisa con algo que la
  // clienta ya eligió? (misma regla estricta que `validateSeparateSlots`).
  const slotStates = selectedDate
    ? slots.map((t) => ({
        t,
        block: overlappingBlock(slotToUtcMs(selectedDate, t), durationMin, blockedIntervals),
      }))
    : []
  // Los bloques que efectivamente pisan algún horario de este día (para la
  // leyenda). Se deduplican por referencia (los ítems de `blockedIntervals`
  // son estables), preservando el orden de aparición.
  const activeBlocks: BlockedInterval[] = []
  for (const s of slotStates) if (s.block && !activeBlocks.includes(s.block)) activeBlocks.push(s.block)

  return (
    <div>
      {variant === "strip" ? (
        // ── La tira de días: los próximos días con lugar, deslizables ────────
        <div style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
          <button
            type="button"
            className="daystrip__arrow"
            aria-label="Días anteriores"
            onClick={() => stripRef.current?.scrollBy({ left: -240, behavior: "smooth" })}
          >
            ‹
          </button>
          <div className="daystrip" ref={stripRef}>
            {stripDays.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", padding: "12px 0", margin: 0 }}>
                No hay días con horarios disponibles por ahora. Escribinos por WhatsApp.
              </p>
            )}
            {stripDays.map((d, i) => {
              const obj = parseYmd(d)
              const isSel = selectedDate === d
              const isToday = d === todayStr
              // El mes se muestra en el 1er chip y cada vez que cambia el mes;
              // el resto lleva un espacio para que todos midan igual.
              const showMonth = i === 0 || obj.getDate() === 1
              return (
                <button
                  key={d}
                  type="button"
                  className={`daystrip__chip ${isSel ? "daystrip__chip--selected" : ""}`}
                  onClick={() => setSelectedDate(d)}
                >
                  <span className="daystrip__dow">{isToday ? "Hoy" : DOW_SHORT[(obj.getDay() + 6) % 7]}</span>
                  <span className="daystrip__num">{obj.getDate()}</span>
                  <span className="daystrip__month">{showMonth ? MONTH_NAMES[obj.getMonth()].slice(0, 3) : " "}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="daystrip__arrow"
            aria-label="Más días"
            onClick={() => stripRef.current?.scrollBy({ left: 240, behavior: "smooth" })}
          >
            ›
          </button>
        </div>
      ) : (
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
            const isSel = selectedDate === dateStr
            const isToday = dateStr === ymd(today)
            const tooEarly = dateStr < minDayStr
            const hasSlots =
              !tooEarly &&
              !!availability[dateStr] &&
              allowedSlotsForDay(dateStr, availability[dateStr], minDate, allowPast).length > 0
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
      )}

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
              <>
                <div className="slots__grid">
                  {slotStates.map(({ t, block }) =>
                    block ? (
                      <div
                        key={t}
                        className="slot"
                        style={{ opacity: 0.5, cursor: "default" }}
                        title={`Ya tenés ${block.name} a esta hora`}
                      >
                        {t}
                      </div>
                    ) : (
                      <button
                        key={t}
                        className="slot"
                        onClick={() => onPick(new Date(slotToUtcMs(selectedDate, t)).toISOString())}
                      >
                        {t}
                      </button>
                    )
                  )}
                </div>
                {activeBlocks.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 10 }}>
                    Los horarios en gris se superponen con:{" "}
                    {activeBlocks
                      .map(
                        (b) =>
                          `${b.name} (${arPartsFromUtc(new Date(b.startMs)).timeStr}–${arPartsFromUtc(new Date(b.endMs)).timeStr})`
                      )
                      .join(", ")}
                    .
                  </p>
                )}
              </>
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
