# Facturación ARCA — Plan A: Núcleo de conexión

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la capa que autentica contra ARCA (WSAA), pide el CAE de una Factura C (WSFE) y guarda la factura en Supabase, validada de punta a punta en homologación.

**Architecture:** Capa propia liviana en `src/lib/arca/`. Firma del login ticket con `node-forge` (PKCS#7, JS puro). Comunicación SOAP con `soap`. Token de WSAA persistido en la tabla `arca_tokens` y reutilizado durante sus 12 h de validez (clave para serverless/Vercel). Lógica pura (firma, armado de payload, QR, importes) testeada con `vitest`; las llamadas de red se validan con una ruta de smoke-test en homologación.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase, `soap`, `node-forge`, `xml2js`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-06-19-facturacion-arca-design.md`

## Global Constraints

- **Plataforma:** despliegue en Vercel (serverless). Nada de binarios externos (OpenSSL): la firma es JS puro con `node-forge`.
- **Next.js no estándar:** antes de escribir código de Next (route handlers, etc.), leer la guía correspondiente en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
- **Convenciones DB:** snake_case, uuid PK, timestamptz, RLS desde día 1 con `public.is_staff()`. Trigger `public.tg_set_updated_at()` para `updated_at`.
- **Dinero:** precios SIEMPRE en centavos (int) en nuestra base. A ARCA se envían en **pesos con 2 decimales** (`cents/100`).
- **Acceso server:** los Server Actions / rutas usan `SUPABASE_SERVICE_ROLE_KEY` (bypassean RLS) y validan staff con `isStaffUser` / `requireStaff`.
- **Factura C:** `CbteTipo = 11`. No discrimina IVA: `ImpNeto = ImpTotal`, `ImpIVA = 0`, sin array de alícuotas.
- **Obligatorio ARCA (RG 5616):** `CondicionIVAReceptorId` siempre presente. Consumidor Final = `5`.
- **Entornos:** desarrollar y validar TODO en **homologación** antes de tocar producción. `ARCA_ENV` = `homologacion` | `produccion`.
- **Idioma:** identificadores en inglés/snake_case como el resto del repo; textos de UI y mensajes de error en español.

---

### Task 1: Setup de dependencias y tests

**Files:**
- Modify: `package.json` (scripts + dependencias)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: comando `npm test` que corre vitest; dependencias `soap`, `node-forge`, `xml2js`, `vitest`, `@types/node-forge`, `@types/xml2js` instaladas.

- [ ] **Step 1: Instalar dependencias de runtime**

```bash
npm install soap node-forge xml2js
```

- [ ] **Step 2: Instalar dependencias de desarrollo**

```bash
npm install -D vitest @types/node-forge @types/xml2js
```

- [ ] **Step 3: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
```

- [ ] **Step 4: Agregar script de test en `package.json`**

En la sección `"scripts"`, agregar:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verificar que vitest corre (sin tests todavía)**

Run: `npm test`
Expected: vitest arranca y reporta "No test files found" (exit 0) — confirma que está instalado.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: agregar soap, node-forge, xml2js y vitest para módulo ARCA"
```

---

### Task 2: Script para generar el certificado (CSR + clave privada)

Deliverable inmediato: la usuaria corre esto, obtiene un `.csr` para subir a ARCA y una `.key` para guardar. Desbloquea el trámite de homologación.

**Files:**
- Create: `scripts/arca-generar-certificado.mjs`
- Modify: `package.json` (script de conveniencia)

**Interfaces:**
- Produces: archivos `arca-<alias>.key` (clave privada PEM) y `arca-<alias>.csr` (pedido de certificado PEM) en el directorio actual.

- [ ] **Step 1: Crear el script**

```js
// scripts/arca-generar-certificado.mjs
// Uso: node scripts/arca-generar-certificado.mjs <CUIT> [alias]
import forge from "node-forge"
import { writeFileSync } from "node:fs"

const cuit = process.argv[2]
const alias = process.argv[3] ?? "byleri"

if (!cuit || !/^\d{11}$/.test(cuit)) {
  console.error("Uso: node scripts/arca-generar-certificado.mjs <CUIT de 11 dígitos> [alias]")
  process.exit(1)
}

console.log("Generando clave privada (2048 bits)… puede tardar unos segundos.")
const keys = forge.pki.rsa.generateKeyPair(2048)

const csr = forge.pki.createCertificationRequest()
csr.publicKey = keys.publicKey
csr.setSubject([
  { name: "countryName", value: "AR" },
  { name: "organizationName", value: "By Leri Vendler" },
  { name: "commonName", value: alias },
  { name: "serialNumber", value: `CUIT ${cuit}` },
])
csr.sign(keys.privateKey, forge.md.sha256.create())

const keyFile = `arca-${alias}.key`
const csrFile = `arca-${alias}.csr`
writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey))
writeFileSync(csrFile, forge.pki.certificationRequestToPem(csr))

console.log(`\n✓ Clave privada: ${keyFile}  (GUARDALA, no la subas a ARCA ni a git)`)
console.log(`✓ Pedido de certificado: ${csrFile}  (este es el que subís a ARCA)`)
console.log(`\nPróximo paso: abrí ${csrFile}, copiá todo su contenido y pegalo en ARCA (WSASS → Nuevo certificado).`)
```

- [ ] **Step 2: Agregar script de conveniencia en `package.json`**

En `"scripts"`:

```json
"arca:cert": "node scripts/arca-generar-certificado.mjs"
```

- [ ] **Step 3: Verificar que genera los archivos**

Run: `node scripts/arca-generar-certificado.mjs 20111111112 homologacion`
Expected: crea `arca-homologacion.key` y `arca-homologacion.csr`, imprime los dos `✓`. (Borrar estos archivos de prueba después: `rm arca-homologacion.key arca-homologacion.csr`.)

- [ ] **Step 4: Asegurar que claves/certs no entren a git**

Agregar al final de `.gitignore`:

```
# Certificados ARCA (NUNCA commitear)
arca-*.key
arca-*.csr
arca-*.crt
```

- [ ] **Step 5: Commit**

```bash
git add scripts/arca-generar-certificado.mjs package.json .gitignore
git commit -m "feat: script para generar CSR + clave privada de ARCA"
```

---

### Task 3: Migración de base de datos (`invoices` + `arca_tokens`)

**Files:**
- Create: `supabase/migrations/20260619_invoices.sql`

**Interfaces:**
- Produces: tabla `public.invoices` y tabla `public.arca_tokens` con RLS de staff.

- [ ] **Step 1: Crear la migración**

```sql
-- =====================================================================
-- By Leri Vendler — Facturación electrónica ARCA (Factura C)
-- =====================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  cbte_tipo int not null default 11,            -- 11 = Factura C
  pto_vta int not null,
  cbte_nro bigint,                              -- lo asigna ARCA
  concepto int not null default 2,              -- 1=Prod, 2=Serv, 3=ProdyServ
  receptor_doc_tipo int not null default 99,    -- 99=CF, 96=DNI, 80=CUIT
  receptor_doc_nro text not null default '0',
  receptor_nombre text,
  receptor_cond_iva int not null default 5,     -- 5 = Consumidor Final
  total_cents int not null check (total_cents >= 0),
  cae text,
  cae_vto date,
  fecha_emision date not null default current_date,
  estado text not null default 'pendiente' check (estado in ('pendiente','emitida','error')),
  error_msg text,
  qr_url text,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_invoices_client on public.invoices(client_id);
create index idx_invoices_appointment on public.invoices(appointment_id);
create unique index idx_invoices_numero
  on public.invoices(pto_vta, cbte_tipo, cbte_nro) where cbte_nro is not null;

create trigger trg_invoices_updated
  before update on public.invoices
  for each row execute function public.tg_set_updated_at();

alter table public.invoices enable row level security;
create policy "invoices_staff_all" on public.invoices
  for all using (public.is_staff()) with check (public.is_staff());

-- Token de WSAA persistido (vale 12 h). Se reutiliza para no ser
-- rechazado por ARCA al pedir un token nuevo teniendo uno válido.
create table public.arca_tokens (
  service text not null,
  environment text not null check (environment in ('homologacion','produccion')),
  token text not null,
  sign text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (service, environment)
);

alter table public.arca_tokens enable row level security;
create policy "arca_tokens_staff_all" on public.arca_tokens
  for all using (public.is_staff()) with check (public.is_staff());
```

- [ ] **Step 2: Aplicar la migración en Supabase**

Aplicar el SQL en el proyecto Supabase (CLI `supabase db push` o pegándolo en el SQL Editor del dashboard).
Expected: ambas tablas existen, sin errores.

- [ ] **Step 3: Verificar las tablas**

En el SQL Editor de Supabase:
```sql
select count(*) from public.invoices;
select count(*) from public.arca_tokens;
```
Expected: ambas devuelven `0` (existen y están vacías).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619_invoices.sql
git commit -m "feat: tablas invoices y arca_tokens"
```

---

### Task 4: Módulo de configuración ARCA

**Files:**
- Create: `src/lib/arca/config.ts`
- Modify: `.env.local` (agregar variables; NO se commitea)

**Interfaces:**
- Produces:
  - `type ArcaEnv = "homologacion" | "produccion"`
  - `interface ArcaConfig { env: ArcaEnv; cuit: string; ptoVta: number; cert: string; key: string; wsaaUrl: string; wsfeUrl: string; emisor: { razonSocial: string; domicilio: string; inicioActividades: string; iibb: string } }`
  - `function getArcaConfig(): ArcaConfig`

- [ ] **Step 1: Crear `src/lib/arca/config.ts`**

```ts
import "server-only"

export type ArcaEnv = "homologacion" | "produccion"

export interface ArcaConfig {
  env: ArcaEnv
  cuit: string
  ptoVta: number
  cert: string
  key: string
  wsaaUrl: string
  wsfeUrl: string
  emisor: {
    razonSocial: string
    domicilio: string
    inicioActividades: string
    iibb: string
  }
}

const URLS = {
  homologacion: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL",
  },
  produccion: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL",
  },
} as const

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

export function getArcaConfig(): ArcaConfig {
  const env = (process.env.ARCA_ENV ?? "homologacion") as ArcaEnv
  return {
    env,
    cuit: required("ARCA_CUIT"),
    ptoVta: Number(required("ARCA_PTO_VTA")),
    // En Vercel los saltos de línea del PEM van escapados como \n
    cert: required("ARCA_CERT").replace(/\\n/g, "\n"),
    key: required("ARCA_KEY").replace(/\\n/g, "\n"),
    wsaaUrl: URLS[env].wsaa,
    wsfeUrl: URLS[env].wsfe,
    emisor: {
      razonSocial: process.env.ARCA_RAZON_SOCIAL ?? "By Leri Vendler",
      domicilio: process.env.ARCA_DOMICILIO ?? "",
      inicioActividades: process.env.ARCA_INICIO_ACTIVIDADES ?? "",
      iibb: process.env.ARCA_IIBB ?? "Exento",
    },
  }
}
```

- [ ] **Step 2: Documentar las variables en `.env.local`**

Agregar a `.env.local` (placeholders por ahora; los valores reales llegan con el certificado de homologación):

```bash
ARCA_ENV=homologacion
ARCA_CUIT=20111111112
ARCA_PTO_VTA=1
ARCA_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
ARCA_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
ARCA_RAZON_SOCIAL="By Leri Vendler"
ARCA_DOMICILIO="(domicilio comercial)"
ARCA_INICIO_ACTIVIDADES="2020-01-01"
ARCA_IIBB="Exento"
```

- [ ] **Step 3: Verificar que tipa y compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `src/lib/arca/config.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/arca/config.ts
git commit -m "feat: configuración ARCA (entornos, cert/key, URLs)"
```

---

### Task 5: Firma del login ticket (WSAA TRA + CMS)

**Files:**
- Create: `src/lib/arca/wsaa-sign.ts`
- Test: `src/lib/arca/wsaa-sign.test.ts`

**Interfaces:**
- Produces:
  - `function buildTra(service?: string, now?: Date): string`
  - `function signTra(traXml: string, certPem: string, keyPem: string): string` (devuelve CMS en base64)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/arca/wsaa-sign.test.ts
import { describe, it, expect } from "vitest"
import forge from "node-forge"
import { buildTra, signTra } from "./wsaa-sign"

describe("buildTra", () => {
  it("incluye el servicio y un uniqueId basado en el tiempo", () => {
    const now = new Date("2026-06-19T12:00:00Z")
    const tra = buildTra("wsfe", now)
    expect(tra).toContain("<service>wsfe</service>")
    expect(tra).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`)
    expect(tra).toContain("<generationTime>")
    expect(tra).toContain("<expirationTime>")
  })
})

describe("signTra", () => {
  it("devuelve un CMS en base64 decodificable", () => {
    // Cert + clave de juguete para el test
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = "01"
    cert.validity.notBefore = new Date("2026-01-01")
    cert.validity.notAfter = new Date("2027-01-01")
    const attrs = [{ name: "commonName", value: "test" }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const certPem = forge.pki.certificateToPem(cert)
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

    const cms = signTra("<x/>", certPem, keyPem)
    expect(cms.length).toBeGreaterThan(0)
    // Debe ser base64 válido que decodifica a un PKCS7
    const der = forge.util.decode64(cms)
    const asn1 = forge.asn1.fromDer(der)
    expect(asn1).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/arca/wsaa-sign.test.ts`
Expected: FAIL ("Cannot find module './wsaa-sign'").

- [ ] **Step 3: Implementar `src/lib/arca/wsaa-sign.ts`**

```ts
import forge from "node-forge"

export function buildTra(service = "wsfe", now: Date = new Date()): string {
  const uniqueId = Math.floor(now.getTime() / 1000)
  const gen = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
  const exp = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${gen}</generationTime>
    <expirationTime>${exp}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`
}

export function signTra(traXml: string, certPem: string, keyPem: string): string {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(traXml, "utf8")
  const cert = forge.pki.certificateFromPem(certPem)
  const key = forge.pki.privateKeyFromPem(keyPem)
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  })
  p7.sign()
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/arca/wsaa-sign.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/arca/wsaa-sign.ts src/lib/arca/wsaa-sign.test.ts
git commit -m "feat: armado y firma CMS del login ticket WSAA"
```

---

### Task 6: Construcción de la URL del QR

**Files:**
- Create: `src/lib/arca/qr.ts`
- Test: `src/lib/arca/qr.test.ts`

**Interfaces:**
- Produces:
  - `interface QrData { fecha: string; cuit: number; ptoVta: number; tipoCmp: number; nroCmp: number; importe: number; moneda: string; ctz: number; tipoDocRec: number; nroDocRec: number; codAut: number }`
  - `function buildQrUrl(d: QrData): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/arca/qr.test.ts
import { describe, it, expect } from "vitest"
import { buildQrUrl } from "./qr"

describe("buildQrUrl", () => {
  it("codifica el payload oficial en base64 dentro de la URL de ARCA", () => {
    const url = buildQrUrl({
      fecha: "2026-06-19",
      cuit: 20111111112,
      ptoVta: 1,
      tipoCmp: 11,
      nroCmp: 150,
      importe: 3500,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      codAut: 73429843294823,
    })
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true)
    const b64 = url.split("?p=")[1]
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))
    expect(json.ver).toBe(1)
    expect(json.tipoCodAut).toBe("E")
    expect(json.codAut).toBe(73429843294823)
    expect(json.importe).toBe(3500)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/arca/qr.test.ts`
Expected: FAIL ("Cannot find module './qr'").

- [ ] **Step 3: Implementar `src/lib/arca/qr.ts`**

```ts
export interface QrData {
  fecha: string // yyyy-mm-dd
  cuit: number
  ptoVta: number
  tipoCmp: number
  nroCmp: number
  importe: number
  moneda: string
  ctz: number
  tipoDocRec: number
  nroDocRec: number
  codAut: number // CAE como número
}

export function buildQrUrl(d: QrData): string {
  const payload = {
    ver: 1,
    fecha: d.fecha,
    cuit: d.cuit,
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    importe: d.importe,
    moneda: d.moneda,
    ctz: d.ctz,
    tipoDocRec: d.tipoDocRec,
    nroDocRec: d.nroDocRec,
    tipoCodAut: "E",
    codAut: d.codAut,
  }
  const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64")
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/arca/qr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/arca/qr.ts src/lib/arca/qr.test.ts
git commit -m "feat: construcción de URL del QR de ARCA"
```

---

### Task 7: Armado del payload FECAESolicitar

**Files:**
- Create: `src/lib/arca/wsfe-payload.ts`
- Test: `src/lib/arca/wsfe-payload.test.ts`

**Interfaces:**
- Consumes: `Auth` (definido aquí también para evitar dependencia circular; se reexporta desde `auth.ts`).
- Produces:
  - `interface Auth { Token: string; Sign: string; Cuit: string }`
  - `type DocTipo = 99 | 96 | 80`
  - `interface InvoiceInput { ptoVta: number; concepto: 1|2|3; docTipo: DocTipo; docNro: string; condIvaReceptor: number; totalCents: number; fecha: Date; servDesde?: Date; servHasta?: Date; vtoPago?: Date }`
  - `function pesos(cents: number): number`
  - `function ymd(d: Date): string`
  - `function buildFeCAEReq(auth: Auth, input: InvoiceInput, cbteNro: number): object`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/arca/wsfe-payload.test.ts
import { describe, it, expect } from "vitest"
import { pesos, ymd, buildFeCAEReq, type Auth, type InvoiceInput } from "./wsfe-payload"

const auth: Auth = { Token: "t", Sign: "s", Cuit: "20111111112" }

describe("helpers", () => {
  it("convierte centavos a pesos con 2 decimales", () => {
    expect(pesos(350000)).toBe(3500)
    expect(pesos(199)).toBe(1.99)
  })
  it("formatea fecha yyyymmdd", () => {
    expect(ymd(new Date("2026-06-19T12:00:00Z"))).toBe("20260619")
  })
})

describe("buildFeCAEReq", () => {
  const base: InvoiceInput = {
    ptoVta: 1,
    concepto: 2,
    docTipo: 99,
    docNro: "0",
    condIvaReceptor: 5,
    totalCents: 350000,
    fecha: new Date("2026-06-19T12:00:00Z"),
  }

  it("arma Factura C con neto = total e IVA 0", () => {
    const req: any = buildFeCAEReq(auth, base, 151)
    expect(req.FeCAEReq.FeCabReq.CbteTipo).toBe(11)
    expect(req.FeCAEReq.FeCabReq.PtoVta).toBe(1)
    const det = req.FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.CbteDesde).toBe(151)
    expect(det.CbteHasta).toBe(151)
    expect(det.ImpTotal).toBe(3500)
    expect(det.ImpNeto).toBe(3500)
    expect(det.ImpIVA).toBe(0)
    expect(det.CondicionIVAReceptorId).toBe(5)
  })

  it("incluye fechas de servicio cuando el concepto es servicios", () => {
    const det: any = buildFeCAEReq(auth, base, 151).FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.FchServDesde).toBe("20260619")
    expect(det.FchServHasta).toBe("20260619")
    expect(det.FchVtoPago).toBe("20260619")
  })

  it("NO incluye fechas de servicio cuando el concepto es productos", () => {
    const det: any = buildFeCAEReq(auth, { ...base, concepto: 1 }, 151).FeCAEReq.FeDetReq.FECAEDetRequest
    expect(det.FchServDesde).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/lib/arca/wsfe-payload.test.ts`
Expected: FAIL ("Cannot find module './wsfe-payload'").

- [ ] **Step 3: Implementar `src/lib/arca/wsfe-payload.ts`**

```ts
export interface Auth {
  Token: string
  Sign: string
  Cuit: string
}

export type DocTipo = 99 | 96 | 80 // 99=Consumidor Final, 96=DNI, 80=CUIT

export interface InvoiceInput {
  ptoVta: number
  concepto: 1 | 2 | 3 // 1=Productos, 2=Servicios, 3=Productos y Servicios
  docTipo: DocTipo
  docNro: string
  condIvaReceptor: number // 5 = Consumidor Final
  totalCents: number
  fecha: Date
  servDesde?: Date
  servHasta?: Date
  vtoPago?: Date
}

export function pesos(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "")
}

export function buildFeCAEReq(auth: Auth, input: InvoiceInput, cbteNro: number) {
  const importe = pesos(input.totalCents)
  const det: Record<string, unknown> = {
    Concepto: input.concepto,
    DocTipo: input.docTipo,
    DocNro: input.docNro,
    CbteDesde: cbteNro,
    CbteHasta: cbteNro,
    CbteFch: ymd(input.fecha),
    ImpTotal: importe,
    ImpTotConc: 0,
    ImpNeto: importe, // Factura C: neto = total, sin IVA discriminado
    ImpOpEx: 0,
    ImpIVA: 0,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: input.condIvaReceptor,
  }
  if (input.concepto === 2 || input.concepto === 3) {
    det.FchServDesde = ymd(input.servDesde ?? input.fecha)
    det.FchServHasta = ymd(input.servHasta ?? input.fecha)
    det.FchVtoPago = ymd(input.vtoPago ?? input.fecha)
  }
  return {
    Auth: auth,
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: input.ptoVta, CbteTipo: 11 },
      FeDetReq: { FECAEDetRequest: det },
    },
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/lib/arca/wsfe-payload.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/arca/wsfe-payload.ts src/lib/arca/wsfe-payload.test.ts
git commit -m "feat: armado del payload FECAESolicitar para Factura C"
```

---

### Task 8: Almacén del token WSAA en Supabase

**Files:**
- Create: `src/lib/arca/token-store.ts`

**Interfaces:**
- Consumes: `ArcaEnv` de `config.ts`.
- Produces:
  - `interface StoredToken { token: string; sign: string; expiresAt: Date }`
  - `function getStoredToken(service: string, env: ArcaEnv): Promise<StoredToken | null>`
  - `function saveToken(service: string, env: ArcaEnv, t: StoredToken): Promise<void>`

- [ ] **Step 1: Implementar `src/lib/arca/token-store.ts`**

```ts
import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { ArcaEnv } from "./config"

export interface StoredToken {
  token: string
  sign: string
  expiresAt: Date
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function getStoredToken(
  service: string,
  env: ArcaEnv
): Promise<StoredToken | null> {
  const { data } = await admin()
    .from("arca_tokens")
    .select("token, sign, expires_at")
    .eq("service", service)
    .eq("environment", env)
    .maybeSingle()
  if (!data) return null
  return { token: data.token, sign: data.sign, expiresAt: new Date(data.expires_at) }
}

export async function saveToken(
  service: string,
  env: ArcaEnv,
  t: StoredToken
): Promise<void> {
  const { error } = await admin()
    .from("arca_tokens")
    .upsert({
      service,
      environment: env,
      token: t.token,
      sign: t.sign,
      expires_at: t.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(`No se pudo guardar el token ARCA: ${error.message}`)
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `token-store.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/arca/token-store.ts
git commit -m "feat: persistencia del token WSAA en Supabase"
```

---

### Task 9: Autenticación WSAA (LoginCms + reutilización)

**Files:**
- Create: `src/lib/arca/auth.ts`

**Interfaces:**
- Consumes: `getArcaConfig`, `buildTra`, `signTra`, `getStoredToken`, `saveToken`.
- Produces:
  - `type Auth` (reexportado de `wsfe-payload`)
  - `function getAuth(service?: string): Promise<Auth>`

- [ ] **Step 1: Implementar `src/lib/arca/auth.ts`**

```ts
import "server-only"
import * as soap from "soap"
import { parseStringPromise } from "xml2js"
import { getArcaConfig } from "./config"
import { buildTra, signTra } from "./wsaa-sign"
import { getStoredToken, saveToken } from "./token-store"
import type { Auth } from "./wsfe-payload"

export type { Auth } from "./wsfe-payload"

// Refresca 10 min antes del vencimiento real.
const SAFETY_MS = 10 * 60 * 1000

export async function getAuth(service = "wsfe"): Promise<Auth> {
  const cfg = getArcaConfig()

  const stored = await getStoredToken(service, cfg.env)
  if (stored && stored.expiresAt.getTime() - SAFETY_MS > Date.now()) {
    return { Token: stored.token, Sign: stored.sign, Cuit: cfg.cuit }
  }

  const tra = buildTra(service)
  const cms = signTra(tra, cfg.cert, cfg.key)

  let xml: string
  try {
    const client = await soap.createClientAsync(cfg.wsaaUrl)
    const [res] = await client.loginCmsAsync({ in0: cms })
    xml = res.loginCmsReturn as string
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("ya posee un TA") || msg.includes("alreadyAuthenticated")) {
      throw new Error(
        "ARCA aún tiene una sesión válida de antes pero no la tenemos guardada. " +
          "Esperá unos minutos y reintentá."
      )
    }
    throw new Error(`Error autenticando con ARCA (WSAA): ${msg}`)
  }

  const parsed = await parseStringPromise(xml, { explicitArray: false })
  const creds = parsed.loginTicketResponse.credentials
  const expiration = parsed.loginTicketResponse.header.expirationTime

  await saveToken(service, cfg.env, {
    token: creds.token,
    sign: creds.sign,
    expiresAt: new Date(expiration),
  })

  return { Token: creds.token, Sign: creds.sign, Cuit: cfg.cuit }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `auth.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/arca/auth.ts
git commit -m "feat: autenticación WSAA con reutilización de token"
```

---

### Task 10: Cliente WSFE (último comprobante + solicitar CAE)

**Files:**
- Create: `src/lib/arca/wsfe.ts`

**Interfaces:**
- Consumes: `getArcaConfig`, `getAuth`, `buildFeCAEReq`, `InvoiceInput`, `Auth`.
- Produces:
  - `interface CaeResult { cae: string; caeVto: string; cbteNro: number }`
  - `function getUltimoComprobante(auth: Auth, ptoVta: number, cbteTipo?: number): Promise<number>`
  - `function solicitarCae(input: InvoiceInput): Promise<CaeResult>`

- [ ] **Step 1: Implementar `src/lib/arca/wsfe.ts`**

```ts
import "server-only"
import * as soap from "soap"
import { getArcaConfig } from "./config"
import { getAuth } from "./auth"
import { buildFeCAEReq, type Auth, type InvoiceInput } from "./wsfe-payload"

export interface CaeResult {
  cae: string
  caeVto: string // yyyymmdd
  cbteNro: number
}

export async function getUltimoComprobante(
  auth: Auth,
  ptoVta: number,
  cbteTipo = 11
): Promise<number> {
  const cfg = getArcaConfig()
  const client = await soap.createClientAsync(cfg.wsfeUrl)
  const [res] = await client.FECompUltimoAutorizadoAsync({
    Auth: auth,
    PtoVta: ptoVta,
    CbteTipo: cbteTipo,
  })
  return Number(res.FECompUltimoAutorizadoResult.CbteNro)
}

export async function solicitarCae(input: InvoiceInput): Promise<CaeResult> {
  const cfg = getArcaConfig()
  const auth = await getAuth("wsfe")
  const ultimo = await getUltimoComprobante(auth, input.ptoVta)
  const cbteNro = ultimo + 1

  const client = await soap.createClientAsync(cfg.wsfeUrl)
  const [res] = await client.FECAESolicitarAsync(buildFeCAEReq(auth, input, cbteNro))
  const result = res.FECAESolicitarResult

  if (result.Errors) {
    const errs = ([] as any[])
      .concat(result.Errors.Err)
      .map((e) => `${e.Code}: ${e.Msg}`)
      .join("; ")
    throw new Error(`ARCA rechazó la factura: ${errs}`)
  }

  const det = result.FeDetResp.FECAEDetResponse
  if (det.Resultado !== "A") {
    const obs = det.Observaciones
      ? ([] as any[])
          .concat(det.Observaciones.Obs)
          .map((o) => `${o.Code}: ${o.Msg}`)
          .join("; ")
      : "rechazada sin detalle"
    throw new Error(`ARCA no aprobó la factura: ${obs}`)
  }

  return { cae: det.CAE, caeVto: det.CAEFchVto, cbteNro }
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `wsfe.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/arca/wsfe.ts
git commit -m "feat: cliente WSFE (último comprobante + solicitar CAE)"
```

---

### Task 11: Servicio de emisión (orquesta y persiste)

**Files:**
- Create: `src/lib/arca/invoice-service.ts`

**Interfaces:**
- Consumes: `getArcaConfig`, `solicitarCae`, `buildQrUrl`, `InvoiceInput`.
- Produces:
  - `interface EmitInput { clientId?: string; appointmentId?: string; concepto: 1|2|3; docTipo: 99|96|80; docNro: string; receptorNombre?: string; condIvaReceptor: number; totalCents: number; servDesde?: Date; servHasta?: Date }`
  - `function emitirFactura(input: EmitInput): Promise<{ id: string; cbte_nro: number; cae: string; qr_url: string }>`

- [ ] **Step 1: Implementar `src/lib/arca/invoice-service.ts`**

```ts
import "server-only"
import { createClient } from "@supabase/supabase-js"
import { getArcaConfig } from "./config"
import { solicitarCae } from "./wsfe"
import { buildQrUrl } from "./qr"
import { pesos, type InvoiceInput, type DocTipo } from "./wsfe-payload"

export interface EmitInput {
  clientId?: string
  appointmentId?: string
  concepto: 1 | 2 | 3
  docTipo: DocTipo
  docNro: string
  receptorNombre?: string
  condIvaReceptor: number
  totalCents: number
  servDesde?: Date
  servHasta?: Date
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// yyyymmdd (de ARCA) -> yyyy-mm-dd (para columna date)
function caeVtoToDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export async function emitirFactura(input: EmitInput) {
  const cfg = getArcaConfig()
  const fecha = new Date()

  const wsInput: InvoiceInput = {
    ptoVta: cfg.ptoVta,
    concepto: input.concepto,
    docTipo: input.docTipo,
    docNro: input.docNro,
    condIvaReceptor: input.condIvaReceptor,
    totalCents: input.totalCents,
    fecha,
    servDesde: input.servDesde,
    servHasta: input.servHasta,
  }

  const cae = await solicitarCae(wsInput)

  const qrUrl = buildQrUrl({
    fecha: fecha.toISOString().slice(0, 10),
    cuit: Number(cfg.cuit),
    ptoVta: cfg.ptoVta,
    tipoCmp: 11,
    nroCmp: cae.cbteNro,
    importe: pesos(input.totalCents),
    moneda: "PES",
    ctz: 1,
    tipoDocRec: input.docTipo,
    nroDocRec: Number(input.docNro),
    codAut: Number(cae.cae),
  })

  const { data, error } = await admin()
    .from("invoices")
    .insert({
      client_id: input.clientId ?? null,
      appointment_id: input.appointmentId ?? null,
      cbte_tipo: 11,
      pto_vta: cfg.ptoVta,
      cbte_nro: cae.cbteNro,
      concepto: input.concepto,
      receptor_doc_tipo: input.docTipo,
      receptor_doc_nro: input.docNro,
      receptor_nombre: input.receptorNombre ?? null,
      receptor_cond_iva: input.condIvaReceptor,
      total_cents: input.totalCents,
      cae: cae.cae,
      cae_vto: caeVtoToDate(cae.caeVto),
      fecha_emision: fecha.toISOString().slice(0, 10),
      estado: "emitida",
      qr_url: qrUrl,
    })
    .select("id, cbte_nro, cae, qr_url")
    .single()

  if (error) throw new Error(`Factura autorizada pero falló al guardar: ${error.message}`)
  return data
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores en `invoice-service.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/arca/invoice-service.ts
git commit -m "feat: servicio de emisión de factura (orquesta CAE + QR + persistencia)"
```

---

### Task 12: Ruta de smoke-test y validación en homologación

Cierra el Plan A: prueba real de punta a punta contra ARCA homologación. Requiere que la usuaria ya tenga el certificado de homologación cargado en `.env.local` (Tasks 2 + 4 + trámite WSASS).

**Files:**
- Create: `src/app/api/admin/arca/smoke/route.ts`

**Interfaces:**
- Consumes: `emitirFactura`, `requireStaff`-equivalente (`isStaffUser`).
- Produces: endpoint GET `/api/admin/arca/smoke` que emite una factura de prueba y devuelve JSON.

- [ ] **Step 1: Leer la convención de route handlers**

Antes de escribir, revisar `node_modules/next/dist/docs/` la guía de Route Handlers (App Router), porque esta versión de Next puede diferir (ver `AGENTS.md`). Confirmar firma de `GET`, `NextResponse`, y cómo se leen cookies/sesión.

- [ ] **Step 2: Implementar la ruta**

```ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isStaffUser } from "@/lib/staff"
import { emitirFactura } from "@/lib/arca/invoice-service"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !(await isStaffUser(user.id))) {
    return NextResponse.json({ ok: false, error: "Acceso denegado" }, { status: 403 })
  }

  try {
    const result = await emitirFactura({
      concepto: 2,
      docTipo: 99, // Consumidor Final
      docNro: "0",
      condIvaReceptor: 5,
      totalCents: 100, // $1 de prueba
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verificar que compila y linta**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 4: Validar contra homologación (manual)**

Pre-requisito: `.env.local` con `ARCA_ENV=homologacion`, `ARCA_CUIT`, `ARCA_PTO_VTA`, y el `ARCA_CERT`/`ARCA_KEY` de homologación reales.

1. `npm run dev`
2. Iniciar sesión como staff en `/login`.
3. Visitar `http://localhost:3000/api/admin/arca/smoke`.

Expected: JSON `{ "ok": true, "id": "...", "cbte_nro": <n>, "cae": "<14 dígitos>", "qr_url": "https://www.afip.gob.ar/fe/qr/?p=..." }`. Verificar en Supabase que la fila quedó en `invoices` con `estado = 'emitida'` y que `arca_tokens` tiene una fila para `homologacion`.

- [ ] **Step 5: Validar reutilización del token (manual)**

Visitar `/api/admin/arca/smoke` una segunda vez.
Expected: `ok: true` de nuevo, con `cbte_nro` incrementado en 1, y SIN una nueva fila/cambio de `token` en `arca_tokens` (se reutilizó el token guardado).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/arca/smoke/route.ts
git commit -m "feat: ruta de smoke-test ARCA para validar homologación"
```

---

## Self-Review (cobertura vs spec)

- **Conexión propia WSAA+WSFE, token persistido** → Tasks 5, 8, 9, 10. ✔
- **Firma JS puro (Vercel)** → Task 5 (`node-forge`). ✔
- **Factura C, neto=total, IVA 0, CondicionIVAReceptorId** → Task 7. ✔
- **QR oficial** → Task 6. ✔
- **Tabla `invoices` + `arca_tokens` con RLS** → Task 3. ✔
- **Precios en centavos → pesos a ARCA** → Task 7 (`pesos`). ✔
- **Homologación primero** → Task 12. ✔
- **Trámite ARCA desbloqueado para la usuaria** → Task 2 (CSR). ✔
- **Receptor por defecto Consumidor Final + DNI/CUIT** → `DocTipo` 99/96/80 en Tasks 7 y 11. ✔

**Cubierto en Plan B (no en este plan):** PDF (`@react-pdf/renderer`), envío por email (Resend), Server Action `emitirFactura` de UI, menú "Facturación", pantalla de historial, formulario de factura manual, botón "Facturar" en el turno.

**Type consistency:** `Auth` se define en `wsfe-payload.ts` y se reexporta desde `auth.ts` (evita ciclo). `InvoiceInput` (capa WSFE) vs `EmitInput` (capa servicio) son distintos a propósito. `pesos`/`ymd` compartidos desde `wsfe-payload.ts`.
