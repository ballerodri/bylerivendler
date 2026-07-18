"use client"

import { useState, useTransition } from "react"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { schedulePackSession, confirmPackSessions, registrarSesionPasada } from "../../actions"
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

  // ── Registrar una sesión que YA se hizo ─────────────────────────────────
  const [pasada, setPasada] = useState(false)
  const [pasadaWhen, setPasadaWhen] = useState("")
  // El input no deja elegir el futuro: esto es sólo para lo que ya pasó (el
  // servidor lo vuelve a exigir igual).
  const maxPasada = new Date(new Date().getTime() - 60_000)
    .toLocaleString("sv", { timeZone: "America/Argentina/Buenos_Aires" })
    .slice(0, 16)
    .replace(" ", "T")

  const registrarPasada = () => {
    setError(null)
    // El input da hora ARGENTINA sin zona ("2026-07-14T15:00"); se convierte a
    // instante real con el mismo desfase que usa toda la app (UTC-3).
    const iso = `${pasadaWhen}:00-03:00`
    startTransition(async () => {
      const r = await registrarSesionPasada(purchase.id, new Date(iso).toISOString())
      if (r.ok) { setPasada(false); setPasadaWhen("") }
      else setError(r.error ?? "Error")
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
            // null a propósito: admin, no aplica la regla de staff_services
            // (igual que `schedulePackSession`, del lado del servidor).
            serviceId={null}
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
          {missing > 0 && !pasada && (
            <button className="adm-btn" disabled={pending} onClick={() => setPasada(true)}>
              Registrar una sesión ya realizada
            </button>
          )}
        </div>
      )}

      {/* Para packs vendidos fuera del sistema o cargados tarde: la sesión ya
          ocurrió, así que no hay disponibilidad que chequear ni mail que
          mandar — sólo queda dejar constancia y descontarla del pack. */}
      {pasada && !picking && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
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
              onClick={registrarPasada}
            >
              {pending ? "Registrando…" : "Registrar como realizada"}
            </button>
            <button className="adm-btn" disabled={pending} onClick={() => { setPasada(false); setError(null) }}>
              Cancelar
            </button>
          </div>
          <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: 0 }}>
            Queda como <strong>completada</strong> y descuenta una sesión del pack. No se le avisa
            nada a la clienta.
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#8c463c", marginTop: 8 }}>{error}</p>}
    </div>
  )
}
