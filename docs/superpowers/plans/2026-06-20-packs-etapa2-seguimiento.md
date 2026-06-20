# Packs etapa 2 (seguimiento de sesiones) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestionar packs: vender un pack a una clienta (con facturación opcional), ver el saldo de sesiones en su ficha, y descontar una sesión al completar un turno (eligiendo el pack), con reversa al des-completar.

**Architecture:** Tabla nueva `pack_purchases` + columna `appointments.pack_purchase_id`. La venta y el saldo viven en la ficha de la clienta. El descuento se integra en la acción existente `updateAppointmentStatus` (parámetro opcional `packPurchaseId`), y la elección al completar se ofrece desde `StatusActions` con los packs activos que la página de turnos calcula por turno. La facturación opcional reusa `emitirFactura` + un helper de email compartido.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-20-packs-etapa2-seguimiento-design.md`

## Global Constraints

- **Migraciones por CI:** NO aplicar a mano. El workflow `.github/workflows/db-migrate.yml` aplica con `supabase db push` al pushear a main. Versión de migración con prefijo timestamp ÚNICO (`20260620000003`).
- **No romper el flujo de turnos:** `updateAppointmentStatus` ya suma puntos de fidelidad al pasar a `completed`. El cambio agrega lógica de packs SIN tocar la de puntos. Mantener idempotencia (incremento solo al *entrar* a completed; decremento solo al *salir* de completed con `pack_purchase_id` seteado).
- **Convenciones:** páginas Server Components con `export const dynamic = "force-dynamic"`, cliente service-role, clases `adm-*`. Server Actions `"use server"` validan staff (`requireStaff`/`requireAdmin`). Dinero en centavos; `fmtPrice` (de `@/app/reserva/data`) recibe pesos.
- **Facturación reusada:** `emitirFactura` (`@/lib/arca/invoice-service`) recibe `{ clientId?, concepto?, docTipo, docNro, receptorNombre?, condIvaReceptor, totalCents, descripcion, ... }` y devuelve `{ id, cbte_nro, cae, qr_url }`. Receptor: DNI de la clienta si lo tiene (DocTipo 96), sino Consumidor Final (99), `condIvaReceptor` 5.
- **Verificación:** `npx tsc --noEmit`, `npx eslint <dirs tocados>`, `npm run build`.
- **Idioma:** identificadores en inglés/snake_case; UI en español.

---

### Task 1: Migración — `pack_purchases` + `appointments.pack_purchase_id`

**Files:**
- Create: `supabase/migrations/20260620000003_pack_purchases.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- Compras de pack (seguimiento de sesiones por clienta).
create table if not exists public.pack_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pack_id uuid references public.packs(id) on delete set null,
  pack_name text not null,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  sessions_total int not null check (sessions_total > 0),
  sessions_used int not null default 0 check (sessions_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_pack_purchases_client on public.pack_purchases(client_id);

alter table public.pack_purchases enable row level security;
drop policy if exists "pack_purchases_staff_all" on public.pack_purchases;
create policy "pack_purchases_staff_all" on public.pack_purchases
  for all using (public.is_staff()) with check (public.is_staff());

-- Vincula un turno con la compra de pack de la que descontó una sesión.
alter table public.appointments
  add column if not exists pack_purchase_id uuid references public.pack_purchases(id) on delete set null;
```

- [ ] **Step 2: Commit (el CI la aplica al pushear)**

```bash
git add supabase/migrations/20260620000003_pack_purchases.sql
git commit -m "feat: tabla pack_purchases + appointments.pack_purchase_id"
```

> No aplicar a mano. Al integrar a main, el workflow `db-migrate` la aplica. Verificar con `gh run list --workflow=db-migrate.yml --limit 1`.

---

### Task 2: Helper compartido de email de factura

**Files:**
- Create: `src/lib/arca/emit-email.ts`
- Modify: `src/app/admin/facturacion/actions.ts`

**Interfaces:**
- Produces: `renderAndEmailInvoice(invoiceId: string, to: string | null, firstName: string): Promise<{ ok: boolean; error?: string }>` (best-effort: nunca tira).

- [ ] **Step 1: Crear `src/lib/arca/emit-email.ts`**

```ts
import "server-only"
import { loadInvoicePdfData } from "./invoice-pdf"
import { renderInvoicePdf } from "./pdf"
import { sendInvoiceEmail } from "@/lib/email/invoice-emails"

// Genera el PDF de una factura y lo envía por email. Best-effort: no lanza.
export async function renderAndEmailInvoice(
  invoiceId: string,
  to: string | null,
  firstName: string
): Promise<{ ok: boolean; error?: string }> {
  if (!to) return { ok: false, error: "Sin email de destinatario" }
  try {
    const data = await loadInvoicePdfData(invoiceId)
    if (!data) return { ok: false, error: "No se pudo cargar la factura para el PDF" }
    const pdf = await renderInvoicePdf(data)
    return await sendInvoiceEmail({
      to,
      firstName,
      cbteNro: data.nro,
      ptoVta: data.ptoVta,
      fecha: data.fecha,
      totalCents: data.totalCents,
      pdf,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 2: Refactor `facturacion/actions.ts` para reusar el helper**

En `src/app/admin/facturacion/actions.ts`: borrar la función local `enviarPdfPorEmail` (y sus imports de `loadInvoicePdfData`, `renderInvoicePdf`, `sendInvoiceEmail` si quedan sin uso), agregar `import { renderAndEmailInvoice } from "@/lib/arca/emit-email"`, y reemplazar las llamadas `enviarPdfPorEmail(...)` por `renderAndEmailInvoice(...)` (misma firma).

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx eslint src/lib/arca src/app/admin/facturacion`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arca/emit-email.ts src/app/admin/facturacion/actions.ts
git commit -m "refactor: helper compartido renderAndEmailInvoice"
```

---

### Task 3: Acción `venderPack` (+ facturar opcional)

**Files:**
- Create: `src/app/admin/packs/sell-actions.ts`

**Interfaces:**
- Consumes: `emitirFactura` (`@/lib/arca/invoice-service`), `renderAndEmailInvoice` (`@/lib/arca/emit-email`).
- Produces: `venderPack(input: { clientId: string; packId: string; facturar: boolean }): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar `src/app/admin/packs/sell-actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"
import { renderAndEmailInvoice } from "@/lib/arca/emit-email"

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

export async function venderPack(input: {
  clientId: string
  packId: string
  facturar: boolean
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdminAction()
  const admin = adminClient()

  const { data: pack } = await admin
    .from("packs")
    .select("id, name, sessions, total_price_cents, service:services(id, name)")
    .eq("id", input.packId)
    .maybeSingle()
  if (!pack) return { ok: false, error: "Pack no encontrado" }
  const service = pack.service as unknown as { id: string; name: string } | null

  const { error: insErr } = await admin.from("pack_purchases").insert({
    client_id: input.clientId,
    pack_id: pack.id,
    pack_name: pack.name,
    service_id: service?.id ?? null,
    service_name: service?.name ?? "",
    sessions_total: pack.sessions,
    sessions_used: 0,
  })
  if (insErr) return { ok: false, error: insErr.message }

  let facturaError: string | undefined
  if (input.facturar) {
    const { data: client } = await admin
      .from("clients")
      .select("first_name, dni, email")
      .eq("id", input.clientId)
      .maybeSingle()
    const dni = client?.dni ?? null
    try {
      const factura = await emitirFactura({
        clientId: input.clientId,
        concepto: 2,
        docTipo: dni ? 96 : 99,
        docNro: dni ?? "0",
        condIvaReceptor: 5,
        totalCents: pack.total_price_cents,
        descripcion: pack.name,
      })
      await renderAndEmailInvoice(factura.id, client?.email ?? null, client?.first_name ?? "")
    } catch (e) {
      facturaError = e instanceof Error ? e.message : String(e)
    }
  }

  revalidatePath(`/admin/clientas/${input.clientId}`)
  // La compra quedó registrada aunque la factura falle; se informa el error.
  return facturaError
    ? { ok: false, error: `Pack registrado, pero la factura falló: ${facturaError}` }
    : { ok: true }
}
```

> Nota: `emitirFactura` (EmitInput) usa `concepto` como `1|2|3` (tipo de comprobante interno: 2 = servicios) y `descripcion` como el texto. El nombre del pack va en `descripcion`.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx eslint src/app/admin/packs`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/packs/sell-actions.ts
git commit -m "feat: acción venderPack (registra compra + factura opcional)"
```

---

### Task 4: Sección "Packs" en la ficha de la clienta (saldo + vender)

**Files:**
- Create: `src/app/admin/clientas/[id]/sell-pack.tsx`
- Modify: `src/app/admin/clientas/[id]/page.tsx`

**Interfaces:**
- Consumes: `venderPack` (de `@/app/admin/packs/sell-actions`), `fmtPrice`.

- [ ] **Step 1: Componente "Vender pack" (client)**

```tsx
// src/app/admin/clientas/[id]/sell-pack.tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { venderPack } from "@/app/admin/packs/sell-actions"

export type SellablePack = { id: string; label: string }

export default function SellPack({ clientId, packs }: { clientId: string; packs: SellablePack[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [packId, setPackId] = useState(packs[0]?.id ?? "")
  const [facturar, setFacturar] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (packs.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--ink-mute)" }}>No hay packs activos para vender. Creá uno en Packs.</p>
  }

  if (!open) {
    return <button className="adm-btn" onClick={() => setOpen(true)}>+ Vender pack</button>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <select className="adm-input" value={packId} onChange={(e) => setPackId(e.target.value)}>
        {packs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={facturar} onChange={(e) => setFacturar(e.target.checked)} />
        Facturar ahora (emite Factura C y la envía por email)
      </label>
      {error && <p style={{ fontSize: 13, color: "#8c463c" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() => start(async () => {
            setError(null)
            const r = await venderPack({ clientId, packId, facturar })
            if (r.ok) { setOpen(false); router.refresh() }
            else setError(r.error ?? "Error")
          })}
        >
          {pending ? "Registrando…" : "Confirmar venta"}
        </button>
        <button className="adm-btn" onClick={() => setOpen(false)} disabled={pending}>Cancelar</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Agregar la sección "Packs" a `clientas/[id]/page.tsx`**

Agregar los imports al tope:
```tsx
import SellPack, { type SellablePack } from "./sell-pack"
```

Después de obtener `appts` (cerca de la línea donde se arma `appts`), agregar las consultas:
```tsx
  type PurchaseRow = {
    id: string
    pack_name: string
    service_name: string
    sessions_total: number
    sessions_used: number
  }
  const { data: purchasesData } = await admin
    .from("pack_purchases")
    .select("id, pack_name, service_name, sessions_total, sessions_used")
    .eq("client_id", id)
    .order("created_at", { ascending: false })
  const purchases = (purchasesData ?? []) as PurchaseRow[]

  const { data: activePacksData } = await admin
    .from("packs")
    .select("id, name, sessions, total_price_cents")
    .eq("active", true)
    .order("name", { ascending: true })
  const sellablePacks: SellablePack[] = ((activePacksData ?? []) as { id: string; name: string; sessions: number; total_price_cents: number }[])
    .map((p) => ({ id: p.id, label: `${p.name} · ${p.sessions} sesiones · ${fmtPrice(p.total_price_cents / 100)}` }))
```

Y en el JSX, **antes** de `<h2 className="adm-section-title">Historial de turnos</h2>`, insertar la sección:
```tsx
      <h2 className="adm-section-title">Packs</h2>
      <div className="adm-card" style={{ padding: 16 }}>
        {purchases.length === 0 ? (
          <div className="adm-empty" style={{ padding: 16 }}>Sin packs comprados.</div>
        ) : (
          purchases.map((p) => {
            const remaining = p.sessions_total - p.sessions_used
            const done = remaining <= 0
            return (
              <div key={p.id} className="adm-list-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
                <div>
                  <div className="adm-name">{p.pack_name}</div>
                  <div className="adm-sub">{p.service_name}</div>
                </div>
                <div style={{ fontSize: 13, textAlign: "right" }}>
                  usó {p.sessions_used} / quedan {Math.max(0, remaining)}
                </div>
                <div>
                  <span className={`adm-pill ${done ? "adm-pill--inactive" : "adm-pill--active"}`}>
                    {done ? "Completado" : "Activo"}
                  </span>
                </div>
              </div>
            )
          })
        )}
        <div style={{ marginTop: 12 }}>
          <SellPack clientId={client.id} packs={sellablePacks} />
        </div>
      </div>
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx eslint "src/app/admin/clientas/[id]"`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/clientas/[id]/sell-pack.tsx" "src/app/admin/clientas/[id]/page.tsx"
git commit -m "feat: sección Packs en la ficha de la clienta (saldo + vender)"
```

---

### Task 5: Descontar/revertir sesión en `updateAppointmentStatus`

**Files:**
- Modify: `src/app/admin/actions.ts`

**Interfaces:**
- Produces: `updateAppointmentStatus(appointmentId: string, status: string, packPurchaseId?: string)` — al entrar a `completed` con `packPurchaseId`, vincula el turno e incrementa `sessions_used`; al salir de `completed`, si el turno tenía `pack_purchase_id`, decrementa y desvincula.

- [ ] **Step 1: Extender la firma y el `select` de `prev`**

En `updateAppointmentStatus`, cambiar la firma a:
```ts
export async function updateAppointmentStatus(
  appointmentId: string,
  status: string,
  packPurchaseId?: string
): Promise<{ ok: boolean; error?: string }> {
```
Y en la consulta de `prev`, agregar `pack_purchase_id` al select:
```ts
  const { data: prev } = await admin
    .from("appointments")
    .select("status, client_id, google_event_id, pack_purchase_id")
    .eq("id", appointmentId)
    .maybeSingle()
```

- [ ] **Step 2: Agregar la lógica de packs (después del bloque de puntos de fidelidad, antes de `revalidatePath`)**

```ts
  // ── Packs: descontar al entrar a completed; devolver al salir ──
  const enteringCompleted = parsed.data === "completed" && prev?.status !== "completed"
  const leavingCompleted = prev?.status === "completed" && parsed.data !== "completed"

  if (enteringCompleted && packPurchaseId) {
    const { data: pp } = await admin
      .from("pack_purchases")
      .select("sessions_total, sessions_used")
      .eq("id", packPurchaseId)
      .maybeSingle()
    if (pp && pp.sessions_used < pp.sessions_total) {
      await admin
        .from("pack_purchases")
        .update({ sessions_used: pp.sessions_used + 1 })
        .eq("id", packPurchaseId)
      await admin
        .from("appointments")
        .update({ pack_purchase_id: packPurchaseId })
        .eq("id", appointmentId)
    }
  }

  if (leavingCompleted && prev?.pack_purchase_id) {
    const { data: pp } = await admin
      .from("pack_purchases")
      .select("sessions_used")
      .eq("id", prev.pack_purchase_id)
      .maybeSingle()
    if (pp && pp.sessions_used > 0) {
      await admin
        .from("pack_purchases")
        .update({ sessions_used: pp.sessions_used - 1 })
        .eq("id", prev.pack_purchase_id)
    }
    await admin
      .from("appointments")
      .update({ pack_purchase_id: null })
      .eq("id", appointmentId)
  }

  revalidatePath("/admin/clientas")
```

(Dejar las llamadas `revalidatePath` existentes; agregar la de clientas.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx eslint src/app/admin/actions.ts`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "feat: descontar/revertir sesión de pack al completar turno"
```

---

### Task 6: Ofrecer el descuento al completar (StatusActions + turnos)

**Files:**
- Modify: `src/app/admin/_components/status-actions.tsx`
- Modify: `src/app/admin/turnos/page.tsx`

**Interfaces:**
- Consumes: `updateAppointmentStatus(appointmentId, status, packPurchaseId?)`.
- `StatusActions` gana prop `matchingPacks?: { id: string; label: string }[]`.

- [ ] **Step 1: `turnos/page.tsx` — calcular packs activos que matchean por turno**

En `src/app/admin/turnos/page.tsx`, ampliar el select de appointments para traer el `service_id` de cada servicio (cambiar `appointment_services(starts_at, service:services(name), staff:staff(full_name))` por `appointment_services(starts_at, service:services(id, name), staff:staff(full_name))`), y agregar el tipo `service: { id: string; name: string } | null` en `ApptService`.

Después de obtener `appts`, agregar:
```tsx
  const clientIds = Array.from(new Set(appts.map((a) => a.client?.id).filter(Boolean))) as string[]
  type ActivePackRow = { id: string; client_id: string; service_id: string | null; pack_name: string; sessions_total: number; sessions_used: number }
  const { data: ppData } = clientIds.length
    ? await admin
        .from("pack_purchases")
        .select("id, client_id, service_id, pack_name, sessions_total, sessions_used")
        .in("client_id", clientIds)
    : { data: [] as ActivePackRow[] }
  const activePacks = ((ppData ?? []) as ActivePackRow[]).filter((p) => p.sessions_used < p.sessions_total)

  function packsForAppt(a: ApptRow): { id: string; label: string }[] {
    if (!a.client) return []
    const svcIds = new Set(a.appointment_services.map((s) => s.service?.id).filter(Boolean))
    return activePacks
      .filter((p) => p.client_id === a.client!.id && p.service_id && svcIds.has(p.service_id))
      .map((p) => ({ id: p.id, label: `${p.pack_name} · quedan ${p.sessions_total - p.sessions_used}` }))
  }
```

Y donde se renderiza `<StatusActions appointmentId={a.id} currentStatus={a.status} />`, pasar la prop:
```tsx
                  <StatusActions appointmentId={a.id} currentStatus={a.status} matchingPacks={packsForAppt(a)} />
```

(Ajustar el tipo `ApptService` para incluir `service: { id: string; name: string } | null`.)

- [ ] **Step 2: `status-actions.tsx` — ofrecer elegir pack al completar**

Reemplazar el contenido de `src/app/admin/_components/status-actions.tsx` por:

```tsx
"use client"

import { useState, useTransition } from "react"
import { updateAppointmentStatus, deleteAppointment } from "../actions"

const NEXT_ACTIONS: Record<string, { status: string; label: string; variant?: string }[]> = {
  pending: [
    { status: "confirmed", label: "Confirmar", variant: "primary" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  confirmed: [
    { status: "in_progress", label: "Iniciar" },
    { status: "no_show", label: "No vino", variant: "danger" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  in_progress: [
    { status: "completed", label: "Completar", variant: "primary" },
    { status: "cancelled", label: "Cancelar", variant: "danger" },
  ],
  completed: [],
  cancelled: [{ status: "pending", label: "Reactivar" }],
  no_show: [{ status: "pending", label: "Reactivar" }],
}

const RESCHEDULABLE = new Set(["pending", "confirmed"])

export default function StatusActions({
  appointmentId,
  currentStatus,
  matchingPacks = [],
}: {
  appointmentId: string
  currentStatus: string
  matchingPacks?: { id: string; label: string }[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choosingPack, setChoosingPack] = useState(false)
  const actions = NEXT_ACTIONS[currentStatus] ?? []

  const change = (status: string, packPurchaseId?: string) => {
    setError(null)
    setChoosingPack(false)
    startTransition(async () => {
      const r = await updateAppointmentStatus(appointmentId, status, packPurchaseId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const r = await deleteAppointment(appointmentId)
      if (!r.ok) setError(r.error ?? "Error")
    })
  }

  const canReschedule = RESCHEDULABLE.has(currentStatus)

  if (actions.length === 0 && !canReschedule && currentStatus !== "completed") {
    return <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>—</span>
  }

  // Al completar con packs que matchean: ofrecer descontar de un pack.
  if (choosingPack) {
    return (
      <>
        <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>¿Descontar de un pack?</span>
        {matchingPacks.map((p) => (
          <button key={p.id} className="adm-btn adm-btn--primary" disabled={pending} onClick={() => change("completed", p.id)}>
            {p.label}
          </button>
        ))}
        <button className="adm-btn" disabled={pending} onClick={() => change("completed")}>Sin pack</button>
        <button className="adm-btn" onClick={() => setChoosingPack(false)}>Volver</button>
        {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
      </>
    )
  }

  return (
    <>
      {actions.map((a) => {
        const isComplete = a.status === "completed"
        const onClick =
          isComplete && matchingPacks.length > 0
            ? () => setChoosingPack(true)
            : () => change(a.status)
        return (
          <button
            key={a.status}
            className={`adm-btn ${a.variant === "primary" ? "adm-btn--primary" : a.variant === "danger" ? "adm-btn--danger" : ""}`}
            disabled={pending}
            onClick={onClick}
          >
            {a.label}
          </button>
        )
      })}
      {currentStatus === "completed" && (
        <a href={`/admin/turnos/${appointmentId}/facturar`} className="adm-btn adm-btn--primary">
          Facturar
        </a>
      )}
      {canReschedule && (
        <a href={`/admin/turnos/${appointmentId}/reagendar`} className="adm-btn adm-btn--ghost">
          Reagendar
        </a>
      )}
      {confirmDelete ? (
        <>
          <span style={{ fontSize: 12, color: "#8c463c" }}>¿Eliminar?</span>
          <button className="adm-btn adm-btn--danger" disabled={pending} onClick={handleDelete}>Sí, eliminar</button>
          <button className="adm-btn" onClick={() => setConfirmDelete(false)}>No</button>
        </>
      ) : (
        <button className="adm-btn" disabled={pending} onClick={() => setConfirmDelete(true)} style={{ color: "var(--ink-mute)", fontSize: 12 }}>
          Eliminar
        </button>
      )}
      {error && <span style={{ fontSize: 10, color: "#8c463c" }}>{error}</span>}
    </>
  )
}
```

> Nota: este archivo ya tenía el botón "Facturar" en completed (Plan B). El cambio agrega `matchingPacks` y el paso de elección al completar; el resto se conserva igual.

- [ ] **Step 3: Verificar y build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/_components src/app/admin/turnos && npm run build`
Expected: sin errores; `/admin/turnos` y `/admin/clientas/[id]` compilan.

- [ ] **Step 4: Validación manual (usuaria)**

Con la migración aplicada (CI) y `npm run dev`: en la ficha de una clienta, "Vender pack" (probá con y sin "Facturar ahora") → aparece en "Packs" con "usó 0 / quedan N". Crear un turno de ese servicio para esa clienta, "Iniciar" → "Completar" → ofrece "¿Descontar del pack…?" → Sí → el saldo baja a "quedan N−1". Reactivar el turno → el saldo vuelve a subir.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/_components/status-actions.tsx src/app/admin/turnos/page.tsx
git commit -m "feat: elegir descuento de pack al completar el turno"
```

---

## Self-Review (cobertura vs spec)

- **`pack_purchases` + `appointments.pack_purchase_id`** → Task 1. ✔
- **Vender pack + facturar opcional (reuso facturación)** → Tasks 2 (helper), 3 (venderPack), 4 (UI). ✔
- **Saldo en la ficha** → Task 4. ✔
- **Descontar al completar con elección + reversa** → Tasks 5 (lógica) + 6 (UI/turnos). ✔
- **No romper puntos de fidelidad / idempotencia** → Task 5 agrega lógica sin tocar el bloque de puntos; incremento solo al entrar a completed, decremento solo al salir. ✔
- **YAGNI (sin auto-match, sin reserva online, etc.)** → no hay tareas para eso. ✔

**Type consistency:** `venderPack` (Task 3) consumido por `SellPack` (Task 4). `renderAndEmailInvoice` (Task 2) consumido por Task 3. `updateAppointmentStatus(.., packPurchaseId?)` (Task 5) consumido por `StatusActions` (Task 6). `matchingPacks: {id,label}[]` producido por `turnos/page` (Task 6 Step 1) y consumido por `StatusActions` (Task 6 Step 2). `pack_purchases` columnas (Task 1) usadas en Tasks 3/4/5/6.
