"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createCategory, deleteCategory } from "../actions"

export default function CategoryActions({
  categoryId,
  categoryName,
  showNewForm,
}: {
  categoryId?: string
  categoryName?: string
  showNewForm?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState("")
  const [tagline, setTagline] = useState("")

  const handleDelete = () => {
    if (!categoryId) return
    if (!confirm(`¿Eliminar la categoría "${categoryName}"?`)) return
    setError(null)
    startTransition(async () => {
      const r = await deleteCategory(categoryId)
      if (!r.ok) setError(r.error)
      else router.refresh()
    })
  }

  const handleCreate = () => {
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const r = await createCategory(name, tagline)
      if (r.ok) {
        setName("")
        setTagline("")
        setShowForm(false)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  if (categoryId) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="adm-btn adm-btn--ghost"
          style={{ fontSize: 12, color: "#8c463c" }}
          onClick={handleDelete}
          disabled={pending}
        >
          Eliminar categoría
        </button>
        {error && <span style={{ fontSize: 11, color: "#8c463c" }}>{error}</span>}
      </div>
    )
  }

  if (showNewForm) {
    return (
      <div style={{ marginTop: 8 }}>
        {!showForm ? (
          <button
            className="adm-btn adm-btn--ghost"
            onClick={() => setShowForm(true)}
          >
            + Nueva categoría
          </button>
        ) : (
          <div className="adm-card" style={{ padding: 20 }}>
            <p className="adm-section-title" style={{ marginBottom: 12 }}>Nueva categoría</p>
            <div className="adm-grid" style={{ marginBottom: 12 }}>
              <div>
                <div className="adm-row__label" style={{ marginBottom: 6 }}>Nombre *</div>
                <input
                  className="adm-input"
                  style={{ width: "100%" }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Corporales"
                />
              </div>
              <div>
                <div className="adm-row__label" style={{ marginBottom: 6 }}>Tagline (opcional)</div>
                <input
                  className="adm-input"
                  style={{ width: "100%" }}
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="Ej: Tratamientos de cuerpo completo"
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                className="adm-btn adm-btn--primary"
                onClick={handleCreate}
                disabled={pending || !name.trim()}
              >
                {pending ? "Creando…" : "Crear categoría"}
              </button>
              <button
                className="adm-btn adm-btn--ghost"
                onClick={() => { setShowForm(false); setName(""); setTagline(""); setError(null) }}
                disabled={pending}
              >
                Cancelar
              </button>
              {error && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}
