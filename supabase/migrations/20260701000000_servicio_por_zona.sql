-- Servicios "por zona": precio por zona + lista de zonas con duración propia.

-- 1) Modo de cobro del servicio. 'fixed' = como hasta ahora; 'per_zone' = por zona.
alter table public.services
  add column if not exists pricing_mode text not null default 'fixed'
    check (pricing_mode in ('fixed', 'per_zone'));

-- 2) Para servicios por zona, duration_min no se usa (la duración sale de las zonas).
--    Se relaja el check para permitir 0.
alter table public.services drop constraint if exists services_duration_min_check;
alter table public.services
  add constraint services_duration_min_check check (duration_min >= 0);

-- 3) Zonas de un servicio por zona.
create table if not exists public.service_zones (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  duration_min int not null check (duration_min > 0),
  order_index int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_zones_service on public.service_zones(service_id);

alter table public.service_zones enable row level security;

drop policy if exists "service_zones_select_all" on public.service_zones;
create policy "service_zones_select_all" on public.service_zones for select using (true);

drop policy if exists "service_zones_staff_write" on public.service_zones;
create policy "service_zones_staff_write" on public.service_zones
  for all using (public.is_staff()) with check (public.is_staff());

-- 4) Foto de las zonas elegidas en cada turno (para servicios por zona).
alter table public.appointment_services
  add column if not exists zones jsonb;
