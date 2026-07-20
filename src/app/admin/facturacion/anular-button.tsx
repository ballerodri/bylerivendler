"use client"

import { useState, useTransition } from "react"
import { anularFacturaAction } from "./actions"

/**
 * Anula una factura emitiendo una Nota de Crédito C. La confirmación es EN
 * LÍNEA (no el `window.confirm` del navegador, que rompe el estilo): emite un
 * comprobante fiscal REAL (con CAE) que no se puede deshacer, así que se pide
 * un segundo clic explícito.
 */
export default function AnularButton({ invoiceId, nro }: { invoiceId: string; nro: string }) {
  const [pending, start] = useTransition()
  const [confirmando, setConfirmando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const anular = () => {
    setError(null)
    start(async () => {
      const r = await anularFacturaAction(invoiceId)
      if (r.ok) setConfirmando(false)
      else setError(r.error ?? "No se pudo anular")
    })
  }

  if (confirmando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#8c463c" }}>
          ¿Anular la {nro}? Emite una Nota de Crédito real, no se deshace.
        </span>
        <button
          type="button"
          className="adm-btn adm-btn--danger"
          disabled={pending}
          onClick={anular}
        >
          {pending ? "Anulando…" : "Sí, anular"}
        </button>
        <button
          type="button"
          className="adm-btn"
          disabled={pending}
          onClick={() => { setConfirmando(false); setError(null) }}
        >
          Cancelar
        </button>
        {error && <span style={{ fontSize: 11, color: "#8c463c" }}>{error}</span>}
      </span>
    )
  }

  return (
    <button
      type="button"
      className="adm-btn adm-btn--ghost"
      style={{ color: "#8c463c" }}
      onClick={() => setConfirmando(true)}
    >
      Anular
    </button>
  )
}
