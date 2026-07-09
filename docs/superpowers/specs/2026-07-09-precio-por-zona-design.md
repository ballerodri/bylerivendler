# Precio propio por zona (opcional) — Diseño

**Fecha:** 2026-07-09
**Estado:** Aprobado
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

En los servicios "por zona" (Fase 1, en producción), permitir que **cada zona tenga su propio
precio**, manteniendo el **precio general por zona** como valor por defecto:

- Zona **sin precio propio** (campo vacío) → cobra el precio general del servicio
  (`services.price_cents`), comportamiento actual.
- Zona **con precio propio** → cobra ese valor. Se puede mezclar en un mismo servicio.

Precio total del servicio en un turno = **suma del precio efectivo de cada zona elegida**.
La duración no cambia (suma de minutos). Los packs no cambian (precio de bundle propio).

## 2. Modelo de datos

### `service_zones` (cambio)
| Campo | Tipo | Notas |
|---|---|---|
| `price_cents` | int null check (null o >= 0) | Precio propio de la zona en centavos. Null = usa el general del servicio. |

Migración `supabase/migrations/20260709000000_precio_por_zona.sql` (aditiva, idempotente).
Los servicios existentes no cambian de comportamiento (todas sus zonas quedan en null).

### Snapshot en `appointment_services.zones` (cambio de forma, aditivo)
`[{ name, duration_min, price_cents }]` — se agrega **cuánto se cobró cada zona** (el efectivo:
propio o general). Las filas viejas sin `price_cents` siguen siendo válidas (nadie las lee
campo a campo hoy).

## 3. Helper puro (`src/lib/servicios/zones.ts`)

- `Zone` gana `priceCents: number | null` (precio propio en centavos, null = usa fallback).
- `ZoneSnapshot` gana `price_cents: number` (lo efectivamente cobrado).
- `computeZonePricing(selectedZones, fallbackPriceCents)`:
  - `priceCents = Σ (zona.priceCents ?? fallbackPriceCents)`
  - `durationMin` igual que hoy; `zones` snapshot incluye el precio efectivo por zona.
- `resolveSelectedZones` sin cambios (opera sobre `Zone[]`).
- Tests actualizados: fallback puro (comportamiento actual), override total, mixto, snapshot
  con precio.

## 4. Admin — alta/edición de servicio

- `ZonesEditor` (en `new-service-form.tsx` y `service-editor.tsx`): cada fila pasa a
  **nombre + minutos + precio (opcional, en pesos)** con placeholder tipo "= general".
  Vacío ⇄ null.
- El campo general se rotula **"Precio por zona (general, en pesos)"**.
- `ZoneInput` (zod, `admin/actions.ts`) gana `price_cents: z.number().int().nonnegative().nullable()`;
  `syncServiceZones` lo persiste. `createService`/`updateService` sin otros cambios.
- `servicios/[id]/page.tsx` carga `price_cents` en `initialZones`.

## 5. Reserva y "Nueva reserva" del admin

- **Catálogo** (`reserva/queries.ts` + `data.ts`): `ServiceZone` gana `price: number | null`
  (en **pesos**, convención del catálogo del cliente). `nueva-reserva/page.tsx`: las zonas de
  `ServiceOption` ganan `priceCents: number | null` (en **centavos**, convención del admin).
- **UI**: junto a cada zona se muestra su precio efectivo (propio o general) además de los
  minutos: `Abdomen · 30 min · $25.000`. El `effective()` de ambos forms suma
  `(precio propio ?? general)` por zona elegida (en la unidad de cada archivo).
- **Servidor (autoritativo)**: `createBooking` (turno normal y rama pack) y
  `createAdminBooking` seleccionan `price_cents` de `service_zones`, arman `Zone` con
  `priceCents` y llaman `computeZonePricing(selected, service.price_cents)`. En la rama de
  pack el precio total sigue siendo el del pack (las zonas solo definen duración); el snapshot
  de zonas del pack lleva los precios efectivos solo a título informativo.

## 6. Packs

- Sin cambios funcionales: `total_price_cents` del pack manda.
- `packReferenceCents` (ahorro estimado en el alta del pack) sigue usando el precio general —
  es orientativo; se documenta esa limitación en el propio form si hace falta (tooltip no
  requerido).

## 7. Fuera de alcance

- Precio por zona en combos (los servicios per_zone siguen excluidos de combos).
- Recalcular el "ahorro" de packs con precios mixtos por zona.
- Migrar datos existentes (no hay: las zonas actuales quedan con null = general).

## 8. Verificación

Vitest (tests del helper actualizados + suite), `tsc` 0, eslint sin errores nuevos,
`next build` OK, revisión final de rama. Smoke manual: servicio con precios mixtos
(una zona con propio, otra sin) → reserva online y admin muestran y cobran la suma correcta;
servicio existente sin precios propios → igual que hoy.
