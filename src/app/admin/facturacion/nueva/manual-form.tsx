"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaManual } from "../actions"
import { fmtPrice } from "@/app/reserva/data"

export type SelectableItem = {
  kind: "service" | "pack"
  id: string
  name: string
  priceCents: number
}

type LineItem = { key: number; name: string; priceCents: number }

export default function ManualForm({ items = [] }: { items?: SelectableItem[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const keyRef = useRef(0)
  const [lines, setLines] = useState<LineItem[]>([])
  const [picker, setPicker] = useState("")
  const [concepto, setConcepto] = useState("")
  const [montoStr, setMontoStr] = useState("")
  const [identificar, setIdentificar] = useState(false)
  const [docTipo, setDocTipo] = useState<96 | 80>(96)

  const services = items.filter((i) => i.kind === "service")
  const packs = items.filter((i) => i.kind === "pack")
  const subtotalCents = lines.reduce((a, l) => a + l.priceCents, 0)

  function applyLines(next: LineItem[]) {
    setLines(next)
    setConcepto(next.map((l) => l.name).join(", "))
    const subtotal = next.reduce((a, l) => a + l.priceCents, 0)
    setMontoStr(next.length ? String(subtotal / 100) : "")
  }

  function addPicked() {
    if (!picker) return
    const [kind, id] = picker.split(":")
    const item = items.find((i) => i.kind === kind && i.id === id)
    if (!item) return
    applyLines([...lines, { key: keyRef.current++, name: item.name, priceCents: item.priceCents }])
    setPicker("")
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const montoPesos = Number(montoStr)
    if (!concepto.trim()) { setError("Ingresá un concepto o seleccioná un ítem"); return }
    if (!montoPesos || montoPesos <= 0) { setError("Ingresá un monto válido"); return }

    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r = await emitirFacturaManual({
        docTipo: identificar ? docTipo : 99,
        docNro: identificar ? String(fd.get("docNro") ?? "").trim() : "0",
        receptorNombre: String(fd.get("nombre") ?? "").trim(),
        email: String(fd.get("email") ?? "").trim(),
        descripcion: concepto.trim(),
        montoPesos,
      })
      if (r.ok) router.push("/admin/facturacion")
      else setError(r.error ?? "Error al emitir")
    })
  }

  return (
    <form className="adm-card" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      {items.length > 0 && (
        <div>
          <h2 className="adm-section-title" style={{ marginBottom: 8 }}>Ítems (opcional)</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="adm-input" value={picker} onChange={(e) => setPicker(e.target.value)} style={{ flex: 1, minWidth: 220 }}>
              <option value="">Elegí un servicio o pack…</option>
              {services.length > 0 && (
                <optgroup label="Servicios">
                  {services.map((s) => (
                    <option key={`service:${s.id}`} value={`service:${s.id}`}>{s.name} — {fmtPrice(s.priceCents / 100)}</option>
                  ))}
                </optgroup>
              )}
              {packs.length > 0 && (
                <optgroup label="Packs">
                  {packs.map((p) => (
                    <option key={`pack:${p.id}`} value={`pack:${p.id}`}>{p.name} — {fmtPrice(p.priceCents / 100)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" className="adm-btn" onClick={addPicked} disabled={!picker}>+ Agregar</button>
          </div>

          {lines.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((l) => (
                <div key={l.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 14 }}>{l.name}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, fontFamily: "var(--serif)" }}>{fmtPrice(l.priceCents / 100)}</span>
                    <button type="button" onClick={() => applyLines(lines.filter((x) => x.key !== l.key))} className="adm-btn" style={{ fontSize: 12, padding: "2px 8px", color: "#8c463c" }}>✕</button>
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4, fontSize: 13, color: "var(--ink-mute)" }}>
                Subtotal: <strong style={{ fontFamily: "var(--serif)", color: "var(--ink)" }}>{fmtPrice(subtotalCents / 100)}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="adm-label">Concepto</label>
          <input className="adm-input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Seña de tratamiento" />
        </div>
        <div>
          <label className="adm-label">Monto (en pesos)</label>
          <input className="adm-input" type="number" step="0.01" min="0" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} placeholder="3500.00" style={{ width: 200 }} />
        </div>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
          <span>Identificar al receptor (sino, Consumidor Final)</span>
        </label>
        {identificar && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 24, marginTop: 12 }}>
            <div>
              <label className="adm-label">Tipo de documento</label>
              <select className="adm-input" value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value) as 96 | 80)} style={{ width: 200 }}>
                <option value={96}>DNI</option>
                <option value={80}>CUIT</option>
              </select>
            </div>
            <div>
              <label className="adm-label">Número</label>
              <input name="docNro" className="adm-input" placeholder="Sin puntos ni guiones" />
            </div>
            <div>
              <label className="adm-label">Nombre / Razón social</label>
              <input name="nombre" className="adm-input" />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="adm-label">Email (opcional, para enviar el PDF)</label>
        <input name="email" className="adm-input" type="email" placeholder="clienta@email.com" />
      </div>

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>Total</span>
          <span style={{ fontSize: 22, fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(Number(montoStr) || 0)}</span>
        </div>
        <button className="adm-btn adm-btn--primary" type="submit" disabled={pending} style={{ justifyContent: "center", padding: "12px 16px", fontSize: 13 }}>
          {pending ? "Emitiendo…" : "Emitir factura"}
        </button>
      </div>
    </form>
  )
}
