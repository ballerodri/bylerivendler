"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { venderPack } from "@/app/admin/packs/sell-actions"

export type SellablePack = { id: string; label: string }

export default function SellPack({ clientId, packs }: { clientId: string; packs: SellablePack[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [packId, setPackId] = useState(packs[0]?.id ?? "")
  const [facturar, setFacturar] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (packs.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>No hay packs activos para vender. Creá uno en Packs.</p>
  }

  if (!open) {
    return <button className="adm-btn" onClick={() => setOpen(true)}>+ Vender pack</button>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <select className="adm-input" value={packId} onChange={(e) => setPackId(e.target.value)}>
        {packs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={facturar} onChange={(e) => setFacturar(e.target.checked)} />
        Facturar ahora (emite Factura C y la envía por email)
      </label>
      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() => start(async () => {
            setError(null)
            const r = await venderPack({ clientId, packId, facturar })
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
