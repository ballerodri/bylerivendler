"use client"

import { useState, useTransition } from "react"
import { cancelMyAppointment } from "./actions"

export default function CancelButton({
  appointmentId,
  label,
}: {
  appointmentId: string
  /** Con varios turnos en la misma tarjeta (una compra), el link dice CUÁL
   *  cancela ("Cancelar turno de las 10:30"). Sin label: "Cancelar turno". */
  label?: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (
      !window.confirm(
        "¿Cancelar este turno? Si faltan menos de 24 horas no es reembolsable la seña."
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const r = await cancelMyAppointment(appointmentId)
      if (!r.ok) setError(r.error)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          fontSize: 11,
          color: "#8c463c",
          textDecoration: "underline",
          textUnderlineOffset: 3,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {pending ? "Cancelando…" : label ?? "Cancelar turno"}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "#8c463c",
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </>
  )
}
