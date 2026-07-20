"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { buscarEnPadron, guardarDocumentoClienta } from "../padron-actions"
import { normalizarDoc, etiquetaCondicionIva, type PadronPersona } from "@/lib/arca/padron-parse"

// Las condiciones que el salón puede elegir a mano cuando ARCA confirma que la
// persona es contribuyente pero no dice el régimen (el A13 da la identidad, no
// el régimen). Monotributista primero: es lo más común entre las clientas.
const CONDICIONES_MANUALES = [6, 1, 4, 5] // Monotributo · Resp. Inscripto · Exento · Cons. Final

// Campo "DNI o CUIT" + botón "Buscar en ARCA", compartido por la ficha de la
// clienta y la pantalla de facturar. Si la búsqueda falla NO bloquea nada: el
// documento se puede guardar igual y la factura se emite como siempre.
export default function PadronLookup({
  clientId,
  docInicial,
  onPersona,
  ayuda,
  autoBuscarDoc,
}: {
  /** Si viene, aparece el botón "Guardar en la ficha". */
  clientId?: string
  docInicial?: string | null
  /** El padre se entera de a quién encontramos (o de que se limpió). */
  onPersona?: (persona: PadronPersona | null) => void
  ayuda?: string
  /**
   * Documento a buscar SOLO: cuando cambia a un valor válido, se dispara la
   * consulta a ARCA automáticamente (lo usa la factura manual al elegir una
   * clienta que ya tiene DNI/CUIT guardado). El padre lo cambia de valor cada
   * vez que quiere forzar una búsqueda.
   */
  autoBuscarDoc?: string | null
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

  const ultimoAuto = useRef<string | null>(null)

  function cambiar(valor: string) {
    setDoc(valor)
    setPersona(null)
    setError(null)
    setGuardado(null)
    onPersona?.(null)
  }

  // `consultarPadron` no lanza, pero la llamada a la server action sí puede:
  // `requireStaff()` tira si se venció la sesión, y la propia invocación falla
  // si el usuario está sin internet, si se redeployó mientras tanto o si el
  // servidor devuelve 500. Sin este try/catch la promesa rechazada dentro del
  // `useTransition` sube al error boundary y deja la pantalla de facturar en
  // blanco: un problema de la búsqueda opcional se llevaba puesta la factura.
  function onBuscar() {
    ejecutarBusqueda(doc)
  }

  // El documento se pasa EXPLÍCITO: cuando la búsqueda la dispara el
  // auto-disparo (abajo), el estado `doc` recién se está seteando y el closure
  // vería el valor viejo.
  function ejecutarBusqueda(docABuscar: string) {
    buscar(async () => {
      setError(null)
      setGuardado(null)
      try {
        const r = await buscarEnPadron(docABuscar)
        if (r.ok) {
          setPersona(r.persona)
          setDoc(r.persona.doc)
          // Contribuyente sin régimen: arranca en Monotributista (lo más
          // común), pero el salón lo puede cambiar. Se emite ya con esa
          // condición elegida para que la factura no salga como Cons. Final.
          if (r.persona.contribuyenteSinRegimen) {
            const inicial = { ...r.persona, condicionIva: 6, condicionIvaTexto: etiquetaCondicionIva(6) }
            setPersona(inicial)
            onPersona?.(inicial)
          } else {
            onPersona?.(r.persona)
          }
        } else {
          setPersona(null)
          onPersona?.(null)
          setError(r.error)
        }
      } catch (e) {
        console.error("[padron-lookup] falló la consulta:", e)
        setPersona(null)
        onPersona?.(null)
        setError("No se pudo consultar. Probá de nuevo.")
      }
    })
  }

  // Auto-disparo: al elegir una clienta con documento guardado, el padre nos
  // pasa ese documento y buscamos en ARCA sin que la usuaria toque nada.
  // (Declarado DESPUÉS de `ejecutarBusqueda` para poder llamarla.)
  useEffect(() => {
    const d = normalizarDoc(autoBuscarDoc ?? "")
    if (!d || (d.length !== 8 && d.length !== 11)) return
    if (ultimoAuto.current === d) return // no re-buscar lo mismo
    ultimoAuto.current = d
    setDoc(d)
    ejecutarBusqueda(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuscarDoc])

  function onGuardar() {
    if (!clientId) return
    guardar(async () => {
      setError(null)
      try {
        const r = await guardarDocumentoClienta(clientId, persona?.doc ?? doc)
        if (r.ok) {
          setGuardado(r.doc ?? null)
          if (r.doc) setDoc(r.doc)
          router.refresh()
        } else {
          setError(r.error ?? "No se pudo guardar")
        }
      } catch (e) {
        console.error("[padron-lookup] falló el guardado:", e)
        setError("No se pudo consultar. Probá de nuevo.")
      }
    })
  }

  /** Vuelve al estado de antes de buscar, sin tener que borrar el campo. */
  function descartar() {
    setPersona(null)
    setError(null)
    setGuardado(null)
    onPersona?.(null)
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
          {persona.contribuyenteSinRegimen ? (
            // ARCA confirma que factura, pero el A13 no dice el régimen: lo
            // elige el salón. El cambio se emite al padre al instante.
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="adm-sub">Frente al IVA:</span>
              <select
                className="adm-select"
                style={{ fontSize: 13, padding: "4px 8px" }}
                value={persona.condicionIva ?? 6}
                onChange={(e) => {
                  const cod = Number(e.target.value)
                  const actualizada = { ...persona, condicionIva: cod, condicionIvaTexto: etiquetaCondicionIva(cod) }
                  setPersona(actualizada)
                  onPersona?.(actualizada)
                }}
              >
                {CONDICIONES_MANUALES.map((c) => (
                  <option key={c} value={c}>{etiquetaCondicionIva(c)}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="adm-sub">
              {persona.condicionIvaTexto
                ? `Frente al IVA: ${persona.condicionIvaTexto}`
                : "No pudimos determinar su condición frente al IVA: se factura como Consumidor Final."}
            </div>
          )}
          {persona.contribuyenteSinRegimen && (
            <div className="adm-sub" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
              ARCA confirma que es contribuyente pero no informa el régimen. Elegí el correcto.
            </div>
          )}
          {/* Salida explícita: antes la única forma de volver atrás era borrar
              el campo, y nadie lo adivinaba. */}
          <button
            type="button"
            onClick={descartar}
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              padding: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              color: "var(--ink-mute)",
              textDecoration: "underline",
            }}
          >
            Descartar / facturar como Consumidor Final
          </button>
        </div>
      )}
    </div>
  )
}
