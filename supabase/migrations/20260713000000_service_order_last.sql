-- "Este servicio va siempre al final" (ej: los masajes).
--
-- Cuando la clienta elige varios servicios para el MISMO día (uno después del
-- otro), el buscador de horarios prueba todos los órdenes posibles y descarta
-- los que violan las reglas. Ya existía `service_order_rules` (reglas de a
-- pares: "A va antes que B"), pero decir "los masajes van al final" con reglas
-- de a pares serían ~160 filas (8 masajes x 20 servicios). Una casilla por
-- servicio lo resuelve con 8 tildes.
--
-- Regla: ningún servicio marcado puede quedar ANTES de uno no marcado. Entre
-- varios marcados, el orden es libre. Se combina con service_order_rules.
alter table public.services
  add column if not exists order_last boolean not null default false;

comment on column public.services.order_last is
  'Si es true, el servicio va siempre al final cuando se encadenan varios el mismo día (ej: masajes).';
