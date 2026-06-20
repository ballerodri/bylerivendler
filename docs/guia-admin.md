# Guía del panel de administración — By Leri Vendler

Bienvenida/o al panel. Esta guía explica, sección por sección, qué hace cada parte y cómo se usa
en el día a día. No necesitás saber nada técnico: es todo apuntar y hacer clic.

---

## 1. Cómo entrar

- Entrá a **`/login`** del sitio e iniciá sesión con tu cuenta.
- El panel está en **`/admin`**.
- Hay tres tipos de acceso (roles):
  - **Admin:** ve y gestiona todo.
  - **Recepción:** ve y gestiona casi todo (turnos, clientas, catálogo, facturación, etc.).
  - **Profesional:** vista reducida — solo **sus** turnos, sus **estadísticas** y su **disponibilidad**.

El menú está a la izquierda. Abajo de todo aparece tu nombre y un botón para **cerrar sesión**.

---

## 2. El día a día

### 🏠 Hoy
La pantalla de inicio. Muestra los **turnos de hoy** de un vistazo: a qué hora, quién, qué
tratamiento y en qué estado. Es tu tablero para arrancar la jornada.

### 📅 Turnos
La **agenda completa**. Podés filtrar por **estado** (pendientes, confirmados, etc.) y por
**rango** (próximos, pasados, todos).

Cada turno avanza por estos **estados**, con botones según corresponda:
1. **Pendiente** → **Confirmar** (o Cancelar)
2. **Confirmado** → **Iniciar** (o "No vino" / Cancelar)
3. **En curso** → **Completar** (o Cancelar)
4. **Completado** ✅

Otras acciones en cada turno:
- **Reagendar** (para pendientes/confirmados): cambia fecha/hora y **avisa por email** a la clienta.
- **WhatsApp**: botón para mandarle un recordatorio ya escrito.
- **Facturar** (en turnos completados): ver la sección Facturación.
- **Eliminar**: borra el turno (pide confirmación).
- Etiquetas: **"Facturada"** si ya le hiciste factura, y la opción de **descontar un pack** al completar (ver Packs).

> 💡 Al **Completar** un turno, la clienta suma puntos del **Programa Cerca** (fidelidad).

### ➕ Nueva reserva
Para **crear un turno a mano** en nombre de una clienta (por teléfono, WhatsApp o presencial),
sin que ella tenga que reservar online.

---

## 3. Clientas

### 👥 Clientas (listado)
Todas las clientas. Hacé clic en una para abrir su **ficha**.

### Ficha de la clienta
Reúne todo de esa persona:
- **Datos personales** (email, teléfono, cumpleaños, notas internas) y sus **puntos del Programa Cerca**.
- **Alertas** arriba si la ficha clínica tiene algo importante (embarazo, medicación, alergias, etc.).
- **Ficha clínica** (versionada): alergias, medicación, tipo de piel, contraindicaciones, etc.
- **Fotos antes / después**: subís y gestionás imágenes del tratamiento.
- **Packs**: los packs que compró, con su saldo **"usó X / quedan Y"**, y el botón **"Vender pack"** (ver Packs).
- **Historial de turnos** de la clienta.

---

## 4. Catálogo (qué ofrecés y a qué precio)

### 💅 Servicios
El catálogo de prestaciones. Por cada servicio editás **precio, duración** y los **puntos** del
Programa Cerca. Los cambios se reflejan **al instante** en la reserva online. Podés marcar un
servicio como visible/no visible al público y activarlo/desactivarlo.

### 🎁 Combos
Paquetes de **servicios distintos** juntos a un precio especial (ej. facial + masaje). Los combos
**activos** aparecen en la reserva online. Creás uno eligiendo 2 o más servicios y poniendo el
precio del combo (te muestra el ahorro vs. comprarlos por separado).

### 📦 Packs
**Varias sesiones del mismo servicio** a precio especial (ej. "Depilación piernas — 6 sesiones").
- **Crear/editar pack:** elegís el servicio, la cantidad de sesiones, cada cuántos días se hacen y el precio.
- **Activar** un pack lo muestra en la **vitrina pública** `/packs` y en el **banner** de la página de reserva.
- **Vender un pack** se hace desde la **ficha de la clienta** → "Vender pack". Opcionalmente marcás
  **"Facturar ahora"** y emite la factura + la manda por email.
- **Seguimiento de sesiones:** cuando **Completás** un turno de ese servicio para una clienta con un
  pack activo, te pregunta **"¿Descontar del pack?"**. Si decís que sí, baja una sesión del saldo.
  - Para **corregir un descuento equivocado**, **eliminá** ese turno: la sesión vuelve al pack.

---

## 5. Facturación (ARCA / AFIP)

Emite **Factura C** (Monotributo) de verdad, pidiendo el CAE a ARCA, y genera el **PDF oficial** con QR.

- **Factura manual** (`Facturación` → "+ Factura manual"): para señas, ventas sueltas o un servicio
  puntual. Podés **elegir servicios/packs** (arma el concepto y suma el monto solo) o **escribir** el
  concepto y el monto a mano. Elegís el receptor (**Consumidor Final** por defecto, o con DNI/CUIT) y,
  opcional, el email para enviar el PDF.
- **Facturar un turno:** en un turno **completado**, botón **"Facturar"** → pantalla de confirmación
  con la clienta, los servicios y el total → **Emitir**.
- **Historial:** lista de facturas. Por cada una podés **Descargar el PDF** y **Reenviar el email**.
  Las de prueba llevan la etiqueta **"PRUEBA"** (entorno de homologación).

> ⚠️ **Importante:** revisá monto y receptor antes de "Emitir" — una factura emitida es real ante ARCA.
> Por eso está la pantalla de confirmación.

---

## 6. Gestión

### 🧑‍🔬 Personal
Sumás **profesionales y recepcionistas**, que reciben acceso al panel. Por cada una podés definir su
**disponibilidad**, **comisiones** y el **color** con que aparece en el calendario.

### 🕐 Horarios
Definís **qué días atendés y en qué franjas**. Los cambios se reflejan **de inmediato** en el flujo
de reserva online (qué horarios ve la clienta).

### 📈 Estadísticas
Métricas del negocio (turnos, ingresos, etc.). Las profesionales ven solo lo suyo.

### ⏳ Lista de espera
Clientas que **se anotaron cuando no había turnos disponibles**. Útil para ofrecerles un lugar
cuando se libera.

### ⚙️ Configuración
Conexión con **Google Calendar** (para que los turnos se sincronicen con tu calendario) y opciones
de mantenimiento.

---

## 7. Flujos típicos (resumen rápido)

| Quiero… | Voy a… |
|---|---|
| Ver lo de hoy | **Hoy** |
| Agendar a una clienta | **Nueva reserva** |
| Confirmar / completar un turno | **Turnos** (botones del turno) |
| Cambiar fecha de un turno | **Turnos → Reagendar** |
| Cargar/ver datos o ficha clínica | **Clientas → (la clienta)** |
| Cambiar un precio | **Servicios** |
| Armar una promo de varias sesiones | **Packs** (crear + activar) |
| Venderle un pack a una clienta | **Clientas → (la clienta) → Vender pack** |
| Hacer una factura | **Facturación → Factura manual**, o **Turnos → Facturar** |
| Reenviar/descargar una factura | **Facturación** (historial) |
| Sumar una profesional | **Personal** |
| Cambiar días/horarios de atención | **Horarios** |

---

## 8. Buenas prácticas

- **Completá** los turnos cuando suceden: así suman puntos del Programa Cerca y descuentan packs.
- Antes de **Emitir** una factura, revisá el monto y el receptor.
- Para **corregir** un pack mal descontado, eliminá el turno (devuelve la sesión).
- Subí **fotos antes/después** en la ficha para llevar el seguimiento del tratamiento.

¿Dudas? Cualquier cosa que no aparezca acá, preguntá. 🙌
