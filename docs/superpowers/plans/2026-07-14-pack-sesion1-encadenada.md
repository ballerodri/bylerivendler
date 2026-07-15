# La 1ª sesión del pack encadenada con los servicios sueltos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que, en el modo "el mismo día, uno después del otro", la **1ª sesión del pack** se agende **pegada a los servicios sueltos** en una sola visita — la clienta elige **un** horario para todo.

**Architecture:** El buscador secuencial (`fetchSequentialAvailability`) recibe el servicio del pack como **ítem inicial FIJO** (primero, fijado a `packPro`), así ofrece sólo horarios donde entra toda la visita. La pantalla parte el resultado en **sesión 1 = T** (`packSlots[0]`) y **bloque de servicios = T + D_pack** (`startsAt`), que quedan **pegados** (`crossOverlapCheck` permite exactamente-adyacente). El servidor relaja **un solo** chequeo (la grilla del primer tramo suelto, que ahora arranca fuera de grilla a propósito); `planPack` ya valida que T esté en la grilla.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript strict, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-pack-sesion1-encadenada-design.md`

## Global Constraints

- **La sesión 1 del pack va SIEMPRE PRIMERA** en la cadena (el bloque de servicios sueltos es un solo turno contiguo, así que el pack sólo puede ir antes).
- **La profesional del pack se respeta:** la sesión 1 se fija a `packPro`. Si la clienta pidió una puntual, el buscador sólo ofrece horarios donde ESA persona esté libre. Nunca se le pone otra para que "entre" el horario.
- **El servidor no puede ser más estricto que el buscador.** Si el buscador ofrece un horario, el servidor tiene que aceptarlo (o hay reserva perdida); si asigna a alguien ocupada, hay doble reserva. Ya rompió esta app dos veces.
- **La plata NO se toca.** La sesión 1 sigue llevando el precio del pack (`packSessionPrices` índice 0); las 2..N en $0; cada servicio su precio. Una sola seña = la suma. Facturación y Estadísticas intactas.
- **Caso borde:** si el `serviceId` del pack está **entre** los `serviceIds` sueltos, **NO se encadena** (la sesión 1 se agenda por separado, como hoy) — dos ítems con el mismo id romperían `serviceOrder`/`resolvedStaff` del buscador.
- **Byte-idéntico cuando NO aplica:** pack solo, servicios solos (juntos o separados), y la mezcla en modo **"separados"** deben quedar exactamente como hoy. El encadenado es exclusivo de: **pack + servicios + modo "juntos" + sin colisión de serviceId**.
- **Todo o nada + devolver puntos:** ya lo hace `rollbackAll`. Cualquier `return` de error posterior al descuento de puntos debe devolverlos.
- **Ninguna migración.**
- Verificación en cada tarea: `npx tsc --noEmit` = 0 · `npx vitest run` verde · `npm run build` = 0 · `npx eslint src --quiet` = **16** (baseline de `main`; un 17º es un error nuevo).

## Estructura de archivos

| Archivo | Qué cambia |
|---|---|
| `src/app/reserva/actions.ts` | `fetchSequentialAvailability` acepta `opts.leadServiceId` (ítem fijo primero). `BookingInput` gana `packChainedFirst`. `planLooseServices` relaja la grilla del 1er tramo cuando `packChainedFirst`. |
| `src/app/reserva/screens.tsx` | El `useEffect` del buscador incluye el pack como lead. `selectSeqSlot` parte el resultado. `pay()` manda el payload encadenado. `PackSessionsSection` muestra la sesión 1 como "en esta visita". |

No hay módulo puro nuevo: el cambio del solver es una guarda de una línea (se verifica por revisión + prueba manual, porque `fetchSequentialAvailability` es DB-bound y no tiene tests).

---

### Task 1: El buscador acepta un ítem inicial FIJO (el pack)

**Files:**
- Modify: `src/app/reserva/actions.ts` (`fetchSequentialAvailability`, la firma y el `isValidOrder`)

**Interfaces:**
- Produces: `fetchSequentialAvailability(services, fromDate, daysAhead?, opts?: { enforceStaffServices?: boolean; leadServiceId?: string })`. Cuando `leadServiceId` viene, **sólo** se ofrecen cadenas donde ese servicio va **primero**.

- [ ] **Step 1: Agregar `leadServiceId` a la firma**

En `fetchSequentialAvailability` (`actions.ts:1802`), la firma pasa a:

```ts
export async function fetchSequentialAvailability(
  services: ServiceInput[],
  fromDate: string,
  daysAhead = 30,
  opts: { enforceStaffServices?: boolean; leadServiceId?: string } = {}
): Promise<SequentialAvailabilityResult> {
```

- [ ] **Step 2: Forzar el lead primero en `isValidOrder`**

En `isValidOrder` (dentro de `fetchSequentialAvailability`, `actions.ts:~1884`), **antes** del `return true` final, agregar:

```ts
    // Si hay un ítem inicial fijo (la 1ª sesión del pack encadenada), tiene que
    // ir SIEMPRE primero: el bloque de servicios sueltos es un turno contiguo,
    // así que el pack sólo puede ir antes.
    if (opts.leadServiceId && services[perm[0]]?.id !== opts.leadServiceId) return false
```

> **Por qué acá:** `isValidOrder` pre-filtra las permutaciones antes de `checkPerm`, así que descarta de una todas las cadenas donde el pack no es primero. El pinning de la profesional del pack ya lo hace `checkPerm` (`actions.ts:1747-1756`) cuando el `ServiceInput.staffId` del pack no es `"auto"` — no hay que tocar nada más.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16. (Todavía nadie pasa `leadServiceId`, así que el comportamiento no cambia: sólo tiene que compilar.)

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(encadenar): el buscador acepta un ítem inicial fijo (el pack va primero)"
```

---

### Task 2: El servidor acepta el bloque suelto arrancando fuera de grilla

**Files:**
- Modify: `src/app/reserva/actions.ts` (`BookingInput` + `planLooseServices`)

**Interfaces:**
- Produces: `BookingInput` gana `packChainedFirst?: boolean`. Cuando es `true`, `planLooseServices` **no** exige que el 1er tramo suelto caiga en la grilla (arranca en T+D_pack a propósito; `planPack` ya validó T).

- [ ] **Step 1: El flag en el schema**

En `BookingInput` (`actions.ts:27`), junto a `packStaff`:

```ts
  // La 1ª sesión del pack va encadenada al inicio de la cadena "juntos": el
  // bloque de servicios arranca cuando termina esa sesión (fuera de la grilla
  // de horarios a propósito). `planPack` valida que el arranque real (T) esté
  // en la grilla; acá se relaja SÓLO el chequeo de grilla del 1er tramo suelto.
  packChainedFirst: z.boolean().optional(),
```

- [ ] **Step 2: Relajar el chequeo de grilla del 1er tramo**

En `planLooseServices`, rama "juntos", el chequeo del tramo (hoy `actions.ts:~589`):

```ts
      if (!bh?.is_open || (i === 0 && !bh.slots.includes(timeStr)))
        return { ok: false, error: `El horario de "${s.name}" ya no está disponible. Elegí otro.` }
```

pasa a:

```ts
      // Con `packChainedFirst`, el 1er tramo suelto arranca cuando termina la
      // sesión 1 del pack (T + D_pack) — un horario que NO está en la grilla a
      // propósito. `planPack` ya validó que T (el arranque real de la visita)
      // esté en la grilla. El chequeo de disponibilidad REAL de abajo
      // (`fetchDayAvailability`) sigue corriendo en TODOS los tramos.
      const needsGrid = i === 0 && !input.packChainedFirst
      if (!bh?.is_open || (needsGrid && !bh.slots.includes(timeStr)))
        return { ok: false, error: `El horario de "${s.name}" ya no está disponible. Elegí otro.` }
```

> ⚠️ **Sólo se relaja la membresía en la grilla.** El `fetchDayAvailability(dateStr, c.durationMin, legProHint, [timeStr], { serviceId })` que viene justo después **NO se toca**: sigue chequeando que la profesional esté realmente libre en ese tramo. Así el servidor no puede doble-reservar. Y `bh.is_open` (el día tiene que estar abierto) se conserva para todos los tramos.

> **`input.packChainedFirst` está en alcance:** `planLooseServices` recibe `input` como primer parámetro (leelo). Si por algún motivo la firma no lo tuviera, agregalo — pero lo tiene.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16. (Nadie manda `packChainedFirst` todavía → `needsGrid` es siempre `true` → comportamiento idéntico.)

- [ ] **Step 4: Commit**

```bash
git add src/app/reserva/actions.ts
git commit -m "feat(encadenar): el servidor acepta el bloque suelto pegado después de la sesión del pack"
```

---

### Task 3: La pantalla arma la cadena con el pack e interpreta el resultado

**Files:**
- Modify: `src/app/reserva/screens.tsx` (el `useEffect` del buscador ~`:762`, `assignmentKey` ~`:758`, `selectSeqSlot` ~`:800`, + una constante derivada nueva)

**Interfaces:**
- Consumes de Task 1: `fetchSequentialAvailability(..., { leadServiceId })`.
- Produces: cuando aplica el encadenado, la cadena incluye el servicio del pack primero, y al elegir un horario se guarda **T** en `packSlots[0]` y `selectedDate`/`selectedTime`, y el `serviceOrder`/`resolvedStaff` **de los servicios sueltos** (sin el pack).

- [ ] **Step 1: La condición de encadenado**

En `Screen2DateTime`, junto a las otras constantes derivadas (donde ya están `mixed`, `packDurationMin`, `bookingMode`, etc.), agregar:

```tsx
  // El encadenado (sesión 1 del pack + servicios sueltos en una visita) aplica
  // sólo en la mezcla, en modo "juntos", y NO si el servicio del pack es
  // también uno de los sueltos (dos ítems con el mismo id romperían el buscador).
  const packServiceId = selectedPack?.pack.serviceId ?? null
  const chainPackFirst =
    mixed &&
    bookingMode === "juntos" &&
    !!packServiceId &&
    !state.services.some((s) => s.id === packServiceId)
```

> `mixed`, `bookingMode`, `selectedPack`, `state.services`, `packDurationMin` ya existen en el componente. Leé cómo están definidos antes de usarlos.

- [ ] **Step 2: Meter el pack como lead en el `useEffect`**

El `useEffect` que llama al buscador (`screens.tsx:762-784`) hoy arma `serviceInputs` sólo con `state.services`. Pasa a prependir el pack cuando `chainPackFirst`:

```tsx
  useEffect(() => {
    if (!selectedDate) { setSeqResult(null); return }
    const looseInputs = state.services.map((s) => ({
      id: s.id,
      name: s.name,
      duration: effectiveService(s, zoneSel).duration,
      staffId: serviceStaff[s.id] ?? "auto",
    }))
    // Con encadenado, el servicio del pack va PRIMERO en la cadena, fijado a la
    // profesional del pack (`packPro`) — así el buscador ofrece sólo horarios
    // donde entra toda la visita seguida.
    const packInput = chainPackFirst && packServiceId
      ? [{ id: packServiceId, name: selectedPack!.pack.serviceName, duration: packDurationMin, staffId: state.packPro ?? "auto" }]
      : []
    const serviceInputs = [...packInput, ...looseInputs]
    if (!serviceInputs.length) { setSeqResult(null); return }
    let cancelled = false
    setSlotsLoading(true)
    fetchSequentialAvailability(serviceInputs, selectedDate, 30, chainPackFirst && packServiceId ? { leadServiceId: packServiceId } : {}).then((result) => {
      if (cancelled) return
      setSeqResult(result)
      if (state.selectedTime && !result.slotsForDate.some((r) => r.time === state.selectedTime)) {
        setState({ ...state, selectedTime: null, serviceOrder: undefined, resolvedStaff: undefined })
      }
      setSlotsLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, assignmentKey])
```

> **Ojo:** hoy `serviceInputs` no incluye el pack, y el efecto retorna temprano `if (!state.services.length)` implícitamente (no llama al buscador sin servicios). Con encadenado hay siempre servicios sueltos (es la mezcla), así que `serviceInputs` nunca queda vacío. Mantené el resto del efecto igual.

- [ ] **Step 3: `assignmentKey` tiene que depender del pack**

`assignmentKey` (`screens.tsx:758-760`) hoy depende **sólo** de `state.services`. Con encadenado, cambiar el pack (o su profesional/zonas) tiene que **re-disparar** el buscador. Agregarle el pack:

```tsx
  const assignmentKey =
    (chainPackFirst && packServiceId
      ? `pack:${packServiceId}:${state.packPro ?? "auto"}:${packDurationMin}|`
      : "") +
    state.services.map((s) => `${s.id}:${serviceStaff[s.id] ?? "auto"}:${(zoneSel[s.id] ?? []).join(",")}`).join("|")
```

> Leé el `assignmentKey` actual y **conservá exactamente** su parte de servicios; sólo prependé la del pack. Si su forma es distinta, adaptá sin cambiar la parte de servicios (byte-idéntica cuando no hay encadenado).

- [ ] **Step 4: `selectSeqSlot` parte el resultado**

`selectSeqSlot` (`screens.tsx:800-812`) hoy guarda todo el `SlotResult` como si fuera de los servicios. Con encadenado, el resultado incluye el pack en `serviceOrder`/`resolvedStaff` — hay que **sacarlo** y guardar **T** también como fecha de la sesión 1:

```tsx
  const selectSeqSlot = (result: import("./actions").SlotResult) => {
    const d = parseYmd(result.date)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    if (chainPackFirst && packServiceId) {
      // La cadena incluye el pack primero. Se saca el pack del orden/staff de
      // los sueltos, y T (el arranque de la visita) es la fecha de la sesión 1.
      const looseOrder = result.serviceOrder.filter((id) => id !== packServiceId)
      const looseStaff: Record<string, string> = {}
      for (const [id, sid] of Object.entries(result.resolvedStaff))
        if (id !== packServiceId) looseStaff[id] = sid
      const T = combineDateTime(result.date, result.time).toISOString()
      const restSessions = (state.packSlots ?? []).slice(1)
      setState({
        ...state,
        selectedDate: result.date,
        selectedTime: result.time,
        serviceOrder: looseOrder,
        resolvedStaff: looseStaff,
        serviceStaff: { ...serviceStaff, ...looseStaff },
        // La sesión 1 del pack queda fijada al arranque de la visita (T). Las
        // sesiones 2..N se conservan (se siguen agendando por separado).
        packSlots: [T, ...restSessions],
      })
      return
    }
    setState({
      ...state,
      selectedDate: result.date,
      selectedTime: result.time,
      serviceOrder: result.serviceOrder,
      resolvedStaff: result.resolvedStaff,
      serviceStaff: { ...serviceStaff, ...result.resolvedStaff },
    })
  }
```

> `combineDateTime` y `parseYmd` ya se usan en el archivo. La rama del `else` es **el `selectSeqSlot` de hoy, sin tocar** — cópialo tal cual.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(encadenar): la pantalla arma la cadena con el pack e interpreta el resultado"
```

---

### Task 4: El payload encadenado (pay) y el pre-chequeo de superposición

**Files:**
- Modify: `src/app/reserva/screens.tsx` (`Screen5Confirm` `pay()` ~`:2324`, y el `mixedOverlap` ~`:715` si hace falta)

**Interfaces:**
- Consumes de Task 2: `createBooking` acepta `packChainedFirst`.
- Consumes de Task 3: en el encadenado, `state.packSlots[0]` = T y `selectedDate`/`selectedTime` = T.

**Nota importante sobre alcance:** `chainPackFirst` está definido en `Screen2DateTime` (Task 3). `Screen5Confirm` es **otro** componente. Recalculá la misma condición ahí (tiene `state`, `pack`, `services`, `bookingMode`) — es una constante derivada, no hay que pasarla por props.

- [ ] **Step 1: Recalcular la condición en `Screen5Confirm`**

En `Screen5Confirm`, junto a sus otras constantes (`pack`, `separados`, etc.), agregar:

```tsx
  const packServiceId = pack?.pack.serviceId ?? null
  const chainPackFirst =
    !!pack &&
    services.length > 0 &&
    (state.bookingMode ?? "juntos") === "juntos" &&
    !!packServiceId &&
    !services.some((s) => s.id === packServiceId)
```

> Leé cómo `Screen5Confirm` nombra el pack (`pack`) y los servicios (`services`) y `separados` — usá esos nombres.

- [ ] **Step 2: `startsAt` = T + D_pack, y el flag**

En `pay()`, el cálculo de `startsAt` (hoy `screens.tsx:2324-2343`) tiene un comentario CRÍTICO de que en la mezcla `startsAt` NO puede ser la fecha del pack. Con encadenado, `startsAt` pasa a ser **T + D_pack** (el bloque de servicios arranca cuando termina la sesión 1):

```tsx
    // Con encadenado, el bloque de servicios sueltos arranca cuando termina la
    // sesión 1 del pack: T + D_pack. Sin encadenado, se conserva el cálculo de
    // siempre (el arranque de los servicios sueltos, nunca la fecha del pack).
    const startsAt =
      chainPackFirst && state.selectedDate && state.selectedTime
        ? new Date(combineDateTime(state.selectedDate, state.selectedTime).getTime() + packDurationMin * 60_000)
        : services.length > 0
          ? (separados
              ? new Date(Math.min(...services.map((s) => new Date(state.serviceSlots![s.id]).getTime())))
              : combineDateTime(state.selectedDate!, state.selectedTime!))
          : new Date(packSlotsPicked[0])
```

> `packDurationMin` se computa en `Screen5Confirm` (buscá cómo — la misma fórmula que en `Screen2DateTime`, `pricingMode per_zone` = suma de zonas; `fixed` = `serviceDurationMin`). Si no está, agregalo con la misma fórmula. La rama del `else` (sin encadenado) es **el cálculo de hoy, sin tocar**.

- [ ] **Step 3: Mandar `packChainedFirst` en el payload**

En el objeto que se pasa a `createBooking`, agregar junto a `packStaff`/`packSlots`:

```tsx
      packChainedFirst: chainPackFirst,
```

> **`packStaff` y `packSlots` no cambian de forma:** `packStaff` sigue siendo `pack ? (state.packPro || "auto") : undefined` (la profesional que la clienta eligió; el servidor la fija en la sesión 1, que ya está validada en T). `packSlots` sigue siendo `packSlotsPicked` (que ahora tiene T en el índice 0, puesto por `selectSeqSlot`).

- [ ] **Step 4: El pre-chequeo de superposición no debe rechazar la cadena**

`mixedOverlap` (`screens.tsx:715-749`) valida en el cliente que las sesiones del pack no pisen el bloque suelto. Con encadenado, la sesión 1 (en T) y el bloque suelto (en T+D_pack) son **adyacentes** — `validateSeparateSlots` los acepta (borde exactamente pegado = OK). **Verificá** que con encadenado no rechace: la sesión 1 está en `packSessionSlots[0]` (startsAtMs = T, durationMin = packDurationMin) y el bloque suelto en `looseChainSlot` (startsAtMs = combineDateTime(selectedDate, selectedTime) = **T también**).

⚠️ **Problema:** hoy `looseChainSlot` usa `combineDateTime(selectedDate, selectedTime)` = **T** como arranque del bloque suelto. Con encadenado el bloque suelto arranca en **T + D_pack**, no en T. Si no se corrige, el pre-chequeo vería la sesión 1 [T, T+D_pack] y el bloque suelto [T, ...] **pisándose** y bloquearía la reserva.

Corregir `looseChainSlot` para que, con encadenado, arranque en T + D_pack:

```tsx
  const looseChainStartMs =
    selectedDate && selectedTime
      ? combineDateTime(selectedDate, selectedTime).getTime() + (chainPackFirst ? packDurationMin * 60_000 : 0)
      : 0
  const looseChainSlot: SlotItem[] =
    bookingMode === "juntos" && selectedDate && selectedTime
      ? [{
          serviceId: "juntos",
          name: state.services.length > 1 ? "Tus servicios" : (state.services[0]?.name ?? "Tus servicios"),
          startsAtMs: looseChainStartMs,
          durationMin: state.services.reduce((a, s) => a + effectiveService(s, zoneSel).duration, 0),
          priceCents: 0,
        }]
      : []
```

> Leé el bloque `mixedOverlap` entero (`screens.tsx:715-749`) y hacé este cambio adaptándote a los nombres reales. **Sin encadenado, `chainPackFirst` es `false` → el offset es 0 → idéntico a hoy.**

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(encadenar): el payload manda la cadena (servicios en T+D_pack) y el pre-chequeo la acepta"
```

---

### Task 5: La sesión 1 se muestra como "en esta visita"

**Files:**
- Modify: `src/app/reserva/screens.tsx` (`PackSessionsSection` — la lista de sesiones del pack)

**Interfaces:**
- Consumes de Task 3: `chainPackFirst`, y `state.packSlots[0]` = T cuando se eligió un horario.

**Qué hace:** cuando aplica el encadenado, la **1ª sesión del pack** no se agenda por su cuenta (no muestra su propio "Elegir fecha") — se muestra **atada a la visita**: sin fecha propia hasta que la clienta elige el horario de la cadena (en el calendario), y con la fecha T una vez elegido. Las sesiones 2..N siguen con "Elegir fecha".

- [ ] **Step 1: Leer `PackSessionsSection`**

Leé `PackSessionsSection` entero (la lista de sesiones con "Elegir fecha"/"Cambiar"/"Quitar", que usa `packPicked = cleanPackSlots(state.packSlots, ...)`). Hoy la sesión 1 es igual a las demás (su propio picker).

- [ ] **Step 2: La sesión 1 encadenada**

En el `map` de las sesiones, para el **índice 0** cuando `chainPackFirst`:
- **No** mostrar el botón "Elegir fecha"/"Cambiar" de la sesión 1 (su fecha la fija el calendario de la cadena).
- Mostrar un texto: si ya hay horario elegido (`state.selectedDate && state.selectedTime`), la fecha T con una etiqueta **"· en esta misma visita"**; si no, **"— elegí el horario de la visita abajo —"**.

Concretamente, en el renglón de la sesión `i === 0 && chainPackFirst`, reemplazar el control de fecha por:

```tsx
                  {i === 0 && chainPackFirst ? (
                    <span style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                      {state.selectedDate && state.selectedTime
                        ? `${fmtSlotAR(combineDateTime(state.selectedDate, state.selectedTime).toISOString())} · en esta visita`
                        : "— elegí el horario de la visita —"}
                    </span>
                  ) : (
                    /* … el control de fecha de siempre (Elegir fecha / Cambiar / Quitar) … */
                  )}
```

> `fmtSlotAR` ya existe en el archivo (lo usa la mezcla). Leé el renglón actual de la sesión y **conservá** su estructura; sólo cambiá el control de la sesión 1 encadenada. **Las sesiones 2..N y el caso NO-encadenado quedan idénticos.**

- [ ] **Step 3: El botón de continuar**

Con encadenado, "Continuar" se habilita cuando la clienta eligió el **horario de la cadena** (que fija la sesión 1 + los servicios). Verificá que `packReady`/`servicesReady`/`mixedOverlap` (las condiciones del CTA de la mezcla) lo contemplen:
- `packReady` hoy pide `state.packSlots[0]`. Con encadenado, `packSlots[0]` = T se setea al elegir el horario → OK, no hay que cambiarlo.
- `servicesReady` (juntos) pide `selectedDate && selectedTime` → OK.

Así que el CTA ya funciona. **Sólo confirmá** (leyendo `packReady`/`servicesReady`) que no haya una condición que pida además la fecha de la sesión 1 por separado. Si la hubiera, ajustá para que en el encadenado alcance con el horario de la cadena.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet`
Expected: tsc 0 · vitest verde · build 0 · eslint 16.

- [ ] **Step 5: Verificación manual (obligatoria)**

En `/reserva`:
1. Elegir un **pack + un servicio suelto**, modo **"el mismo día, uno después del otro"**.
2. La **sesión 1 del pack** dice **"— elegí el horario de la visita —"** (sin su propio "Elegir fecha").
3. El calendario ofrece horarios; elegir uno.
4. La sesión 1 pasa a mostrar la fecha con **"· en esta visita"**; las sesiones 2..N siguen con "Elegir fecha".
5. Confirmar → en el admin: la **sesión 1 del pack** y el **turno de los servicios** quedan **el mismo día, pegados** (sesión 1 a las 10:00, servicios a las 10:20), cada uno con su profesional, y **una sola seña**.

- [ ] **Step 6: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(encadenar): la sesión 1 del pack se muestra como parte de la visita"
```

---

### Task 6: Verificación final y deploy

- [ ] **Step 1: Suite completa**

```bash
npx tsc --noEmit && npx vitest run && npm run build && npx eslint src --quiet
```
Expected: tsc 0 · vitest **139** verdes · build 0 · eslint **16** (baseline; 0 nuevos).

- [ ] **Step 2: Recorrido end-to-end**

**Lo que NO se puede haber roto (byte-idéntico a hoy):**
1. **Pack solo** → sus sesiones como siempre.
2. **Servicios solos "juntos"** → un turno encadenado.
3. **Servicios solos "separados"** → un turno por servicio.
4. **Combo** → un turno.
5. **Mezcla en "separados"** → sesión 1 del pack por su cuenta + servicios cada uno su fecha.

**Lo nuevo:**
6. **Mezcla en "juntos"** → sesión 1 del pack + servicios, **el mismo día pegados**, con **una sola seña** = la suma exacta de los `deposit_cents`.
7. **La profesional del pack** se respeta: si se elige una puntual, la sesión 1 queda con ella (o no se ofrece el horario).
8. **Caso borde**: pack de un servicio + ese mismo servicio suelto → **no** se encadena (sesión 1 por separado), y la reserva funciona igual.

- [ ] **Step 3: Deploy (lo hace la controladora)**

No hay migración: se pushea el código a `main`.

---

## Notas de riesgo

- **La regla de oro:** el servidor no puede ser más estricto que el buscador. La sesión 1 se ofrece (buscador) y se valida (planPack) con **la misma** función de disponibilidad y **el mismo** `packPro`; el bloque suelto se ofrece (buscador, encadenado) y se valida (planLooseServices, con la grilla relajada pero la disponibilidad REAL intacta). La revisión tiene que trazar que **un horario ofrecido siempre se acepta**.
- **El acoplamiento nuevo** (sesión 1 = T, servicios = T+D_pack) es el corazón del cambio. Los tres caminos que NO encadenan (pack solo, servicios solos, mezcla separados) tienen que quedar **idénticos** — se verifica comparando contra `main`.
- **`packDurationMin` (cliente) tiene que ser IGUAL a `firstDuration` (servidor, en planPack).** Si difirieran, el bloque suelto arrancaría en un T+D_pack distinto del que valida el servidor y podría pisar la sesión 1 o dejar un hueco. Es un invariante que ya existe (el `mixedOverlap` de hoy ya depende de esa igualdad) — no romperlo.
- **`createBooking` no tiene tests.** La plata, el encadenado y la no-superposición se verifican leyendo el diff y con la prueba manual.
