"use client"

import { useState, useTransition } from "react"
import { cancelMyAppointments } from "./actions"

/** UN solo link por compra: cancela de una vez TODOS los turnos que la
 *  tarjeta todavía deja cancelar (y a la clienta le llega UN solo mail). */
export default function CancelButton({
  appointmentIds,
  plural,
}: {
  appointmentIds: string[]
  plural: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (
      !window.confirm(
        plural
          ? "¿Cancelar estos turnos? Si faltan menos de 24 horas no es reembolsable la seña."
          : "¿Cancelar este turno? Si faltan menos de 24 horas no es reembolsable la seña."
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const r = await cancelMyAppointments(appointmentIds)
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
        {pending ? "Cancelando…" : plural ? "Cancelar turnos" : "Cancelar turno"}
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
