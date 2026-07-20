"use client"

import { useState, useRef, useEffect, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { updateAppointmentStatus, deleteAppointment, registrarPago, reasignarProfesional } from "../actions"

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

// Acciones cuando el turno está "en curso": o lo inició la usuaria a mano
// (in_progress), o es un confirmado cuya hora ya pasó y arrancó solo
// (startedByTime). "Completar" al toque y "No vino" a mano para las que
// faltaron — así ya no hace falta apretar "Iniciar" antes de completar.
const EN_CURSO_ACTIONS = [
  { status: "completed", label: "Completar", variant: "primary" },
  { status: "no_show", label: "No vino", variant: "danger" },
  { status: "cancelled", label: "Cancelar", variant: "danger" },
]

const RESCHEDULABLE = new Set(["pending", "confirmed"])

/** Centavos → pesos para mostrar (mismo estilo que fmtPrice de reserva/data). */
const peso = (cents: number) => "$" + (cents / 100).toLocaleString("es-AR")

/**
 * Pesos tecleados por la usuaria → centavos, redondeando (no truncando) para
 * no perder los centavos de "1500.50". Null si no es un número válido.
 */
function parsePesosToCents(input: string): number | null {
  if (input.trim() === "") return null
  const pesos = parseFloat(input)
  if (!Number.isFinite(pesos) || pesos < 0) return null
  return Math.round(pesos * 100)
}

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
  startedByTime = false,
  totalCents,
  paidCents,
  matchingPacks = [],
  packLinked = false,
  professionals,
  services,
  hideConfirmButton = false,
}: {
  appointmentId: string
  currentStatus: string
  /** Confirmado cuya hora ya pasó: se opera como "en curso" (Completar / No
   *  vino directos) sin haber apretado "Iniciar". Lo calcula la agenda con la
   *  hora del servidor y lo pasa ya resuelto (así no hay desajuste con el
   *  cartelito ni parpadeo de hidratación). */
  startedByTime?: boolean
  totalCents: number
  paidCents: number
  matchingPacks?: { id: string; label: string }[]
  packLinked?: boolean
  professionals?: { id: string; full_name: string }[]
  services?: { serviceId: string; serviceName: string; staffId: string | null; staffName: string | null }[]
  /** En la agenda agrupada por compra, el "Confirmar" por turno se esconde:
   *  lo reemplaza el botón "Confirmar compra" del grupo. El resto (menú ⋯
   *  con Cancelar/Reagendar/etc.) queda igual, y los otros estados
   *  (Iniciar/Completar/Facturar) no se tocan. */
  hideConfirmButton?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choosingPack, setChoosingPack] = useState(false)
  const [payingOpen, setPayingOpen] = useState(false)
  const [payInput, setPayInput] = useState("")
  const [undoTo, setUndoTo] = useState<number | null>(null)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)

  const change = (status: string, packPurchaseId?: string) => {
    setError(null)
    setChoosingPack(false)
    setUndoTo(null)
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
    const nuevoCents = parsePesosToCents(payInput)
    if (nuevoCents === null) { setError("Monto inválido"); return }
    const nuevoTotal = paidCents + nuevoCents
    if (nuevoTotal > totalCents) { setError(`Te pasás: el turno vale ${peso(totalCents)}`); return }
    const prevPaid = paidCents
    startTransition(async () => {
      const r = await registrarPago(appointmentId, nuevoTotal, prevPaid)
      if (r.ok) {
        setPayingOpen(false)
        setUndoTo(prevPaid)
      } else {
        setError(r.error ?? "Error")
      }
    })
  }

  const undoPago = () => {
    if (undoTo === null) return
    setError(null)
    const restore = undoTo
    startTransition(async () => {
      const r = await registrarPago(appointmentId, restore, paidCents)
      if (r.ok) setUndoTo(null)
      else setError(r.error ?? "Error")
    })
  }

  const closePaying = () => {
    setPayingOpen(false)
    setError(null)
    setClearConfirm(false)
  }

  const reasignar = (serviceId: string, staffId: string) => {
    if (!staffId) return
    setError(null)
    startTransition(async () => {
      const r = await reasignarProfesional(appointmentId, serviceId, staffId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  /** Corrige un cobro mal cargado: vuelve el registro a $0 para volver a
   *  cargar el monto correcto. El total y el turno no se tocan. */
  const clearPago = () => {
    setError(null)
    const prevPaid = paidCents
    startTransition(async () => {
      const r = await registrarPago(appointmentId, 0, prevPaid)
      if (r.ok) {
        setPayingOpen(false)
        setClearConfirm(false)
        setUndoTo(prevPaid)
      } else {
        setError(r.error ?? "Error")
      }
    })
  }

  // "En curso" = lo inició la usuaria (in_progress) o es un confirmado cuya
  // hora ya pasó (startedByTime). En ese caso las acciones son Completar / No
  // vino / Cancelar, salteando el "Iniciar".
  const enCurso = currentStatus === "in_progress" || (currentStatus === "confirmed" && startedByTime)
  const actions = enCurso ? EN_CURSO_ACTIONS : (NEXT_ACTIONS[currentStatus] ?? [])
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
    const nuevoCents = parsePesosToCents(payInput)
    const nuevoTotal = nuevoCents === null ? null : paidCents + nuevoCents
    const seExcede = nuevoTotal !== null && nuevoTotal > totalCents

    if (clearConfirm) {
      return (
        <>
          <span style={{ fontSize: 12, color: "#8c463c", whiteSpace: "nowrap" }}>
            ¿Borrar los {peso(paidCents)} ya registrados?
          </span>
          <button className="adm-btn adm-btn--danger" disabled={pending} onClick={clearPago}>Sí, borrar</button>
          <button className="adm-btn" onClick={() => setClearConfirm(false)}>No</button>
          {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
        </>
      )
    }

    return (
      <>
        {paidCents > 0 && (
          <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
            Ya registrado: {peso(paidCents)} de {peso(totalCents)}
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
          ¿Cuánto cobraste ahora? $
        </span>
        <input
          type="number"
          min="0"
          step="any"
          value={payInput}
          onChange={(e) => setPayInput(e.target.value)}
          className="adm-input"
          style={{ width: 100, fontSize: 13, textAlign: "right" }}
          autoFocus
        />
        {nuevoTotal !== null && (
          <span style={{ fontSize: 11, color: seExcede ? "#8c463c" : "var(--ink-mute)", whiteSpace: "nowrap" }}>
            {seExcede ? `Te pasás: el turno vale ${peso(totalCents)}` : `Va a quedar: ${peso(nuevoTotal)} de ${peso(totalCents)}`}
          </span>
        )}
        <button className="adm-btn adm-btn--primary" disabled={pending || nuevoCents === null || seExcede} onClick={savePago}>Guardar</button>
        <button className="adm-btn" onClick={closePaying}>Cancelar</button>
        {paidCents > 0 && (
          <button
            type="button"
            className="adm-btn adm-btn--ghost"
            disabled={pending}
            onClick={() => setClearConfirm(true)}
          >
            Me equivoqué — borrar lo cobrado
          </button>
        )}
        {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
      </>
    )
  }

  if (reassignOpen) {
    return (
      <>
        <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
          Cambiar profesional
        </span>
        {(services ?? []).map((s) => (
          <span key={s.serviceId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
              {s.serviceName}:
            </span>
            <select
              className="adm-select"
              style={{ fontSize: 12, minHeight: 30, padding: "4px 8px" }}
              value={s.staffId ?? ""}
              disabled={pending}
              onChange={(e) => reasignar(s.serviceId, e.target.value)}
            >
              <option value="" disabled>Sin asignar</option>
              {(professionals ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </span>
        ))}
        <button className="adm-btn" onClick={() => { setReassignOpen(false); setError(null) }}>Cerrar</button>
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

  const canReassign = !!services && services.length > 0

  // Cantidad de ítems del menú (para decidir si abre hacia arriba).
  const menuCount = secondaryActions.length + (canReschedule ? 1 : 0) + (totalCents > 0 ? 1 : 0) + (canReassign ? 1 : 0) + 1 // +Eliminar

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
      ) : primaryAction && !(hideConfirmButton && primaryAction.status === "confirmed") ? (
        <button
          className={`adm-btn ${primaryAction.variant === "primary" ? "adm-btn--primary" : ""}`}
          disabled={pending}
          onClick={
            primaryAction.status === "completed" && matchingPacks.length > 0 && !packLinked
              ? () => { setUndoTo(null); setChoosingPack(true) }
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
            onClick={() => { setPayInput(""); setClearConfirm(false); setPayingOpen(true) }}
          >
            Registrar pago
          </button>
        )}
        {canReassign && (
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => { setError(null); setReassignOpen(true) }}
          >
            Cambiar profesional
          </button>
        )}
        {(secondaryActions.length > 0 || canReschedule) && <div className="adm-menu__sep" />}
        <button
          type="button"
          role="menuitem"
          className="adm-menu__danger"
          disabled={pending}
          onClick={() => { setUndoTo(null); setConfirmDelete(true) }}
        >
          Eliminar
        </button>
      </OverflowMenu>

      {undoTo !== null && (
        <span style={{ fontSize: 12, color: "var(--ink-mute)", whiteSpace: "nowrap" }}>
          Cobro registrado.{" "}
          <button type="button" className="adm-btn" disabled={pending} onClick={undoPago}>Deshacer</button>
        </span>
      )}

      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </>
  )
}
