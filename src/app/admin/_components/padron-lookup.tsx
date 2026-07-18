"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { buscarEnPadron, guardarDocumentoClienta } from "../padron-actions"
import { normalizarDoc, type PadronPersona } from "@/lib/arca/padron-parse"

// Campo "DNI o CUIT" + botón "Buscar en ARCA", compartido por la ficha de la
// clienta y la pantalla de facturar. Si la búsqueda falla NO bloquea nada: el
// documento se puede guardar igual y la factura se emite como siempre.
export default function PadronLookup({
  clientId,
  docInicial,
  onPersona,
  ayuda,
}: {
  /** Si viene, aparece el botón "Guardar en la ficha". */
  clientId?: string
  docInicial?: string | null
  /** El padre se entera de a quién encontramos (o de que se limpió). */
  onPersona?: (persona: PadronPersona | null) => void
  ayuda?: string
}) {
  const router = useRouter()
  const [doc, setDoc] = useState(docInicial ?? "")
  const [persona, setPersona] = useState<PadronPersona | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState<string | null>(null)
  const [buscando, buscar] = useTransition()
  const [guardando, guardar] = useTransition()

  const docNormalizado = normalizarDoc(doc)
  const largoValido = docNormalizado.length === 8 || docNormalizado.length === 11
  const ocupado = buscando || guardando

  function cambiar(valor: string) {
    setDoc(valor)
    setPersona(null)
    setError(null)
    setGuardado(null)
    onPersona?.(null)
  }

  function onBuscar() {
    buscar(async () => {
      setError(null)
      setGuardado(null)
      const r = await buscarEnPadron(doc)
      if (r.ok) {
        setPersona(r.persona)
        setDoc(r.persona.doc)
        onPersona?.(r.persona)
      } else {
        setPersona(null)
        onPersona?.(null)
        setError(r.error)
      }
    })
  }

  function onGuardar() {
    if (!clientId) return
    guardar(async () => {
      setError(null)
      const r = await guardarDocumentoClienta(clientId, persona?.doc ?? doc)
      if (r.ok) {
        setGuardado(r.doc ?? null)
        if (r.doc) setDoc(r.doc)
        router.refresh()
      } else {
        setError(r.error ?? "No se pudo guardar")
      }
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="adm-input"
          style={{ width: 200 }}
          value={doc}
          inputMode="numeric"
          placeholder="DNI o CUIT"
          disabled={ocupado}
          onChange={(e) => cambiar(e.target.value)}
        />
        <button
          type="button"
          className="adm-btn"
          disabled={ocupado || !largoValido}
          onClick={onBuscar}
        >
          {buscando ? "Buscando…" : "Buscar en ARCA"}
        </button>
        {clientId && (
          <button
            type="button"
            className="adm-btn"
            disabled={ocupado || !largoValido}
            onClick={onGuardar}
          >
            {guardando ? "Guardando…" : "Guardar en la ficha"}
          </button>
        )}
      </div>

      {ayuda && !persona && !error && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>{ayuda}</p>
      )}

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      {guardado && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>
          Guardado en la ficha: {guardado.length === 11 ? `CUIT ${guardado}` : `DNI ${guardado}`}
        </p>
      )}

      {persona && (
        <div
          className="adm-card"
          style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 2 }}
        >
          <div className="adm-name">{persona.nombre || "(ARCA no devolvió el nombre)"}</div>
          <div className="adm-sub">
            {persona.docTipo === 80 ? "CUIT" : "DNI"} {persona.doc}
          </div>
          <div className="adm-sub">
            {persona.condicionIvaTexto
              ? `Frente al IVA: ${persona.condicionIvaTexto}`
              : "No pudimos determinar su condición frente al IVA: se factura como Consumidor Final."}
          </div>
        </div>
      )}
    </div>
  )
}
