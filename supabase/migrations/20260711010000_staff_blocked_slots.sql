-- Indisponibilidad por profesional: horas puntuales bloqueadas por día.
-- Modelo inverso al anterior (staff_availability, que guardaba un rango):
--   SIN filas para un profesional = disponible en TODOS los horarios del negocio.
--   Cada fila = esa hora (slot) de ese día NO es reservable con ese profesional.
create table if not exists public.staff_blocked_slots (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  day_of_week  int not null check (day_of_week between 0 and 6),
  slot         text not null,  -- "13:00"
  constraint staff_blocked_slots_unique unique (staff_id, day_of_week, slot)
);

create index if not exists idx_staff_blocked_slots_staff on public.staff_blocked_slots(staff_id);

alter table public.staff_blocked_slots enable row level security;

drop policy if exists "staff_blocked_read" on public.staff_blocked_slots;
create policy "staff_blocked_read" on public.staff_blocked_slots
  for select using (true);
