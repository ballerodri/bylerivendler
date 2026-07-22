"use client"

import { useState, useTransition } from "react"
import { reenviarConfirmacion } from "../actions"

// Botón "Enviar confirmación" para los turnos firmes que quedaron SIN MAIL (un
// turno cargado antes de que el mail existiera, o un envío que falló). Sólo se
// muestra cuando corresponde (lo decide la agenda: sin mail + email real), así
// que acá alcanza con dispararlo y mostrar el resultado.
export default function ResendConfirmationButton({ appointmentId }: { appointmentId: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)

  if (enviado) {
    return <span style={{ fontSize: 11, color: "#4d6b3e" }}>Confirmación enviada ✓</span>
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        className="adm-btn"
        style={{ fontSize: 11, padding: "3px 8px" }}
        disabled={pending}
        onClick={() => {
          setError(null)
          start(async () => {
            const r = await reenviarConfirmacion(appointmentId)
            if (r.ok) setEnviado(true)
            else setError(r.error ?? "No se pudo enviar")
          })
        }}
      >
        {pending ? "Enviando…" : "Enviar confirmación"}
      </button>
      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </span>
  )
}
