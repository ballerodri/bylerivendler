-- Define qué servicio debe hacerse primero cuando dos se combinan en un turno.
-- (service_first_id) siempre va antes que (service_second_id).
create table if not exists public.service_order_rules (
  id               uuid primary key default gen_random_uuid(),
  service_first_id  uuid not null references public.services(id) on delete cascade,
  service_second_id uuid not null references public.services(id) on delete cascade,
  constraint service_order_rules_unique unique (service_first_id, service_second_id),
  constraint service_order_rules_no_self  check (service_first_id <> service_second_id)
);

alter table public.service_order_rules enable row level security;

-- Solo staff puede leer/escribir (acceso vía service role en server actions)
create policy "order_rules_staff_read" on public.service_order_rules
  for select using (true);
