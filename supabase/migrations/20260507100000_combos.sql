-- Combos: paquetes de servicios con precio especial
create table if not exists combos (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  total_price_cents integer not null check (total_price_cents >= 0),
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists combo_services (
  id          uuid primary key default gen_random_uuid(),
  combo_id    uuid not null references combos(id) on delete cascade,
  service_id  uuid not null references services(id) on delete cascade,
  order_index integer not null default 0,
  unique (combo_id, service_id)
);

create index if not exists combo_services_combo_id_idx on combo_services(combo_id);

alter table combos enable row level security;
alter table combo_services enable row level security;

-- Lectura pública (reserva online necesita leer combos activos)
drop policy if exists "combos_select_all" on combos;
drop policy if exists "combo_services_select_all" on combo_services;
create policy "combos_select_all" on combos for select using (true);
create policy "combo_services_select_all" on combo_services for select using (true);
