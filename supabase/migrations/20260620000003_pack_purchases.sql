-- Compras de pack (seguimiento de sesiones por clienta).
create table if not exists public.pack_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pack_id uuid references public.packs(id) on delete set null,
  pack_name text not null,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  sessions_total int not null check (sessions_total > 0),
  sessions_used int not null default 0 check (sessions_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_pack_purchases_client on public.pack_purchases(client_id);

alter table public.pack_purchases enable row level security;
drop policy if exists "pack_purchases_staff_all" on public.pack_purchases;
create policy "pack_purchases_staff_all" on public.pack_purchases
  for all using (public.is_staff()) with check (public.is_staff());

-- Vincula un turno con la compra de pack de la que descontó una sesión.
alter table public.appointments
  add column if not exists pack_purchase_id uuid references public.pack_purchases(id) on delete set null;
