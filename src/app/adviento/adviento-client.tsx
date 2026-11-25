"use client"

import { useEffect, useRef, useState } from "react"
import { CASILLEROS, ULTIMO_DIA_CANJE } from "@/lib/servicios/adviento"
import { entrar, jugar, type Sorpresa } from "./actions"

/**
 * El recorrido: primero los datos, después el casillero, después la sorpresa.
 *
 * Los datos van ANTES de elegir a propósito: así, si esa persona ya jugó, se le
 * muestra su sorpresa de una en vez de dejarla elegir un número que no va a
 * poder usar. También es el camino para volver a ver el premio después del 24.
 */

type Paso =
  | { tipo: "datos" }
  | { tipo: "confirmar"; nombre: string; apellido: string; telefonoLindo: string }
  | { tipo: "elegir" }
  | { tipo: "sorpresa"; sorpresa: Sorpresa; yaLaTenia: boolean; tocado?: number }

const TONOS = ["adv__door--a", "adv__door--b", "adv__door--c", "adv__door--d"]

export default function AdvientoClient({ puedeElegir }: { puedeElegir: boolean }) {
  const [paso, setPaso] = useState<Paso>({ tipo: "datos" })
  // El "atrás" del teléfono tiene que retroceder UN paso, no sacarte de la
  // página (mismo criterio que el asistente de reserva). Cada paso deja una
  // marca en el historial y la flecha vuelve al anterior.
  const volviendo = useRef(false)
  useEffect(() => {
    const alVolver = (e: PopStateEvent) => {
      const previo = (e.state as { advPaso?: Paso } | null)?.advPaso
      volviendo.current = true
      setPaso(previo ?? { tipo: "datos" })
    }
    window.addEventListener("popstate", alVolver)
    return () => window.removeEventListener("popstate", alVolver)
  }, [])
  useEffect(() => {
    if (volviendo.current) {
      volviendo.current = false
      return
    }
    if (paso.tipo === "datos") window.history.replaceState({ advPaso: paso }, "")
    else window.history.pushState({ advPaso: paso }, "")
  }, [paso])
  const [nombre, setNombre] = useState("")
  const [telefono, setTelefono] = useState("")
  const [novedades, setNovedades] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles no pasa nada: el código está a la vista.
    }
  }

  async function mandarDatos(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)
    try {
      const r = await entrar({ nombre, telefono })
      if (!r.ok) setError(r.error)
      else if (r.estado === "ya-jugo") setPaso({ tipo: "sorpresa", sorpresa: r.sorpresa, yaLaTenia: true })
      else setPaso({ tipo: "confirmar", nombre: r.nombre, apellido: r.apellido, telefonoLindo: r.telefono })
    } catch {
      setError("No pude conectarme. Probá de nuevo en un ratito.")
    } finally {
      setCargando(false)
    }
  }

  async function elegir(casillero: number) {
    setError(null)
    setCargando(true)
    try {
      const r = await jugar({ nombre, telefono, casillero, novedades })
      if (!r.ok) setError(r.error)
      else setPaso({ tipo: "sorpresa", sorpresa: r.sorpresa, yaLaTenia: r.yaLaTenia, tocado: casillero })
    } catch {
      setError("No pude conectarme. Probá de nuevo en un ratito.")
    } finally {
      setCargando(false)
    }
  }

  // ── Paso 3: la sorpresa ────────────────────────────────────────────────
  if (paso.tipo === "sorpresa") {
    const s = paso.sorpresa
    const otroNumero = paso.tocado !== undefined && paso.tocado !== s.casillero
    return (
      <div className="adv__card">
        <div className="adv__prize">
          <span className="adv__kicker">{paso.yaLaTenia ? "Tu sorpresa" : "Abriste el número"}</span>
          <span className="adv__prize-num">{s.casillero}</span>
          <p className="adv__prize-text">{s.premio}</p>
        </div>

        <div className="adv__code">
          <span>{s.codigo}</span>
          <button className="adv__copiar" type="button" onClick={() => copiar(s.codigo)}>
            {copiado ? "¡Copiado!" : "Copiar"}
          </button>
        </div>

        <a className="adv__btn adv__btn--wa" href={s.link} target="_blank" rel="noopener noreferrer">
          Contarle a Leri por WhatsApp
        </a>
        <a className="adv__btn adv__btn--ghost" href="/reserva" target="_blank" rel="noopener">
          Ver turnos disponibles
        </a>

        {otroNumero && (
          <p className="adv__fine">
            Tocaste el {paso.tocado}, pero ya habías abierto el {s.casillero}: esa es tu sorpresa.
          </p>
        )}

        <p className="adv__fine">
          {s.nombre}, mostrale este código a Leri. Lo podés usar hasta el 31 de diciembre, y es una
          sorpresa por persona.
        </p>
      </div>
    )
  }

  // ── Paso 2b: elegir el casillero ───────────────────────────────────────
  if (paso.tipo === "elegir") {
    return (
      <>
        <p className="adv__sub" style={{ textAlign: "center" }}>
          {cargando ? "Abriendo tu sorpresa…" : "Elegí un número. Uno solo, y no sabés qué hay detrás."}
        </p>
        {error && (
          <p className="adv__error" role="alert">
            {error}
          </p>
        )}
        <div className="adv__grid">
          {Array.from({ length: CASILLEROS }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`adv__door ${TONOS[n % TONOS.length]}`}
              onClick={() => elegir(n)}
              disabled={cargando}
              aria-label={`Abrir el número ${n}`}
            >
              {n}
            </button>
          ))}
        </div>
      </>
    )
  }

  // ── Paso 2a: confirmar el teléfono ─────────────────────────────────────
  if (paso.tipo === "confirmar") {
    return (
      <div className="adv__card">
        <div className="adv__prize">
          <span className="adv__kicker">Antes de abrir</span>
          <p className="adv__prize-text">
            {paso.nombre}, ¿te escribimos al <strong>{paso.telefonoLindo}</strong>?
          </p>
        </div>
        <p className="adv__fine">
          Si está mal, Leri no te va a poder contactar y la sorpresa queda tomada igual.
        </p>
        {error && (
          <p className="adv__error" role="alert">
            {error}
          </p>
        )}
        <button className="adv__btn" type="button" onClick={() => setPaso({ tipo: "elegir" })}>
          Sí, es mi número
        </button>
        <button
          className="adv__btn adv__btn--ghost"
          type="button"
          onClick={() => setPaso({ tipo: "datos" })}
        >
          Corregirlo
        </button>
      </div>
    )
  }

  // ── Paso 1: los datos ──────────────────────────────────────────────────
  return (
    <form className="adv__card" onSubmit={mandarDatos}>
      {!puedeElegir && (
        <p className="adv__fine">
          La elección cerró el 24 de diciembre. Si ya jugaste, poné tu celular y te muestro tu
          sorpresa: la podés usar hasta el {ULTIMO_DIA_CANJE.slice(8)} de diciembre.
        </p>
      )}

      <div className="adv__field">
        <label htmlFor="adv-nombre">Nombre y apellido</label>
        <input
          id="adv-nombre"
          type="text"
          autoComplete="name"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="María Pérez"
          required
        />
      </div>

      <div className="adv__field">
        <label htmlFor="adv-tel">Celular</label>
        <input
          id="adv-tel"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="11 2345-6789"
          required
        />
      </div>

      {puedeElegir && (
        <label className="adv__check">
          <input type="checkbox" checked={novedades} onChange={(e) => setNovedades(e.target.checked)} />
          <span>Quiero recibir novedades y promos de By Leri Vendler.</span>
        </label>
      )}

      {error && (
        <p className="adv__error" role="alert">
          {error}
        </p>
      )}

      <button className="adv__btn" type="submit" disabled={cargando}>
        {cargando ? "Un segundo…" : puedeElegir ? "Elegir mi número" : "Ver mi sorpresa"}
      </button>

      <p className="adv__fine">
        Al jugar aceptás que By Leri Vendler te escriba por este premio. Mirá cómo cuidamos tus datos
        en <a href="/privacidad">privacidad</a>.
      </p>
    </form>
  )
}
