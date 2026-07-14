"use server"

import { headers } from "next/headers"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { sendBookingConfirmation, sendPackConfirmation, sendMultiBookingConfirmation, sendMixedBookingConfirmation } from "@/lib/email/booking-emails"
import { notifyNewBooking } from "@/lib/email/notify-booking"
import { ymd, filterFutureSlots, slotToUtcMs, AR_UTC_OFFSET } from "./data"
import { createCalendarEvent } from "@/lib/google-calendar"
import { computeZonePricing, resolveSelectedZones, type Zone, type ZoneSnapshot } from "@/lib/servicios/zones"
import { validatePackSlots, packSessionPrices, arPartsFromUtc } from "@/lib/servicios/pack-sessions"
import type { PlannedAppointment, PlannedLeg } from "@/lib/servicios/booking-plan"
import { crossOverlapCheck, sumDeposits, sumTotals } from "@/lib/servicios/booking-plan"
import { amountDueNow, type PayChoice } from "@/lib/servicios/payments"
import { validateSeparateSlots, totalDueNowSeparate, type SlotItem } from "@/lib/servicios/multi-booking"
import { orderLastViolated, sortOrderLast } from "@/lib/servicios/service-order"
import { allowedStaffFor, canStaffDoService, serviceIsBookable, type StaffServiceMap } from "@/lib/servicios/staff-services"
import {
  assignableStaff,
  buildBusyLegs,
  type BusyLeg,
  type ApptRow,
} from "@/lib/servicios/availability"
import { chooseStaff } from "@/lib/servicios/choose-staff"

const BookingInput = z.object({
  serviceIds: z.array(z.string().uuid()),
  startsAt: z.string().datetime(),
  proHint: z.string(),
  // Multi-professional sequential support
  serviceOrder: z.array(z.string().uuid()).optional(),
  resolvedStaff: z.record(z.string(), z.string()).optional(),
  redeemWithPoints: z.boolean().optional(),
  savedClientId: z.string().uuid().optional(),
  comboId: z.string().uuid().optional(),
  zoneSelections: z.record(z.string().uuid(), z.array(z.string().uuid())).optional(),
  packId: z.string().uuid().optional(),
  packZoneIds: z.array(z.string().uuid()).optional(),
  packSlots: z.array(z.string().datetime()).optional(),
  // La profesional del pack ("auto" o un staffId). ES SUYA: no se deriva de
  // `resolvedStaff`, que pertenece a los servicios sueltos (en una compra
  // mezclada el pack terminaría con la profesional de otro servicio).
  packStaff: z.union([z.literal("auto"), z.string().uuid()]).optional(),
  payChoice: z.enum(["deposit", "full"]).optional(),
  // Modo "separados": una fecha por servicio (serviceId → ISO). Si no viene,
  // la reserva es la de siempre: UN turno con los servicios encadenados.
  serviceSlots: z.record(z.string().uuid(), z.string().datetime()).optional(),
  // Profesional preferida por servicio ("auto" o un staffId).
  serviceStaff: z.record(z.string().uuid(), z.union([z.literal("auto"), z.string().uuid()])).optional(),
  client: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    dob: z.string().min(1),
    marketingConsent: z.boolean(),
    isExisting: z.boolean(),
  }),
}).refine((v) => v.serviceIds.length > 0 || !!v.packId, {
  message: "Elegí al menos un servicio o un pack.",
})

export type CreateBookingInput = z.infer<typeof BookingInput>

export type CreateBookingResult =
  | { ok: true; appointmentId: string; appointmentIds?: string[] }
  | { ok: false; error: string }

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Deshace una reserva que falló, y DEVUELVE LOS PUNTOS. Todo o nada.
 *
 * Reemplaza a los dos rollbacks que había (uno sabía borrar la compra del pack,
 * el otro sabía devolver los puntos). En una compra MEZCLADA hay que hacer las
 * dos cosas, y tener dos helpers es como se pierde un reembolso.
 *
 * Los puntos del canje se descuentan ANTES de crear ningún turno. Cualquier
 * salida de error posterior tiene que pasar por acá, o la clienta se queda sin
 * puntos y sin turno.
 *
 * Con `appointmentIds` vacío y sin `packPurchaseId` no borra nada: sólo
 * reembolsa. Eso lo hace servible también para un rechazo temprano.
 */
async function rollbackAll(
  supabase: ReturnType<typeof adminClient>,
  created: { appointmentIds: string[]; packPurchaseId: string | null },
  clientId: string,
  pointsToRefund: number,
  fallbackError: string
): Promise<CreateBookingResult> {
  if (created.appointmentIds.length) {
    const { error: delErr } = await supabase
      .from("appointments")
      .delete()
      .in("id", created.appointmentIds)
    if (delErr) {
      // No pudimos deshacer: quedan turnos sueltos en la agenda. Que NO
      // reintente sola (duplicaría los turnos): que llame al salón.
      // A propósito NO se devuelven los puntos acá: si el DELETE falló, la
      // clienta puede estar quedándose con algunos turnos ya creados, así que
      // reembolsar sería regalarle los puntos Y el turno.
      // No "arreglarlo" agregando un refund acá.
      return {
        ok: false,
        error:
          "Hubo un problema al crear tus turnos y no pudimos deshacerlo por completo. Por favor comunicate con el salón para confirmar el estado de tu reserva antes de volver a intentar.",
      }
    }
  }

  if (created.packPurchaseId) {
    // `appointments.pack_purchase_id` tiene ON DELETE SET NULL, así que borrar
    // la compra SIEMPRE "funciona" aunque hayan quedado turnos: por eso el
    // borrado de turnos de arriba se chequea a mano y corta antes de llegar acá.
    const { error: purDelErr } = await supabase
      .from("pack_purchases")
      .delete()
      .eq("id", created.packPurchaseId)
    // Si la compra del pack NO se pudo borrar, la clienta se queda CON el pack.
    // Devolverle además los puntos sería regalarle las dos cosas — el mismo
    // razonamiento que en el borrado de turnos de arriba. Se corta acá.
    if (purDelErr) {
      return {
        ok: false,
        error:
          "Hubo un problema al crear tu reserva y no pudimos deshacerla por completo. Por favor comunicate con el salón para confirmar el estado de tu pack antes de volver a intentar.",
      }
    }
  }

  if (pointsToRefund > 0) {
    const { data: c, error: readErr } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    // Si no pudimos LEER el saldo, NO escribimos: sumarle el reembolso a un
    // saldo desconocido (que caería en 0) le borraría todos sus puntos.
    if (readErr || !c) {
      return {
        ok: false,
        error:
          "No pudimos completar tu reserva y tampoco confirmar la devolución de tus puntos. Por favor comunicate con el salón: no perdiste nada, lo resolvemos a mano.",
      }
    }
    await supabase
      .from("clients")
      .update({ loyalty_points: ((c.loyalty_points as number | null) ?? 0) + pointsToRefund })
      .eq("id", clientId)
  }

  return { ok: false, error: fallbackError }
}

/** El plan de turnos de un pack: lo que habría que crear, todavía sin crear nada. */
type PackPlan = {
  pack: { id: string; name: string; sessions: number; totalPriceCents: number }
  serviceId: string
  serviceName: string
  slotDates: Date[]
  appointments: PlannedAppointment[]
}

/**
 * Resuelve un pack y arma el plan de sus turnos: el pack y su servicio, las
 * zonas y duración de la 1ª sesión, valida las fechas elegidas y revalida CADA
 * una contra la disponibilidad real. **No escribe nada** — `createBooking` es
 * quien, con este plan, crea la `pack_purchase` y los turnos.
 */
async function planPack(
  supabase: ReturnType<typeof adminClient>,
  input: CreateBookingInput,
  payChoice: PayChoice
): Promise<{ ok: true; plan: PackPlan } | { ok: false; error: string }> {
  const { data: pack } = await supabase
    .from("packs")
    .select("id, name, sessions, interval_days, total_price_cents, zones_count, active, visible_reserva, service:services(id, name, pricing_mode, duration_min, price_cents)")
    .eq("id", input.packId)
    .eq("active", true)
    .eq("visible_reserva", true)
    .maybeSingle()
  if (!pack) return { ok: false, error: "Ese pack ya no está disponible." }
  const svc = pack.service as unknown as { id: string; name: string; pricing_mode: "fixed" | "per_zone"; duration_min: number; price_cents: number } | null
  if (!svc) return { ok: false, error: "El pack no tiene servicio asociado." }

  // Quién hace el servicio del pack (`staff_services`). Mismo criterio
  // fail-closed que el turno normal (más abajo): un servicio sin ninguna
  // profesional asignada no se puede reservar online.
  const { data: packLinkRows, error: packLinkErr } = await supabase
    .from("staff_services")
    .select("staff_id")
    .eq("service_id", svc.id)
  if (packLinkErr) return { ok: false, error: "No pudimos verificar la disponibilidad. Probá de nuevo." }
  const packStaffMap: StaffServiceMap = {
    [svc.id]: (packLinkRows ?? []).map((r) => r.staff_id as string),
  }
  if (!serviceIsBookable(svc.id, packStaffMap))
    return { ok: false, error: `"${svc.name}" no está disponible para reservar online por ahora.` }

  // Duración de la 1ª sesión + snapshot de zonas
  let firstDuration = svc.duration_min
  let zonesSnapshot: ZoneSnapshot[] | null = null
  if (svc.pricing_mode === "per_zone") {
    const { data: zoneRows } = await supabase
      .from("service_zones")
      .select("id, name, duration_min, price_cents")
      .eq("service_id", svc.id)
      .eq("active", true)
    const avail: Zone[] = (zoneRows ?? []).map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null }))
    const selected = resolveSelectedZones(input.packZoneIds ?? [], avail)
    if (!selected || selected.length !== (pack.zones_count ?? 0))
      return { ok: false, error: `Elegí exactamente ${pack.zones_count} zona(s) para el pack.` }
    const p = computeZonePricing(selected, svc.price_cents)
    firstDuration = p.durationMin
    zonesSnapshot = p.zones
  }

  // ── Fechas de las sesiones ────────────────────────────────────────────────
  const rawSlots = (input.packSlots?.length ? input.packSlots : [input.startsAt])
  const slotDates = rawSlots.map((s) => new Date(s))
  if (slotDates.some((d) => isNaN(d.getTime())))
    return { ok: false, error: "Alguna fecha del pack es inválida." }

  const nowMs = Date.now()
  const pastIdx = slotDates.findIndex((d) => d.getTime() <= nowMs)
  if (pastIdx !== -1)
    return { ok: false, error: `La sesión ${pastIdx + 1} tiene que ser en una fecha futura.` }

  const rules = validatePackSlots(slotDates, {
    sessionsTotal: pack.sessions,
    intervalDays: pack.interval_days ?? null,
  })
  if (!rules.ok) return { ok: false, error: rules.error }

  // La profesional del pack sale de SU propio campo. `proHint` se conserva
  // como fallback para las reservas viejas (una pestaña abierta de antes del
  // deploy manda `proHint` y no `packStaff`).
  const packHint = input.packStaff ?? (input.proHint !== "auto" ? input.proHint : "auto")
  const packStaffId = packHint !== "auto" ? packHint : null
  const packProHint = packStaffId ?? "auto"

  // La profesional pedida para el pack (si pidió una puntual) tiene que
  // hacer el servicio del pack.
  if (packStaffId && !canStaffDoService(packStaffId, svc.id, packStaffMap))
    return { ok: false, error: `Esa profesional no realiza "${svc.name}". Elegí el horario de nuevo.` }

  // ── Revalidar CADA fecha contra la disponibilidad real (autoritativo) ─────
  const { data: bhRows } = await supabase
    .from("business_hours")
    .select("day_of_week, is_open, slots")
  const bhByDow = new Map(
    ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
      .map((h) => [h.day_of_week, h])
  )

  for (let i = 0; i < slotDates.length; i++) {
    // Las sesiones de ESTE pedido todavía no existen en la DB (se insertan
    // recién más abajo), así que fetchDayAvailability no las puede ver entre
    // sí. Sin una regla de intervalo (interval_days null) dos sesiones
    // podrían quedar más cerca que la duración de la sesión y superponerse:
    // lo chequeamos acá a mano contra la sesión anterior de este mismo pedido.
    if (i > 0 && slotDates[i].getTime() < slotDates[i - 1].getTime() + firstDuration * 60_000)
      return { ok: false, error: `La sesión ${i + 1} se superpone con la anterior. Elegí otro horario.` }

    const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(slotDates[i])
    const bh = bhByDow.get(dayOfWeek)
    if (!bh?.is_open || !bh.slots.includes(timeStr))
      return { ok: false, error: `El horario de la sesión ${i + 1} ya no está disponible. Elegí otro.` }
    const free = await fetchDayAvailability(dateStr, firstDuration, packProHint, [timeStr], { serviceId: svc.id })
    if (!free.includes(timeStr))
      return { ok: false, error: `El horario de la sesión ${i + 1} se ocupó. Elegí otro.` }
  }

  const prices = packSessionPrices(pack.total_price_cents, slotDates.length, payChoice)

  // Resolver la profesional de CADA sesión. Si la clienta pidió una puntual
  // (packStaffId no es null), se respeta en todas. Si es "Auto", se elige por
  // sesión, PREFIRIENDO la de la sesión anterior (continuidad) sin forzarla.
  const sessionStaff: (string | null)[] = []
  let prev: string | null = null
  for (let i = 0; i < slotDates.length; i++) {
    if (packStaffId) { sessionStaff.push(packStaffId); continue }
    const { dateStr, timeStr } = arPartsFromUtc(slotDates[i])
    const chosen = await chooseStaffForSlot(supabase, {
      dateStr,
      timeStr,
      durationMin: firstDuration,
      serviceId: svc.id,
      preferredStaffId: prev,
    })
    // Este `planPack` corre ANTES de que `createBooking` descuente los puntos
    // (y un pack nunca se canjea: `hasPack && redeem` ya se rechazó más
    // arriba, en `createBooking`) — así que este `return` no tiene puntos que
    // reembolsar.
    if (!chosen)
      return { ok: false, error: `El horario de la sesión ${i + 1} se ocupó. Elegí otro.` }
    sessionStaff.push(chosen)
    prev = chosen
  }

  const appointments: PlannedAppointment[] = slotDates.map((d, i) => ({
    label: `Sesión ${i + 1} del pack`,
    startsAtMs: d.getTime(),
    durationMin: firstDuration,
    staffId: sessionStaff[i],
    totalCents: prices[i].totalCents,
    depositCents: prices[i].depositCents,
    depositPaid: prices[i].depositPaid,
    notesInternal: `Pack: ${pack.name} (sesión ${i + 1} de ${pack.sessions})`,
    isPackSession: true,
    legs: [
      {
        serviceId: svc.id,
        name: svc.name,
        durationMin: firstDuration,
        priceCents: prices[i].totalCents,
        zones: zonesSnapshot,
        staffId: sessionStaff[i],
        startsAtMs: d.getTime(),
      },
    ],
  }))

  return {
    ok: true,
    plan: {
      pack: {
        id: pack.id,
        name: pack.name,
        sessions: pack.sessions,
        totalPriceCents: pack.total_price_cents,
      },
      serviceId: svc.id,
      serviceName: svc.name,
      slotDates,
      appointments,
    },
  }
}

type LooseService = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  points_cost: number | null
  loyalty_enabled: boolean
  pricing_mode: "fixed" | "per_zone"
  zone_selection: string | null
  order_last: boolean
}

/**
 * Arma el plan de los servicios sueltos: **separados** (una fecha por
 * servicio → N turnos, cada uno con una pata) o **"juntos"** (los servicios
 * encadenados el mismo día — incluye el caso de un solo servicio o un combo
 * → UN turno con M patas escalonadas). Valida TODO lo que hoy validan esas
 * dos ramas (fechas futuras, superposición, horarios del negocio,
 * disponibilidad real por pata, `order_last`) — **no escribe nada**:
 * `createBooking` es quien, con este plan, crea los turnos.
 *
 * Una falla de validación devuelve `{ ok: false, error }`: el reembolso de
 * los puntos (ya descontados antes de llamar acá) lo hace quien la llama.
 */
async function planLooseServices(
  supabase: ReturnType<typeof adminClient>,
  input: CreateBookingInput,
  services: LooseService[],
  computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }>,
  payChoice: PayChoice,
  redeem: boolean,
  totalPointsCost: number,
  // La duración y el precio del turno "juntos" (ya con el combo aplicado, si
  // corresponde): los computa `createBooking` UNA sola vez, antes de llamar
  // acá, porque son los mismos valores que usan después el mail de
  // confirmación y `notifyNewBooking`. Pasarlos en vez de re-derivarlos acá
  // evita una segunda lectura del combo (podría desactivarse entre una y
  // otra) y una segunda cuenta de la plata.
  totalDuration: number,
  totalCents: number
): Promise<
  | { ok: true; mode: "separados" | "juntos"; appointments: PlannedAppointment[] }
  | { ok: false; error: string }
> {
  // ── Varios servicios, cada uno con SU fecha (modo "separados") ─────────────
  // Un turno por servicio, con UNA sola seña (la suma de las de cada turno).
  // El modo "juntos" (los servicios encadenados el mismo día) NO pasa por acá:
  // sigue siendo UN turno, más abajo, exactamente como siempre.
  if (input.serviceSlots && services.length >= 2 && !input.comboId) {
    // En este modo las fechas son TODAS obligatorias.
    if (services.some((s) => !input.serviceSlots![s.id]))
      return { ok: false, error: "Elegí fecha y hora para cada servicio." }

    // Ordenados cronológicamente: así el primer turno (más abajo) es
    // genuinamente el primero de la clienta, sin depender del orden
    // arbitrario en que Postgres devuelve `services` (sin `.order()`).
    const slots: SlotItem[] = services
      .map((s) => ({
        serviceId: s.id,
        name: s.name,
        startsAtMs: new Date(input.serviceSlots![s.id]).getTime(),
        durationMin: computed[s.id].durationMin,
        priceCents: computed[s.id].priceCents,
      }))
      .sort((a, b) => a.startsAtMs - b.startsAtMs)

    const rules = validateSeparateSlots(slots, Date.now())
    if (!rules.ok) return { ok: false, error: rules.error }

    // Revalidar CADA horario contra la disponibilidad real (autoritativo),
    // con la duración y la profesional de ESE servicio.
    const { data: bhRows } = await supabase
      .from("business_hours")
      .select("day_of_week, is_open, slots")
    const bhByDow = new Map(
      ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
        .map((h) => [h.day_of_week, h])
    )

    const hintFor = (serviceId: string) => {
      const h = input.serviceStaff?.[serviceId] ?? input.proHint
      return h && h !== "auto" ? h : "auto"
    }

    for (const s of slots) {
      const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(new Date(s.startsAtMs))
      const bh = bhByDow.get(dayOfWeek)
      if (!bh?.is_open || !bh.slots.includes(timeStr))
        return { ok: false, error: `El horario de ${s.name} ya no está disponible. Elegí otro.` }
      const free = await fetchDayAvailability(dateStr, s.durationMin, hintFor(s.serviceId), [timeStr], { serviceId: s.serviceId })
      if (!free.includes(timeStr))
        return { ok: false, error: `El horario de ${s.name} se ocupó. Elegí otro.` }
    }

    // Resolver la profesional de cada slot ANTES de armar el plan. "Auto" se
    // convierte en un nombre concreto (o se rechaza si nadie puede).
    //
    // Este `return`, igual que los dos de arriba, corre en `planLooseServices`
    // — la fase de PLANIFICACIÓN — antes de que `createBooking` descuente los
    // puntos y antes de que exista ningún turno o compra de pack (`created`
    // recién se inicializa más abajo, en la fase de escritura). No hay nada
    // que reembolsar todavía, así que NO pasa por `rollbackAll` (llamarlo acá
    // con `redeem ? totalPointsCost : 0` le sumaría puntos a la clienta que
    // nunca se le descontaron).
    const resolvedByService: Record<string, string | null> = {}
    for (const s of slots) {
      const hint = hintFor(s.serviceId)
      if (hint !== "auto") {
        resolvedByService[s.serviceId] = hint
        continue
      }
      const { dateStr, timeStr } = arPartsFromUtc(new Date(s.startsAtMs))
      const chosen = await chooseStaffForSlot(supabase, {
        dateStr,
        timeStr,
        durationMin: s.durationMin,
        serviceId: s.serviceId,
      })
      // Si el buscador lo ofreció como libre pero acá nadie puede, hubo una
      // carrera (alguien reservó en el medio): se rechaza, nunca se deja en $0
      // ni se pisa un turno.
      if (!chosen)
        return { ok: false, error: `El horario de ${s.name} se ocupó. Elegí otro.` }
      resolvedByService[s.serviceId] = chosen
    }

    // ── Un PlannedAppointment por servicio, cada uno con UNA pata ──────────
    const appointments: PlannedAppointment[] = slots.map((s) => {
      const staffId = resolvedByService[s.serviceId] ?? null
      return {
        label: s.name,
        startsAtMs: s.startsAtMs,
        durationMin: s.durationMin,
        staffId,
        // Cada turno lleva el precio de SU servicio y SU propia seña.
        totalCents: redeem ? 0 : s.priceCents,
        depositCents: redeem ? 0 : amountDueNow(s.priceCents, payChoice),
        depositPaid: redeem,
        notesInternal: redeem
          ? `Canjeado con ${totalPointsCost} pts del Programa Cerca`
          : null,
        isPackSession: false,
        legs: [
          {
            serviceId: s.serviceId,
            name: s.name,
            durationMin: s.durationMin,
            // El snapshot guarda lo que VALE el servicio aunque se haya
            // canjeado (igual que en el camino "juntos").
            priceCents: s.priceCents,
            zones: computed[s.serviceId].zones,
            staffId,
            startsAtMs: s.startsAtMs,
          },
        ],
      }
    })

    return { ok: true, mode: "separados", appointments }
  }

  // ── Servicios "juntos" (o un solo servicio, o un combo): UN turno ──────────
  // `totalDuration` y `totalCents` vienen de `createBooking` (parámetros):
  // no se recalculan acá. Ver el comentario de los parámetros más arriba.
  const depositCents = amountDueNow(totalCents, payChoice)
  const startsAt = new Date(input.startsAt)

  // 5) Orden real de los servicios — respetando "va siempre al final" — ANTES
  // de armar el turno. Tiene que resolverse acá porque `mainStaffId` depende
  // de él: la profesional principal tiene que ser la del PRIMER servicio del
  // orden REAL, no la del primero que mandó la clienta — si el orden se
  // reordena por "va siempre al final", usar `input.serviceOrder[0]` le
  // asignaría el turno a la profesional equivocada a la hora equivocada.
  const orderedIds = input.serviceOrder ?? services.map((s) => s.id)
  const requestedOrder = orderedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    // `orderLast` (camelCase) es lo que exige la firma pura de service-order.ts;
    // se agrega acá sin perder ninguno de los campos de `services` que se usan
    // más abajo (id, computed[s.id], etc).
    .map((s) => ({ ...s, orderLast: s.order_last }))

  // Si la clienta mandó un `serviceOrder` (pantalla con el solver ya
  // resuelto) y ese orden viola "va siempre al final", el horario que tiene
  // en pantalla está desactualizado: `resolvedStaff` fue resuelto contra las
  // ventanas de tiempo VIEJAS (antes del reordenamiento), así que una
  // profesional podría quedar escrita en un horario en el que está bloqueada
  // o ya ocupada. En vez de "repararlo" en silencio reordenando, se rechaza
  // y que vuelva a elegir. Cuando NO vino `serviceOrder` (se restauró el
  // estado y se perdió el orden elegido), `orderedIds` es sólo el orden
  // arbitrario de Postgres: no hay un orden validado que respetar, así que
  // ahí SÍ corresponde reordenar (ver `sortOrderLast` más abajo) en vez de
  // rechazar una reserva perfectamente válida.
  if (input.serviceOrder !== undefined && orderLastViolated(requestedOrder))
    return { ok: false, error: "Ese horario ya no es válido. Elegí el horario de nuevo." }

  // Reordenamiento estable: los servicios marcados "va siempre al final" (ej:
  // masajes) pasan al final, sin alterar el orden relativo entre ellos ni el
  // de los demás. Con `order_last` siempre en `false` (producción hoy) esto
  // es la identidad: mismo orden, mismo `serviceOrder[0]`.
  const orderedServices = sortOrderLast(requestedOrder)

  // Determine main staff (first service of the REAL order's resolved pro, or proHint)
  const mainStaffId = input.resolvedStaff
    ? (orderedServices[0]
        ? (input.resolvedStaff[orderedServices[0].id] ?? null)
        : Object.values(input.resolvedStaff)[0] ?? null)
    : (input.proHint !== "auto" ? input.proHint : null)

  // ── Revalidar CADA pata contra la disponibilidad real (autoritativo) ──────
  // El modo "juntos" (UN turno con los servicios encadenados) nunca había
  // vuelto a chequear el horario contra la DB entre que el buscador lo ofreció
  // y que se confirma acá: sólo confiaba en `resolvedStaff` armado en
  // pantalla. Dos clientas con la pantalla abierta en el mismo horario
  // terminaban las dos con turno. Se revalida cada servicio con SU propio
  // horario escalonado (mismo cálculo que arma cada pata), SU propia
  // duración y SU propia profesional — mismo criterio que ya usan acá arriba
  // los modos "pack" y "separados".
  const { data: bhRows, error: bhErr } = await supabase
    .from("business_hours")
    .select("day_of_week, is_open, slots")
  if (bhErr)
    return { ok: false, error: "No pudimos verificar el horario. Probá de nuevo." }
  const bhByDow = new Map(
    ((bhRows ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[])
      .map((h) => [h.day_of_week, h])
  )

  const legs: PlannedLeg[] = []
  let legMs = startsAt.getTime()
  for (let i = 0; i < orderedServices.length; i++) {
    const s = orderedServices[i]
    const c = computed[s.id]
    const legStart = new Date(legMs)
    legMs += c.durationMin * 60_000
    // La profesional de esta pata: la pedida para este servicio, o si no, la
    // principal del turno. Puede quedar en `null` (auto) — el hint para
    // `fetchDayAvailability` (que espera "auto" como centinela) se arma aparte.
    const legStaffId = input.resolvedStaff?.[s.id] ?? mainStaffId
    const legProHint = legStaffId ?? "auto"
    const { dateStr, timeStr, dayOfWeek } = arPartsFromUtc(legStart)
    const bh = bhByDow.get(dayOfWeek)
    // Sólo la PRIMERA pata tiene que caer en la grilla de horarios
    // reservables (`bh.slots`): es el inicio del turno, el horario que la
    // clienta efectivamente eligió en pantalla. Las patas 2..n arrancan en
    // `inicio + Σ(duraciones anteriores)` — un horario encadenado que casi
    // nunca cae en la grilla (duraciones de 45/50/75 min, zonas de 30) — el
    // buscador (`checkPerm`) no les exige estar en la grilla, así que
    // exigírselo acá rechazaría CUALQUIER combinación multi-servicio que el
    // buscador acaba de ofrecer. Todas las patas sí tienen que caer en un
    // día abierto (`is_open`).
    if (!bh?.is_open || (i === 0 && !bh.slots.includes(timeStr)))
      return {
        ok: false,
        error: `El horario de "${s.name}" ya no está disponible. Elegí otro.`,
      }
    const free = await fetchDayAvailability(dateStr, c.durationMin, legProHint, [timeStr], { serviceId: s.id })
    if (!free.includes(timeStr))
      return { ok: false, error: "El horario se ocupó. Elegí otro." }

    legs.push({
      serviceId: s.id,
      name: s.name,
      durationMin: c.durationMin,
      priceCents: c.priceCents,
      zones: c.zones,
      staffId: legStaffId,
      startsAtMs: legStart.getTime(),
    })
  }

  const appointment: PlannedAppointment = {
    label: orderedServices.map((s) => s.name).join(" + "),
    startsAtMs: startsAt.getTime(),
    durationMin: totalDuration,
    staffId: mainStaffId,
    totalCents: redeem ? 0 : totalCents,
    depositCents: redeem ? 0 : depositCents,
    depositPaid: redeem,
    notesInternal: redeem ? `Canjeado con ${totalPointsCost} pts del Programa Cerca` : null,
    isPackSession: false,
    legs,
  }

  return { ok: true, mode: "juntos", appointments: [appointment] }
}

/**
 * Crea un evento de Google Calendar por cada turno de `items` (best-effort:
 * `try/catch` por evento, no puede tirar) y le guarda `google_event_id` al
 * turno. Cachea el staff (evita repetir la misma consulta cuando varios
 * turnos comparten profesional) — antes este bloque vivía duplicado, línea
 * por línea, entre "separados" y la mezcla. Lo usan esas dos ramas y también
 * "pack solo" (que hasta ahora nunca creaba estos eventos).
 */
async function createCalendarEventsForAppointments(
  supabase: ReturnType<typeof adminClient>,
  clientName: string,
  items: { appointmentId: string; staffId: string | null; label: string; startsAtMs: number; durationMin: number }[]
): Promise<void> {
  const staffCache = new Map<string, { full_name: string | null; email: string | null; calendar_color_id: string | null }>()
  try {
    const distinctStaffIds = [...new Set(
      items.map((item) => item.staffId).filter((id): id is string => !!id)
    )]
    if (distinctStaffIds.length) {
      const { data: staffRows } = await supabase
        .from("staff")
        .select("id, full_name, email, calendar_color_id")
        .in("id", distinctStaffIds)
      for (const row of (staffRows ?? []) as { id: string; full_name: string | null; email: string | null; calendar_color_id: string | null }[]) {
        staffCache.set(row.id, { full_name: row.full_name, email: row.email, calendar_color_id: row.calendar_color_id })
      }
    }
  } catch {
    // Non-fatal: los eventos de Calendar quedarán sin nombre de profesional.
  }

  for (const item of items) {
    try {
      const cached = item.staffId ? staffCache.get(item.staffId) : undefined
      const eventId = await createCalendarEvent({
        appointmentId: item.appointmentId,
        clientName,
        serviceNames: [item.label],
        staffName: cached?.full_name ?? null,
        staffEmail: cached?.email ?? null,
        staffColorId: cached?.calendar_color_id ?? null,
        startsAt: new Date(item.startsAtMs),
        endsAt: new Date(item.startsAtMs + item.durationMin * 60_000),
        notes: null,
      })
      if (eventId)
        await supabase.from("appointments").update({ google_event_id: eventId }).eq("id", item.appointmentId)
    } catch {
      // Non-fatal: los turnos ya están creados.
    }
  }
}

export async function createBooking(
  raw: CreateBookingInput
): Promise<CreateBookingResult> {
  const parsed = BookingInput.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Revisá el formulario." }
  }
  const input = parsed.data
  const supabase = adminClient()

  // 1) Resolve services to compute totals + ends_at
  const { data: services, error: svcErr } = await supabase
    .from("services")
    .select("id, name, duration_min, price_cents, points_cost, loyalty_enabled, pricing_mode, zone_selection, order_last")
    .in("id", input.serviceIds)

  if (svcErr) return { ok: false, error: `Servicios: ${svcErr.message}` }
  if (!services || services.length !== input.serviceIds.length) {
    return { ok: false, error: "Algún servicio ya no está disponible." }
  }

  // Para servicios por zona, traer sus zonas activas y resolver la selección.
  const perZoneIds = services.filter((s) => s.pricing_mode === "per_zone").map((s) => s.id)
  const zonesByService: Record<string, Zone[]> = {}
  if (perZoneIds.length) {
    const { data: zoneRows, error: zErr } = await supabase
      .from("service_zones")
      .select("id, service_id, name, duration_min, price_cents")
      .in("service_id", perZoneIds)
      .eq("active", true)
    if (zErr) return { ok: false, error: `Zonas: ${zErr.message}` }
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null })
    }
  }

  // Precio/duración efectivos por servicio (+ snapshot de zonas para per_zone).
  const computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }> = {}
  for (const s of services) {
    if (s.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(input.zoneSelections?.[s.id] ?? [], zonesByService[s.id] ?? [])
      if (!selected) return { ok: false, error: "Elegí al menos una opción válida para el servicio." }
      if (s.zone_selection === "single" && selected.length !== 1)
        return { ok: false, error: `El servicio "${s.name}" admite un solo producto.` }
      const p = computeZonePricing(selected, s.price_cents)
      computed[s.id] = { durationMin: p.durationMin, priceCents: p.priceCents, zones: p.zones }
    } else {
      computed[s.id] = { durationMin: s.duration_min, priceCents: s.price_cents, zones: null }
    }
  }

  // Quién hace qué (`staff_services`). El servidor es autoritativo: una
  // profesional que no hace el servicio se rechaza, aunque el payload venga
  // armado a mano (esto corre ANTES del descuento de puntos, paso 4b, así
  // que sus `return` no necesitan reembolso).
  const { data: linkRows, error: linkMapErr } = await supabase
    .from("staff_services")
    .select("service_id, staff_id")
    .in("service_id", input.serviceIds)
  if (linkMapErr) return { ok: false, error: "No pudimos verificar la disponibilidad. Probá de nuevo." }
  const staffMap: StaffServiceMap = {}
  for (const r of (linkRows ?? []) as { service_id: string; staff_id: string }[]) {
    ;(staffMap[r.service_id] ??= []).push(r.staff_id)
  }

  // Un servicio que nadie hace no se puede reservar.
  for (const s of services) {
    if (!serviceIsBookable(s.id, staffMap))
      return { ok: false, error: `"${s.name}" no está disponible para reservar online por ahora.` }
  }

  // La profesional pedida (si pidió una) tiene que hacer ese servicio.
  for (const s of services) {
    const asked = input.resolvedStaff?.[s.id] ?? input.serviceStaff?.[s.id]
    if (asked && asked !== "auto" && !canStaffDoService(asked, s.id, staffMap))
      return { ok: false, error: `Esa profesional no realiza "${s.name}". Elegí el horario de nuevo.` }
  }

  const totalDuration = services.reduce((a, s) => a + computed[s.id].durationMin, 0)
  let totalCents = services.reduce((a, s) => a + computed[s.id].priceCents, 0)

  // Si es un combo, reemplazamos el precio por el del combo
  if (input.comboId) {
    const { data: combo } = await supabase
      .from("combos")
      .select("total_price_cents, active")
      .eq("id", input.comboId)
      .eq("active", true)
      .maybeSingle()
    if (combo) totalCents = combo.total_price_cents
  }

  // Lo que se le pide pagar AHORA: la seña (30%) o el total, según eligió.
  // (`depositCents` en sí lo recalcula `planLooseServices` para el plan; acá
  // sólo hace falta `payChoice`, que sí se usa más abajo.)
  const payChoice: PayChoice = input.payChoice ?? "deposit"
  const totalPointsCost = services.reduce(
    (a, s) => a + (s.loyalty_enabled ? (s.points_cost ?? 0) : 0),
    0
  )
  const redeem = !!input.redeemWithPoints
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000)

  // 2) Find or create client. Si ya fue guardada por saveClientEarly usamos
  // ese ID directamente y salteamos la creación.
  const ssr = await createSsrClient()
  const {
    data: { user: authUser },
  } = await ssr.auth.getUser()

  const email = input.client.email.trim().toLowerCase()
  let clientId: string
  let alreadyLinked: boolean

  if (input.savedClientId) {
    clientId = input.savedClientId
    const { data: saved } = await supabase
      .from("clients")
      .select("user_id")
      .eq("id", clientId)
      .maybeSingle()
    alreadyLinked = !!(saved?.user_id)
  } else {
    const { data: existing, error: findErr } = await supabase
      .from("clients")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (findErr) return { ok: false, error: `Clientes: ${findErr.message}` }

    if (existing) {
      clientId = existing.id
      if (authUser && !existing.user_id && authUser.email?.toLowerCase() === email) {
        await supabase.from("clients").update({ user_id: authUser.id }).eq("id", clientId)
      }
      alreadyLinked = !!existing.user_id
    } else {
      const dob = parseDob(input.client.dob)
      const { data: created, error: insErr } = await supabase
        .from("clients")
        .insert({
          user_id:
            authUser && authUser.email?.toLowerCase() === email
              ? authUser.id
              : null,
          first_name: input.client.firstName.trim(),
          last_name: input.client.lastName.trim(),
          email,
          phone: input.client.phone.trim(),
          date_of_birth: dob,
          marketing_consent: input.client.marketingConsent,
          source: "web",
        })
        .select("id")
        .single()
      if (insErr || !created)
        return { ok: false, error: `No pudimos crear tu ficha: ${insErr?.message}` }
      clientId = created.id
      alreadyLinked = false
    }
  }

  // 4) Sala por defecto: la usan tanto el pack como los servicios sueltos (antes
  // el pack hacía su propia consulta idéntica — `packRoom` — porque su rama
  // retornaba antes de llegar acá).
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  const hasPack = !!input.packId
  const hasServices = services.length > 0

  // ── Canje con puntos: NO se puede canjear un pack ────────────────────────
  // Hoy esto es inalcanzable (la pantalla no ofrece canje con un pack elegido)
  // PERO la rama del pack retornaba ANTES del bloque de canje: si llegaran las
  // dos cosas, el pack se creaba SIN descontar los puntos. Al fusionar los
  // caminos ese agujero pasa a ser alcanzable. Se cierra acá.
  if (hasPack && redeem)
    return { ok: false, error: "Los packs no se pueden canjear con puntos." }

  // ── FASE B: planificar y validar TODO, sin escribir nada ──────────────────
  const plan: PlannedAppointment[] = []
  let packPlan: PackPlan | null = null
  let looseMode: "separados" | "juntos" | null = null

  if (hasPack) {
    const r = await planPack(supabase, input, payChoice)
    if (!r.ok) return { ok: false, error: r.error }
    packPlan = r.plan
    plan.push(...r.plan.appointments)
  }

  if (hasServices) {
    const r = await planLooseServices(
      supabase, input, services, computed, payChoice, redeem, totalPointsCost, totalDuration, totalCents
    )
    if (!r.ok) return { ok: false, error: r.error }
    looseMode = r.mode
    plan.push(...r.appointments)
  }

  if (plan.length === 0)
    return { ok: false, error: "No hay nada para reservar." }

  // NUEVO: ningún turno puede pisar a otro — NI las sesiones del pack contra
  // los servicios sueltos. Hasta ahora cada camino se chequeaba por su lado,
  // porque nunca convivían.
  const cross = crossOverlapCheck(plan)
  if (!cross.ok) return { ok: false, error: cross.error }

  // Los `return` de arriba NO reembolsan puntos, y está bien: todavía no se
  // descontaron. El descuento va abajo.

  // ── FASE C: escribir. Desde acá, TODO error tiene que pasar por rollbackAll ─
  const created = { appointmentIds: [] as string[], packPurchaseId: null as string | null }
  const refund = redeem ? totalPointsCost : 0

  // 1) Descontar los puntos (sólo servicios: el pack ya se rechazó arriba).
  //    Este bloque es el que YA existía, movido acá SIN cambios.
  if (redeem) {
    if (totalPointsCost <= 0) {
      return { ok: false, error: "Estos servicios no se pueden canjear por puntos." }
    }
    const { data: c } = await supabase
      .from("clients")
      .select("loyalty_points")
      .eq("id", clientId)
      .maybeSingle()
    const balance = (c?.loyalty_points as number | null) ?? 0
    if (balance < totalPointsCost) {
      return {
        ok: false,
        error: `Te faltan ${totalPointsCost - balance} pts para canjear este turno.`,
      }
    }
    // Si el descuento falla, NO seguimos: si siguiéramos, la clienta se llevaría
    // el turno gratis con los puntos intactos — y peor, un rollback posterior le
    // SUMARÍA puntos que nunca gastó.
    const { error: spendErr } = await supabase
      .from("clients")
      .update({ loyalty_points: balance - totalPointsCost })
      .eq("id", clientId)
    if (spendErr)
      return { ok: false, error: "No pudimos descontar tus puntos. Probá de nuevo en un momento." }
  }

  // 2) La compra del pack.
  if (packPlan) {
    const { data: purchase, error: purErr } = await supabase
      .from("pack_purchases")
      .insert({
        client_id: clientId,
        pack_id: packPlan.pack.id,
        pack_name: packPlan.pack.name,
        service_id: packPlan.serviceId,
        service_name: packPlan.serviceName,
        sessions_total: packPlan.pack.sessions,
        sessions_used: 0,
      })
      .select("id")
      .single()
    if (purErr || !purchase)
      return await rollbackAll(supabase, created, clientId, refund, `No pudimos registrar el pack: ${purErr?.message}`)
    created.packPurchaseId = purchase.id
  }

  // 3) Los turnos, en orden cronológico (así `appointmentIds[0]` es el primero
  //    de verdad y la clienta aterriza en la confirmación correcta).
  const ordered = [...plan].sort((a, b) => a.startsAtMs - b.startsAtMs)

  for (const p of ordered) {
    const { data: appt, error: apptErr } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        staff_id: p.staffId,
        room_id: room?.id ?? null,
        starts_at: new Date(p.startsAtMs).toISOString(),
        ends_at: new Date(p.startsAtMs + p.durationMin * 60_000).toISOString(),
        duration_min: p.durationMin,
        total_cents: p.totalCents,
        deposit_cents: p.depositCents,
        deposit_paid: p.depositPaid,
        paid_cents: 0,
        status: redeem ? "confirmed" : "pending",
        source: "web",
        pack_purchase_id: p.isPackSession ? created.packPurchaseId : null,
        notes_internal: p.notesInternal,
      })
      .select("id")
      .single()
    if (apptErr || !appt)
      return await rollbackAll(supabase, created, clientId, refund, `No pudimos crear el turno de ${p.label}: ${apptErr?.message}`)
    created.appointmentIds.push(appt.id)

    // Se insertan TODAS las patas del turno (`item.legs.map`), no `legs[0]`:
    // un turno "juntos" tiene varias y tomar sólo la primera las haría
    // desaparecer en silencio.
    const { error: linkErr } = await supabase.from("appointment_services").insert(
      p.legs.map((l) => ({
        appointment_id: appt.id,
        service_id: l.serviceId,
        duration_min: l.durationMin,
        price_cents: l.priceCents,
        zones: l.zones,
        staff_id: l.staffId,
        starts_at: new Date(l.startsAtMs).toISOString(),
      }))
    )
    if (linkErr)
      return await rollbackAll(supabase, created, clientId, refund, `Servicios del turno de ${p.label}: ${linkErr.message}`)
  }

  // ── FASE D: avisos (best-effort, los turnos ya existen) ────────────────────
  if (hasPack && !hasServices) {
    // Pack solo → sendPackConfirmation + Calendar (una sesión por evento —
    // antes esta rama nunca los creaba; ahora se comporta igual que un pack
    // comprado mezclado con servicios) + notifyNewBooking.
    const pp = packPlan!
    try {
      await sendPackConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        packName: pp.pack.name,
        sessionsTotal: pp.pack.sessions,
        startsAtList: pp.slotDates,
        totalCents: pp.pack.totalPriceCents,
      })
    } catch {}

    await createCalendarEventsForAppointments(
      supabase,
      `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
      ordered.map((p, i) => ({
        appointmentId: created.appointmentIds[i],
        staffId: p.staffId,
        label: p.label,
        startsAtMs: p.startsAtMs,
        durationMin: p.durationMin,
      }))
    )

    try {
      await notifyNewBooking(supabase, {
        clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
        clientPhone: input.client.phone,
        servicesNames: [`${pp.pack.name} (pack · ${pp.slotDates.length} de ${pp.pack.sessions} sesiones agendadas)`],
        startsAt: pp.slotDates[0],
        durationMin: pp.appointments[0].durationMin,
        totalCents: pp.pack.totalPriceCents,
        assignedStaffIds: [pp.appointments[0].staffId],
      })
    } catch {
      // no bloqueante: el pack y sus turnos ya están confirmados.
    }
  } else if (hasServices && !hasPack) {
    // Servicios solos → lo de hoy: "separados" (Calendar por turno + mail
    // múltiple + aviso por turno) o "juntos" (un turno, un mail, un aviso).
    if (looseMode === "separados") {
      // Lo que VALEN los turnos: siempre el real, igual que en el camino
      // "juntos". `item.legs.reduce(...)` en vez de `item.legs[0]`: correcto
      // hoy (un turno "separados" tiene una sola pata), pero así no puede
      // desaparecer una pata en silencio si eso cambiara.
      const realTotal = plan.reduce(
        (a, item) => a + item.legs.reduce((la, l) => la + l.priceCents, 0), 0
      )
      // Misma función pura que usa la pantalla para mostrarle a la clienta
      // cuánto transferir: si difiriera de lo que se guardó, no coincidiría.
      const dueNow = redeem ? 0 : totalDueNowSeparate(
        plan.map((item) => item.legs.reduce((la, l) => la + l.priceCents, 0)),
        payChoice
      )

      // Google Calendar: un evento por turno (helper compartido con "pack
      // solo" y la mezcla — acá vivía duplicado línea por línea).
      await createCalendarEventsForAppointments(
        supabase,
        `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
        ordered.map((item, i) => ({
          appointmentId: created.appointmentIds[i],
          staffId: item.staffId,
          label: item.label,
          startsAtMs: item.startsAtMs,
          durationMin: item.durationMin,
        }))
      )

      // UN solo mail, con UNA sola seña.
      try {
        await sendMultiBookingConfirmation({
          to: email,
          firstName: input.client.firstName.trim(),
          items: plan.map((item) => ({ serviceName: item.label, startsAt: new Date(item.startsAtMs) })),
          totalCents: realTotal,
          dueNowCents: dueNow,
        })
      } catch {
        // ignore — la reserva ya está; el equipo puede reenviar manualmente.
      }

      // Un aviso por turno: cada uno es un turno real, en su día, con su
      // profesional. Un solo aviso con una sola fecha le mentiría a la
      // profesional asignada al segundo o al tercero.
      for (const item of plan) {
        try {
          await notifyNewBooking(supabase, {
            clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
            clientPhone: input.client.phone,
            servicesNames: [item.label],
            startsAt: new Date(item.startsAtMs),
            durationMin: item.durationMin,
            totalCents: item.totalCents,
            assignedStaffIds: [item.staffId],
          })
        } catch {
          // ignore — los turnos ya están creados
        }
      }
    } else {
      // ── Servicios "juntos" (o un solo servicio, o un combo): UN turno ──────
      const plannedAppt = plan[0]
      const apptId = created.appointmentIds[0]

      // Google Calendar event (no bloqueante)
      try {
        let staffName: string | null = null
        let staffEmail: string | null = null
        let staffColorId: string | null = null
        if (plannedAppt.staffId) {
          const { data: staffRow } = await supabase
            .from("staff")
            .select("full_name, email, calendar_color_id")
            .eq("id", plannedAppt.staffId)
            .maybeSingle()
          staffName = staffRow?.full_name ?? null
          staffEmail = staffRow?.email ?? null
          staffColorId = (staffRow as any)?.calendar_color_id ?? null
        }
        const eventId = await createCalendarEvent({
          appointmentId: apptId,
          clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
          serviceNames: services.map((s) => s.name),
          staffName,
          staffEmail,
          staffColorId,
          startsAt,
          endsAt,
          notes: null,
        })
        if (eventId) {
          await supabase
            .from("appointments")
            .update({ google_event_id: eventId })
            .eq("id", apptId)
        }
      } catch {
        // Non-fatal: el turno ya está creado
      }

      // Email de confirmación con los detalles del turno (no bloqueante).
      try {
        await sendBookingConfirmation({
          to: email,
          firstName: input.client.firstName.trim(),
          servicesNames: services.map((s) => s.name),
          startsAt,
          durationMin: totalDuration,
          totalCents,
          appointmentId: apptId,
        })
      } catch {
        // ignore — la reserva ya está; el equipo puede reenviar manualmente.
      }

      // Aviso a Leri + profesional(es) asignado(s) de la nueva reserva (no bloqueante).
      await notifyNewBooking(supabase, {
        clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
        clientPhone: input.client.phone,
        servicesNames: services.map((s) => s.name),
        startsAt,
        durationMin: totalDuration,
        totalCents,
        assignedStaffIds: [plannedAppt.staffId, ...Object.values(input.resolvedStaff ?? {})],
      })
    }
  } else {
    // ── Mezcla: un pack + servicios sueltos, en la misma reserva, con UNA
    // sola seña. UN mail nuevo con todo.
    const pp = packPlan!
    const looseItems = ordered.filter((p) => !p.isPackSession)

    try {
      await sendMixedBookingConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        packName: pp.pack.name,
        packSessionsTotal: pp.pack.sessions,
        packStartsAtList: pp.slotDates,
        services: looseItems.map((p) => ({ serviceName: p.label, startsAt: new Date(p.startsAtMs) })),
        totalCents: sumTotals(plan),
        dueNowCents: sumDeposits(plan),
      })
    } catch {
      // ignore — la reserva ya está; el equipo puede reenviar manualmente.
    }

    // Google Calendar: un evento por turno (mismo helper que "separados" y
    // "pack solo" — antes vivía duplicado acá).
    await createCalendarEventsForAppointments(
      supabase,
      `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
      ordered.map((p, i) => ({
        appointmentId: created.appointmentIds[i],
        staffId: p.staffId,
        label: p.label,
        startsAtMs: p.startsAtMs,
        durationMin: p.durationMin,
      }))
    )

    // notifyNewBooking: UN aviso agregado para el pack — mismo formato que
    // "pack solo" (nombre + precio TOTAL del pack + cuántas sesiones se
    // agendaron), nunca uno por sesión (las sesiones 2..N no tienen precio
    // propio: mandarían "$0") — más UN aviso por cada servicio suelto, con
    // SU fecha, SU duración, SU profesional y SU precio.
    try {
      await notifyNewBooking(supabase, {
        clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
        clientPhone: input.client.phone,
        servicesNames: [`${pp.pack.name} (pack · ${pp.slotDates.length} de ${pp.pack.sessions} sesiones agendadas)`],
        startsAt: pp.slotDates[0],
        durationMin: pp.appointments[0].durationMin,
        totalCents: pp.pack.totalPriceCents,
        assignedStaffIds: [pp.appointments[0].staffId],
      })
    } catch {
      // no bloqueante: el pack y sus turnos ya están confirmados.
    }

    for (const p of looseItems) {
      try {
        await notifyNewBooking(supabase, {
          clientName: `${input.client.firstName.trim()} ${input.client.lastName.trim()}`,
          clientPhone: input.client.phone,
          servicesNames: [p.label],
          startsAt: new Date(p.startsAtMs),
          durationMin: p.durationMin,
          totalCents: p.totalCents,
          assignedStaffIds: [p.staffId],
        })
      } catch {
        // ignore — los turnos ya están creados
      }
    }
  }

  // Magic link para portal — solo si:
  //   - no hay sesión activa
  //   - Y el clients row no está ya linkeado a un auth user
  // Se conserva igual, ahora al final, común a los tres caminos.
  if (!authUser && !alreadyLinked) {
    try {
      const h = await headers()
      const proto = h.get("x-forwarded-proto") ?? "http"
      const host = h.get("host")
      const origin = `${proto}://${host}`
      const plain = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      await plain.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/portal`,
          shouldCreateUser: true,
        },
      })
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    appointmentId: created.appointmentIds[0],
    appointmentIds: created.appointmentIds,
  }
}

export type SaveClientResult =
  | { ok: true; clientId: string }
  | { ok: false; error: string }

export async function saveClientEarly(data: {
  firstName: string
  lastName: string
  email: string
  phone: string
  dob: string
  marketingConsent: boolean
}): Promise<SaveClientResult> {
  const supabase = adminClient()
  const ssr = await createSsrClient()
  const { data: { user: authUser } } = await ssr.auth.getUser()

  const email = data.email.trim().toLowerCase()
  const { data: existing } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    if (authUser && !existing.user_id && authUser.email?.toLowerCase() === email) {
      await supabase.from("clients").update({ user_id: authUser.id }).eq("id", existing.id)
    }
    return { ok: true, clientId: existing.id }
  }

  const dob = parseDob(data.dob)
  const { data: created, error } = await supabase
    .from("clients")
    .insert({
      user_id: authUser && authUser.email?.toLowerCase() === email ? authUser.id : null,
      first_name: data.firstName.trim(),
      last_name: data.lastName.trim(),
      email,
      phone: data.phone.trim(),
      date_of_birth: dob,
      marketing_consent: data.marketingConsent,
      source: "web",
    })
    .select("id")
    .single()

  if (error || !created) return { ok: false, error: error?.message ?? "Error al guardar datos" }
  return { ok: true, clientId: created.id }
}

/**
 * Returns the candidate slots (from business hours) that are actually free,
 * considering existing appointments for the day and the total duration of
 * the new appointment.
 *
 * proHint === "auto"  → slot is free if at least one professional is free
 * proHint === <uuid>  → slot is free if that professional has no overlap
 */
export async function fetchDayAvailability(
  dateStr: string,
  durationMin: number,
  proHint: string,
  candidateSlots: string[],
  opts: {
    serviceId?: string | null
    excludeAppointmentId?: string
    // Un reagendado no es una reserva nueva: el turno YA existe con esa
    // profesional, aunque no esté vinculada en `staff_services` (el escape
    // hatch del admin: puede cargar a mano un servicio con quien quiera). Con
    // `true` se salta la puerta "¿hace este servicio?" — la profesional
    // pedida se valida igual por disponibilidad REAL (sus propias patas, sus
    // propias horas bloqueadas) más abajo, sin excepción.
    skipStaffServiceCheck?: boolean
  } = {}
): Promise<string[]> {
  const { serviceId = null, excludeAppointmentId, skipStaffServiceCheck = false } = opts
  if (!candidateSlots.length) return []

  const supabase = adminClient()

  // Regla estricta (sólo en los caminos públicos, que pasan `serviceId`): las
  // candidatas se acotan a quienes hacen ESE servicio (`staff_services`). Sin
  // `serviceId` (admin), el comportamiento es exactamente el de siempre.
  // Se trae la tabla ENTERA (no filtrada por servicio): hace falta para poder
  // resolver de qué servicio es una pata ANÓNIMA de un servicio distinto al
  // pedido (ver `assignableStaff`).
  // Fail-closed: si esta consulta falla, el mapa queda vacío → sin candidatas.
  const staffMap: StaffServiceMap = {}
  if (serviceId) {
    const { data: linkRows, error: linkErr } = await supabase
      .from("staff_services")
      .select("service_id, staff_id")
    if (linkErr) console.error("staff_services:", linkErr.message)
    for (const r of (linkRows ?? []) as { service_id: string; staff_id: string }[]) {
      ;(staffMap[r.service_id] ??= []).push(r.staff_id)
    }

    if (!skipStaffServiceCheck) {
      if (proHint !== "auto") {
        if (!canStaffDoService(proHint, serviceId, staffMap)) return []
      } else if (!allowedStaffFor(serviceId, staffMap).length) {
        return []
      }
    }
  }

  const [dy, dm, dd] = dateStr.split("-").map(Number)
  const dayStartMs = Date.UTC(dy, dm - 1, dd, AR_UTC_OFFSET, 0, 0)
  const dayStart = new Date(dayStartMs).toISOString()
  const dayEnd = new Date(dayStartMs + 24 * 3_600_000).toISOString()
  const dayOfWeek = new Date(dayStartMs).getUTCDay()

  let apptQuery = supabase
    .from("appointments")
    .select("id, starts_at, duration_min, staff_id, appointment_services(service_id, staff_id, starts_at, duration_min)")
    .gte("starts_at", dayStart)
    .lte("starts_at", dayEnd)
    .in("status", ["pending", "confirmed"])

  // La narrowing por staff_id sólo se conserva en el camino admin (sin
  // `serviceId`, byte-idéntico a como era). En el camino público necesitamos
  // ver TODO el día — las patas de otras profesionales y las anónimas — para
  // poder resolverlas con `assignableStaff`; se filtra en memoria más abajo.
  if (proHint !== "auto" && !serviceId) {
    apptQuery = apptQuery.eq("staff_id", proHint)
  }

  let availQuery = supabase
    .from("staff_blocked_slots")
    .select("staff_id, day_of_week, slot")
  if (proHint !== "auto") availQuery = availQuery.eq("staff_id", proHint)

  const [{ data: apptData }, { data: prosData }, { data: availData }] = await Promise.all([
    apptQuery,
    proHint === "auto" || serviceId
      ? supabase.from("staff").select("id").eq("is_professional", true).eq("active", true)
      : Promise.resolve({ data: [] as { id: string }[] }),
    availQuery,
  ])

  // El turno que se está reagendando no puede bloquearse a sí mismo: sus
  // propias patas quedan afuera del solver (ver `excludeAppointmentId`).
  const appointments = excludeAppointmentId
    ? (apptData ?? []).filter((row) => row.id !== excludeAppointmentId)
    : (apptData ?? [])

  const activePros = (prosData ?? []).map((p: { id: string }) => p.id)
  const blockedMap = buildBlockedMap((availData ?? []) as { staff_id: string; day_of_week: number; slot: string }[])
  // Sólo hace falta armar las patas por-servicio en el camino público: el
  // admin (sin `serviceId`) sigue leyendo `appointments` tal cual, como siempre.
  const legs = serviceId ? buildBusyLegs((appointments ?? []) as ApptRow[]) : []

  return candidateSlots.filter((slot) => {
    const slotStart = slotToUtcMs(dateStr, slot)
    const slotEnd   = slotStart + durationMin * 60_000

    if (proHint === "auto") {
      // Regla estricta: libre sólo si ALGUNA candidata de este servicio está
      // realmente libre (su propio horario y sus propios turnos) — no el
      // conteo genérico de más abajo, que mezclaría turnos ocupados de
      // profesionales que ni siquiera hacen este servicio.
      if (serviceId) {
        const overlappingLegs = legs.filter((l) => slotStart < l.endMs && slotEnd > l.startMs)
        // Escape hatch de reagendado (`skipStaffServiceCheck`): si el servicio
        // no tiene NINGUNA profesional cargada en `staff_services` (ej: una
        // sesión de pack sin asignar — `schedulePackSession` siempre escribe
        // `staff_id: NULL`), la regla ya no se está exigiendo acá — el turno
        // existe igual, así que cualquier activa puede tomarlo. Sin este
        // fallback, `candidates` queda vacío y ningún día ofrece horarios.
        // El fallback se dispara si el roster no tiene NINGUNA profesional
        // ACTIVA — no sólo si está vacío: un servicio cuya única profesional se
        // dio de baja dejaría `candidates` vacío y no ofrecería nunca un
        // horario. (Ojo: NO se puede condicionar a `candidates.length === 0`,
        // porque eso también taparía el caso legítimo "están todas ocupadas".)
        const allowedRoster = allowedStaffFor(serviceId, staffMap)
        const allowedBase =
          skipStaffServiceCheck && !allowedRoster.some((p) => activePros.includes(p))
            ? activePros
            : allowedRoster
        const candidates = allowedBase.filter(
          (pid) =>
            activePros.includes(pid) &&
            proWorksAtSlot(pid, dayOfWeek, slotStart, slotEnd, blockedMap) &&
            !overlappingLegs.some((l) => l.staffId === pid)
        )
        return assignableStaff(candidates, overlappingLegs, staffMap, activePros).length > 0
      }

      // Count pros actually available at this slot (day + hours)
      const availableAtSlot = activePros.filter(
        (pid) => proWorksAtSlot(pid, dayOfWeek, slotStart, slotEnd, blockedMap)
      )
      if (!availableAtSlot.length) return false

      // Count distinct busy professionals in this window
      const busyIds = new Set<string>()
      let anonymousBusy = 0
      for (const appt of (appointments ?? [])) {
        const aStart = new Date(appt.starts_at).getTime()
        const aEnd   = aStart + (appt.duration_min as number) * 60_000
        if (slotStart >= aEnd || slotEnd <= aStart) continue
        if (appt.staff_id) busyIds.add(appt.staff_id as string)
        else anonymousBusy++
      }
      return busyIds.size + anonymousBusy < availableAtSlot.length
    } else {
      if (!proWorksAtSlot(proHint, dayOfWeek, slotStart, slotEnd, blockedMap)) return false
      if (serviceId) {
        // Misma correción que arriba: una pata CON SU NOMBRE (no el turno
        // entero) es lo que realmente la ocupa; una pata ANÓNIMA de un
        // servicio que sólo ella hace también la ocupa (`assignableStaff`).
        const overlappingLegs = legs.filter((l) => slotStart < l.endMs && slotEnd > l.startMs)
        if (overlappingLegs.some((l) => l.staffId === proHint)) return false

        // El buscador (`fetchSequentialAvailability`/`checkPerm`) resolvió
        // "auto" preguntando si ALGUNA candidata del conjunto COMPLETO era
        // asignable, y devolvió a `proHint` como la elegida. Re-validar acá
        // con `assignableStaff([proHint], …)` — proHint como candidata
        // ÚNICA — es una pregunta MÁS ESTRICTA: ante una pata anónima
        // ambigua (podría ser de proHint o de otra candidata), con un solo
        // candidato `1 > pressure(=1)` da falso y se rechaza un horario que
        // el buscador acaba de ofrecer. Hay que preguntar LO MISMO que el
        // buscador: ¿proHint está ENTRE las asignables del conjunto completo?
        //
        // Escape hatch (`skipStaffServiceCheck`, reagendado de un turno
        // cargado a mano con una profesional fuera de `staff_services`): si
        // proHint no está en el roster permitido para este servicio,
        // `.includes(proHint)` la rechazaría siempre — justo lo que el
        // escape hatch existe para permitir. Ahí sí es la única candidata
        // real: se mantiene la pregunta de siempre.
        const candidates = allowedStaffFor(serviceId, staffMap).filter(
          (pid) =>
            activePros.includes(pid) &&
            proWorksAtSlot(pid, dayOfWeek, slotStart, slotEnd, blockedMap) &&
            !overlappingLegs.some((l) => l.staffId === pid)
        )
        // La guarda se hace sobre las candidatas REALES, no sobre el roster:
        // proHint puede faltar por estar fuera de `staff_services` O por estar
        // DADA DE BAJA. Si preguntáramos sólo por el roster, una profesional
        // dada de baja dejaría a sus clientas sin poder reagendar nunca más
        // ("no hay horarios", todos los días, sin explicación).
        // Acá ya sabemos que proHint trabaja a esa hora y no tiene un turno
        // propio encima (se chequeó arriba), así que si igual no está entre las
        // candidatas es por una de esas dos razones: es la única candidata real.
        if (skipStaffServiceCheck && !candidates.includes(proHint)) {
          return assignableStaff([proHint], overlappingLegs, staffMap, activePros).length > 0
        }
        return assignableStaff(candidates, overlappingLegs, staffMap, activePros).includes(proHint)
      }
      return !(appointments ?? []).some((appt) => {
        const aStart = new Date(appt.starts_at).getTime()
        const aEnd   = aStart + (appt.duration_min as number) * 60_000
        return slotStart < aEnd && slotEnd > aStart
      })
    }
  })
}

/**
 * Elige UNA profesional concreta para un slot que se reservó en "Auto".
 *
 * Usa la MISMA consulta y la MISMA función (`assignableStaff`) que
 * `fetchDayAvailability` para decidir la disponibilidad: si devuelve un nombre,
 * ese nombre está tan libre como el buscador afirmó; si devuelve `null`, nadie
 * puede — el mismo veredicto que el buscador. No pueden contradecirse.
 *
 * Desempate: la que tenga menos turnos ESE día. `preferredStaffId` (la elegida
 * en una sesión anterior del mismo pack) se prefiere si sigue disponible.
 */
async function chooseStaffForSlot(
  supabase: ReturnType<typeof adminClient>,
  args: {
    dateStr: string
    timeStr: string
    durationMin: number
    serviceId: string
    preferredStaffId?: string | null
  }
): Promise<string | null> {
  const { dateStr, timeStr, durationMin, serviceId, preferredStaffId } = args
  const slotStart = slotToUtcMs(dateStr, timeStr)
  const slotEnd = slotStart + durationMin * 60_000

  // Ventana del día (AR) para traer los turnos y contar por profesional.
  const [dy, dm, dd] = dateStr.split("-").map(Number)
  const dayStartMs = Date.UTC(dy, dm - 1, dd, AR_UTC_OFFSET, 0, 0)
  const dayStart = new Date(dayStartMs).toISOString()
  const dayEnd = new Date(dayStartMs + 24 * 3_600_000).toISOString()

  const [{ data: apptData }, { data: prosData }, { data: availData }, { data: linkRows, error: linkErr }] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("id, starts_at, duration_min, staff_id, appointment_services(service_id, staff_id, starts_at, duration_min)")
        .gte("starts_at", dayStart)
        .lte("starts_at", dayEnd)
        .in("status", ["pending", "confirmed"]),
      supabase.from("staff").select("id").eq("is_professional", true).eq("active", true),
      supabase.from("staff_blocked_slots").select("staff_id, day_of_week, slot"),
      // Tabla ENTERA (no filtrada por servicio) — igual que `fetchDayAvailability`:
      // `assignableStaff` necesita el mapa cruzado para resolver de qué servicio
      // es una pata ANÓNIMA de un servicio distinto al que se está reservando.
      supabase.from("staff_services").select("service_id, staff_id"),
    ])
  // Fail-closed: si no podemos leer quién hace el servicio, no inventamos a nadie.
  if (linkErr) return null

  const activePros = (prosData ?? []).map((p: { id: string }) => p.id)
  const blockedMap = buildBlockedMap((availData ?? []) as { staff_id: string; day_of_week: number; slot: string }[])
  const staffMap: StaffServiceMap = {}
  for (const r of (linkRows ?? []) as { service_id: string; staff_id: string }[]) {
    ;(staffMap[r.service_id] ??= []).push(r.staff_id)
  }
  const legs = buildBusyLegs((apptData ?? []) as ApptRow[])
  const overlappingLegs = legs.filter((l) => slotStart < l.endMs && slotEnd > l.startMs)

  // El día de la semana AR para `proWorksAtSlot` (mismo criterio que el buscador).
  const arDow = arPartsFromUtc(new Date(slotStart)).dayOfWeek

  const candidates = allowedStaffFor(serviceId, staffMap).filter(
    (pid) =>
      activePros.includes(pid) &&
      proWorksAtSlot(pid, arDow, slotStart, slotEnd, blockedMap) &&
      !overlappingLegs.some((l) => l.staffId === pid)
  )
  const assignable = assignableStaff(candidates, overlappingLegs, staffMap, activePros)

  // Conteo de turnos por profesional ESE día (para repartir la carga).
  const countsByStaff: Record<string, number> = {}
  for (const a of (apptData ?? []) as { staff_id: string | null }[]) {
    if (a.staff_id) countsByStaff[a.staff_id] = (countsByStaff[a.staff_id] ?? 0) + 1
  }

  return chooseStaff(assignable, countsByStaff, preferredStaffId ?? null)
}

// ─── Sequential availability ──────────────────────────────────────────────────

export type ServiceInput = { id: string; name: string; duration: number; staffId: string }

export type SlotResult = {
  date: string
  time: string
  serviceOrder: string[]
  resolvedStaff: Record<string, string>
}

export type SequentialAvailabilityResult = {
  slotsForDate: SlotResult[]
  nextAvailable: SlotResult[]
  hasSequentialToday: boolean
  individualSlotsForDate: { serviceId: string; serviceName: string; slots: string[] }[]
}

function permutations(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr.slice()]
  const result: number[][] = []
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) result.push([arr[i], ...p])
  }
  return result
}

type Appt = { starts_at: string; duration_min: number; staff_id: string | null }

// `${staffId}|${dayOfWeek}` -> conjunto de horas "HH:MM" bloqueadas (no disponible).
type BlockedMap = Map<string, Set<string>>
const SLOT_BLOCK_MIN = 60 // cada hora bloqueada cubre 60 min

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

function buildBlockedMap(
  rows: { staff_id: string; day_of_week: number; slot: string }[]
): BlockedMap {
  const m: BlockedMap = new Map()
  for (const r of rows) {
    const k = `${r.staff_id}|${r.day_of_week}`
    let set = m.get(k)
    if (!set) { set = new Set(); m.set(k, set) }
    set.add(r.slot)
  }
  return m
}

function utcMsToArTime(ms: number): string {
  const arMs = ms - AR_UTC_OFFSET * 3_600_000
  const d = new Date(arMs)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

// Un profesional puede tomar un servicio [slotStart, slotEnd) si NINGUNA hora
// bloqueada de ese día se superpone con la duración del servicio. Sin filas
// bloqueadas ese día = disponible en todo.
function proWorksAtSlot(
  staffId: string,
  dayOfWeek: number,
  slotStartMs: number,
  slotEndMs: number,
  blockedMap: BlockedMap
): boolean {
  const blocked = blockedMap.get(`${staffId}|${dayOfWeek}`)
  if (!blocked || blocked.size === 0) return true
  const s0 = hhmmToMin(utcMsToArTime(slotStartMs))
  const s1 = hhmmToMin(utcMsToArTime(slotEndMs))
  for (const bt of blocked) {
    const b0 = hhmmToMin(bt)
    const b1 = b0 + SLOT_BLOCK_MIN
    if (s0 < b1 && s1 > b0) return false // el servicio pisa una hora bloqueada
  }
  return true
}

function checkPerm(
  startMs: number,
  perm: number[],
  services: ServiceInput[],
  legs: BusyLeg[],
  allPros: string[],
  dayOfWeek: number,
  blockedMap: BlockedMap,
  staffMap: StaffServiceMap,
  enforce: boolean
): Record<string, string> | null {
  const assignment: Record<string, string> = {}
  // Tracks which professionals are concurrently busy within THIS permutation's
  // time windows. Since services run sequentially (one ends before the next starts),
  // the same professional CAN appear in multiple services — no concurrency conflict.
  // We only block concurrent overlap with EXISTING legs in `legs`.
  let ms = startMs

  for (const idx of perm) {
    const svc = services[idx]
    const sStart = ms
    const sEnd = ms + svc.duration * 60_000

    // ¿Tiene esta profesional una pata CON SU NOMBRE que pise esta ventana?
    // (No el turno entero: el turno "portador" de una cadena "juntos" sólo
    // trae el nombre de la PRIMERA profesional — cada pata tiene la suya.)
    const overlapsNamed = (pid: string) =>
      legs.some((l) => l.staffId === pid && sStart < l.endMs && sEnd > l.startMs)

    // Las candidatas de ESTE servicio: las que lo hacen (regla estricta) y
    // siguen activas (una profesional dada de baja no puede atender). Sin la
    // regla (admin), cualquiera de las activas.
    const candidates = enforce
      ? allowedStaffFor(svc.id, staffMap).filter((p) => allPros.includes(p))
      : allPros

    // Patas (de cualquier servicio) que pisan esta ventana de horario.
    const overlappingLegs = legs.filter((l) => sStart < l.endMs && sEnd > l.startMs)

    // Mismo conjunto de candidatas se use "auto" o un nombre puntual: la
    // pregunta correcta siempre es "¿está ENTRE las asignables del conjunto
    // COMPLETO?", nunca "¿sería asignable si fuera la única candidata?" — esa
    // versión más estricta puede rechazar a la profesional puntual que ESTE
    // MISMO solver ofrecería para "auto" (ver `assignableStaff`).
    const withoutNamedOverlap = candidates.filter(
      (pid) => proWorksAtSlot(pid, dayOfWeek, sStart, sEnd, blockedMap) && !overlapsNamed(pid)
    )

    // Si la clienta pidió una profesional puntual, tiene que hacer el servicio.
    if (svc.staffId !== "auto") {
      if (enforce && !canStaffDoService(svc.staffId, svc.id, staffMap)) return null
      if (!proWorksAtSlot(svc.staffId, dayOfWeek, sStart, sEnd, blockedMap) || overlapsNamed(svc.staffId))
        return null
      // Una pata ANÓNIMA de un servicio que sólo ella hace también la ocupa,
      // aunque no tenga su nombre puesto (ver `assignableStaff`).
      if (!assignableStaff(withoutNamedOverlap, overlappingLegs, staffMap, allPros).includes(svc.staffId))
        return null
      assignment[svc.id] = svc.staffId
    } else {
      // `assignableStaff` descuenta, además, a quien una pata ANÓNIMA
      // definitivamente ocupa (mismo criterio que `fetchDayAvailability`).
      const free = assignableStaff(withoutNamedOverlap, overlappingLegs, staffMap, allPros)
      if (!free.length) return null

      // Preferir a alguien ya asignada antes en esta misma cadena (ej: dos
      // masajes seguidos con la misma profesional), si sigue libre.
      const preferred = Object.values(assignment).find((pid) => free.includes(pid))
      assignment[svc.id] = preferred ?? free[0]
    }
    ms = sEnd
  }
  return assignment
}

function trySlot(
  slot: string,
  dateStr: string,
  services: ServiceInput[],
  legs: BusyLeg[],
  allPros: string[],
  dayOfWeek: number,
  blockedMap: BlockedMap,
  staffMap: StaffServiceMap,
  enforce: boolean,
  isValidOrder: (perm: number[]) => boolean = () => true
): SlotResult | null {
  const startMs = slotToUtcMs(dateStr, slot)

  for (const perm of permutations(services.map((_, i) => i))) {
    if (!isValidOrder(perm)) continue
    const assignment = checkPerm(startMs, perm, services, legs, allPros, dayOfWeek, blockedMap, staffMap, enforce)
    if (assignment) {
      return {
        date: dateStr,
        time: slot,
        serviceOrder: perm.map((i) => services[i].id),
        resolvedStaff: assignment,
      }
    }
  }
  return null
}

export async function fetchSequentialAvailability(
  services: ServiceInput[],
  fromDate: string,
  daysAhead = 30,
  opts: { enforceStaffServices?: boolean } = {}
): Promise<SequentialAvailabilityResult> {
  const enforce = opts.enforceStaffServices ?? true
  const empty: SequentialAvailabilityResult = {
    slotsForDate: [],
    nextAvailable: [],
    hasSequentialToday: false,
    individualSlotsForDate: [],
  }
  if (!services.length) return empty

  const supabase = adminClient()

  const serviceIds = services.map((s) => s.id)

  // Quién hace cada servicio (`staff_services`) — tabla ENTERA (no filtrada
  // por servicio, ~20 filas): hace falta para resolver de qué servicio es una
  // pata ANÓNIMA que puede pertenecer a un servicio DISTINTO de los pedidos
  // (ver `assignableStaff`). Se usa también para acotar candidatas cuando
  // `enforce` (público). Se trae siempre — incluso en el admin — porque
  // `checkPerm` es compartida y necesita el mapa para el conteo correcto de
  // patas anónimas/por-servicio (la ÚNICA excepción sancionada al "byte-
  // idéntico" del admin: puede ahora rechazar un horario que antes ofrecía
  // mal). Fail-closed: si esta consulta falla, el mapa queda vacío → cuando
  // `enforce`, ningún servicio tiene candidatas → no se ofrece ningún horario.
  const [bhRes, prosRes, rulesRes, availRes, orderLastRes, staffSvcRes] = await Promise.all([
    supabase.from("business_hours").select("day_of_week, is_open, slots").order("day_of_week"),
    supabase.from("staff").select("id").eq("is_professional", true).eq("active", true),
    supabase
      .from("service_order_rules")
      .select("service_first_id, service_second_id")
      .in("service_first_id", serviceIds)
      .in("service_second_id", serviceIds),
    supabase.from("staff_blocked_slots").select("staff_id, day_of_week, slot"),
    supabase.from("services").select("id, order_last").in("id", serviceIds),
    supabase.from("staff_services").select("service_id, staff_id"),
  ])

  const staffMap: StaffServiceMap = {}
  if (staffSvcRes.error) console.error("staff_services:", staffSvcRes.error.message)
  for (const r of (staffSvcRes.data ?? []) as { service_id: string; staff_id: string }[]) {
    ;(staffMap[r.service_id] ??= []).push(r.staff_id)
  }

  // Fail-open: si esta consulta falla, `orderLastIds` queda vacío y el solver
  // ofrece cadenas sin respetar "va siempre al final" (createBooking, que sí
  // relee `order_last`, puede terminar en desacuerdo con lo que se ofreció en
  // pantalla). Es la dirección correcta para no romper el flujo principal de
  // reservas si esta tabla falla, pero el error no puede quedar invisible.
  if (orderLastRes.error)
    console.error("fetchSequentialAvailability: no se pudo leer order_last", orderLastRes.error)

  const byDow = new Map(
    ((bhRes.data ?? []) as { day_of_week: number; is_open: boolean; slots: string[] }[]).map(
      (h) => [h.day_of_week, h]
    )
  )
  const allPros = ((prosRes.data ?? []) as { id: string }[]).map((p) => p.id)

  const blockedMap = buildBlockedMap((availRes.data ?? []) as { staff_id: string; day_of_week: number; slot: string }[])

  // Set of "first_id|second_id" — first must go before second
  const orderRules = new Set<string>(
    ((rulesRes.data ?? []) as { service_first_id: string; service_second_id: string }[]).map(
      (r) => `${r.service_first_id}|${r.service_second_id}`
    )
  )

  // Servicios marcados "va siempre al final" (ej: masajes). Ningún marcado
  // puede quedar ANTES de uno no marcado; entre varios marcados, el orden es
  // libre. Se combina con service_order_rules (ver más abajo).
  const orderLastIds = new Set<string>(
    ((orderLastRes.data ?? []) as { id: string; order_last: boolean }[])
      .filter((s) => s.order_last)
      .map((s) => s.id)
  )

  // Filter permutations that violate order rules
  const isValidOrder = (perm: number[]): boolean => {
    for (let i = 0; i < perm.length; i++) {
      for (let j = i + 1; j < perm.length; j++) {
        const a = services[perm[i]].id
        const b = services[perm[j]].id
        // If rule says b must come before a, this ordering is invalid
        if (orderRules.has(`${b}|${a}`)) return false
      }
    }
    // "Va siempre al final": misma regla pura que usa `createBooking` — se
    // chequea sobre TODA la cadena, no sólo el par inmediato.
    if (orderLastViolated(perm.map((i) => ({ orderLast: orderLastIds.has(services[i].id) }))))
      return false
    return true
  }

  const [fy, fm, fd] = fromDate.split("-").map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd, AR_UTC_OFFSET, 0, 0)
  const from = new Date(fromMs)
  const to = new Date(fromMs + daysAhead * 24 * 3_600_000)

  const { data: apptData } = await supabase
    .from("appointments")
    .select("id, starts_at, duration_min, staff_id, appointment_services(service_id, staff_id, starts_at, duration_min)")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .in("status", ["pending", "confirmed"])
  const allApptRows = (apptData ?? []) as ApptRow[]
  // `individualSlotsForDate` (más abajo) sigue leyendo turnos "a secas", sin
  // tocar: mismos campos que siempre, ignorando el `appointment_services` embebido.
  const allAppts = (apptData ?? []) as Appt[]

  const slotsForDate: SlotResult[] = []
  const nextAvailable: SlotResult[] = []
  const now = new Date()

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(fromDate + "T00:00:00")
    d.setDate(d.getDate() + i)
    const dateStr = ymd(d)
    const dayOfWeek = d.getDay()

    const bh = byDow.get(dayOfWeek)
    if (!bh || !bh.is_open || !bh.slots.length) continue

    const candidates = i === 0
      ? filterFutureSlots(dateStr, bh.slots, now)
      : [...bh.slots]

    const dayApptRows = allApptRows.filter((a) => a.starts_at.slice(0, 10) === dateStr)
    const dayLegs = buildBusyLegs(dayApptRows)

    for (const slot of candidates) {
      const result = trySlot(slot, dateStr, services, dayLegs, allPros, dayOfWeek, blockedMap, staffMap, enforce, isValidOrder)
      if (!result) continue
      if (i === 0) {
        slotsForDate.push(result)
      } else {
        nextAvailable.push(result)
        if (nextAvailable.length >= 5) break
      }
    }
    if (i > 0 && nextAvailable.length >= 5) break
  }

  // Individual slots per service when no sequential slots today
  const individualSlotsForDate: SequentialAvailabilityResult["individualSlotsForDate"] = []
  if (!slotsForDate.length) {
    const todayDow = new Date(fromDate + "T00:00:00").getDay()
    const todayBh = byDow.get(todayDow)
    if (todayBh?.is_open && todayBh.slots.length) {
      const candidates = filterFutureSlots(fromDate, todayBh.slots, now)
      const dayAppts = allAppts.filter((a) => a.starts_at.slice(0, 10) === fromDate)

      for (const svc of services) {
        // Las candidatas de ESTE servicio (regla estricta) y activas, o
        // cualquiera de las activas si no se aplica la regla (admin) —
        // mismo criterio que en checkPerm.
        const proCandidates = enforce
          ? allowedStaffFor(svc.id, staffMap).filter((p) => allPros.includes(p))
          : allPros

        // Si pidió una profesional puntual que no hace este servicio, no hay horarios.
        if (svc.staffId !== "auto" && enforce && !canStaffDoService(svc.staffId, svc.id, staffMap)) {
          individualSlotsForDate.push({ serviceId: svc.id, serviceName: svc.name, slots: [] })
          continue
        }

        const slots = candidates.filter((slot) => {
          const sStart = slotToUtcMs(fromDate, slot)
          const sEnd = sStart + svc.duration * 60_000
          if (svc.staffId === "auto") {
            // Available if at least one CANDIDATE pro is free AND available today
            return proCandidates.some(
              (pid) =>
                proWorksAtSlot(pid, todayDow, sStart, sEnd, blockedMap) &&
                !dayAppts.some((a) => {
                  if (a.staff_id !== pid) return false
                  const aS = new Date(a.starts_at).getTime()
                  return sStart < aS + a.duration_min * 60_000 && sEnd > aS
                })
            )
          }
          if (!proWorksAtSlot(svc.staffId, todayDow, sStart, sEnd, blockedMap)) return false
          return !dayAppts.some((a) => {
            if (a.staff_id !== svc.staffId) return false
            const aS = new Date(a.starts_at).getTime()
            return sStart < aS + a.duration_min * 60_000 && sEnd > aS
          })
        })
        individualSlotsForDate.push({ serviceId: svc.id, serviceName: svc.name, slots })
      }
    }
  }

  return { slotsForDate, nextAvailable, hasSequentialToday: slotsForDate.length > 0, individualSlotsForDate }
}

export async function joinWaitlist(data: {
  name: string
  email: string
  phone: string
  serviceNames: string[]
  preferredDates?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!data.name.trim() || !data.email.trim() || !data.phone.trim()) {
    return { ok: false, error: "Nombre, email y teléfono son obligatorios." }
  }
  const supabase = adminClient()
  const { error } = await supabase.from("waitlist_entries").insert({
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    phone: data.phone.trim(),
    service_names: data.serviceNames,
    preferred_dates: data.preferredDates?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Parses "DD / MM / AAAA" or "DD/MM/YYYY" or ISO; returns ISO date or null.
function parseDob(raw: string): string | null {
  const cleaned = raw.replace(/\s/g, "")
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10)
  return null
}
