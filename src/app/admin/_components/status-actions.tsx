"use client"

import { useState, useTransition } from "react"
import { updateAppointmentStatus, deleteAppointment } from "../actions"

const NEXT_ACTIONS: Record<string, { status: string; label: string; variant?: string }[]> = {
  pending: [
    { status: "confirmed", label: "Confirmar", variant: "primary" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  confirmed: [
    { status: "in_progress", label: "Iniciar" },
    { status: "no_show", label: "No vino", variant: "danger" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  in_progress: [
    { status: "completed", label: "Completar", variant: "primary" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  completed: [],
  cancelled: [{ status: "pending", label: "Reactivar" }],
  no_show: [{ status: "pending", label: "Reactivar" }],
}

const RESCHEDULABLE = new Set(["pending", "confirmed"])

export default function StatusActions({
  appointmentId,
  currentStatus,
  matchingPacks = [],
}: {
  appointmentId: string
  currentStatus: string
  matchingPacks?: { id: string; label: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choosingPack, setChoosingPack] = useState(false)
  const actions = NEXT_ACTIONS[currentStatus] ?? []

  const change = (status: string, packPurchaseId?: string) => {
    setError(null)
    setChoosingPack(false)
    startTransition(async () => {
      const r = await updateAppointmentStatus(appointmentId, status, packPurchaseId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const r = await deleteAppointment(appointmentId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  const canReschedule = RESCHEDULABLE.has(currentStatus)

  if (actions.length === 0 && !canReschedule && currentStatus !== "completed") {
    return <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>—</span>
  }

  // Al completar con packs que matchean: ofrecer descontar de un pack.
  if (choosingPack) {
    return (
      <>
        <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>¿Descontar de un pack?</span>
        {matchingPacks.map((p) => (
          <button key={p.id} className="adm-btn adm-btn--primary" disabled={pending} onClick={() => change("completed", p.id)}>
            {p.label}
          </button>
        ))}
        <button className="adm-btn" disabled={pending} onClick={() => change("completed")}>Sin pack</button>
        <button className="adm-btn" onClick={() => setChoosingPack(false)}>Volver</button>
        {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
      </>
    )
  }

  return (
    <>
      {actions.map((a) => {
        const isComplete = a.status === "completed"
        const onClick =
          isComplete && matchingPacks.length > 0
            ? () => setChoosingPack(true)
            : () => change(a.status)
        return (
          <button
            key={a.status}
            className={`adm-btn ${a.variant === "primary" ? "adm-btn--primary" : a.variant === "danger" ? "adm-btn--danger" : ""}`}
            disabled={pending}
            onClick={onClick}
          >
            {a.label}
          </button>
        )
      })}
      {currentStatus === "completed" && (
        <a href={`/admin/turnos/${appointmentId}/facturar`} className="adm-btn adm-btn--primary">
          Facturar
        </a>
      )}
      {canReschedule && (
        <a href={`/admin/turnos/${appointmentId}/reagendar`} className="adm-btn adm-btn--ghost">
          Reagendar
        </a>
      )}
      {confirmDelete ? (
        <>
          <span style={{ fontSize: 12, color: "#8c463c" }}>¿Eliminar?</span>
          <button className="adm-btn adm-btn--danger" disabled={pending} onClick={handleDelete}>Sí, eliminar</button>
          <button className="adm-btn" onClick={() => setConfirmDelete(false)}>No</button>
        </>
      ) : (
        <button className="adm-btn" disabled={pending} onClick={() => setConfirmDelete(true)} style={{ color: "var(--ink-mute)", fontSize: 12 }}>
          Eliminar
        </button>
      )}
      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </>
  )
}
