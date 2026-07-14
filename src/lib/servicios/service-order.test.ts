import { describe, it, expect } from "vitest"
import { orderLastViolated, sortOrderLast, type OrderLastItem } from "./service-order"

type Item = OrderLastItem & { id: string }

function item(id: string, orderLast: boolean): Item {
  return { id, orderLast }
}

describe("orderLastViolated", () => {
  it("nada marcado -> sin violación (no-op: el camino de hoy, con order_last siempre false, protege el ingreso principal)", () => {
    const items = [item("a", false), item("b", false), item("c", false)]
    expect(orderLastViolated(items)).toBe(false)
  })

  it("un marcado, ya al final -> sin violación", () => {
    const items = [item("a", false), item("b", false), item("masaje", true)]
    expect(orderLastViolated(items)).toBe(false)
  })

  it("un marcado primero, con uno sin marcar después -> violación", () => {
    const items = [item("masaje", true), item("a", false)]
    expect(orderLastViolated(items)).toBe(true)
  })

  it("todos marcados -> sin violación (el orden entre ellos es libre)", () => {
    const items = [item("a", true), item("b", true), item("c", true)]
    expect(orderLastViolated(items)).toBe(false)
  })

  it("un solo ítem -> sin violación, marcado o no", () => {
    expect(orderLastViolated([item("a", true)])).toBe(false)
    expect(orderLastViolated([item("a", false)])).toBe(false)
  })

  it("lista vacía -> sin violación", () => {
    expect(orderLastViolated([])).toBe(false)
  })

  it("dos marcados intercalados con no marcados -> violación", () => {
    const items = [item("masaje1", true), item("a", false), item("masaje2", true)]
    expect(orderLastViolated(items)).toBe(true)
  })
})

describe("sortOrderLast", () => {
  it("nada marcado -> el orden es la identidad (no-op: protege el camino principal de facturación)", () => {
    const items = [item("a", false), item("b", false), item("c", false)]
    expect(sortOrderLast(items)).toEqual(items)
  })

  it("un marcado, ya al final -> identidad", () => {
    const items = [item("a", false), item("b", false), item("masaje", true)]
    expect(sortOrderLast(items)).toEqual(items)
  })

  it("un marcado primero, con uno sin marcar después -> se mueve al final", () => {
    const items = [item("masaje", true), item("a", false), item("b", false)]
    expect(sortOrderLast(items)).toEqual([item("a", false), item("b", false), item("masaje", true)])
  })

  it("todos marcados -> identidad (orden libre = el de entrada)", () => {
    const items = [item("a", true), item("b", true), item("c", true)]
    expect(sortOrderLast(items)).toEqual(items)
  })

  it("un solo ítem -> identidad", () => {
    expect(sortOrderLast([item("a", true)])).toEqual([item("a", true)])
  })

  it("lista vacía -> lista vacía", () => {
    expect(sortOrderLast([])).toEqual([])
  })

  it("dos marcados entre no marcados -> ambos se mueven al final, conservando su orden relativo", () => {
    const items = [item("masaje1", true), item("a", false), item("masaje2", true), item("b", false)]
    expect(sortOrderLast(items)).toEqual([
      item("a", false),
      item("b", false),
      item("masaje1", true),
      item("masaje2", true),
    ])
  })

  it("no muta el array de entrada", () => {
    const items = [item("masaje", true), item("a", false)]
    const copy = items.map((i) => ({ ...i }))
    sortOrderLast(items)
    expect(items).toEqual(copy)
  })
})
