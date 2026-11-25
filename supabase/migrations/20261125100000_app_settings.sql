-- Interruptores globales del sitio, de a uno por fila.
--
-- Hasta ahora cada opcion vivia como columna de su tabla (services.loyalty_enabled
-- y companía), pero un interruptor que no pertenece a ninguna entidad -como
-- "abrir el Calendario de Adviento para probar"- no tiene donde ir. Antes que
-- inventar una tabla por cada uno, una sola de clave y valor.
--
-- Es para OPCIONES, no para datos: pocas filas, leidas desde el servidor.

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id) on delete set null
);

alter table public.app_settings enable row level security;
