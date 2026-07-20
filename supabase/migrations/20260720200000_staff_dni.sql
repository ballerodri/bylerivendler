-- DNI o CUIT del personal, para poder facturarles (el salón a veces emite
-- facturas a las profesionales que trabajan con ella).
-- Se carga en Admin → Personal y se elige al emitir una factura manual.
-- Aditiva y segura: columna nullable, nadie se ve afectado.

alter table public.staff
  add column if not exists dni text;
