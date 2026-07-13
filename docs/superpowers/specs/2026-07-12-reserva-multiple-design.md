# Diseño — Varios servicios, cada uno con su fecha, con una sola seña

**Fecha:** 2026-07-12
**Estado:** Aprobado (pendiente de plan de implementación)

## Problema (caso real)

Una clienta quiso reservar **varios servicios** y **no pudo**, y además no quería **pasar una seña
por cada uno**.

**Causa exacta:** hoy, al elegir 2+ servicios, `createBooking` crea **UN solo turno** y encadena los
servicios **uno detrás del otro, el mismo día** (`appointment_services` con `starts_at` escalonado;
`fetchSequentialAvailability` busca un bloque donde entren todos). Si no hay un bloque libre lo
bastante largo —o si la clienta quiere uno el lunes y otro el viernes— **no hay forma**: tiene que
hacer **dos reservas separadas**, y entonces sí paga **dos señas**.

## Hallazgos del relevamiento

1. **No hay Mercado Pago.** `MP_ACCESS_TOKEN` existe como variable de entorno pero **ningún código
   la usa**. La app **nunca cobra online**: la seña es un número informativo y se cobra por fuera.
2. **No existe registro de pagos.** `appointments.deposit_paid` (bool) se escribe **al crear** el
   turno y no hay ninguna UI que lo modifique. Hoy es **imposible** anotar que una clienta pagó, ni
   cuánto. Esto es una carencia real, no un extra.

## Decisiones (acordadas con la usuaria)

1. **Se ofrecen las dos opciones**: "el mismo día, uno después del otro" (lo de hoy, que es cómodo
   cuando viene una sola vez) **y** "cada uno en su fecha y horario" (nuevo).
2. **Se registra el monto pagado**, no un sí/no: la clienta puede elegir pagar **la seña** o **el
   total**, y el salón anota **cuánto cobró de verdad**.
3. **Los packs no se tocan**: la 1ª sesión sigue siendo obligatoria (así las estadísticas del pack
   siguen funcionando como hoy).

## Cómo se cobra hoy (importante: NO hay cobro automático)

La app **nunca cobra**. En la pantalla de confirmación muestra **Total**, **"Seña (30%) hoy"** y
**"Resto a abonar en el local"**; dice **"Seña por transferencia"** y ofrece un **botón de WhatsApp**
para mandar el comprobante. El turno nace `pending`; el salón ve el comprobante y lo confirma.

Por eso "elegir pagar el total" **no requiere ninguna pasarela**: sólo cambia **el importe que se le
pide transferir**.

## Alcance

### Etapa 1 (este spec)

1. **Varios servicios, cada uno con su fecha**: con 2+ servicios se elige el modo **juntos**
   (actual) o **separados** (nuevo). En separados se elige fecha/hora por servicio → **un turno por
   servicio**, con **una sola seña**.
2. **Elegir cuánto pagar ahora: la seña (30%) o el TOTAL.** Es una opción **siempre disponible**
   (una reserva simple, varios servicios, y también los packs). No cambia nada del cobro: sólo
   cambia el importe que se le pide transferir.
3. **Registro del pago**: el salón anota **cuánto cobró de verdad** en cada turno.

### Etapa 2 (futuro)

- Cobro online real (Mercado Pago), si algún día se conecta.

## La regla de oro de este diseño

**La plata NO se mueve entre turnos.** Cada turno es autosuficiente: lleva **el precio de su propio
servicio** y **su propia seña**. Esto es lo contrario del error que se cometió (y se revirtió) en el
pack multi-sesión, donde se intentó que el precio "siguiera" al turno vivo y chocó con facturación
(que factura y deduplica **por turno**). Ver [[project_pack_multi_sesion]].

Consecuencia: **Estadísticas y Facturación siguen funcionando exactamente como hoy**, sin tocarlas.

## Modelo de datos

**Una sola columna nueva:**

```sql
alter table public.appointments
  add column if not exists paid_cents int not null default 0;  -- cuánto se cobró de verdad
```

Semántica de las tres columnas de plata (ninguna se mueve entre turnos):

| Columna | Significa |
|---|---|
| `total_cents` | lo que vale el turno |
| `deposit_cents` | **lo que la clienta tiene que pagar AHORA** (la seña del 30%, o el total si eligió pagar todo) |
| `paid_cents` | **lo que el salón efectivamente cobró** (lo registra el salón) |

`deposit_paid` (bool) queda **en desuso** para lo nuevo (se deriva de `paid_cents >= deposit_cents`),
pero **no se borra** para no romper lo existente.

### Reparto de la plata (modo "separados", N servicios)

| Turno | `total_cents` | `deposit_cents` | `paid_cents` | `status` |
|---|---|---|---|---|
| Servicio *i* | precio efectivo del servicio *i* | `round(precio_i × pct)` | `0` | `pending` |

donde `pct` = **0.3** si eligió seña, **1.0** si eligió pagar el total.

- **El importe que se le muestra = la SUMA de los `deposit_cents` de cada turno.** Es el número
  exacto que transfiere, **una sola vez**.
- Cada turno tiene **un solo** `appointment_services` (su servicio), con su precio y sus zonas.
- El modo **"juntos"** sigue siendo **un turno**; sólo cambia su `deposit_cents` según la elección.

### La opción "pagar el total" aplica a TODO

Reserva simple, varios servicios (juntos o separados) **y packs**. En todos los casos es lo mismo:
`deposit_cents` = 30% del turno, o el 100%. **Nada más cambia.** (En el pack, el 100% es el precio
del pack, que vive en el turno de la 1ª sesión — el resto de las sesiones ya está en `$0`.)

### Canje con puntos

Sigue aplicando a **toda la reserva** (como hoy): si canjea, **todos** los turnos creados van en
`total_cents: 0`, `deposit_cents: 0`, `paid_cents: 0`, `status: 'confirmed'`, y **no se ofrece
elegir cuánto pagar** (no hay nada que pagar).

## Flujo (modo "separados")

1. La clienta elige 2+ servicios (y sus zonas, si aplica) — igual que hoy.
2. Aparece la pregunta:

```
Elegiste: Limpieza facial + Masaje descontracturante

  ¿Cómo los querés?
   (o) El mismo día, uno después del otro     ← como hoy
   ( ) Cada uno en su fecha y horario         ← nuevo
```

3. Si elige **separados**, ve una lista y elige fecha/hora **para cada servicio**:

```
  Limpieza facial (60 min)    Lun 20/07  14:00   [cambiar]
  Masaje (90 min)             Vie 24/07  10:00   [cambiar]

  Seña total: $30.000   ← una sola transferencia

        [ Confirmar (2 turnos) ]
```

4. **Todas** las fechas son obligatorias en este modo (a diferencia del pack, acá no hay "lo agendo
   después": son servicios sueltos, no sesiones de algo ya pagado).

5. En la **confirmación** (esto vale para TODA reserva, no sólo la múltiple):

```
  ¿Cuánto vas a pagar ahora?
   (o) La seña (30%)     $30.000   → el resto lo abonás en el local
   ( ) El total          $100.000  → no debés nada al llegar

  Transferí ese importe y mandanos el comprobante.   [WhatsApp]
```

6. Al confirmar, el servidor:
   - Revalida **cada** slot contra la disponibilidad real (`fetchDayAvailability`), con la duración
     y la profesional de **ese** servicio.
   - **Todo o nada:** si alguno falla, no crea ningún turno.
   - Crea **un turno por servicio**, con su precio y su `deposit_cents` según lo elegido.

## Registro del pago (admin)

En la fila del turno (y en la ficha de la clienta): **"Registrar pago"** → el salón ingresa cuánto
cobró. Se guarda en `paid_cents` y se muestra:

```
  Pagado: $30.000 de $100.000        (seña)
  Pagado: $100.000 de $100.000  ✓    (completo)
  Pagado: $0 de $100.000             (sin pagar)
```

Acción del servidor `registrarPago(appointmentId, paidCents)`: `requireStaff()`, valida
`0 <= paidCents <= total_cents`, escribe `paid_cents`. **No toca `total_cents`** (la plata no se
mueve).

## Validaciones (servidor, autoritativo)

| Regla | Mensaje |
|---|---|
| Modo separados: una fecha por cada servicio elegido | "Elegí fecha y hora para cada servicio." |
| Cada horario sigue **libre** | "El horario de *(servicio)* se ocupó. Elegí otro." → no crea nada |
| **Los turnos elegidos no se superponen entre sí** | "*(Servicio B)* se superpone con *(Servicio A)*. La clienta no puede estar en dos lugares a la vez." |
| Fechas en el futuro | "*(Servicio)* tiene que ser en una fecha futura." |
| El horario existe en los horarios del negocio | Rechaza |

**La no-superposición entre los turnos elegidos es obligatoria aunque sean con profesionales
distintas**: la clienta es una sola y no puede estar en dos servicios a la vez. El servidor debe
chequearlo (los turnos que se están creando **todavía no están en la base**, así que
`fetchDayAvailability` no los ve — mismo problema ya resuelto en el pack).

## Reutilización

Esto reusa lo construido en el pack multi-sesión:
- La mecánica de "varias fechas → varios turnos en una sola llamada a `createBooking`", con
  revalidación por slot, chequeo de auto-superposición y rollback todo-o-nada.
- El selector de fecha/hora ya extraído (`PackSessionPicker`) — se generaliza a "elegir el horario de
  un ítem", con la duración y la profesional de ese ítem.

## Fuera de alcance

- **Packs**: la 1ª sesión sigue **obligatoria** (así las estadísticas del pack no cambian). Lo único
  que ganan es la opción de **pagar el total**.
- **Combos**: siguen siendo **un** turno (no se dividen).
- **Modo "juntos"**: no cambia su comportamiento (sólo su `deposit_cents` según la elección de pago).
- **Cobro online (Mercado Pago)**: no existe y **no se agrega**. Se sigue cobrando por transferencia
  + comprobante por WhatsApp.
- **Facturación y Estadísticas**: **no se tocan** (siguen leyendo `total_cents` por turno).

## Riesgos

- **`screens.tsx` es enorme (~2000 líneas)** y ya tiene la rama del pack. Agregar el modo separados
  hay que hacerlo sin tocar el camino normal ni el del pack. Los tres deben convivir.
- El modo **"juntos"** es el camino de ingresos principal del salón: **cualquier regresión ahí es
  crítica**. Debe verificarse byte-idéntico.
