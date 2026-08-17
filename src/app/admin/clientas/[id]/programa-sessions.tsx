"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { scheduleProgramaSession } from "../../actions"
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

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {services.map((s) => {
        const done = s.sessionsRemaining <= 0
        return (
          <div key={s.serviceId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span>
                {s.serviceName}: agendadas {s.sessionsUsed}/{s.sessionsTotal}
                {s.sessionsRemaining > 0 && <span style={{ color: "var(--ink-mute)" }}> · quedan {s.sessionsRemaining}</span>}
              </span>
              {!done && s.durationMin > 0 && pickingService !== s.serviceId && (
                <button className="adm-btn" style={{ fontSize: 11, padding: "3px 10px" }} disabled={pending}
                  onClick={() => { setError(null); setPickingService(s.serviceId) }}>
                  + Agendar sesión
                </button>
              )}
            </div>
            {!done && s.durationMin <= 0 && (
              <span style={{ fontSize: 11, color: "#8c463c" }}>
                No se puede agendar desde acá (servicio por zona sin zonas cargadas en el programa). Agendalo como un turno común.
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
          </div>
        )
      })}
      {error && <p role="alert" style={{ fontSize: 12, color: "#8c463c" }}>{error}</p>}
    </div>
  )
}
