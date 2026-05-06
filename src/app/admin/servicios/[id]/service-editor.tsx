"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateService, deleteService } from "../../actions"
import type { ServiceRow } from "./page"

export default function ServiceEditor({ service }: { service: ServiceRow }) {
  const router = useRouter()
  const [data, setData] = useState({
    name: service.name,
    description: service.description ?? "",
    duration_min: service.duration_min,
    price_cents: service.price_cents,
    points_earned: service.points_earned,
    points_cost: service.points_cost,
    active: service.active,
    visible_public: service.visible_public,
  })
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const remove = () => {
    if (!confirm(`¿Eliminar el servicio "${service.name}"? Esta acción no se puede deshacer.`)) return
    startTransition(async () => {
      const r = await deleteService(service.id)
      if (r.ok) router.push("/admin/servicios")
      else {
        setError(r.error ?? "Error al eliminar")
        setStatus("error")
      }
    })
  }

  const save = () => {
    setError(null)
    setStatus("idle")
    startTransition(async () => {
      const r = await updateService(service.id, {
        ...data,
        description: data.description || null,
      })
      if (r.ok) setStatus("saved")
      else {
        setError(r.error ?? "Error")
        setStatus("error")
      }
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
      <Field label="Nombre">
        <input
          className="adm-input"
          style={{ width: "100%" }}
          value={data.name}
          onChange={(e) => setData({ ...data, name: e.target.value })}
        />
      </Field>

      <Field label="Descripción">
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
            onChange={(e) =>
              setData({ ...data, duration_min: parseInt(e.target.value) || 0 })
            }
          />
        </Field>
        <Field label="Precio (en pesos)">
          <input
            className="adm-input"
            type="number"
            min={0}
            step={500}
            value={Math.round(data.price_cents / 100)}
            onChange={(e) =>
              setData({
                ...data,
                price_cents: Math.round((parseFloat(e.target.value) || 0) * 100),
              })
            }
          />
        </Field>
      </div>

      <h3
        style={{
          fontFamily: "var(--serif)",
          fontWeight: 500,
          fontSize: 16,
          marginTop: 24,
          marginBottom: 8,
        }}
      >
        Programa Cerca
      </h3>
      <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
        Cuántos puntos suma este servicio al completarse, y cuántos hacen
        falta para canjearlo sin pagar.
      </p>
      <div className="adm-grid">
        <Field label="Puntos que suma">
          <input
            className="adm-input"
            type="number"
            min={0}
            value={data.points_earned}
            onChange={(e) =>
              setData({
                ...data,
                points_earned: parseInt(e.target.value) || 0,
              })
            }
          />
        </Field>
        <Field label="Puntos para canjear">
          <input
            className="adm-input"
            type="number"
            min={0}
            value={data.points_cost}
            onChange={(e) =>
              setData({
                ...data,
                points_cost: parseInt(e.target.value) || 0,
              })
            }
          />
        </Field>
      </div>

      <h3
        style={{
          fontFamily: "var(--serif)",
          fontWeight: 500,
          fontSize: 16,
          marginTop: 24,
          marginBottom: 12,
        }}
      >
        Visibilidad
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Toggle
          label="Activo (se puede reservar)"
          checked={data.active}
          onChange={(v) => setData({ ...data, active: v })}
        />
        <Toggle
          label="Visible para clientas en /reserva"
          checked={data.visible_public}
          onChange={(v) => setData({ ...data, visible_public: v })}
        />
      </div>

      <div
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          className="adm-btn adm-btn--primary"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
        {status === "saved" && (
          <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>
        )}
        {status === "error" && (
          <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <button
            className="adm-btn adm-btn--ghost"
            style={{ color: "#8c463c" }}
            onClick={remove}
            disabled={pending}
          >
            Eliminar servicio
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16 }}
      />
      <span>{label}</span>
    </label>
  )
}
