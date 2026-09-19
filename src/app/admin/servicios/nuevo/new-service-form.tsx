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
    pricing_mode: "fixed" as "fixed" | "per_zone",
    zone_selection: "multiple" as "multiple" | "single",
    duration_min: 60,
    price_cents: 0,
  })
  const [zones, setZones] = useState<{ name: string; duration_min: number; price_cents: number | null }[]>([])

  const save = () => {
    setError(null)
    startTransition(async () => {
      const r = await createService(data.categoryId, {
        name: data.name,
        description: data.description,
        pricing_mode: data.pricing_mode,
        zone_selection: data.zone_selection,
        duration_min: data.duration_min,
        price_cents: data.price_cents,
        zones: data.pricing_mode === "per_zone" ? zones : [],
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

      <Field label="Modo de cobro">
        <select
          className="adm-input"
          style={{ width: "100%" }}
          value={data.pricing_mode === "fixed" ? "fixed" : data.zone_selection === "single" ? "product" : "zone"}
          onChange={(e) => {
            const v = e.target.value
            if (v === "fixed") setData({ ...data, pricing_mode: "fixed" })
            else if (v === "zone") setData({ ...data, pricing_mode: "per_zone", zone_selection: "multiple" })
            else setData({ ...data, pricing_mode: "per_zone", zone_selection: "single" })
          }}
        >
          <option value="fixed">Precio fijo (una duración y un precio)</option>
          <option value="zone">Por zona — se eligen varias y se suman</option>
          <option value="product">Por producto — se elige uno solo</option>
        </select>
      </Field>

      <div className="adm-grid">
        {data.pricing_mode === "fixed" && (
          <Field label="Duración (minutos)">
            <input
              className="adm-input"
              type="number"
              min={1}
              value={data.duration_min}
              onChange={(e) => setData({ ...data, duration_min: parseInt(e.target.value) || 0 })}
            />
          </Field>
        )}
        <Field label={data.pricing_mode === "fixed" ? "Precio (en pesos)" : data.zone_selection === "single" ? "Precio general por producto (en pesos)" : "Precio por zona (general, en pesos)"}>
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

      {data.pricing_mode === "per_zone" && (
        <ZonesEditor zones={zones} setZones={setZones} single={data.zone_selection === "single"} />
      )}

      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 8 }}>
        Después de crear el servicio, definí sus puntos en la sección <strong>Programa Cerca</strong> del menú.
      </p>

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

function ZonesEditor({
  zones,
  setZones,
  single,
}: {
  zones: { name: string; duration_min: number; price_cents: number | null }[]
  setZones: (z: { name: string; duration_min: number; price_cents: number | null }[]) => void
  single: boolean
}) {
  const noun = single ? "producto" : "zona"
  const nounPl = single ? "Productos" : "Zonas"
  const update = (i: number, patch: Partial<{ name: string; duration_min: number; price_cents: number | null }>) =>
    setZones(zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)))
  const remove = (i: number) => setZones(zones.filter((_, idx) => idx !== i))
  const add = () => setZones([...zones, { name: "", duration_min: 30, price_cents: null }])

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>{nounPl} (nombre + minutos + precio opcional)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {zones.map((z, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="adm-input"
              style={{ flex: 1 }}
              placeholder={single ? "Ej: Ácido hialurónico" : "Ej: Abdomen"}
              value={z.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="adm-input"
              type="number"
              min={1}
              style={{ width: 90 }}
              value={z.duration_min}
              onChange={(e) => update(i, { duration_min: parseInt(e.target.value) || 0 })}
            />
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>min</span>
            <input
              className="adm-input"
              type="number"
              min={0}
              step={500}
              style={{ width: 110 }}
              placeholder="= general"
              value={z.price_cents != null ? Math.round(z.price_cents / 100) : ""}
              onChange={(e) =>
                update(i, {
                  price_cents:
                    e.target.value.trim() === ""
                      ? null
                      : Math.round((parseFloat(e.target.value) || 0) * 100),
                })
              }
            />
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>$</span>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => remove(i)}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="adm-btn adm-btn--ghost" style={{ marginTop: 8 }} onClick={add}>
        + Agregar {noun}
      </button>
    </div>
  )
}
