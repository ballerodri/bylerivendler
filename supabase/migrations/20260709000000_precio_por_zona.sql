-- Precio propio opcional por zona. Null = usa el precio general del servicio
-- (services.price_cents). En centavos.
alter table public.service_zones
  add column if not exists price_cents int check (price_cents is null or price_cents >= 0);
