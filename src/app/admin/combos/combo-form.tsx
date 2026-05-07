"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createCombo, updateCombo } from "../actions"
import { fmtPrice } from "../../reserva/data"

export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
}

type Props = {
  services: ServiceOption[]
  initial?: {
    id: string
    name: string
    description: string
    totalPriceCents: number
    serviceIds: string[]
  }
}

export default function ComboForm({ services, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [priceInput, setPriceInput] = useState(
    initial ? String(Math.round(initial.totalPriceCents / 100)) : ""
  )
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.serviceIds ?? [])

  const toggleService = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...selectedIds]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setSelectedIds(next)
  }

  const moveDown = (idx: number) => {
    if (idx === selectedIds.length - 1) return
    const next = [...selectedIds]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setSelectedIds(next)
  }

  const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
  const selectedServices = selectedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is ServiceOption => Boolean(s))
  const fullPriceCents = selectedServices.reduce((a, s) => a + s.price_cents, 0)
  const saving = fullPriceCents - totalPriceCents

  const handleSubmit = () => {
    if (!name.trim()) { setError("El nombre es obligatorio."); return }
    if (selectedIds.length < 2) { setError("Seleccioná al menos 2 servicios."); return }
    if (totalPriceCents <= 0) { setError("Ingresá el precio del combo."); return }

    setError(null)
    startTransition(async () => {
      const input = {
        name,
        description,
        totalPriceCents,
        serviceIds: selectedIds,
      }
      const r = initial
        ? await updateCombo(initial.id, input)
        : await createCombo(input)
      if (r.ok) {
        router.push("/admin/combos")
      } else {
        setError(r.error ?? "Error al guardar.")
      }
    })
  }

  // Group services by category for display
  const byCategory = services.reduce<Record<string, ServiceOption[]>>((acc, s) => {
    ;(acc[s.category] ??= []).push(s)
    return acc
  }, {})

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Name & description */}
      <div className="adm-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 0 }}>Datos del combo</h2>
        <div>
          <label className="adm-label">Nombre *</label>
          <input
            className="adm-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Combo facial completo"
          />
        </div>
        <div>
          <label className="adm-label">Descripción (opcional)</label>
          <input
            className="adm-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Breve descripción para la clienta"
          />
        </div>
        <div>
          <label className="adm-label">Precio del combo *</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <span style={{ position: "absolute", left: 12, fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)" }}>$</span>
              <input
                className="adm-input"
                type="number"
                min="0"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                style={{ paddingLeft: 28, width: 160 }}
                placeholder="0"
              />
            </div>
            {fullPriceCents > 0 && totalPriceCents > 0 && (
              <span style={{ fontSize: 13, color: saving > 0 ? "#4d6b3e" : saving < 0 ? "#8c463c" : "var(--ink-mute)" }}>
                {saving > 0
                  ? `${fmtPrice(saving / 100)} de ahorro`
                  : saving < 0
                  ? `${fmtPrice(Math.abs(saving) / 100)} más caro que por separado`
                  : "igual al precio individual"}
              </span>
            )}
          </div>
          {fullPriceCents > 0 && (
            <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>
              Precio individual: {fmtPrice(fullPriceCents / 100)}
            </p>
          )}
        </div>
      </div>

      {/* Service selection */}
      <div className="adm-card" style={{ padding: 24 }}>
        <h2 className="adm-section-title" style={{ marginBottom: 16 }}>Servicios incluidos *</h2>
        {Object.entries(byCategory).map(([cat, svcs]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 8 }}>{cat}</p>
            {svcs.map((s) => (
              <label
                key={s.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 0", borderBottom: "1px solid var(--border)", cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.id)}
                  onChange={() => toggleService(s.id)}
                  style={{ width: 16, height: 16, accentColor: "var(--gold)", flexShrink: 0 }}
                />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 14 }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-mute)", marginLeft: 8 }}>
                    {s.duration_min} min · {fmtPrice(s.price_cents / 100)}
                  </span>
                </div>
              </label>
            ))}
          </div>
        ))}
      </div>

      {/* Order */}
      {selectedIds.length > 1 && (
        <div className="adm-card" style={{ padding: 24 }}>
          <h2 className="adm-section-title" style={{ marginBottom: 4 }}>Orden en cabina</h2>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 16 }}>
            Así se ejecutan los tratamientos en la sesión.
          </p>
          {selectedServices.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "8px 0", borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontFamily: "var(--serif)", fontSize: 18, color: "var(--gold)", minWidth: 24, textAlign: "center" }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 14 }}>{s.name}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="adm-btn"
                  style={{ fontSize: 11, padding: "2px 8px", opacity: i === 0 ? 0.3 : 1 }}
                >
                  ↑
                </button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === selectedIds.length - 1}
                  className="adm-btn"
                  style={{ fontSize: 11, padding: "2px 8px", opacity: i === selectedIds.length - 1 ? 0.3 : 1 }}
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={handleSubmit}
          disabled={pending}
          className="adm-btn"
          style={{ fontSize: 14, padding: "10px 24px", background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" }}
        >
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Crear combo"}
        </button>
        <button
          onClick={() => router.push("/admin/combos")}
          disabled={pending}
          className="adm-btn"
          style={{ fontSize: 14, padding: "10px 24px" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
