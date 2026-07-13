import { fmtPrice } from "@/app/reserva/data"
import { paymentSummary } from "@/lib/servicios/payments"

/**
 * Estados en los que un turno todavía se puede cobrar. Fuera de esta lista
 * (completed/cancelled/no_show) "no hay nada registrado" no significa "no
 * pagó" — sólo que el cobro nunca se cargó (o, para turnos viejos, que esta
 * función no existía todavía). Por eso el rojo se reserva para lo cobrable.
 */
const COLLECTABLE = new Set(["pending", "confirmed", "in_progress"])

/**
 * Badge de estado de cobro para una fila de turno. Un turno en $0 (sesión de
 * pack / canje con puntos) no muestra nada: no hay nada que cobrar.
 */
export default function PaidBadge({
  paidCents,
  totalCents,
  status,
}: {
  paidCents: number
  totalCents: number
  status: string
}) {
  if (totalCents <= 0) return null
  const p = paymentSummary(paidCents, totalCents)
  const collectable = COLLECTABLE.has(status)

  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 12,
        color: p.isPaidInFull ? "#4d6b3e" : p.isUnpaid && collectable ? "#8c463c" : "var(--ink-mute)",
      }}
    >
      {p.isPaidInFull
        ? "· Pagado ✓"
        : `· Pagado ${fmtPrice(p.paidCents / 100)} de ${fmtPrice(p.totalCents / 100)}`}
    </span>
  )
}
