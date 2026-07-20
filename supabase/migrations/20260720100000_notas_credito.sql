-- Notas de Crédito: anular una factura ya emitida.
-- Una Nota de Crédito C (cbte_tipo 13) es un comprobante propio, con su CAE,
-- que apunta a la factura que anula. Se guarda como una fila más de invoices.
--   - anula_invoice_id: en la nota de crédito, la factura que cancela.
--   - anulada: en la factura, si ya tiene una nota de crédito emitida.
-- Aditiva y segura: columnas nuevas nullable/default, nada existente cambia.

alter table public.invoices
  add column if not exists anula_invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists anulada boolean not null default false;

create index if not exists invoices_anula_invoice_id_idx
  on public.invoices (anula_invoice_id) where anula_invoice_id is not null;
