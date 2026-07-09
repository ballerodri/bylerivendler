# Precio propio por zona Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada zona de un servicio "por zona" puede tener precio propio opcional; si no lo tiene, usa el precio general del servicio. Total del turno = suma del precio efectivo de las zonas elegidas.

**Architecture:** Se agrega `service_zones.price_cents` (nullable). El helper puro `computeZonePricing` pasa a sumar `(zona.priceCents ?? fallback)` y el snapshot guarda lo cobrado por zona. Los tres puntos de cálculo del servidor (createBooking normal, rama pack, createAdminBooking) arman `Zone` con el precio propio. Las dos UIs de reserva muestran el precio efectivo junto a cada zona y suman igual que el servidor.

**Tech Stack:** Next.js 16.2.4, React 19, Supabase, TypeScript, Zod, Vitest.

## Global Constraints

- **Unidades:** servidor y admin trabajan en **centavos**; el catálogo del cliente (`reserva/data.ts`) trabaja en **pesos** (`Math.round(cents/100)`). Respetar la convención de cada archivo.
- Zona sin precio propio (`null`) = usa `services.price_cents` (el general). Comportamiento actual intacto para datos existentes.
- El precio de un turno se calcula **en el servidor**; la UI solo muestra/estima con la misma fórmula.
- Packs: `total_price_cents` del pack manda; sin cambios funcionales.
- Migración aditiva/idempotente; se aplica sola por CI al mergear.
- Spec: `docs/superpowers/specs/2026-07-09-precio-por-zona-design.md`.
- NOTA de secuencia: la Task 2 cambia el tipo `Zone` (campo nuevo requerido) → `tsc` fallará en `src/app/reserva/actions.ts` y `src/app/admin/actions.ts` hasta completar las Tasks 5 y 6. Cada task indica qué errores son esperados en su checkpoint.

---

### Task 1: Migración — `service_zones.price_cents`

**Files:**
- Create: `supabase/migrations/20260709000000_precio_por_zona.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- Precio propio opcional por zona. Null = usa el precio general del servicio
-- (services.price_cents). En centavos.
alter table public.service_zones
  add column if not exists price_cents int check (price_cents is null or price_cents >= 0);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260709000000_precio_por_zona.sql
git commit -m "feat(db): service_zones.price_cents (precio propio opcional por zona)"
```

---

### Task 2: Helper puro — precio efectivo por zona (TDD)

**Files:**
- Modify: `src/lib/servicios/zones.ts`
- Test: `src/lib/servicios/zones.test.ts`

**Interfaces:**
- Produces: `Zone` gana `priceCents: number | null`; `ZoneSnapshot` gana `price_cents: number`; `computeZonePricing(selectedZones, fallbackPriceCents)` suma `(z.priceCents ?? fallback)`.

- [ ] **Step 1: Actualizar los tests (RED)** — reemplazar `src/lib/servicios/zones.test.ts` completo por:

```ts
import { describe, it, expect } from "vitest"
import { computeZonePricing, resolveSelectedZones, type Zone } from "./zones"

const ZONES: Zone[] = [
  { id: "a", name: "Abdomen", durationMin: 30, priceCents: null },
  { id: "b", name: "Piernas", durationMin: 45, priceCents: 3_500_000 },
  { id: "c", name: "Brazos", durationMin: 20, priceCents: null },
]

describe("computeZonePricing", () => {
  it("zona sin precio propio usa el general (fallback)", () => {
    const r = computeZonePricing([ZONES[0], ZONES[2]], 2_500_000)
    expect(r.priceCents).toBe(5_000_000)
    expect(r.durationMin).toBe(50)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30, price_cents: 2_500_000 },
      { name: "Brazos", duration_min: 20, price_cents: 2_500_000 },
    ])
  })

  it("zona con precio propio lo usa; mezcla suma ambos", () => {
    const r = computeZonePricing([ZONES[0], ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(6_000_000) // 2.5M general + 3.5M propio
    expect(r.durationMin).toBe(75)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30, price_cents: 2_500_000 },
      { name: "Piernas", duration_min: 45, price_cents: 3_500_000 },
    ])
  })

  it("solo zonas con precio propio", () => {
    const r = computeZonePricing([ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(3_500_000)
  })

  it("sin zonas → 0", () => {
    const r = computeZonePricing([], 2_500_000)
    expect(r.priceCents).toBe(0)
    expect(r.durationMin).toBe(0)
    expect(r.zones).toEqual([])
  })
})

describe("resolveSelectedZones", () => {
  it("resuelve IDs válidos preservando el orden pedido", () => {
    const r = resolveSelectedZones(["b", "a"], ZONES)
    expect(r).toEqual([ZONES[1], ZONES[0]])
  })

  it("ID inexistente → null", () => {
    expect(resolveSelectedZones(["a", "zzz"], ZONES)).toBeNull()
  })

  it("selección vacía → null", () => {
    expect(resolveSelectedZones([], ZONES)).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y ver fallar** — `npx vitest run src/lib/servicios/zones.test.ts` → FAIL (tipos/asserts).

- [ ] **Step 3: Implementar** — reemplazar en `src/lib/servicios/zones.ts`:

```ts
export type Zone = { id: string; name: string; durationMin: number; priceCents: number | null }
export type ZoneSnapshot = { name: string; duration_min: number; price_cents: number }
export type ZonePricing = { priceCents: number; durationMin: number; zones: ZoneSnapshot[] }

/**
 * Precio y duración de las zonas elegidas. Cada zona cobra su precio propio
 * (priceCents) o, si no tiene, el precio general del servicio (fallback).
 * El snapshot registra lo efectivamente cobrado por zona.
 */
export function computeZonePricing(
  selectedZones: Zone[],
  fallbackPriceCents: number
): ZonePricing {
  const zones = selectedZones.map((z) => ({
    name: z.name,
    duration_min: z.durationMin,
    price_cents: z.priceCents ?? fallbackPriceCents,
  }))
  return {
    priceCents: zones.reduce((a, z) => a + z.price_cents, 0),
    durationMin: selectedZones.reduce((a, z) => a + z.durationMin, 0),
    zones,
  }
}
```

(`resolveSelectedZones` queda igual.)

- [ ] **Step 4: Verificar** — `npx vitest run` → suite verde (los 7 de zones + resto). `npx tsc --noEmit` → errores esperados SOLO en `src/app/reserva/actions.ts` y `src/app/admin/actions.ts` (los `Zone` sin `priceCents`; se cierran en Tasks 5-6).

- [ ] **Step 5: Commit** — `feat: computeZonePricing con precio propio por zona (fallback al general)`

---

### Task 3: Admin — alta/edición de servicio con precio por zona

**Files:**
- Modify: `src/app/admin/actions.ts` (`ZoneInput` + `syncServiceZones`)
- Modify: `src/app/admin/servicios/nuevo/new-service-form.tsx`
- Modify: `src/app/admin/servicios/[id]/page.tsx`
- Modify: `src/app/admin/servicios/[id]/service-editor.tsx`

**Interfaces:**
- Produces: las zonas del form viajan como `{ name, duration_min, price_cents: number | null }`.

- [ ] **Step 1: `admin/actions.ts`** — en `ZoneInput` agregar `price_cents: z.number().int().nonnegative().nullable(),`. En `syncServiceZones`, el map de `rows` agrega `price_cents: z.price_cents,`. Nada más en este archivo (Task 6 toca `createAdminBooking`).

- [ ] **Step 2: Forms** — en AMBOS (`new-service-form.tsx` y `service-editor.tsx`):
  - El estado de zonas pasa a `{ name: string; duration_min: number; price_cents: number | null }[]` (en el editor, `initialZones` ya vendrá con el campo desde el Step 3).
  - Rotular el precio general: `"Precio por zona (general, en pesos)"` (la rama per_zone del ternario del label).
  - En `ZonesEditor` (en ambos archivos): `add()` crea `{ name: "", duration_min: 30, price_cents: null }`, el tipo del prop se actualiza, y entre el input de minutos y el botón ✕ se agrega el precio opcional:

```tsx
            <input
              className="adm-input"
              type="number"
              min={0}
              step={500}
              style={{ width: 110 }}
              placeholder="= general"
              value={z.price_cents != null ? Math.round(z.price_cents / 100) : ""}
              onChange={(e) =>
                update(i, {
                  price_cents:
                    e.target.value.trim() === ""
                      ? null
                      : Math.round((parseFloat(e.target.value) || 0) * 100),
                })
              }
            />
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>$</span>
```

  - Actualizar el rótulo de la lista: `"Zonas (nombre + minutos + precio opcional)"`.

- [ ] **Step 3: `servicios/[id]/page.tsx`** — el select de zonas agrega `price_cents` (`.select("name, duration_min, price_cents, order_index")`) y el map de `initialZones` agrega `price_cents: z.price_cents ?? null,` (ajustar el tipo del row).

- [ ] **Step 4: Verificar** — `npx tsc --noEmit`: errores esperados SOLO en `reserva/actions.ts` y `admin/actions.ts` por `Zone` (Tasks 5-6); NINGUNO en los forms/página. `npx eslint src/app/admin/servicios src/app/admin/actions.ts` → sin errores nuevos.

- [ ] **Step 5: Commit** — `feat(admin): precio propio opcional por zona en alta/edición de servicio`

---

### Task 4: Reserva — catálogo y UI muestran precio por zona

**Files:**
- Modify: `src/app/reserva/data.ts` (`ServiceZone`)
- Modify: `src/app/reserva/queries.ts` (`fetchCatalog` + `fetchReservaPacks`)
- Modify: `src/app/reserva/screens.tsx` (`effectiveService` + etiqueta de zona)

**Interfaces:**
- Produces: `ServiceZone` gana `price: number | null` (**pesos**).

- [ ] **Step 1: `data.ts`** — `ServiceZone` queda:

```ts
export type ServiceZone = {
  id: string
  name: string
  durationMin: number
  price: number | null   // precio propio en pesos; null = usa el general del servicio
}
```

- [ ] **Step 2: `queries.ts`** — en `DbServiceRow.service_zones` y en `DbReservaPackRow.service.service_zones` agregar `price_cents: number | null`; en los DOS selects anidados de `service_zones(...)` agregar `price_cents`; en los DOS maps de zonas agregar:

```ts
          price: z.price_cents != null ? Math.round(z.price_cents / 100) : null,
```

- [ ] **Step 3: `screens.tsx`** — en `effectiveService` (helper a nivel módulo), la rama per_zone reemplaza `price: chosen.length * s.price` por:

```ts
      price: chosen.reduce((a, z) => a + (z.price ?? s.price), 0),
```

  Y en el checkbox de zona del selector (Screen1), la etiqueta pasa de `{z.name} · {z.durationMin} min` a:

```tsx
        <span>{z.name} · {z.durationMin} min · {fmtPrice(z.price ?? s.price)}</span>
```

  (Las zonas dentro de `PackList` quedan SIN precio — el pack cobra su bundle.)

- [ ] **Step 4: Verificar** — `npx tsc --noEmit`: errores esperados solo en `reserva/actions.ts` y `admin/actions.ts`. `npx eslint src/app/reserva` sin errores nuevos.

- [ ] **Step 5: Commit** — `feat(reserva): precio efectivo por zona en catálogo y selector`

---

### Task 5: Reserva servidor — cálculo con precio propio

**Files:**
- Modify: `src/app/reserva/actions.ts`

**Interfaces:**
- Consumes: `Zone.priceCents`, `computeZonePricing(selected, fallback)` de Task 2.

- [ ] **Step 1: turno normal** — en el fetch de zonas del flujo normal, el select agrega `price_cents` (`.select("id, service_id, name, duration_min, price_cents")`) y el push arma:

```ts
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null })
```

  La llamada `computeZonePricing(selected, s.price_cents)` queda igual (el fallback ya es el general).

- [ ] **Step 2: rama pack** — mismo cambio en el select de zonas del pack (`.select("id, name, duration_min, price_cents")`) y en el map de `avail`:

```ts
      const avail: Zone[] = (zoneRows ?? []).map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min, priceCents: z.price_cents ?? null }))
```

  El precio del pack NO cambia (sigue `pack.total_price_cents`); el snapshot de zonas queda informativo.

- [ ] **Step 3: Verificar** — `npx tsc --noEmit`: error esperado SOLO en `admin/actions.ts` (Task 6). `npx eslint src/app/reserva/actions.ts` sin errores nuevos.

- [ ] **Step 4: Commit** — `feat(reserva): servidor cobra el precio propio de cada zona (fallback al general)`

---

### Task 6: Admin "Nueva reserva" — servidor + UI

**Files:**
- Modify: `src/app/admin/actions.ts` (`createAdminBooking`)
- Modify: `src/app/admin/nueva-reserva/page.tsx`
- Modify: `src/app/admin/nueva-reserva/nueva-reserva-form.tsx`

- [ ] **Step 1: `createAdminBooking`** — el select de zonas agrega `price_cents` y el push arma `{ id, name, durationMin: z.duration_min, priceCents: z.price_cents ?? null }` (igual que Task 5).

- [ ] **Step 2: `page.tsx`** — `ServiceOption.zones` gana `priceCents: number | null`; el select anidado `service_zones(...)` agrega `price_cents`; el map de zonas agrega `priceCents: z.price_cents ?? null,` (ajustar el tipo intermedio).

- [ ] **Step 3: `nueva-reserva-form.tsx`** — en `effective()`, la rama per_zone reemplaza `priceCents: chosen.length * s.price_cents` por:

```ts
    priceCents: chosen.reduce((a, z) => a + (z.priceCents ?? s.price_cents), 0),
```

  Y la etiqueta de zona agrega el precio: `{z.name} · {z.durationMin} min · {fmtPrice((z.priceCents ?? s.price_cents) / 100)}`.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` → **0 en todo el proyecto**. `npx eslint src/app/admin` sin errores nuevos. `npx next build` OK.

- [ ] **Step 5: Commit** — `feat(admin): Nueva reserva con precio propio por zona`

---

### Task 7: Verificación end-to-end

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build` — suite verde (7 tests de zones), 0 tipos, sin lint nuevos, build OK.
- [ ] **Step 2 (smoke manual, usuaria):** editar el servicio por zona → ponerle precio propio a UNA zona → en la reserva esa zona muestra su precio y las otras el general; el total suma bien; crear turno y verificar `total_cents` y el snapshot `zones` con `price_cents` por zona.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-09-precio-por-zona-design.md`
- Fase 1 (contexto): `docs/superpowers/specs/2026-07-01-servicio-por-zona-design.md`
