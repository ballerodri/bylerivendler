-- Color del evento de Google Calendar POR SERVICIO.
-- Antes el color salía sólo de la profesional (staff.calendar_color_id). Ahora
-- cada servicio puede tener el suyo y PESA MÁS: el evento toma el color del
-- servicio; si ese servicio no tiene uno, cae al de la profesional; si tampoco,
-- queda el color por defecto del calendario.
-- Guarda el id de color de Google Calendar ("1".."11"), igual que en staff.
alter table public.services add column if not exists calendar_color_id text;
