"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

type Props = {
  connected: boolean
  googleEmail: string | null
  connectedAt: string | null
}

export default function GoogleCalendarCard({ connected, googleEmail, connectedAt }: Props) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    const g = searchParams.get("google")
    if (g === "connected") setNotice("Google Calendar conectado correctamente.")
    if (g === "disconnected") setNotice("Google Calendar desconectado.")
    if (g === "error") setNotice("Hubo un error al conectar. Intentá de nuevo.")
    if (g === "denied") setNotice("Autorización cancelada.")
    if (g) router.replace("/admin/configuracion")
  }, [searchParams, router])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    await fetch("/api/google/disconnect", { method: "POST" })
    router.refresh()
    setNotice("Google Calendar desconectado.")
    setDisconnecting(false)
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric", month: "long", year: "numeric",
      timeZone: "America/Argentina/Buenos_Aires",
    })

  return (
    <div className="adm-card" style={{ padding: 28, marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/google-calendar.png" alt="" style={{ width: 28, height: 28 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, margin: 0 }}>
          Google Calendar
        </h3>
        <span className={`adm-pill ${connected ? "adm-pill--active" : "adm-pill--inactive"}`}>
          {connected ? "Conectado" : "No conectado"}
        </span>
      </div>

      <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 20, lineHeight: 1.6 }}>
        Los turnos confirmados se agregan automáticamente al calendario de{" "}
        <strong>bylerivendler@gmail.com</strong> y las profesionales reciben
        una invitación por email.
      </p>

      {connected && googleEmail && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
          Cuenta: <strong>{googleEmail}</strong>
          {connectedAt && <> · Conectado el {fmtDate(connectedAt)}</>}
        </p>
      )}

      {notice && (
        <p style={{
          fontSize: 13,
          color: notice.includes("error") || notice.includes("cancelada") ? "#8c463c" : "#4d6b3e",
          marginBottom: 16,
          fontWeight: 500,
        }}>
          {notice}
        </p>
      )}

      {connected ? (
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="adm-btn"
          style={{ fontSize: 13, padding: "8px 16px", color: "#8c463c", borderColor: "#8c463c" }}
        >
          {disconnecting ? "Desconectando…" : "Desconectar"}
        </button>
      ) : (
        <a
          href="/api/google/connect"
          className="adm-btn"
          style={{ fontSize: 13, padding: "8px 16px", display: "inline-block" }}
        >
          Conectar Google Calendar
        </a>
      )}
    </div>
  )
}
