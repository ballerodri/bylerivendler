/**
 * Reglas de las sesiones de un pack. Lógica PURA (sin servidor) para poder
 * testearla y usar la MISMA regla en la pantalla y en el servidor.
 */

import { amountDueNow, type PayChoice } from "./payments"

const DAY_MS = 24 * 60 * 60 * 1000

// Argentina es UTC-3 fijo (sin horario de verano desde 2008). Espeja el
// AR_UTC_OFFSET de src/app/reserva/data.ts; se repite acá para que este módulo
// quede sin dependencias y sea testeable.
const AR_UTC_OFFSET_HOURS = 3

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Desde cuándo puede empezar la sesión siguiente a una que empieza en `prevStartsAt`. */
export function minStartForNextSession(prevStartsAt: Date, intervalDays: number | null): Date {
  const days = intervalDays && intervalDays > 0 ? intervalDays : 0
  return new Date(prevStartsAt.getTime() + days * DAY_MS)
}

export type PackSlotsValidation = { ok: true } | { ok: false; error: string }

/**
 * Valida las fechas elegidas para un pack:
 *  - al menos 1 (la 1ª sesión es obligatoria; el resto se puede agendar después)
 *  - no más que las sesiones del pack
 *  - estrictamente crecientes
 *  - respetando el intervalo del pack, si tiene
 */
export function validatePackSlots(
  slots: Date[],
  opts: { sessionsTotal: number; intervalDays: number | null }
): PackSlotsValidation {
  if (slots.length === 0)
    return { ok: false, error: "Elegí al menos la fecha de la primera sesión." }
  if (slots.length > opts.sessionsTotal)
    return { ok: false, error: `Este pack tiene ${opts.sessionsTotal} sesiones.` }

  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1]
    const cur = slots[i]
    if (cur.getTime() <= prev.getTime())
      return { ok: false, error: "Las sesiones tienen que ir en orden." }
    if (cur.getTime() < minStartForNextSession(prev, opts.intervalDays).getTime())
      return {
        ok: false,
        error: `Entre sesiones tienen que pasar al menos ${opts.intervalDays} días.`,
      }
  }
  return { ok: true }
}

export type PackSessionPrice = { totalCents: number; depositCents: number; depositPaid: boolean }

/**
 * Reparte el precio del pack entre sus turnos: la 1ª sesión lleva el precio
 * completo y las demás van en 0 (ya vienen pagadas por el pack). Así el pack se
 * cuenta UNA sola vez en facturación/estadísticas.
 *
 * `payChoice` define cuánto se le pide pagar AHORA por la 1ª sesión: la seña
 * (30%) o el total del pack.
 *
 * ⚠️ LLAMAR UNA SOLA VEZ POR COMPRA, al crear el pack. Una acción que agende las
 * sesiones RESTANTES de un pack ya existente NO debe llamarla: el índice 0
 * pondría el precio completo del pack en una sesión posterior y lo cobraría dos
 * veces.
 */
export function packSessionPrices(
  totalPriceCents: number,
  count: number,
  payChoice: PayChoice = "deposit"
): PackSessionPrice[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? {
          totalCents: totalPriceCents,
          depositCents: amountDueNow(totalPriceCents, payChoice),
          depositPaid: false,
        }
      : { totalCents: 0, depositCents: 0, depositPaid: true }
  )
}

/**
 * Pasa un instante (Date, UTC) a la fecha/hora local de Argentina, en el mismo
 * formato en que se guardan los slots del negocio ("2026-07-20", "14:00").
 */
export function arPartsFromUtc(d: Date): { dateStr: string; timeStr: string; dayOfWeek: number } {
  const ar = new Date(d.getTime() - AR_UTC_OFFSET_HOURS * 3_600_000)
  return {
    dateStr: `${ar.getUTCFullYear()}-${pad2(ar.getUTCMonth() + 1)}-${pad2(ar.getUTCDate())}`,
    timeStr: `${pad2(ar.getUTCHours())}:${pad2(ar.getUTCMinutes())}`,
    dayOfWeek: ar.getUTCDay(),
  }
}
