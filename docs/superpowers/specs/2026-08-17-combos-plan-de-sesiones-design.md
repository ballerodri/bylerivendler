# Combos como PLAN DE SESIONES — Diseño

**Fecha:** 2026-08-17
**Estado:** aprobado por el usuario en chat (diseño por secciones)

## Problema

El rediseño anterior (2026-08-16) dejó el combo como "cada tratamiento con su
cantidad de sesiones" y cada sesión agendada = UN tratamiento. Pero en la
realidad del salón **una sesión es una VISITA con varios tratamientos, en un
orden**, y el combo típico son ~4 sesiones (no 14). La usuaria quiere armar el
combo **sesión por sesión**.

## Decisiones (del usuario, 2026-08-17)

1. **El plan es FIJO al armar el combo**: Sesión 1 = [Ultra, Vela Slim],
   Sesión 2 = [Ultra, Vela Up], … Todas las clientas siguen el mismo plan.
   El orden dentro de la sesión = el orden en que se hacen ese día.
2. **Online la clienta solo elige CUÁNDO** empieza (fecha/hora de la 1ª
   sesión). Decisión de diseño aceptada: el turno portador bloquea la
   **duración COMPLETA de la Sesión 1** (Σ de sus tratamientos) para no
   sobrevender la agenda; el salón completa/ajusta el detalle desde la ficha.
3. **Catálogo: "Ambos"** — "N sesiones" como dato principal + el detalle
   derivado por tratamiento ("Ultra ×4, Vela Slim ×2…"). Precio/ahorro igual
   que hoy (Σ precio × veces totales, con zonas congeladas).

## Modelo de datos (aditivo + soltar un unique)

- `combo_services` gana **`session_no int`** (número de sesión del plan,
  1..K). **Una fila por APARICIÓN** (tratamiento × sesión); `order_index` =
  orden DENTRO de la sesión. Se **suelta** `unique(combo_id, service_id)`
  (el mismo tratamiento puede ir en varias sesiones). La columna `sessions`
  queda para el modelo viejo (filas con `session_no null` = combo legacy
  "cantidad por tratamiento").
- `combo_purchase_services` gana **`session_no int`** (el plan congelado en
  la compra). Compras viejas (todo null) siguen con el agendador por
  tratamiento (legacy).
- `appointments` gana **`combo_session_no int`**: qué sesión del plan es este
  turno — el estado del plan (agendada/pendiente) no se confunde ni al
  cancelar/reagendar.
- Zonas por-zona: se eligen UNA vez por tratamiento y el snapshot se repite
  en cada aparición.

## Comportamiento

- **Armado**: el formulario arma sesiones (agregar sesión → agregar
  tratamientos en orden). Totales por tratamiento derivados (# filas).
  Validación server: precio>0, ≥1 sesión, cada sesión ≥1 tratamiento,
  ≥2 tratamientos DISTINTOS en el plan (si no, es un pack), sesiones 1..K
  contiguas.
- **Venta** (ficha y online): mecánica igual; congela el plan entero.
- **Agendar (ficha)**: lista "Sesión 1 ✔ / Sesión 2 → Agendar / …". Agendar
  la Sesión N crea UNA visita en $0 con las patas del plan en orden,
  encadenadas; disponibilidad validada por la duración total; profesional
  por pata (continuidad: preferir la de la pata anterior). Tope: cada sesión
  del plan se agenda una sola vez (turnos vivos).
- **Online 1ª sesión**: la clienta elige fecha/hora; el portador se crea con
  `combo_session_no = 1`, duración = Σ Sesión 1, la 1ª pata como ancla y el
  total del combo (la plata no cambia). El salón completa las patas después.
- **Legacy**: combos/compras con `session_no null` siguen mostrándose y
  agendándose como hasta ahora (por tratamiento). Nada se rompe a mitad.

## Fases

1. **Armado + catálogo**: migración combo_services (session_no + drop
   unique), validación nueva, formulario por sesiones, catálogo "N sesiones
   + detalle", lista admin con precio individual derivado.
2. **Venta congela el plan + agendador por sesión en la ficha**: migraciones
   combo_purchase_services.session_no + appointments.combo_session_no;
   venderPrograma congela el plan; scheduleProgramaSession → agenda la
   Sesión N completa (multi-pata, $0); ficha por sesiones (legacy fallback).
3. **Online**: portador con duración completa de la Sesión 1 + textos.
4. **Blindaje bfcache del botón de pagar** (pendiente anotado, va después).

Cada fase: tsc + vitest + build + revisión adversarial opus; migraciones
aditivas corridas por la usuaria antes del deploy. El "Programa Reductor"
sigue inactivo hasta armarlo con el plan nuevo y probarlo.
