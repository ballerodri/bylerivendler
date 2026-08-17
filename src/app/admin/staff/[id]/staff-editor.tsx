"use client"

import { useState, useTransition } from "react"
import { updateStaffProfessional, updateStaffBlockedSlots, updateStaffNotifyBookings, updateStaffDateExceptions } from "../../actions"
import { guardarDocumentoStaff } from "../../padron-actions"
import PadronLookup from "@/app/admin/_components/padron-lookup"
import type { StaffRow, BlockedSlotRow, BusinessHourRow, DateExceptionRow, ServiceRow, CommissionRow } from "./page"
import CommissionsEditor from "./commissions-editor"
import CalendarColorPicker from "./calendar-color-picker"

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  professional: "Profesional",
  reception: "Recepción",
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

function initBlocked(blockedSlots: BlockedSlotRow[]): Record<number, Set<string>> {
  const m: Record<number, Set<string>> = {}
  for (let i = 0; i < 7; i++) m[i] = new Set()
  for (const r of blockedSlots) m[r.day_of_week]?.add(r.slot)
  return m
}

function initDateExc(rows: DateExceptionRow[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of rows) {
    let set = m.get(r.date)
    if (!set) { set = new Set(); m.set(r.date, set) }
    set.add(r.slot)
  }
  return m
}

export default function StaffEditor({
  staff,
  blockedSlots,
  businessHours,
  dateExceptions,
  today,
  canEditRole,
  services,
  commissions,
}: {
  staff: StaffRow
  blockedSlots: BlockedSlotRow[]
  businessHours: BusinessHourRow[]
  dateExceptions: DateExceptionRow[]
  today: string
  canEditRole: boolean
  services: ServiceRow[]
  commissions: CommissionRow[]
}) {
  const [isProfessional, setIsProfessional] = useState(staff.is_professional)
  const [notifyBookings, setNotifyBookings] = useState(staff.notify_bookings ?? true)
  const [notifyStatus, setNotifyStatus] = useState<"idle" | "saved" | "error">("idle")
  const [blocked, setBlocked] = useState<Record<number, Set<string>>>(() => initBlocked(blockedSlots))

  const [rolePending, startRoleTransition] = useTransition()
  const [roleStatus, setRoleStatus] = useState<"idle" | "saved" | "error">("idle")
  const [roleError, setRoleError] = useState<string | null>(null)

  const [availPending, startAvailTransition] = useTransition()
  const [availStatus, setAvailStatus] = useState<"idle" | "saved" | "error">("idle")
  const [availError, setAvailError] = useState<string | null>(null)

  // Excepciones por FECHA puntual (además del horario semanal).
  const [dateExc, setDateExc] = useState<Map<string, Set<string>>>(() => initDateExc(dateExceptions))
  const [pickedDate, setPickedDate] = useState<string>("")
  const [excPending, startExcTransition] = useTransition()
  const [excStatus, setExcStatus] = useState<"idle" | "saved" | "error">("idle")
  const [excError, setExcError] = useState<string | null>(null)

  const bhMap = new Map(businessHours.map((h) => [h.day_of_week, h]))

  // Día de la semana (0-6) de una fecha "YYYY-MM-DD": medianoche UTC de esa fecha
  // cae el mismo día de calendario (igual criterio que la pantalla de éxito).
  const dowOfDate = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay()
  // Las horas de la grilla de esa fecha (según el día de la semana). Vacío si el
  // salón no abre ese día (no hay nada que bloquear: ya está cerrado).
  const slotsForDate = (d: string): string[] => {
    const bh = bhMap.get(dowOfDate(d))
    return bh?.is_open ? bh.slots : []
  }
  const excFor = (d: string): Set<string> => dateExc.get(d) ?? new Set<string>()
  const cloneExc = (prev: Map<string, Set<string>>) => {
    const next = new Map<string, Set<string>>()
    for (const [k, v] of prev) next.set(k, new Set(v))
    return next
  }
  const toggleExcSlot = (d: string, slot: string) => {
    setDateExc((prev) => {
      const next = cloneExc(prev)
      const set = next.get(d) ?? new Set<string>()
      if (set.has(slot)) set.delete(slot)
      else set.add(slot)
      if (set.size) next.set(d, set)
      else next.delete(d)
      return next
    })
    setExcStatus("idle")
  }
  const setWholeDay = (d: string, on: boolean) => {
    setDateExc((prev) => {
      const next = cloneExc(prev)
      if (on) next.set(d, new Set(slotsForDate(d)))
      else next.delete(d)
      return next
    })
    setExcStatus("idle")
  }
  const removeExcDate = (d: string) => {
    setDateExc((prev) => {
      const next = cloneExc(prev)
      next.delete(d)
      return next
    })
    setExcStatus("idle")
  }

  const saveExceptions = () => {
    setExcError(null)
    setExcStatus("idle")
    startExcTransition(async () => {
      const rows: { date: string; slot: string }[] = []
      for (const [date, slots] of dateExc) {
        for (const slot of slots) rows.push({ date, slot })
      }
      const r = await updateStaffDateExceptions(staff.id, rows)
      if (r.ok) setExcStatus("saved")
      else { setExcError(r.error ?? "Error"); setExcStatus("error") }
    })
  }

  // Las fechas con al menos una hora bloqueada, ordenadas (para la lista).
  const excDates = [...dateExc.entries()]
    .filter(([, s]) => s.size > 0)
    .map(([d]) => d)
    .sort()
  const fmtExcDate = (d: string) => {
    const [, m, day] = d.split("-")
    return `${DAYS[dowOfDate(d)]} ${day}/${m}`
  }

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
      const rows: { day_of_week: number; slot: string }[] = []
      for (let i = 0; i < 7; i++) {
        for (const slot of blocked[i] ?? []) rows.push({ day_of_week: i, slot })
      }
      const r = await updateStaffBlockedSlots(staff.id, rows)
      if (r.ok) setAvailStatus("saved")
      else { setAvailError(r.error ?? "Error"); setAvailStatus("error") }
    })
  }

  const isBlocked = (day: number, slot: string) => blocked[day]?.has(slot) ?? false
  const toggleBlock = (day: number, slot: string) => {
    setBlocked((prev) => {
      const next: Record<number, Set<string>> = {}
      for (let i = 0; i < 7; i++) next[i] = new Set(prev[i])
      if (next[day].has(slot)) next[day].delete(slot)
      else next[day].add(slot)
      return next
    })
    setAvailStatus("idle")
  }

  // Only show days the business is open
  const openDays = Array.from({ length: 7 }, (_, i) => i).filter(
    (i) => bhMap.get(i)?.is_open
  )

  return (
    <>
      {canEditRole && (
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

        {/* Sólo tiene sentido para quien recibe los avisos: admins y
            recepción. Una profesional no está en esa lista. */}
        {staff.role !== "professional" && (
          <div style={{ marginBottom: 24 }}>
            <div className="adm-row__label" style={{ marginBottom: 8 }}>
              Avisos por email
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={notifyBookings}
                disabled={rolePending}
                onChange={(e) => {
                  const v = e.target.checked
                  setNotifyBookings(v)
                  setNotifyStatus("idle")
                  startRoleTransition(async () => {
                    const r = await updateStaffNotifyBookings(staff.id, v)
                    setNotifyStatus(r.ok ? "saved" : "error")
                    if (!r.ok) setNotifyBookings(!v)
                  })
                }}
                style={{ width: 16, height: 16 }}
              />
              <span>
                <strong>Recibir los avisos de reserva</strong>
                <br />
                <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>
                  El mail que llega cuando una clienta reserva por la web, con la seña a esperar.
                  Apagalo si no querés recibirlos.
                </span>
              </span>
            </label>
            {notifyStatus === "saved" && (
              <span style={{ fontSize: 12, color: "#4d6b3e", marginLeft: 26 }}>Guardado ✓</span>
            )}
            {notifyStatus === "error" && (
              <span style={{ fontSize: 12, color: "#8c463c", marginLeft: 26 }}>No se pudo guardar</span>
            )}
          </div>
        )}

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
      )}

      <div className="adm-card" style={{ padding: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
          Disponibilidad
        </h3>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
          Por defecto atiende en todos los horarios del negocio. Tildá las horas en las que
          <strong> NO</strong> puede atender: quedan tachadas y dejan de poder reservarse con esta persona.
        </p>

        {openDays.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>
            No hay días de apertura configurados. Definí los horarios del negocio primero.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {openDays.map((i) => {
              const bh = bhMap.get(i)!
              return (
                <div key={i}>
                  <div className="adm-row__label" style={{ marginBottom: 8 }}>{DAYS[i]}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {bh.slots.map((slot) => {
                      const off = isBlocked(i, slot)
                      return (
                        <label
                          key={slot}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                            fontSize: 13,
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--line-strong)",
                            background: off ? "#f0d8d4" : "var(--paper)",
                            color: off ? "#8c463c" : "var(--ink)",
                            textDecoration: off ? "line-through" : "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={off}
                            onChange={() => toggleBlock(i, slot)}
                            style={{ width: 14, height: 14 }}
                          />
                          {slot}
                        </label>
                      )
                    })}
                  </div>
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

      {/* Excepciones por FECHA puntual — pesan por encima del horario semanal. */}
      <div className="adm-card" style={{ padding: 24, marginTop: 24 }}>
        <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 4 }}>
          Fechas puntuales
        </h3>
        <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 20 }}>
          Días concretos en los que <strong>NO</strong> puede atender (vacaciones, un turno médico, un viaje).
          Pesan por encima del horario semanal: bloquean aunque ese día normalmente atienda.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <label style={{ fontSize: 13, color: "var(--ink-soft)" }}>Elegí una fecha:</label>
          <input
            type="date"
            min={today}
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line-strong)", fontSize: 13, background: "var(--paper)", color: "var(--ink)" }}
          />
        </div>

        {pickedDate && (() => {
          const slots = slotsForDate(pickedDate)
          if (slots.length === 0) {
            return (
              <p style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 16 }}>
                El salón no abre ese día — no hay horarios para bloquear.
              </p>
            )
          }
          const set = excFor(pickedDate)
          const allOn = slots.every((s) => set.has(s))
          return (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                <div className="adm-row__label">{fmtExcDate(pickedDate)} — tildá las horas que <strong>NO</strong> atiende</div>
                <button className="adm-btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setWholeDay(pickedDate, !allOn)}>
                  {allOn ? "Quitar todo el día" : "Todo el día"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {slots.map((slot) => {
                  const off = set.has(slot)
                  return (
                    <label
                      key={slot}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13,
                        padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line-strong)",
                        background: off ? "#f0d8d4" : "var(--paper)",
                        color: off ? "#8c463c" : "var(--ink)",
                        textDecoration: off ? "line-through" : "none",
                      }}
                    >
                      <input type="checkbox" checked={off} onChange={() => toggleExcSlot(pickedDate, slot)} style={{ width: 14, height: 14 }} />
                      {slot}
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {excDates.length > 0 && (
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginBottom: 16 }}>
            <div className="adm-row__label" style={{ marginBottom: 8 }}>Fechas cargadas</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {excDates.map((d) => {
                const set = excFor(d)
                const slots = slotsForDate(d)
                const whole = slots.length > 0 && slots.every((s) => set.has(s))
                return (
                  <div key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                    <button
                      onClick={() => setPickedDate(d)}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--ink)", textAlign: "left", textDecoration: pickedDate === d ? "underline" : "none" }}
                    >
                      {fmtExcDate(d)} · {whole ? "todo el día" : `${set.size} hora${set.size > 1 ? "s" : ""}`}
                    </button>
                    <button className="adm-btn" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => removeExcDate(d)}>Quitar</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ paddingTop: 20, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
          <button className="adm-btn adm-btn--primary" onClick={saveExceptions} disabled={excPending}>
            {excPending ? "Guardando…" : "Guardar fechas puntuales"}
          </button>
          {excStatus === "saved" && <span style={{ fontSize: 12, color: "#4d6b3e" }}>Guardado ✓</span>}
          {excStatus === "error" && <span style={{ fontSize: 12, color: "#8c463c" }}>{excError}</span>}
        </div>
      </div>

      {canEditRole && (
        <CommissionsEditor
          staffId={staff.id}
          services={services}
          commissions={commissions}
        />
      )}

      {canEditRole && staff.is_professional && (
        <CalendarColorPicker
          staffId={staff.id}
          initialColorId={staff.calendar_color_id}
        />
      )}

      {/* DNI/CUIT del profesional, para poder facturarle (se elige al emitir
          una factura manual). Sólo lo edita quien administra al personal. */}
      {canEditRole && (
        <div style={{ marginTop: 24 }}>
          <div className="adm-row__label" style={{ marginBottom: 8 }}>
            DNI o CUIT (para facturarle)
          </div>
          <PadronLookup
            docInicial={staff.dni}
            guardarFn={(doc) => guardarDocumentoStaff(staff.id, doc)}
            ayuda="Se usa al emitir una factura a este profesional."
          />
        </div>
      )}
    </>
  )
}
