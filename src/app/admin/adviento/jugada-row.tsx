"use client"

import { useState, useTransition } from "react"
import { marcarUsado, borrarJugada } from "./actions"

/**
 * Una fila de la lista: quién es, qué le tocó, y los dos botones.
 *
 * "Usado" es lo que evita que el mismo premio se cobre dos veces. "Borrar" es
 * la salida para las pruebas y para quien se equivocó al tipear su celular:
 * como el celular es único, sin esto quedaría trabada para siempre.
 */

export default function JugadaRow(props: {
  id: string
  fecha: string
  nombre: string
  telefono: string
  telefonoCrudo: string
  nueva: boolean
  novedades: boolean
  casillero: number
  premio: string
  codigo: string
  usadoEl: string | null
  usadoPor: string | null
  puedeBorrar: boolean
}) {
  const [pendiente, empezar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)

  const whatsapp = `https://wa.me/${props.telefonoCrudo.replace("+", "")}`

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        flexWrap: "wrap",
        padding: "12px 0",
        borderTop: "1px solid var(--adm-line, rgba(43,38,35,0.1))",
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <strong className="adm-name">{props.nombre}</strong>
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "2px 7px",
              borderRadius: 999,
              background: props.nueva ? "#e6f0e7" : "#efe7dc",
              color: "#4a423d",
            }}
          >
            {props.nueva ? "nueva" : "clienta"}
          </span>
          {props.novedades && (
            <span style={{ fontSize: 11, color: "#7a6e64" }} title="Aceptó recibir novedades">
              ✉ novedades
            </span>
          )}
        </div>
        <p className="adm-sub" style={{ margin: "2px 0 0" }}>
          {props.fecha} · <a href={whatsapp} target="_blank" rel="noopener noreferrer">{props.telefono}</a>
        </p>
        <p className="adm-sub" style={{ margin: "4px 0 0", color: "#2b2623" }}>
          Eligió el <strong>{props.casillero}</strong> · {props.premio}
        </p>
        <p className="adm-sub" style={{ margin: "2px 0 0", fontFamily: "var(--font-mono), monospace" }}>
          {props.codigo}
          {props.usadoEl && ` · usado ${props.usadoEl}${props.usadoPor ? ` por ${props.usadoPor}` : ""}`}
        </p>
        {error && <p className="adm-sub" style={{ color: "#a2454f", margin: "4px 0 0" }}>{error}</p>}
      </div>

      <div className="adm-actions" style={{ flex: "0 0 auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className={`adm-btn ${props.usadoEl ? "adm-btn--ghost" : "adm-btn--primary"}`}
          type="button"
          disabled={pendiente}
          onClick={() =>
            empezar(async () => {
              setError(null)
              const r = await marcarUsado(props.id, !props.usadoEl)
              if (!r.ok) setError(r.error ?? "No se pudo.")
            })
          }
        >
          {props.usadoEl ? "Desmarcar" : "Usado"}
        </button>

        {props.puedeBorrar &&
          (confirmandoBorrar ? (
            <>
              <button
                className="adm-btn adm-btn--ghost"
                type="button"
                disabled={pendiente}
                onClick={() =>
                  empezar(async () => {
                    setError(null)
                    const r = await borrarJugada(props.id)
                    if (!r.ok) setError(r.error ?? "No se pudo.")
                  })
                }
              >
                Borrar de verdad
              </button>
              <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setConfirmandoBorrar(false)}>
                No
              </button>
            </>
          ) : (
            <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setConfirmandoBorrar(true)}>
              Borrar
            </button>
          ))}
      </div>
    </div>
  )
}
