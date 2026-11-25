"use client"

import { useState, useTransition } from "react"
import { cambiarPrueba } from "./actions"

/**
 * El interruptor para probar el calendario fuera de diciembre.
 *
 * Importa que diga con todas las letras qué hace: prenderlo deja la página
 * jugable para cualquiera que tenga el link, no sólo para quien está en el
 * panel. Las jugadas que entren son de verdad.
 */
export default function PruebaSwitch({
  prendido,
  enDiciembre,
}: {
  prendido: boolean
  enDiciembre: boolean
}) {
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (enDiciembre) return null

  return (
    <div
      className="adm-card"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap",
        borderLeft: `3px solid ${prendido ? "#b68a5f" : "transparent"}`,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <strong className="adm-name">
          {prendido ? "Calendario abierto para probar" : "Probar el calendario"}
        </strong>
        <p className="adm-sub" style={{ margin: "4px 0 0" }}>
          {prendido ? (
            <>
              Ahora mismo <strong>cualquiera con el link puede jugar</strong>, aunque todavía no sea
              diciembre. Las jugadas que entren son de verdad: después borralas de la lista. Acordate
              de apagarlo.
            </>
          ) : (
            <>
              Abre <a href="/adviento">/adviento</a> fuera de fecha para que lo puedas recorrer desde
              cualquier teléfono, sin entrar al panel. Mientras esté prendido, cualquiera con el link
              puede jugar.
            </>
          )}
        </p>
        {error && (
          <p className="adm-sub" role="alert" style={{ color: "#a2454f", margin: "4px 0 0" }}>
            {error}
          </p>
        )}
      </div>

      <button
        className={`adm-btn ${prendido ? "adm-btn--ghost" : "adm-btn--primary"}`}
        type="button"
        disabled={pendiente}
        onClick={() =>
          empezar(async () => {
            setError(null)
            const r = await cambiarPrueba(!prendido)
            if (!r.ok) setError(r.error ?? "No se pudo.")
          })
        }
      >
        {pendiente ? "Un segundo…" : prendido ? "Cerrar el calendario" : "Abrir para probar"}
      </button>
    </div>
  )
}
