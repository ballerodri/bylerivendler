"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { scheduleComboPlanSession, registrarSesionComboPasada } from "../../actions"
import type { BusinessHour } from "@/app/reserva/data"

export type ComboPlanSessionView = {
  sessionNo: number
  // "Ultracavitación + Vela Slim" — los tratamientos de la sesión, en orden.
  label: string
  // Duración total de la visita (min). 0 = no se puede agendar desde acá
  // (algún tratamiento borrado o por-zona sin zonas).
  durationMin: number
  // ISO del turno vivo que ya la agendó, o null si está pendiente.
  scheduledAtIso: string | null
}

const fmtAR = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  })

export default function ComboPlanSessions({
  comboPurchaseId,
  sessions,
  businessHours,
}: {
  comboPurchaseId: string
  sessions: ComboPlanSessionView[]
  businessHours: BusinessHour[]
}) {
  const [picking, setPicking] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const pick = (sessionNo: number, iso: string) => {
    setError(null)
    start(async () => {
      const r = await scheduleComboPlanSession(comboPurchaseId, sessionNo, iso)
      if (r.ok) setPicking(null)
      else setError(r.error ?? "Error")
    })
  }

  // ── Registrar una sesión del plan que YA se hizo (combo cargado tarde) ──
  const [pasadaFor, setPasadaFor] = useState<number | null>(null)
  const [pasadaWhen, setPasadaWhen] = useState("")
  // El input no deja elegir el futuro: esto es sólo para lo que ya pasó (el
  // servidor lo vuelve a exigir igual). Mismo patrón que pack-sessions.
  const maxPasada = new Date(new Date().getTime() - 60_000)
    .toLocaleString("sv", { timeZone: "America/Argentina/Buenos_Aires" })
    .slice(0, 16)
    .replace(" ", "T")

  const registrarPasada = (sessionNo: number) => {
    setError(null)
    // El input da hora ARGENTINA sin zona ("2026-07-14T15:00"); se convierte a
    // instante real con el mismo desfase que usa toda la app (UTC-3).
    const cuando = new Date(`${pasadaWhen}:00-03:00`)
    if (isNaN(cuando.getTime())) { setError("Fecha inválida."); return }
    start(async () => {
      const r = await registrarSesionComboPasada(comboPurchaseId, sessionNo, cuando.toISOString())
      if (r.ok) { setPasadaFor(null); setPasadaWhen("") }
      else setError(r.error ?? "Error")
    })
  }

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {sessions.map((s) => (
        <div key={s.sessionNo} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              <strong>Sesión {s.sessionNo}</strong> · {s.label}
              {s.scheduledAtIso
                ? <span style={{ color: "var(--ink-mute)" }}> · agendada {fmtAR(s.scheduledAtIso)}</span>
                : <span style={{ color: "var(--ink-mute)" }}> · {s.durationMin > 0 ? `${s.durationMin} min` : ""}</span>}
            </span>
            {!s.scheduledAtIso && s.durationMin > 0 && picking !== s.sessionNo && (
              <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={pending}
                onClick={() => { setError(null); setPasadaFor(null); setPicking(s.sessionNo) }}>
                + Agendar
              </button>
            )}
            {!s.scheduledAtIso && s.durationMin > 0 && pasadaFor !== s.sessionNo && (
              <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={pending}
                onClick={() => { setError(null); setPicking(null); setPasadaWhen(""); setPasadaFor(s.sessionNo) }}>
                Ya se hizo
              </button>
            )}
          </div>
          {!s.scheduledAtIso && s.durationMin <= 0 && (
            <span style={{ fontSize: 11, color: "#8c463c" }}>
              No se puede agendar desde acá (un tratamiento ya no existe o es por zona sin zonas). Agendala como un turno común.
            </span>
          )}
          {picking === s.sessionNo && (
            <div className="blv" style={{ minHeight: 0, background: "transparent", maxWidth: 420 }}>
              <PackSessionPicker
                businessHours={businessHours}
                durationMin={s.durationMin}
                proHint="auto"
                // null: admin, no aplica la regla estricta de staff_services acá
                // (la profesional por pata la resuelve el servidor).
                serviceId={null}
                minDate={null}
                onPick={(iso) => pick(s.sessionNo, iso)}
                onCancel={() => setPicking(null)}
              />
            </div>
          )}
          {/* Para combos vendidos/cargados tarde: la sesión ya ocurrió, así que
              no hay disponibilidad que chequear ni mail que mandar — sólo queda
              dejar constancia. Mismo patrón que pack-sessions. */}
          {pasadaFor === s.sessionNo && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                ¿Cuándo se hizo? (fecha y hora, ya pasada)
              </label>
              <input
                type="datetime-local"
                className="adm-input"
                value={pasadaWhen}
                max={maxPasada}
                onChange={(e) => setPasadaWhen(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="adm-btn adm-btn--primary"
                  disabled={pending || !pasadaWhen}
                  onClick={() => registrarPasada(s.sessionNo)}
                >
                  {pending ? "Registrando…" : "Registrar como realizada"}
                </button>
                <button className="adm-btn" disabled={pending}
                  onClick={() => { setPasadaFor(null); setPasadaWhen(""); setError(null) }}>
                  Cancelar
                </button>
              </div>
              <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: 0 }}>
                Queda como <strong>completada</strong>. No se le avisa nada a la clienta.
              </p>
            </div>
          )}
        </div>
      ))}
      {error && <p role="alert" style={{ fontSize: 12, color: "#8c463c" }}>{error}</p>}
    </div>
  )
}
