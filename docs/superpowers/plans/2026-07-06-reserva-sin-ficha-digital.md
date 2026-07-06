# Reserva sin ficha digital (limpieza) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar del flujo de reserva la ficha médica digital y el consentimiento de depilación, y quitar la sección "Ficha médica" del admin — todo pasa al papel (PDF imprimible ya publicado).

**Architecture:** Pura eliminación de código de UI/flujo. No hay migración: las tablas `client_records` y `medical_intake_depilation` quedan en la base sin uso (el reset de fábrica las sigue vaciando). `FLOW_VERSION` sube a 3 para descartar estados viejos de localStorage.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, TypeScript, Zod.

## Global Constraints

- **No tocar la base de datos** (sin migraciones). El reset de fábrica (`admin/actions.ts` ~línea 1143, `client_records.delete()`) se CONSERVA tal cual.
- Spec: `docs/superpowers/specs/2026-07-06-reserva-sin-ficha-digital-design.md` (§3 lista los archivos exacto).
- El flujo resultante: nueva = `["details","services","date","confirm"]`; conocida = `["services","date","confirm"]`.
- `FLOW_VERSION` en `flow.tsx` pasa de 2 a **3**.
- Guía de trabajo para las eliminaciones: borrar el símbolo y dejar que `tsc` señale cada uso restante; terminar sólo cuando `tsc` dé 0 en los archivos del task (los del otro task pueden fallar hasta que se complete).

---

### Task 1: Reserva — quitar ficha médica y consentimiento del flujo

**Files:**
- Delete: `src/app/reserva/depilation-consent.tsx`
- Modify: `src/app/reserva/data.ts`, `src/app/reserva/flow.tsx`, `src/app/reserva/screens.tsx`, `src/app/reserva/queries.ts`, `src/app/reserva/actions.ts`

**Interfaces:**
- Produces: `BookingState` sin `medical`/`medicalNote`/`depilationConsent`; `ScreenId` sin `"medical"`; `CurrentClient` sin `hasMedicalRecord`; `BookingInput` sin `medical`/`medicalNote`; ya no existen `saveMedicalEarly`, `saveDepilationConsent`, `Screen4Medical`, `MedicalForm`.

- [ ] **Step 1: `data.ts`** — eliminar el tipo `MedicalForm`; en `BookingState` eliminar los campos `medical`, `medicalNote` y `depilationConsent`; en `ScreenId` eliminar `"medical"`; en `SCREEN_LABEL` eliminar la entrada `medical: "Ficha inicial"`.

- [ ] **Step 2: `queries.ts`** — en `CurrentClient` eliminar `hasMedicalRecord`; en `fetchCurrentClient` eliminar la consulta a `client_records` y el campo en el objeto devuelto.

- [ ] **Step 3: `flow.tsx`** — `FLOW_VERSION = 3`. `buildScreenOrder` queda:

```ts
function buildScreenOrder(currentClient: CurrentClient | null): ScreenId[] {
  const hasFullData =
    !!currentClient &&
    !!currentClient.firstName &&
    !!currentClient.phone &&
    !!currentClient.dateOfBirth

  if (hasFullData) return ["services", "date", "confirm"]
  return ["details", "services", "date", "confirm"]
}
```

Eliminar el `case "medical"` del `renderScreen()` y el import de `Screen4Medical`.

- [ ] **Step 4: `screens.tsx`** — eliminar el componente `Screen4Medical` COMPLETO (y su export), el import y uso de `DepilationConsent`, y los imports de `saveMedicalEarly` y `saveDepilationConsent`. Revisar que `Screen5Confirm` no mande `medical`/`medicalNote` en el payload de `createBooking` (si los manda, quitarlos). `Screen3Details` (datos personales + `saveClientEarly`) se conserva tal cual.

- [ ] **Step 5: `actions.ts`** — en `BookingInput` eliminar los campos `medical` y `medicalNote`; en `createBooking` eliminar el bloque "3) Insert medical record" completo y, en `notes_internal`, dejar solo la parte de `redeem` (sin `medicalNote`); eliminar las funciones `saveMedicalEarly` y `saveDepilationConsent` completas.

- [ ] **Step 6: borrar `depilation-consent.tsx`** (`git rm src/app/reserva/depilation-consent.tsx`).

- [ ] **Step 7: Verificar** — `npx tsc --noEmit`: 0 errores (todo el proyecto — el admin no depende de estos símbolos). `npx eslint src/app/reserva` — sin errores nuevos (baseline pre-existente: hooks en screens.tsx/flow.tsx; el de depilation-consent.tsx desaparece con el archivo). `npx vitest run` — 24/24. `npx next build` — OK.

- [ ] **Step 8: Commit** — `refactor(reserva): quitar ficha médica digital y consentimiento de depilación (pasan al papel)`

---

### Task 2: Admin — quitar la sección "Ficha médica"

**Files:**
- Delete: `src/app/admin/clientas/[id]/record-editor.tsx`
- Modify: `src/app/admin/clientas/[id]/page.tsx`, `src/app/admin/actions.ts`

**Interfaces:**
- Consumes: nada de Task 1 (lados independientes).
- Produces: ya no existen `RecordEditor`, `updateClientRecord`, `RecordPatch`.

- [ ] **Step 1: `clientas/[id]/page.tsx`** — eliminar el import y render de `RecordEditor`, el tipo de la fila de `client_records`, la consulta a `client_records`, y cualquier lógica de alertas derivada de la ficha (`alert_flags`, embarazo, etc.). El resto de la página (datos, packs, fotos, turnos) queda igual.

- [ ] **Step 2: `admin/actions.ts`** — eliminar `RecordPatch` y `updateClientRecord`. **NO tocar** el reset de fábrica (~línea 1143) ni nada más.

- [ ] **Step 3: borrar `record-editor.tsx`** (`git rm`).

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` 0; `npx eslint src/app/admin` sin errores nuevos (los 2 pre-existentes de record-editor.tsx desaparecen con el archivo); `npx next build` OK.

- [ ] **Step 5: Commit** — `refactor(admin): quitar sección Ficha médica (pasa al papel)`

---

### Task 3: Verificación end-to-end

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build` — todo verde / sin errores nuevos.
- [ ] **Step 2 (smoke manual, usuaria):** reservar como clienta nueva (Datos → Tratamiento → Fecha → Confirmación, sin ficha); reservar servicio de depilación (sin consentimiento); admin → clienta sin sección "Ficha médica"; Configuración → reset de fábrica sigue visible.

## Referencias

- Spec: `docs/superpowers/specs/2026-07-06-reserva-sin-ficha-digital-design.md`
