"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaManual } from "../actions"
import { searchClients, type ClientSearchResult } from "@/app/admin/actions"
import PadronLookup from "@/app/admin/_components/padron-lookup"
import { docTipoParaDocumento, normalizarDoc, type PadronPersona } from "@/lib/arca/padron-parse"
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
  // Controlados para que "Buscar en ARCA" pueda completarlos (se siguen
  // pudiendo escribir a mano).
  const [docNro, setDocNro] = useState("")
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [condIva, setCondIva] = useState<number | null>(null)

  /** Lo que encontró el padrón: completa tipo, número, nombre y condición. */
  function aplicarPersona(p: PadronPersona | null) {
    if (!p) { setCondIva(null); return }
    setDocTipo(p.docTipo)
    setDocNro(p.doc)
    if (p.nombre) setNombre(p.nombre)
    setCondIva(p.condicionIva)
  }

  // ── Buscar una clienta ya cargada ──────────────────────────────────────────
  const [clientQuery, setClientQuery] = useState("")
  const [clientResults, setClientResults] = useState<ClientSearchResult[]>([])
  const [clientPending, startClientSearch] = useTransition()
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onClientQuery(q: string) {
    setClientQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!q.trim()) { setClientResults([]); return }
    searchTimeout.current = setTimeout(() => {
      startClientSearch(async () => {
        try {
          setClientResults(await searchClients(q))
        } catch {
          setClientResults([])
        }
      })
    }, 300)
  }

  /** Elegir una clienta: completa lo que ya tenga cargado. Si no tiene
   *  documento, el buscador de ARCA de abajo lo resuelve. */
  function elegirClienta(c: ClientSearchResult) {
    setNombre(`${c.first_name} ${c.last_name}`.trim())
    setEmail(c.email ?? "")
    const doc = normalizarDoc(c.dni)
    if (doc) {
      setDocNro(doc)
      const t = docTipoParaDocumento(doc)
      if (t === 96 || t === 80) setDocTipo(t)
    } else {
      setDocNro("")
    }
    // La condición frente al IVA no se guarda en la ficha: si hace falta, se
    // trae con "Buscar en ARCA" (que además completa el documento faltante).
    setCondIva(null)
    setClientQuery("")
    setClientResults([])
  }

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

    // El documento va SIEMPRE normalizado (sin puntos ni guiones): ARCA
    // rechaza cualquier otra cosa.
    const doc = normalizarDoc(docNro)
    if (identificar && !doc) { setError("Ingresá el número de documento del receptor"); return }

    start(async () => {
      const r = await emitirFacturaManual({
        docTipo: identificar ? docTipo : 99,
        docNro: identificar ? doc : "0",
        receptorNombre: nombre.trim(),
        email: email.trim(),
        descripcion: concepto.trim(),
        montoPesos,
        // Sólo si la trajo el padrón para ESTE documento; si no, el servidor
        // usa Consumidor Final como siempre.
        condIva: identificar && condIva != null ? condIva : undefined,
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
            {/* Dos atajos, los dos opcionales: elegir una clienta ya cargada
                (trae nombre, email y su DNI/CUIT si lo tiene), o buscar un
                documento en ARCA (trae nombre y condición frente al IVA).
                Todo se puede escribir a mano igual que siempre. */}
            <div>
              <label className="adm-label">Buscar una clienta ya cargada</label>
              <input
                className="adm-input"
                value={clientQuery}
                onChange={(e) => onClientQuery(e.target.value)}
                placeholder="Nombre, email o teléfono"
              />
              {clientPending && (
                <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>Buscando…</p>
              )}
              {clientResults.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                  {clientResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="adm-btn"
                      style={{ justifyContent: "flex-start", textAlign: "left" }}
                      onClick={() => elegirClienta(c)}
                    >
                      {c.first_name} {c.last_name}
                      <span style={{ color: "var(--ink-mute)", marginLeft: 8, fontSize: 12 }}>
                        {normalizarDoc(c.dni)
                          ? `· ${normalizarDoc(c.dni).length === 11 ? "CUIT" : "DNI"} ${normalizarDoc(c.dni)}`
                          : "· sin documento cargado"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <PadronLookup onPersona={aplicarPersona} />
            <div>
              <label className="adm-label">Tipo de documento</label>
              <select
                className="adm-input"
                value={docTipo}
                onChange={(e) => { setDocTipo(Number(e.target.value) as 96 | 80); setCondIva(null) }}
                style={{ width: 200 }}
              >
                <option value={96}>DNI</option>
                <option value={80}>CUIT</option>
              </select>
            </div>
            <div>
              <label className="adm-label">Número</label>
              <input
                name="docNro"
                className="adm-input"
                placeholder="Sin puntos ni guiones"
                value={docNro}
                // Si se edita el número a mano, la condición frente al IVA que
                // había traído el padrón deja de valer: era de OTRA persona.
                // Sin esto se podría emitir una factura con la condición
                // fiscal equivocada sin que nada lo avise.
                onChange={(e) => { setDocNro(e.target.value); setCondIva(null) }}
              />
            </div>
            <div>
              <label className="adm-label">Nombre / Razón social</label>
              <input
                name="nombre"
                className="adm-input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="adm-label">Email (opcional, para enviar el PDF)</label>
        <input
          name="email"
          className="adm-input"
          type="email"
          placeholder="clienta@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
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
