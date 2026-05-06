-- Agrega profesional y hora de inicio por servicio dentro de un turno,
-- para soportar turnos multi-servicio con profesionales distintas.
alter table public.appointment_services
  add column if not exists staff_id  uuid references public.staff(id),
  add column if not exists starts_at timestamptz;
