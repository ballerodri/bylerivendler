"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaTurno } from "@/app/admin/facturacion/actions"
import PadronLookup from "@/app/admin/_components/padron-lookup"
import { receptorDocLabel } from "@/lib/arca/format"
import { docTipoParaDocumento, normalizarDoc, type PadronPersona } from "@/lib/arca/padron-parse"

export default function FacturarForm({
  appointmentId,
  tieneDni,
  dni,
  clientId,
}: {
  appointmentId: string
  tieneDni: boolean
  dni?: string | null
  clientId?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [identificar, setIdentificar] = useState(tieneDni)
  const [persona, setPersona] = useState<PadronPersona | null>(null)

  // Lo guardado en la ficha puede ser un CUIT, no un DNI: el tilde tiene que
  // decir lo que realmente se va a mandar.
  const docFicha = normalizarDoc(dni)
  const etiquetaDocFicha = receptorDocLabel(docTipoParaDocumento(docFicha), docFicha)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Mientras no haya una persona traída de ARCA manda lo de siempre: el
          DNI de la ficha. Cuando la hay, manda ella y el tilde desaparece para
          no decir dos cosas distintas sobre la misma factura. */}
      {!persona &&
        (tieneDni ? (
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
            <span>Identificar a la clienta con su {etiquetaDocFicha} (sino, Consumidor Final)</span>
          </label>
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>La clienta no tiene documento cargado: se factura como Consumidor Final.</p>
        ))}

      <div>
        <p style={{ fontSize: 13, marginBottom: 6 }}>Traer los datos de ARCA (opcional)</p>
        <PadronLookup
          clientId={clientId}
          docInicial={dni}
          onPersona={setPersona}
          ayuda="Si no la buscás, la factura sale como hasta ahora."
        />
      </div>

      {persona && (
        <p style={{ fontSize: 13 }}>
          Se factura a <strong>{persona.nombre || "(sin nombre)"}</strong> ·{" "}
          {persona.docTipo === 80 ? "CUIT" : "DNI"} {persona.doc}
          {persona.condicionIvaTexto ? ` · ${persona.condicionIvaTexto}` : " · Consumidor Final"}
        </p>
      )}

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await emitirFacturaTurno(
                appointmentId,
                identificar,
                persona
                  ? { doc: persona.doc, condIva: persona.condicionIva, nombre: persona.nombre || null }
                  : undefined
              )
              if (r.ok) router.push("/admin/facturacion")
              else setError(r.error ?? "Error al emitir")
            })
          }
        >
          {pending ? "Emitiendo…" : "Emitir factura"}
        </button>
        <button type="button" className="adm-btn" onClick={() => router.back()} disabled={pending}>Cancelar</button>
      </div>
    </div>
  )
}
