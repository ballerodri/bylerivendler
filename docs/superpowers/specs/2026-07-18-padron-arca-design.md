# Diseño — Traer los datos de la clienta desde ARCA (Padrón A13)

**Fecha:** 2026-07-18
**Estado:** Aprobado por la usuaria (servicio A13 ya autorizado en ARCA, formulario BL2937166254472)

## El pedido

> "cuando cargamos facturas con consumidor final, en arca cuando pongo el cuit ya me trae los datos de la persona acá no"

Hoy la app sólo usa el servicio de emitir comprobantes (`wsfe`): toma el DNI de la ficha de la clienta y, si no hay, factura como Consumidor Final. Nunca le pregunta a ARCA quién es esa persona.

## La regla

Un botón **"Buscar en ARCA"** al lado de un campo **DNI o CUIT**, en DOS lugares (mismo componente):
1. **Al facturar un turno** (`/admin/turnos/[id]/facturar`) — precargado con el DNI de la ficha.
2. **En la ficha de la clienta** — para cargar el dato al dar de alta y no buscarlo cada vez.

Trae **nombre, CUIT y condición frente al IVA**, los muestra, y ofrece guardarlos en la ficha. Con esos datos la factura sale correctamente identificada (CUIT + condición real) en vez de "Consumidor Final" a ciegas.

Acepta **DNI (8 dígitos) o CUIT/CUIL (11)**: el A13 resuelve los dos (`getIdPersonaListByDocumento` para el DNI, `getPersona` para el CUIT).

## Arquitectura

- **`src/lib/arca/padron.ts`** (nuevo): `consultarPadron(doc)`. Usa `getAuth("ws_sr_padron_a13")` — el ticket por servicio YA está soportado (`auth.ts` recibe el servicio y el `token-store` está indexado por servicio+entorno). SOAP con el `createArcaSoapClient` que ya existe.
- **URLs** (nuevas en `config.ts`, mismo patrón que `wsaa`/`wsfe`):
  - producción: `https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL`
  - homologación: `https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL`
- **Server action** en el admin (con `requireStaff()`), nunca llamada desde el público.
- **Componente cliente compartido** con el campo + botón + resultado, usado en las dos pantallas.
- **Sin migración.** `clients.dni` es `text` y no existe columna `cuit`: se guarda ahí el documento tal cual, y el tipo se DEDUCE del largo — 8 dígitos = DNI (docTipo 96), 11 = CUIT (docTipo 80). Hoy `emitirFacturaTurno` fuerza 96; pasa a deducirlo.
- **La condición frente al IVA no se persiste**: viene de la consulta viva en la pantalla de facturar (que es donde se necesita). Sin consulta, sigue el default de hoy (5 = Consumidor Final).

## Hallazgo: hoy el DNI no se puede cargar

No existe NINGÚN formulario en el admin para escribir `clients.dni`, y la reserva online tampoco lo pide — así que ese campo está vacío para todas las clientas y el tilde "Identificar con su DNI" nunca aparece. El widget en la ficha no es un extra: es **la única forma de cargar el documento**.

## Errores: el entregable que hace esto depurable

No se puede probar desde acá (el certificado de producción vive en Vercel). Por eso los mensajes tienen que distinguir, en castellano y en pantalla:
- **no autorizado** ("El servicio de padrón todavía no está habilitado para este certificado. Puede tardar hasta 24 h desde que lo autorizaste en ARCA.")
- **no encontrado** ("ARCA no tiene a nadie con ese documento.")
- **ARCA caído / timeout** ("ARCA no responde. Probá de nuevo en un rato.")
- **configuración** (falta env/cert)
- El detalle técnico crudo se registra con `console.error` para poder diagnosticar.

## Qué NO cambia

La emisión de comprobantes, los CAE, el QR, el PDF, los mails de factura, la reserva, la agenda. Si la búsqueda falla, facturar sigue funcionando exactamente como hoy (Consumidor Final o DNI de la ficha).

## Riesgos

- **La forma exacta de la respuesta del A13 no está verificada** (no hay forma de llamarlo desde acá). El parseo tiene que ser defensivo: normalizar `persona`/`personaReturn`, apellido+nombre vs razón social, domicilio como objeto o lista. Los helpers puros de parseo se testean con fixtures; la verdad la da la primera prueba real de la usuaria.
- La autorización de ARCA puede tardar en tomar efecto: un "no autorizado" al principio NO significa código roto.
