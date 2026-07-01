# Servicio por zona (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir servicios que se cobran **por zona** (precio = cantidad de zonas × precio por zona) y cuya **duración** es la suma de las duraciones de las zonas elegidas, tanto al crear el servicio (admin) como al reservar un turno suelto.

**Architecture:** Se agrega `pricing_mode` a `services` y una tabla `service_zones` (nombre + minutos por zona). Una función pura (`src/lib/servicios/zones.ts`) calcula precio/duración a partir de las zonas elegidas y se usa **en el servidor** al reservar (autoritativo). El navegador (reserva) muestra el selector de zonas y calcula el resumen con la misma lógica. Se guarda una "foto" de las zonas en `appointment_services.zones`.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, Supabase (Postgres + RLS), TypeScript, Zod, Vitest.

## Global Constraints

- **Next.js atípico:** este proyecto usa una versión con cambios de API. Antes de tocar APIs de Next, leer la guía en `node_modules/next/dist/docs/` (regla de `AGENTS.md`). Esta fase **no** agrega APIs nuevas de Next (solo server actions y componentes ya existentes).
- **Migraciones:** se aplican **solas por CI** (`.github/workflows/db-migrate.yml`) al mergear a `main`; **no** correr migraciones a mano en producción. Nombre de archivo con versión única `YYYYMMDDHHMMSS_...`.
- **Plata en centavos** (`*_cents`, int). Mostrar dividiendo por 100.
- **Precio por zona:** para servicios `per_zone`, `services.price_cents` = precio de **una** zona.
- **Nunca** confiar en precio/duración del navegador: recalcular en el servidor al reservar.
- **RLS:** mirar patrón existente — `select using (true)`, escritura `using (public.is_staff())`.
- Tests de lógica pura con Vitest (`src/**/*.test.ts`, entorno node). Los módulos con `import "server-only"` **no** se testean (romperían en vitest).

---

### Task 1: Migración de base de datos

**Files:**
- Create: `supabase/migrations/20260701000000_servicio_por_zona.sql`

**Interfaces:**
- Produces: columna `services.pricing_mode text` (`'fixed'`|`'per_zone'`); tabla `service_zones(id, service_id, name, duration_min, order_index, active, created_at)`; columna `appointment_services.zones jsonb`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Servicios "por zona": precio por zona + lista de zonas con duración propia.

-- 1) Modo de cobro del servicio. 'fixed' = como hasta ahora; 'per_zone' = por zona.
alter table public.services
  add column if not exists pricing_mode text not null default 'fixed'
    check (pricing_mode in ('fixed', 'per_zone'));

-- 2) Para servicios por zona, duration_min no se usa (la duración sale de las zonas).
--    Se relaja el check para permitir 0.
alter table public.services drop constraint if exists services_duration_min_check;
alter table public.services
  add constraint services_duration_min_check check (duration_min >= 0);

-- 3) Zonas de un servicio por zona.
create table if not exists public.service_zones (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  duration_min int not null check (duration_min > 0),
  order_index int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_zones_service on public.service_zones(service_id);

alter table public.service_zones enable row level security;

drop policy if exists "service_zones_select_all" on public.service_zones;
create policy "service_zones_select_all" on public.service_zones for select using (true);

drop policy if exists "service_zones_staff_write" on public.service_zones;
create policy "service_zones_staff_write" on public.service_zones
  for all using (public.is_staff()) with check (public.is_staff());

-- 4) Foto de las zonas elegidas en cada turno (para servicios por zona).
alter table public.appointment_services
  add column if not exists zones jsonb;
```

- [ ] **Step 2: Verificar sintaxis SQL y el nombre del constraint**

Revisar que el archivo no tenga typos. El `drop constraint if exists services_duration_min_check` asume el nombre auto-generado por Postgres para el check inline `duration_min > 0` del schema inicial (`<tabla>_<columna>_check`). Confirmarlo: si hay Supabase CLI/psql local, correr `\d public.services` y verificar que el check se llame `services_duration_min_check`. Si tuviera otro nombre, ajustar el `drop constraint` (y/o probar insertar un servicio con `pricing_mode='per_zone'` y `duration_min=0`: debe aceptarlo).
Si hay Supabase CLI local, aplicar en una DB de prueba:
Run: `npx supabase db reset` (solo entorno local; NUNCA prod)
Expected: aplica sin error. Si no hay CLI local, la validación real ocurre en el CI al mergear.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260701000000_servicio_por_zona.sql
git commit -m "feat(db): servicio por zona (pricing_mode, service_zones, appointment_services.zones)"
```

---

### Task 2: Helper puro de cálculo por zona (TDD)

**Files:**
- Create: `src/lib/servicios/zones.ts`
- Test: `src/lib/servicios/zones.test.ts`

**Interfaces:**
- Produces:
  - `type Zone = { id: string; name: string; durationMin: number }`
  - `type ZoneSnapshot = { name: string; duration_min: number }`
  - `type ZonePricing = { priceCents: number; durationMin: number; zones: ZoneSnapshot[] }`
  - `computeZonePricing(selectedZones: Zone[], pricePerZoneCents: number): ZonePricing`
  - `resolveSelectedZones(zoneIds: string[], available: Zone[]): Zone[] | null`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from "vitest"
import { computeZonePricing, resolveSelectedZones, type Zone } from "./zones"

const ZONES: Zone[] = [
  { id: "a", name: "Abdomen", durationMin: 30 },
  { id: "b", name: "Piernas", durationMin: 45 },
  { id: "c", name: "Brazos", durationMin: 20 },
]

describe("computeZonePricing", () => {
  it("precio = cantidad de zonas × precio por zona; duración = suma", () => {
    const r = computeZonePricing([ZONES[0], ZONES[1]], 2_500_000)
    expect(r.priceCents).toBe(5_000_000)
    expect(r.durationMin).toBe(75)
    expect(r.zones).toEqual([
      { name: "Abdomen", duration_min: 30 },
      { name: "Piernas", duration_min: 45 },
    ])
  })

  it("una sola zona", () => {
    const r = computeZonePricing([ZONES[2]], 2_500_000)
    expect(r.priceCents).toBe(2_500_000)
    expect(r.durationMin).toBe(20)
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

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/lib/servicios/zones.test.ts`
Expected: FAIL — "Failed to resolve import './zones'".

- [ ] **Step 3: Implementar el helper**

```ts
export type Zone = { id: string; name: string; durationMin: number }
export type ZoneSnapshot = { name: string; duration_min: number }
export type ZonePricing = { priceCents: number; durationMin: number; zones: ZoneSnapshot[] }

/** Precio (cantidad × precio-por-zona) y duración (suma) de las zonas elegidas. */
export function computeZonePricing(
  selectedZones: Zone[],
  pricePerZoneCents: number
): ZonePricing {
  return {
    priceCents: selectedZones.length * pricePerZoneCents,
    durationMin: selectedZones.reduce((a, z) => a + z.durationMin, 0),
    zones: selectedZones.map((z) => ({ name: z.name, duration_min: z.durationMin })),
  }
}

/**
 * Resuelve los IDs elegidos contra las zonas disponibles del servicio.
 * Devuelve null si la selección está vacía o algún ID no pertenece al servicio.
 */
export function resolveSelectedZones(zoneIds: string[], available: Zone[]): Zone[] | null {
  if (zoneIds.length === 0) return null
  const byId = new Map(available.map((z) => [z.id, z]))
  const resolved: Zone[] = []
  for (const id of zoneIds) {
    const z = byId.get(id)
    if (!z) return null
    resolved.push(z)
  }
  return resolved
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/lib/servicios/zones.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/servicios/zones.ts src/lib/servicios/zones.test.ts
git commit -m "feat: helper puro de cálculo precio/duración por zona"
```

---

### Task 3: Acciones admin — crear/editar servicio por zona + sync de zonas

**Files:**
- Modify: `src/app/admin/actions.ts` (`ServicePatch` ~363-372, `updateService` ~374-392, `createService` ~602-639)

**Interfaces:**
- Consumes: nada de Task 2 (solo DB).
- Produces:
  - `createService(categoryId, data)` donde `data` gana `pricing_mode: "fixed" | "per_zone"` y `zones: { name: string; duration_min: number }[]`.
  - `updateService(serviceId, patch)` donde `patch` gana `pricing_mode` y `zones`.

- [ ] **Step 1: Extender `ServicePatch` y `updateService`**

Reemplazar el bloque `const ServicePatch = z.object({...})` (líneas ~363-372) por:

```ts
const ZoneInput = z.object({
  name: z.string().trim().min(1),
  duration_min: z.number().int().positive(),
})

const ServicePatch = z.object({
  name: z.string().min(1),
  description: z.string().nullable(),
  pricing_mode: z.enum(["fixed", "per_zone"]),
  duration_min: z.number().int().nonnegative(),
  price_cents: z.number().int().nonnegative(),
  points_earned: z.number().int().nonnegative(),
  points_cost: z.number().int().nonnegative(),
  active: z.boolean(),
  visible_public: z.boolean(),
  zones: z.array(ZoneInput).default([]),
})
```

Reemplazar el cuerpo de `updateService` (líneas ~374-392) por:

```ts
export async function updateService(
  serviceId: string,
  patch: z.infer<typeof ServicePatch>
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const parsed = ServicePatch.safeParse(patch)
  if (!parsed.success) return { ok: false, error: "Datos inválidos" }
  const v = parsed.data
  if (v.pricing_mode === "per_zone" && v.zones.length === 0)
    return { ok: false, error: "Un servicio por zona necesita al menos una zona." }

  const admin = adminClient()
  const { zones, ...serviceFields } = v
  const { error } = await admin
    .from("services")
    .update({ ...serviceFields, duration_min: v.pricing_mode === "per_zone" ? 0 : v.duration_min })
    .eq("id", serviceId)
  if (error) return { ok: false, error: error.message }

  const syncErr = await syncServiceZones(admin, serviceId, v.pricing_mode, zones)
  if (syncErr) return { ok: false, error: syncErr }

  revalidatePath("/admin/servicios")
  revalidatePath(`/admin/servicios/${serviceId}`)
  return { ok: true }
}

// Reemplaza todas las zonas del servicio por la lista dada (delete-all + insert).
// Para servicios 'fixed' deja la tabla sin zonas.
async function syncServiceZones(
  admin: ReturnType<typeof adminClient>,
  serviceId: string,
  pricingMode: "fixed" | "per_zone",
  zones: { name: string; duration_min: number }[]
): Promise<string | null> {
  const { error: delErr } = await admin.from("service_zones").delete().eq("service_id", serviceId)
  if (delErr) return delErr.message
  if (pricingMode !== "per_zone" || zones.length === 0) return null
  const rows = zones.map((z, i) => ({
    service_id: serviceId,
    name: z.name.trim(),
    duration_min: z.duration_min,
    order_index: i,
  }))
  const { error: insErr } = await admin.from("service_zones").insert(rows)
  return insErr ? insErr.message : null
}
```

- [ ] **Step 2: Extender `createService`**

Reemplazar la firma y cuerpo de `createService` (líneas ~602-639) por:

```ts
export async function createService(
  categoryId: string,
  data: {
    name: string
    description: string
    pricing_mode: "fixed" | "per_zone"
    duration_min: number
    price_cents: number
    points_earned: number
    points_cost: number
    zones: { name: string; duration_min: number }[]
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireStaff()
  if (!data.name.trim()) return { ok: false, error: "El nombre es obligatorio" }
  if (data.pricing_mode === "fixed" && data.duration_min < 1)
    return { ok: false, error: "La duración debe ser mayor a 0" }
  if (data.pricing_mode === "per_zone" && data.zones.length === 0)
    return { ok: false, error: "Un servicio por zona necesita al menos una zona." }

  const admin = adminClient()
  const slug = toSlug(data.name) + "-" + Date.now()
  const { data: created, error } = await admin
    .from("services")
    .insert({
      category_id: categoryId,
      slug,
      name: data.name.trim(),
      description: data.description.trim() || null,
      pricing_mode: data.pricing_mode,
      duration_min: data.pricing_mode === "per_zone" ? 0 : data.duration_min,
      price_cents: data.price_cents,
      points_earned: data.points_earned,
      points_cost: data.points_cost,
      active: true,
      visible_public: true,
    })
    .select("id")
    .single()

  if (error) return { ok: false, error: error.message }

  const syncErr = await syncServiceZones(admin, created.id, data.pricing_mode, data.zones)
  if (syncErr) return { ok: false, error: syncErr }

  revalidatePath("/admin/servicios")
  return { ok: true, id: created.id }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errores (los llamadores del form se actualizan en Tasks 4 y 5; si `tsc` marca los forms, es esperado hasta completarlos — continuar y re-chequear al final de Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "feat(admin): createService/updateService soportan modo por zona + sync de zonas"
```

---

### Task 4: Form de alta de servicio (por zona)

**Files:**
- Modify: `src/app/admin/servicios/nuevo/new-service-form.tsx`

**Interfaces:**
- Consumes: `createService` de Task 3 (con `pricing_mode` y `zones`).

- [ ] **Step 1: Agregar estado de modo y zonas**

En el `useState` inicial (líneas ~17-25) agregar los campos:

```ts
  const [data, setData] = useState({
    categoryId: defaultCategoryId || categories[0]?.id || "",
    name: "",
    description: "",
    pricing_mode: "fixed" as "fixed" | "per_zone",
    duration_min: 60,
    price_cents: 0,
    points_earned: 0,
    points_cost: 0,
  })
  const [zones, setZones] = useState<{ name: string; duration_min: number }[]>([])
```

- [ ] **Step 2: Pasar modo + zonas a `createService`**

Reemplazar la llamada dentro de `save` (líneas ~30-37) por:

```ts
      const r = await createService(data.categoryId, {
        name: data.name,
        description: data.description,
        pricing_mode: data.pricing_mode,
        duration_min: data.duration_min,
        price_cents: data.price_cents,
        points_earned: data.points_earned,
        points_cost: data.points_cost,
        zones: data.pricing_mode === "per_zone" ? zones : [],
      })
```

- [ ] **Step 3: UI de modo por zona + editor de zonas**

Reemplazar el bloque `<div className="adm-grid"> ... Duración / Precio ... </div>` (líneas ~80-100) por:

```tsx
      <Field label="Modo de cobro">
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={data.pricing_mode === "per_zone"}
            onChange={(e) => setData({ ...data, pricing_mode: e.target.checked ? "per_zone" : "fixed" })}
            style={{ width: 16, height: 16 }}
          />
          <span>Cobrar por zona (la duración depende de las zonas elegidas)</span>
        </label>
      </Field>

      <div className="adm-grid">
        {data.pricing_mode === "fixed" && (
          <Field label="Duración (minutos)">
            <input
              className="adm-input"
              type="number"
              min={1}
              value={data.duration_min}
              onChange={(e) => setData({ ...data, duration_min: parseInt(e.target.value) || 0 })}
            />
          </Field>
        )}
        <Field label={data.pricing_mode === "per_zone" ? "Precio por zona (en pesos)" : "Precio (en pesos)"}>
          <input
            className="adm-input"
            type="number"
            min={0}
            step={500}
            value={Math.round(data.price_cents / 100)}
            onChange={(e) => setData({ ...data, price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
          />
        </Field>
      </div>

      {data.pricing_mode === "per_zone" && (
        <ZonesEditor zones={zones} setZones={setZones} />
      )}
```

- [ ] **Step 4: Agregar el componente `ZonesEditor`**

Al final del archivo (después de la función `Field`), agregar:

```tsx
function ZonesEditor({
  zones,
  setZones,
}: {
  zones: { name: string; duration_min: number }[]
  setZones: (z: { name: string; duration_min: number }[]) => void
}) {
  const update = (i: number, patch: Partial<{ name: string; duration_min: number }>) =>
    setZones(zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)))
  const remove = (i: number) => setZones(zones.filter((_, idx) => idx !== i))
  const add = () => setZones([...zones, { name: "", duration_min: 30 }])

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>Zonas (nombre + minutos)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {zones.map((z, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="adm-input"
              style={{ flex: 1 }}
              placeholder="Ej: Abdomen"
              value={z.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="adm-input"
              type="number"
              min={1}
              style={{ width: 90 }}
              value={z.duration_min}
              onChange={(e) => update(i, { duration_min: parseInt(e.target.value) || 0 })}
            />
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>min</span>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => remove(i)}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="adm-btn adm-btn--ghost" style={{ marginTop: 8 }} onClick={add}>
        + Agregar zona
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/servicios/nuevo/new-service-form.tsx`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/servicios/nuevo/new-service-form.tsx
git commit -m "feat(admin): alta de servicio con modo por zona + editor de zonas"
```

---

### Task 5: Editor de servicio existente (por zona)

**Files:**
- Modify: `src/app/admin/servicios/[id]/page.tsx` (`ServiceRow` ~8-19; select ~49-53; cargar zonas; pasar a editor)
- Modify: `src/app/admin/servicios/[id]/service-editor.tsx` (estado + UI + guardar)

**Interfaces:**
- Consumes: `updateService` de Task 3; `ZonesEditor` (se replica local en este archivo).
- Produces: `ServiceRow` gana `pricing_mode`; `ServiceEditor` recibe `initialZones`.

- [ ] **Step 1: `page.tsx` — cargar `pricing_mode` y zonas**

Agregar `pricing_mode` al tipo `ServiceRow` (después de `visible_public`):

```ts
export type ServiceRow = {
  id: string
  category_id: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number
  points_earned: number
  points_cost: number
  active: boolean
  visible_public: boolean
  pricing_mode: "fixed" | "per_zone"
}
```

En el `.select(...)` del servicio (línea ~51) agregar `pricing_mode`:

```ts
        .select("id, category_id, name, description, duration_min, price_cents, points_earned, points_cost, active, visible_public, pricing_mode")
```

Después de `if (!service) notFound()` (línea ~79) agregar la carga de zonas:

```ts
  const { data: zoneRows } = await admin
    .from("service_zones")
    .select("name, duration_min, order_index")
    .eq("service_id", id)
    .order("order_index", { ascending: true })
  const initialZones = (zoneRows ?? []).map((z: { name: string; duration_min: number }) => ({
    name: z.name,
    duration_min: z.duration_min,
  }))
```

Y pasar la prop al editor (línea ~118):

```tsx
      <ServiceEditor service={service} professionals={professionals} otherServices={otherServices} initialZones={initialZones} />
```

- [ ] **Step 2: `service-editor.tsx` — prop + estado**

En la firma del componente (líneas ~8-16) agregar `initialZones`:

```tsx
export default function ServiceEditor({
  service,
  professionals,
  otherServices,
  initialZones,
}: {
  service: ServiceRow
  professionals: ProfessionalRow[]
  otherServices: OtherService[]
  initialZones: { name: string; duration_min: number }[]
}) {
```

En el `useState` de `data` (líneas ~73-82) agregar `pricing_mode`, y agregar el estado de zonas justo debajo:

```tsx
  const [data, setData] = useState({
    name: service.name,
    description: service.description ?? "",
    pricing_mode: service.pricing_mode,
    duration_min: service.duration_min,
    price_cents: service.price_cents,
    points_earned: service.points_earned,
    points_cost: service.points_cost,
    active: service.active,
    visible_public: service.visible_public,
  })
  const [zones, setZones] = useState<{ name: string; duration_min: number }[]>(initialZones)
```

- [ ] **Step 3: `service-editor.tsx` — enviar zonas en `save`**

Reemplazar la llamada a `updateService` dentro de `save` (líneas ~103-106) por:

```tsx
      const r = await updateService(service.id, {
        ...data,
        description: data.description || null,
        zones: data.pricing_mode === "per_zone" ? zones : [],
      })
```

- [ ] **Step 4: `service-editor.tsx` — UI de modo + editor de zonas**

Reemplazar el bloque `<div className="adm-grid"> ... Duración / Precio ...</div>` (líneas ~135-162) por:

```tsx
      <Field label="Modo de cobro">
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={data.pricing_mode === "per_zone"}
            onChange={(e) => setData({ ...data, pricing_mode: e.target.checked ? "per_zone" : "fixed" })}
            style={{ width: 16, height: 16 }}
          />
          <span>Cobrar por zona (la duración depende de las zonas elegidas)</span>
        </label>
      </Field>

      <div className="adm-grid">
        {data.pricing_mode === "fixed" && (
          <Field label="Duración (minutos)">
            <input
              className="adm-input"
              type="number"
              min={1}
              value={data.duration_min}
              onChange={(e) => setData({ ...data, duration_min: parseInt(e.target.value) || 0 })}
            />
          </Field>
        )}
        <Field label={data.pricing_mode === "per_zone" ? "Precio por zona (en pesos)" : "Precio (en pesos)"}>
          <input
            className="adm-input"
            type="number"
            min={0}
            step={500}
            value={Math.round(data.price_cents / 100)}
            onChange={(e) =>
              setData({ ...data, price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })
            }
          />
        </Field>
      </div>

      {data.pricing_mode === "per_zone" && <ZonesEditor zones={zones} setZones={setZones} />}
```

- [ ] **Step 5: `service-editor.tsx` — agregar `ZonesEditor`**

Al final del archivo (después de `Toggle`), agregar el mismo componente `ZonesEditor` que en Task 4 Step 4 (copiar el bloque completo — el implementador puede estar leyendo tareas fuera de orden):

```tsx
function ZonesEditor({
  zones,
  setZones,
}: {
  zones: { name: string; duration_min: number }[]
  setZones: (z: { name: string; duration_min: number }[]) => void
}) {
  const update = (i: number, patch: Partial<{ name: string; duration_min: number }>) =>
    setZones(zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z)))
  const remove = (i: number) => setZones(zones.filter((_, idx) => idx !== i))
  const add = () => setZones([...zones, { name: "", duration_min: 30 }])

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="adm-row__label" style={{ marginBottom: 6 }}>Zonas (nombre + minutos)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {zones.map((z, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="adm-input"
              style={{ flex: 1 }}
              placeholder="Ej: Abdomen"
              value={z.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <input
              className="adm-input"
              type="number"
              min={1}
              style={{ width: 90 }}
              value={z.duration_min}
              onChange={(e) => update(i, { duration_min: parseInt(e.target.value) || 0 })}
            />
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>min</span>
            <button type="button" className="adm-btn adm-btn--ghost" onClick={() => remove(i)}>✕</button>
          </div>
        ))}
      </div>
      <button type="button" className="adm-btn adm-btn--ghost" style={{ marginTop: 8 }} onClick={add}>
        + Agregar zona
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/servicios/ && npx next build`
Expected: 0 errores (ya con Tasks 3-5 completas, los llamadores de `createService`/`updateService` cierran).

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/servicios/[id]/page.tsx src/app/admin/servicios/[id]/service-editor.tsx
git commit -m "feat(admin): editar servicio por zona (modo + zonas persistidas)"
```

---

### Task 6: Catálogo de reserva — exponer modo y zonas

**Files:**
- Modify: `src/app/reserva/data.ts` (`Service` type ~1-8)
- Modify: `src/app/reserva/queries.ts` (`DbServiceRow` ~30-40, `fetchCatalog` select+map ~57-88)

**Interfaces:**
- Produces: `Service` gana `pricingMode: "fixed" | "per_zone"` y `zones: ServiceZone[]`; `price` para `per_zone` = precio **por zona** (pesos).

- [ ] **Step 1: `data.ts` — tipos**

Reemplazar el `export type Service` (líneas ~1-8) por:

```ts
export type ServiceZone = {
  id: string
  name: string
  durationMin: number
}

export type Service = {
  id: string
  name: string
  duration: number       // per_zone: 0 (la duración sale de las zonas)
  price: number          // per_zone: precio POR ZONA (pesos)
  desc: string
  pointsCost: number
  pricingMode: "fixed" | "per_zone"
  zones: ServiceZone[]   // vacío para 'fixed'
}
```

- [ ] **Step 2: `queries.ts` — fila de DB + select**

Reemplazar `type DbServiceRow` (líneas ~30-40) por:

```ts
type DbServiceRow = {
  id: string
  slug: string
  name: string
  description: string | null
  duration_min: number
  price_cents: number
  points_cost: number
  active: boolean
  visible_public: boolean
  pricing_mode: "fixed" | "per_zone"
  service_zones: { id: string; name: string; duration_min: number; active: boolean; order_index: number }[]
}
```

En `fetchCatalog`, reemplazar la línea del sub-select de servicios (línea ~62) por:

```ts
      services:services(id, slug, name, description, duration_min, price_cents, points_cost, active, visible_public, pricing_mode, service_zones(id, name, duration_min, active, order_index))
```

- [ ] **Step 3: `queries.ts` — map a `Service`**

Reemplazar el `.map((s): Service => ({...}))` del catálogo (líneas ~77-86) por:

```ts
      .map(
        (s): Service => ({
          id: s.id,
          name: s.name,
          duration: s.duration_min,
          price: Math.round(s.price_cents / 100),
          desc: s.description ?? "",
          pointsCost: s.points_cost,
          pricingMode: s.pricing_mode,
          zones: (s.service_zones ?? [])
            .filter((z) => z.active)
            .sort((a, b) => a.order_index - b.order_index)
            .map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min })),
        })
      ),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `screens.tsx` puede marcar que faltan `pricingMode`/`zones` en algún literal de `Service`, o que `combos`/`fetchCombos` arma `Service` sin los campos nuevos. **Cerrar también `fetchCombos`** (líneas ~216-223) agregando a cada `Service`:

```ts
        pricingMode: "fixed",
        zones: [],
```
(Los combos no incluyen servicios por zona — ver spec §7.)
Volver a correr: `npx tsc --noEmit` → los únicos errores restantes deben ser de `screens.tsx` (se resuelve en Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/data.ts src/app/reserva/queries.ts
git commit -m "feat(reserva): catálogo expone pricing_mode y zonas del servicio"
```

---

### Task 7: Reserva servidor — precio/duración por zona + snapshot

**Files:**
- Modify: `src/app/reserva/actions.ts` (`BookingInput` ~11-42; select de services ~69-80; armado de `appointment_services` ~243-267)

**Interfaces:**
- Consumes: `computeZonePricing`, `resolveSelectedZones`, `type Zone`, `type ZoneSnapshot` de Task 2.
- Produces: `createBooking` acepta `zoneSelections?: Record<string, string[]>` y calcula precio/duración por zona en el servidor.

- [ ] **Step 1: Importar el helper + extender el input**

Agregar el import (junto a los otros imports, ~línea 8):

```ts
import { computeZonePricing, resolveSelectedZones, type Zone, type ZoneSnapshot } from "@/lib/servicios/zones"
```

En `BookingInput` (dentro del `z.object({...})`, después de `comboId`, ~línea 21) agregar:

```ts
  zoneSelections: z.record(z.string().uuid(), z.array(z.string().uuid())).optional(),
```

- [ ] **Step 2: Traer `pricing_mode` + zonas y calcular por servicio**

Reemplazar el bloque de "1) Resolve services..." hasta el cálculo de `totalCents` (líneas ~68-91) por:

```ts
  // 1) Resolve services to compute totals + ends_at
  const { data: services, error: svcErr } = await supabase
    .from("services")
    .select("id, name, duration_min, price_cents, points_cost, pricing_mode")
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
      .select("id, service_id, name, duration_min")
      .in("service_id", perZoneIds)
      .eq("active", true)
    if (zErr) return { ok: false, error: `Zonas: ${zErr.message}` }
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min })
    }
  }

  // Precio/duración efectivos por servicio (+ snapshot de zonas para per_zone).
  const computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }> = {}
  for (const s of services) {
    if (s.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(input.zoneSelections?.[s.id] ?? [], zonesByService[s.id] ?? [])
      if (!selected) return { ok: false, error: "Elegí al menos una zona válida para el servicio por zona." }
      const p = computeZonePricing(selected, s.price_cents)
      computed[s.id] = { durationMin: p.durationMin, priceCents: p.priceCents, zones: p.zones }
    } else {
      computed[s.id] = { durationMin: s.duration_min, priceCents: s.price_cents, zones: null }
    }
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
```

- [ ] **Step 3: Usar los valores calculados al armar `appointment_services`**

Reemplazar el bloque "6) Link services..." (líneas ~243-261) por:

```ts
  // 6) Link services — respecting sequential order and per-service staff/starts_at
  const orderedIds = input.serviceOrder ?? services.map((s) => s.id)
  const orderedServices = orderedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  let serviceMs = startsAt.getTime()
  const apptServices = orderedServices.map((s) => {
    const c = computed[s.id]
    const sStartsAt = new Date(serviceMs)
    serviceMs += c.durationMin * 60_000
    return {
      appointment_id: appt.id,
      service_id: s.id,
      duration_min: c.durationMin,
      price_cents: c.priceCents,
      zones: c.zones,
      staff_id: input.resolvedStaff?.[s.id] ?? mainStaffId,
      starts_at: sStartsAt.toISOString(),
    }
  })
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `actions.ts` (persisten los de `screens.tsx` hasta Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(reserva): precio/duración por zona en el servidor + snapshot de zonas"
```

---

### Task 8: Reserva UI — selector de zonas

**Files:**
- Modify: `src/app/reserva/screens.tsx` (pantalla de selección de servicios / resumen; y la llamada a `createBooking`)

**Interfaces:**
- Consumes: `Service.pricingMode` y `Service.zones` de Task 6; `createBooking(... zoneSelections)` de Task 7.

> **Antes de editar:** abrir `src/app/reserva/screens.tsx` y ubicar (a) dónde se togglea/ selecciona un `Service` y se calcula el resumen (`selected.reduce((a, s) => a + s.price, 0)` para precio y `... + s.duration` para duración), y (b) dónde se arma el objeto que se pasa a `createBooking` y a la disponibilidad (`ServiceInput.duration`). Las ediciones abajo se integran en esos puntos.

- [ ] **Step 1: Estado de zonas elegidas por servicio**

Junto al estado de la pantalla de servicios, agregar:

```tsx
  // serviceId → set de zoneId elegidas (solo para servicios pricingMode === "per_zone")
  const [zoneSel, setZoneSel] = useState<Record<string, string[]>>({})

  const toggleZone = (serviceId: string, zoneId: string) =>
    setZoneSel((prev) => {
      const cur = prev[serviceId] ?? []
      const next = cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
      return { ...prev, [serviceId]: next }
    })
```

- [ ] **Step 2: Helper de precio/duración efectivos de un servicio elegido**

Agregar (dentro del componente o como función módulo) un cálculo reutilizable:

```tsx
  // Precio (pesos) y duración (min) efectivos de un servicio según el modo.
  const effective = (s: Service): { price: number; duration: number; count: number } => {
    if (s.pricingMode !== "per_zone") return { price: s.price, duration: s.duration, count: 1 }
    const ids = zoneSel[s.id] ?? []
    const chosen = s.zones.filter((z) => ids.includes(z.id))
    return {
      price: chosen.length * s.price, // s.price = precio por zona
      duration: chosen.reduce((a, z) => a + z.durationMin, 0),
      count: chosen.length,
    }
  }
```

- [ ] **Step 3: Render del selector de zonas**

Donde se muestra cada servicio seleccionable, cuando `s.pricingMode === "per_zone"` y el servicio está elegido, mostrar sus zonas como checkboxes:

```tsx
{s.pricingMode === "per_zone" && isSelected(s) && (
  <div style={{ marginTop: 8, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 6 }}>
    {s.zones.map((z) => (
      <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={(zoneSel[s.id] ?? []).includes(z.id)}
          onChange={() => toggleZone(s.id, z.id)}
          style={{ width: 15, height: 15 }}
        />
        <span>{z.name} · {z.durationMin} min</span>
      </label>
    ))}
    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
      {(() => { const e = effective(s); return e.count ? `${e.count} zona(s) · ${e.duration} min · ${fmtPrice(e.price)}` : "Elegí al menos una zona" })()}
    </span>
  </div>
)}
```

> `isSelected(s)` = la condición que ya usa la pantalla para saber si el servicio está en la selección. `fmtPrice` ya se importa desde `./data`.

- [ ] **Step 4: Usar `effective()` en el resumen y en la disponibilidad**

Reemplazar los cálculos de total precio/duración del resumen para que usen `effective(s)`:

```tsx
  const totalPrice = selectedCombo ? selectedCombo.price : selected.reduce((a, s) => a + effective(s).price, 0)
  const totalDuration = selectedCombo ? selectedCombo.duration : selected.reduce((a, s) => a + effective(s).duration, 0)
```

Y donde se arma la lista de `ServiceInput` para `fetchSequentialAvailability`, usar `effective(s).duration` como `duration`.

- [ ] **Step 5: Bloquear avance si falta elegir zonas + pasar `zoneSelections`**

Donde se valida que se pueda continuar desde la pantalla de servicios, exigir que todo servicio por zona elegido tenga ≥1 zona:

```tsx
  const zonesOk = selected.every((s) => s.pricingMode !== "per_zone" || (zoneSel[s.id]?.length ?? 0) >= 1)
```
Usar `zonesOk` como condición adicional para habilitar el botón "Continuar".

En la llamada a `createBooking`, agregar el campo:

```tsx
    zoneSelections: Object.fromEntries(
      selected.filter((s) => s.pricingMode === "per_zone").map((s) => [s.id, zoneSel[s.id] ?? []])
    ),
```

- [ ] **Step 6: Typecheck + lint + build**

Run: `npx tsc --noEmit && npx eslint src/app/reserva/ && npx next build`
Expected: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(reserva): selector de zonas con precio/duración por cantidad de zonas"
```

---

### Task 9: Admin "Nueva reserva" — catálogo con modo y zonas

**Files:**
- Modify: `src/app/admin/nueva-reserva/page.tsx` (`ServiceOption` ~8-14; select ~27-31; map ~33-45)

**Interfaces:**
- Produces: `ServiceOption` gana `pricing_mode: "fixed" | "per_zone"` y `zones: { id: string; name: string; durationMin: number }[]`.

- [ ] **Step 1: Extender `ServiceOption` y el select**

Reemplazar `export type ServiceOption` (líneas ~8-14) por:

```ts
export type ServiceOption = {
  id: string
  name: string
  duration_min: number
  price_cents: number
  category: string
  pricing_mode: "fixed" | "per_zone"
  zones: { id: string; name: string; durationMin: number }[]
}
```

Reemplazar el `.select(...)` (línea ~29) por:

```ts
    .select("id, name, duration_min, price_cents, pricing_mode, category:service_categories(name), service_zones(id, name, duration_min, active, order_index)")
```

- [ ] **Step 2: Mapear zonas**

Reemplazar el `.map((s) => ({...}))` (líneas ~39-45) por:

```ts
  }[]).map((s) => ({
    id: s.id,
    name: s.name,
    duration_min: s.duration_min,
    price_cents: s.price_cents,
    category: s.category?.name ?? "Sin categoría",
    pricing_mode: s.pricing_mode,
    zones: ((s as unknown as { service_zones?: { id: string; name: string; duration_min: number; active: boolean; order_index: number }[] }).service_zones ?? [])
      .filter((z) => z.active)
      .sort((a, b) => a.order_index - b.order_index)
      .map((z) => ({ id: z.id, name: z.name, durationMin: z.duration_min })),
  }))
```

Y actualizar el tipo intermedio del `as unknown as {...}[]` (líneas ~33-38) agregando `pricing_mode: "fixed" | "per_zone"` a ese literal de tipo.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errores esperados en `nueva-reserva-form.tsx` (se resuelven en Task 11) y posiblemente en `createAdminBooking` hasta Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/nueva-reserva/page.tsx
git commit -m "feat(admin): nueva-reserva expone pricing_mode y zonas"
```

---

### Task 10: Admin `createAdminBooking` — precio/duración por zona + snapshot

**Files:**
- Modify: `src/app/admin/actions.ts` (`AdminBookingInput` — buscar su `z.object`; `createAdminBooking` ~867-975)

**Interfaces:**
- Consumes: `computeZonePricing`, `resolveSelectedZones`, `type Zone`, `type ZoneSnapshot` de Task 2.
- Produces: `createAdminBooking` acepta `zoneSelections?: Record<string, string[]>`.

- [ ] **Step 1: Import + input**

Agregar el import arriba del archivo (junto a los otros):

```ts
import { computeZonePricing, resolveSelectedZones, type Zone, type ZoneSnapshot } from "@/lib/servicios/zones"
```

En el `z.object({...})` de `AdminBookingInput` agregar:

```ts
  zoneSelections: z.record(z.string().uuid(), z.array(z.string().uuid())).optional(),
```

- [ ] **Step 2: Cálculo por zona**

Reemplazar el bloque "1) Resolve services" hasta el cálculo de `totalCents` (líneas ~873-881) por:

```ts
  // 1) Resolve services
  const { data: services, error: svcErr } = await admin
    .from("services")
    .select("id, name, duration_min, price_cents, pricing_mode")
    .in("id", input.serviceIds)
  if (svcErr || !services?.length) return { ok: false, error: "Servicios no encontrados." }

  const perZoneIds = services.filter((s) => s.pricing_mode === "per_zone").map((s) => s.id)
  const zonesByService: Record<string, Zone[]> = {}
  if (perZoneIds.length) {
    const { data: zoneRows } = await admin
      .from("service_zones")
      .select("id, service_id, name, duration_min")
      .in("service_id", perZoneIds)
      .eq("active", true)
    for (const z of zoneRows ?? []) {
      ;(zonesByService[z.service_id] ??= []).push({ id: z.id, name: z.name, durationMin: z.duration_min })
    }
  }

  const computed: Record<string, { durationMin: number; priceCents: number; zones: ZoneSnapshot[] | null }> = {}
  for (const s of services) {
    if (s.pricing_mode === "per_zone") {
      const selected = resolveSelectedZones(input.zoneSelections?.[s.id] ?? [], zonesByService[s.id] ?? [])
      if (!selected) return { ok: false, error: "Elegí al menos una zona válida para el servicio por zona." }
      const p = computeZonePricing(selected, s.price_cents)
      computed[s.id] = { durationMin: p.durationMin, priceCents: p.priceCents, zones: p.zones }
    } else {
      computed[s.id] = { durationMin: s.duration_min, priceCents: s.price_cents, zones: null }
    }
  }

  const totalDuration = services.reduce((a, s) => a + computed[s.id].durationMin, 0)
  const totalCents = services.reduce((a, s) => a + computed[s.id].priceCents, 0)
```

- [ ] **Step 3: Snapshot en `appointment_services`**

Reemplazar el mapeo de `apptServices` (líneas ~960-972) por:

```ts
  let ms = startsAt.getTime()
  const apptServices = orderedServices.map((s) => {
    const c = computed[s.id]
    const sStartsAt = new Date(ms)
    ms += c.durationMin * 60_000
    return {
      appointment_id: appt.id,
      service_id: s.id,
      duration_min: c.durationMin,
      price_cents: c.priceCents,
      zones: c.zones,
      staff_id: input.resolvedStaff[s.id] ?? mainStaffId,
      starts_at: sStartsAt.toISOString(),
    }
  })
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `actions.ts` (persisten los de `nueva-reserva-form.tsx` hasta Task 11).

```bash
git add src/app/admin/actions.ts
git commit -m "feat(admin): createAdminBooking calcula por zona + snapshot de zonas"
```

---

### Task 11: Admin "Nueva reserva" — selector de zonas en el form

**Files:**
- Modify: `src/app/admin/nueva-reserva/nueva-reserva-form.tsx`

**Interfaces:**
- Consumes: `ServiceOption.pricing_mode`/`zones` de Task 9; `createAdminBooking(... zoneSelections)` de Task 10.

- [ ] **Step 1: Estado + helper efectivo**

Junto a `const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())` (línea ~45) agregar:

```tsx
  const [zoneSel, setZoneSel] = useState<Record<string, string[]>>({})
  const toggleZone = (serviceId: string, zoneId: string) =>
    setZoneSel((prev) => {
      const cur = prev[serviceId] ?? []
      const next = cur.includes(zoneId) ? cur.filter((z) => z !== zoneId) : [...cur, zoneId]
      return { ...prev, [serviceId]: next }
    })
  const effective = (s: ServiceOption): { priceCents: number; duration: number; count: number } => {
    if (s.pricing_mode !== "per_zone") return { priceCents: s.price_cents, duration: s.duration_min, count: 1 }
    const ids = zoneSel[s.id] ?? []
    const chosen = s.zones.filter((z) => ids.includes(z.id))
    return { priceCents: chosen.length * s.price_cents, duration: chosen.reduce((a, z) => a + z.durationMin, 0), count: chosen.length }
  }
```

- [ ] **Step 2: Totales y disponibilidad usan `effective()`**

Reemplazar `totalMin`/`totalCents` (líneas ~147-148) por:

```tsx
  const totalMin = selectedServices.reduce((a, s) => a + effective(s).duration, 0)
  const totalCents = selectedServices.reduce((a, s) => a + effective(s).priceCents, 0)
```

En `loadSlots` (líneas ~77-79) usar la duración efectiva:

```tsx
    const svcs = services
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, duration: effective(s).duration, staffId: "auto" }))
```

- [ ] **Step 3: Render del selector de zonas (Step 1 de servicios)**

Dentro del `<label>` de cada servicio (después del `</label>` de cada `s` en el `.map`, líneas ~329-356), envolver o agregar debajo el bloque de zonas. Reemplazar el cierre del map de servicios para incluir, tras el `<label>...</label>`:

```tsx
                  {s.pricing_mode === "per_zone" && selectedIds.has(s.id) && (
                    <div style={{ paddingLeft: 34, display: "flex", flexDirection: "column", gap: 6, marginTop: 4, marginBottom: 4 }}>
                      {s.zones.map((z) => (
                        <label key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={(zoneSel[s.id] ?? []).includes(z.id)}
                            onChange={() => { toggleZone(s.id, z.id); setSelectedSlot(null) }}
                            style={{ width: 15, height: 15 }}
                          />
                          <span>{z.name} · {z.durationMin} min</span>
                        </label>
                      ))}
                      <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                        {(() => { const e = effective(s); return e.count ? `${e.count} zona(s) · ${e.duration} min · ${fmtPrice(e.priceCents / 100)}` : "Elegí al menos una zona" })()}
                      </span>
                    </div>
                  )}
```

> Nota: para que el bloque quede fuera del `<label>` (un checkbox de zona no debe estar anidado en el label del servicio), moverlo a nivel del contenedor del servicio. Envolver el `<label>` del servicio y este bloque en un `<div key={s.id}>` y quitar el `key` del `<label>`.

- [ ] **Step 4: Validación de servicios + enviar `zoneSelections`**

Reemplazar `const servicesValid = selectedIds.size > 0` (línea ~102) por:

```tsx
  const servicesValid = selectedIds.size > 0 &&
    selectedServices.every((s) => s.pricing_mode !== "per_zone" || (zoneSel[s.id]?.length ?? 0) >= 1)
```

En la llamada a `createAdminBooking` (líneas ~125-135) agregar el campo:

```tsx
        zoneSelections: Object.fromEntries(
          selectedServices.filter((s) => s.pricing_mode === "per_zone").map((s) => [s.id, zoneSel[s.id] ?? []])
        ),
```

- [ ] **Step 5: Typecheck + lint + build + commit**

Run: `npx tsc --noEmit && npx eslint src/app/admin/nueva-reserva/ && npx next build`
Expected: 0 errores.

```bash
git add src/app/admin/nueva-reserva/nueva-reserva-form.tsx
git commit -m "feat(admin): selector de zonas en Nueva reserva"
```

---

### Task 12: Verificación end-to-end (manual)

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr toda la batería**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build`
Expected: tests PASS, 0 errores de tipos/lint, build OK.

- [ ] **Step 2: Smoke manual (dev)**

Run: `npm run dev`
Verificar:
1. Admin → Servicios → Nuevo: activar "Cobrar por zona", cargar precio por zona (25000) y 2-3 zonas con minutos. Guardar → redirige al editor y las zonas persisten al recargar.
2. Editar ese servicio: cambiar minutos de una zona, agregar/borrar una zona, guardar, recargar → refleja los cambios.
3. Reserva online (`/reserva`): elegir ese servicio → aparecen las zonas; tildar 2 → el resumen muestra 2 × precio y la suma de minutos; "Continuar" se habilita sólo con ≥1 zona.
4. Admin → **Nueva reserva**: elegir el servicio por zona → aparecen las zonas; tildar 2 → totales y horarios usan la duración de las zonas; crear el turno.
5. En la DB, para ambos flujos: `appointments.total_cents` y `duration_min` corresponden a las zonas; `appointment_services.zones` tiene el snapshot `[{name,duration_min}]`.

- [ ] **Step 3: Commit (si hubo ajustes del smoke)**

```bash
git add -A && git commit -m "fix: ajustes del smoke de servicio por zona"
```

---

## Notas de alcance

- **Este plan es la Fase 1.** La **Fase 2 (packs/promos + selección de packs en la reserva con seña 30%)** se escribe como un plan aparte (`docs/superpowers/plans/2026-07-01-packs-por-zona.md`) una vez que la Fase 1 esté construida y verificada, porque depende de estas tablas y del flujo de reserva por zona.
- Fuera de alcance en Fase 1 (ver spec §7-8): packs, combos con servicios por zona, canje por puntos de servicios por zona.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-01-servicio-por-zona-design.md`
- Reserva actual: `src/app/reserva/{actions.ts,data.ts,queries.ts,screens.tsx}`
- Admin servicios: `src/app/admin/servicios/**`, `src/app/admin/actions.ts`
