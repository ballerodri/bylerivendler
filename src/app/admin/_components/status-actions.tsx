"use client"

import { useState, useTransition } from "react"
import { updateAppointmentStatus } from "../actions"

const NEXT_ACTIONS: Record<string, { status: string; label: string; variant?: string }[]> = {
  pending: [
    { status: "confirmed", label: "Confirmar", variant: "primary" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  confirmed: [
    { status: "in_progress", label: "Iniciar" },
    { status: "no_show", label: "No vino", variant: "danger" },
  ],
  in_progress: [{ status: "completed", label: "Completar", variant: "primary" }],
  completed: [],
  cancelled: [{ status: "pending", label: "Reactivar" }],
  no_show: [{ status: "pending", label: "Reactivar" }],
}

const RESCHEDULABLE = new Set(["pending", "confirmed"])

export default function StatusActions({
  appointmentId,
  currentStatus,
}: {
  appointmentId: string
  currentStatus: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const actions = NEXT_ACTIONS[currentStatus] ?? []

  const change = (status: string) => {
    setError(null)
    startTransition(async () => {
      const r = await updateAppointmentStatus(appointmentId, status)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  const canReschedule = RESCHEDULABLE.has(currentStatus)

  if (actions.length === 0 && !canReschedule) {
    return <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>—</span>
  }

  return (
    <>
      {actions.map((a) => (
        <button
          key={a.status}
          className={`adm-btn ${a.variant === "primary" ? "adm-btn--primary" : a.variant === "danger" ? "adm-btn--danger" : ""}`}
          disabled={pending}
          onClick={() => change(a.status)}
        >
          {a.label}
        </button>
      ))}
      {canReschedule && (
        <a
          href={`/admin/turnos/${appointmentId}/reagendar`}
          className="adm-btn adm-btn--ghost"
        >
          Reagendar
        </a>
      )}
      {error && (
        <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>
      )}
    </>
  )
}
