"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaTurno } from "@/app/admin/facturacion/actions"

export default function FacturarForm({ appointmentId, tieneDni }: { appointmentId: string; tieneDni: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [identificar, setIdentificar] = useState(tieneDni)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tieneDni ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
          <span>Identificar a la clienta con su DNI (sino, Consumidor Final)</span>
        </label>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>La clienta no tiene DNI cargado: se factura como Consumidor Final.</p>
      )}

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await emitirFacturaTurno(appointmentId, identificar)
              if (r.ok) router.push("/admin/facturacion")
              else setError(r.error ?? "Error al emitir")
            })
          }
        >
          {pending ? "Emitiendo…" : "Emitir factura"}
        </button>
        <button className="adm-btn" onClick={() => router.back()} disabled={pending}>Cancelar</button>
      </div>
    </div>
  )
}
