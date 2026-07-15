# Diseño — Resumen de confirmación: "Qué" (nombre + precio) y "Cuándo" (fecha/hora/duración + profesional)

**Fecha:** 2026-07-15
**Estado:** Aprobado (pendiente de plan de implementación)

## El problema (pedido de la usuaria)

En la confirmación ("Casi listo"), el bloque **"Pack y tratamientos"** hoy mezcla nombre + horario + duración + precio + profesional, y el bloque **"Cuándo"** repite el horario y la duración; encima abajo hay a veces un bloque suelto **"Profesional"**. La misma info aparece dos veces y queda cargado. La usuaria quiere separarlo limpio:

- **"Pack y tratamientos"** = sólo **nombre y precio**. Nada de profesional, horario ni duración.
- **"Cuándo"** = **fecha, hora, duración y profesional** de cada turno.

## Decisión (acordada con la usuaria)

Reorganizar el resumen con esa regla, para **todos** los casos (pack solo, servicios solos, "cada uno en su fecha", combo, y la mezcla encadenada). El bloque suelto **"Profesional" desaparece** — la profesional pasa a vivir dentro de "Cuándo", al lado de cada turno.

## Cómo queda (ejemplo de la usuaria: pack + 2 servicios, encadenado)

**PACK Y TRATAMIENTOS** (nombre + precio):
```
Vela Slim Plus · 1 Zona · 4 sesiones
Abdomen
$XXX.XXX                          ← precio del pack (hoy NO se muestra)

Masaje relajante        $45.000
Reflexología            $40.000
```

**CUÁNDO** (fecha · hora · duración · profesional):
```
Sesión 1 · Vela Slim Plus · 1 Zona
Jueves 16 de julio · 14:00hs · 20 min · Leri Vendler

Masaje relajante     14:20hs · 1h · Roman Otero
Reflexología         15:20hs · 1h · Roman Otero

3 sesiones del pack a agendar después
```

## La regla por bloque (todos los casos)

### "Pack y tratamientos" — sólo nombre + precio
- **Pack:** `{nombre} · {N} sesiones` (+ zonas, ej. "Abdomen", como hoy) + **el precio del pack** (`packTotal`). **Se saca la profesional** (`packPro`) de acá.
- **Cada servicio suelto / de combo:** `{nombre}` + **su precio** (`effective(s).price`). **Se sacan** el horario, la duración y la profesional. (El combo sigue mostrando sus servicios con su precio individual, igual que hoy — no se toca esa cuenta.)

### "Cuándo" — fecha · hora · duración · profesional
- **Encadenado (mezcla, juntos):** Sesión 1 con `fecha · hora · duración · {packPro}`; después cada servicio con `hora · duración · {su profesional}`; después las sesiones 2..N agendadas con `fecha · hora · duración · {packPro}`; y "N sesiones del pack a agendar después".
- **Sesiones del pack (no encadenado):** cada sesión agendada con `fecha · hora · duración · {packPro}` + "a agendar después".
- **Servicios "juntos" (sin encadenar):** la **fecha** de la visita una vez arriba, y cada servicio con `hora · duración · {su profesional}` (hoy este caso colapsa todo en una sola línea sin desglosar; pasa a desglosar por servicio, con la profesional).
- **"Cada uno en su fecha" (separados):** cada servicio con `fecha y hora · duración · {su profesional}`.

### "Profesional" (bloque suelto) — se elimina
Ya no hay una fila "Profesional" aparte: la profesional de cada turno se muestra en "Cuándo". (Se sacan las dos ramas actuales: la de "separados" —una por servicio— y la de un solo profesional.)

## De dónde sale cada profesional (misma fuente que hoy)
- **Sesiones del pack:** `packPro` (campo propio `state.packPro`, "Asignación automática" si es "auto").
- **Servicios en juntos/encadenado/combo:** `state.resolvedStaff[id]` (lo que resolvió el buscador); si un servicio no tiene resuelto (ej. un solo servicio), cae a `state.pro` → "Asignación automática".
- **Servicios en separados:** `state.serviceStaff[id]`.

## Simplificación técnica
Hoy conviven `orderedItems` (sólo con 2+ servicios, con hora + profesional, usado en "Qué") y `chainedOrdered` (encadenado, sin profesional, usado en "Cuándo"). Como "Qué" deja de mostrar horas, **se unifican en UNA sola** lista `juntosItems` — los servicios sueltos en modo "juntos" (encadenado o no, 1 o más), cada uno con `{svc, startTime, assignedPro}`, calculada con la MISMA fuente pura (`sequentialStartTimes` desde `T` o `T + D_pack`). Se usa **sólo en "Cuándo"**.

## Fuera de alcance
- **La reserva, el payload, `createBooking`, la plata, `pay()`:** no se tocan. Son **los mismos valores** (precios, horas, duraciones, profesionales) que ya se calculan, sólo **reubicados** en el resumen.
- **Los horarios que se muestran siguen coincidiendo con lo que se reserva** (`startsAt`): la regla de `T` / `T + D_pack` no cambia (ya vive en `sequentialStartTimes`/`addMinutesHM`).
- **Las filas "Total", "Seña/Pagás ahora", "Dónde", el canje de puntos:** no se tocan.
- **El precio del combo:** sigue mostrándose por servicio (individual), como hoy; el bundle price no se agrega (otro tema).

## Riesgos
- **Es la confirmación del camino de ingresos, sin tests.** Toca varias ramas que conviven (pack solo, servicios solos juntos/separados, combo, mezcla encadenada, un solo servicio). Cada una tiene que renderizar bien. Se verifica leyendo el diff y con prueba manual.
- **Nada de lo mostrado cambia de valor** — sólo de lugar. La revisión tiene que trazar que cada dato (precio en "Qué"; hora/duración/profesional en "Cuándo") sale de la MISMA fuente que hoy, y que el horario mostrado sigue == el reservado en el caso encadenado.
- **Unificar `orderedItems`/`chainedOrdered` en `juntosItems`** no puede cambiar los horarios del caso encadenado (que recién se arreglaron): `juntosItems` tiene que dar, para el encadenado, exactamente lo que daba `chainedOrdered` (arranque `T + D_pack`), y para el no-encadenado, arranque `T`.
