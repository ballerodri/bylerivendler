"use client"

import { useState, useTransition } from "react"
import { anularFacturaAction } from "./actions"

/**
 * Anula una factura emitiendo una Nota de Crédito C. Doble confirmación porque
 * emite un comprobante fiscal REAL (con CAE) que no se puede deshacer.
 */
export default function AnularButton({ invoiceId, nro }: { invoiceId: string; nro: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (
      !window.confirm(
        `¿Anular la Factura C ${nro}?\n\nSe emite una Nota de Crédito que la cancela en ARCA. ` +
          `Es un comprobante fiscal real y NO se puede deshacer. Si querés, después emitís la factura correcta.`
      )
    ) {
      return
    }
    setError(null)
    start(async () => {
      const r = await anularFacturaAction(invoiceId)
      if (!r.ok) setError(r.error ?? "No se pudo anular")
    })
  }

  return (
    <>
      <button
        type="button"
        className="adm-btn adm-btn--ghost"
        style={{ color: "#8c463c" }}
        disabled={pending}
        onClick={onClick}
      >
        {pending ? "Anulando…" : "Anular"}
      </button>
      {error && <span style={{ fontSize: 11, color: "#8c463c", marginLeft: 6 }}>{error}</span>}
    </>
  )
}
