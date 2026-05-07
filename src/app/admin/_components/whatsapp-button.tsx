"use client"

import { useState, useEffect } from "react"

type State = "idle" | "confirming" | "sent"

const TZ = "America/Argentina/Buenos_Aires"

function storageKey(appointmentId: string) {
  const today = new Date().toLocaleDateString("sv", { timeZone: TZ })
  return `wa_sent_${appointmentId}_${today}`
}

export default function WhatsAppButton({
  appointmentId,
  link,
}: {
  appointmentId: string
  link: string
}) {
  const [state, setState] = useState<State>("idle")

  useEffect(() => {
    if (localStorage.getItem(storageKey(appointmentId))) {
      setState("sent")
    }
  }, [appointmentId])

  const handleClick = () => {
    window.open(link, "_blank", "noopener,noreferrer")
    setState("confirming")
  }

  if (state === "sent") {
    return (
      <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
        Enviado ✓
      </span>
    )
  }

  if (state === "confirming") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
        <span style={{ fontSize: 11, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
          ¿Lo enviaste?
        </span>
        <button
          onClick={() => {
            localStorage.setItem(storageKey(appointmentId), "1")
            setState("sent")
          }}
          className="adm-btn"
          style={{ fontSize: 11, padding: "3px 8px", color: "#25D366", borderColor: "#25D366" }}
        >
          Sí
        </button>
        <button
          onClick={() => setState("idle")}
          className="adm-btn"
          style={{ fontSize: 11, padding: "3px 8px" }}
        >
          No
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleClick}
      className="adm-btn"
      style={{ fontSize: 12, padding: "4px 10px", color: "#25D366", borderColor: "#25D366", whiteSpace: "nowrap" }}
    >
      WhatsApp
    </button>
  )
}
