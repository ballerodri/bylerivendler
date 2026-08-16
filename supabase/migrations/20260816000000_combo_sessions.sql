-- Un combo pasa a ser un PROGRAMA de varias sesiones: cada servicio del combo
-- tiene su cantidad de sesiones, y si es por-zona, el snapshot de la(s) zona(s)
-- elegida(s) al armarlo (mismo formato que appointment_services.zones:
-- [{ name, duration_min, price_cents }]).
-- Aditiva: las filas existentes toman sessions = 1 y zones = null.
alter table public.combo_services
  add column if not exists sessions int not null default 1 check (sessions > 0);

alter table public.combo_services
  add column if not exists zones jsonb;
