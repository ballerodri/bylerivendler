"use client"

import { useState, useTransition } from "react"
import { updateStaffProfessional, updateStaffAvailability } from "../../actions"
import type { StaffRow, AvailabilityRow, BusinessHourRow } from "./page"

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  professional: "Profesional",
  reception: "Recepción",
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

type DayState = { enabled: boolean; from: string; to: string }

function initDays(availability: AvailabilityRow[], businessHours: BusinessHourRow[]): DayState[] {
  return Array.from({ length: 7 }, (_, i) => {
    const bh = businessHours.find((h) => h.day_of_week === i)
    const openMin = bh?.is_open && bh.slots.length ? bh.slots[0] : "09:00"
    const openMax = bh?.is_open && bh.slots.length ? bh.slots[bh.slots.length - 1] : "18:00"
    const row = availability.find((r) => r.day_of_week === i)
    return row
      ? { enabled: true, from: row.from_time, to: row.to_time }
      : { enabled: false, from: openMin, to: openMax }
  })
}

export default function StaffEditor({
  staff,
  availability,
  businessHours,
}: {
  staff: StaffRow
  availability: AvailabilityRow[]
  businessHours: BusinessHourRow[]
}) {
  const [isProfessional, setIsProfessional] = useState(staff.is_professional)
  const [days, setDays] = useState<DayState[]>(() => initDays(availability, businessHours))

  const [rolePending, startRoleTransition] = useTransition()
  const [roleStatus, setRoleStatus] = useState<"idle" | "saved" | "error">("idle")
  const [roleError, setRoleError] = useState<string | null>(null)

  const [availPending, startAvailTransition] = useTransition()
  const [availStatus, setAvailStatus] = useState<"idle" | "saved" | "error">("idle")
  const [availError, setAvailError] = useState<string | null>(null)

  const bhMap = new Map(businessHours.map((h) => [h.day_of_week, h]))

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

  // Only show days the business is open
  const openDays = Array.from({ length: 7 }, (_, i) => i).filter(
    (i) => bhMap.get(i)?.is_open
  )

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
                Si no está marcado, no podrá ser seleccionada al reservar aunque tenga horarios cargados.
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
          Marcá los días que trabaja y en qué horario. Los horarios disponibles son los del negocio.
          Si no marcás ningún día, se considera disponible en todos los horarios de apertura.
        </p>

        {openDays.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>
            No hay días de apertura configurados. Definí los horarios del negocio primero.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {openDays.map((i) => {
              const bh = bhMap.get(i)!
              const minTime = bh.slots[0] ?? "09:00"
              const maxTime = bh.slots[bh.slots.length - 1] ?? "18:00"
              const day = days[i]
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, width: 64, cursor: "pointer", flexShrink: 0 }}>
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

                  {day.enabled ? (
                    <>
                      <input
                        type="time"
                        value={day.from}
                        min={minTime}
                        max={day.to}
                        onChange={(e) => { setDay(i, { from: e.target.value }); setAvailStatus("idle") }}
                        className="adm-select"
                        style={{ width: 110, fontSize: 13 }}
                      />
                      <span style={{ color: "var(--ink-mute)" }}>a</span>
                      <input
                        type="time"
                        value={day.to}
                        min={day.from}
                        max={maxTime}
                        onChange={(e) => { setDay(i, { to: e.target.value }); setAvailStatus("idle") }}
                        className="adm-select"
                        style={{ width: 110, fontSize: 13 }}
                      />
                      <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                        (negocio: {minTime}–{maxTime})
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                      {minTime}–{maxTime}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div style={{ paddingTop: 20, borderTop: "1px solid var(--line)", marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <button className="adm-btn adm-btn--primary" onClick={saveAvailability} disabled={availPending || openDays.length === 0}>
            {availPending ? "Guardando…" : "Guardar disponibilidad"}
          </button>
          {availStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
          {availStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{availError}</span>}
        </div>
      </div>
    </>
  )
}
