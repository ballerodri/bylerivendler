"use client"

import { useState } from "react"

/**
 * Menú lateral del admin.
 * - Desktop: columna fija de siempre.
 * - Mobile: una BARRA SUPERIOR fija (siempre arriba, no flotante) con el botón
 *   del menú. El botón alterna ☰ / ✕ y abre un drawer que baja debajo de la barra.
 *   El drawer se cierra al tocar el fondo o cualquier link del menú.
 */
export default function Sidebar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <header className="adm-topbar">
        <button
          type="button"
          className="adm-burger"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "✕" : "☰"}
        </button>
        <span className="adm-topbar__title">By Leri Vendler</span>
      </header>

      {open && <div className="adm-backdrop" aria-hidden onClick={() => setOpen(false)} />}

      <aside
        className={`adm-side${open ? " adm-side--open" : ""}`}
        onClick={(e) => {
          // Cerrar al tocar un link del menú.
          if ((e.target as HTMLElement).closest("a")) setOpen(false)
        }}
      >
        {children}
      </aside>
    </>
  )
}
