# Combos como programas multi-sesión — Diseño

**Fecha:** 2026-08-16
**Estado:** para revisión de la usuaria

## Problema

Hoy un "combo" es un paquete de servicios DISTINTOS (cada uno una sola vez) que
se hacen en UNA visita, a precio especial. Pero la usuaria los usa como
**programas de varias sesiones** (ej. "Programa Reductor Pretemporada" =
Ultracavitación + Vela Slim + Vela Up, cada uno varias veces a lo largo de las
semanas). El modelo actual no tiene "cantidad de sesiones por tratamiento", así
que:

- El precio del programa ($150.000) se compara contra UNA sesión de cada
  servicio ($80.000) → la app lo marca como "$70.000 más caro" y quedó inactivo.
- Reservarlo agenda UNA visita con los 3 tratamientos juntos una vez — que no es
  lo que la usuaria vende.

## Decisiones ya tomadas (por la usuaria)

1. Un combo = **programa de varias sesiones y varios tratamientos**, funciona
   **como un pack** pero con más de un servicio.
2. Cada tratamiento tiene su **propia cantidad de sesiones**, elegida al armar el
   combo (ej. Ultra ×4, Vela Slim ×4, Vela Up ×6).
3. Se vende **online (como los packs) y desde el admin**.
4. **Una sola factura por el total** del programa (la 1ª sesión lleva el precio
   total; las demás en $0 — exactamente como ya funcionan los packs).
5. Mientras se construye, el "Programa Reductor" queda **inactivo/oculto**.

## Decisiones a CONFIRMAR en esta revisión (defaults elegidos)

- **D1 — Servicios "por zona" dentro del programa (importante, el combo real usa
  Vela Slim y Vela Up, que son por zona):** al armar el programa, cuando se
  agrega un servicio por zona, la usuaria **elige la(s) zona(s) ahí mismo** y
  quedan FIJAS para todas las sesiones de ese servicio en el programa. Sin esto
  no se puede saber la duración ni el precio de esas sesiones. *(Recomendado.)*
- **D2 — Agendado:** al comprar/cargar el programa se agenda la **1ª sesión**; el
  resto las va agendando el salón (o la clienta desde el portal) después, una por
  una, igual que las sesiones de pack. NO se eligen las 14 fechas de una.
  *(Recomendado; es "como los packs".)*
- **D3 — Puntos del Programa Cerca:** un programa **no** suma ni canjea puntos
  (igual que los packs). *(Recomendado.)*
- **D4 — El nombre viejo "combo":** en la UI pasa a llamarse **"programa"** para
  la usuaria (el menú "Combos" → "Programas"). Por dentro las tablas siguen
  llamándose `combos` para no migrar nombres. *(Menor, confirmable.)*

## Modelo de datos

Se REUTILIZA el patrón de packs. Migración aditiva (sin romper nada existente).

### `combo_services` (existe) — agregar cantidad + snapshot de zona

```sql
alter table combo_services add column if not exists sessions int not null default 1
  check (sessions > 0);
-- Para un servicio POR ZONA dentro del programa: las zonas elegidas al armarlo,
-- congeladas (id + nombre + precio + duración), como ya hace appointment_services.zones.
alter table combo_services add column if not exists zones jsonb;
```

### `combo_purchases` (nueva) — la compra del programa (espejo de `pack_purchases`)

```sql
create table combo_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  combo_id uuid references combos(id) on delete set null,
  combo_name text not null,                 -- snapshot: sobrevive al borrado/edición del combo
  total_price_cents integer not null check (total_price_cents >= 0),
  created_at timestamptz not null default now()
);
-- La cantidad de sesiones por servicio se congela en la compra (el combo puede
-- editarse después): una fila por servicio del programa.
create table combo_purchase_services (
  id uuid primary key default gen_random_uuid(),
  combo_purchase_id uuid not null references combo_purchases(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  service_name text not null,
  sessions int not null check (sessions > 0),
  zones jsonb,                              -- snapshot de zona si es por-zona
  order_index int not null default 0
);
-- Vincula un turno con la compra de programa de la que descuenta una sesión.
alter table appointments add column if not exists combo_purchase_id uuid
  references combo_purchases(id) on delete set null;
```

**Por qué snapshots (combo_name, sessions, zones en la compra):** igual que los
packs guardan `pack_name`/`service_name`, la compra no puede depender de que el
combo siga existiendo/igual. Editar o borrar un combo NO altera las compras ya
hechas.

**Sesiones restantes (por servicio):** se deriva contando los turnos VIVOS
(no cancelados/no_show) con ese `combo_purchase_id` y ese servicio, contra
`combo_purchase_services.sessions`. Mismo criterio "vivo" que los packs.

## Precio

- **Precio del programa:** lo pone la usuaria (un total, como hoy).
- **Precio individual (para el ahorro):** `Σ (precio_del_servicio × sesiones)`,
  usando el precio real (para por-zona, el de las zonas elegidas × sesiones).
  Reemplaza al cálculo actual que ignora las cantidades → deja de verse "caro".
- **La plata en la reserva:** el **turno portador** (la 1ª sesión agendada) lleva
  `total_cents = total_price_cents` del programa; su seña es el 30% de ese total.
  Las sesiones 2..N nacen en `$0`. IDÉNTICO a como los packs ponen el precio en
  el portador. → Facturación: UNA Factura C (el portador), las de $0 no se
  facturan. (Ya verificado que facturación lee `appointments.total_cents`.)

## Armado del programa (Admin → Programas)

El formulario actual (`combo-form.tsx`) evoluciona:

- Por cada servicio tildado: un campo **"sesiones"** (default 1). Para un servicio
  **por zona**, además el selector de zona(s) (reusa el de la reserva/servicio).
- El "precio individual" y el "ahorro" usan `Σ precio×sesiones` (D1 para zonas).
- Mostrar el total de sesiones del programa (Σ sesiones) y el detalle
  ("Ultracavitación ×4, Vela Slim ×4 (abdomen), Vela Up ×6").
- Validación **del lado del servidor** (hoy falta, ver auditoría): mínimo 1
  servicio (ya no 2 obligatorios — un "programa" de un solo servicio con muchas
  sesiones es válido, pero eso ya es un pack… ⇒ se mantiene **mínimo 2
  servicios** para diferenciarlo del pack), precio > 0, sesiones > 0, servicios
  del combo sin duplicar, escritura **atómica** (hoy puede dejar combos huérfanos
  o sin servicios).

## Reserva de un programa

### Online (screens.tsx / flow.tsx) — como un pack

Al elegir un programa, se comporta como el pack: se agenda la **1ª sesión**
(elegís servicio de los del programa + fecha/hora), se cobra la seña (30% del
total), y se crea `combo_purchases` + `combo_purchase_services` + el turno
portador (con el total). El resto de las sesiones quedan "por agendar".

El motor de disponibilidad (buscar horarios, profesional-por-servicio, tope de
cierre) se reutiliza igual que una sesión de pack (una pata, un servicio). Nada
de "juntos" multi-servicio: **cada sesión es UN servicio**.

### Admin (Nueva reserva + ficha de la clienta)

- **Nueva reserva:** un programa se puede vender como se venden los packs hoy
  (mismo motor `createBooking` con `adminMode`, o una acción hermana).
- **Ficha de la clienta:** el bloque "Packs" pasa a mostrar también los
  **programas comprados**, con sus sesiones (usadas / por agendar POR SERVICIO)
  y el mismo agendador (`PackSessionPicker`) para agendar cada sesión — eligiendo
  el servicio de la sesión. (Reutiliza `pack-sessions.tsx` extendido, o un
  componente hermano `combo-sessions.tsx`.)

### Agendar cada sesión (schedulePackSession → equivalente para programas)

Al agendar una sesión de un programa: se elige el **servicio** (de los que aún
tienen sesiones por agendar) + fecha/hora; se crea el turno (una pata de ese
servicio, con su zona si corresponde), en `$0`, con `combo_purchase_id`. Respeta
el intervalo mínimo si aplica (o no — los packs tienen `interval_days`; el
programa podría tener uno global, ver D-abierta abajo).

## Facturación, estadísticas, mails, "tus turnos"

- **Facturación:** sin cambios de mecanismo — el portador lleva el total, una
  Factura C, las sesiones $0 no se facturan. La `descripcion` de la factura pasa
  a ser el **nombre del programa** (hoy es la lista de servicios).
- **Estadísticas:** el bug de la auditoría (per-profesional usa la suma de las
  patas ≠ total del combo) **desaparece solo** con el nuevo modelo: cada sesión
  es un turno SEPARADO de UN servicio, no un turno con N patas. El portador lleva
  el total y se atribuye a la profesional que hace esa sesión (igual que un
  pack); las sesiones en $0 aportan $0. El total del programa se cuenta una sola
  vez y cuadra con "Ingresos completados". (Consecuencia aceptada, igual que en
  packs: el total queda atribuido a UNA profesional —la del portador—, no
  repartido entre las que hacen cada sesión. Si la usuaria quisiera repartir, es
  un follow-up.)
- **Mails / "tus turnos" / portal:** una sesión de programa se muestra como un
  turno normal de un servicio, etiquetado con el nombre del programa (como una
  sesión de pack muestra el nombre del pack). El itinerario de confirmación ya es
  cronológico.

## Auditoría del flujo actual — qué se arregla acá

El rediseño reemplaza el camino "combo = una visita juntos", así que estos
hallazgos de la auditoría se resuelven de raíz o con guardas nuevas:

- **Por-zona dentro del combo era inbookeable** → resuelto (D1: zonas fijadas al
  armar el programa; cada sesión es un servicio con su zona).
- **Estadísticas por profesional mal** → se corrige (atribución por turno, no por
  suma de patas).
- **Desactivar el combo a mitad de reserva cobraba la suma individual** → el
  nuevo camino valida el programa activo y rechaza si no está.
- **El servidor no verificaba los serviceIds del combo** → la reserva de programa
  arma las sesiones desde `combo_purchase_services` (snapshot), no desde
  serviceIds que manda el cliente.
- **fetchCombos mostraba combos con servicios inactivos/ocultos al precio
  completo** → el catálogo de programas filtra bien (o esconde el programa).
- **Canje de puntos con combo (fail-open)** → D3: guarda fail-closed.
- **Alta sin validación server / no atómica / combos huérfanos** → validación
  server + escritura atómica.
- **Identidad del combo perdida tras reservar** → `combo_purchase_id` +
  snapshots dan trazabilidad (nombre en factura, en "tus turnos", en stats).

## Constraints globales

- Migraciones **aditivas** y corridas por la usuaria/CI antes del deploy (patrón
  del proyecto). Nada destructivo.
- **Regla de oro** intacta: buscador == creación == pantalla (una sesión de
  programa es una pata de un servicio; usa el mismo motor que ya existe).
- La revalidación del servidor **nunca** más estricta que el buscador.
- Todo error posterior al descuento de puntos/seña devuelve lo descontado.
- El combo actual sigue **inactivo** hasta terminar; ninguna reserva a medio
  camino puede quedar mal.
- Se construye **por fases**, cada una desplegable y revisada (ver plan).

## Fuera de alcance (por ahora)

- Elegir las N fechas de todas las sesiones de una (D2: se agendan una por una).
- Puntos para programas (D3).
- Reprogramar el programa completo de un saque (cada sesión se reagenda como hoy).

## Decisión abierta menor (se puede resolver en el plan)

- **Intervalo mínimo entre sesiones del programa:** los packs tienen
  `interval_days`. ¿El programa tiene un intervalo global, por servicio, o
  ninguno? Default propuesto: **ninguno** en la v1 (el salón agenda con criterio),
  y se puede agregar después.

## Fases de implementación (resumen; el detalle va en el plan)

1. **Definición del programa:** migración (`combo_services.sessions` + `zones`),
   formulario con cantidades + zonas, precio/ahorro correcto, validación server +
   atómica, renombrado UI a "Programa". (Entregable: armar programas bien; el
   combo sigue sin reservarse online.)
2. **Compra + 1ª sesión:** `combo_purchases` + `combo_purchase_services` +
   `appointments.combo_purchase_id`; reserva online y admin de la 1ª sesión con
   el total en el portador y la seña; guardas server (activo, snapshot, no
   puntos).
3. **Agendar el resto de las sesiones:** agendador por servicio en la ficha (y
   portal), descuento por servicio, mismo motor de disponibilidad.
4. **Factura / stats / mails / display:** descripción con nombre de programa,
   corrección de stats por profesional, etiqueta de programa en "tus turnos".

## Testing

- Módulos puros con tests (patrón del proyecto): cálculo de precio individual y
  ahorro con cantidades y zonas; sesiones restantes por servicio.
- Validaciones server (activo, snapshot, no-puntos, atomicidad) con casos límite.
- Cada fase: tsc + vitest + build + revisión adversarial opus antes de desplegar.
