"use client"

import { useState, useTransition } from "react"
import { gridStepMin } from "@/lib/servicios/grid-step"
import { updateBusinessHours } from "../actions"

type BusinessHour = { day_of_week: number; is_open: boolean; slots: string[] }

type DayConfig = {
  day_of_week: number
  is_open: boolean
  open_from: string
  open_until: string
  has_break: boolean
  break_from: string
  break_until: string
}

// Cada cuánto se ofrecen los turnos, en minutos. NO se guarda como ajuste
// aparte: se deduce de los horarios guardados con `gridStepMin`, así los datos
// y el selector no pueden decir cosas distintas.
type StepMin = 30 | 60

/**
 * El intervalo con el que arranca el editor, deducido de lo que hay guardado.
 *
 * Se miran sólo los días ABIERTOS con al menos dos horarios distintos (los
 * demás no dicen nada del paso). Mandan los días que caen justo en una de las
 * dos opciones: un día con pausa larga puede tener TODOS sus saltos inflados
 * (07:00 y 09:00 con pausa de 08:00 a 09:00 "mide" 120) y ése no sabe cuánto
 * dura la casilla. Si los días claros no coinciden gana el MÁS CHICO: agrandar
 * el intervalo sin que la usuaria lo pida sería sacarle horarios a la agenda.
 * Sin nada de dónde deducirlo → 1 hora, como siempre.
 */
function initialStepMin(hours: BusinessHour[]): StepMin {
  const steps = hours
    .filter(h => h.is_open && new Set(h.slots).size >= 2)
    .map(h => gridStepMin(h.slots))
  const claros = steps.filter(s => s === 30 || s === 60)
  if (claros.length > 0) return claros.includes(30) ? 30 : 60
  if (steps.length === 0) return 60
  // Una grilla rara (45, 90) cae en la opción que NO le saca horarios a nadie,
  // o sea la más fina de las que la contienen.
  return Math.min(...steps) >= 60 ? 60 : 30
}

/**
 * El paso de UN día guardado, para poder leer su apertura/cierre/pausa.
 *
 * Si sus horarios no alcanzan para deducirlo (un solo horario, o un día cuyo
 * único salto es el de la pausa) se usa el del salón: el intervalo es uno solo
 * para todos los días, así que ése es el dato más confiable que hay.
 */
function dayStepMin(slots: string[], salonStep: StepMin): StepMin {
  const d = gridStepMin(slots)
  if (new Set(slots).size >= 2 && (d === 30 || d === 60)) return d
  return salonStep
}

// Apertura/cierre/pausa se pueden elegir cada 30 min (07:00 a 21:00), aunque las
// franjas de turnos que se generan van cada `stepMin`.
const TIME_OPTIONS: string[] = []
for (let h = 7; h <= 21; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:00`)
  if (h < 21) TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:30`)
}

function slotsFromConfig(cfg: DayConfig, stepMin: number): string[] {
  if (!cfg.is_open) return []
  const [fH, fM] = cfg.open_from.split(":").map(Number)
  const [uH, uM] = cfg.open_until.split(":").map(Number)
  const fromMins = fH * 60 + fM
  const untilMins = uH * 60 + uM
  let breakFrom = 0, breakUntil = 0
  if (cfg.has_break) {
    const [bfH, bfM] = cfg.break_from.split(":").map(Number)
    const [buH, buM] = cfg.break_until.split(":").map(Number)
    breakFrom = bfH * 60 + bfM
    breakUntil = buH * 60 + buM
  }
  const result: string[] = []
  for (let m = fromMins; m < untilMins; m += stepMin) {
    if (cfg.has_break && m >= breakFrom && m < breakUntil) continue
    result.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`)
  }
  return result
}

/**
 * Deduce apertura/cierre/pausa a partir de los horarios guardados de UN día.
 *
 * El `stepMin` que recibe tiene que ser el de ESE día (`gridStepMin(h.slots)`),
 * no el que esté elegido en el selector: si el día está guardado cada 1 hora y
 * el selector dice 30 min, medirlo contra 30 haría ver una pausa donde no hay.
 */
function configFromHour(h: BusinessHour, stepMin: number): DayConfig {
  const slots = [...h.slots].sort()
  const open_from = slots[0] ?? "09:00"
  let open_until = "20:00"
  if (slots.length > 0) {
    const [lH, lM] = slots[slots.length - 1].split(":").map(Number)
    const mins = lH * 60 + lM + stepMin
    const candidate = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`
    if (TIME_OPTIONS.includes(candidate)) open_until = candidate
  }
  let has_break = false, break_from = "13:00", break_until = "14:00"
  for (let i = 1; i < slots.length; i++) {
    const [h1, m1] = slots[i - 1].split(":").map(Number)
    const [h2, m2] = slots[i].split(":").map(Number)
    if ((h2 * 60 + m2) - (h1 * 60 + m1) > stepMin) {
      has_break = true
      const bfMins = h1 * 60 + m1 + stepMin
      break_from = `${String(Math.floor(bfMins / 60)).padStart(2, "0")}:${String(bfMins % 60).padStart(2, "0")}`
      break_until = slots[i]
      break
    }
  }
  return { day_of_week: h.day_of_week, is_open: h.is_open, open_from, open_until, has_break, break_from, break_until }
}

const selectStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "4px 8px",
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  color: "var(--ink)",
}

function TimeSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--ink-mute)" }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export default function HoursEditor({
  hours,
  dayNames,
}: {
  hours: BusinessHour[]
  dayNames: string[]
}) {
  const [stepMin, setStepMin] = useState<StepMin>(() => initialStepMin(hours))
  // Cada día se lee con SU propio paso guardado, no con el que esté elegido en
  // el selector (que la usuaria puede mover): el día que no alcance para
  // deducirlo cae en el del salón, que acá arriba todavía es el guardado.
  const [configs, setConfigs] = useState<DayConfig[]>(
    () => hours.map(h => configFromHour(h, dayStepMin(h.slots, stepMin)))
  )
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const update = (dow: number, patch: Partial<DayConfig>) => {
    setConfigs(prev => prev.map(c => c.day_of_week === dow ? { ...c, ...patch } : c))
    setStatus("idle")
  }

  // Al cambiar el intervalo no hay nada que recalcular a mano: las franjas de
  // cada día salen siempre de su apertura/cierre/pausa más este paso, así que
  // todos los días abiertos se regeneran solos y su configuración se conserva.
  const changeStep = (v: StepMin) => {
    setStepMin(v)
    setStatus("idle")
  }

  const save = () => {
    setError(null)
    setStatus("idle")
    const payload: BusinessHour[] = configs.map(cfg => ({
      day_of_week: cfg.day_of_week,
      is_open: cfg.is_open,
      slots: slotsFromConfig(cfg, stepMin),
    }))
    startTransition(async () => {
      const r = await updateBusinessHours(payload)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  // Options: apertura can go up to second-to-last slot; cierre from second slot onward
  const fromOpts = TIME_OPTIONS.slice(0, -1)
  const untilOpts = TIME_OPTIONS.slice(1)

  return (
    <div>
      <div className="adm-card" style={{ padding: 20, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500 }}>
            Los turnos se ofrecen cada:
          </span>
          <select
            value={stepMin}
            onChange={e => changeStep(Number(e.target.value) === 30 ? 30 : 60)}
            style={selectStyle}
          >
            <option value={30}>30 min</option>
            <option value={60}>1 hora</option>
          </select>
        </label>
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-mute)", lineHeight: 1.5 }}>
          Cambiar el intervalo reacomoda también las horas bloqueadas del personal para que su
          disponibilidad no cambie.
        </p>
      </div>

      {configs.map(cfg => {
        const daySlots = slotsFromConfig(cfg, stepMin)
        return (
        <div key={cfg.day_of_week} className="adm-card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: cfg.is_open ? 16 : 0 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={cfg.is_open}
                onChange={() => update(cfg.day_of_week, { is_open: !cfg.is_open })}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 500 }}>
                {dayNames[cfg.day_of_week]}
              </span>
            </label>
            {!cfg.is_open && (
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>Cerrado</span>
            )}
          </div>

          {cfg.is_open && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                <TimeSelect
                  label="Apertura"
                  value={cfg.open_from}
                  onChange={v => update(cfg.day_of_week, { open_from: v })}
                  options={fromOpts}
                />
                <TimeSelect
                  label="Cierre"
                  value={cfg.open_until}
                  onChange={v => update(cfg.day_of_week, { open_until: v })}
                  options={untilOpts}
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={cfg.has_break}
                  onChange={() => update(cfg.day_of_week, { has_break: !cfg.has_break })}
                  style={{ width: 14, height: 14 }}
                />
                <span style={{ color: "var(--ink-mute)" }}>Pausa / almuerzo</span>
              </label>

              {cfg.has_break && (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", paddingLeft: 22 }}>
                  <TimeSelect
                    label="De"
                    value={cfg.break_from}
                    onChange={v => update(cfg.day_of_week, { break_from: v })}
                    options={fromOpts}
                  />
                  <TimeSelect
                    label="Hasta"
                    value={cfg.break_until}
                    onChange={v => update(cfg.day_of_week, { break_until: v })}
                    options={untilOpts}
                  />
                </div>
              )}

              <p style={{ margin: 0, fontSize: 11, color: "var(--ink-mute)" }}>
                {daySlots.length} franjas de {stepMin === 30 ? "30 min" : "1 hora"} · {daySlots.join(", ") || "—"}
              </p>
            </div>
          )}
        </div>
        )
      })}

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
