# Facturación electrónica ARCA (Factura C) — Diseño

**Fecha:** 2026-06-19
**Estado:** Aprobado (pendiente revisión final del usuario)
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

Agregar un módulo de **Facturación** al panel de admin que emite **Factura C** (régimen
Monotributo) contra los Web Services de ARCA (ex AFIP), obteniendo el **CAE** en tiempo real,
generando el **PDF oficial** (con CAE + QR) y enviándolo por **email** a la clienta.

Fuera de alcance en esta versión (YAGNI):
- Factura A / B, notas de crédito y débito.
- Cobros / pasarelas de pago (Mercado Pago, etc.). Esto **factura**, no **cobra**.
- Cambios en el flujo público de reservas.

---

## 2. Contexto del proyecto

- Next.js 16 + React 19, Supabase (Postgres + RLS), desplegado en Vercel.
- Panel admin en `src/app/admin/` con menú lateral en `src/app/admin/layout.tsx`.
- Tablas existentes relevantes: `clients` (incluye `dni`), `appointments`
  (`total_cents`, `deposit_cents`, `status`), `services`, `appointment_services`.
- Precios siempre en **centavos** (int).
- Emails ya integrados con **Resend** (`resend` en dependencias).
- Patrón de acceso: Server Actions con `SUPABASE_SERVICE_ROLE_KEY` bypassean RLS;
  acceso de staff vía `is_staff()`.

---

## 3. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Condición fiscal | **Monotributista → Factura C** | Confirmado por la usuaria. No discrimina IVA. |
| Trigger de facturación | **Desde turno completado + factura manual suelta** | Cubre el día a día y casos sueltos (productos, señas). |
| Salida | **PDF oficial + envío automático por email** | Reusa Resend. Comprobante listo para la clienta. |
| Conexión con ARCA | **Capa propia liviana: WSAA + WSFE con `soap` + `node-forge`, token persistido en Supabase** | Datos van directo a ARCA, sin terceros ni costo mensual. La firma se hace en **JavaScript puro** con `node-forge` (no requiere binario OpenSSL) → funciona en Vercel serverless. **Por qué no una librería AFIP de alto nivel:** las disponibles (`arca-facturacion`, etc.) no permiten **guardar y reutilizar** el token de WSAA; en Vercel serverless el servidor se reinicia y volvería a pedir token dentro de las 12 h, lo cual ARCA **rechaza** (fault "ya posee un TA válido"), haciendo fallar facturas. Manejando WSAA nosotros y persistiendo el token, el problema desaparece. |
| Estado del trámite ARCA | **CUIT sí, certificado no** | Hay trámite previo (Sección 8). Empezamos por homologación. |

---

## 4. Arquitectura

Capas chicas y aisladas, cada una con una sola responsabilidad:

- **`src/lib/arca/config.ts`** — lee variables de entorno, elige URLs de homologación o
  producción, y entrega el certificado/clave en memoria.
- **`src/lib/arca/wsaa-sign.ts`** — arma el TRA (login ticket) y lo firma como CMS/PKCS#7
  con `node-forge` (JavaScript puro). Sin red, sin base de datos. Testeable.
- **`src/lib/arca/token-store.ts`** — persiste y reutiliza el token de WSAA (vale 12 h)
  en la tabla `arca_tokens` de Supabase. *Por qué:* en Vercel cada request puede correr en un
  servidor distinto y ARCA bloquea pedir un token nuevo teniendo uno válido. Hay que
  persistirlo, no alcanza con cache en memoria.
- **`src/lib/arca/auth.ts`** — obtiene el token: si hay uno válido en Supabase lo reutiliza;
  si no, firma el TRA y llama a WSAA `LoginCms` (vía `soap`), guarda el nuevo token.
- **`src/lib/arca/wsfe-payload.ts`** — arma el pedido `FeCAEReq` (importes en pesos,
  concepto, `CondicionIVAReceptorId`, fechas). Sin red. Testeable.
- **`src/lib/arca/wsfe.ts`** — llama a `FECompUltimoAutorizado` y `FECAESolicitar` (vía `soap`)
  y mapea la respuesta (CAE, vencimiento, número).
- **`src/lib/arca/qr.ts`** — construye la URL del QR oficial de ARCA. Sin red. Testeable.
- **`src/lib/arca/invoice-service.ts`** — orquesta: auth → WSFE → guarda fila en `invoices`.
- **`src/lib/arca/pdf.tsx`** — arma el PDF de la Factura C (`@react-pdf/renderer`) y el QR
  como imagen (`qrcode`). Recibe datos puros, devuelve un PDF.
- **`src/app/admin/facturacion/`** — pantallas: historial/listado + form de factura manual.
- **`src/app/admin/facturacion/actions.ts`** — Server Actions que orquestan:
  validar → pedir CAE → guardar en DB → generar PDF → enviar email.
- **Botón "Facturar"** en el detalle del turno → reusa el mismo Server Action.
- Nuevo ítem **"Facturación"** en el menú lateral del admin (solo roles no-`professional`).

### Flujo de emisión

```
Turno completado / Form manual
        ↓
Server Action "emitirFactura"
        ↓
invoice-service → auth (token persistido) → WSFE pide CAE   →   guarda invoice en Supabase
        ↓
arca/pdf → genera PDF + QR
        ↓
Resend → email a la clienta + link de descarga en el admin
```

---

## 5. Modelo de datos

### Tabla `invoices`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid null → `clients` | Null si Consumidor Final anónimo |
| `appointment_id` | uuid null → `appointments` | Null si factura manual suelta |
| `cbte_tipo` | int | 11 = Factura C |
| `pto_vta` | int | Punto de venta web services |
| `cbte_nro` | bigint | Número de comprobante (lo asigna ARCA) |
| `receptor_doc_tipo` | int | 99 = Consumidor Final, 96 = DNI, 80 = CUIT |
| `receptor_doc_nro` | text | |
| `receptor_nombre` | text | |
| `total_cents` | int | Importe total en centavos |
| `cae` | text | Código de Autorización Electrónico |
| `cae_vto` | date | Vencimiento del CAE |
| `fecha_emision` | date | |
| `estado` | text | `emitida` / `error` |
| `error_msg` | text null | Mensaje de ARCA si falló |
| `pdf_url` | text null | Comprobante generado |
| `qr_url` | text | URL del QR oficial de ARCA |
| `created_at` / `updated_at` | timestamptz | |

RLS: solo staff (mismo patrón que el resto). Índices por `client_id`, `appointment_id`,
y único por (`pto_vta`, `cbte_tipo`, `cbte_nro`).

### Tabla `arca_tokens`

Guarda el token + sign de WSAA por entorno (`homologacion` / `produccion`) con su expiración,
para reusarlo 12 h y no ser bloqueado por ARCA.

### Receptor por defecto

Por defecto **Consumidor Final** (DocTipo 99, DocNro 0). Si el monto supera el umbral que
ARCA exige identificar al comprador, o si la clienta tiene DNI cargado, se incluye su
DNI/CUIT automáticamente. En la factura manual se puede elegir el tipo de receptor.

---

## 6. Manejo de errores

- Si ARCA **rechaza** (datos inválidos, certificado vencido, servidor caído, monto que exige
  identificar): se registra como `error`, se muestra el mensaje claro y **no se envía email**.
- El número de comprobante lo determina ARCA (se consulta el último autorizado y se incrementa),
  para no saltar ni duplicar números.
- Todo el flujo se prueba en **homologación** antes de tocar producción.

---

## 7. Seguridad de credenciales

- El certificado (`.crt`) y la clave privada (`.key`) se guardan como **variables de entorno
  en Vercel** (encriptadas, nunca en git ni en el código).
- Variable `ARCA_ENV` (`homologacion` | `produccion`) selecciona entorno y URLs.
- Variables de entorno previstas:
  `ARCA_ENV`, `ARCA_CUIT`, `ARCA_PTO_VTA`, `ARCA_CERT`, `ARCA_KEY`,
  y datos del emisor para el PDF (`ARCA_RAZON_SOCIAL`, `ARCA_DOMICILIO`,
  `ARCA_INICIO_ACTIVIDADES`, `ARCA_IIBB`).

---

## 8. Trámites en ARCA (los hace la usuaria / su contador)

La generación de la **clave privada** y el **CSR** (que normalmente requiere OpenSSL) la
provee el equipo de desarrollo mediante un script del proyecto (`node-forge` / `node:crypto`),
para que la usuaria no instale herramientas extra. La usuaria sube el `.csr` a ARCA y descarga
el `.crt`.

### Etapa 1 — Homologación (pruebas)

1. Ingresar a ARCA con **Clave Fiscal** (persona física).
2. Buscador → **"WSASS - Autogestión Certificados Homologación"** (adherir si no está).
3. **"Nuevo certificado"** → Alias `homologacion` → pegar el `.csr` provisto →
   **"Crear DN y obtener certificado"** → descargar `.crt`.
4. **"Crear autorización a servicio"** → elegir el certificado → CUIT propio → web service
   **`wsfe`** → crear. Verificar en "Autorizaciones".
5. Entregar el `.crt` al equipo para probar emisión de prueba.

### Etapa 2 — Producción (facturas reales)

1. **Clave Fiscal nivel 3** (subir nivel si hace falta).
2. Servicio **"Administración de Certificados Digitales"** → crear alias → pegar `.csr` de
   producción → descargar `.crt` de producción.
3. Servicio **"Administrador de Relaciones de Clave Fiscal"** → nueva relación →
   servicio **"Facturación Electrónica" (wsfe)** asociado a ese certificado.
4. Servicio **"Administración de puntos de venta y domicilios"** → **Alta de punto de venta**
   tipo **"Factura Electrónica - Web Services"**. Anotar el número. Debe ser distinto del de
   "Comprobantes en línea".
5. Entregar: `.crt` de producción, número de punto de venta, y datos del emisor
   (razón social/nombre, CUIT, domicilio comercial, fecha de inicio de actividades,
   Ingresos Brutos o "Exento").

---

## 9. Puesta en marcha en 2 fases

- **Fase 1 (desarrollo):** flujo completo contra **homologación**. Probar emisión punta a punta
  con certificado de prueba.
- **Fase 2 (producción):** con el certificado real y el punto de venta, se cambia `ARCA_ENV`
  y queda facturando de verdad.

---

## 10. Dependencias nuevas

- `soap` — cliente SOAP para WSAA (`LoginCms`) y WSFE (`FECAESolicitar`,
  `FECompUltimoAutorizado`). Battle-tested en el ecosistema AFIP de Node.
- `node-forge` — firma CMS/PKCS#7 del TRA y generación de clave privada + CSR (script de setup).
  JavaScript puro → no requiere binario OpenSSL → funciona en Vercel.
- `xml2js` — parseo de respuestas XML de WSAA.
- `@react-pdf/renderer` — generación del PDF (compatible con Vercel serverless).
- `qrcode` — render del QR a imagen para el PDF.
- `vitest` — runner de tests (el proyecto no tenía tests; se agrega para TDD de la lógica pura:
  firma, armado de payload, importes, QR).

---

## 11. Referencias

- WSFE (Factura Electrónica): https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp
- WSAA (autenticación): https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- Manual WSASS: https://www.afip.gob.ar/ws/WSASS/WSASS_manual.pdf
- Librería: https://github.com/ramiidv/arca-facturacion

---

## 12. Estado y Plan B (agregado 2026-06-19)

### Plan A — VALIDADO en homologación
El núcleo (Plan A) está implementado, revisado y mergeado a `main`, y **validado de punta a
punta en homologación**: se emitió una Factura C de prueba con CAE real. Se corrigió un bug
real (el cliente `soap` devuelve `FeDetResp.FECAEDetResponse` como **array**; el acceso directo
leía una aprobación como rechazo). La decisión final de conexión (capa propia `soap` +
`node-forge` + token persistido) quedó firme.

### Plan B — diseño aprobado

**Objetivo:** hacer usable el motor — PDF + email + pantallas en el admin. Sigue todo sobre
**homologación** hasta pasar a producción.

**PDF (al vuelo):** se genera con `@react-pdf/renderer` en el momento (al descargar o enviar),
a partir de los datos guardados de la factura. **No** se almacenan archivos; se regenera idéntico
cuando haga falta. Contiene emisor (de las `ARCA_*`), receptor, concepto, total, CAE + vto, y el
QR oficial (render con `qrcode`). Descarga: `/api/admin/facturacion/[id]/pdf` (solo staff).

**Email:** nueva función en `src/lib/email/invoice-emails.ts` (mismo estilo que `booking-emails.ts`),
manda el PDF **adjunto** con Resend. Se envía al emitir (si la clienta tiene email) y se puede
**reenviar** desde el historial.

**Dato nuevo — `environment`:** se agrega columna `environment` (`homologacion`/`produccion`) a
`invoices`, se estampa al emitir, y el historial muestra una etiqueta "PRUEBA". Separa las
facturas de prueba de las reales.

**Pantallas (menú "Facturación", roles no-`professional`):**
- **Historial:** lista (fecha, número, receptor, total, estado, entorno) con acciones
  **Descargar PDF** y **Reenviar email**.
- **Factura manual:** receptor (Consumidor Final por defecto, o **identificar con DNI/CUIT +
  nombre**), **una línea** (concepto/descripción) y **monto**. Emitir.
- **Botón "Facturar" en turno completado** → **pantalla de confirmación** (clienta, servicios,
  total, receptor — toma el DNI de la clienta si lo tiene, sino Consumidor Final) → Emitir.
  Si el turno ya tiene factura, avisa.

**Errores:** si ARCA rechaza, se muestra el motivo en pantalla y **no** se manda email. En v1
las facturas con error **no** se persisten (se reintenta). *(Revisa la sección 6, que preveía
persistir `estado='error'`; para v1 se simplifica a no persistir.)*

**Fuera de alcance (YAGNI):** notas de crédito/débito, varios ítems por factura, almacenamiento
de PDFs, Factura A/B.

**Dependencias nuevas Plan B:** `@react-pdf/renderer`, `qrcode` (ya previstas en la sección 10).

**Archivos:** `src/lib/arca/pdf.tsx`, `src/lib/email/invoice-emails.ts`,
`src/app/admin/facturacion/` (historial + manual + confirmación de turno + actions),
`src/app/api/admin/facturacion/[id]/pdf/route.ts`, ítem "Facturación" en
`src/app/admin/layout.tsx`, y botón "Facturar" en las acciones del turno
(`src/app/admin/_components/status-actions.tsx`).
