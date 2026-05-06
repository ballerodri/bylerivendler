"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updateService, deleteService, updateServiceStaff, updateServiceOrderRules } from "../../actions"
import type { OtherService, ProfessionalRow, ServiceRow } from "./page"

export default function ServiceEditor({
  service,
  professionals,
  otherServices,
}: {
  service: ServiceRow
  professionals: ProfessionalRow[]
  otherServices: OtherService[]
}) {
  const router = useRouter()
  const [assignedIds, setAssignedIds] = useState<Set<string>>(
    new Set(professionals.filter((p) => p.assigned).map((p) => p.id))
  )
  const [staffStatus, setStaffStatus] = useState<"idle" | "saved" | "error">("idle")
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffPending, startStaffTransition] = useTransition() // eslint-disable-line @typescript-eslint/no-unused-vars

  const toggleStaff = (staffId: string) => {
    setAssignedIds((prev) => {
      const next = new Set(prev)
      if (next.has(staffId)) next.delete(staffId)
      else next.add(staffId)
      return next
    })
    setStaffStatus("idle")
  }

  const saveStaff = () => {
    setStaffError(null)
    setStaffStatus("idle")
    startStaffTransition(async () => {
      const r = await updateServiceStaff(service.id, Array.from(assignedIds))
      if (r.ok) setStaffStatus("saved")
      else { setStaffError(r.error ?? "Error"); setStaffStatus("error") }
    })
  }

  // Order rules: IDs of services that THIS service must go before
  const [mustBeforeIds, setMustBeforeIds] = useState<Set<string>>(
    new Set(otherServices.filter((s) => s.mustBefore).map((s) => s.id))
  )
  const [orderStatus, setOrderStatus] = useState<"idle" | "saved" | "error">("idle")
  const [orderError, setOrderError] = useState<string | null>(null)
  const [orderPending, startOrderTransition] = useTransition()

  const toggleOrder = (otherId: string) => {
    setMustBeforeIds((prev) => {
      const next = new Set(prev)
      if (next.has(otherId)) next.delete(otherId)
      else next.add(otherId)
      return next
    })
    setOrderStatus("idle")
  }

  const saveOrder = () => {
    setOrderError(null)
    setOrderStatus("idle")
    startOrderTransition(async () => {
      const r = await updateServiceOrderRules(service.id, Array.from(mustBeforeIds))
      if (r.ok) setOrderStatus("saved")
      else { setOrderError(r.error ?? "Error"); setOrderStatus("error") }
    })
  }

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

      {professionals.length > 0 && (
        <>
          <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginTop: 24, marginBottom: 8 }}>
            Profesionales habilitadas
          </h3>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
            Quiénes pueden realizar este tratamiento. Si ninguna está seleccionada, cualquiera puede tomarlo.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {professionals.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={assignedIds.has(p.id)}
                  onChange={() => toggleStaff(p.id)}
                  style={{ width: 16, height: 16 }}
                />
                {p.full_name}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button className="adm-btn adm-btn--ghost" onClick={saveStaff} disabled={staffPending}>
              {staffPending ? "Guardando…" : "Guardar profesionales"}
            </button>
            {staffStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
            {staffStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{staffError}</span>}
          </div>
        </>
      )}

      {/* ── Orden al combinar con otros servicios ── */}
      {otherServices.length > 0 && (
        <>
          <p className="adm-eyebrow" style={{ marginBottom: 8 }}>Orden al combinar</p>
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
            Marcá los tratamientos con los que <strong>{service.name}</strong> debe hacerse <strong>primero</strong>.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {otherServices.map((s) => (
              <label
                key={s.id}
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={mustBeforeIds.has(s.id)}
                  onChange={() => toggleOrder(s.id)}
                  style={{ width: 16, height: 16 }}
                />
                <span>Antes de <strong>{s.name}</strong></span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button className="adm-btn adm-btn--ghost" onClick={saveOrder} disabled={orderPending}>
              {orderPending ? "Guardando…" : "Guardar orden"}
            </button>
            {orderStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
            {orderStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{orderError}</span>}
          </div>
        </>
      )}

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
