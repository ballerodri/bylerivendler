# Diseño — Que el turno guarde QUIÉN lo hace

**Fecha:** 2026-07-14
**Estado:** Aprobado (pendiente de plan de implementación)

## El problema (pregunta textual de la usuaria)

> *"el pack que no me marca profesional, ¿cómo sé quién lo hace?"*

**No lo sabe, y tampoco lo puede arreglar a mano.** Cuando la clienta deja **"Auto"** (el botón que viene marcado por defecto), el turno se guarda con `staff_id = NULL`:

- `actions.ts:246` — `const packStaffId = packHint !== "auto" ? packHint : null` (sesiones del pack)
- `actions.ts:420` — ídem para los servicios en modo "cada uno en su fecha" (separados)
- `admin/actions.ts` — `schedulePackSession` (las sesiones que agenda el salón) **siempre** escribe `staff_id: NULL`

Y en el admin **no existe ninguna acción que escriba `staff_id` en un turno ya creado** (verificado por grep). O sea: queda en blanco **para siempre**.

El modo **"el mismo día, uno después del otro"** (juntos) **no** tiene el problema: ahí el buscador secuencial resuelve quién hace cada servicio y lo devuelve en `resolvedStaff`.

## El daño colateral (peor que el síntoma)

Un turno **sin profesional es medio invisible** para los chequeos de superposición: el solver no sabe a quién ocupa. Hubo que meter lógica compensatoria en `assignableStaff` que **deduce** el dueño de una "pata anónima" a partir de su servicio (*"esta sesión anónima tiene que ser de Leri, porque es la única que hace faciales"*), y esa deducción **no es completa** cuando varias profesionales podrían hacerla.

**Si el turno guarda quién lo hace, el problema desaparece de raíz.**

## La clave técnica

`assignableStaff(candidates, overlappingLegs, staffMap, activePros)` (`src/lib/servicios/availability.ts`) **ya devuelve la LISTA** de quiénes pueden tomar ese horario. `fetchDayAvailability` sólo pregunta `.length > 0` y **tira la lista**.

Entonces: **quedarse con la lista y elegir**. La elección usa **literalmente la misma función** que decidió que el horario estaba libre → **no pueden contradecirse**. (Esa contradicción — el servidor siendo más estricto que el buscador — ya rompió esta app dos veces.)

## Decisiones (acordadas con la usuaria)

1. **"Auto" se queda.** Es lo que le muestra **más horarios** a la clienta: ve *todos* los horarios donde haya **alguien** libre. Si eligiera una profesional puntual vería **sólo los de esa persona**, y podría ver *"no hay horarios"* un día en que otra estaba libre. **Sacarlo costaría reservas.**
2. **Al reservar, el servidor elige y GUARDA.** Cualquier turno que quede en "Auto" se resuelve a una profesional que **haga ese servicio** y esté **realmente libre** a esa hora.
3. **Desempate (varias libres): la que tenga menos turnos ese día.** Reparte la carga, que es lo que haría el salón a mano.
4. **Continuidad dentro de la misma compra:** si una sesión del pack ya se resolvió a Marina y Marina también puede tomar la siguiente, **se prefiere a Marina**. Pero **no se fuerza**: obligar a la misma persona en las 4 sesiones podría rechazar horarios que hoy se aceptan, y eso sería perder reservas.
5. **El salón la puede cambiar**, con un botón en el turno.

## Alcance

### Se resuelve y se guarda en:
- Las **sesiones del pack** (reserva online).
- Los servicios en modo **"cada uno en su fecha"** (separados).
- Las sesiones de pack que **agenda el salón** desde la ficha de la clienta (`schedulePackSession`).
- Defensivo: cualquier **pata** de un turno "juntos" que llegara sin profesional.

### No hace falta tocar:
- **"Juntos"** (el camino de ingresos principal): el buscador secuencial **ya** resuelve y guarda.
- **`createAdminBooking`**: el formulario de nueva reserva del admin llama a `fetchSequentialAvailability`, que **ya** devuelve `resolvedStaff`.

## Cambiar la profesional (admin)

Botón **"Cambiar profesional"** en el turno.

**Se cambia POR SERVICIO**, no por turno: un turno "juntos" puede tener **dos profesionales distintas** (el facial de Leri + el masaje de Roman). El dato vive por servicio (`appointment_services.staff_id`) y ésa es la verdad que lee el solver.

Acción `reasignarProfesional(appointmentId, serviceId, staffId)`:
- `requireStaff()`.
- La profesional nueva tiene que estar **activa** y ser **profesional**.
- ⚠️ **Se rechaza si ya está ocupada en esa ventana** (sus propios turnos, sus horas bloqueadas), **excluyendo este mismo turno**. Sin este chequeo, el botón sería una máquina de **pisar turnos**.
- **NO se exige `staff_services`**: el admin es el escape del salón (puede necesitar que Marina cubra a Roman aunque no esté cargada para ese servicio). Pero la pantalla **marca cuáles sí lo hacen**, para que la decisión sea informada.
- Escribe `appointment_services.staff_id` de **esa** pata, y deja `appointments.staff_id` = la profesional de la **primera pata en el tiempo** (que es la convención que ya usa `createBooking` con `mainStaffId`).

## Modelo de datos

**Ninguna migración.** `appointments.staff_id` y `appointment_services.staff_id` ya existen; lo único que cambia es que **dejan de quedar en NULL**.

## Validaciones

| Regla | Mensaje |
|---|---|
| Ninguna profesional puede tomar ese horario | El horario **no se ofrece** (ya es así hoy: `fetchDayAvailability` lo filtra) |
| La profesional nueva no está activa | "Esa profesional no está activa." |
| La profesional nueva ya tiene un turno en esa ventana | "*(Nombre)* ya tiene un turno a esa hora." → no se cambia nada |
| La profesional nueva no trabaja a esa hora | "*(Nombre)* no atiende a esa hora." → no se cambia nada |

## Riesgos

- **Toca el corazón del buscador** (`fetchDayAvailability`), que es el camino de ingresos principal. La regla es no negociable: **la resolución tiene que usar la MISMA función que decide la disponibilidad**, o el servidor podría asignar a alguien que el buscador considera ocupada (doble reserva) o rechazar un horario que acaba de ofrecer (reserva perdida). Las dos cosas ya pasaron en esta app.
- **El botón "Cambiar profesional" es una máquina de pisar turnos** si no chequea disponibilidad. El chequeo es obligatorio, no opcional.
- **La lógica compensatoria de las "patas anónimas"** (`assignableStaff`) **se conserva**: van a seguir existiendo turnos sin profesional (los que el admin cargue a mano, y los que ya existieran). No se borra nada; simplemente **deja de crearse el problema**.

## Fuera de alcance

- Forzar la **misma profesional** en todas las sesiones de un pack (rechazaría horarios válidos → menos reservas).
- Que la **clienta** elija profesional **por sesión** del pack (hoy elige una para el pack entero).
- Reasignar **en masa** (ej: "pasale todos los turnos de Roman del martes a Marina").
