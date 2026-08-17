-- Compra de un PROGRAMA (combo multi-sesión), espejo de pack_purchases. La
-- plata vive en el turno PORTADOR (la 1ª sesión, appointments.total_cents), NO
-- acá: total_price_cents es un snapshot para trazabilidad/mostrar. Una factura
-- por el total (el portador); las demás sesiones en $0.
create table if not exists public.combo_purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  combo_id uuid references public.combos(id) on delete set null,
  combo_name text not null,               -- snapshot: sobrevive al borrado/edición del programa
  total_price_cents integer not null check (total_price_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_combo_purchases_client on public.combo_purchases(client_id);

alter table public.combo_purchases enable row level security;
drop policy if exists "combo_purchases_staff_all" on public.combo_purchases;
create policy "combo_purchases_staff_all" on public.combo_purchases
  for all using (public.is_staff()) with check (public.is_staff());

-- La cantidad de sesiones por servicio se CONGELA en la compra (el programa
-- puede editarse después): una fila por servicio del programa, con su snapshot
-- de zona si es por-zona (mismo formato que appointment_services.zones).
create table if not exists public.combo_purchase_services (
  id uuid primary key default gen_random_uuid(),
  combo_purchase_id uuid not null references public.combo_purchases(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  sessions int not null check (sessions > 0),
  zones jsonb,
  order_index int not null default 0
);

create index if not exists idx_combo_purchase_services_purchase
  on public.combo_purchase_services(combo_purchase_id);

alter table public.combo_purchase_services enable row level security;
drop policy if exists "combo_purchase_services_staff_all" on public.combo_purchase_services;
create policy "combo_purchase_services_staff_all" on public.combo_purchase_services
  for all using (public.is_staff()) with check (public.is_staff());

-- Vincula un turno (una sesión) con la compra del programa que descuenta.
alter table public.appointments
  add column if not exists combo_purchase_id uuid
    references public.combo_purchases(id) on delete set null;
