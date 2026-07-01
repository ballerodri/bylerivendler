-- Packs para servicios "por zona" + packs elegibles en la reserva online.

-- Cuántas zonas cubre cada sesión del pack (solo packs de servicios per_zone).
alter table public.packs
  add column if not exists zones_count int check (zones_count is null or zones_count > 0);

-- Si el pack se puede elegir en la reserva online.
alter table public.packs
  add column if not exists visible_reserva boolean not null default false;
