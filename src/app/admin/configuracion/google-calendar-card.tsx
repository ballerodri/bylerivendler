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
        {connected && googleEmail
          ? <>Los turnos confirmados se agregan automáticamente al calendario de <strong>{googleEmail}</strong>.</>
          : "Conectá tu cuenta de Google para sincronizar los turnos confirmados con Google Calendar."}
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
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            borderRadius: 8,
            border: "1px solid #dadce0",
            background: "#fff",
            fontSize: 14,
            fontWeight: 500,
            color: "#3c4043",
            textDecoration: "none",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            cursor: "pointer",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Conectar con Google Calendar
        </a>
      )}
    </div>
  )
}
