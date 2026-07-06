# Reserva sin ficha médica digital ni consentimientos — Diseño

**Fecha:** 2026-07-06
**Estado:** Aprobado
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo y contexto

La ficha de salud y el consentimiento informado pasan a completarse **en papel** en el
gabinete (PDF imprimible `public/docs/ficha-tecnica-consentimiento.pdf`, descargable desde
Admin → Configuración). La app **deja de pedir** la ficha médica digital y el consentimiento
de depilación al reservar, y el admin **deja de mostrar** la sección "Ficha médica".

La app aún no tiene datos reales, así que la limpieza es completa a nivel UI/flujo.
**Las tablas de la base NO se tocan** (`client_records`, `medical_intake_depilation`):
quedan sin uso, el reset de fábrica las sigue vaciando, y son reversibles si algún día se
quiere volver a lo digital.

## 2. Flujo de reserva resultante

- Clienta nueva: **Datos personales → Tratamiento → Fecha → Confirmación**
- Clienta conocida: **Tratamiento → Fecha → Confirmación**

Se elimina la pantalla **"Ficha inicial"** (`Screen4Medical`: alergias, medicación,
embarazo, piel, casillero "datos verídicos") y el **consentimiento de depilación**
(`DepilationConsent`, aparecía cuando el servicio contenía "depilación").

## 3. Cambios por archivo

### Reserva (`src/app/reserva/`)
- `screens.tsx`: eliminar `Screen4Medical` completo y el uso/import de `DepilationConsent`,
  `saveMedicalEarly`, `saveDepilationConsent`.
- `depilation-consent.tsx`: **eliminar el archivo**.
- `flow.tsx`: `buildScreenOrder` sin `"medical"` (queda `["services","date","confirm"]` o
  `["details","services","date","confirm"]`); quitar el case `"medical"` del render y el uso
  de `hasMedicalRecord`; **subir `FLOW_VERSION` a 3** (cambia el orden de pantallas).
- `data.ts`: quitar `MedicalForm`, `BookingState.medical`, `BookingState.medicalNote`,
  `BookingState.depilationConsent`, el `ScreenId` `"medical"` y su `SCREEN_LABEL`.
- `queries.ts`: `fetchCurrentClient` sin `hasMedicalRecord` (se elimina la consulta a
  `client_records` y el campo del tipo `CurrentClient`).
- `actions.ts`: `BookingInput` sin `medical` ni `medicalNote`; eliminar el paso
  "3) Insert medical record" de `createBooking` y la parte de `notes_internal` que usaba
  `medicalNote`; eliminar `saveMedicalEarly` y `saveDepilationConsent`.

### Admin
- `clientas/[id]/page.tsx`: quitar la carga de `client_records`, el tipo de la fila, las
  alertas derivadas de la ficha y la sección `<RecordEditor>`.
- `clientas/[id]/record-editor.tsx`: **eliminar el archivo**.
- `actions.ts`: eliminar `RecordPatch` y `updateClientRecord`.
- **Conservar**: el reset de fábrica (sigue vaciando `client_records`, la tabla existe) y
  todo lo demás de la ficha de la clienta (datos, packs, fotos, turnos).

### Sin cambios
- Base de datos (sin migración). Páginas legales (siguen siendo ciertas: el consentimiento
  se firma en papel). Portal (no usaba la ficha). PDF imprimible (el reemplazo).

## 4. Riesgos / notas

- Navegadores con una reserva a medio hacer: el bump de `FLOW_VERSION` descarta el estado
  viejo de `localStorage` (patrón existente).
- Clientas con JS viejo cacheado podrían mandar `medical` en el payload: Zod (no-strict)
  ignora las claves desconocidas — inofensivo.
- Operativo: las alergias de una clienta nueva ya no se conocen antes del turno; el papel
  se completa **antes** del tratamiento en la primera visita.

## 5. Verificación

`vitest` (sin regresiones), `tsc --noEmit` 0, `eslint` sin errores nuevos, `next build` OK,
y revisión final de rama. Smoke manual: reservar como clienta nueva (sin pantalla de ficha)
y como conocida; admin → clienta sin sección "Ficha médica"; reset de fábrica intacto.
