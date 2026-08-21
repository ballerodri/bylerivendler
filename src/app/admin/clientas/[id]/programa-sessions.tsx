"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { scheduleProgramaSession, registrarSesionProgramaPasada } from "../../actions"
import type { BusinessHour } from "@/app/reserva/data"

export type ProgramaServiceView = {
  serviceId: string
  serviceName: string
  sessionsTotal: number
  sessionsUsed: number
  sessionsRemaining: number
  // Duración de una sesión (min). 0 = no se puede agendar desde acá (servicio
  // por zona sin zonas cargadas en el programa).
  durationMin: number
}

export default function ProgramaSessions({
  comboPurchaseId,
  services,
  businessHours,
}: {
  comboPurchaseId: string
  services: ProgramaServiceView[]
  businessHours: BusinessHour[]
}) {
  const [pickingService, setPickingService] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const pick = (serviceId: string, iso: string) => {
    setError(null)
    start(async () => {
      const r = await scheduleProgramaSession(comboPurchaseId, serviceId, iso)
      if (r.ok) setPickingService(null)
      else setError(r.error ?? "Error")
    })
  }

  // ── Registrar una sesión que YA se hizo (programa cargado tarde) ──
  const [pasadaFor, setPasadaFor] = useState<string | null>(null)
  const [pasadaWhen, setPasadaWhen] = useState("")
  // El input no deja elegir el futuro: esto es sólo para lo que ya pasó (el
  // servidor lo vuelve a exigir igual). Mismo patrón que pack-sessions.
  const maxPasada = new Date(new Date().getTime() - 60_000)
    .toLocaleString("sv", { timeZone: "America/Argentina/Buenos_Aires" })
    .slice(0, 16)
    .replace(" ", "T")

  const registrarPasada = (serviceId: string) => {
    setError(null)
    // El input da hora ARGENTINA sin zona ("2026-07-14T15:00"); se convierte a
    // instante real con el mismo desfase que usa toda la app (UTC-3).
    const cuando = new Date(`${pasadaWhen}:00-03:00`)
    if (isNaN(cuando.getTime())) { setError("Fecha inválida."); return }
    start(async () => {
      const r = await registrarSesionProgramaPasada(comboPurchaseId, serviceId, cuando.toISOString())
      if (r.ok) { setPasadaFor(null); setPasadaWhen("") }
      else setError(r.error ?? "Error")
    })
  }

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {services.map((s, i) => {
        const done = s.sessionsRemaining <= 0
        return (
          <div key={s.serviceId ?? `svc-${i}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>
                {s.serviceName}: agendadas {s.sessionsUsed}/{s.sessionsTotal}
                {s.sessionsRemaining > 0 && <span style={{ color: "var(--ink-mute)" }}> · quedan {s.sessionsRemaining}</span>}
              </span>
              {!done && s.durationMin > 0 && pickingService !== s.serviceId && (
                <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={pending}
                  onClick={() => { setError(null); setPasadaFor(null); setPickingService(s.serviceId) }}>
                  + Agendar sesión
                </button>
              )}
              {!done && s.durationMin > 0 && pasadaFor !== s.serviceId && (
                <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={pending}
                  onClick={() => { setError(null); setPickingService(null); setPasadaWhen(""); setPasadaFor(s.serviceId) }}>
                  Ya se hizo
                </button>
              )}
            </div>
            {!done && s.durationMin <= 0 && (
              <span style={{ fontSize: 11, color: "#8c463c" }}>
                No se puede agendar desde acá (servicio por zona sin zonas, o el servicio ya no existe). Agendalo como un turno común.
              </span>
            )}
            {pickingService === s.serviceId && (
              <div className="blv" style={{ minHeight: 0, background: "transparent", maxWidth: 420 }}>
                <PackSessionPicker
                  businessHours={businessHours}
                  durationMin={s.durationMin}
                  proHint="auto"
                  // null: admin, no aplica la regla estricta de staff_services
                  // (igual que schedulePackSession y su chequeo del servidor).
                  serviceId={null}
                  minDate={null}
                  onPick={(iso) => pick(s.serviceId, iso)}
                  onCancel={() => setPickingService(null)}
                />
              </div>
            )}
            {/* Para programas vendidos/cargados tarde: la sesión ya ocurrió, así
                que no hay disponibilidad que chequear ni mail que mandar — sólo
                queda dejar constancia. Mismo patrón que pack-sessions. */}
            {pasadaFor === s.serviceId && (
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
                    onClick={() => registrarPasada(s.serviceId)}
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
        )
      })}
      {error && <p role="alert" style={{ fontSize: 12, color: "#8c463c" }}>{error}</p>}
    </div>
  )
}
