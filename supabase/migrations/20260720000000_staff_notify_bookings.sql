-- Quién recibe los avisos de reserva por email.
-- Hasta ahora los recibía TODO el que tuviera rol admin/recepción, sin forma
-- de elegir: se apaga desde Admin → Personal.
-- Aditiva y segura: por defecto true, así nadie deja de recibir lo que recibía.

alter table public.staff
  add column if not exists notify_bookings boolean not null default true;
