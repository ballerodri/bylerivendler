# Facturación ARCA — Plan B: PDF, email y pantallas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer usable el motor de facturación ya validado: generar el PDF oficial de la Factura C, enviarlo por email, y dar las pantallas del admin (historial, factura manual, y botón "Facturar" con confirmación en el turno).

**Architecture:** El núcleo (`src/lib/arca/`) ya emite el CAE y guarda la factura en `invoices`. Plan B agrega: render del PDF al vuelo con `@react-pdf/renderer` (sin almacenar archivos), envío por email con Resend (adjunto), y pantallas server-component en `src/app/admin/facturacion/` que consumen Server Actions. Una columna `environment` separa facturas de prueba de reales.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Supabase, `@react-pdf/renderer`, `qrcode`, Resend, vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-facturacion-arca-design.md` (sección 12 = Plan B).

## Global Constraints

- **Plataforma:** Vercel serverless. El render del PDF corre en **runtime Node** (no edge): las rutas/acciones que lo usan declaran `export const runtime = "nodejs"`.
- **Next.js no estándar:** antes de escribir route handlers / páginas, leer la guía correspondiente en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- **Dinero:** en la base SIEMPRE centavos (int). En la UI se formatea con `fmtPrice` (de `@/app/reserva/data`, recibe pesos: `fmtPrice(cents/100)`). El monto que la usuaria escribe en pesos se convierte a centavos con `Math.round(pesos*100)`.
- **Convenciones admin:** páginas son Server Components con `export const dynamic = "force-dynamic"`, leen datos con el cliente service-role (`createClient` de `@supabase/supabase-js`, `persistSession:false`). Acciones interactivas son Client Components que llaman Server Actions. Clases CSS `adm-*` (`adm-card`, `adm-list-row`, `adm-btn`, `adm-btn--primary/ghost/danger`, `adm-pill`, `adm-eyebrow`, `adm-h1`, `adm-lede`, `adm-empty`, `adm-toolbar`, `adm-select`).
- **Server Actions:** `"use server"`, validan staff con un helper `requireStaff()` (ver `src/app/admin/actions.ts`) y usan el cliente service-role.
- **Factura C:** receptor por defecto **Consumidor Final** (`DocTipo 99`, `CondicionIVAReceptorId 5`). Identificación opcional: DNI (`96`) o CUIT (`80`); en v1 `CondicionIVAReceptorId` queda `5` siempre.
- **Emisor (PDF):** datos de las variables `ARCA_*` vía `getArcaConfig().emisor` + `.cuit` + `.ptoVta`. Condición frente al IVA del emisor: "Responsable Monotributo".
- **PDF al vuelo:** no se almacenan archivos; se regenera desde los datos guardados. `invoices.qr_url` ya tiene la URL del QR oficial.
- **Errores:** si ARCA rechaza, se muestra el motivo en pantalla y NO se envía email. Las facturas con error NO se persisten (v1).
- **Idioma:** identificadores en inglés/snake_case; textos de UI y mensajes en español.

---

### Task 1: Dependencias y configuración

**Files:**
- Modify: `package.json`, `next.config.ts`

**Interfaces:**
- Produces: `@react-pdf/renderer`, `qrcode`, `@types/qrcode` instalados; `next.config.ts` con `serverExternalPackages`.

- [ ] **Step 1: Instalar dependencias**

```bash
npm install @react-pdf/renderer qrcode
npm install -D @types/qrcode
```

Si npm reporta conflicto de peer dependencies con React 19, reintentar con:
```bash
npm install @react-pdf/renderer qrcode --legacy-peer-deps
```

- [ ] **Step 2: Excluir @react-pdf/renderer del bundling del servidor**

Reemplazar el contenido de `next.config.ts` por:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "chore: agregar @react-pdf/renderer y qrcode para PDF de facturas"
```

---

### Task 2: Migración — columnas `environment` y `descripcion`

**Files:**
- Create: `supabase/migrations/20260620_invoices_plan_b.sql`

**Interfaces:**
- Produces: `invoices.environment` (text, default 'homologacion') y `invoices.descripcion` (text).

- [ ] **Step 1: Crear la migración**

```sql
-- Plan B: separar entorno de prueba/real y guardar el concepto facturado.
alter table public.invoices
  add column if not exists environment text not null default 'homologacion'
    check (environment in ('homologacion','produccion')),
  add column if not exists descripcion text;
```

- [ ] **Step 2: Aplicar en Supabase**

Aplicar el SQL (CLI `supabase db push` o SQL Editor del dashboard).
Expected: las dos columnas existen en `public.invoices`.

- [ ] **Step 3: Verificar**

En el SQL Editor:
```sql
select environment, descripcion from public.invoices limit 1;
```
Expected: la consulta corre sin error (las facturas previas quedan con `environment='homologacion'`, `descripcion=null`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260620_invoices_plan_b.sql
git commit -m "feat: columnas environment y descripcion en invoices"
```

---

### Task 3: `invoice-service` — guardar `environment` y `descripcion`

**Files:**
- Modify: `src/lib/arca/invoice-service.ts`

**Interfaces:**
- Consumes: `getArcaConfig`, `solicitarCae`, `buildQrUrl`, `pesos`, `InvoiceInput`, `DocTipo`.
- Produces: `EmitInput` ahora incluye `descripcion: string`; `emitirFactura` guarda `environment` y `descripcion`. Devuelve `{ id, cbte_nro, cae, qr_url }` (sin cambios).

- [ ] **Step 1: Agregar `descripcion` al `EmitInput`**

En `src/lib/arca/invoice-service.ts`, en la interfaz `EmitInput`, agregar el campo:

```ts
export interface EmitInput {
  clientId?: string
  appointmentId?: string
  concepto: 1 | 2 | 3
  docTipo: DocTipo
  docNro: string
  receptorNombre?: string
  condIvaReceptor: number
  totalCents: number
  descripcion: string
  servDesde?: Date
  servHasta?: Date
}
```

- [ ] **Step 2: Guardar `environment` y `descripcion` en el insert**

En la llamada `.from("invoices").insert({ ... })` dentro de `emitirFactura`, agregar estas dos propiedades (junto a las existentes):

```ts
      environment: cfg.env,
      descripcion: input.descripcion,
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arca/invoice-service.ts
git commit -m "feat: emitirFactura guarda environment y descripcion"
```

---

### Task 4: Helpers de formato (TDD)

**Files:**
- Create: `src/lib/arca/format.ts`
- Test: `src/lib/arca/format.test.ts`

**Interfaces:**
- Produces:
  - `function pesosToCents(pesos: number): number`
  - `function ddmmyyyy(isoDate: string): string` (de `"2026-06-19"` a `"19/06/2026"`)
  - `function receptorDocLabel(docTipo: number, docNro: string): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/arca/format.test.ts
import { describe, it, expect } from "vitest"
import { pesosToCents, ddmmyyyy, receptorDocLabel } from "./format"

describe("pesosToCents", () => {
  it("convierte pesos a centavos redondeando", () => {
    expect(pesosToCents(3500)).toBe(350000)
    expect(pesosToCents(19.99)).toBe(1999)
    expect(pesosToCents(0.1)).toBe(10)
  })
})

describe("ddmmyyyy", () => {
  it("formatea una fecha ISO a dd/mm/yyyy", () => {
    expect(ddmmyyyy("2026-06-19")).toBe("19/06/2026")
  })
})

describe("receptorDocLabel", () => {
  it("etiqueta según el tipo de documento", () => {
    expect(receptorDocLabel(99, "0")).toBe("Consumidor Final")
    expect(receptorDocLabel(96, "30123456")).toBe("DNI 30123456")
    expect(receptorDocLabel(80, "20304050607")).toBe("CUIT 20304050607")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/arca/format.test.ts`
Expected: FAIL ("Cannot find module './format'").

- [ ] **Step 3: Implementar `src/lib/arca/format.ts`**

```ts
export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export function ddmmyyyy(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

export function receptorDocLabel(docTipo: number, docNro: string): string {
  if (docTipo === 96) return `DNI ${docNro}`
  if (docTipo === 80) return `CUIT ${docNro}`
  return "Consumidor Final"
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/arca/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/arca/format.ts src/lib/arca/format.test.ts
git commit -m "feat: helpers de formato para facturas (pesos, fecha, receptor)"
```

---

### Task 5: Render del PDF (`pdf.tsx`)

**Files:**
- Create: `src/lib/arca/pdf.tsx`

**Interfaces:**
- Consumes: `@react-pdf/renderer`, `qrcode`, `fmtPrice` (de `@/app/reserva/data`).
- Produces:
  - `interface InvoicePdfData { emisor: { razonSocial: string; cuit: string; domicilio: string; inicioActividades: string; iibb: string }; ptoVta: number; nro: number; fecha: string; cae: string; caeVto: string; receptorDoc: string; receptorNombre: string; descripcion: string; totalCents: number; qrUrl: string }`
  - `function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer>`

- [ ] **Step 1: Leer brevemente la doc de @react-pdf**

`@react-pdf/renderer` expone `renderToBuffer(element)`, y los componentes `Document, Page, View, Text, Image, StyleSheet`. El QR se pasa como data URL a `<Image src={...} />`. No requiere navegador (corre en Node).

- [ ] **Step 2: Implementar `src/lib/arca/pdf.tsx`**

```tsx
import "server-only"
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer"
import QRCode from "qrcode"
import { fmtPrice } from "@/app/reserva/data"

export interface InvoicePdfData {
  emisor: {
    razonSocial: string
    cuit: string
    domicilio: string
    inicioActividades: string
    iibb: string
  }
  ptoVta: number
  nro: number
  fecha: string // dd/mm/yyyy
  cae: string
  caeVto: string // dd/mm/yyyy
  receptorDoc: string
  receptorNombre: string
  descripcion: string
  totalCents: number
  qrUrl: string
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#2b2623" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottom: "1 solid #2b2623", paddingBottom: 10, marginBottom: 14 },
  emisor: { maxWidth: 280 },
  razon: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  small: { fontSize: 9, color: "#4a423d", marginBottom: 2 },
  compBox: { alignItems: "flex-end" },
  tipo: { fontSize: 22, fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: "#7a6e64", textTransform: "uppercase", marginBottom: 2 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottom: "1 solid #eae2d7" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  total: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 24, borderTop: "1 solid #2b2623", paddingTop: 10 },
  qr: { width: 90, height: 90 },
  cae: { fontSize: 9, textAlign: "right" },
})

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const qrPng = await QRCode.toDataURL(data.qrUrl, { margin: 1, width: 220 })
  const nroFmt = String(data.nro).padStart(8, "0")
  const ptoFmt = String(data.ptoVta).padStart(4, "0")

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.emisor}>
            <Text style={styles.razon}>{data.emisor.razonSocial}</Text>
            <Text style={styles.small}>CUIT: {data.emisor.cuit}</Text>
            <Text style={styles.small}>{data.emisor.domicilio}</Text>
            <Text style={styles.small}>Responsable Monotributo</Text>
            <Text style={styles.small}>Ingresos Brutos: {data.emisor.iibb}</Text>
            <Text style={styles.small}>Inicio de actividades: {data.emisor.inicioActividades}</Text>
          </View>
          <View style={styles.compBox}>
            <Text style={styles.tipo}>FACTURA C</Text>
            <Text style={styles.small}>Cód. 011</Text>
            <Text style={styles.small}>N° {ptoFmt}-{nroFmt}</Text>
            <Text style={styles.small}>Fecha: {data.fecha}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Receptor</Text>
          <Text>{data.receptorNombre}</Text>
          <Text style={styles.small}>{data.receptorDoc}</Text>
          <Text style={styles.small}>Condición IVA: Consumidor Final</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text>{data.descripcion}</Text>
            <Text>{fmtPrice(data.totalCents / 100)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.total}>Total: {fmtPrice(data.totalCents / 100)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Image style={styles.qr} src={qrPng} />
          <View>
            <Text style={styles.cae}>CAE: {data.cae}</Text>
            <Text style={styles.cae}>Vto. CAE: {data.caeVto}</Text>
          </View>
        </View>
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores. (El render real se valida en la Task 8 vía la ruta de descarga.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/arca/pdf.tsx
git commit -m "feat: render del PDF oficial de la Factura C"
```

---

### Task 6: Cargar datos de una factura para el PDF

**Files:**
- Create: `src/lib/arca/invoice-pdf.ts`

**Interfaces:**
- Consumes: `getArcaConfig`, `InvoicePdfData` (de `./pdf`), `ddmmyyyy`, `receptorDocLabel` (de `./format`), cliente service-role de Supabase.
- Produces: `function loadInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null>`

- [ ] **Step 1: Implementar `src/lib/arca/invoice-pdf.ts`**

```ts
import "server-only"
import { createClient } from "@supabase/supabase-js"
import { getArcaConfig } from "./config"
import { ddmmyyyy, receptorDocLabel } from "./format"
import type { InvoicePdfData } from "./pdf"

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function loadInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
  const { data: row } = await admin()
    .from("invoices")
    .select(
      "pto_vta, cbte_nro, fecha_emision, cae, cae_vto, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, descripcion, total_cents, qr_url, estado"
    )
    .eq("id", invoiceId)
    .maybeSingle()

  if (!row || row.estado !== "emitida") return null

  const cfg = getArcaConfig()
  return {
    emisor: {
      razonSocial: cfg.emisor.razonSocial,
      cuit: cfg.cuit,
      domicilio: cfg.emisor.domicilio,
      inicioActividades: cfg.emisor.inicioActividades,
      iibb: cfg.emisor.iibb,
    },
    ptoVta: row.pto_vta,
    nro: row.cbte_nro,
    fecha: ddmmyyyy(row.fecha_emision),
    cae: row.cae,
    caeVto: ddmmyyyy(row.cae_vto),
    receptorDoc: receptorDocLabel(row.receptor_doc_tipo, row.receptor_doc_nro),
    receptorNombre: row.receptor_nombre ?? "Consumidor Final",
    descripcion: row.descripcion ?? "Servicios",
    totalCents: row.total_cents,
    qrUrl: row.qr_url,
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/arca/invoice-pdf.ts
git commit -m "feat: cargar datos de factura para el PDF"
```

---

### Task 7: Email de la factura (con PDF adjunto)

**Files:**
- Create: `src/lib/email/invoice-emails.ts`

**Interfaces:**
- Consumes: `resend`, `fmtPrice` (de `@/app/reserva/data`).
- Produces: `function sendInvoiceEmail(data: { to: string; firstName: string; cbteNro: number; ptoVta: number; fecha: string; totalCents: number; pdf: Buffer }): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar `src/lib/email/invoice-emails.ts`**

```ts
import "server-only"
import { Resend } from "resend"
import { fmtPrice } from "@/app/reserva/data"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = "By Leri Vendler <turnos@bylerivendler.com>"

export async function sendInvoiceEmail(data: {
  to: string
  firstName: string
  cbteNro: number
  ptoVta: number
  fecha: string
  totalCents: number
  pdf: Buffer
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) return { ok: false, error: "Resend no configurado" }

  const nro = `${String(data.ptoVta).padStart(4, "0")}-${String(data.cbteNro).padStart(8, "0")}`
  const subject = `Tu factura ${nro} · By Leri Vendler`

  const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f2ede6;font-family:Georgia,serif;color:#2b2623;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-size:26px;font-weight:400;margin:0 0 16px;">Gracias, ${data.firstName}.</h1>
    <p style="font-size:15px;line-height:1.6;color:#4a423d;margin:0 0 20px;">
      Adjuntamos tu <strong>Factura C ${nro}</strong> del ${data.fecha} por <strong>${fmtPrice(data.totalCents / 100)}</strong>.
    </p>
    <p style="font-size:13px;color:#7a6e64;margin:0;">By Leri Vendler · Pilar, Buenos Aires</p>
  </div>
</body></html>`

  try {
    await resend.emails.send({
      from: FROM,
      to: data.to,
      subject,
      html,
      attachments: [{ filename: `factura-${nro}.pdf`, content: data.pdf }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/invoice-emails.ts
git commit -m "feat: email de factura con PDF adjunto (Resend)"
```

---

### Task 8: Ruta de descarga del PDF

**Files:**
- Create: `src/app/api/admin/facturacion/[id]/pdf/route.ts`

**Interfaces:**
- Consumes: `loadInvoicePdfData`, `renderInvoicePdf`, `isStaffUser`, `createClient` (ssr).
- Produces: `GET /api/admin/facturacion/[id]/pdf` → PDF (staff-gated).

- [ ] **Step 1: Leer la convención de route handlers con params dinámicos**

Revisar en `node_modules/next/dist/docs/` cómo recibe `params` un route handler en esta versión (en Next 16 `params` es un `Promise`). Confirmar contra el ejemplo `src/app/api/admin/notifications/route.ts`.

- [ ] **Step 2: Implementar la ruta**

```ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { loadInvoicePdfData } from "@/lib/arca/invoice-pdf"
import { renderInvoicePdf } from "@/lib/arca/pdf"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
  }

  const { id } = await params
  const data = await loadInvoicePdfData(id)
  if (!data) return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })

  const pdf = await renderInvoicePdf(data)
  const nro = `${String(data.ptoVta).padStart(4, "0")}-${String(data.nro).padStart(8, "0")}`
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="factura-${nro}.pdf"`,
    },
  })
}
```

- [ ] **Step 3: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/api/admin/facturacion`
Expected: sin errores.

- [ ] **Step 4: Validar el render en dev (manual)**

Con `npm run dev` y env de homologación cargado, logueada como staff, abrir `http://localhost:3000/api/admin/facturacion/<id-de-una-factura-emitida>/pdf`.
Expected: se ve el PDF de la Factura C con datos, total, CAE y QR.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/facturacion/[id]/pdf/route.ts
git commit -m "feat: ruta de descarga del PDF de la factura"
```

---

### Task 9: Server Actions de facturación

**Files:**
- Create: `src/app/admin/facturacion/actions.ts`

**Interfaces:**
- Consumes: `emitirFactura`, `EmitInput`, `loadInvoicePdfData`, `renderInvoicePdf`, `sendInvoiceEmail`, `pesosToCents`, `requireStaff`-equivalente, service-role client.
- Produces:
  - `async function emitirFacturaManual(input: { docTipo: 99|96|80; docNro: string; receptorNombre: string; email: string; descripcion: string; montoPesos: number }): Promise<{ ok: boolean; error?: string; id?: string }>`
  - `async function emitirFacturaTurno(appointmentId: string, identificar: boolean): Promise<{ ok: boolean; error?: string; id?: string }>`
  - `async function reenviarFacturaEmail(invoiceId: string): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar `src/app/admin/facturacion/actions.ts`**

```ts
"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"
import { loadInvoicePdfData } from "@/lib/arca/invoice-pdf"
import { renderInvoicePdf } from "@/lib/arca/pdf"
import { sendInvoiceEmail } from "@/lib/email/invoice-emails"
import { pesosToCents } from "@/lib/arca/format"

async function requireStaff() {
  const supabase = await createSsrClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) throw new Error("Acceso denegado")
}

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// Envía el PDF por email si hay destinatario. No interrumpe si el email falla.
async function enviarPdfPorEmail(invoiceId: string, to: string | null, firstName: string) {
  if (!to) return
  const data = await loadInvoicePdfData(invoiceId)
  if (!data) return
  const pdf = await renderInvoicePdf(data)
  await sendInvoiceEmail({
    to,
    firstName,
    cbteNro: data.nro,
    ptoVta: data.ptoVta,
    fecha: data.fecha,
    totalCents: data.totalCents,
    pdf,
  })
}

const ManualSchema = z.object({
  docTipo: z.union([z.literal(99), z.literal(96), z.literal(80)]),
  docNro: z.string().trim(),
  receptorNombre: z.string().trim(),
  email: z.string().trim(),
  descripcion: z.string().trim().min(1, "Falta la descripción"),
  montoPesos: z.number().positive("El monto debe ser mayor a 0"),
})

export async function emitirFacturaManual(
  input: z.infer<typeof ManualSchema>
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireStaff()
  const parsed = ManualSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  const v = parsed.data

  try {
    const factura = await emitirFactura({
      concepto: 2,
      docTipo: v.docTipo,
      docNro: v.docTipo === 99 ? "0" : v.docNro,
      receptorNombre: v.receptorNombre || undefined,
      condIvaReceptor: 5,
      totalCents: pesosToCents(v.montoPesos),
      descripcion: v.descripcion,
    })
    await enviarPdfPorEmail(factura.id, v.email || null, v.receptorNombre || "Hola")
    revalidatePath("/admin/facturacion")
    return { ok: true, id: factura.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function emitirFacturaTurno(
  appointmentId: string,
  identificar: boolean
): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireStaff()
  const admin = adminClient()

  const { data: appt } = await admin
    .from("appointments")
    .select(`
      id, total_cents, client:clients(id, first_name, last_name, email, dni),
      appointment_services(service:services(name))
    `)
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return { ok: false, error: "Turno no encontrado" }
  const client = appt.client as unknown as { id: string; first_name: string; last_name: string; email: string | null; dni: string | null } | null
  const services = (appt.appointment_services ?? []) as unknown as { service: { name: string } | null }[]
  const descripcion = services.map((s) => s.service?.name).filter(Boolean).join(", ") || "Servicios"

  const useDni = identificar && !!client?.dni
  try {
    const factura = await emitirFactura({
      clientId: client?.id,
      appointmentId,
      concepto: 2,
      docTipo: useDni ? 96 : 99,
      docNro: useDni ? client!.dni! : "0",
      receptorNombre: client ? `${client.first_name} ${client.last_name}` : undefined,
      condIvaReceptor: 5,
      totalCents: appt.total_cents,
      descripcion,
    })
    await enviarPdfPorEmail(factura.id, client?.email ?? null, client?.first_name ?? "Hola")
    revalidatePath("/admin/facturacion")
    revalidatePath("/admin/turnos")
    return { ok: true, id: factura.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function reenviarFacturaEmail(
  invoiceId: string
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff()
  const admin = adminClient()
  const { data: inv } = await admin
    .from("invoices")
    .select("client_id, receptor_nombre")
    .eq("id", invoiceId)
    .maybeSingle()
  if (!inv) return { ok: false, error: "Factura no encontrada" }

  let to: string | null = null
  let firstName = inv.receptor_nombre ?? "Hola"
  if (inv.client_id) {
    const { data: c } = await admin
      .from("clients")
      .select("email, first_name")
      .eq("id", inv.client_id)
      .maybeSingle()
    to = c?.email ?? null
    if (c?.first_name) firstName = c.first_name
  }
  if (!to) return { ok: false, error: "La factura no tiene un email asociado" }

  try {
    await enviarPdfPorEmail(invoiceId, to, firstName)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/facturacion`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/facturacion/actions.ts
git commit -m "feat: server actions de facturación (manual, turno, reenviar)"
```

---

### Task 10: Pantalla de historial

**Files:**
- Create: `src/app/admin/facturacion/page.tsx`
- Create: `src/app/admin/facturacion/reenviar-button.tsx`

**Interfaces:**
- Consumes: `reenviarFacturaEmail`, `fmtPrice`, `ddmmyyyy`, `receptorDocLabel`, service-role client, `requireAdmin`.
- Produces: página `/admin/facturacion` (historial).

- [ ] **Step 1: Implementar el botón de reenviar (client)**

```tsx
// src/app/admin/facturacion/reenviar-button.tsx
"use client"

import { useState, useTransition } from "react"
import { reenviarFacturaEmail } from "./actions"

export default function ReenviarButton({ invoiceId }: { invoiceId: string }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <>
      <button
        className="adm-btn adm-btn--ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reenviarFacturaEmail(invoiceId)
            setMsg(r.ok ? "Enviado ✓" : r.error ?? "Error")
          })
        }
      >
        {pending ? "Enviando…" : "Reenviar email"}
      </button>
      {msg && <span style={{ fontSize: 11, color: "var(--ink-mute)", marginLeft: 6 }}>{msg}</span>}
    </>
  )
}
```

- [ ] **Step 2: Implementar la página de historial (server)**

```tsx
// src/app/admin/facturacion/page.tsx
import Link from "next/link"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "@/app/reserva/data"
import { ddmmyyyy, receptorDocLabel } from "@/lib/arca/format"
import ReenviarButton from "./reenviar-button"

export const dynamic = "force-dynamic"

type InvoiceRow = {
  id: string
  cbte_nro: number
  pto_vta: number
  fecha_emision: string
  receptor_doc_tipo: number
  receptor_doc_nro: string
  receptor_nombre: string | null
  total_cents: number
  estado: string
  environment: string
}

export default async function FacturacionPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data } = await admin
    .from("invoices")
    .select("id, cbte_nro, pto_vta, fecha_emision, receptor_doc_tipo, receptor_doc_nro, receptor_nombre, total_cents, estado, environment")
    .order("created_at", { ascending: false })
    .limit(200)

  const invoices = (data ?? []) as InvoiceRow[]

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="adm-eyebrow" style={{ marginBottom: 0 }}>Facturación</p>
        <Link href="/admin/facturacion/nueva" className="adm-btn" style={{ fontSize: 12 }}>
          + Factura manual
        </Link>
      </div>
      <h1 className="adm-h1">Fac<em>turas</em></h1>
      <p className="adm-lede">{invoices.length} comprobante{invoices.length === 1 ? "" : "s"}.</p>

      <div className="adm-card">
        {invoices.length === 0 ? (
          <div className="adm-empty">Todavía no emitiste facturas.</div>
        ) : (
          invoices.map((f) => {
            const nro = `${String(f.pto_vta).padStart(4, "0")}-${String(f.cbte_nro).padStart(8, "0")}`
            return (
              <div key={f.id} className="adm-list-row" style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}>
                <div className="adm-time" style={{ fontSize: 13 }}>{ddmmyyyy(f.fecha_emision)}</div>
                <div>
                  <div className="adm-name">
                    Factura C {nro}
                    {f.environment === "homologacion" && (
                      <span className="adm-pill" style={{ marginLeft: 8, background: "#eae2d7", color: "#8c6a3c", fontSize: 10 }}>PRUEBA</span>
                    )}
                  </div>
                  <div className="adm-sub">
                    {f.receptor_nombre ?? receptorDocLabel(f.receptor_doc_tipo, f.receptor_doc_nro)}
                  </div>
                </div>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(f.total_cents / 100)}</div>
                <div>
                  <a className="adm-btn adm-btn--ghost" href={`/api/admin/facturacion/${f.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
                </div>
                <div className="adm-actions">
                  <ReenviarButton invoiceId={f.id} />
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

- [ ] **Step 3: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/facturacion`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/facturacion/page.tsx src/app/admin/facturacion/reenviar-button.tsx
git commit -m "feat: pantalla de historial de facturas"
```

---

### Task 11: Pantalla de factura manual

**Files:**
- Create: `src/app/admin/facturacion/nueva/page.tsx`
- Create: `src/app/admin/facturacion/nueva/manual-form.tsx`

**Interfaces:**
- Consumes: `emitirFacturaManual`.
- Produces: página `/admin/facturacion/nueva`.

- [ ] **Step 1: Implementar el formulario (client)**

```tsx
// src/app/admin/facturacion/nueva/manual-form.tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaManual } from "../actions"

export default function ManualForm() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [identificar, setIdentificar] = useState(false)
  const [docTipo, setDocTipo] = useState<96 | 80>(96)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const montoPesos = Number(fd.get("monto"))
    if (!montoPesos || montoPesos <= 0) {
      setError("Ingresá un monto válido")
      return
    }
    start(async () => {
      const r = await emitirFacturaManual({
        docTipo: identificar ? docTipo : 99,
        docNro: identificar ? String(fd.get("docNro") ?? "").trim() : "0",
        receptorNombre: String(fd.get("nombre") ?? "").trim(),
        email: String(fd.get("email") ?? "").trim(),
        descripcion: String(fd.get("descripcion") ?? "").trim(),
        montoPesos,
      })
      if (r.ok) router.push("/admin/facturacion")
      else setError(r.error ?? "Error al emitir")
    })
  }

  return (
    <form className="adm-card" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label>
        <span className="adm-eyebrow">Concepto</span>
        <input name="descripcion" className="adm-input" required placeholder="Ej: Seña de tratamiento" />
      </label>

      <label>
        <span className="adm-eyebrow">Monto (en pesos)</span>
        <input name="monto" className="adm-input" type="number" step="0.01" min="0" required placeholder="3500.00" />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
        <span>Identificar al receptor (sino, Consumidor Final)</span>
      </label>

      {identificar && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 24 }}>
          <label>
            <span className="adm-eyebrow">Tipo de documento</span>
            <select className="adm-select" value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value) as 96 | 80)}>
              <option value={96}>DNI</option>
              <option value={80}>CUIT</option>
            </select>
          </label>
          <label>
            <span className="adm-eyebrow">Número</span>
            <input name="docNro" className="adm-input" placeholder="Sin puntos ni guiones" />
          </label>
          <label>
            <span className="adm-eyebrow">Nombre / Razón social</span>
            <input name="nombre" className="adm-input" />
          </label>
        </div>
      )}

      <label>
        <span className="adm-eyebrow">Email (opcional, para enviar el PDF)</span>
        <input name="email" className="adm-input" type="email" placeholder="clienta@email.com" />
      </label>

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <button className="adm-btn adm-btn--primary" type="submit" disabled={pending}>
        {pending ? "Emitiendo…" : "Emitir factura"}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Implementar la página (server)**

```tsx
// src/app/admin/facturacion/nueva/page.tsx
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import ManualForm from "./manual-form"

export const dynamic = "force-dynamic"

export default async function NuevaFacturaPage() {
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Factura <em>manual</em></h1>
      <p className="adm-lede">Para señas, ventas sueltas o un servicio puntual. Emite una Factura C.</p>
      <ManualForm />
    </>
  )
}
```

- [ ] **Step 3: Verificar que `adm-input` existe; si no, usar estilo inline**

Run: `npx eslint src/app/admin/facturacion/nueva && npx tsc --noEmit`
Buscar en `src/app/admin/admin.css` si existe la clase `.adm-input`. Si NO existe, agregarla a `admin.css`:

```css
.adm-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgba(43, 38, 35, 0.18);
  border-radius: 8px;
  font-size: 14px;
  font-family: var(--sans, inherit);
  background: #fff;
  color: var(--ink, #2b2623);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/facturacion/nueva src/app/admin/admin.css
git commit -m "feat: pantalla de factura manual"
```

---

### Task 12: Facturar desde el turno (confirmación + botón + badge)

**Files:**
- Create: `src/app/admin/turnos/[appointmentId]/facturar/page.tsx`
- Create: `src/app/admin/turnos/[appointmentId]/facturar/facturar-form.tsx`
- Modify: `src/app/admin/_components/status-actions.tsx`
- Modify: `src/app/admin/turnos/page.tsx`

**Interfaces:**
- Consumes: `emitirFacturaTurno`.
- Produces: página de confirmación `/admin/turnos/[appointmentId]/facturar`; botón "Facturar" en turnos completados; badge "Facturada".

- [ ] **Step 1: Formulario de confirmación (client)**

```tsx
// src/app/admin/turnos/[appointmentId]/facturar/facturar-form.tsx
"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { emitirFacturaTurno } from "@/app/admin/facturacion/actions"

export default function FacturarForm({ appointmentId, tieneDni }: { appointmentId: string; tieneDni: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [identificar, setIdentificar] = useState(tieneDni)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {tieneDni ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={identificar} onChange={(e) => setIdentificar(e.target.checked)} />
          <span>Identificar a la clienta con su DNI (sino, Consumidor Final)</span>
        </label>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ink-mute)" }}>La clienta no tiene DNI cargado: se factura como Consumidor Final.</p>
      )}

      {error && <p style={{ color: "#8c463c", fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="adm-btn adm-btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await emitirFacturaTurno(appointmentId, identificar)
              if (r.ok) router.push("/admin/facturacion")
              else setError(r.error ?? "Error al emitir")
            })
          }
        >
          {pending ? "Emitiendo…" : "Emitir factura"}
        </button>
        <button className="adm-btn" onClick={() => router.back()} disabled={pending}>Cancelar</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Página de confirmación (server)**

```tsx
// src/app/admin/turnos/[appointmentId]/facturar/page.tsx
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSsrClient } from "@/lib/supabase/server"
import { requireAdmin } from "@/lib/staff"
import { fmtPrice } from "@/app/reserva/data"
import FacturarForm from "./facturar-form"

export const dynamic = "force-dynamic"

export default async function FacturarTurnoPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params
  const ssr = await createSsrClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (user) await requireAdmin(user.id)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: appt } = await admin
    .from("appointments")
    .select(`total_cents, client:clients(first_name, last_name, dni, email), appointment_services(service:services(name))`)
    .eq("id", appointmentId)
    .maybeSingle()

  if (!appt) return <p className="adm-lede">Turno no encontrado.</p>

  const client = appt.client as unknown as { first_name: string; last_name: string; dni: string | null; email: string | null } | null
  const services = (appt.appointment_services ?? []) as unknown as { service: { name: string } | null }[]
  const descripcion = services.map((s) => s.service?.name).filter(Boolean).join(", ") || "Servicios"

  const { data: yaFacturada } = await admin
    .from("invoices")
    .select("id")
    .eq("appointment_id", appointmentId)
    .maybeSingle()

  return (
    <>
      <p className="adm-eyebrow">Facturación</p>
      <h1 className="adm-h1">Facturar <em>turno</em></h1>

      {yaFacturada && (
        <p style={{ color: "#8c6a3c", fontSize: 13, marginBottom: 12 }}>
          ⚠️ Este turno ya tiene una factura emitida. Si emitís otra, se duplicará.
        </p>
      )}

      <div className="adm-card" style={{ marginBottom: 16 }}>
        <div className="adm-list-row" style={{ gridTemplateColumns: "1fr auto" }}>
          <div>
            <div className="adm-name">{client ? `${client.first_name} ${client.last_name}` : "—"}</div>
            <div className="adm-sub">{descripcion}</div>
            <div className="adm-sub">{client?.dni ? `DNI ${client.dni}` : "Sin DNI"}{client?.email ? ` · ${client.email}` : ""}</div>
          </div>
          <div style={{ fontFamily: "var(--serif)", fontWeight: 500 }}>{fmtPrice(appt.total_cents / 100)}</div>
        </div>
      </div>

      <FacturarForm appointmentId={appointmentId} tieneDni={!!client?.dni} />
    </>
  )
}
```

- [ ] **Step 3: Agregar botón "Facturar" a `status-actions.tsx`**

En `src/app/admin/_components/status-actions.tsx`, dentro del `return (...)`, agregar — después del bloque de `actions.map(...)` y antes del bloque de reagendar — un enlace que aparece solo cuando el turno está completado:

```tsx
      {currentStatus === "completed" && (
        <a href={`/admin/turnos/${appointmentId}/facturar`} className="adm-btn adm-btn--primary">
          Facturar
        </a>
      )}
```

Además, cambiar la guarda temprana para que no oculte el botón en turnos completados. Reemplazar:

```tsx
  if (actions.length === 0 && !canReschedule) {
    return <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>—</span>
  }
```

por:

```tsx
  if (actions.length === 0 && !canReschedule && currentStatus !== "completed") {
    return <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>—</span>
  }
```

- [ ] **Step 4: Mostrar badge "Facturada" en la lista de turnos**

En `src/app/admin/turnos/page.tsx`, después de obtener `appts`, agregar una consulta de las facturas por turno y un set:

```tsx
  const { data: facturadas } = await admin
    .from("invoices")
    .select("appointment_id")
    .not("appointment_id", "is", null)
  const facturadasSet = new Set((facturadas ?? []).map((f) => f.appointment_id as string))
```

Y en el render del `<div>` del estado (donde está `<span className={\`adm-pill adm-pill--${a.status}\`}>`), agregar al lado el badge:

```tsx
                  {facturadasSet.has(a.id) && (
                    <span className="adm-pill" style={{ marginLeft: 6, background: "#dfe9df", color: "#3c6a3c", fontSize: 10 }}>Facturada</span>
                  )}
```

- [ ] **Step 5: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/turnos src/app/admin/_components`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/turnos/[appointmentId]/facturar src/app/admin/_components/status-actions.tsx src/app/admin/turnos/page.tsx
git commit -m "feat: facturar desde el turno con confirmación + badge"
```

---

### Task 13: Ítem "Facturación" en el menú del admin

**Files:**
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Produces: enlace "Facturación" en el menú lateral (solo roles no-`professional`).

- [ ] **Step 1: Agregar el enlace**

En `src/app/admin/layout.tsx`, dentro del bloque `else` (el de roles no-`professional`, donde están "Nueva reserva", "Clientas", etc.), agregar después de "Combos" (o donde quede prolijo):

```tsx
                <Link href="/admin/facturacion" className="adm-nav__item">
                  Facturación
                </Link>
```

- [ ] **Step 2: Verificar que compila y linta**

Run: `npx tsc --noEmit && npx eslint src/app/admin/layout.tsx`
Expected: sin errores.

- [ ] **Step 3: Validar el flujo completo en dev (manual)**

Con `npm run dev` (homologación), logueada como admin:
1. Menú **Facturación** → ves el historial (con la factura de prueba previa, etiqueta PRUEBA).
2. **+ Factura manual** → cargás concepto + monto → Emitir → vuelve al historial con la nueva.
3. **PDF** → abre el comprobante con CAE + QR.
4. En **Turnos**, un turno **Completado** → botón **Facturar** → confirmás → se emite y aparece el badge **Facturada**.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat: ítem Facturación en el menú del admin"
```

---

## Self-Review (cobertura vs spec — sección 12)

- **PDF al vuelo (@react-pdf + qrcode), descarga** → Tasks 1, 5, 8. ✔
- **Email con adjunto (Resend)** → Task 7; envío al emitir + reenviar → Task 9. ✔
- **Columna `environment` + `descripcion`** → Task 2; estampado → Task 3; badge PRUEBA → Task 10. ✔
- **Menú "Facturación"** → Task 13. ✔
- **Historial (descargar + reenviar)** → Task 10. ✔
- **Factura manual (una línea, receptor CF/DNI/CUIT, monto)** → Tasks 9, 11. ✔
- **Botón Facturar en turno con confirmación + badge Facturada** → Task 12. ✔
- **Errores mostrados, no persistidos** → manejado en las actions (try/catch, no insert en error) — Task 9. ✔
- **Helpers puros testeados** → Task 4. ✔

**Type consistency:** `EmitInput` (Task 3) gana `descripcion`; `InvoicePdfData` se define en `pdf.tsx` (Task 5) y se consume en `invoice-pdf.ts` (Task 6), la ruta (Task 8) y las actions (Task 9). `emitirFacturaManual`/`emitirFacturaTurno`/`reenviarFacturaEmail` (Task 9) se consumen en Tasks 10–12. `pesosToCents`/`ddmmyyyy`/`receptorDocLabel` (Task 4) se usan en Tasks 9, 6, 10.
