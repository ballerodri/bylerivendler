-- Programa Cerca: marcar qué servicios participan del programa de puntos.
--   true (default) = participa (suma y se puede canjear con puntos), como hasta ahora.
--   false = no participa (no suma ni se canjea, y no muestra "o X pts").
alter table public.services
  add column if not exists loyalty_enabled boolean not null default true;
