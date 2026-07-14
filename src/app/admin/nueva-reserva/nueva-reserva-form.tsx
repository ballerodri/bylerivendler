"use client"

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { searchClients, createAdminBooking, type ClientSearchResult } from "../actions"
import { fetchSequentialAvailability, type SlotResult } from "@/app/reserva/actions"
import { fmtPrice } from "@/app/reserva/data"
import type { ServiceOption } from "./page"

const TZ = "America/Argentina/Buenos_Aires"
const STEPS = ["Cliente", "Servicios", "Fecha y hora", "Confirmar"]

function todayAR(): string {
  return new Date().toLocaleDateString("sv", { timeZone: TZ })
}

function fmtSlot(slot: SlotResult): string {
  return slot.time
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  })
}

type SelectedClient =
  | { mode: "existing" } & ClientSearchResult
  | { mode: "new"; firstName: string; lastName: string; phone: string; email: string }

export default function NuevaReservaForm({ services }: { services: ServiceOption[] }) {
  const router = useRouter()
  const [step, setStep] = useState(0)

  // Step 0 — Client
  const [clientQuery, setClientQuery] = useState("")
  const [clientResults, setClientResults] = useState<ClientSearchResult[]>([])
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null)
  const [clientMode, setClientMode] = useState<"search" | "new">("search")
  const [newClient, setNewClient] = useState({ firstName: "", lastName: "", phone: "", email: "" })
  const [searchPending, startSearchTransition] = useTransition()

  // Step 1 — Services
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [zoneSel, setZoneSel] = useState<Record<string, string[]>>({})
  const toggleZone = (serviceId: string, zoneId: string, single: boolean) =>
    setZoneSel((prev) => {
      const cur = prev[serviceId] ?? []
      const next = single
        ? [zoneId] // producto: una sola opción, reemplaza la anterior
        : cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
      return { ...prev, [serviceId]: next }
    })
  const effective = (s: ServiceOption): { priceCents: number; duration: number; count: number } => {
    if (s.pricing_mode !== "per_zone") return { priceCents: s.price_cents, duration: s.duration_min, count: 1 }
    const ids = zoneSel[s.id] ?? []
    const chosen = s.zones.filter((z) => ids.includes(z.id))
    return { priceCents: chosen.reduce((a, z) => a + (z.priceCents ?? s.price_cents), 0), duration: chosen.reduce((a, z) => a + z.durationMin, 0), count: chosen.length }
  }

  // Step 2 — Date/time
  const [date, setDate] = useState(todayAR())
  const [slots, setSlots] = useState<SlotResult[]>([])
  const [selectedSlot, setSelectedSlot] = useState<SlotResult | null>(null)
  const [slotsPending, startSlotsTransition] = useTransition()

  // Step 3 — Confirm
  const [notes, setNotes] = useState("")
  const [submitPending, startSubmitTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Client search ────────────────────────────────────────────────────────────
  const handleClientQuery = (q: string) => {
    setClientQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!q.trim()) { setClientResults([]); return }
    searchTimeout.current = setTimeout(() => {
      startSearchTransition(async () => {
        const results = await searchClients(q)
        setClientResults(results)
      })
    }, 300)
  }

  // ── Load slots ───────────────────────────────────────────────────────────────
  const loadSlots = (d: string) => {
    setSelectedSlot(null)
    setSlots([])
    const svcs = services
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, duration: effective(s).duration, staffId: "auto" }))
    if (!svcs.length) return
    startSlotsTransition(async () => {
      const res = await fetchSequentialAvailability(svcs, d, 1, { enforceStaffServices: false })
      setSlots(res.slotsForDate)
    })
  }

  const handleDateChange = (d: string) => {
    setDate(d)
    loadSlots(d)
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 1) loadSlots(date)
    setStep((s) => s + 1)
  }
  const goBack = () => setStep((s) => s - 1)

  // ── Selected service data ────────────────────────────────────────────────────
  const selectedServices = services.filter((s) => selectedIds.has(s.id))

  // ── Validation ───────────────────────────────────────────────────────────────
  const clientValid = selectedClient !== null ||
    (clientMode === "new" && newClient.firstName.trim() && newClient.lastName.trim() && newClient.phone.trim())
  const servicesValid = selectedIds.size > 0 &&
    selectedServices.every((s) => s.pricing_mode !== "per_zone" || (zoneSel[s.id]?.length ?? 0) >= 1)
  const slotValid = selectedSlot !== null

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    setSubmitError(null)
    startSubmitTransition(async () => {
      const client: SelectedClient | null = selectedClient ?? (
        clientMode === "new" && newClient.firstName.trim()
          ? { mode: "new", ...newClient }
          : null
      )
      if (!client || !selectedSlot) return

      const orderedIds = selectedSlot.serviceOrder
      const resolvedStaff = selectedSlot.resolvedStaff

      // Build startsAt ISO from slot date + time (Argentina)
      const [y, m, d] = selectedSlot.date.split("-").map(Number)
      const [hh, mm] = selectedSlot.time.split(":").map(Number)
      // Convert Argentina time to UTC (AR is UTC-3)
      const startsAt = new Date(Date.UTC(y, m - 1, d, hh + 3, mm)).toISOString()

      const result = await createAdminBooking({
        clientId: client.mode === "existing" ? client.id : undefined,
        newClient: client.mode === "new"
          ? { firstName: client.firstName, lastName: client.lastName, phone: client.phone, email: client.email || undefined }
          : undefined,
        serviceIds: Array.from(selectedIds),
        serviceOrder: orderedIds,
        resolvedStaff,
        startsAt,
        notes: notes.trim() || undefined,
        zoneSelections: Object.fromEntries(
          selectedServices.filter((s) => s.pricing_mode === "per_zone").map((s) => [s.id, zoneSel[s.id] ?? []])
        ),
      })

      if (result.ok) {
        router.push("/admin/turnos")
      } else {
        setSubmitError(result.error ?? "Error al crear el turno.")
      }
    })
  }

  const totalMin = selectedServices.reduce((a, s) => a + effective(s).duration, 0)
  const totalCents = selectedServices.reduce((a, s) => a + effective(s).priceCents, 0)

  // ── Grouped services ─────────────────────────────────────────────────────────
  const byCategory = services.reduce<Record<string, ServiceOption[]>>((acc, s) => {
    ;(acc[s.category] ??= []).push(s)
    return acc
  }, {})

  const clientLabel = selectedClient
    ? selectedClient.mode === "existing"
      ? `${selectedClient.first_name} ${selectedClient.last_name}`
      : `${selectedClient.firstName} ${selectedClient.lastName}`
    : clientMode === "new" && newClient.firstName
      ? `${newClient.firstName} ${newClient.lastName}`
      : null

  return (
    <div>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 0, marginBottom: 28 }}>
        {STEPS.map((label, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
              background: i < step ? "var(--gold)" : i === step ? "var(--ink)" : "var(--linen)",
              color: i <= step ? "#fff" : "var(--ink-mute)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600,
            }}>
              {i < step ? "✓" : i + 1}
            </div>
            <span style={{
              marginLeft: 6, fontSize: 12,
              color: i === step ? "var(--ink)" : "var(--ink-mute)",
              fontWeight: i === step ? 600 : 400,
              display: i > 0 ? "none" : undefined,
            }}>
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1, background: "var(--line)", margin: "0 8px" }} />
            )}
          </div>
        ))}
      </div>

      <div className="adm-card" style={{ padding: 28 }}>

        {/* ── Step 0: Client ── */}
        {step === 0 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              ¿Para quién es el turno?
            </h3>

            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <button
                className={`adm-btn ${clientMode === "search" ? "adm-btn--primary" : ""}`}
                onClick={() => { setClientMode("search"); setSelectedClient(null) }}
                style={{ fontSize: 13 }}
              >
                Clienta existente
              </button>
              <button
                className={`adm-btn ${clientMode === "new" ? "adm-btn--primary" : ""}`}
                onClick={() => { setClientMode("new"); setSelectedClient(null); setClientResults([]) }}
                style={{ fontSize: 13 }}
              >
                Nueva clienta
              </button>
            </div>

            {clientMode === "search" && (
              <div>
                {selectedClient && selectedClient.mode === "existing" ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", background: "var(--linen)", borderRadius: 8,
                    fontSize: 13, marginBottom: 12,
                  }}>
                    <span style={{ flex: 1 }}>
                      <strong>{selectedClient.first_name} {selectedClient.last_name}</strong>
                      <span style={{ color: "var(--ink-mute)", marginLeft: 8 }}>{selectedClient.phone ?? selectedClient.email}</span>
                    </span>
                    <button
                      className="adm-btn"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => { setSelectedClient(null); setClientQuery("") }}
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="adm-select"
                      style={{ width: "100%", marginBottom: 8, fontSize: 14, padding: "8px 12px" }}
                      placeholder="Buscar por nombre, email o teléfono…"
                      value={clientQuery}
                      onChange={(e) => handleClientQuery(e.target.value)}
                      autoFocus
                    />
                    {searchPending && (
                      <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "0 0 8px" }}>Buscando…</p>
                    )}
                    {clientResults.length > 0 && (
                      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => { setSelectedClient({ mode: "existing", ...c }); setClientQuery("") ; setClientResults([]) }}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              padding: "10px 14px", background: "none", border: "none",
                              borderBottom: "1px solid var(--line)", cursor: "pointer",
                              fontSize: 13,
                            }}
                          >
                            <strong>{c.first_name} {c.last_name}</strong>
                            <span style={{ color: "var(--ink-mute)", marginLeft: 8 }}>{c.phone ?? c.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {clientQuery && !searchPending && clientResults.length === 0 && (
                      <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>Sin resultados para "{clientQuery}".</p>
                    )}
                  </>
                )}
              </div>
            )}

            {clientMode === "new" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <input
                    className="adm-select"
                    placeholder="Nombre *"
                    value={newClient.firstName}
                    onChange={(e) => setNewClient((p) => ({ ...p, firstName: e.target.value }))}
                    style={{ fontSize: 13, padding: "8px 12px" }}
                  />
                  <input
                    className="adm-select"
                    placeholder="Apellido *"
                    value={newClient.lastName}
                    onChange={(e) => setNewClient((p) => ({ ...p, lastName: e.target.value }))}
                    style={{ fontSize: 13, padding: "8px 12px" }}
                  />
                </div>
                <input
                  className="adm-select"
                  placeholder="Teléfono *"
                  value={newClient.phone}
                  onChange={(e) => setNewClient((p) => ({ ...p, phone: e.target.value }))}
                  style={{ fontSize: 13, padding: "8px 12px" }}
                />
                <input
                  className="adm-select"
                  placeholder="Email (opcional)"
                  value={newClient.email}
                  onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))}
                  style={{ fontSize: 13, padding: "8px 12px" }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: Services ── */}
        {step === 1 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              ¿Qué servicios?
            </h3>
            {Object.entries(byCategory).map(([cat, svcs]) => (
              <div key={cat} style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
                  {cat}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {svcs.map((s) => (
                    <div key={s.id}>
                      <label
                        style={{
                          display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                          padding: "10px 12px", borderRadius: 8, fontSize: 13,
                          background: selectedIds.has(s.id) ? "var(--linen)" : "transparent",
                          border: `1px solid ${selectedIds.has(s.id) ? "var(--gold)" : "var(--line)"}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(s.id)
                              else next.delete(s.id)
                              return next
                            })
                            setSelectedSlot(null)
                          }}
                          style={{ width: 15, height: 15 }}
                        />
                        <span style={{ flex: 1 }}><strong>{s.name}</strong></span>
                        <span style={{ color: "var(--ink-mute)" }}>{s.duration_min} min</span>
                        <span style={{ color: "var(--ink-soft)" }}>{fmtPrice(s.price_cents / 100)}</span>
                      </label>
                      {s.pricing_mode === "per_zone" && selectedIds.has(s.id) && (() => {
                        const single = s.zone_selection === "single"
                        return (
                          <div style={{ paddingLeft: 34, display: "flex", flexDirection: "column", gap: 6, marginTop: 4, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                              {single ? "Elegí un producto:" : "Elegí las zonas:"}
                            </span>
                            {s.zones.map((z) => (
                              <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                                <input
                                  type={single ? "radio" : "checkbox"}
                                  name={single ? `nz-zone-${s.id}` : undefined}
                                  checked={(zoneSel[s.id] ?? []).includes(z.id)}
                                  onChange={() => { toggleZone(s.id, z.id, single); setSelectedSlot(null) }}
                                  style={{ width: 15, height: 15 }}
                                />
                                <span>{z.name} · {z.durationMin} min · {fmtPrice((z.priceCents ?? s.price_cents) / 100)}</span>
                              </label>
                            ))}
                            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                              {(() => {
                                const e = effective(s)
                                if (!e.count) return single ? "Elegí un producto" : "Elegí al menos una zona"
                                return single
                                  ? `${e.duration} min · ${fmtPrice(e.priceCents / 100)}`
                                  : `${e.count} zona(s) · ${e.duration} min · ${fmtPrice(e.priceCents / 100)}`
                              })()}
                            </span>
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {selectedIds.size > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)", fontSize: 13, color: "var(--ink-mute)" }}>
                {selectedIds.size} servicio{selectedIds.size > 1 ? "s" : ""} · {totalMin} min · {fmtPrice(totalCents / 100)}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Date/time ── */}
        {step === 2 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              ¿Cuándo?
            </h3>
            <input
              type="date"
              className="adm-select"
              value={date}
              min={todayAR()}
              onChange={(e) => handleDateChange(e.target.value)}
              style={{ fontSize: 14, padding: "8px 12px", marginBottom: 20 }}
            />
            {slotsPending && (
              <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>Buscando horarios…</p>
            )}
            {!slotsPending && slots.length === 0 && date && (
              <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                Sin disponibilidad para el {fmtDate(date)}. Elegí otro día.
              </p>
            )}
            {!slotsPending && slots.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 12 }}>
                  {fmtDate(date)} · {slots.length} horario{slots.length > 1 ? "s" : ""} disponible{slots.length > 1 ? "s" : ""}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {slots.map((slot) => (
                    <button
                      key={slot.time}
                      onClick={() => setSelectedSlot(slot)}
                      className={`adm-btn ${selectedSlot?.time === slot.time ? "adm-btn--primary" : ""}`}
                      style={{ fontSize: 13, minWidth: 64 }}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === 3 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              Confirmar turno
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>Clienta</span>
                <span><strong>{clientLabel}</strong></span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>Fecha</span>
                <span>{selectedSlot ? `${fmtDate(selectedSlot.date)} · ${selectedSlot.time}` : "—"}</span>
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>Servicios</span>
                <span>
                  {selectedServices.map((s) => s.name).join(", ")}
                  <span style={{ color: "var(--ink-mute)", marginLeft: 6 }}>
                    ({totalMin} min · {fmtPrice(totalCents / 100)})
                  </span>
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>
                Notas internas (opcional)
              </label>
              <textarea
                className="adm-select"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Indicaciones especiales, contexto del turno…"
                rows={3}
                style={{ width: "100%", fontSize: 13, padding: "8px 12px", resize: "vertical" }}
              />
            </div>

            {submitError && (
              <p style={{ fontSize: 13, color: "#8c463c", marginBottom: 12 }}>{submitError}</p>
            )}
          </div>
        )}

        {/* ── Navigation ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
          <button
            className="adm-btn"
            onClick={step === 0 ? () => router.push("/admin/turnos") : goBack}
            disabled={submitPending}
            style={{ fontSize: 13 }}
          >
            {step === 0 ? "Cancelar" : "← Atrás"}
          </button>

          {step < 3 ? (
            <button
              className="adm-btn adm-btn--primary"
              onClick={goNext}
              disabled={
                (step === 0 && !clientValid) ||
                (step === 1 && !servicesValid) ||
                (step === 2 && !slotValid)
              }
              style={{ fontSize: 13 }}
            >
              Continuar →
            </button>
          ) : (
            <button
              className="adm-btn adm-btn--primary"
              onClick={handleSubmit}
              disabled={submitPending}
              style={{ fontSize: 13 }}
            >
              {submitPending ? "Creando turno…" : "Crear turno"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
