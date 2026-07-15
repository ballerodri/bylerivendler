# Resumen "Qué / Cuándo" reorganizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En la confirmación, "Pack y tratamientos" muestra sólo nombre + precio, y "Cuándo" muestra fecha · hora · duración · profesional de cada turno; se elimina la fila suelta "Profesional".

**Architecture:** Reorganización presentacional de un solo bloque en `Screen5Confirm` (`src/app/reserva/screens.tsx`). Se unifican `orderedItems` + `chainedOrdered` en una sola lista `juntosItems` (servicios sueltos en modo "juntos", con `{svc, startTime, assignedPro}`) usada sólo en "Cuándo". Los mismos valores de hoy, reubicados; no se toca la reserva ni la plata.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict.

## Global Constraints

Copiadas de la spec (`docs/superpowers/specs/2026-07-15-resumen-que-cuando-design.md`). La única tarea las hereda:

- **Presentacional.** No se toca `createBooking`, `pay()`, el payload, la plata, ni las filas "Total"/"Seña"/"Dónde"/canje. Son los MISMOS valores (precios, horas, duraciones, profesionales), sólo reubicados.
- **"Pack y tratamientos" = nombre + precio.** Pack: `{nombre} · {N} sesiones` (+ zonas) + `fmtPrice(packTotal)`; se SACA `packPro`. Cada servicio: `{nombre}` + `fmtPrice(effective(s).price)`; se SACAN hora, duración y profesional.
- **"Cuándo" = fecha · hora · duración · profesional** por turno. Se AGREGA la profesional a cada línea.
- **La fila suelta "Profesional" se ELIMINA** (las dos ramas: separados y `!isMultiResolved`).
- **El horario mostrado sigue == el reservado** (`startsAt`): `juntosItems` arranca en `T` sin encadenar y `T + packDurationMin` encadenado — idéntico a lo que hoy dan `orderedItems`/`chainedOrdered`.
- **Fuente de cada profesional (sin cambios):** sesiones del pack → `packPro`; servicios juntos/combo → `state.resolvedStaff[id]` (fallback `state.pro` → "auto"); servicios separados → `state.serviceStaff[id]`.

**Definiciones de referencia (ya en scope de `Screen5Confirm`, NO crear):**
- `services` (`state.services`), `combo`, `pack`, `packZones`, `packTotal` (`pack.pack.priceCents/100`), `packPro` (string, "Asignación automática" si auto), `packDurationMin`, `packSlotsForDisplay`, `separados`, `chainPackFirst`, `dateObj`, `dow`, `displayTime` (`state.selectedTime`), `professionals`, `effective(s)`, `fmtPrice`, `fmtDuration`, `fmtSlotAR`, `arPartsFromUtc`, `parseYmd`, `DOW_NAMES`, `MONTH_NAMES`, `addMinutesHM`, `sequentialStartTimes`, `Service`.

---

### Task 1: Reorganizar el resumen ("Qué" nombre+precio, "Cuándo" +profesional, sin fila "Profesional")

**Files:**
- Modify: `src/app/reserva/screens.tsx` (`Screen5Confirm`): reemplazar `orderedItems` + `chainedOrdered` por `juntosItems` (~líneas 2427-2461); reescribir el valor de la fila "Pack y tratamientos" (~líneas 2620-2650); reescribir el valor de la fila "Cuándo" (~líneas 2652-2742); eliminar la fila "Profesional" (~líneas 2743-2767).

**Interfaces:**
- Consumes: `addMinutesHM`, `sequentialStartTimes` (ya importados), y las definiciones de referencia de arriba.
- Produces: nada que otra tarea consuma (única tarea).

**Contexto:** El resumen tiene hoy tres filas para los mismos ítems — "Pack y tratamientos" (QUÉ), "Cuándo", y "Profesional" —, con horario/duración/profesional repetidos. Este cambio deja "Qué" = nombre+precio, mete la profesional en "Cuándo", y borra la fila "Profesional". Es un solo bloque; se hace y se revisa junto porque las partes comparten datos (`juntosItems`) y separarlas dejaría estados intermedios que no compilan o muestran de más.

- [ ] **Step 1: Reemplazar `orderedItems` + `chainedOrdered` por `juntosItems`**

Reemplazar los DOS bloques actuales (`orderedItems` ~líneas 2427-2444 y `chainedOrdered` ~líneas 2446-2461):

```tsx
  // Per-service schedule for multi-professional bookings
  const isMultiResolved = services.length > 1 && !!state.serviceOrder && !!state.resolvedStaff
  const orderedItems = (() => {
    if (!isMultiResolved || !state.serviceOrder || !state.selectedTime) return []
    // Con encadenado, el bloque de servicios sueltos arranca DESPUÉS de la 1ª
    // sesión del pack (T + D_pack) — el MISMO arranque que pay() manda en
    // `startsAt`. Sin encadenado el offset es 0 (byte-idéntico a antes).
    const base = addMinutesHM(state.selectedTime, chainPackFirst ? packDurationMin : 0)
    const items = state.serviceOrder
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const starts = sequentialStartTimes(base, items.map((s) => effective(s).duration))
    return items.map((svc, i) => ({
      svc,
      assignedPro: professionals.find((p) => p.id === state.resolvedStaff?.[svc.id]),
      startTime: starts[i],
    }))
  })()

  // Encadenado: los servicios sueltos como secuencia, arrancando en T + D_pack
  // (el MISMO arranque que pay() reserva). A diferencia de `orderedItems`,
  // existe también con UN solo servicio suelto (ahí `isMultiResolved` es false
  // y `orderedItems` queda vacío). Misma fuente pura, así "QUÉ" y "CUÁNDO"
  // nunca discrepan.
  const chainedOrdered = (() => {
    if (!chainPackFirst || !state.selectedTime) return []
    const items = (state.serviceOrder ?? services.map((s) => s.id))
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const starts = sequentialStartTimes(
      addMinutesHM(state.selectedTime, packDurationMin),
      items.map((s) => effective(s).duration)
    )
    return items.map((svc, i) => ({ svc, startTime: starts[i] }))
  })()
```

por UN solo bloque `juntosItems`:

```tsx
  // Los servicios sueltos en modo "juntos" (encadenado o no, 1 o más), en
  // orden y con su horario y profesional. Fuente ÚNICA de "Cuándo" para los
  // servicios de una visita — antes había dos listas (`orderedItems` con
  // profesional pero sólo 2+ servicios, y `chainedOrdered` sin profesional).
  // Arranque: T + D_pack encadenado, T si no (el MISMO que pay() reserva, vía
  // `sequentialStartTimes`). En "separados" no aplica (cada servicio tiene su
  // propia fecha). La profesional sale de `resolvedStaff`; si un servicio no
  // tiene una resuelta (ej. un solo servicio), cae a `state.pro` → "auto".
  const juntosItems = (() => {
    if (separados || services.length === 0 || !state.selectedTime) return []
    const base = addMinutesHM(state.selectedTime, chainPackFirst ? packDurationMin : 0)
    const items = (state.serviceOrder ?? services.map((s) => s.id))
      .map((id) => services.find((s) => s.id === id))
      .filter((s): s is Service => !!s)
    const starts = sequentialStartTimes(base, items.map((s) => effective(s).duration))
    return items.map((svc, i) => ({
      svc,
      startTime: starts[i],
      assignedPro: professionals.find((p) => p.id === (state.resolvedStaff?.[svc.id] ?? state.pro ?? "auto")),
    }))
  })()
```

**Nota (para el revisor):** para el caso encadenado, `juntosItems` da el MISMO `startTime` que daba `chainedOrdered` (mismo `base = addMinutesHM(selectedTime, packDurationMin)`, mismo orden, mismas duraciones) — no cambia el horario recién arreglado. Se elimina `isMultiResolved` porque ya no se usa (ver Steps 2-4).

- [ ] **Step 2: "Pack y tratamientos" → sólo nombre + precio**

Reemplazar el `<div className="summary__value">` de esa fila (~líneas 2620-2650):

```tsx
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {pack && (
              <div style={{ marginBottom: services.length > 0 ? 8 : 0 }}>
                {pack.pack.name} · {pack.pack.sessions} sesiones
                {pack.pack.pricingMode === "per_zone" && packZones.length > 0 && (
                  <small>{packZones.map((z) => z.name).join(", ")}</small>
                )}
                <small>{packPro}</small>
              </div>
            )}
            {services.length > 0 && (
              isMultiResolved ? (
                orderedItems.map(({ svc, assignedPro, startTime }) => (
                  <div key={svc.id} style={{ marginBottom: 8 }}>
                    {svc.name}
                    <small>
                      {startTime}hs · {fmtDuration(effective(svc).duration)} · {fmtPrice(effective(svc).price)}
                      {assignedPro ? ` · ${assignedPro.name}` : ""}
                    </small>
                  </div>
                ))
              ) : (
                services.map((s, i) => (
                  <div key={s.id} style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}>
                    {s.name}
                    <small>{fmtDuration(effective(s).duration)} · {fmtPrice(effective(s).price)}</small>
                  </div>
                ))
              )
            )}
          </div>
```

por:

```tsx
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {pack && (
              <div style={{ marginBottom: services.length > 0 ? 8 : 0 }}>
                {pack.pack.name} · {pack.pack.sessions} sesiones
                {pack.pack.pricingMode === "per_zone" && packZones.length > 0 && (
                  <small>{packZones.map((z) => z.name).join(", ")}</small>
                )}
                <small>{fmtPrice(packTotal)}</small>
              </div>
            )}
            {services.map((s, i) => (
              <div key={s.id} style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}>
                {s.name}
                <small>{fmtPrice(effective(s).price)}</small>
              </div>
            ))}
          </div>
```

- [ ] **Step 3: "Cuándo" → agregar la profesional a cada turno**

Reemplazar el `<div className="summary__value">` de la fila "Cuándo" (~líneas 2654-2741). El bloque actual:

```tsx
          <div className="summary__value" style={separados ? { flex: 1, marginLeft: 16 } : undefined}>
            {chainPackFirst ? (
              // UNA sola secuencia: 1ª sesión del pack en T, los servicios
              // sueltos pegados desde T + D_pack (el MISMO arranque que pay()
              // reserva), y debajo las sesiones 2..N del pack (agendadas o
              // "a agendar después"). Antes se mostraban en dos bloques y los
              // servicios arrancaban en T → parecían encimados con la sesión 1.
              <div>
                <div style={{ marginBottom: chainedOrdered.length > 0 ? 6 : 0 }}>
                  <strong>Sesión 1 · {pack!.pack.name}</strong>
                  <small>
                    {dow} {dateObj && dateObj.getDate()} de{" "}
                    {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()} · {displayTime}hs · {fmtDuration(packDurationMin)}
                  </small>
                </div>
                {chainedOrdered.map(({ svc, startTime }, i) => (
                  <div key={svc.id} style={{ marginBottom: i < chainedOrdered.length - 1 ? 6 : 0 }}>
                    {svc.name}
                    <small>{startTime}hs · {fmtDuration(effective(svc).duration)}</small>
                  </div>
                ))}
                {packSlotsForDisplay.slice(1).map((iso, i) => {
                  const parts = arPartsFromUtc(new Date(iso))
                  const d = parseYmd(parts.dateStr)
                  const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                  return (
                    <div key={iso} style={{ marginTop: 6 }}>
                      <strong>Sesión {i + 2}</strong>
                      <small>
                        {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)}
                      </small>
                    </div>
                  )
                })}
                {pack!.pack.sessions > packSlotsForDisplay.length && (
                  <small style={{ display: "block", marginTop: 6 }}>
                    {`${pack!.pack.sessions - packSlotsForDisplay.length} sesión${pack!.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} del pack a agendar después`}
                  </small>
                )}
              </div>
            ) : (
              <>
                {pack && (
                  <div style={{ marginBottom: services.length > 0 ? 10 : 0 }}>
                    {packSlotsForDisplay.map((iso, i) => {
                      const parts = arPartsFromUtc(new Date(iso))
                      const d = parseYmd(parts.dateStr)
                      const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                      return (
                        <div key={iso} style={{ marginBottom: i < packSlotsForDisplay.length - 1 ? 6 : 0 }}>
                          <strong>Sesión {i + 1}</strong>
                          <small>
                            {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)}
                          </small>
                        </div>
                      )
                    })}
                    {pack.pack.sessions > packSlotsForDisplay.length && (
                      <small>
                        {`${pack.pack.sessions - packSlotsForDisplay.length} sesión${pack.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} a agendar después`}
                      </small>
                    )}
                  </div>
                )}
                {services.length > 0 && (
                  separados ? (
                    services.map((s) => {
                      const iso = state.serviceSlots?.[s.id]
                      return (
                        <div key={s.id} className="breakdown__row">
                          <span>{s.name}</span>
                          <span>{iso ? fmtSlotAR(iso) : "—"}</span>
                        </div>
                      )
                    })
                  ) : (
                    <div>
                      {dow} {dateObj && dateObj.getDate()} de{" "}
                      {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
                      <small>
                        {displayTime}hs · {fmtDuration(servicesTotalMin)}
                      </small>
                    </div>
                  )
                )}
              </>
            )}
          </div>
```

pasa a (los cambios: `chainedOrdered` → `juntosItems`; se agrega `· {packPro}` a las líneas de sesión del pack; se agrega `· {assignedPro?.name ?? packPro}` a las líneas de servicio juntos; el caso juntos-no-encadenado deja de colapsar y desglosa por servicio con `juntosItems`; separados agrega duración + profesional por servicio):

```tsx
          <div className="summary__value" style={separados ? { flex: 1, marginLeft: 16 } : undefined}>
            {chainPackFirst ? (
              // UNA sola secuencia: 1ª sesión del pack en T, los servicios
              // sueltos pegados desde T + D_pack (el MISMO arranque que pay()
              // reserva), y debajo las sesiones 2..N del pack (agendadas o
              // "a agendar después").
              <div>
                <div style={{ marginBottom: juntosItems.length > 0 ? 6 : 0 }}>
                  <strong>Sesión 1 · {pack!.pack.name}</strong>
                  <small>
                    {dow} {dateObj && dateObj.getDate()} de{" "}
                    {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()} · {displayTime}hs · {fmtDuration(packDurationMin)} · {packPro}
                  </small>
                </div>
                {juntosItems.map(({ svc, startTime, assignedPro }, i) => (
                  <div key={svc.id} style={{ marginBottom: i < juntosItems.length - 1 ? 6 : 0 }}>
                    {svc.name}
                    <small>{startTime}hs · {fmtDuration(effective(svc).duration)} · {assignedPro?.name ?? packPro}</small>
                  </div>
                ))}
                {packSlotsForDisplay.slice(1).map((iso, i) => {
                  const parts = arPartsFromUtc(new Date(iso))
                  const d = parseYmd(parts.dateStr)
                  const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                  return (
                    <div key={iso} style={{ marginTop: 6 }}>
                      <strong>Sesión {i + 2}</strong>
                      <small>
                        {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)} · {packPro}
                      </small>
                    </div>
                  )
                })}
                {pack!.pack.sessions > packSlotsForDisplay.length && (
                  <small style={{ display: "block", marginTop: 6 }}>
                    {`${pack!.pack.sessions - packSlotsForDisplay.length} sesión${pack!.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} del pack a agendar después`}
                  </small>
                )}
              </div>
            ) : (
              <>
                {pack && (
                  <div style={{ marginBottom: services.length > 0 ? 10 : 0 }}>
                    {packSlotsForDisplay.map((iso, i) => {
                      const parts = arPartsFromUtc(new Date(iso))
                      const d = parseYmd(parts.dateStr)
                      const sessionDow = DOW_NAMES[(d.getDay() + 6) % 7]
                      return (
                        <div key={iso} style={{ marginBottom: i < packSlotsForDisplay.length - 1 ? 6 : 0 }}>
                          <strong>Sesión {i + 1}</strong>
                          <small>
                            {sessionDow} {d.getDate()} de {MONTH_NAMES[d.getMonth()].toLowerCase()} · {parts.timeStr}hs · {fmtDuration(packDurationMin)} · {packPro}
                          </small>
                        </div>
                      )
                    })}
                    {pack.pack.sessions > packSlotsForDisplay.length && (
                      <small>
                        {`${pack.pack.sessions - packSlotsForDisplay.length} sesión${pack.pack.sessions - packSlotsForDisplay.length > 1 ? "es" : ""} a agendar después`}
                      </small>
                    )}
                  </div>
                )}
                {services.length > 0 && (
                  separados ? (
                    services.map((s) => {
                      const iso = state.serviceSlots?.[s.id]
                      const staffId = state.serviceStaff?.[s.id] ?? "auto"
                      const svcPro = professionals.find((p) => p.id === staffId) ?? professionals[0]
                      return (
                        <div key={s.id} style={{ marginBottom: 8 }}>
                          {s.name}
                          <small>
                            {iso ? fmtSlotAR(iso) : "—"} · {fmtDuration(effective(s).duration)} · {svcPro.name}
                          </small>
                        </div>
                      )
                    })
                  ) : (
                    <div>
                      <div style={{ marginBottom: 6 }}>
                        <strong>
                          {dow} {dateObj && dateObj.getDate()} de{" "}
                          {dateObj && MONTH_NAMES[dateObj.getMonth()].toLowerCase()}
                        </strong>
                      </div>
                      {juntosItems.map(({ svc, startTime, assignedPro }, i) => (
                        <div key={svc.id} style={{ marginBottom: i < juntosItems.length - 1 ? 6 : 0 }}>
                          {svc.name}
                          <small>{startTime}hs · {fmtDuration(effective(svc).duration)} · {assignedPro?.name ?? "Asignación automática"}</small>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </>
            )}
          </div>
```

- [ ] **Step 4: Eliminar la fila suelta "Profesional"**

Borrar por completo el bloque de la fila "Profesional" (~líneas 2743-2767), que hoy es:

```tsx
        {separados ? (
        <div className="summary__row">
          <span className="summary__label">Profesional</span>
          <div className="summary__value" style={{ flex: 1, marginLeft: 16 }}>
            {services.map((s, i) => {
              const staffId = state.serviceStaff?.[s.id] ?? "auto"
              const assignedPro = professionals.find((p) => p.id === staffId) ?? professionals[0]
              return (
                <div key={s.id} style={{ marginBottom: i < services.length - 1 ? 6 : 0 }}>
                  {s.name}
                  <small>{assignedPro.name}</small>
                </div>
              )
            })}
          </div>
        </div>
        ) : !isMultiResolved && (
        <div className="summary__row">
          <span className="summary__label">Profesional</span>
          <div className="summary__value" style={{ fontSize: 14 }}>
            {pro.name}
            <small>{pro.role}</small>
          </div>
        </div>
        )}
```

Queda: entre la fila "Cuándo" (que cierra con `</div>` del `summary__row`) y la fila "Dónde" NO hay nada — la fila "Dónde" (`<div className="summary__row"><span className="summary__label">Dónde</span>...`) pasa a ir inmediatamente después de la fila "Cuándo".

**Nota (para el implementador):** este cambio deja **tres** locales sin usar — hay que borrar sus declaraciones también:
- `const pro = professionals.find((p) => p.id === (state.pro || "auto")) ?? professionals[0]` (~línea 2419) — sólo se usaba en la fila "Profesional" borrada. (OJO: NO tocar `state.pro`, que sigue usándose en `proHint: state.pro || "auto"` del payload.)
- `const isMultiResolved = services.length > 1 && !!state.serviceOrder && !!state.resolvedStaff` (~línea 2428) — sólo se usaba en `orderedItems`/"Qué"/"Profesional", todos reescritos.
- `const servicesTotalMin = combo ? combo.duration : services.reduce(...)` (~línea 2357) — su ÚNICO uso era la línea colapsada de "Cuándo" (`fmtDuration(servicesTotalMin)`), que el Step 3 reemplaza por el desglose por servicio.

Confirmá con Grep que ninguno tiene otras referencias antes de borrarlo (por ejemplo `state.pro` en el payload NO cuenta como uso de `pro`).

- [ ] **Step 5: Typecheck, lint y tests**

Run: `npx tsc --noEmit`
Expected: sin errores. (Ya se borraron `pro`/`isMultiResolved`/`servicesTotalMin` en el Step 4; si aparece algún otro "declared but never used", resolverlo igual: borrar sólo la declaración sin referencias.)

Run: `npm run lint`
Expected: sin errores NUEVOS en `screens.tsx` (reportar el delta).

Run: `npm test`
Expected: toda la suite verde (ningún test toca este archivo).

- [ ] **Step 6: Verificación manual (leer el diff y trazar cada caso)**

1. **Encadenado (pack + 2 servicios, juntos):** "Pack y tratamientos" = pack (nombre·sesiones·zonas + precio del pack) + cada servicio (nombre + precio), SIN horas/duración/profesional. "Cuándo" = Sesión 1 (fecha·hora·duración·packPro) + cada servicio (hora·duración·profesional) + sesiones 2..N + "a agendar después". El 1er servicio arranca en T + D_pack (no cambió).
2. **Servicios solos, juntos (2+):** "Qué" = nombre + precio. "Cuándo" = la fecha una vez + cada servicio hora·duración·profesional (antes colapsaba en una línea).
3. **Un solo servicio:** "Qué" = nombre + precio. "Cuándo" = fecha + ese servicio hora·duración·profesional (de `resolvedStaff` o "Asignación automática").
4. **Separados:** "Qué" = cada servicio nombre + precio. "Cuándo" = cada servicio fecha·hora · duración · profesional.
5. **Pack solo:** "Qué" = pack nombre·sesiones·zonas + precio. "Cuándo" = cada sesión agendada fecha·hora·duración·packPro + "a agendar después".
6. **Combo:** "Qué" = cada servicio del combo nombre + su precio (individual, como hoy). "Cuándo" = fecha + cada servicio hora·duración·profesional.
7. **En TODOS:** ya NO existe la fila suelta "Profesional"; "Dónde" va justo después de "Cuándo". Las filas "Total"/"Seña"/canje quedan intactas.

- [ ] **Step 7: Commit**

```bash
git add src/app/reserva/screens.tsx
git commit -m "feat(reserva): resumen — Qué (nombre+precio) y Cuándo (fecha/hora/duración+profesional)"
```

---

## Self-Review

**1. Spec coverage:**
- "Qué" = nombre + precio (pack con precio, sin packPro; servicios sin hora/duración/pro) → Step 2. ✓
- "Cuándo" = fecha·hora·duración·profesional en todos los casos → Step 3. ✓
- Fila "Profesional" eliminada → Step 4. ✓
- `orderedItems`+`chainedOrdered` unificados en `juntosItems` sin cambiar el horario encadenado → Step 1 + nota. ✓
- Fuente de cada profesional sin cambios (packPro / resolvedStaff→pro / serviceStaff) → Steps 1 y 3. ✓
- Presentacional; no toca reserva/plata/payload → constraint + sólo se edita el bloque del resumen. ✓
- Combo muestra precio individual por servicio (como hoy) → Step 2 (services.map) + verificación 6. ✓

**2. Placeholder scan:** sin TODO/TBD; todo el código está completo.

**3. Type consistency:** `juntosItems` devuelve `{ svc, startTime, assignedPro }` y se consume con esos nombres en Step 3. `packTotal`, `packPro`, `effective`, `fmtPrice`, `fmtDuration`, `fmtSlotAR` usados con las firmas existentes. Se retiran `orderedItems`/`chainedOrdered`/`isMultiResolved`/`pro` (Step 4 nota) para no dejar símbolos sin usar.
