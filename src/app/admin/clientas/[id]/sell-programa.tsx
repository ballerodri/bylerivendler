"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { venderPrograma } from "@/app/admin/combos/sell-actions"

export type SellablePrograma = { id: string; label: string }

export default function SellPrograma({ clientId, programas }: { clientId: string; programas: SellablePrograma[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [comboId, setComboId] = useState(programas[0]?.id ?? "")
  const [facturar, setFacturar] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (programas.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>No hay combos cargados para vender. Creá uno en Combos.</p>
  }

  if (!open) {
    return <button className="adm-btn" onClick={() => setOpen(true)}>+ Vender combo</button>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <select className="adm-input" value={comboId} onChange={(e) => setComboId(e.target.value)}>
        {programas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={facturar} onChange={(e) => setFacturar(e.target.checked)} />
        Facturar ahora (emite Factura C por el total del combo y la envía por email)
      </label>
      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() => start(async () => {
            setError(null)
            const r = await venderPrograma({ clientId, comboId, facturar })
            if (r.ok) { setOpen(false); router.refresh() }
            else setError(r.error ?? "Error")
          })}
        >
          {pending ? "Registrando…" : "Confirmar venta"}
        </button>
        <button className="adm-btn" onClick={() => setOpen(false)} disabled={pending}>Cancelar</button>
      </div>
    </div>
  )
}
