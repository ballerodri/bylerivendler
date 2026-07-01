"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createPack, updatePack } from "./actions"
import { fmtPrice } from "../../reserva/data"
import { packReferenceCents } from "@/lib/servicios/pack-pricing"

export type ServiceOption = {
  id: string
  name: string
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
}

type Props = {
  services: ServiceOption[]
  initial?: {
    id: string
    serviceId: string
    name: string
    description: string
    sessions: number
    intervalDays: number | null
    totalPriceCents: number
    zonesCount: number | null
    visibleReserva: boolean
  }
}

export default function PackForm({ services, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [serviceId, setServiceId] = useState(initial?.serviceId ?? services[0]?.id ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [sessions, setSessions] = useState(initial ? String(initial.sessions) : "")
  const [intervalDays, setIntervalDays] = useState(
    initial?.intervalDays != null ? String(initial.intervalDays) : ""
  )
  const [priceInput, setPriceInput] = useState(
    initial ? String(Math.round(initial.totalPriceCents / 100)) : ""
  )
  const [zonesCount, setZonesCount] = useState(
    initial?.zonesCount != null ? String(initial.zonesCount) : ""
  )
  const [visibleReserva, setVisibleReserva] = useState(initial?.visibleReserva ?? false)

  const sessionsNum = parseInt(sessions, 10) || 0
  const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
  const service = services.find((s) => s.id === serviceId)
  const isPerZone = service?.pricing_mode === "per_zone"
  const zonesCountNum = zonesCount.trim() ? parseInt(zonesCount, 10) || 0 : 0
  const fullPriceCents = service
    ? packReferenceCents(service.price_cents, sessionsNum, isPerZone ? zonesCountNum : null)
    : 0
  const saving = fullPriceCents - totalPriceCents

  const handleSubmit = () => {
    if (!serviceId) { setError("Elegí un servicio."); return }
    if (!name.trim()) { setError("El nombre es obligatorio."); return }
    if (sessionsNum < 1) { setError("La cantidad de sesiones debe ser al menos 1."); return }
    if (totalPriceCents <= 0) { setError("Ingresá el precio del pack."); return }
    if (isPerZone && zonesCountNum < 1) { setError("Indicá cuántas zonas cubre cada sesión."); return }

    const intervalNum = intervalDays.trim() ? parseInt(intervalDays, 10) : null
    if (intervalNum != null && (isNaN(intervalNum) || intervalNum <= 0)) {
      setError("El intervalo debe ser un número de días mayor a 0 (o dejalo vacío)."); return
    }

    setError(null)
    startTransition(async () => {
      const input = {
        serviceId,
        name,
        description,
        sessions: sessionsNum,
        intervalDays: intervalNum,
        totalPriceCents,
        zonesCount: isPerZone ? zonesCountNum : null,
        visibleReserva,
      }
      const r = initial ? await updatePack(initial.id, input) : await createPack(input)
      if (r.ok) router.push("/admin/packs")
      else setError(r.error ?? "Error al guardar.")
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label className="adm-label">Servicio *</label>
        <select className="adm-input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {fmtPrice(s.price_cents / 100)} c/u</option>
          ))}
        </select>
      </div>

      <div>
        <label className="adm-label">Nombre *</label>
        <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Pack 6 sesiones piernas" />
      </div>

      <div>
        <label className="adm-label">Descripción (opcional)</label>
        <input className="adm-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve descripción para la clienta" />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label className="adm-label">Cantidad de sesiones *</label>
          <input className="adm-input" type="number" min="1" value={sessions} onChange={(e) => setSessions(e.target.value)} style={{ width: 140 }} placeholder="6" />
        </div>
        <div>
          <label className="adm-label">Cada cuántos días (opcional)</label>
          <input className="adm-input" type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} style={{ width: 180 }} placeholder="14" />
        </div>
      </div>

      {isPerZone && (
        <div>
          <label className="adm-label">Zonas por sesión *</label>
          <input
            className="adm-input"
            type="number"
            min="1"
            value={zonesCount}
            onChange={(e) => setZonesCount(e.target.value)}
            style={{ width: 140 }}
            placeholder="2"
          />
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>
            Cuántas zonas cubre cada una de las {sessionsNum || "N"} sesiones (servicio por zona).
          </p>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={visibleReserva}
          onChange={(e) => setVisibleReserva(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
        <span>Visible en la reserva online (la clienta puede elegir este pack)</span>
      </label>

      <div>
        <label className="adm-label">Precio del pack *</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 12, fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)" }}>$</span>
            <input className="adm-input" type="number" min="0" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={{ paddingLeft: 28, width: 160 }} placeholder="0" />
          </div>
          {fullPriceCents > 0 && totalPriceCents > 0 && (
            <span style={{ fontSize: 13, color: saving > 0 ? "#4d6b3e" : saving < 0 ? "#8c463c" : "var(--ink-mute)" }}>
              {saving > 0 ? `${fmtPrice(saving / 100)} de ahorro` : saving < 0 ? `${fmtPrice(Math.abs(saving) / 100)} más caro que por separado` : "igual al precio individual"}
            </span>
          )}
        </div>
        {fullPriceCents > 0 && (
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>
            {sessionsNum} sesiones por separado: {fmtPrice(fullPriceCents / 100)}
          </p>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleSubmit} disabled={pending} className="adm-btn adm-btn--primary" style={{ padding: "10px 24px", justifyContent: "center" }}>
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Crear pack"}
        </button>
        <button onClick={() => router.push("/admin/packs")} disabled={pending} className="adm-btn" style={{ padding: "10px 24px" }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
