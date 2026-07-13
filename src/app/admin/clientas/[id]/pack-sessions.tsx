"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { schedulePackSession, confirmPackSessions } from "../../actions"
import type { BusinessHour } from "@/app/reserva/data"

export type PackPurchaseView = {
  id: string
  packName: string
  serviceName: string
  sessionsTotal: number
  sessionsUsed: number
  durationMin: number
  // Si no es null, no podemos calcular la duración de la próxima sesión
  // (típicamente un pack de un servicio por zona vendido en persona, sin
  // ninguna sesión creada todavía) y el picker no debe ofrecerse.
  schedulingBlockedReason: string | null
  intervalDays: number | null
  sessions: { id: string; startsAt: string; status: string }[]
  lastStartsAt: string | null   // última sesión agendada (para el intervalo)
}

export default function PackSessions({
  purchase,
  businessHours,
}: {
  purchase: PackPurchaseView
  businessHours: BusinessHour[]
}) {
  const [picking, setPicking] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState(false)

  const scheduled = purchase.sessions.length
  const missing = purchase.sessionsTotal - scheduled
  const pendingCount = purchase.sessions.filter((s) => s.status === "pending").length

  const minDate =
    !override && purchase.intervalDays && purchase.lastStartsAt
      ? new Date(new Date(purchase.lastStartsAt).getTime() + purchase.intervalDays * 24 * 3600 * 1000)
      : null

  const pick = (iso: string) => {
    setError(null)
    startTransition(async () => {
      const r = await schedulePackSession(purchase.id, iso, { allowIntervalOverride: override })
      if (r.ok) setPicking(false)
      else setError(r.error ?? "Error")
    })
  }

  const confirmAll = () => {
    setError(null)
    startTransition(async () => {
      const r = await confirmPackSessions(purchase.id)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  return (
    <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
      <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>
        {scheduled} agendadas · {missing} sin agendar · {purchase.sessionsUsed} completadas
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {purchase.sessions.map((s, i) => (
          <div key={s.id} style={{ fontSize: 13, display: "flex", gap: 10 }}>
            <span style={{ color: "var(--ink-mute)" }}>Sesión {i + 1}</span>
            <span>
              {new Date(s.startsAt).toLocaleString("es-AR", {
                weekday: "short", day: "2-digit", month: "short",
                hour: "2-digit", minute: "2-digit", hour12: false,
                timeZone: "America/Argentina/Buenos_Aires",
              })}
            </span>
            <span className={`adm-pill adm-pill--${s.status}`}>{s.status}</span>
          </div>
        ))}
      </div>

      {picking ? (
        <div>
          {purchase.intervalDays && purchase.lastStartsAt && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 8 }}>
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              Saltear el mínimo de {purchase.intervalDays} días desde la sesión anterior
            </label>
          )}
          <PackSessionPicker
            businessHours={businessHours}
            durationMin={purchase.durationMin}
            proHint="auto"
            minDate={minDate}
            onPick={pick}
            onCancel={() => setPicking(false)}
          />
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {missing > 0 && (
            purchase.schedulingBlockedReason ? (
              <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>
                {purchase.schedulingBlockedReason}
              </p>
            ) : (
              <button className="adm-btn" disabled={pending} onClick={() => setPicking(true)}>
                Agendar sesión
              </button>
            )
          )}
          {pendingCount > 0 && (
            <button className="adm-btn adm-btn--primary" disabled={pending} onClick={confirmAll}>
              {pending ? "Confirmando…" : `Confirmar las ${pendingCount} sesiones`}
            </button>
          )}
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#8c463c", marginTop: 8 }}>{error}</p>}
    </div>
  )
}
