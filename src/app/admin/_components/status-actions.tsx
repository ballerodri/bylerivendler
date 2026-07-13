"use client"

import { useState, useRef, useEffect, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { updateAppointmentStatus, deleteAppointment, registrarPago } from "../actions"

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

/** Menú "⋯" flotante para las acciones secundarias. Se dibuja con portal en
 *  <body> (posición fija) para que no lo recorte el overflow:hidden de la
 *  tarjeta; se cierra al hacer clic afuera, con Escape o al hacer scroll. */
function OverflowMenu({ itemCount, children }: { itemCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const right = window.innerWidth - r.right
      const estHeight = 14 + itemCount * 40
      const openUp = r.bottom + estHeight > window.innerHeight - 8
      setPos(openUp ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right })
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="adm-btn adm-kebab"
        aria-label="Más acciones"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        ⋯
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="adm-menu"
            role="menu"
            style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}

export default function StatusActions({
  appointmentId,
  currentStatus,
  totalCents,
  paidCents,
  matchingPacks = [],
  packLinked = false,
}: {
  appointmentId: string
  currentStatus: string
  totalCents: number
  paidCents: number
  matchingPacks?: { id: string; label: string }[]
  packLinked?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choosingPack, setChoosingPack] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)
  const [payInput, setPayInput] = useState("")

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

  const savePago = () => {
    setError(null)
    const pesos = parseInt(payInput, 10)
    if (isNaN(pesos) || pesos < 0) { setError("Monto inválido"); return }
    startTransition(async () => {
      const r = await registrarPago(appointmentId, pesos * 100)
      if (r.ok) setPayingOpen(false)
      else setError(r.error ?? "Error")
    })
  }

  const actions = NEXT_ACTIONS[currentStatus] ?? []
  const isCompleted = currentStatus === "completed"
  const canReschedule = RESCHEDULABLE.has(currentStatus)
  const primaryAction = actions[0]
  const secondaryActions = actions.slice(1)

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

  if (payingOpen) {
    return (
      <>
        <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>Cobrado $</span>
        <input
          type="number"
          min="0"
          value={payInput}
          onChange={(e) => setPayInput(e.target.value)}
          className="adm-input"
          style={{ width: 100, fontSize: 13, textAlign: "right" }}
          autoFocus
        />
        <button className="adm-btn adm-btn--primary" disabled={pending} onClick={savePago}>Guardar</button>
        <button className="adm-btn" onClick={() => setPayingOpen(false)}>Cancelar</button>
        {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
      </>
    )
  }

  if (confirmDelete) {
    return (
      <>
        <span style={{ fontSize: 12, color: "#8c463c", whiteSpace: "nowrap" }}>¿Eliminar turno?</span>
        <button className="adm-btn adm-btn--danger" disabled={pending} onClick={handleDelete}>Sí, eliminar</button>
        <button className="adm-btn" onClick={() => setConfirmDelete(false)}>No</button>
        {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
      </>
    )
  }

  // Cantidad de ítems del menú (para decidir si abre hacia arriba).
  const menuCount = secondaryActions.length + (canReschedule ? 1 : 0) + 1 // +Eliminar

  return (
    <>
      {isCompleted ? (
        totalCents > 0 ? (
          <a href={`/admin/turnos/${appointmentId}/facturar`} className="adm-btn adm-btn--primary">
            Facturar
          </a>
        ) : (
          // Un turno en $0 puede ser una sesión de un pack (ya cubierta por su
          // factura) o un canje con puntos del Programa Cerca. No confundirlos.
          <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            {packLinked ? "Cubierta por la factura del pack" : "Turno en $0 — no se factura"}
          </span>
        )
      ) : primaryAction ? (
        <button
          className={`adm-btn ${primaryAction.variant === "primary" ? "adm-btn--primary" : ""}`}
          disabled={pending}
          onClick={
            primaryAction.status === "completed" && matchingPacks.length > 0 && !packLinked
              ? () => setChoosingPack(true)
              : () => change(primaryAction.status)
          }
        >
          {primaryAction.label}
        </button>
      ) : null}

      <OverflowMenu itemCount={menuCount}>
        {secondaryActions.map((a) => (
          <button
            key={a.status}
            type="button"
            role="menuitem"
            className={a.variant === "danger" ? "adm-menu__danger" : ""}
            disabled={pending}
            onClick={() => change(a.status)}
          >
            {a.label}
          </button>
        ))}
        {canReschedule && (
          <a role="menuitem" href={`/admin/turnos/${appointmentId}/reagendar`}>
            Reagendar
          </a>
        )}
        {totalCents > 0 && (
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => {
              // Se pre-carga con lo que falta cobrar.
              setPayInput(String(Math.round(Math.max(0, totalCents - paidCents) / 100)))
              setPayingOpen(true)
            }}
          >
            Registrar pago
          </button>
        )}
        {(secondaryActions.length > 0 || canReschedule) && <div className="adm-menu__sep" />}
        <button type="button" role="menuitem" className="adm-menu__danger" disabled={pending} onClick={() => setConfirmDelete(true)}>
          Eliminar
        </button>
      </OverflowMenu>

      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </>
  )
}
