# Combos como Programas — Fase 1 (Definición del programa) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un combo se arme como un programa: cada tratamiento con su cantidad de sesiones (y su zona si es por-zona), con el precio individual/ahorro calculado bien, validación del lado del servidor, y renombrado de la UI a "Programa".

**Architecture:** Migración aditiva a `combo_services` (columnas `sessions` y `zones`). Un módulo puro nuevo (`combo-pricing.ts`) calcula precio individual, ahorro y total de sesiones. `ComboInput` pasa de `serviceIds` a `services[]` (con sesiones + zonas). `createCombo`/`updateCombo` validan del lado del servidor, resuelven el snapshot de zonas, y escriben sin dejar combos huérfanos ni sin servicios. El formulario y las páginas de alta/edición cargan `pricing_mode`/`zone_selection`/`service_zones` y las cantidades/zonas guardadas.

**Tech Stack:** Next.js 16 App Router, Supabase (service-role admin client), TypeScript strict, Vitest, Zod.

## Global Constraints

- Migración **aditiva**; la usuaria la corre antes del deploy. Nada destructivo.
- El combo/programa sigue **INACTIVO**; su reserva online (Fase 2) NO se toca en esta fase.
- Alta/edición de combos es **sólo admin** (`requireAdmin_action`, ya existe).
- Un programa exige **mínimo 2 servicios** (lo diferencia de un pack), precio > 0, sesiones > 0 por servicio, sin servicios duplicados.
- Servicios **por-zona** (`pricing_mode === "per_zone"`): al armar el programa se eligen la(s) zona(s); el snapshot (nombre/duración/precio por zona) se congela en `combo_services.zones` (mismo formato que `appointment_services.zones`: `{ name, duration_min, price_cents }[]`).
- Escritura **atómica-suficiente**: nunca dejar un combo sin servicios ni un combo huérfano.
- Nombres de tablas NO cambian (`combos`, `combo_services`); sólo cambia el texto de la UI ("Combos" → "Programas").
- Cada tarea: `npx tsc --noEmit` + `npx vitest run` + `npx next build`. Al final, revisión adversarial opus antes de desplegar.

## File Structure

- **Create** `supabase/migrations/20260816000000_combo_sessions.sql` — agrega `combo_services.sessions` y `combo_services.zones`.
- **Create** `src/lib/servicios/combo-pricing.ts` — módulo puro: precio individual, ahorro, total de sesiones.
- **Create** `src/lib/servicios/combo-pricing.test.ts` — tests del módulo puro.
- **Create** `src/lib/servicios/combo-validate.ts` — validación pura de `ComboInput`.
- **Create** `src/lib/servicios/combo-validate.test.ts` — tests de validación.
- **Modify** `src/app/admin/actions.ts` — `ComboInput` (nuevo shape), `createCombo`/`updateCombo` (validación + zonas + atomicidad).
- **Modify** `src/app/admin/combos/combo-form.tsx` — sesiones por servicio, selección de zona, precio con cantidades, payload `services[]`.
- **Modify** `src/app/admin/combos/nuevo/page.tsx` y `src/app/admin/combos/[id]/page.tsx` — cargar `pricing_mode`/`zone_selection`/`service_zones` y (en editar) `sessions`/`zones`.
- **Modify** `src/app/admin/layout.tsx`, `src/app/admin/combos/page.tsx`, `nuevo/page.tsx`, `[id]/page.tsx` — texto "Combos" → "Programas".

---

### Task 1: Migración — cantidad de sesiones y snapshot de zona

**Files:**
- Create: `supabase/migrations/20260816000000_combo_sessions.sql`

**Interfaces:**
- Produces: columnas `combo_services.sessions int not null default 1 check (sessions > 0)` y `combo_services.zones jsonb` (nullable).

- [ ] **Step 1: Escribir la migración**

```sql
-- Un combo pasa a ser un PROGRAMA de varias sesiones: cada servicio del combo
-- tiene su cantidad de sesiones, y si es por-zona, el snapshot de la(s) zona(s)
-- elegida(s) al armarlo (mismo formato que appointment_services.zones).
-- Aditiva: las filas existentes toman sessions = 1 y zones = null.
alter table public.combo_services
  add column if not exists sessions int not null default 1 check (sessions > 0);

alter table public.combo_services
  add column if not exists zones jsonb;
```

- [ ] **Step 2: Verificar que es sólo-aditiva**

Leer el archivo: no hay `drop`, `not null` sin default sobre columna nueva, ni cambios de tipo. Las filas existentes quedan con `sessions = 1`, `zones = null`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260816000000_combo_sessions.sql
git commit -m "feat(combos): migracion sesiones + snapshot de zona por servicio del programa"
```

---

### Task 2: Módulo puro de precio del programa

**Files:**
- Create: `src/lib/servicios/combo-pricing.ts`
- Test: `src/lib/servicios/combo-pricing.test.ts`

**Interfaces:**
- Produces:
  - `type ComboPriceLine = { priceCents: number; sessions: number }` — `priceCents` = precio efectivo de UNA sesión de ese servicio (precio fijo, o suma de las zonas elegidas si es por-zona).
  - `comboIndividualCents(lines: ComboPriceLine[]): number` — `Σ priceCents × sessions`.
  - `comboSavingsCents(individualCents: number, totalCents: number): number` — `individualCents - totalCents` (positivo = ahorro).
  - `comboTotalSessions(lines: { sessions: number }[]): number` — `Σ sessions`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest"
import { comboIndividualCents, comboSavingsCents, comboTotalSessions } from "./combo-pricing"

describe("comboIndividualCents", () => {
  it("suma precio × sesiones por servicio", () => {
    // Ultra $30.000 ×4 + Vela $25.000 ×4 = 120.000 + 100.000 = 220.000
    expect(comboIndividualCents([
      { priceCents: 3_000_000, sessions: 4 },
      { priceCents: 2_500_000, sessions: 4 },
    ])).toBe(3_000_000 * 4 + 2_500_000 * 4)
  })
  it("una sola sesión = el precio del servicio", () => {
    expect(comboIndividualCents([{ priceCents: 5_000_000, sessions: 1 }])).toBe(5_000_000)
  })
  it("lista vacía = 0", () => {
    expect(comboIndividualCents([])).toBe(0)
  })
})

describe("comboSavingsCents", () => {
  it("individual mayor que total = ahorro positivo", () => {
    expect(comboSavingsCents(220_000_00, 150_000_00)).toBe(70_000_00)
  })
  it("total mayor que individual = negativo (más caro)", () => {
    expect(comboSavingsCents(80_000_00, 150_000_00)).toBe(-70_000_00)
  })
})

describe("comboTotalSessions", () => {
  it("suma las sesiones de todos los servicios", () => {
    expect(comboTotalSessions([{ sessions: 4 }, { sessions: 4 }, { sessions: 6 }])).toBe(14)
  })
  it("lista vacía = 0", () => {
    expect(comboTotalSessions([])).toBe(0)
  })
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run src/lib/servicios/combo-pricing.test.ts`
Expected: FAIL ("comboIndividualCents is not defined").

- [ ] **Step 3: Implementar el módulo**

```ts
// El precio de un PROGRAMA (combo multi-sesión): el "precio individual" con el
// que se compara el ahorro es la suma de UNA sesión de cada servicio POR su
// cantidad de sesiones (antes se ignoraba la cantidad y el programa parecía
// carísimo). Puro y testeable; el precio efectivo por servicio (fijo o suma de
// zonas) lo calcula quien llama.

export type ComboPriceLine = { priceCents: number; sessions: number }

/** Σ precio_de_una_sesión × sesiones, sobre todos los servicios del programa. */
export function comboIndividualCents(lines: ComboPriceLine[]): number {
  return lines.reduce((a, l) => a + l.priceCents * l.sessions, 0)
}

/** Ahorro vs el precio individual (positivo = ahorra; negativo = más caro). */
export function comboSavingsCents(individualCents: number, totalCents: number): number {
  return individualCents - totalCents
}

/** Total de sesiones del programa (Σ sesiones de cada servicio). */
export function comboTotalSessions(lines: { sessions: number }[]): number {
  return lines.reduce((a, l) => a + l.sessions, 0)
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run src/lib/servicios/combo-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/combo-pricing.ts src/lib/servicios/combo-pricing.test.ts
git commit -m "feat(combos): modulo puro de precio individual/ahorro/sesiones del programa"
```

---

### Task 3: Validación pura de `ComboInput`

**Files:**
- Create: `src/lib/servicios/combo-validate.ts`
- Test: `src/lib/servicios/combo-validate.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type ComboServiceInput = { serviceId: string; sessions: number; zoneIds?: string[] }`
  - `type ComboInputShape = { name: string; description?: string; totalPriceCents: number; services: ComboServiceInput[] }`
  - `validateComboInput(input: ComboInputShape): string | null` — devuelve un mensaje de error, o `null` si es válido. Reglas: nombre no vacío; `totalPriceCents > 0`; ≥ 2 servicios; sin `serviceId` duplicado; cada `sessions` entero ≥ 1.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest"
import { validateComboInput, type ComboInputShape } from "./combo-validate"

const base: ComboInputShape = {
  name: "Programa Reductor",
  totalPriceCents: 150_000_00,
  services: [
    { serviceId: "a", sessions: 4 },
    { serviceId: "b", sessions: 4 },
  ],
}

describe("validateComboInput", () => {
  it("un input válido devuelve null", () => {
    expect(validateComboInput(base)).toBeNull()
  })
  it("nombre vacío", () => {
    expect(validateComboInput({ ...base, name: "  " })).toMatch(/nombre/i)
  })
  it("precio 0 o negativo", () => {
    expect(validateComboInput({ ...base, totalPriceCents: 0 })).toMatch(/precio/i)
  })
  it("menos de 2 servicios", () => {
    expect(validateComboInput({ ...base, services: [{ serviceId: "a", sessions: 1 }] })).toMatch(/2 servicios/i)
  })
  it("servicio duplicado", () => {
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 1 }, { serviceId: "a", sessions: 2 },
    ] })).toMatch(/duplicad/i)
  })
  it("sesiones menor a 1 o no entero", () => {
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 0 }, { serviceId: "b", sessions: 1 },
    ] })).toMatch(/sesiones/i)
    expect(validateComboInput({ ...base, services: [
      { serviceId: "a", sessions: 1.5 }, { serviceId: "b", sessions: 1 },
    ] })).toMatch(/sesiones/i)
  })
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run src/lib/servicios/combo-validate.test.ts`
Expected: FAIL ("validateComboInput is not defined").

- [ ] **Step 3: Implementar la validación**

```ts
// Validación del ARMADO de un programa (combo). Pura: la usan createCombo y
// updateCombo (antes NO había validación de servidor — la auditoría lo marcó).
export type ComboServiceInput = { serviceId: string; sessions: number; zoneIds?: string[] }
export type ComboInputShape = {
  name: string
  description?: string
  totalPriceCents: number
  services: ComboServiceInput[]
}

export function validateComboInput(input: ComboInputShape): string | null {
  if (!input.name?.trim()) return "El nombre es obligatorio."
  if (!Number.isFinite(input.totalPriceCents) || input.totalPriceCents <= 0)
    return "Ingresá el precio del programa."
  if (input.services.length < 2) return "Elegí al menos 2 servicios."
  const ids = new Set<string>()
  for (const s of input.services) {
    if (ids.has(s.serviceId)) return "Hay un servicio duplicado en el programa."
    ids.add(s.serviceId)
    if (!Number.isInteger(s.sessions) || s.sessions < 1)
      return "Cada servicio tiene que tener al menos 1 sesión (número entero)."
  }
  return null
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run src/lib/servicios/combo-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/combo-validate.ts src/lib/servicios/combo-validate.test.ts
git commit -m "feat(combos): validacion pura del armado del programa"
```

---

### Task 4: `createCombo` / `updateCombo` — nuevo input, zonas y escritura robusta

**Files:**
- Modify: `src/app/admin/actions.ts` (`ComboInput` en 1965-1970; `createCombo` 1972-1992; `updateCombo` 1994-2016)

**Interfaces:**
- Consumes: `validateComboInput`, `ComboServiceInput` (Task 3); `resolveSelectedZones`, `computeZonePricing` de `@/lib/servicios/zones`.
- Produces: `ComboInput = ComboInputShape` (con `services: ComboServiceInput[]`, ya NO `serviceIds`). `createCombo(input): { ok; error?; id? }`, `updateCombo(id, input): { ok; error? }` — validan, resuelven el snapshot de zonas por servicio y persisten `combo_services` con `sessions` + `zones`.

- [ ] **Step 1: Reemplazar `ComboInput` por el shape de Task 3**

En `src/app/admin/actions.ts`, reemplazar el `type ComboInput` (líneas 1965-1970) por:

```ts
import { validateComboInput, type ComboServiceInput } from "@/lib/servicios/combo-validate"
import { resolveSelectedZones, computeZonePricing, type Zone } from "@/lib/servicios/zones"

export type ComboInput = {
  name: string
  description?: string
  totalPriceCents: number
  services: ComboServiceInput[] // en orden; cada uno con sessions y (por-zona) zoneIds
}
```

- [ ] **Step 2: Helper interno para resolver las filas de `combo_services` (con snapshot de zona)**

Agregar, cerca de `createCombo`, un helper que valida y arma las filas a insertar. Resuelve el snapshot de zona SÓLO para servicios `per_zone`; para `fixed`, `zones` queda `null`. Devuelve `{ rows }` o `{ error }`.

```ts
// Arma las filas de combo_services desde el input, resolviendo el snapshot de
// zona de los servicios por-zona (mismo criterio que createAdminBooking).
async function buildComboServiceRows(
  admin: ReturnType<typeof adminClient>,
  comboId: string,
  input: ComboInput
): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  const serviceIds = input.services.map((s) => s.serviceId)
  const { data: svcRows, error: svcErr } = await admin
    .from("services")
    .select("id, pricing_mode, zone_selection, price_cents")
    .in("id", serviceIds)
  if (svcErr) return { error: svcErr.message }
  const svcById = new Map((svcRows ?? []).map((s) => [s.id as string, s]))

  // Zonas disponibles de los servicios por-zona involucrados.
  const perZoneIds = (svcRows ?? []).filter((s) => s.pricing_mode === "per_zone").map((s) => s.id as string)
  const zonesByService: Record<string, Zone[]> = {}
  if (perZoneIds.length) {
    const { data: zoneRows, error: zErr } = await admin
      .from("service_zones")
      .select("id, service_id, name, duration_min, price_cents")
      .in("service_id", perZoneIds)
      .eq("active", true)
    if (zErr) return { error: zErr.message }
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id as string] ??= []).push({
        id: z.id as string, name: z.name as string,
        durationMin: z.duration_min as number, priceCents: (z.price_cents as number | null) ?? null,
      })
    }
  }

  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < input.services.length; i++) {
    const item = input.services[i]
    const svc = svcById.get(item.serviceId)
    if (!svc) return { error: "Uno de los servicios ya no existe." }
    let zonesSnapshot: { name: string; duration_min: number; price_cents: number }[] | null = null
    if (svc.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(item.zoneIds ?? [], zonesByService[item.serviceId] ?? [])
      if (!selected) return { error: `Elegí la(s) zona(s) del servicio por zona.` }
      if (svc.zone_selection === "single" && selected.length !== 1)
        return { error: `Un servicio por zona de selección única admite una sola zona.` }
      zonesSnapshot = computeZonePricing(selected, svc.price_cents as number).zones
    }
    rows.push({
      combo_id: comboId,
      service_id: item.serviceId,
      sessions: item.sessions,
      zones: zonesSnapshot,
      order_index: i,
    })
  }
  return { rows }
}
```

- [ ] **Step 3: Reescribir `createCombo` (validar → insertar combo → armar filas → insertar; limpiar el combo si falla)**

```ts
export async function createCombo(input: ComboInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireAdmin_action()
  const err = validateComboInput(input)
  if (err) return { ok: false, error: err }
  const admin = adminClient()

  const { data: combo, error: comboErr } = await admin
    .from("combos")
    .insert({ name: input.name.trim(), description: input.description?.trim() || null, total_price_cents: input.totalPriceCents, active: false })
    .select("id")
    .single()
  if (comboErr || !combo) return { ok: false, error: comboErr?.message }

  const built = await buildComboServiceRows(admin, combo.id, input)
  if ("error" in built) {
    await admin.from("combos").delete().eq("id", combo.id) // no dejar el combo huérfano
    return { ok: false, error: built.error }
  }
  const { error: linkErr } = await admin.from("combo_services").insert(built.rows)
  if (linkErr) {
    await admin.from("combos").delete().eq("id", combo.id)
    return { ok: false, error: linkErr.message }
  }

  revalidatePath("/admin/combos")
  return { ok: true, id: combo.id }
}
```

- [ ] **Step 4: Reescribir `updateCombo` (upsert + borrar sólo los quitados; nunca deja el combo sin servicios)**

```ts
export async function updateCombo(id: string, input: ComboInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin_action()
  const err = validateComboInput(input)
  if (err) return { ok: false, error: err }
  const admin = adminClient()

  const { error: updateErr } = await admin
    .from("combos")
    .update({ name: input.name.trim(), description: input.description?.trim() || null, total_price_cents: input.totalPriceCents })
    .eq("id", id)
  if (updateErr) return { ok: false, error: updateErr.message }

  const built = await buildComboServiceRows(admin, id, input)
  if ("error" in built) return { ok: false, error: built.error }

  // Upsert PRIMERO (si falla, los servicios viejos quedan intactos → nunca
  // queda el combo sin servicios), y sólo DESPUÉS se borran los que se quitaron.
  const { error: upErr } = await admin
    .from("combo_services")
    .upsert(built.rows, { onConflict: "combo_id,service_id" })
  if (upErr) return { ok: false, error: upErr.message }
  const keepIds = input.services.map((s) => s.serviceId)
  const { error: delErr } = await admin
    .from("combo_services").delete().eq("combo_id", id).not("service_id", "in", `(${keepIds.join(",")})`)
  if (delErr) return { ok: false, error: delErr.message }

  revalidatePath("/admin/combos")
  revalidatePath(`/admin/combos/${id}`)
  return { ok: true }
}
```

Nota: `keepIds` son UUIDs validados (vienen de `combo_services`/`services`); el `.not("service_id","in", ...)` con UUIDs sin comillas es el patrón usado en el resto del código. Si `keepIds` pudiera venir vacío, `validateComboInput` ya rechazó (< 2 servicios), así que siempre hay ≥ 2.

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit` (Expected: OK) y `npx next build` (Expected: OK). El form todavía manda `serviceIds` → tsc va a marcar el mismatch en `combo-form.tsx`: se resuelve en Task 5 (son interdependientes; commitear juntos si tsc no cierra por separado).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "feat(combos): createCombo/updateCombo con sesiones, zonas, validacion y escritura robusta"
```

---

### Task 5: Formulario y páginas de alta/edición

**Files:**
- Modify: `src/app/admin/combos/combo-form.tsx`
- Modify: `src/app/admin/combos/nuevo/page.tsx`
- Modify: `src/app/admin/combos/[id]/page.tsx`

**Interfaces:**
- Consumes: `comboIndividualCents`, `comboSavingsCents`, `comboTotalSessions` (Task 2); `ComboInput`/`ComboServiceInput` (Task 4); `computeZonePricing`, `type Zone` (`@/lib/servicios/zones`).
- Produces: el form manda `createCombo`/`updateCombo` con `services: { serviceId, sessions, zoneIds }[]`.

- [ ] **Step 1: Extender `ServiceOption` y el mapeo de las páginas**

En `combo-form.tsx`, `ServiceOption` pasa a incluir el pricing por-zona:

```ts
export type ComboZone = { id: string; name: string; durationMin: number; priceCents: number | null }
export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
  zone_selection: "multiple" | "single"
  zones: ComboZone[]
}
```

En `nuevo/page.tsx` y `[id]/page.tsx`, el `select` de services agrega `pricing_mode, zone_selection, service_zones(id, name, duration_min, price_cents, active, order_index)` (igual que `admin/nueva-reserva/page.tsx:72`), y el `.map` a `ServiceOption` completa `pricing_mode`, `zone_selection: s.zone_selection ?? "multiple"` y `zones` (mapear `service_zones` activas, ordenadas por `order_index`, a `{ id, name, durationMin: duration_min, priceCents: price_cents }`).

En `[id]/page.tsx`, el `select` del combo agrega `sessions` y `zones` a `combo_services(order_index, service_id, sessions, zones)`, y `initial` pasa a llevar por servicio la cantidad y las zonas guardadas:

```ts
initial={{
  id: combo.id,
  name: combo.name,
  description: combo.description ?? "",
  totalPriceCents: combo.total_price_cents,
  services: [...combo.combo_services]
    .sort((a, b) => a.order_index - b.order_index)
    .map((cs) => ({ serviceId: cs.service_id, sessions: cs.sessions ?? 1, zonesSnapshot: cs.zones ?? null })),
}}
```

- [ ] **Step 2: Estado del form por servicio (sesiones + zonas elegidas)**

En `combo-form.tsx`, reemplazar `selectedIds: string[]` por una estructura que lleve, por servicio seleccionado y en orden, `sessions` y `zoneIds`:

```ts
type Picked = { serviceId: string; sessions: number; zoneIds: string[] }
const [picked, setPicked] = useState<Picked[]>(/* de initial.services, o [] */)
```

Al tildar un servicio se agrega `{ serviceId, sessions: 1, zoneIds: [] }`; al destildar se saca. `moveUp`/`moveDown` reordenan `picked`. Para servicios por-zona se muestra el selector de zonas (mismo patrón que `nueva-reserva-form.tsx:783`+: `single` = radio/una; `multiple` = checkboxes) y un input numérico `sessions` (min 1) por servicio.

Para prefilear las zonas en edición: `initial.services[i].zonesSnapshot` es el snapshot (`{ name }[]`), NO los ids. Mapear cada snapshot a los ids de las zonas del servicio por nombre (`service.zones.find(z => z.name === snap.name)?.id`), y descartar las que ya no existan. (Anotar como limitación conocida: si una zona se renombró/borró, el prefill de esa zona se pierde y hay que re-elegirla.)

- [ ] **Step 3: Precio por servicio y totales con el módulo puro**

Precio efectivo de UNA sesión de un servicio elegido:

```ts
function lineUnitCents(s: ServiceOption, zoneIds: string[]): number {
  if (s.pricing_mode !== "per_zone") return s.price_cents
  const selected = s.zones.filter((z) => zoneIds.includes(z.id))
  return computeZonePricing(
    selected.map((z) => ({ id: z.id, name: z.name, durationMin: z.durationMin, priceCents: z.priceCents })),
    s.price_cents,
  ).priceCents
}
```

Con eso, las líneas para el módulo puro:

```ts
const lines = picked.map((p) => {
  const s = services.find((x) => x.id === p.serviceId)!
  return { priceCents: lineUnitCents(s, p.zoneIds), sessions: p.sessions }
})
const fullPriceCents = comboIndividualCents(lines)     // reemplaza el reduce viejo
const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
const saving = comboSavingsCents(fullPriceCents, totalPriceCents)
const totalSessions = comboTotalSessions(lines)
```

Mostrar: el "Precio individual", el ahorro (verde) / "más caro" (rojo), y **"N sesiones en total"** con el detalle (`Ultracavitación ×4, Vela Slim ×4 (Abdomen), Vela Up ×6`).

- [ ] **Step 4: Payload al guardar**

```ts
const input: ComboInput = {
  name, description, totalPriceCents,
  services: picked.map((p) => ({
    serviceId: p.serviceId,
    sessions: p.sessions,
    zoneIds: (services.find((x) => x.id === p.serviceId)?.pricing_mode === "per_zone") ? p.zoneIds : undefined,
  })),
}
```

La validación de pantalla (mín 2, precio > 0, por-zona con al menos 1 zona, sesiones ≥ 1) se mantiene; el servidor revalida igual.

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit` (Expected: OK — cierra el mismatch de Task 4) y `npx next build` (Expected: OK).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/combos/combo-form.tsx src/app/admin/combos/nuevo/page.tsx src/app/admin/combos/[id]/page.tsx
git commit -m "feat(combos): armar el programa con sesiones y zonas por servicio, precio correcto"
```

---

### Task 6: Renombrar la UI "Combos" → "Programas"

**Files:**
- Modify: `src/app/admin/layout.tsx` (ítem del menú)
- Modify: `src/app/admin/combos/page.tsx`, `nuevo/page.tsx`, `[id]/page.tsx` (títulos/eyebrows/lede)

**Interfaces:** ninguna (sólo texto visible). Las rutas (`/admin/combos`) y las tablas NO cambian.

- [ ] **Step 1: Cambiar el texto del menú**

En `src/app/admin/layout.tsx`, el ítem del nav que dice "Combos" pasa a "Programas" (dejar el `href="/admin/combos"`).

- [ ] **Step 2: Cambiar títulos de las páginas**

- `combos/page.tsx`: eyebrow/título "Combos" → "Programas"; lede acorde (programas de varias sesiones).
- `nuevo/page.tsx`: "Nuevo combo" → "Nuevo programa"; lede: "Elegí los tratamientos, cuántas sesiones de cada uno y el precio del programa."
- `[id]/page.tsx`: "Editar combo" → "Editar programa".

- [ ] **Step 3: tsc + build**

Run: `npx tsc --noEmit` (OK) y `npx next build` (OK).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/layout.tsx src/app/admin/combos/page.tsx src/app/admin/combos/nuevo/page.tsx src/app/admin/combos/[id]/page.tsx
git commit -m "feat(combos): renombrar la UI Combos -> Programas"
```

---

## Cierre de la Fase 1

- [ ] **Correr la suite completa:** `npx vitest run` (todo verde, incluidos los módulos nuevos) + `npx next build`.
- [ ] **Revisión adversarial opus** del diff completo de la fase (foco: la escritura de `combo_services` no deja estados rotos; el snapshot de zona coincide con `appointment_services.zones`; el precio/ahorro con cantidades y zonas; la validación server cubre los límites; el prefill de edición). Corregir hallazgos.
- [ ] **Desplegar:** la usuaria corre la migración `20260816000000_combo_sessions.sql`; verificar la columna en prod (script read-only); luego push. (Fase 2 arranca aparte.)

## Self-Review (hecho)

- **Cobertura de la spec (Fase 1):** migración (Task 1) ✓; formulario con cantidades+zonas+precio (Tasks 2,5) ✓; validación server + atómica (Tasks 3,4) ✓; renombre (Task 6) ✓. El resto de la spec (compra, agendado, factura) es Fase 2-4, fuera de este plan.
- **Placeholders:** los módulos puros y las server actions llevan código completo. El form (Task 5) describe cambios concretos con el código crítico (precio por línea, payload, prefill) porque reescribir el componente entero en el plan sería ruido; el implementador tiene el contrato exacto (`ComboInput.services`, `ServiceOption`, las funciones puras).
- **Consistencia de tipos:** `ComboServiceInput { serviceId, sessions, zoneIds? }` y `ComboInput.services` se usan igual en Tasks 3, 4 y 5; `ComboPriceLine { priceCents, sessions }` igual en Tasks 2 y 5; el snapshot de zona es `{ name, duration_min, price_cents }[]` (igual que `appointment_services.zones`) en migración, server y prefill.
