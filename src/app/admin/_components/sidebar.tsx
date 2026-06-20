"use client"

import { useState } from "react"

/**
 * Envuelve el menú lateral del admin. En desktop se ve siempre (columna fija).
 * En mobile se colapsa: un botón hamburguesa lo abre como drawer deslizable,
 * y se cierra al tocar el fondo, la ✕, o cualquier link del menú.
 */
export default function Sidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="adm-burger"
        aria-label="Abrir menú"
        onClick={() => setOpen(true)}
      >
        ☰
      </button>

      {open && <div className="adm-backdrop" aria-hidden onClick={() => setOpen(false)} />}

      <aside
        className={`adm-side${open ? " adm-side--open" : ""}`}
        onClick={(e) => {
          // Cerrar el drawer al tocar un link del menú.
          if ((e.target as HTMLElement).closest("a")) setOpen(false)
        }}
      >
        <button
          type="button"
          className="adm-side__close"
          aria-label="Cerrar menú"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
        {children}
      </aside>
    </>
  )
}
