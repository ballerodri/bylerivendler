-- =====================================================================
-- Programa Cerca: agregar costo y ganancia de puntos por servicio.
-- =====================================================================
-- - points_earned: cuántos puntos suma una clienta cuando completa este
--   servicio (turno marcado como `completed` por el staff).
-- - points_cost:   cuántos puntos hacen falta para canjear este servicio
--   (reserva sin pago, todo cubierto con puntos).
--
-- Default: 1 punto por minuto de duración para earned, x5 para cost.
-- Configurable por servicio desde el panel admin más adelante.
-- =====================================================================

alter table public.services
  add column if not exists points_earned int not null default 0,
  add column if not exists points_cost int not null default 0;

-- Seed inicial sólo para los services existentes que no tengan valores.
update public.services
set
  points_earned = duration_min,
  points_cost = duration_min * 5
where points_earned = 0 and points_cost = 0;
