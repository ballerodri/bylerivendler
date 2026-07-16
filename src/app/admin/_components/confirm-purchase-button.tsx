"use client"

import { useState, useTransition } from "react"
import { confirmPurchase } from "../actions"

/**
 * Botón único "Confirmar compra": confirma de una vez TODOS los turnos
 * pendientes que comparten `booking_group_id` (la compra entera) y dispara
 * el mail único de confirmación a la clienta. Sin ventana de confirmación:
 * confirmar es la acción feliz del flujo, igual que el "Confirmar" por turno.
 */
export default function ConfirmPurchaseButton({
  bookingGroupId,
}: {
  bookingGroupId: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    setError(null)
    startTransition(async () => {
      const r = await confirmPurchase(bookingGroupId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  return (
    <>
      <button className="adm-btn adm-btn--primary" disabled={pending} onClick={onClick}>
        {pending ? "Confirmando…" : "Confirmar compra"}
      </button>
      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </>
  )
}
