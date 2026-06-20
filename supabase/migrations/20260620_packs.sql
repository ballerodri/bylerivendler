-- Packs de sesiones: un servicio repetido N veces a precio especial.
create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  description text,
  sessions int not null check (sessions >= 1),
  interval_days int check (interval_days is null or interval_days > 0),
  total_price_cents int not null check (total_price_cents >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_packs_service on public.packs(service_id);

alter table public.packs enable row level security;

drop policy if exists "packs_select_all" on public.packs;
create policy "packs_select_all" on public.packs for select using (true);

drop policy if exists "packs_staff_write" on public.packs;
create policy "packs_staff_write" on public.packs
  for all using (public.is_staff()) with check (public.is_staff());
