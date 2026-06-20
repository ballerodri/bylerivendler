# Packs de sesiones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Definir y mostrar packs de sesiones (un servicio × N sesiones a precio especial, con intervalo entre sesiones): CRUD en el admin (espejo de Combos) + una página pública `/packs` informativa con CTA de WhatsApp.

**Architecture:** Tabla nueva `packs` (una fila por pack, FK a un único `services.id`). El admin gestiona los packs con el mismo patrón que Combos (lista + form + nuevo/editar + activar/eliminar), con Server Actions en un archivo dedicado `src/app/admin/packs/actions.ts`. La web muestra los packs activos en una página server-render `/packs` (no se reserva online; CTA WhatsApp). Sin conteo de sesiones (v1).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-20-packs-sesiones-design.md`

## Global Constraints

- **Patrón a espejar:** `src/app/admin/combos/` (lista `page.tsx`, `combo-form.tsx`, `active-toggle.tsx`, `delete-button.tsx`, `nuevo/page.tsx`, `[id]/page.tsx`) y las combo-actions en `src/app/admin/actions.ts` (`createCombo`/`updateCombo`/`toggleComboActive`/`deleteCombo`). Para packs las actions van en un archivo **dedicado** `src/app/admin/packs/actions.ts`.
- **Convenciones admin:** páginas Server Components con `export const dynamic = "force-dynamic"`, cliente service-role (`createClient` de `@supabase/supabase-js`, `persistSession:false`), clases `adm-*`. Acciones interactivas = Client Components que llaman Server Actions.
- **Server Actions:** `"use server"` — solo exportan funciones async. Validan admin (patrón `requireAdmin_action`: `getUser()` → `requireAdmin(user.id)`).
- **Dinero:** centavos (int) en la base; en la UI se formatea con `fmtPrice` de `@/app/reserva/data` (recibe pesos: `fmtPrice(cents/100)`); el monto en pesos del form se pasa a centavos con `Math.round(pesos*100)`.
- **RLS:** `packs` con lectura pública (`select using (true)`, la reserva/web pública la necesita) + escritura staff (`public.is_staff()`); las escrituras del admin igual usan service-role (bypass), como Combos.
- **WhatsApp:** `whatsappLink(message?)` de `@/lib/whatsapp` devuelve el link al WhatsApp del negocio con mensaje pre-cargado.
- **Next.js no estándar:** antes de escribir páginas/route handlers, mirar la guía en `node_modules/next/dist/docs/` si hay dudas (ver `AGENTS.md`). En Next 16 los `params` de páginas son `Promise`.
- **Idioma:** identificadores en inglés/snake_case; textos de UI en español.

---

### Task 1: Migración — tabla `packs`

**Files:**
- Create: `supabase/migrations/20260620_packs.sql`

**Interfaces:**
- Produces: tabla `public.packs` (lectura pública, escritura staff).

- [ ] **Step 1: Crear la migración**

```sql
-- Packs de sesiones: un servicio repetido N veces a precio especial.
create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  description text,
  sessions int not null check (sessions >= 1),
  interval_days int check (interval_days is null or interval_days > 0),
  total_price_cents int not null check (total_price_cents >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_packs_service on public.packs(service_id);

alter table public.packs enable row level security;

drop policy if exists "packs_select_all" on public.packs;
create policy "packs_select_all" on public.packs for select using (true);

drop policy if exists "packs_staff_write" on public.packs;
create policy "packs_staff_write" on public.packs
  for all using (public.is_staff()) with check (public.is_staff());
```

- [ ] **Step 2: Aplicar en Supabase**

Aplicar el SQL (SQL Editor del dashboard o `supabase db push`).
Expected: tabla `public.packs` existe, sin errores. *(Apply = usuaria; no hay credenciales en el entorno de implementación.)*

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260620_packs.sql
git commit -m "feat: tabla packs (sesiones de un servicio a precio especial)"
```

---

### Task 2: Server Actions de packs

**Files:**
- Create: `src/app/admin/packs/actions.ts`

**Interfaces:**
- Produces:
  - `type PackInput = { serviceId: string; name: string; description?: string; sessions: number; intervalDays?: number | null; totalPriceCents: number }`
  - `createPack(input: PackInput): Promise<{ ok: boolean; error?: string; id?: string }>`
  - `updatePack(id: string, input: PackInput): Promise<{ ok: boolean; error?: string }>`
  - `togglePackActive(id: string, active: boolean): Promise<{ ok: boolean; error?: string }>`
  - `deletePack(id: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar `src/app/admin/packs/actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"

export type PackInput = {
  serviceId: string
  name: string
  description?: string
  sessions: number
  intervalDays?: number | null
  totalPriceCents: number
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function requireAdminAction() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) throw new Error("Sin sesión")
  await requireAdmin(user.id)
}

function row(input: PackInput) {
  return {
    service_id: input.serviceId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sessions: input.sessions,
    interval_days: input.intervalDays ?? null,
    total_price_cents: input.totalPriceCents,
  }
}

export async function createPack(
  input: PackInput
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { data, error } = await admin
    .from("packs")
    .insert({ ...row(input), active: false })
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message }
  revalidatePath("/admin/packs")
  return { ok: true, id: data.id }
}

export async function updatePack(
  id: string,
  input: PackInput
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").update(row(input)).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath(`/admin/packs/${id}`)
  return { ok: true }
}

export async function togglePackActive(
  id: string,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").update({ active }).eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath("/packs")
  return { ok: true }
}

export async function deletePack(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()
  const { error } = await admin.from("packs").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/packs")
  revalidatePath("/packs")
  return { ok: true }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/packs/actions.ts
git commit -m "feat: server actions de packs (CRUD)"
```

---

### Task 3: Formulario de pack (client)

**Files:**
- Create: `src/app/admin/packs/pack-form.tsx`

**Interfaces:**
- Consumes: `createPack`, `updatePack`, `PackInput` (de `./actions`); `fmtPrice` (de `@/app/reserva/data`).
- Produces:
  - `type ServiceOption = { id: string; name: string; price_cents: number; category: string }`
  - `default PackForm({ services, initial }: { services: ServiceOption[]; initial?: { id: string; serviceId: string; name: string; description: string; sessions: number; intervalDays: number | null; totalPriceCents: number } })`

- [ ] **Step 1: Implementar `src/app/admin/packs/pack-form.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createPack, updatePack } from "./actions"
import { fmtPrice } from "../../reserva/data"

export type ServiceOption = {
  id: string
  name: string
  price_cents: number
  category: string
}

type Props = {
  services: ServiceOption[]
  initial?: {
    id: string
    serviceId: string
    name: string
    description: string
    sessions: number
    intervalDays: number | null
    totalPriceCents: number
  }
}

export default function PackForm({ services, initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [serviceId, setServiceId] = useState(initial?.serviceId ?? services[0]?.id ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [sessions, setSessions] = useState(initial ? String(initial.sessions) : "")
  const [intervalDays, setIntervalDays] = useState(
    initial?.intervalDays != null ? String(initial.intervalDays) : ""
  )
  const [priceInput, setPriceInput] = useState(
    initial ? String(Math.round(initial.totalPriceCents / 100)) : ""
  )

  const sessionsNum = parseInt(sessions, 10) || 0
  const totalPriceCents = Math.round((parseFloat(priceInput) || 0) * 100)
  const service = services.find((s) => s.id === serviceId)
  const fullPriceCents = service ? service.price_cents * sessionsNum : 0
  const saving = fullPriceCents - totalPriceCents

  const handleSubmit = () => {
    if (!serviceId) { setError("Elegí un servicio."); return }
    if (!name.trim()) { setError("El nombre es obligatorio."); return }
    if (sessionsNum < 1) { setError("La cantidad de sesiones debe ser al menos 1."); return }
    if (totalPriceCents <= 0) { setError("Ingresá el precio del pack."); return }

    const intervalNum = intervalDays.trim() ? parseInt(intervalDays, 10) : null
    if (intervalNum != null && (isNaN(intervalNum) || intervalNum <= 0)) {
      setError("El intervalo debe ser un número de días mayor a 0 (o dejalo vacío)."); return
    }

    setError(null)
    startTransition(async () => {
      const input = {
        serviceId,
        name,
        description,
        sessions: sessionsNum,
        intervalDays: intervalNum,
        totalPriceCents,
      }
      const r = initial ? await updatePack(initial.id, input) : await createPack(input)
      if (r.ok) router.push("/admin/packs")
      else setError(r.error ?? "Error al guardar.")
    })
  }

  return (
    <div className="adm-card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label className="adm-label">Servicio *</label>
        <select className="adm-input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {fmtPrice(s.price_cents / 100)} c/u</option>
          ))}
        </select>
      </div>

      <div>
        <label className="adm-label">Nombre *</label>
        <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Pack 6 sesiones piernas" />
      </div>

      <div>
        <label className="adm-label">Descripción (opcional)</label>
        <input className="adm-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve descripción para la clienta" />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label className="adm-label">Cantidad de sesiones *</label>
          <input className="adm-input" type="number" min="1" value={sessions} onChange={(e) => setSessions(e.target.value)} style={{ width: 140 }} placeholder="6" />
        </div>
        <div>
          <label className="adm-label">Cada cuántos días (opcional)</label>
          <input className="adm-input" type="number" min="1" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} style={{ width: 180 }} placeholder="14" />
        </div>
      </div>

      <div>
        <label className="adm-label">Precio del pack *</label>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 12, fontFamily: "var(--serif)", fontSize: 16, color: "var(--ink-soft)" }}>$</span>
            <input className="adm-input" type="number" min="0" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={{ paddingLeft: 28, width: 160 }} placeholder="0" />
          </div>
          {fullPriceCents > 0 && totalPriceCents > 0 && (
            <span style={{ fontSize: 13, color: saving > 0 ? "#4d6b3e" : saving < 0 ? "#8c463c" : "var(--ink-mute)" }}>
              {saving > 0 ? `${fmtPrice(saving / 100)} de ahorro` : saving < 0 ? `${fmtPrice(Math.abs(saving) / 100)} más caro que por separado` : "igual al precio individual"}
            </span>
          )}
        </div>
        {fullPriceCents > 0 && (
          <p style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6 }}>
            {sessionsNum} sesiones por separado: {fmtPrice(fullPriceCents / 100)}
          </p>
        )}
      </div>

      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}

      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={handleSubmit} disabled={pending} className="adm-btn adm-btn--primary" style={{ padding: "10px 24px", justifyContent: "center" }}>
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Crear pack"}
        </button>
        <button onClick={() => router.push("/admin/packs")} disabled={pending} className="adm-btn" style={{ padding: "10px 24px" }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/packs/pack-form.tsx
git commit -m "feat: formulario de pack (servicio, sesiones, intervalo, precio)"
```

---

### Task 4: Lista de packs + toggle + eliminar

**Files:**
- Create: `src/app/admin/packs/page.tsx`
- Create: `src/app/admin/packs/active-toggle.tsx`
- Create: `src/app/admin/packs/delete-button.tsx`

**Interfaces:**
- Consumes: `togglePackActive`, `deletePack` (de `./actions`); `fmtPrice`; `requireAdmin`.
- Produces: página `/admin/packs`.

- [ ] **Step 1: Implementar el toggle (client)**

```tsx
// src/app/admin/packs/active-toggle.tsx
"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { togglePackActive } from "./actions"

export default function PackActiveToggle({ packId, active }: { packId: string; active: boolean }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      onClick={() => startTransition(async () => { await togglePackActive(packId, !active); router.refresh() })}
      disabled={pending}
      className="adm-btn"
      style={{ fontSize: 12, padding: "4px 10px" }}
    >
      {pending ? "…" : active ? "Desactivar" : "Activar"}
    </button>
  )
}
```

- [ ] **Step 2: Implementar el botón eliminar (client)**

```tsx
// src/app/admin/packs/delete-button.tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { deletePack } from "./actions"

export default function PackDeleteButton({ packId, name }: { packId: string; name: string }) {
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)
  const router = useRouter()

  if (confirm) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8c463c" }}>¿Eliminar "{name}"?</span>
        <button
          className="adm-btn adm-btn--danger"
          disabled={pending}
          onClick={() => startTransition(async () => { await deletePack(packId); router.refresh() })}
        >
          Sí
        </button>
        <button className="adm-btn" onClick={() => setConfirm(false)}>No</button>
      </span>
    )
  }
  return (
    <button className="adm-btn" style={{ color: "var(--ink-mute)", fontSize: 12 }} onClick={() => setConfirm(true)}>
      Eliminar
    </button>
  )
}
```

- [ ] **Step 3: Implementar la lista (server)**

```tsx
// src/app/admin/packs/page.tsx
import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "../../reserva/data"
import PackActiveToggle from "./active-toggle"
import PackDeleteButton from "./delete-button"

export const dynamic = "force-dynamic"

type PackRow = {
  id: string
  name: string
  sessions: number
  interval_days: number | null
  total_price_cents: number
  active: boolean
  service: { name: string; price_cents: number } | null
}

export default async function AdminPacksPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("packs")
    .select("id, name, sessions, interval_days, total_price_cents, active, service:services(name, price_cents)")
    .order("name", { ascending: true })

  const packs = (data ?? []) as unknown as PackRow[]

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Catálogo</p>
        <Link href="/admin/packs/nuevo" className="adm-btn" style={{ fontSize: 12 }}>+ Nuevo pack</Link>
      </div>
      <h1 className="adm-h1">Pa<em>cks</em></h1>
      <p className="adm-lede">Packs de varias sesiones de un mismo servicio a precio especial. Los activos se muestran en la web.</p>

      <div className="adm-card">
        {packs.length === 0 ? (
          <div className="adm-empty">No hay packs cargados todavía.</div>
        ) : (
          packs.map((p) => {
            const full = (p.service?.price_cents ?? 0) * p.sessions
            const saving = full - p.total_price_cents
            return (
              <div key={p.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                <div>
                  <div className="adm-name">{p.name}</div>
                  <div className="adm-sub">
                    {p.service?.name ?? "—"} · {p.sessions} sesiones{p.interval_days ? ` · una cada ${p.interval_days} días` : ""}
                  </div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(p.total_price_cents / 100)}</div>
                  {saving > 0 && (
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", textDecoration: "line-through" }}>{fmtPrice(full / 100)}</div>
                  )}
                </div>
                <div>
                  <span className={`adm-pill ${p.active ? "adm-pill--active" : "adm-pill--inactive"}`}>{p.active ? "Activo" : "Inactivo"}</span>
                </div>
                <div className="adm-actions" style={{ gap: 8 }}>
                  <Link href={`/admin/packs/${p.id}`} className="adm-btn adm-btn--ghost">Editar →</Link>
                  <PackActiveToggle packId={p.id} active={p.active} />
                  <PackDeleteButton packId={p.id} name={p.name} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 4: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/packs/page.tsx src/app/admin/packs/active-toggle.tsx src/app/admin/packs/delete-button.tsx
git commit -m "feat: lista de packs en el admin (toggle + eliminar)"
```

---

### Task 5: Páginas Nuevo y Editar

**Files:**
- Create: `src/app/admin/packs/nuevo/page.tsx`
- Create: `src/app/admin/packs/[id]/page.tsx`

**Interfaces:**
- Consumes: `PackForm`, `ServiceOption` (de `../pack-form` / `../../pack-form`); `requireAdmin`.

- [ ] **Step 1: Helper de servicios + página Nuevo (server)**

```tsx
// src/app/admin/packs/nuevo/page.tsx
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import PackForm, { type ServiceOption } from "../pack-form"

export const dynamic = "force-dynamic"

type DbService = {
  id: string
  name: string
  price_cents: number
  category: { name: string } | null
}

async function fetchServices(): Promise<ServiceOption[]> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data } = await admin
    .from("services")
    .select("id, name, price_cents, category:service_categories(name)")
    .eq("active", true)
    .order("name", { ascending: true })
  return ((data ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))
}

export default async function NuevoPackPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const services = await fetchServices()

  return (
    <>
      <p className="adm-eyebrow">Packs</p>
      <h1 className="adm-h1">Nuevo <em>pack</em></h1>
      <p className="adm-lede">Elegí el servicio, la cantidad de sesiones, cada cuánto se hacen y el precio.</p>
      <PackForm services={services} />
    </>
  )
}
```

- [ ] **Step 2: Página Editar (server)**

```tsx
// src/app/admin/packs/[id]/page.tsx
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import PackForm, { type ServiceOption } from "../pack-form"

export const dynamic = "force-dynamic"

type DbService = {
  id: string
  name: string
  price_cents: number
  category: { name: string } | null
}

export default async function EditarPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: pack }, { data: svcData }] = await Promise.all([
    admin.from("packs").select("id, service_id, name, description, sessions, interval_days, total_price_cents").eq("id", id).maybeSingle(),
    admin.from("services").select("id, name, price_cents, category:service_categories(name)").eq("active", true).order("name", { ascending: true }),
  ])

  if (!pack) return <p className="adm-lede">Pack no encontrado.</p>

  const services = ((svcData ?? []) as unknown as DbService[]).map((s): ServiceOption => ({
    id: s.id,
    name: s.name,
    price_cents: s.price_cents,
    category: (s.category as unknown as { name: string } | null)?.name ?? "Sin categoría",
  }))

  return (
    <>
      <p className="adm-eyebrow">Packs</p>
      <h1 className="adm-h1">Editar <em>pack</em></h1>
      <PackForm
        services={services}
        initial={{
          id: pack.id,
          serviceId: pack.service_id,
          name: pack.name,
          description: pack.description ?? "",
          sessions: pack.sessions,
          intervalDays: pack.interval_days,
          totalPriceCents: pack.total_price_cents,
        }}
      />
    </>
  )
}
```

- [ ] **Step 3: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/packs/nuevo/page.tsx "src/app/admin/packs/[id]/page.tsx"
git commit -m "feat: páginas nuevo y editar pack"
```

---

### Task 6: Ítem "Packs" en el menú del admin

**Files:**
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Produces: enlace "Packs" en el menú lateral (roles no-`professional`).

- [ ] **Step 1: Agregar el enlace después de "Combos"**

En `src/app/admin/layout.tsx`, en el bloque `else` (roles no-`professional`), justo después del `<Link href="/admin/combos" ...>Combos</Link>`, agregar:

```tsx
                <Link href="/admin/packs" className="adm-nav__item">
                  Packs
                </Link>
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/layout.tsx`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat: ítem Packs en el menú del admin"
```

---

### Task 7: Página pública `/packs`

**Files:**
- Create: `src/app/packs/page.tsx`

**Interfaces:**
- Consumes: `fmtPrice` (de `@/app/reserva/data`); `whatsappLink` (de `@/lib/whatsapp`); cliente service-role.
- Produces: ruta pública `/packs`.

- [ ] **Step 1: Implementar `src/app/packs/page.tsx`**

```tsx
import { createClient } from "@supabase/supabase-js"
import { fmtPrice } from "@/app/reserva/data"
import { whatsappLink } from "@/lib/whatsapp"

export const dynamic = "force-dynamic"

type PackRow = {
  id: string
  name: string
  description: string | null
  sessions: number
  interval_days: number | null
  total_price_cents: number
  service: { name: string; price_cents: number } | null
}

export default async function PacksPublicPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await supabase
    .from("packs")
    .select("id, name, description, sessions, interval_days, total_price_cents, service:services(name, price_cents)")
    .eq("active", true)
    .order("name", { ascending: true })

  const packs = (data ?? []) as unknown as PackRow[]

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px", fontFamily: "Georgia, serif", color: "#2b2623" }}>
      <p style={{ fontSize: 12, letterSpacing: "0.22em", textTransform: "uppercase", color: "#7a6e64", margin: "0 0 8px" }}>By Leri Vendler</p>
      <h1 style={{ fontSize: 36, fontWeight: 400, margin: "0 0 8px" }}>Packs de sesiones</h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "#4a423d", margin: "0 0 32px" }}>
        Tratamientos de varias sesiones a precio especial. Para reservar tu pack, escribinos por WhatsApp.
      </p>

      {packs.length === 0 ? (
        <p style={{ color: "#7a6e64" }}>Por el momento no hay packs disponibles. ¡Escribinos y te contamos las promos vigentes!</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {packs.map((p) => {
            const full = (p.service?.price_cents ?? 0) * p.sessions
            const saving = full - p.total_price_cents
            const msg = `Hola! Me interesa el pack "${p.name}". ¿Me pasás más info?`
            return (
              <div key={p.id} style={{ background: "#fff", border: "1px solid rgba(43,38,35,0.12)", borderRadius: 14, padding: 24 }}>
                <h2 style={{ fontSize: 20, fontWeight: 500, margin: "0 0 4px" }}>{p.name}</h2>
                <p style={{ fontSize: 13, color: "#7a6e64", margin: "0 0 10px" }}>
                  {p.service?.name ?? ""} · {p.sessions} sesiones{p.interval_days ? ` · una cada ${p.interval_days} días` : ""}
                </p>
                {p.description && (
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: "#4a423d", margin: "0 0 12px" }}>{p.description}</p>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
                  <span style={{ fontSize: 24, fontWeight: 500 }}>{fmtPrice(p.total_price_cents / 100)}</span>
                  {saving > 0 && (
                    <>
                      <span style={{ fontSize: 14, color: "#7a6e64", textDecoration: "line-through" }}>{fmtPrice(full / 100)}</span>
                      <span style={{ fontSize: 13, color: "#4d6b3e" }}>{fmtPrice(saving / 100)} de ahorro</span>
                    </>
                  )}
                </div>
                <a href={whatsappLink(msg)} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-block", background: "#2b2623", color: "#f2ede6", padding: "12px 24px", borderRadius: 999, textDecoration: "none", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "Helvetica, Arial, sans-serif" }}>
                  Consultar por WhatsApp
                </a>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/packs`
Expected: sin errores.

- [ ] **Step 3: Validación visual (manual, usuaria)**

Con la migración aplicada y `npm run dev`: crear un pack en `/admin/packs/nuevo`, **activarlo**, y visitar `http://localhost:3000/packs` → debe verse la tarjeta con servicio, sesiones, intervalo, precio, ahorro y el botón de WhatsApp. *(Validación visual = usuaria.)*

- [ ] **Step 4: Commit**

```bash
git add src/app/packs/page.tsx
git commit -m "feat: página pública /packs (vitrina + CTA WhatsApp)"
```

---

## Self-Review (cobertura vs spec)

- **Tabla `packs` (service_id, name, description, sessions, interval_days, total_price_cents, active) + RLS** → Task 1. ✔
- **CRUD admin (crear/editar/activar/eliminar)** → Tasks 2, 3, 4, 5. ✔
- **Form: servicio, nombre, descripción, sesiones, intervalo, precio + ahorro** → Task 3. ✔
- **Ítem "Packs" en el menú** → Task 6. ✔
- **Vitrina pública con CTA WhatsApp** → Task 7. ✔
- **Sin conteo de sesiones / compra online / integración facturación (YAGNI)** → no hay tareas para eso. ✔

**Type consistency:** `PackInput` (Task 2) consumido por `pack-form` (Task 3). `ServiceOption` definido en `pack-form` (Task 3) y consumido por nuevo/editar (Task 5). `togglePackActive`/`deletePack` (Task 2) consumidos por los componentes client (Task 4). `interval_days`/`intervalDays` mapeo: DB snake_case ↔ `intervalDays` en `PackInput`/form.

**Desvío respecto del spec (a confirmar con la usuaria):** el spec decía "sección de packs en la página de reserva", pero esa página es un wizard de reserva (los packs no se reservan online). Por eso la vitrina pública es una **página dedicada `/packs`** (más limpia y sin tocar el wizard). Falta **enlazarla** desde la navegación pública del sitio para que sea descubrible — se decide con la usuaria (un link en el home/footer o desde la reserva).
