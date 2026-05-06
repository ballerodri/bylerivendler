-- 1. Flag is_professional: distingue quién aparece como opción en el
--    selector de turnos, independientemente del rol de acceso al admin.
alter table public.staff
  add column if not exists is_professional boolean not null default false;

-- Los que eran "professional" pasan a tener el flag activo.
update public.staff set is_professional = true where role = 'professional';

-- 2. Horarios de atención configurables por día de semana (0=Dom … 6=Sáb).
create table if not exists public.business_hours (
  day_of_week int primary key check (day_of_week between 0 and 6),
  is_open     boolean not null default true,
  slots       text[]  not null default '{}'
);

-- Seed con los valores actuales hardcodeados en data.ts
insert into public.business_hours (day_of_week, is_open, slots) values
  (0, false, '{}'),
  (1, true,  array['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30']),
  (2, true,  array['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30']),
  (3, true,  array['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30']),
  (4, true,  array['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30']),
  (5, true,  array['09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30']),
  (6, true,  array['10:00','11:30','13:00','14:30','16:00'])
on conflict (day_of_week) do nothing;

alter table public.business_hours enable row level security;

-- Lectura pública (el flujo de reserva la necesita sin autenticar)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'business_hours'
      and policyname = 'business_hours_public_read'
  ) then
    execute 'create policy "business_hours_public_read" on public.business_hours for select using (true)';
  end if;
end $$;
