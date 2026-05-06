"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createService } from "../../actions"

export default function NewServiceForm({
  categories,
  defaultCategoryId,
}: {
  categories: { id: string; name: string }[]
  defaultCategoryId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState({
    categoryId: defaultCategoryId || categories[0]?.id || "",
    name: "",
    description: "",
    duration_min: 60,
    price_cents: 0,
    points_earned: 0,
    points_cost: 0,
  })

  const save = () => {
    setError(null)
    startTransition(async () => {
      const r = await createService(data.categoryId, {
        name: data.name,
        description: data.description,
        duration_min: data.duration_min,
        price_cents: data.price_cents,
        points_earned: data.points_earned,
        points_cost: data.points_cost,
      })
      if (r.ok) {
        router.push(`/admin/servicios/${r.id}`)
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
      <Field label="Categoría">
        <select
          className="adm-input"
          style={{ width: "100%" }}
          value={data.categoryId}
          onChange={(e) => setData({ ...data, categoryId: e.target.value })}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Nombre">
        <input
          className="adm-input"
          style={{ width: "100%" }}
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
          placeholder="Ej: Limpieza facial profunda"
        />
      </Field>

      <Field label="Descripción (opcional)">
        <textarea
          className="adm-input"
          style={{ width: "100%", minHeight: 80, padding: 12, lineHeight: 1.5 }}
          value={data.description}
          onChange={(e) => setData({ ...data, description: e.target.value })}
        />
      </Field>

      <div className="adm-grid">
        <Field label="Duración (minutos)">
          <input
            className="adm-input"
            type="number"
            min={1}
            value={data.duration_min}
            onChange={(e) => setData({ ...data, duration_min: parseInt(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Precio (en pesos)">
          <input
            className="adm-input"
            type="number"
            min={0}
            step={500}
            value={Math.round(data.price_cents / 100)}
            onChange={(e) => setData({ ...data, price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
          />
        </Field>
      </div>

      <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginTop: 24, marginBottom: 8 }}>
        Programa Cerca
      </h3>
      <div className="adm-grid">
        <Field label="Puntos que suma">
          <input
            className="adm-input"
            type="number"
            min={0}
            value={data.points_earned}
            onChange={(e) => setData({ ...data, points_earned: parseInt(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Puntos para canjear">
          <input
            className="adm-input"
            type="number"
            min={0}
            value={data.points_cost}
            onChange={(e) => setData({ ...data, points_cost: parseInt(e.target.value) || 0 })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className="adm-btn adm-btn--primary"
          onClick={save}
          disabled={pending || !data.name.trim()}
        >
          {pending ? "Creando…" : "Crear servicio"}
        </button>
        <button
          className="adm-btn adm-btn--ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancelar
        </button>
        {error && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}
