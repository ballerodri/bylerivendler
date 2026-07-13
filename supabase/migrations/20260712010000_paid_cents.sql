-- Cuánto se cobró DE VERDAD de este turno (lo registra el salón).
-- Hasta ahora sólo existía deposit_paid (bool), que se escribía al crear el
-- turno y no había ninguna forma de modificarlo: era imposible anotar un cobro.
--
-- Semántica de las tres columnas (ninguna se mueve entre turnos):
--   total_cents   = lo que vale el turno
--   deposit_cents = lo que la clienta debe pagar AHORA (seña 30%, o el total si
--                   eligió pagar todo)
--   paid_cents    = lo que el salón efectivamente cobró
alter table public.appointments
  add column if not exists paid_cents int not null default 0
    check (paid_cents >= 0);
