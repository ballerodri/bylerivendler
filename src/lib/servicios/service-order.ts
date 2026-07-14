/**
 * Regla "va siempre al final" (`services.order_last`): un servicio marcado
 * (ej: masajes) no puede terminar ANTES que uno sin marcar, dentro de la
 * misma cadena "juntos" (varios servicios encadenados el mismo turno). Entre
 * marcados el orden es libre; entre no marcados también. Lógica PURA (sin
 * servidor) para poder testearla y usar la MISMA regla en el solver de
 * disponibilidad y al crear el turno — una sola fuente de verdad.
 */

export type OrderLastItem = { orderLast: boolean }

/**
 * true si algún ítem marcado "va al final" precede a uno SIN marcar, en
 * cualquier posición de la cadena (no sólo el par inmediato siguiente).
 */
export function orderLastViolated(items: OrderLastItem[]): boolean {
  for (let i = 0; i < items.length; i++) {
    if (!items[i].orderLast) continue
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].orderLast) return true
    }
  }
  return false
}

/**
 * Reordenamiento estable: los NO marcados primero (en su orden relativo de
 * entrada), después los marcados (en su orden relativo de entrada). Con
 * `order_last` siempre en `false` (hoy en producción) esto es la identidad.
 * No muta `items`.
 */
export function sortOrderLast<T extends OrderLastItem>(items: T[]): T[] {
  return [...items.filter((i) => !i.orderLast), ...items.filter((i) => i.orderLast)]
}
