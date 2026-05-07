-- Horarios de disponibilidad de cada profesional por día de la semana.
-- Si un profesional no tiene rows, se considera disponible en todos los horarios del negocio.
create table if not exists public.staff_availability (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6),
  from_time    text not null,  -- "09:00"
  to_time      text not null,  -- "17:00"
  constraint staff_availability_unique unique (staff_id, day_of_week)
);

alter table public.staff_availability enable row level security;

drop policy if exists "staff_avail_read" on public.staff_availability;
create policy "staff_avail_read" on public.staff_availability
  for select using (true);
