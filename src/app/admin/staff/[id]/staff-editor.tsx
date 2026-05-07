"use client"

import { useState, useTransition } from "react"
import { updateStaffProfessional, updateStaffAvailability } from "../../actions"
import type { StaffRow, AvailabilityRow } from "./page"

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  professional: "Profesional",
  reception: "Recepción",
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

type DayState = { enabled: boolean; from: string; to: string }

function initDays(availability: AvailabilityRow[]): DayState[] {
  return Array.from({ length: 7 }, (_, i) => {
    const row = availability.find((r) => r.day_of_week === i)
    return row
      ? { enabled: true, from: row.from_time, to: row.to_time }
      : { enabled: false, from: "09:00", to: "18:00" }
  })
}

export default function StaffEditor({
  staff,
  availability,
}: {
  staff: StaffRow
  availability: AvailabilityRow[]
}) {
  const [isProfessional, setIsProfessional] = useState(staff.is_professional)
  const [days, setDays] = useState<DayState[]>(() => initDays(availability))

  const [rolePending, startRoleTransition] = useTransition()
  const [roleStatus, setRoleStatus] = useState<"idle" | "saved" | "error">("idle")
  const [roleError, setRoleError] = useState<string | null>(null)

  const [availPending, startAvailTransition] = useTransition()
  const [availStatus, setAvailStatus] = useState<"idle" | "saved" | "error">("idle")
  const [availError, setAvailError] = useState<string | null>(null)

  const saveRole = () => {
    setRoleError(null)
    setRoleStatus("idle")
    startRoleTransition(async () => {
      const r = await updateStaffProfessional(staff.id, isProfessional)
      if (r.ok) setRoleStatus("saved")
      else { setRoleError(r.error ?? "Error"); setRoleStatus("error") }
    })
  }

  const saveAvailability = () => {
    setAvailError(null)
    setAvailStatus("idle")
    startAvailTransition(async () => {
      const rows = days
        .map((d, i) => ({ day_of_week: i, from_time: d.from, to_time: d.to, enabled: d.enabled }))
        .filter((d) => d.enabled)
        .map(({ day_of_week, from_time, to_time }) => ({ day_of_week, from_time, to_time }))
      const r = await updateStaffAvailability(staff.id, rows)
      if (r.ok) setAvailStatus("saved")
      else { setAvailError(r.error ?? "Error"); setAvailStatus("error") }
    })
  }

  const setDay = (i: number, patch: Partial<DayState>) =>
    setDays((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))

  return (
    <>
      <div className="adm-card" style={{ padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 16 }}>
          Roles
        </h3>

        <div style={{ marginBottom: 20 }}>
          <div className="adm-row__label" style={{ marginBottom: 8 }}>
            Rol de acceso al panel
          </div>
          <span className={`adm-pill ${staff.role === "admin" ? "adm-pill--admin" : "adm-pill--inactive"}`}>
            {ROLE_LABEL[staff.role] ?? staff.role}
          </span>
          <p style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 6 }}>
            El rol de acceso se cambia contactando al administrador del sistema.
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div className="adm-row__label" style={{ marginBottom: 8 }}>
            Selector de turnos
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={isProfessional}
              onChange={(e) => { setIsProfessional(e.target.checked); setRoleStatus("idle") }}
              style={{ width: 16, height: 16 }}
            />
            <span>
              <strong>Aparece como opción al reservar un turno</strong>
              <br />
              <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>
                Las clientas pueden elegir a esta persona al reservar.
              </span>
            </span>
          </label>
        </div>

        <div style={{ paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
          <button className="adm-btn adm-btn--primary" onClick={saveRole} disabled={rolePending}>
            {rolePending ? "Guardando…" : "Guardar cambios"}
          </button>
          {roleStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
          {roleStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{roleError}</span>}
        </div>
      </div>

      <div className="adm-card" style={{ padding: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
          Disponibilidad
        </h3>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
          Marcá los días que trabaja y los horarios. Si no hay días marcados, se considera disponible siempre.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {days.map((day, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, width: 80, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => { setDay(i, { enabled: e.target.checked }); setAvailStatus("idle") }}
                  style={{ width: 15, height: 15 }}
                />
                <span style={{ fontWeight: day.enabled ? 600 : 400, color: day.enabled ? "var(--ink)" : "var(--ink-mute)" }}>
                  {DAYS[i]}
                </span>
              </label>
              {day.enabled && (
                <>
                  <input
                    type="time"
                    value={day.from}
                    onChange={(e) => { setDay(i, { from: e.target.value }); setAvailStatus("idle") }}
                    className="adm-select"
                    style={{ width: 110, fontSize: 13 }}
                  />
                  <span style={{ color: "var(--ink-mute)" }}>a</span>
                  <input
                    type="time"
                    value={day.to}
                    onChange={(e) => { setDay(i, { to: e.target.value }); setAvailStatus("idle") }}
                    className="adm-select"
                    style={{ width: 110, fontSize: 13 }}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ paddingTop: 20, borderTop: "1px solid var(--line)", marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <button className="adm-btn adm-btn--primary" onClick={saveAvailability} disabled={availPending}>
            {availPending ? "Guardando…" : "Guardar disponibilidad"}
          </button>
          {availStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
          {availStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{availError}</span>}
        </div>
      </div>
    </>
  )
}
