# Factura manual mejorada (selección de ítems) — Diseño

**Fecha:** 2026-06-20
**Estado:** Aprobado
**Autor:** Claude Code + ballerodri

---

## 1. Objetivo

Mejorar la pantalla de **factura manual** (`/admin/facturacion/nueva`):
1. Poder **seleccionar uno o varios servicios y/o packs**; el **concepto** se arma solo con los
   nombres y el **monto** se suma solo (subtotal de lo seleccionado).
2. **Auto-llenado editable:** concepto y monto se completan desde la selección, pero quedan
   **editables** (override manual).
3. Mantener el modo **manual** actual (escribir concepto + monto a mano, sin seleccionar nada).
4. **Mejora visual** del formulario.

---

## 2. Restricción clave: el backend NO cambia

La acción `emitirFacturaManual` (en `src/app/admin/facturacion/actions.ts`) sigue recibiendo
`descripcion` (texto del concepto) y `montoPesos`. La selección de ítems es **solo una ayuda de
UI** que rellena esos dos campos. **Cero cambios** en la emisión, el receptor, el email o ARCA.
Riesgo sobre la facturación ya funcionando: nulo.

---

## 3. Datos para el formulario

`src/app/admin/facturacion/nueva/page.tsx` (server) carga, con el cliente service-role:
- **Servicios activos:** `id, name, price_cents` (de `services` where `active`).
- **Packs activos:** `id, name, total_price_cents` (de `packs` where `active`).

Los pasa al form como una lista de opciones seleccionables:
`type SelectableItem = { kind: "service" | "pack"; id: string; name: string; priceCents: number }`.

---

## 4. Formulario (`manual-form.tsx`)

Secciones, de arriba a abajo:

**Ítems (opcional)**
- Un `<select>` con todos los servicios y packs activos (agrupados con `<optgroup>` "Servicios" /
  "Packs"), cada opción mostrando nombre + precio.
- Botón **"+ Agregar"** que agrega el ítem elegido a una **lista** (estado local). Se permiten
  duplicados (agregar el mismo dos veces = cuenta dos veces).
- La lista muestra cada ítem (nombre + precio + **✕** para quitar) y un **subtotal**.

**Concepto y monto**
- `Concepto`: input de texto. Cuando la lista de ítems cambia, se setea a los nombres unidos por
  ", ". Editable después.
- `Monto (en pesos)`: input numérico. Cuando la lista cambia, se setea al subtotal (en pesos).
  Editable después (override).
- Si la lista está vacía, ambos se comportan como hoy (manual).

**Receptor** (sin cambios): checkbox "Identificar al receptor" → DNI/CUIT + nombre, o Consumidor Final.

**Email** (sin cambios): opcional, para enviar el PDF.

**Total + Emitir:** total destacado arriba del botón **"Emitir factura"** (ya legible/centrado).

### Comportamiento (auto-llenado editable)
- Agregar/quitar un ítem → recalcula y **setea** `concepto` (nombres) y `montoPesos` (subtotal).
- El usuario puede editar concepto/monto; esos valores manuales se mantienen hasta el próximo
  cambio de la lista (que vuelve a setear desde la selección). Predecible y simple.
- Al emitir, se usa lo que esté en los campos `concepto` + `monto` (igual que hoy).

---

## 5. Mejora visual

- Reorganizar en secciones con títulos (`adm-section-title` / `adm-label`), buen espaciado.
- Lista de ítems prolija con subtotal; total destacado antes del botón.
- Mantener la estética del admin (variables de color y tipografías actuales).

---

## 6. Fuera de alcance (YAGNI)

- Cantidades con stepper "×N" (se agrega el ítem dos veces en su lugar).
- Cambios en el receptor, email, backend o ARCA.
- Selección de ítems en la factura **desde el turno** (esa toma los servicios del turno
  automáticamente; no se toca).

---

## 7. Archivos

- Modificar: `src/app/admin/facturacion/nueva/page.tsx` (cargar servicios + packs).
- Modificar: `src/app/admin/facturacion/nueva/manual-form.tsx` (selección de ítems + auto-llenado + visual).
- Sin cambios en `actions.ts` ni en el resto.
