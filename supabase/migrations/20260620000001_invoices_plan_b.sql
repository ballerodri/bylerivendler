-- Plan B: separar entorno de prueba/real y guardar el concepto facturado.
alter table public.invoices
  add column if not exists environment text not null default 'homologacion'
    check (environment in ('homologacion','produccion')),
  add column if not exists descripcion text;
