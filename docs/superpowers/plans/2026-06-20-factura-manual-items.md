# Factura manual con selección de ítems — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En la factura manual, poder seleccionar servicios/packs que auto-llenan (de forma editable) concepto y monto, manteniendo el modo manual, con mejor presentación visual.

**Architecture:** Solo cambian 2 archivos en `src/app/admin/facturacion/nueva/`: la página server carga servicios y packs activos y se los pasa al form; el form (client) agrega selección de ítems + auto-llenado editable. El backend (`actions.ts emitirFacturaManual`) NO se toca: sigue recibiendo `descripcion` + `montoPesos`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-06-20-factura-manual-items-design.md`

## Global Constraints

- **Backend intacto:** no modificar `actions.ts` ni `emitirFacturaManual` (toma `{ docTipo, docNro, receptorNombre, email, descripcion, montoPesos }`).
- **Auto-llenado editable:** seleccionar ítems setea concepto (nombres unidos por ", ") y monto (subtotal en pesos); ambos quedan editables; sin selección = modo manual actual.
- **Dinero:** precios en centavos; `fmtPrice` (de `@/app/reserva/data`) recibe pesos.
- **Estética:** clases `adm-*` existentes (`adm-card`, `adm-input`, `adm-label`, `adm-section-title`, `adm-btn`, `adm-btn--primary`, `--border`, `--serif`, `--ink-mute`).
- **Verificación:** `npx tsc --noEmit && npx eslint src/app/admin/facturacion/nueva` y `npm run build`.

---

### Task 1: Reescribir el formulario con selección de ítems

**Files:**
- Modify (reemplazar contenido): `src/app/admin/facturacion/nueva/manual-form.tsx`

**Interfaces:**
- Produces: `export type SelectableItem = { kind: "service" | "pack"; id: string; name: string; priceCents: number }`; `default ManualForm({ items }: { items?: SelectableItem[] })`.
- Consumes: `emitirFacturaManual` (de `../actions`), `fmtPrice` (de `../../reserva/data`).

- [ ] **Step 1: Reemplazar `manual-form.tsx` por:**

```tsx
"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaManual } from "../actions"
import { fmtPrice } from "../../reserva/data"

export type SelectableItem = {
  kind: "service" | "pack"
  id: string
  name: string
  priceCents: number
}

type LineItem = { key: number; name: string; priceCents: number }

export default function ManualForm({ items = [] }: { items?: SelectableItem[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const keyRef = useRef(0)
  const [lines, setLines] = useState<LineItem[]>([])
  const [picker, setPicker] = useState("")
  const [concepto, setConcepto] = useState("")
  const [montoStr, setMontoStr] = useState("")
  const [identificar, setIdentificar] = useState(false)
  const [docTipo, setDocTipo] = useState<96 | 80>(96)

  const services = items.filter((i) => i.kind === "service")
  const packs = items.filter((i) => i.kind === "pack")
  const subtotalCents = lines.reduce((a, l) => a + l.priceCents, 0)

  function applyLines(next: LineItem[]) {
    setLines(next)
    setConcepto(next.map((l) => l.name).join(", "))
    const subtotal = next.reduce((a, l) => a + l.priceCents, 0)
    setMontoStr(next.length ? String(subtotal / 100) : "")
  }

  function addPicked() {
    if (!picker) return
    const [kind, id] = picker.split(":")
    const item = items.find((i) => i.kind === kind && i.id === id)
    if (!item) return
    applyLines([...lines, { key: keyRef.current++, name: item.name, priceCents: item.priceCents }])
    setPicker("")
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const montoPesos = Number(montoStr)
    if (!concepto.trim()) { setError("Ingresá un concepto o seleccioná un ítem"); return }
    if (!montoPesos || montoPesos <= 0) { setError("Ingresá un monto válido"); return }

    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r = await emitirFacturaManual({
        docTipo: identificar ? docTipo : 99,
        docNro: identificar ? String(fd.get("docNro") ?? "").trim() : "0",
        receptorNombre: String(fd.get("nombre") ?? "").trim(),
        email: String(fd.get("email") ?? "").trim(),
        descripcion: concepto.trim(),
        montoPesos,
      })
      if (r.ok) router.push("/admin/facturacion")
      else setError(r.error ?? "Error al emitir")
    })
  }

  return (
    <form className="adm-card" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, padding: 24 }}>
      {items.length > 0 && (
        <div>
          <h2 className="adm-section-title" style={{ marginBottom: 8 }}>Ítems (opcional)</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="adm-input" value={picker} onChange={(e) => setPicker(e.target.value)} style={{ flex: 1, minWidth: 220 }}>
              <option value="">Elegí un servicio o pack…</option>
              {services.length > 0 && (
                <optgroup label="Servicios">
                  {services.map((s) => (
                    <option key={`service:${s.id}`} value={`service:${s.id}`}>{s.name} — {fmtPrice(s.priceCents / 100)}</option>
                  ))}
                </optgroup>
              )}
              {packs.length > 0 && (
                <optgroup label="Packs">
                  {packs.map((p) => (
                    <option key={`pack:${p.id}`} value={`pack:${p.id}`}>{p.name} — {fmtPrice(p.priceCents / 100)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" className="adm-btn" onClick={addPicked} disabled={!picker}>+ Agregar</button>
          </div>

          {lines.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((l) => (
                <div key={l.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 14 }}>{l.name}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 14, fontFamily: "var(--serif)" }}>{fmtPrice(l.priceCents / 100)}</span>
                    <button type="button" onClick={() => applyLines(lines.filter((x) => x.key !== l.key))} className="adm-btn" style={{ fontSize: 12, padding: "2px 8px", color: "#8c463c" }}>✕</button>
                  </span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 4, fontSize: 13, color: "var(--ink-mute)" }}>
                Subtotal: <strong style={{ fontFamily: "var(--serif)", color: "var(--ink)" }}>{fmtPrice(subtotalCents / 100)}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label className="adm-label">Concepto</label>
          <input className="adm-input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej: Seña de tratamiento" />
        </div>
        <div>
          <label className="adm-label">Monto (en pesos)</label>
          <input className="adm-input" type="number" step="0.01" min="0" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} placeholder="3500.00" style={{ width: 200 }} />
        </div>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
          <span>Identificar al receptor (sino, Consumidor Final)</span>
        </label>
        {identificar && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 24, marginTop: 12 }}>
            <div>
              <label className="adm-label">Tipo de documento</label>
              <select className="adm-input" value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value) as 96 | 80)} style={{ width: 200 }}>
                <option value={96}>DNI</option>
                <option value={80}>CUIT</option>
              </select>
            </div>
            <div>
              <label className="adm-label">Número</label>
              <input name="docNro" className="adm-input" placeholder="Sin puntos ni guiones" />
            </div>
            <div>
              <label className="adm-label">Nombre / Razón social</label>
              <input name="nombre" className="adm-input" />
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="adm-label">Email (opcional, para enviar el PDF)</label>
        <input name="email" className="adm-input" type="email" placeholder="clienta@email.com" />
      </div>

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>Total</span>
          <span style={{ fontSize: 22, fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(Number(montoStr) || 0)}</span>
        </div>
        <button className="adm-btn adm-btn--primary" type="submit" disabled={pending} style={{ justifyContent: "center", padding: "12px 16px", fontSize: 13 }}>
          {pending ? "Emitiendo…" : "Emitir factura"}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Verificar (con la página todavía sin pasar `items`, el form compila porque `items` es opcional)**

Run: `npx tsc --noEmit && npx eslint src/app/admin/facturacion/nueva`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/facturacion/nueva/manual-form.tsx
git commit -m "feat: selección de ítems + auto-llenado en factura manual"
```

---

### Task 2: La página carga servicios y packs activos

**Files:**
- Modify (reemplazar contenido): `src/app/admin/facturacion/nueva/page.tsx`

**Interfaces:**
- Consumes: `ManualForm`, `SelectableItem` (de `./manual-form`).

- [ ] **Step 1: Reemplazar `page.tsx` por:**

```tsx
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ManualForm, { type SelectableItem } from "./manual-form"

export const dynamic = "force-dynamic"

export default async function NuevaFacturaPage() {
  const ssr = await createSsrClient()
  const {
    data: { user },
  } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const [{ data: svc }, { data: pks }] = await Promise.all([
    admin.from("services").select("id, name, price_cents").eq("active", true).order("name", { ascending: true }),
    admin.from("packs").select("id, name, total_price_cents").eq("active", true).order("name", { ascending: true }),
  ])

  const items: SelectableItem[] = [
    ...((svc ?? []) as { id: string; name: string; price_cents: number }[]).map(
      (s): SelectableItem => ({ kind: "service", id: s.id, name: s.name, priceCents: s.price_cents })
    ),
    ...((pks ?? []) as { id: string; name: string; total_price_cents: number }[]).map(
      (p): SelectableItem => ({ kind: "pack", id: p.id, name: p.name, priceCents: p.total_price_cents })
    ),
  ]

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Factura <em>manual</em></h1>
      <p className="adm-lede">Para señas, ventas sueltas o un servicio puntual. Emite una Factura C.</p>
      <ManualForm items={items} />
    </>
  )
}
```

- [ ] **Step 2: Verificar y build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/facturacion/nueva && npm run build`
Expected: sin errores; la ruta `/admin/facturacion/nueva` compila.

- [ ] **Step 3: Validación visual (manual, usuaria)**

Con `npm run dev`: ir a `/admin/facturacion/nueva` → elegir un servicio/pack y "Agregar" → concepto y monto se autocompletan; editar el monto a mano funciona; quitar un ítem recalcula; emitir crea la factura. Si la lista de ítems está vacía, funciona el modo manual de siempre.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/facturacion/nueva/page.tsx
git commit -m "feat: cargar servicios y packs en la factura manual"
```

---

## Self-Review (cobertura vs spec)

- **Selección de servicios + packs** → Tasks 1 (select/optgroup) + 2 (carga). ✔
- **Auto-llenado editable de concepto + monto** → `applyLines` setea ambos; inputs controlados editables. ✔
- **Modo manual sin selección** → `items` vacío oculta la sección; concepto/monto manuales. ✔
- **Backend intacto** → no se toca `actions.ts`; `emitirFacturaManual` recibe `descripcion` + `montoPesos`. ✔
- **Mejora visual** → secciones con `adm-section-title`/`adm-label`, lista con subtotal, total destacado. ✔

**Type consistency:** `SelectableItem` definido en `manual-form.tsx` (Task 1), consumido por `page.tsx` (Task 2). `items` opcional (default `[]`) → el form compila antes de que la página lo pase.
