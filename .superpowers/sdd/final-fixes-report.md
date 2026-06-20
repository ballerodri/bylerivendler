# Final Fixes Report — ARCA Invoicing Branch Review

Date: 2026-06-19

## FIX 1 — Timezone: use Argentina local date, not UTC

**Files changed:**
- `src/lib/arca/wsfe-payload.ts` (lines 26-38 in final file)
- `src/lib/arca/invoice-service.ts` (import line + lines 53, 82)
- `src/lib/arca/wsfe-payload.test.ts` (added 2 new timezone tests)

**What changed:**
- Added `AR_FORMATTER` constant using `Intl.DateTimeFormat` with `America/Argentina/Buenos_Aires` timezone.
- Added exported `isoDateAr(d: Date): string` returning `yyyy-mm-dd` in ART.
- Changed `ymd(d: Date)` to use `isoDateAr` and strip dashes, replacing the broken `toISOString().slice(0,10)` (UTC).
- In `invoice-service.ts`: imported `isoDateAr`, replaced both `fecha.toISOString().slice(0, 10)` usages (QR `fecha` field and `fecha_emision` DB column) with `isoDateAr(fecha)`.

**Why:** `toISOString()` returns UTC. Argentina is UTC-3, so invoices emitted after 21:00 ART would get tomorrow's date in the `CbteFch` field, causing potential ARCA rejection.

**Tests added:**
- `ymd(new Date("2026-06-20T01:30:00Z"))` === `"20260619"` (01:30 UTC = 22:30 ART previous day)
- `isoDateAr(new Date("2026-06-20T01:30:00Z"))` === `"2026-06-19"`

---

## FIX 2 — token-store: don't swallow Supabase read errors

**File:** `src/lib/arca/token-store.ts` (line 23)

**What changed:** Destructured `{ data, error }` instead of just `{ data }`. Added `if (error) throw new Error(...)` before the `!data` check.

**Why:** A database/network error would silently return `null`, causing a misleading downstream failure (auth would try to fetch a new token on every call, or throw a confusing error elsewhere).

---

## FIX 3 — wsfe: build the SOAP client once per invoice

**File:** `src/lib/arca/wsfe.ts` (lines 13-35)

**What changed:**
- `getUltimoComprobante` gained an optional 4th param `client?: soap.Client`. If provided, uses it directly; otherwise creates one.
- `solicitarCae` creates the client once (`await soap.createClientAsync(cfg.wsfeUrl)`) and passes it to `getUltimoComprobante`, then reuses it for `FECAESolicitarAsync`.
- `getUltimoComprobante` remains callable standalone (backward-compatible).

**Why:** Each `soap.createClientAsync` fetches and parses the WSDL — two network round-trips per invoice was wasteful and added latency. One client reused across both calls is correct.

---

## FIX 4 — remove `no-explicit-any` lint errors

**Files changed:**
- `src/lib/arca/wsfe.ts` (error/obs normalization block)
- `src/lib/arca/wsfe-payload.test.ts` (3 `: any` casts)

**What changed in wsfe.ts:** Replaced `([] as any[]).concat(x)` with `Array.isArray(raw) ? raw : [raw]` typed as `ArcaItem[]` where `type ArcaItem = { Code: string | number; Msg: string }`. Applied to both `Errors.Err` and `Observaciones.Obs` paths.

**What changed in wsfe-payload.test.ts:** Replaced 3 `: any` casts with:
1. `ReturnType<typeof buildFeCAEReq>` for the full request
2. `ReturnType<typeof buildFeCAEReq>["FeCAEReq"]["FeDetReq"]["FECAEDetRequest"]` for the `det` variable (in 2 tests)

**Why:** Eliminates type-unsafe escape hatches; actual shapes are statically known from `buildFeCAEReq`'s return type.

---

## FIX 5 — strengthen CMS test + use Date for signingTime

**Files changed:**
- `src/lib/arca/wsaa-sign.ts` (line 31)
- `src/lib/arca/wsaa-sign.test.ts` (assertion block)

**What changed in wsaa-sign.ts:** Changed `signingTime` `value` from `new Date().toISOString()` (string) to `new Date() as unknown as string`. The cast is required because `@types/node-forge` types `value` as `string | undefined`, but node-forge accepts and correctly encodes a `Date` at runtime for this attribute.

**What changed in test:** After decoding the CMS, added:
```ts
const topChildren = asn1.value as forge.asn1.Asn1[]
const oidBytes = topChildren[0].value as string
const contentTypeOid = forge.asn1.derToOid(oidBytes)
expect(contentTypeOid).toBe("1.2.840.113549.1.7.2")
```
This asserts the top-level ContentType OID is `signedData`, confirming the envelope structure is correct PKCS#7.

**Why:** Verifying the OID catches structural issues (e.g., a raw cms vs. signed-data envelope) that the previous `asn1.toBeTruthy()` would not catch.

---

## FIX 6 — migration filename convention

**What changed:** `git mv supabase/migrations/20260619_invoices.sql supabase/migrations/20260619000000_invoices.sql`

**Why:** All other migrations use 14-digit timestamps (`yyyymmddHHMMSS`). The invoice migration used only 8 digits, breaking the sort order convention.

---

## Verification Results

### 1. `npx vitest run`
```
 Test Files  3 passed (3)
      Tests  10 passed (10)
   Start at  22:27:10
   Duration  318ms
```

### 2. `npx tsc --noEmit`
```
(no output — 0 errors project-wide)
```

### 3. `npx eslint src/lib/arca src/app/api/admin/arca`
```
(no output — 0 errors in our files)
```
