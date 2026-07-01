# Packs por zona + selección en reserva (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir packs (varias sesiones a precio promo) para servicios "por zona" (ej. Vela Slim "2 zonas × 4 sesiones = $160.000") y que esos packs se puedan **elegir en la reserva online**: la clienta elige las zonas, agenda la 1ª sesión y paga **seña del 30% del pack**.

**Architecture:** Se agrega `packs.zones_count` (cuántas zonas cubre cada sesión, sólo para servicios por zona) y `packs.visible_reserva` (si aparece en la reserva). El alta del pack calcula el ahorro con una fórmula por zona. En la reserva, elegir un pack es **excluyente** (como un combo): al confirmar, el servidor crea una `pack_purchase` y un **primer turno "portador"** que lleva el precio del pack y la seña 30%, con `pack_purchase_id` seteado. Las sesiones 2..N las agenda el admin (mecánica de packs existente: se descuenta al completar).

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, Supabase (Postgres + RLS), TypeScript, Zod, Vitest.

## Global Constraints

- **Fase 1 ya está en producción** (servicios por zona): existen `services.pricing_mode`, tabla `service_zones`, `appointment_services.zones jsonb`, el helper `src/lib/servicios/zones.ts` (`computeZonePricing`, `resolveSelectedZones`, `Zone`, `ZoneSnapshot`), y `createBooking`/`createAdminBooking` ya calculan por zona.
- **Migraciones:** se aplican solas por CI (`db-migrate.yml`) al mergear a `main`; nombre con versión única `YYYYMMDDHHMMSS_...`. La usuaria puede correr el SQL a mano en Supabase (idempotente).
- **Plata en centavos** (int). `packs.total_price_cents` = precio del pack completo; `services.price_cents` para un servicio `per_zone` = precio de **una** zona.
- **Selección excluyente en la reserva:** una reserva es *servicios sueltos* **o** *un combo* **o** *un pack* (nunca dos a la vez).
- **Pack por zona:** al reservarlo se eligen **exactamente `zones_count`** zonas. Pack de servicio fijo: sin zonas, duración = `service.duration_min`.
- **Seña = 30%** del precio del pack; el primer turno "portador" lleva `total_cents = pack.total_price_cents`. Las sesiones siguientes las agenda el admin (no se re-cobran) y se descuentan al **completar** (mecánica existente en `updateAppointmentStatus`).
- **Nunca** confiar en precio/duración del navegador: recalcular en el servidor.
- **RLS:** `packs` ya tiene `select using (true)` + escritura `is_staff()`. No agregar policies nuevas.
- Tests de lógica pura con Vitest (`src/**/*.test.ts`, node); módulos con `import "server-only"` no se testean.

---

### Task 1: Migración — `packs.zones_count` + `packs.visible_reserva`

**Files:**
- Create: `supabase/migrations/20260701010000_packs_por_zona.sql`

**Interfaces:**
- Produces: columnas `packs.zones_count int null` y `packs.visible_reserva boolean not null default false`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Packs para servicios "por zona" + packs elegibles en la reserva online.

-- Cuántas zonas cubre cada sesión del pack (solo packs de servicios per_zone).
alter table public.packs
  add column if not exists zones_count int check (zones_count is null or zones_count > 0);

-- Si el pack se puede elegir en la reserva online.
alter table public.packs
  add column if not exists visible_reserva boolean not null default false;
```

- [ ] **Step 2: Verificar sintaxis**

Revisar el archivo. Si hay Supabase CLI local, `npx supabase db reset` (solo local). Si no, valida el CI al mergear. Ambas sentencias son idempotentes (`add column if not exists`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260701010000_packs_por_zona.sql
git commit -m "feat(db): packs.zones_count + packs.visible_reserva"
```

---

### Task 2: Helper puro — precio de referencia del pack (TDD)

**Files:**
- Create: `src/lib/servicios/pack-pricing.ts`
- Test: `src/lib/servicios/pack-pricing.test.ts`

**Interfaces:**
- Produces: `packReferenceCents(unitPriceCents: number, sessions: number, zonesCount: number | null): number` — precio "por separado" de referencia. Para packs de servicio fijo `zonesCount` es `null` → `unitPriceCents × sessions`. Para per_zone → `unitPriceCents × zonesCount × sessions`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest"
import { packReferenceCents } from "./pack-pricing"

describe("packReferenceCents", () => {
  it("servicio fijo (zonesCount null): precio × sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, null)).toBe(10_000_000)
  })

  it("servicio por zona: precio/zona × zonas × sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, 2)).toBe(20_000_000)
  })

  it("una zona × 4 sesiones", () => {
    expect(packReferenceCents(2_500_000, 4, 1)).toBe(10_000_000)
  })

  it("zonesCount 0 se trata como servicio fijo (defensivo)", () => {
    expect(packReferenceCents(2_500_000, 4, 0)).toBe(10_000_000)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/lib/servicios/pack-pricing.test.ts`
Expected: FAIL — "Failed to resolve import './pack-pricing'".

- [ ] **Step 3: Implementar**

```ts
/**
 * Precio "por separado" de referencia de un pack, para mostrar el ahorro.
 * Servicio fijo → unitPrice × sessions. Servicio por zona → unitPrice (precio
 * por zona) × zonesCount × sessions. zonesCount null/0 se trata como fijo.
 */
export function packReferenceCents(
  unitPriceCents: number,
  sessions: number,
  zonesCount: number | null
): number {
  const zones = zonesCount && zonesCount > 0 ? zonesCount : 1
  return unitPriceCents * zones * sessions
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/lib/servicios/pack-pricing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/pack-pricing.ts src/lib/servicios/pack-pricing.test.ts
git commit -m "feat: helper de precio de referencia de packs (por zona)"
```

---

### Task 3: Acciones de packs — persistir `zones_count` + `visible_reserva`

**Files:**
- Modify: `src/app/admin/packs/actions.ts` (`PackInput` ~8-15, `row()` ~34-43)

**Interfaces:**
- Produces: `PackInput` gana `zonesCount: number | null` y `visibleReserva: boolean`; `createPack`/`updatePack` los guardan.

- [ ] **Step 1: Extender `PackInput` y `row()`**

Reemplazar el tipo `PackInput` (líneas ~8-15) por:

```ts
export type PackInput = {
  serviceId: string
  name: string
  description?: string
  sessions: number
  intervalDays?: number | null
  totalPriceCents: number
  zonesCount: number | null
  visibleReserva: boolean
}
```

Reemplazar `row()` (líneas ~34-43) por:

```ts
function row(input: PackInput) {
  return {
    service_id: input.serviceId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sessions: input.sessions,
    interval_days: input.intervalDays ?? null,
    total_price_cents: input.totalPriceCents,
    zones_count: input.zonesCount,
    visible_reserva: input.visibleReserva,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: error esperado en `pack-form.tsx` (no manda todavía los campos nuevos; se arregla en Task 4). Ninguno en `actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/packs/actions.ts
git commit -m "feat(admin): packs actions persisten zones_count + visible_reserva"
```

---

### Task 4: Form de pack + páginas — zonas por sesión, visible en reserva, ahorro por zona

**Files:**
- Modify: `src/app/admin/packs/pack-form.tsx`
- Modify: `src/app/admin/packs/nuevo/page.tsx` (`DbService` ~8-13, select ~21-31)
- Modify: `src/app/admin/packs/[id]/page.tsx` (`DbService` ~8-13, select ~35-40, `initial` ~57-65)

**Interfaces:**
- Consumes: `packReferenceCents` (Task 2); `createPack`/`updatePack` con `zonesCount`/`visibleReserva` (Task 3).
- Produces: `ServiceOption` gana `pricing_mode: "fixed" | "per_zone"`; el form maneja `zonesCount`/`visibleReserva`.

- [ ] **Step 1: `pack-form.tsx` — tipo + imports + estado**

Cambiar el import (línea ~6) y agregar el helper:

```tsx
import { fmtPrice } from "../../reserva/data"
import { packReferenceCents } from "@/lib/servicios/pack-pricing"
```

Extender `ServiceOption` (líneas ~8-13):

```tsx
export type ServiceOption = {
  id: string
  name: string
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
}
```

Extender el tipo `initial` en `Props` (dentro de `initial?: {...}`) agregando:

```tsx
    zonesCount: number | null
    visibleReserva: boolean
```

Agregar estado (junto a los otros `useState`, ~línea 42):

```tsx
  const [zonesCount, setZonesCount] = useState(
    initial?.zonesCount != null ? String(initial.zonesCount) : ""
  )
  const [visibleReserva, setVisibleReserva] = useState(initial?.visibleReserva ?? false)
```

- [ ] **Step 2: `pack-form.tsx` — cálculo de referencia por zona**

Reemplazar el cálculo de `fullPriceCents` (línea ~47) por:

```tsx
  const isPerZone = service?.pricing_mode === "per_zone"
  const zonesCountNum = zonesCount.trim() ? parseInt(zonesCount, 10) || 0 : 0
  const fullPriceCents = service
    ? packReferenceCents(service.price_cents, sessionsNum, isPerZone ? zonesCountNum : null)
    : 0
```

- [ ] **Step 3: `pack-form.tsx` — validación + payload**

En `handleSubmit`, después de la validación de precio (línea ~54), agregar:

```tsx
    if (isPerZone && zonesCountNum < 1) { setError("Indicá cuántas zonas cubre cada sesión."); return }
```

Reemplazar el objeto `input` (líneas ~63-70) por:

```tsx
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
```

- [ ] **Step 4: `pack-form.tsx` — UI (campo zonas + checkbox visible)**

Justo después del bloque de "Cantidad de sesiones / Cada cuántos días" (el `<div style={{ display: "flex", gap: 16 ...}}>` que cierra ~línea 107), agregar:

```tsx
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
```

- [ ] **Step 5: `nuevo/page.tsx` y `[id]/page.tsx` — cargar `pricing_mode`**

En AMBOS archivos: agregar `pricing_mode: "fixed" | "per_zone"` al tipo `DbService` (líneas ~8-13); agregar `pricing_mode` al `.select("id, name, price_cents, pricing_mode, category:service_categories(name)")`; y en el `.map((s): ServiceOption => ({...}))` agregar `pricing_mode: s.pricing_mode,`.

En `[id]/page.tsx`: agregar `zones_count, visible_reserva` al select del pack (línea ~32: `.select("id, service_id, name, description, sessions, interval_days, total_price_cents, zones_count, visible_reserva")`) y al objeto `initial` (líneas ~57-65) agregar:

```tsx
          zonesCount: pack.zones_count,
          visibleReserva: pack.visible_reserva,
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs/ && npx next build`
Expected: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/packs/
git commit -m "feat(admin): pack con zonas por sesión + visible en reserva + ahorro por zona"
```

---

### Task 5: Reserva — cargar packs visibles

**Files:**
- Modify: `src/app/reserva/data.ts` (agregar tipo `ReservaPack`)
- Modify: `src/app/reserva/queries.ts` (agregar `fetchReservaPacks()`)
- Modify: `src/app/reserva/page.tsx` (fetch + pasar a `ReservaFlow`)
- Modify: `src/app/reserva/flow.tsx` (prop `packs` → `Screen1Services` y `Screen5Confirm`)

**Interfaces:**
- Produces:
  - `type ReservaPack = { id: string; name: string; description: string; priceCents: number; sessions: number; serviceId: string; serviceName: string; pricingMode: "fixed" | "per_zone"; zonesCount: number | null; zones: ServiceZone[] }`
  - `fetchReservaPacks(): Promise<ReservaPack[]>`

- [ ] **Step 1: `data.ts` — tipo `ReservaPack`**

Después del tipo `Combo` (línea ~159), agregar:

```ts
export type ReservaPack = {
  id: string
  name: string
  description: string
  priceCents: number
  sessions: number
  serviceId: string
  serviceName: string
  pricingMode: "fixed" | "per_zone"
  zonesCount: number | null
  zones: ServiceZone[]   // zonas activas del servicio (para packs per_zone)
}
```

En `BookingState`, agregar el campo de pack elegido (después de `combo?`):

```ts
  pack?: { pack: ReservaPack; zoneIds: string[] } | null
```

- [ ] **Step 2: `queries.ts` — `fetchReservaPacks`**

Agregar al final del archivo:

```ts
type DbReservaPackRow = {
  id: string
  name: string
  description: string | null
  total_price_cents: number
  sessions: number
  zones_count: number | null
  service: {
    id: string
    name: string
    pricing_mode: "fixed" | "per_zone"
    service_zones: { id: string; name: string; duration_min: number; active: boolean; order_index: number }[]
  } | null
}

export async function fetchReservaPacks(): Promise<import("./data").ReservaPack[]> {
  const supabase = adminClient()
  const { data } = await supabase
    .from("packs")
    .select(`
      id, name, description, total_price_cents, sessions, zones_count,
      service:services(id, name, pricing_mode, service_zones(id, name, duration_min, active, order_index))
    `)
    .eq("active", true)
    .eq("visible_reserva", true)
    .order("name", { ascending: true })

  if (!data) return []
  return (data as unknown as DbReservaPackRow[])
    .filter((p) => p.service)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      priceCents: p.total_price_cents,
      sessions: p.sessions,
      serviceId: p.service!.id,
      serviceName: p.service!.name,
      pricingMode: p.service!.pricing_mode,
      zonesCount: p.zones_count,
      zones: (p.service!.service_zones ?? [])
        .filter((z) => z.active)
        .sort((a, b) => a.order_index - b.order_index)
        .map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min })),
    }))
}
```

- [ ] **Step 3: `page.tsx` — fetch + pasar el prop**

Agregar `fetchReservaPacks` al import de `./queries` (línea 1). Agregarlo al `Promise.all` (líneas ~9-16) como `reservaPacks` y pasar `packs={reservaPacks}` a `<ReservaFlow>` (línea ~56).

```ts
  const [categories, combos, professionals, businessHours, packsCount, reservaPacks, supabase] = await Promise.all([
    fetchCatalog(),
    fetchCombos(),
    fetchProfessionals(),
    fetchBusinessHours(),
    countActivePacks(),
    fetchReservaPacks(),
    createClient(),
  ])
```

Y en el JSX: `<ReservaFlow ... packs={reservaPacks} />`.

- [ ] **Step 4: `flow.tsx` — prop `packs` → pantallas**

Importar `type ReservaPack` de `./data`. Agregar `packs` a la firma de props de `ReservaFlow` (`packs: ReservaPack[]`). Pasar `packs={packs}` a `Screen1Services` (case "services", ~línea 227) y a `Screen5Confirm` (case "confirm", ~línea 248).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errores esperados sólo en `screens.tsx` (las pantallas todavía no aceptan `packs` — Task 6). Ninguno en `data.ts`/`queries.ts`/`page.tsx`/`flow.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/data.ts src/app/reserva/queries.ts src/app/reserva/page.tsx src/app/reserva/flow.tsx
git commit -m "feat(reserva): cargar packs visibles y pasarlos al flujo"
```

---

### Task 6: Reserva UI — elegir un pack (excluyente) + zonas

**Files:**
- Modify: `src/app/reserva/screens.tsx` (`Screen1Services` y `Screen5Confirm`)

**Interfaces:**
- Consumes: `ReservaPack`, `BookingState.pack` (Task 5).
- Produces: `Screen1Services` y `Screen5Confirm` aceptan `packs: ReservaPack[]`; el estado `state.pack = { pack, zoneIds }` cuando se elige un pack.

> **Antes de editar:** abrir `screens.tsx` y estudiar cómo se maneja el COMBO (es el patrón a copiar): `COMBOS_TAB`, `selectedCombo = state.combo`, `toggleCombo` (setea `state.combo` y reemplaza `state.services`), la pestaña de combos, `displayPrice`/`displayMin`/`hasSelection` con la rama combo, y en `Screen5Confirm` el `combo = state.combo` con `comboId` en el payload. El PACK se comporta igual (excluyente), con dos diferencias: (a) muestra el precio del pack y su cantidad de sesiones; (b) si es `per_zone`, exige elegir **exactamente `zones_count`** zonas antes de continuar.

- [ ] **Step 1: `Screen1Services` — aceptar `packs` + estado del pack**

Agregar `packs` a la firma de `Screen1Services` (junto a `combos`). Definir helpers análogos al combo:

```tsx
  const PACKS_TAB = "__packs__"
  const selectedPack = state.pack ?? null

  const togglePack = (p: ReservaPack) => {
    if (selectedPack?.pack.id === p.id) {
      setState({ ...state, pack: null })
    } else {
      // Elegir un pack limpia servicios sueltos y combo (excluyente)
      setState({ ...state, pack: { pack: p, zoneIds: [] }, services: [], combo: null })
    }
  }

  const togglePackZone = (zoneId: string) => {
    if (!selectedPack) return
    const cur = selectedPack.zoneIds
    const next = cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
    setState({ ...state, pack: { ...selectedPack, zoneIds: next } })
  }
```

Cuando se cambia a servicios sueltos o combo, limpiar también el pack (agregar `pack: null` a los `setState` de `toggleCat`/`toggleCombo`/`toggle`, igual que ya limpian `combo`).

- [ ] **Step 2: `Screen1Services` — sección "Packs" (pestaña) + tarjetas + zonas**

Agregar una pestaña "Packs" (si `packs.length > 0`) análoga a la de combos, y una lista `PackList` que muestre cada pack con nombre, "N sesiones", precio, y —si `p.pricingMode === "per_zone"` y está elegido— sus zonas como checkboxes (elegir exactamente `p.zonesCount`):

```tsx
  const PackList = () => (
    <div>
      {packs.map((p) => {
        const isSel = selectedPack?.pack.id === p.id
        return (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => togglePack(p)}
              style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                padding: "12px 14px", borderRadius: 10,
                border: `1px solid ${isSel ? "var(--gold)" : "var(--line)"}`,
                background: isSel ? "var(--linen)" : "transparent",
              }}
            >
              <strong>{p.name}</strong> · {p.sessions} sesiones
              <span style={{ float: "right" }}>{fmtPrice(p.priceCents / 100)}</span>
              {p.description && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{p.description}</div>}
            </button>
            {isSel && p.pricingMode === "per_zone" && (
              <div style={{ paddingLeft: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  Elegí {p.zonesCount} zona(s) para tu pack:
                </span>
                {p.zones.map((z) => {
                  const checked = selectedPack!.zoneIds.includes(z.id)
                  const atLimit = selectedPack!.zoneIds.length >= (p.zonesCount ?? 0)
                  return (
                    <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", opacity: !checked && atLimit ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && atLimit}
                        onChange={() => togglePackZone(z.id)}
                        style={{ width: 15, height: 15 }}
                      />
                      <span>{z.name} · {z.durationMin} min</span>
                    </label>
                  )
                })}
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                  Seña hoy (30%): {fmtPrice(Math.round(p.priceCents * 0.3) / 100)}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
```

Renderizar `PackList()` cuando la pestaña activa sea `PACKS_TAB` (agregar la pestaña al selector de pestañas y a los dos lugares donde hoy se hace `activeCat === COMBOS_TAB ? ComboList() : ServiceList()`).

- [ ] **Step 3: `Screen1Services` — totales, duración y gate de continuar**

Incorporar el pack a `displayPrice`/`displayMin`/`hasSelection` y bloquear "Continuar" hasta elegir las zonas del pack:

```tsx
  const packDurationMin = selectedPack
    ? (selectedPack.pack.pricingMode === "per_zone"
        ? selectedPack.pack.zones.filter((z) => selectedPack.zoneIds.includes(z.id)).reduce((a, z) => a + z.durationMin, 0)
        : 0) // servicio fijo: la duración la resuelve el servidor
    : 0
  const packZonesOk = !selectedPack || selectedPack.pack.pricingMode !== "per_zone" ||
    selectedPack.zoneIds.length === (selectedPack.pack.zonesCount ?? 0)
```

- `displayPrice`: si `selectedPack`, usar `selectedPack.pack.priceCents / 100`.
- `displayMin`: si `selectedPack`, usar `packDurationMin` (para per_zone).
- `hasSelection`: `selectedPack !== null || ...` (lo ya existente).
- El botón "Continuar" debe requerir además `packZonesOk`.
- Para la disponibilidad (Screen2) del pack: el `ServiceInput` que se manda es el **servicio del pack** con la duración `packDurationMin` (per_zone) o la que devuelva la disponibilidad para el servicio fijo. Pasar `[{ id: selectedPack.pack.serviceId, name: selectedPack.pack.serviceName, duration: packDurationMin, staffId: "auto" }]` cuando hay pack.

- [ ] **Step 4: `Screen5Confirm` — mostrar pack + payload**

Aceptar `packs` (no siempre necesario) y leer `state.pack`. Cuando hay pack:
- Total mostrado = `selectedPack.pack.priceCents`; seña = 30% de eso; resumen = `"<pack.name> · <sessions> sesiones"` (+ zonas elegidas si per_zone).
- En la llamada a `createBooking`, agregar el pack al payload:

```tsx
    packId: state.pack?.pack.id,
    packZoneIds: state.pack?.pack.pricingMode === "per_zone" ? (state.pack?.zoneIds ?? []) : undefined,
```

- No permitir canje por puntos cuando hay pack (`canRedeem` = false si `state.pack`).

- [ ] **Step 5: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint src/app/reserva/ && npx next build`
Expected: 0 errores (el server `createBooking` acepta `packId`/`packZoneIds` recién en Task 7 — si `tsc` marca esos campos en el payload, es esperado hasta completar Task 7; continuar y re-chequear al final de Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(reserva): elegir un pack (excluyente) con zonas y seña 30%"
```

---

### Task 7: Reserva servidor — comprar pack + turno portador

**Files:**
- Modify: `src/app/reserva/actions.ts` (`BookingInput` + rama de pack en `createBooking`)

**Interfaces:**
- Consumes: `computeZonePricing`, `resolveSelectedZones` (ya importados en Fase 1); `BookingState.pack` (Task 5).
- Produces: `createBooking` acepta `packId?: string` y `packZoneIds?: string[]`; cuando hay `packId`, crea `pack_purchases` + primer turno portador.

- [ ] **Step 1: Extender `BookingInput` (permitir reserva de pack sin servicios sueltos)**

En `BookingInput`, la línea `serviceIds: z.array(z.string().uuid()).min(1),` pasa a permitir vacío (una reserva de pack manda `serviceIds: []`):

```ts
  serviceIds: z.array(z.string().uuid()),
```

Agregar los campos del pack dentro del `z.object`:

```ts
  packId: z.string().uuid().optional(),
  packZoneIds: z.array(z.string().uuid()).optional(),
```

Y agregar un `.refine` al final del `z.object({...})` (después de la llave de cierre del objeto, antes del `)`), para exigir servicios O pack:

```ts
}).refine((v) => v.serviceIds.length > 0 || !!v.packId, {
  message: "Elegí al menos un servicio o un pack.",
})
```

> Con `serviceIds: []` y sin combo, el bloque "1) Resolve services" queda inofensivo: `.in("id", [])` devuelve `[]`, `services.length (0) === input.serviceIds.length (0)` pasa, no hay zonas que resolver, y `totalDuration`/`totalCents` quedan en 0. La rama de pack (Step 2) se ejecuta más abajo y retorna antes del armado del turno normal.

- [ ] **Step 2: Rama de pack (después de guardar la ficha médica)**

Ubicación EXACTA: insertar la rama **después del bloque "3) Insert medical record"** (así la ficha médica de una clienta nueva se guarda igual) y **antes del bloque "4) Default room"**. La rama usa `clientId` (ya resuelto en el paso 2) y `email` (ya en scope), hace TODO el flujo de pack y retorna, sin tocar el flujo de turno normal de abajo. Insertar:

```ts
  // ── Reserva de un PACK (excluyente): crea la compra + primer turno portador ──
  if (input.packId) {
    const { data: pack } = await supabase
      .from("packs")
      .select("id, name, sessions, total_price_cents, zones_count, active, visible_reserva, service:services(id, name, pricing_mode, duration_min, price_cents)")
      .eq("id", input.packId)
      .eq("active", true)
      .eq("visible_reserva", true)
      .maybeSingle()
    if (!pack) return { ok: false, error: "Ese pack ya no está disponible." }
    const svc = pack.service as unknown as { id: string; name: string; pricing_mode: "fixed" | "per_zone"; duration_min: number; price_cents: number } | null
    if (!svc) return { ok: false, error: "El pack no tiene servicio asociado." }

    // Duración de la 1ª sesión + snapshot de zonas
    let firstDuration = svc.duration_min
    let zonesSnapshot: ZoneSnapshot[] | null = null
    if (svc.pricing_mode === "per_zone") {
      const { data: zoneRows } = await supabase
        .from("service_zones")
        .select("id, name, duration_min")
        .eq("service_id", svc.id)
        .eq("active", true)
      const avail: Zone[] = (zoneRows ?? []).map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min }))
      const selected = resolveSelectedZones(input.packZoneIds ?? [], avail)
      if (!selected || selected.length !== (pack.zones_count ?? 0))
        return { ok: false, error: `Elegí exactamente ${pack.zones_count} zona(s) para el pack.` }
      const p = computeZonePricing(selected, svc.price_cents)
      firstDuration = p.durationMin
      zonesSnapshot = p.zones
    }

    const packStartsAt = new Date(input.startsAt)
    const packEndsAt = new Date(packStartsAt.getTime() + firstDuration * 60_000)
    const packDeposit = Math.round(pack.total_price_cents * 0.3)

    // Crear la compra del pack
    const { data: purchase, error: purErr } = await supabase
      .from("pack_purchases")
      .insert({
        client_id: clientId,
        pack_id: pack.id,
        pack_name: pack.name,
        service_id: svc.id,
        service_name: svc.name,
        sessions_total: pack.sessions,
        sessions_used: 0,
      })
      .select("id")
      .single()
    if (purErr || !purchase) return { ok: false, error: `No pudimos registrar el pack: ${purErr?.message}` }

    // Sala + staff (mismo criterio que el turno normal)
    const { data: packRoom } = await supabase.from("rooms").select("id").eq("active", true).limit(1).maybeSingle()
    const packStaffId = input.resolvedStaff
      ? (input.serviceOrder?.[0] ? (input.resolvedStaff[input.serviceOrder[0]] ?? null) : Object.values(input.resolvedStaff)[0] ?? null)
      : (input.proHint !== "auto" ? input.proHint : null)

    const { data: packAppt, error: packApptErr } = await supabase
      .from("appointments")
      .insert({
        client_id: clientId,
        staff_id: packStaffId,
        room_id: packRoom?.id ?? null,
        starts_at: packStartsAt.toISOString(),
        ends_at: packEndsAt.toISOString(),
        duration_min: firstDuration,
        total_cents: pack.total_price_cents,
        deposit_cents: packDeposit,
        deposit_paid: false,
        status: "pending",
        source: "web",
        pack_purchase_id: purchase.id,
        notes_internal: `Pack: ${pack.name} (sesión 1 de ${pack.sessions})`,
      })
      .select("id")
      .single()
    if (packApptErr || !packAppt) return { ok: false, error: `Turno del pack: ${packApptErr?.message}` }

    await supabase.from("appointment_services").insert({
      appointment_id: packAppt.id,
      service_id: svc.id,
      duration_min: firstDuration,
      price_cents: pack.total_price_cents,
      zones: zonesSnapshot,
      staff_id: packStaffId,
      starts_at: packStartsAt.toISOString(),
    })

    // Email de confirmación (best-effort, no bloqueante)
    try {
      await sendBookingConfirmation({
        to: email,
        firstName: input.client.firstName.trim(),
        servicesNames: [`${pack.name} (sesión 1 de ${pack.sessions})`],
        startsAt: packStartsAt,
        durationMin: firstDuration,
        totalCents: pack.total_price_cents,
        appointmentId: packAppt.id,
      })
    } catch {}

    return { ok: true, appointmentId: packAppt.id }
  }
```

> Nota: el pack usa el mismo `input.startsAt`, `input.client`, `clientId` ya resueltos arriba, y las mismas variables `email`. La rama retorna antes del flujo de turno normal, así que servicios/combo no se tocan. El Google Calendar y el magic link quedan fuera del pack por simplicidad (se pueden agregar luego); el email sí se envía.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/reserva/actions.ts`
Expected: 0 errores (y ahora también cierra `screens.tsx` de Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(reserva): comprar pack en la reserva (pack_purchase + turno portador + seña 30%)"
```

---

### Task 8: Verificación end-to-end

**Files:** ninguno (verificación).

- [ ] **Step 1: Batería completa**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src/app/admin/packs src/app/reserva src/lib/servicios && npx next build`
Expected: tests PASS (incluye los 4 nuevos de pack-pricing), tsc 0, 0 errores de lint nuevos, build OK.

- [ ] **Step 2: Smoke manual (dev)**

Run: `npm run dev`
1. Admin → Packs → Nuevo: elegir el servicio **por zona** (Vela Slim) → aparece "Zonas por sesión"; poné 2, sesiones 4, precio $160.000 → muestra el ahorro (referencia $200.000). Marcá "Visible en la reserva online". Guardá y activá el pack.
2. Reserva online: pestaña **Packs** → elegí ese pack → pedí elegir **exactamente 2 zonas** → total = $160.000, seña $48.000. Elegí día/hora → confirmá.
3. En la DB: hay una fila en `pack_purchases` (`sessions_total=4`, `sessions_used=0`), un `appointments` con `total_cents=16000000`, `deposit_cents=4800000`, `pack_purchase_id` seteado, y `appointment_services.zones` con las 2 zonas.
4. Admin → Turnos: al **Completar** ese turno, ofrece descontar del pack → queda `sessions_used=1`.

- [ ] **Step 3: Commit (si hubo ajustes)**

```bash
git add -A && git commit -m "fix: ajustes del smoke de packs por zona"
```

---

## Notas de alcance

- **Fuera de alcance (YAGNI):** agendar online las sesiones 2..N del pack (las agenda el admin); Google Calendar / magic link para el turno del pack; packs de servicios fijos elegibles en reserva (funcionan igual por el mismo código, sin selección de zonas); excluir servicios `per_zone` de combos (sigue fail-closed).
- **Depende de Fase 1** (ya en producción): `pricing_mode`, `service_zones`, `appointment_services.zones`, `src/lib/servicios/zones.ts`.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-01-servicio-por-zona-design.md` (§3.4, §3.5, §6).
- Packs etapa 2 (venta + consumo): `docs/superpowers/specs/2026-06-20-packs-etapa2-seguimiento-design.md`.
- Reserva: `src/app/reserva/{actions.ts,data.ts,queries.ts,screens.tsx,flow.tsx,page.tsx}`.
- Packs admin: `src/app/admin/packs/**`.
