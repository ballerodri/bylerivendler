# Calendario de Adviento By Leri Vendler — diseño

Fecha: 2026-11-25 · Estado: para aprobación

## Qué es y por qué

Una página pública en `bylerivendler.com/adviento` con 24 casilleros cerrados.
La persona deja su nombre y su celular, elige **un** número y recién ahí se abre
una sorpresa: una de las 24 promociones de diciembre que armó Leri. Una sola por
persona. Al final puede tocar un botón que abre WhatsApp con el mensaje ya
escrito, contándole a Leri qué le tocó.

**Por qué lo quiere Leri:** principalmente para **atraer clientas nuevas**. Las
clientas actuales también pueden jugar. De ahí salen las dos decisiones que
mandan en todo el diseño: no se pide cuenta ni login (eso espantaría a la gente
nueva), y lo que queda guardado es, en los hechos, una lista de contactos nuevos
con el cartel de "nueva" o "ya era clienta".

## Objetivos

- Que cualquiera, sin cuenta, pueda jugar desde el celular en menos de 30
  segundos.
- Que a Leri le llegue el contacto: nombre y celular de cada participante.
- Que Leri vea en el panel quién eligió qué, y si es gente nueva.
- Que la persona pueda escribirle a Leri en un toque, con el premio ya escrito
  en el mensaje.
- Una sola sorpresa por persona, con la trampa razonablemente cara.

## No-objetivos

- **No** reserva turnos ni aplica el descuento sola. La promo se conversa por
  WhatsApp y se carga como siempre. (La página enlaza a `/reserva` igual.)
- **No** valida identidad de verdad (sin código por SMS ni por mail).
- **No** se integra con la facturación ni con el Programa Cerca.
- **No** crea clientas en la tabla `clients`.

## Anti-objetivos (esto sería un fracaso aunque funcione)

- Que la misma persona junte tres premios recargando la página.
- Que el premio se pueda "volver a tirar" hasta que salga el más caro.
- Que a Leri le llegue una clienta diciendo "me tocó el facial a $30.000" y
  ella no tenga cómo comprobarlo.
- Que la página pida tantos datos que la clienta nueva abandone.

## Decisiones ya tomadas (por la usuaria)

1. **La sorpresa es al azar, distinta para cada persona.** El número NO manda:
   es la puerta, el ritual. A dos personas que elijan el 7 les puede tocar
   distinto. Esto, además, hace inútil que se cuenten entre ellas qué les tocó.
2. **Se pide nombre y celular**, nada más.
3. **Botón de WhatsApp** después de la sorpresa, con el mensaje prearmado.
4. **Todo transcurre en diciembre.** El premio se usa del 1 al 31 de diciembre.
5. Va **dentro de la app** (no una página suelta): es la única forma de que
   aparezca en el panel y de que viva en `bylerivendler.com/adviento`.

## Decisiones que tomé yo (corregibles)

- **La llave de "una persona" es el celular normalizado**, no el nombre. El
  proyecto ya tiene `normalizeArPhone` (`src/lib/whatsapp.ts`): `11 3364-3359`,
  `1133643359` y `+54 9 11 3364-3359` terminan todos en `+5491133643359`. Con el
  nombre, "Maria" y "María" serían dos personas distintas; con el teléfono hace
  falta otra línea de celular para jugar dos veces.
- **El sorteo ocurre en el servidor**, en el mismo momento en que se guarda la
  elección. Si se hiciera en el navegador, recargar sería volver a tirar.
- **Se puede elegir del 1 al 24 de diciembre** (es un calendario de adviento) y
  **el premio se usa hasta el 31 de diciembre**. Antes del 1 la página muestra
  una antesala; después del 24 ya no se puede elegir, pero quien ya tiene su
  premio lo sigue viendo.
- **Sorteo parejo**: las 24 promos tienen la misma probabilidad (~4% cada una).
  Se puede ponderar después si Leri ve que regala demasiado de una.
- **Tabla propia**, `advent_picks`. No se tocan `clients` ni `appointments`.
- La página **no se indexa** en Google (`robots: noindex`): es una acción de
  temporada, no contenido del sitio.

## Las 24 promociones (texto de Leri, literal)

El orden de esta lista es sólo su número de identificación interno; NO es lo que
le toca a quien elige ese número.

| # | Promo |
|---|-------|
| 1 | Facial a $30.000. |
| 2 | Venite con una amiga nueva: pagan $30.000 cada una por su facial. |
| 3 | Reservá tu facial al precio habitual y llevate un kit de regalo. |
| 4 | Con tu facial, tenés una zona de presoterapia de regalo. |
| 5 | Recovery 2x1: venís con una amiga el mismo día y a la misma hora; las dos disfrutan presoterapia + cabina de ozono. |
| 6 | Radiofrecuencia facial 2x1: dos personas, el mismo día y a la misma hora, por $55.000 entre las dos. |
| 7 | Radiofrecuencia facial individual: 25% de descuento; queda en $41.250. |
| 8 | Vela Slim + electrodos, una zona: 15% de descuento. |
| 9 | Depi definitiva: 15% de descuento en un pack. |
| 10 | Limpieza de espalda + peeling: $40.000. |
| 11 | Oxígeno + radiofrecuencia: 25% de descuento. |
| 12 | Con un facial, tenés de regalo la aplicación de exosomas nacionales con Dermapen. |
| 13 | HIFU facial o corporal: 20% de descuento. |
| 14 | Bronceado sin sol: 15% de descuento. |
| 15 | Masajes corporales: 15% de descuento. |
| 16 | Dermapen hidratante: $35.000. |
| 17 | Con tu facial, tenés de regalo una sesión de electrodos a elección. |
| 18 | Pack de dos faciales: 15% de descuento. |
| 19 | Vela Slim, una zona: 15% de descuento. |
| 20 | Pack corporal: 25% de descuento. |
| 21 | Una sesión de presoterapia: 20% de descuento. |
| 22 | Pack de electrodos: 15% de descuento. |
| 23 | Masaje + presoterapia: 30% de descuento en el combo. |
| 24 | Elegí una gift card y obtené 20% de descuento. |

Los textos viven en un módulo del código (`src/lib/servicios/adviento.ts`), no en
la base: son 24 frases fijas de una acción de un mes. Cambiarlas es cambiar una
línea y desplegar.

## Cómo se ve y qué pasa, paso a paso

Estética: la misma del sitio (fondo papel, dorado, nude; tipografías Italiana +
Cormorant Garamond + Inter Tight, **ya cargadas** en `src/app/layout.tsx`), con
el logo de `public/assets/logo-crop.png`. Pensada para celular primero.

### 1. Antes del 1 de diciembre

```
            [logo]
      Calendario de Adviento
   24 sorpresas para tu piel

   Arranca el 1 de diciembre.
   Volvé ese día y elegí tu número.
```

### 2. Del 1 al 24: elegir

```
            [logo]
      Calendario de Adviento
     Elegí un número. Uno solo.

        ①  ②  ③  ④  ⑤  ⑥
        ⑦  ⑧  ⑨  ⑩  ⑪  ⑫
        ⑬  ⑭  ⑮  ⑯  ⑰  ⑱
        ⑲  ⑳  ㉑  ㉒  ㉓  ㉔
```

Al tocar un número se abre una hoja desde abajo pidiendo los datos:

```
      Elegiste el 7
      ┌──────────────────────┐
      │ Nombre y apellido    │
      │ Celular              │
      └──────────────────────┘
      [  Abrir mi sorpresa  ]
      Tus datos quedan en el salón.
```

### 3. La sorpresa

```
      Tu sorpresa · número 7

      Radiofrecuencia facial
      individual: 25% de
      descuento; queda en $41.250.

      Tu código: ADV-7K3M

      [ Contarle a Leri por WhatsApp ]
      [ Reservar turno ]

      Válido hasta el 31 de diciembre.
      Una sorpresa por persona.
```

### 4. Si vuelve

Con el mismo celular, la página **no la deja elegir otro número**: le muestra la
sorpresa que ya tiene, con su código y el botón de WhatsApp.

### El mensaje de WhatsApp

Abre el chat del salón (`whatsappLink()` de `src/lib/whatsapp.ts`, que ya apunta
a `WHATSAPP_E164`) con el texto:

> ¡Hola Leri! Soy María Pérez. En el Calendario de Adviento me tocó el número 7:
> "Radiofrecuencia facial individual: 25% de descuento; queda en $41.250".
> Mi código es ADV-7K3M. Quiero reservar.

## La pantalla del panel

Entrada nueva en el menú de administración, **sólo para admin y recepción** (no
para el rol `professional`, igual que Clientas o Facturación):
`/admin/adviento`.

Muestra la lista de participantes, de la más reciente a la más vieja:

```
Calendario de Adviento · 37 participaron · 29 nuevas · 8 clientas

[Buscar: nombre o teléfono]        [ ] Ver sólo las que faltan usar

25/11  María Pérez    11 2345-6789   NUEVA     #7 · Radiofrecuencia 25%   ADV-7K3M   [Usado]
25/11  Ana Gómez      11 3456-7890   CLIENTA   #19 · Vela Slim 15%        ADV-19QQ   usado 26/11
```

- **NUEVA / CLIENTA**: se resuelve cruzando el teléfono normalizado con
  `clients`. Si una participante se hace clienta después, el cartel cambia solo.
- **[Usado]**: un botón para marcar el premio como canjeado, con la fecha y
  quién lo marcó. Es lo que evita que alguien lo use dos veces.
- Arriba, los tres números que a Leri le interesan: cuántas jugaron, cuántas son
  nuevas, cuántas ya eran clientas.

## La tabla

Migración nueva y **aditiva**, al estilo de las del proyecto
(`supabase/migrations/20261125000000_advent_picks.sql`):

```sql
create table public.advent_picks (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,              -- tal como lo escribió la persona
  phone_key text not null unique,   -- normalizado: la llave de "una por persona"
  door int not null check (door between 1 and 24),
  prize_id int not null check (prize_id between 1 and 24),
  code text not null unique,
  redeemed_at timestamptz,
  redeemed_by uuid references public.staff(id),
  created_at timestamptz not null default now()
);
```

- `phone_key` **único**: la base misma impide la segunda jugada, aunque dos
  personas toquen el botón en el mismo instante. No alcanza con chequear antes
  de insertar.
- RLS: igual que el resto de las tablas del proyecto (sin acceso público; la
  página y el panel entran con la clave de servicio desde el servidor).

## Qué puede salir mal, y qué se hace

| Situación | Qué hace el sistema |
|---|---|
| Teléfono repetido (ya jugó) | Le muestra su sorpresa, no le da otra. |
| Teléfono que no parece argentino (`normalizeArPhone` devuelve null) | "Revisá el celular, no lo reconozco." No guarda nada. |
| Nombre vacío o de una letra | Pide nombre y apellido. |
| Dos toques al mismo tiempo | El índice único deja pasar uno solo; el segundo muestra la sorpresa ya asignada. |
| Entra antes del 1 o después del 24 | Antesala / cierre, sin posibilidad de elegir. |
| Alguien juega con otro teléfono | Se puede. El freno real es el mostrador: Leri cobra el premio contra la lista. |

## Qué queda a criterio de quien lo construya

- La forma exacta de los casilleros (esferas, cajas, puertitas) y la animación,
  mientras sea reconocible como un calendario de adviento y ande en celular.
- El formato del código (sugerido `ADV-<número><3 al azar>`), siempre que no se
  repita.
- Cómo se arma la pantalla del panel (tabla o tarjetas), siguiendo lo que ya hay
  en `/admin/clientas`.
- Si el sorteo y la validación viven en una server action o en una ruta de API.
- Los textos de los carteles de error, mientras hablen como el resto del sitio.

## Pruebas que no pueden faltar

Módulo puro `src/lib/servicios/adviento.ts`, con tests (es la costumbre del
proyecto):

- El sorteo devuelve siempre un premio de 1 a 24, y con muchas tiradas los 24
  aparecen (que sea de verdad al azar y no siempre el mismo).
- El código generado tiene el formato esperado y no se repite en 10.000 tiradas.
- La ventana de fechas: 30/11 es antesala, 1/12 y 24/12 se puede elegir, 25/12 ya
  no, 31/12 todavía se puede canjear, 1/1 no.
- Dos elecciones con el mismo teléfono escrito distinto (`11 2345-6789` y
  `+5491123456789`) son **la misma persona**.
- El mensaje de WhatsApp sale armado con el nombre, el número y el premio.

## Validación antes de desplegar

Lo de siempre en este proyecto: `npx tsc --noEmit`, `npx vitest run`,
`npx next build`, revisión adversarial con opus, y la migración se empuja
**antes** que el código (dos pushes), porque el código lee una tabla que tiene
que existir primero.
