"use client"

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import { searchClients, createAdminBooking, type ClientSearchResult } from "../actions"
import { createBooking, fetchSequentialAvailability, type SlotResult } from "@/app/reserva/actions"
import PackSessionPicker from "@/app/reserva/_components/pack-session-picker"
import { fmtPrice, slotToUtcMs, type BusinessHour } from "@/app/reserva/data"
import { minStartForNextSession } from "@/lib/servicios/pack-sessions"
import { overlappingBlock, type BlockedInterval } from "@/lib/servicios/slot-overlap"
import type { ServiceOption, PackOption } from "./page"

const TZ = "America/Argentina/Buenos_Aires"
const STEPS = ["Cliente", "Qué reserva", "Fecha y hora", "Confirmar"]

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

/** Un instante (ms UTC) como "lunes 20 de julio · 14:00", hora de Argentina. */
function fmtMoment(ms: number): string {
  return new Date(ms).toLocaleString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
  })
}

/**
 * ¿Esta clienta se queda sin el mail de confirmación? Sin email, o con el
 * placeholder que el salón le pone a quien no dejó uno real: los dos casos son
 * "sin email" para `sendGroupConfirmationEmail`.
 */
function sinEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase()
  return !e || e.endsWith("@noemail.local")
}

type SelectedClient =
  | { mode: "existing" } & ClientSearchResult
  | { mode: "new"; firstName: string; lastName: string; phone: string; email: string }

/**
 * El email que viaja en el payload de `createBooking`. Sin uno real va el
 * mismo placeholder que usa el resto del admin (`admin_created_…@noemail.local`):
 * el motor exige un email válido, y ese dominio es el que el mail de
 * confirmación reconoce como "sin email" y no le escribe a nadie.
 */
function emailForBooking(c: SelectedClient): string {
  const raw = (c.email ?? "").trim().toLowerCase()
  return raw || `admin_created_${Date.now()}@noemail.local`
}

export default function NuevaReservaForm({
  services,
  packs,
  businessHours,
}: {
  services: ServiceOption[]
  packs: PackOption[]
  businessHours: BusinessHour[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(0)

  // Step 0 — Client
  const [clientQuery, setClientQuery] = useState("")
  const [clientResults, setClientResults] = useState<ClientSearchResult[]>([])
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null)
  const [clientMode, setClientMode] = useState<"search" | "new">("search")
  const [newClient, setNewClient] = useState({ firstName: "", lastName: "", phone: "", email: "" })
  const [searchPending, startSearchTransition] = useTransition()

  // Step 1 — Qué reserva (pack + tratamientos)
  const [packId, setPackId] = useState<string | null>(null)
  const [packZoneIds, setPackZoneIds] = useState<string[]>([])
  // Fechas de las sesiones del pack (ISO), en orden. Se pueden dejar sesiones
  // sin agendar (se agendan después desde la ficha de la clienta), pero la
  // primera es obligatoria: `validatePackSlots` la exige. Se declara acá, con
  // el resto del pack, aunque se elija recién en el paso "Fecha y hora".
  const [packSlots, setPackSlots] = useState<string[]>([])
  const [pickingIdx, setPickingIdx] = useState<number | null>(null)
  // Registrar una compra que YA OCURRIÓ (un pack vendido en persona que nunca
  // se cargó). Apagado por defecto: prendido, el calendario ofrece días
  // pasados, y no queremos que se elija uno sin querer en una reserva normal.
  const [yaOcurrio, setYaOcurrio] = useState(false)
  const selectedPack = packs.find((p) => p.id === packId) ?? null
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

  // ── Selected service data ────────────────────────────────────────────────────
  const selectedServices = services.filter((s) => selectedIds.has(s.id))
  const hasServices = selectedIds.size > 0

  // Zonas del pack: si el servicio del pack es "por producto"
  // (`zone_selection: single`) se elige UNA y reemplaza; si no, se tildan
  // hasta `zonesCount` (la misma regla que la reserva online).
  const togglePackZone = (zoneId: string) => {
    if (!selectedPack) return
    setPackSlots([])
    setSelectedSlot(null)
    setPackZoneIds((prev) => {
      if (selectedPack.zoneSelection === "single") return [zoneId]
      if (prev.includes(zoneId)) return prev.filter((z) => z !== zoneId)
      if (prev.length >= selectedPack.zonesCount) return prev
      return [...prev, zoneId]
    })
  }

  const choosePack = (p: PackOption | null) => {
    setPackId(p?.id ?? null)
    setPackZoneIds([])
    setPackSlots([])
    setSelectedSlot(null)
  }

  // Cuánto dura una sesión del pack: la suma de las zonas elegidas, o la
  // duración del servicio. Es la misma cuenta que hace `planPack`.
  const packDurationMin = selectedPack
    ? selectedPack.pricingMode === "per_zone"
      ? selectedPack.zones.filter((z) => packZoneIds.includes(z.id)).reduce((a, z) => a + z.durationMin, 0)
      : selectedPack.serviceDurationMin
    : 0

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

  // ── Sesiones del pack ────────────────────────────────────────────────────────
  const setPackSlot = (idx: number, iso: string) => {
    // Al cambiar una sesión se re-eligen las siguientes (su mínimo cambió).
    setPackSlots((prev) => [...prev.slice(0, idx), iso])
    setSelectedSlot(null)   // el horario de los tratamientos puede haber quedado pisado
    setPickingIdx(null)
  }
  const clearPackFrom = (idx: number) => {
    setPackSlots((prev) => prev.slice(0, idx))
    setSelectedSlot(null)
  }

  /**
   * Desde cuándo se puede elegir la sesión `idx`: nunca antes de que termine la
   * anterior, y nunca antes del intervalo del pack. `validatePackSlots` (en el
   * servidor) exige las dos cosas SIN excepción — a diferencia de agendar una
   * sesión suelta desde la ficha, acá no hay "saltear el intervalo": ofrecerlo
   * sería ofrecer un horario que el servidor rechaza al confirmar.
   */
  const minForPackSession = (idx: number): Date | null => {
    if (idx === 0 || !selectedPack) return null
    const prev = packSlots[idx - 1]
    if (!prev) return null
    const prevStart = new Date(prev)
    const noOverlapMin = new Date(prevStart.getTime() + packDurationMin * 60_000)
    const intervalMin = minStartForNextSession(prevStart, selectedPack.intervalDays)
    return intervalMin.getTime() > noOverlapMin.getTime() ? intervalMin : noOverlapMin
  }

  // Los tramos que ya ocupan las sesiones del pack: los horarios de los
  // tratamientos que se pisen con ellos no se ofrecen (misma regla estricta
  // que `crossOverlapCheck`, que si no rechazaría la reserva al confirmar).
  const packBlocks: BlockedInterval[] = selectedPack
    ? packSlots.map((iso, i) => {
        const startMs = new Date(iso).getTime()
        return {
          startMs,
          endMs: startMs + packDurationMin * 60_000,
          name: `Sesión ${i + 1} · ${selectedPack.name}`,
        }
      })
    : []

  /**
   * La VENTANA REAL de la visita de tratamientos de un horario: del arranque
   * hasta que termina la última pata según `slot.starts` (lo que resolvió el
   * buscador, ya colocado en la grilla). Con huecos, la ventana es más larga
   * que la suma de las duraciones — es la misma cuenta que hace el servidor.
   */
  const visitWindow = (slot: SlotResult): { startMs: number; endMs: number } => {
    const startMs = slotToUtcMs(slot.date, slot.time)
    const endMs = selectedServices.reduce(
      (acc, s) => Math.max(acc, slotToUtcMs(slot.date, slot.starts[s.id] ?? slot.time) + effective(s).duration * 60_000),
      startMs
    )
    return { startMs, endMs }
  }

  // El tramo que ya ocupan los tratamientos elegidos (si ya se eligió horario):
  // ninguna sesión del pack puede caer ahí.
  const treatmentBlocks: BlockedInterval[] = selectedSlot
    ? [{ ...visitWindow(selectedSlot), name: "los tratamientos de esta compra" }]
    : []

  // ── Load slots ───────────────────────────────────────────────────────────────
  const loadSlots = (d: string) => {
    setSelectedSlot(null)
    setSlots([])
    const svcs = services
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, duration: effective(s).duration, staffId: "auto" }))
    if (!svcs.length) return
    startSlotsTransition(async () => {
      // Con un pack en la compra, el turno lo escribe `createBooking`, que
      // aplica `staff_services` a rajatabla: el buscador tiene que ser igual de
      // estricto o terminaría ofreciendo horarios que el servidor rechaza. Sin
      // pack, el camino es el de siempre (`createAdminBooking`, sin esa regla).
      const res = await fetchSequentialAvailability(svcs, d, 1, { enforceStaffServices: !!selectedPack })
      setSlots(res.slotsForDate)
    })
  }

  const handleDateChange = (d: string) => {
    setDate(d)
    loadSlots(d)
  }

  // ── Navigation ───────────────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 1) { setPickingIdx(null); loadSlots(date) }
    setStep((s) => s + 1)
  }
  const goBack = () => { setPickingIdx(null); setStep((s) => s - 1) }

  // ── Validation ───────────────────────────────────────────────────────────────
  const clientValid = selectedClient !== null ||
    (clientMode === "new" && newClient.firstName.trim() && newClient.lastName.trim() && newClient.phone.trim())
  // `planPack` exige EXACTAMENTE `zones_count` zonas. Un pack por zona con
  // `zones_count` en 0 está mal cargado y no se puede vender por ningún
  // camino: se frena acá en vez de fallar recién al confirmar.
  const packZonesOk = !selectedPack ||
    selectedPack.pricingMode !== "per_zone" ||
    (selectedPack.zonesCount > 0 && packZoneIds.length === selectedPack.zonesCount)
  // Con un pack en la compra escribe `createBooking`, que es fail-closed: un
  // tratamiento sin ninguna profesional en `staff_services` haría fallar la
  // compra ENTERA al confirmar. Se frena acá, con el motivo a la vista.
  const treatmentsBookableOk = !selectedPack || selectedServices.every((s) => s.bookable)
  const servicesValid = (hasServices || selectedPack !== null) &&
    selectedServices.every((s) => s.pricing_mode !== "per_zone" || (zoneSel[s.id]?.length ?? 0) >= 1) &&
    packZonesOk && treatmentsBookableOk
  // La 1ª sesión del pack es obligatoria; el horario de los tratamientos, sólo
  // si hay tratamientos.
  const slotValid = (!selectedPack || packSlots.length > 0) && (!hasServices || selectedSlot !== null)

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
    setSubmitError(null)
    startSubmitTransition(async () => {
      const client: SelectedClient | null = selectedClient ?? (
        clientMode === "new" && newClient.firstName.trim()
          ? { mode: "new", ...newClient }
          : null
      )
      if (!client) return
      if (hasServices && !selectedSlot) return

      // Build startsAt ISO from slot date + time (Argentina)
      const startsAt = selectedSlot
        ? new Date(slotToUtcMs(selectedSlot.date, selectedSlot.time)).toISOString()
        : null

      // ── Con pack: el MISMO motor que la reserva online ──────────────────────
      // `createBooking` en modo admin registra la compra del pack y los turnos
      // todo-o-nada, agrupados en una sola compra, y le manda a la clienta el
      // mail de confirmación de siempre.
      if (selectedPack) {
        const packFirst = packSlots[0]
        if (!packFirst) return
        const result = await createBooking({
          adminMode: true,
          savedClientId: client.mode === "existing" ? client.id : undefined,
          client: {
            firstName: client.mode === "existing" ? client.first_name : client.firstName,
            lastName: client.mode === "existing" ? client.last_name : client.lastName,
            // Sin email real va el mismo placeholder que usa el resto del admin:
            // `sendGroupConfirmationEmail` lo trata como "sin email" y no manda
            // nada (el paso "Confirmar" ya avisó). Para una clienta existente
            // estos datos ni se usan (manda `savedClientId`), pero el motor los
            // pide igual, así que se mandan los suyos y no los de nadie más.
            email: emailForBooking(client),
            // El motor pide un teléfono; una ficha vieja puede no tenerlo. Con
            // `savedClientId` no se guarda en ningún lado (la ficha ya existe).
            phone: client.phone?.trim() || "-",
            isExisting: client.mode === "existing",
          },
          packId: selectedPack.id,
          packZoneIds: selectedPack.pricingMode === "per_zone" ? packZoneIds : undefined,
          packSlots,
          // La profesional la resuelve el motor sesión por sesión (el asistente
          // no la pide). Desde el admin el pack NUNCA se encadena con los
          // tratamientos: cada parte va en su propia fecha. OJO: lo que
          // garantiza eso NO es el flag `packChainedFirst` (el motor ni lo
          // lee), sino que el `startsAt` que mandamos es un slot de la grilla
          // —el que eligió el buscador—; el flag va en `false` por prolijidad.
          packStaff: "auto",
          packChainedFirst: false,
          // Sin tratamientos va `[]`: el schema lo acepta porque hay pack.
          serviceIds: hasServices ? Array.from(selectedIds) : [],
          serviceOrder: hasServices ? selectedSlot!.serviceOrder : undefined,
          resolvedStaff: hasServices ? selectedSlot!.resolvedStaff : undefined,
          zoneSelections: Object.fromEntries(
            selectedServices.filter((s) => s.pricing_mode === "per_zone").map((s) => [s.id, zoneSel[s.id] ?? []])
          ),
          // Sin tratamientos no hay cadena que arrancar: el motor no lo usa,
          // pero el schema lo exige, así que va la 1ª sesión del pack.
          startsAt: startsAt ?? packFirst,
          proHint: "auto",
          // El salón cobra en persona: el turno nace saldado, no señado.
          payChoice: "full",
        })
        if (result.ok) router.push("/admin/turnos")
        else setSubmitError(result.error)
        return
      }

      // ── Sólo tratamientos: el camino de siempre, sin tocar ──────────────────
      if (!selectedSlot || !startsAt) return
      const orderedIds = selectedSlot.serviceOrder
      const resolvedStaff = selectedSlot.resolvedStaff

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
  // El pack se cobra UNA vez (su precio total), sin importar cuántas sesiones
  // se agenden ahora: las que queden sin agendar ya están pagas.
  const grandTotalCents = totalCents + (selectedPack?.priceCents ?? 0)

  // ── El itinerario: sesiones del pack + tratamientos, en orden cronológico ────
  // El horario de cada tratamiento sale de `slot.starts` (lo que resolvió el
  // buscador, ya colocado en la grilla), no de encadenarlos por minutos: es lo
  // MISMO que va a escribir el servidor.
  const itinerary: { startMs: number; label: string; durationMin: number; priceCents: number | null }[] = [
    ...(selectedPack
      ? packSlots.map((iso, i) => ({
          startMs: new Date(iso).getTime(),
          label: `Sesión ${i + 1} de ${selectedPack.sessions} · ${selectedPack.name}`,
          durationMin: packDurationMin,
          priceCents: i === 0 ? selectedPack.priceCents : 0,
        }))
      : []),
    ...(selectedSlot
      ? selectedSlot.serviceOrder
          .map((id) => selectedServices.find((s) => s.id === id))
          .filter((s): s is ServiceOption => Boolean(s))
          .map((s) => ({
            startMs: slotToUtcMs(selectedSlot.date, selectedSlot.starts[s.id] ?? selectedSlot.time),
            label: s.name,
            durationMin: effective(s).duration,
            priceCents: effective(s).priceCents,
          }))
      : []),
  ].sort((a, b) => a.startMs - b.startMs)

  // Cuántas sesiones del pack quedan para agendar después, desde la ficha.
  const packPendingSessions = selectedPack ? selectedPack.sessions - packSlots.length : 0

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

  // El email al que iría la confirmación (la clienta elegida, o la que se está
  // cargando). `null` = todavía no hay clienta.
  const clientEmail = selectedClient
    ? selectedClient.email
    : clientMode === "new" && newClient.firstName
      ? newClient.email
      : null
  const avisaSinEmail = clientLabel !== null && sinEmail(clientEmail)

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

        {/* ── Step 1: Qué reserva (packs + tratamientos) ── */}
        {step === 1 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              ¿Qué reserva?
            </h3>

            {packs.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
                  Packs
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {packs.map((p) => {
                    const isSel = packId === p.id
                    return (
                      <div key={p.id}>
                        <label
                          style={{
                            display: "flex", alignItems: "center", gap: 12,
                            cursor: p.bookable ? "pointer" : "not-allowed",
                            padding: "10px 12px", borderRadius: 8, fontSize: 13,
                            background: isSel ? "var(--linen)" : "transparent",
                            border: `1px solid ${isSel ? "var(--gold)" : "var(--line)"}`,
                            opacity: p.bookable ? 1 : 0.55,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSel}
                            disabled={!p.bookable}
                            onChange={(e) => choosePack(e.target.checked ? p : null)}
                            style={{ width: 15, height: 15 }}
                          />
                          <span style={{ flex: 1 }}>
                            <strong>{p.name}</strong>
                            <span style={{ color: "var(--ink-mute)", marginLeft: 8 }}>{p.serviceName}</span>
                          </span>
                          <span style={{ color: "var(--ink-mute)" }}>
                            {p.sessions} sesiones{p.intervalDays ? ` · cada ${p.intervalDays} días` : ""}
                          </span>
                          <span style={{ color: "var(--ink-soft)" }}>{fmtPrice(p.priceCents / 100)}</span>
                        </label>
                        {!p.bookable && (
                          <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "4px 0 0 34px" }}>
                            Este pack no tiene ninguna profesional asignada a “{p.serviceName}”: asignala en
                            Personal antes de venderlo.
                          </p>
                        )}
                        {isSel && p.pricingMode === "per_zone" && (() => {
                          const single = p.zoneSelection === "single"
                          const atLimit = packZoneIds.length >= p.zonesCount
                          return (
                            <div style={{ paddingLeft: 34, display: "flex", flexDirection: "column", gap: 6, marginTop: 4, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                                {single ? "Elegí un producto:" : `Elegí ${p.zonesCount} zona(s) para el pack:`}
                              </span>
                              {p.zones.map((z) => {
                                const checked = packZoneIds.includes(z.id)
                                return (
                                  <label
                                    key={z.id}
                                    style={{
                                      display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                                      cursor: "pointer", opacity: !single && !checked && atLimit ? 0.5 : 1,
                                    }}
                                  >
                                    <input
                                      type={single ? "radio" : "checkbox"}
                                      name={single ? `nr-packzone-${p.id}` : undefined}
                                      checked={checked}
                                      disabled={!single && !checked && atLimit}
                                      onChange={() => togglePackZone(z.id)}
                                      style={{ width: 15, height: 15 }}
                                    />
                                    <span>{z.name} · {z.durationMin} min</span>
                                  </label>
                                )
                              })}
                              <span style={{ fontSize: 12, color: p.zonesCount > 0 ? "var(--ink-mute)" : "#8c463c" }}>
                                {p.zonesCount <= 0
                                  ? "Este pack no tiene configurada la cantidad de zonas: revisalo en Packs."
                                  : packZoneIds.length === p.zonesCount
                                    ? `${packDurationMin} min por sesión`
                                    : `Elegí ${p.zonesCount - packZoneIds.length} más`}
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
              Tratamientos
            </p>
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
                      {selectedPack && selectedIds.has(s.id) && !s.bookable && (
                        <p style={{ fontSize: 12, color: "#8c463c", margin: "4px 0 0 34px" }}>
                          “{s.name}” no tiene ninguna profesional asignada: no se puede sumar a una compra
                          con pack. Sacalo, o cargá el turno aparte (sin pack).
                        </p>
                      )}
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
            {(selectedIds.size > 0 || selectedPack) && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)", fontSize: 13, color: "var(--ink-mute)" }}>
                {selectedPack && (
                  <div>{selectedPack.name} · {selectedPack.sessions} sesiones · {fmtPrice(selectedPack.priceCents / 100)}</div>
                )}
                {selectedIds.size > 0 && (
                  <div>
                    {selectedIds.size} servicio{selectedIds.size > 1 ? "s" : ""} · {totalMin} min · {fmtPrice(totalCents / 100)}
                  </div>
                )}
                {selectedPack && selectedIds.size > 0 && (
                  <div style={{ color: "var(--ink)", marginTop: 4 }}>Total · {fmtPrice(grandTotalCents / 100)}</div>
                )}
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

            {/* ── Las sesiones del pack, cada una con su fecha ── */}
            {selectedPack && (
              <div style={{ marginBottom: 28 }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
                  {selectedPack.name}
                </p>
                {pickingIdx !== null ? (
                  <div>
                    <p style={{ fontSize: 13, marginBottom: 10 }}>
                      Sesión {pickingIdx + 1} de {selectedPack.sessions}
                      {selectedPack.intervalDays && pickingIdx > 0 ? (
                        <span style={{ color: "var(--ink-mute)" }}>
                          {" "}· al menos {selectedPack.intervalDays} días después de la anterior
                        </span>
                      ) : null}
                    </p>
                    {/* El selector viene de la reserva pública y usa las
                        clases de `reserva.css` (calendario, slots). Sus
                        colores y medidas salen de las variables definidas en
                        `.blv`: sin este wrapper el calendario se ve como
                        texto plano, con los días y los números apilados.
                        Se le apagan las dos reglas que `.blv` trae pensadas
                        para una PÁGINA entera (alto de pantalla y fondo
                        propio), que acá dejarían un bloque beige gigante
                        dentro de la tarjeta del admin. */}
                    <div
                      className="blv"
                      style={{
                        minHeight: 0,
                        background: "transparent",
                        // El calendario son 7 columnas de celdas CUADRADAS: en
                        // una tarjeta ancha como la del admin cada celda se
                        // agranda muchísimo. Se lo acota al ancho de columna
                        // para el que fue diseñado (el de la reserva pública).
                        maxWidth: 420,
                      }}
                    >
                    <PackSessionPicker
                      businessHours={businessHours}
                      durationMin={packDurationMin}
                      proHint="auto"
                      // Con el servicio del pack: la MISMA regla estricta de
                      // `staff_services` que aplica `planPack` al confirmar (la
                      // ficha de la clienta pasa `null` porque ahí agenda
                      // `schedulePackSession`, que no la aplica).
                      serviceId={selectedPack.serviceId}
                      minDate={minForPackSession(pickingIdx)}
                      // No ofrecer un horario que se pise con lo que ya se
                      // eligió para esta misma compra (las sesiones anteriores
                      // o los tratamientos): `crossOverlapCheck` lo rechazaría.
                      blockedIntervals={[...packBlocks, ...treatmentBlocks]}
                      allowPast={yaOcurrio}
                      onPick={(iso) => setPackSlot(pickingIdx, iso)}
                      onCancel={() => setPickingIdx(null)}
                    />
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {/* Registrar algo ya ocurrido: el calendario pasa a
                        ofrecer los últimos 60 días. Sólo el admin puede
                        hacerlo (el servidor lo vuelve a verificar). */}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={yaOcurrio}
                        onChange={(e) => { setYaOcurrio(e.target.checked); setPackSlots([]); setSelectedSlot(null) }}
                      />
                      Esta compra ya ocurrió (permitir fechas pasadas)
                    </label>
                    {yaOcurrio && (
                      <p style={{ fontSize: 11, color: "var(--ink-mute)", margin: "0 0 4px" }}>
                        Las sesiones que pongas en el pasado van a quedar <strong>confirmadas</strong>:
                        marcalas como completadas en la agenda (filtro <em>Pasados</em>) para que
                        descuenten del pack.
                      </p>
                    )}
                    {Array.from({ length: selectedPack.sessions }).map((_, i) => {
                      const iso = packSlots[i]
                      // No se puede elegir la 3ª sin la 2ª: el mínimo de cada
                      // sesión depende de la anterior.
                      const blocked = i > 0 && !packSlots[i - 1]
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex", alignItems: "center", gap: 12,
                            padding: "10px 12px", borderRadius: 8, fontSize: 13,
                            border: `1px solid ${iso ? "var(--gold)" : "var(--line)"}`,
                            background: iso ? "var(--linen)" : "transparent",
                          }}
                        >
                          <span style={{ color: "var(--ink-mute)", width: 80, flexShrink: 0 }}>Sesión {i + 1}</span>
                          <span style={{ flex: 1 }}>
                            {iso ? fmtMoment(new Date(iso).getTime()) : <span style={{ color: "var(--ink-mute)" }}>Sin agendar</span>}
                          </span>
                          {iso ? (
                            <>
                              {/* "Cambiar" abre el calendario en ESTA sesión sin
                                  borrarla antes: si se elige otra fecha se
                                  reemplaza (y se re-eligen las siguientes, que
                                  dependen de ella); si se cancela, queda como
                                  estaba. Antes había que quitarla para poder
                                  moverla. */}
                              <button
                                className="adm-btn"
                                style={{ fontSize: 11, padding: "4px 10px" }}
                                onClick={() => setPickingIdx(i)}
                              >
                                Cambiar
                              </button>
                              <button className="adm-btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => clearPackFrom(i)}>
                                Quitar
                              </button>
                            </>
                          ) : (
                            <button
                              className="adm-btn"
                              style={{ fontSize: 11, padding: "4px 10px" }}
                              disabled={blocked}
                              onClick={() => setPickingIdx(i)}
                            >
                              Elegir fecha
                            </button>
                          )}
                        </div>
                      )
                    })}
                    <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "4px 0 0" }}>
                      Alcanza con agendar la primera: las que queden sin fecha se agendan después, desde la
                      ficha de la clienta.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Los tratamientos, con el buscador de siempre ── */}
            {hasServices && pickingIdx === null && (
              <div>
                {selectedPack && (
                  <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
                    Tratamientos
                  </p>
                )}
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
                      {slots.map((slot) => {
                        // Un horario que se pisa con una sesión del pack no se
                        // ofrece: `crossOverlapCheck` rechazaría la compra entera.
                        const { startMs, endMs } = visitWindow(slot)
                        const block = overlappingBlock(startMs, Math.round((endMs - startMs) / 60_000), packBlocks)
                        if (block) {
                          return (
                            <span
                              key={slot.time}
                              className="adm-btn"
                              title={`Se pisa con ${block.name}`}
                              style={{ fontSize: 13, minWidth: 64, opacity: 0.45, cursor: "default", textAlign: "center" }}
                            >
                              {slot.time}
                            </span>
                          )
                        }
                        return (
                          <button
                            key={slot.time}
                            onClick={() => setSelectedSlot(slot)}
                            className={`adm-btn ${selectedSlot?.time === slot.time ? "adm-btn--primary" : ""}`}
                            style={{ fontSize: 13, minWidth: 64 }}
                          >
                            {slot.time}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === 3 && (
          <div>
            <h3 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 16, marginBottom: 20 }}>
              {selectedPack ? "Confirmar la compra" : "Confirmar turno"}
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>Clienta</span>
                <span><strong>{clientLabel}</strong></span>
              </div>
              {selectedPack && (
                <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                  <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>Pack</span>
                  <span>
                    {selectedPack.name}
                    <span style={{ color: "var(--ink-mute)", marginLeft: 6 }}>
                      ({selectedPack.sessions} sesiones · {fmtPrice(selectedPack.priceCents / 100)})
                    </span>
                  </span>
                </div>
              )}
              {hasServices && (
                <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
                  <span style={{ width: 100, color: "var(--ink-mute)", flexShrink: 0 }}>
                    {selectedPack ? "Tratamientos" : "Servicios"}
                  </span>
                  <span>
                    {selectedServices.map((s) => s.name).join(", ")}
                    <span style={{ color: "var(--ink-mute)", marginLeft: 6 }}>
                      ({totalMin} min · {fmtPrice(totalCents / 100)})
                    </span>
                  </span>
                </div>
              )}
            </div>

            {/* El itinerario completo, en el mismo orden en que la clienta lo va a vivir. */}
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 10 }}>
                Itinerario
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {itinerary.map((it, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, fontSize: 13,
                      padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)",
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <strong>{it.label}</strong>
                      <span style={{ color: "var(--ink-mute)", marginLeft: 8 }}>{fmtMoment(it.startMs)}</span>
                    </span>
                    <span style={{ color: "var(--ink-mute)" }}>{it.durationMin} min</span>
                    <span style={{ color: "var(--ink-soft)" }}>
                      {it.priceCents === 0 ? "incluida" : fmtPrice((it.priceCents ?? 0) / 100)}
                    </span>
                  </div>
                ))}
                {packPendingSessions > 0 && (
                  <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: "2px 0 0" }}>
                    Quedan {packPendingSessions} sesión{packPendingSessions > 1 ? "es" : ""} sin agendar: se
                    agendan después, desde la ficha de la clienta.
                  </p>
                )}
              </div>
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--ink-mute)" }}>Total</span>
                <strong>{fmtPrice(grandTotalCents / 100)}</strong>
              </div>
            </div>

            {avisaSinEmail && (
              <p style={{ fontSize: 13, color: "#8c463c", marginBottom: 16 }}>
                Esta clienta no tiene email: no va a recibir la confirmación.
              </p>
            )}

            {/* Las notas internas sólo viajan por el camino de sólo tratamientos
                (`createAdminBooking`). El motor compartido no las recibe, así que
                con un pack en la compra no se ofrece el campo en vez de perderlas
                en silencio. */}
            {!selectedPack && (
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
            )}

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
                (step === 2 && (!slotValid || pickingIdx !== null))
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
              {submitPending
                ? (selectedPack ? "Creando la compra…" : "Creando turno…")
                : (selectedPack ? "Confirmar compra" : "Crear turno")}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
