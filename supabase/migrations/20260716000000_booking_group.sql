-- Un solo mail por compra: vincula los turnos creados en una misma compra web
-- (booking_group_id) y marca cuándo se mandó el mail de confirmación a la
-- clienta (confirmation_email_sent_at, anti-duplicado).
-- Aditiva y segura: columnas nullable, los turnos existentes quedan en NULL
-- (los viejos y los creados a mano por el admin no mandan mail al confirmarse).

alter table appointments add column if not exists booking_group_id uuid;
alter table appointments add column if not exists confirmation_email_sent_at timestamptz;

create index if not exists appointments_booking_group_id_idx
  on appointments (booking_group_id) where booking_group_id is not null;
