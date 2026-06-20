"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaManual } from "../actions"

export default function ManualForm() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [identificar, setIdentificar] = useState(false)
  const [docTipo, setDocTipo] = useState<96 | 80>(96)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const montoPesos = Number(fd.get("monto"))
    if (!montoPesos || montoPesos <= 0) {
      setError("Ingresá un monto válido")
      return
    }
    start(async () => {
      const r = await emitirFacturaManual({
        docTipo: identificar ? docTipo : 99,
        docNro: identificar ? String(fd.get("docNro") ?? "").trim() : "0",
        receptorNombre: String(fd.get("nombre") ?? "").trim(),
        email: String(fd.get("email") ?? "").trim(),
        descripcion: String(fd.get("descripcion") ?? "").trim(),
        montoPesos,
      })
      if (r.ok) router.push("/admin/facturacion")
      else setError(r.error ?? "Error al emitir")
    })
  }

  return (
    <form className="adm-card" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label>
        <span className="adm-eyebrow">Concepto</span>
        <input name="descripcion" className="adm-input" required placeholder="Ej: Seña de tratamiento" />
      </label>

      <label>
        <span className="adm-eyebrow">Monto (en pesos)</span>
        <input name="monto" className="adm-input" type="number" step="0.01" min="0" required placeholder="3500.00" />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
        <span>Identificar al receptor (sino, Consumidor Final)</span>
      </label>

      {identificar && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 24 }}>
          <label>
            <span className="adm-eyebrow">Tipo de documento</span>
            <select className="adm-select" value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value) as 96 | 80)}>
              <option value={96}>DNI</option>
              <option value={80}>CUIT</option>
            </select>
          </label>
          <label>
            <span className="adm-eyebrow">Número</span>
            <input name="docNro" className="adm-input" placeholder="Sin puntos ni guiones" />
          </label>
          <label>
            <span className="adm-eyebrow">Nombre / Razón social</span>
            <input name="nombre" className="adm-input" />
          </label>
        </div>
      )}

      <label>
        <span className="adm-eyebrow">Email (opcional, para enviar el PDF)</span>
        <input name="email" className="adm-input" type="email" placeholder="clienta@email.com" />
      </label>

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <button
        className="adm-btn adm-btn--primary"
        type="submit"
        disabled={pending}
        style={{ justifyContent: "center", padding: "12px 16px", fontSize: 13, marginTop: 4 }}
      >
        {pending ? "Emitiendo…" : "Emitir factura"}
      </button>
    </form>
  )
}
