"use client"

import { useState, useTransition } from "react"
import { updateStaffProfessional } from "../../actions"
import type { StaffRow } from "./page"

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  professional: "Profesional",
  reception: "Recepción",
}

export default function StaffEditor({ staff }: { staff: StaffRow }) {
  const [isProfessional, setIsProfessional] = useState(staff.is_professional)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setError(null)
    setStatus("idle")
    startTransition(async () => {
      const r = await updateStaffProfessional(staff.id, isProfessional)
      if (r.ok) setStatus("saved")
      else { setError(r.error ?? "Error"); setStatus("error") }
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24 }}>
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
            onChange={(e) => { setIsProfessional(e.target.checked); setStatus("idle") }}
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
        <button className="adm-btn adm-btn--primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
        {status === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
        {status === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{error}</span>}
      </div>
    </div>
  )
}
