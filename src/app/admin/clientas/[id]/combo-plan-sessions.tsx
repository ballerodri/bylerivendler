"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { scheduleComboPlanSession } from "../../actions"
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
                onClick={() => { setError(null); setPicking(s.sessionNo) }}>
                + Agendar
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
        </div>
      ))}
      {error && <p role="alert" style={{ fontSize: 12, color: "#8c463c" }}>{error}</p>}
    </div>
  )
}
