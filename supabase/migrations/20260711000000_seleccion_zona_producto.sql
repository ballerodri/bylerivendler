-- Servicios "por zona": cómo se eligen los ítems.
--   'multiple' = se pueden elegir varios y se suman (ej. zonas de Vela Slim).
--   'single'   = se elige uno solo (ej. un producto de Dermapen).
-- Sólo aplica cuando pricing_mode = 'per_zone'.
alter table public.services
  add column if not exists zone_selection text not null default 'multiple'
    check (zone_selection in ('multiple', 'single'));
