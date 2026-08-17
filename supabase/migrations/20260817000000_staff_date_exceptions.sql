-- Excepciones de disponibilidad por FECHA PUNTUAL (además del horario semanal).
-- Modelo "negativo" igual que staff_blocked_slots, pero por fecha concreta en
-- vez de por día de la semana:
--   SIN filas para una (profesional, fecha) = usa su horario semanal normal.
--   Cada fila = esa hora (slot), en ESA fecha, NO es reservable con ese profesional.
-- Pesa SIEMPRE por encima del horario semanal (sólo puede QUITAR disponibilidad).
-- "Todo el día" = todas las horas de la grilla de ese día guardadas como filas.
create table if not exists public.staff_date_exceptions (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  date         date not null,   -- la fecha puntual (hora argentina, YYYY-MM-DD)
  slot         text not null,   -- "14:00", mismo idioma de grilla que staff_blocked_slots
  constraint staff_date_exceptions_unique unique (staff_id, date, slot)
);
create index if not exists idx_staff_date_exceptions_staff on public.staff_date_exceptions(staff_id);
create index if not exists idx_staff_date_exceptions_date on public.staff_date_exceptions(date);
alter table public.staff_date_exceptions enable row level security;
drop policy if exists "staff_date_exceptions_read" on public.staff_date_exceptions;
create policy "staff_date_exceptions_read" on public.staff_date_exceptions for select using (true);
