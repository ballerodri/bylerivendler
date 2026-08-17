-- La factura del programa (una sola, por el total) queda anotada en la compra,
-- igual que pack_purchases.invoice_id — para poder bloquear el borrado del
-- programa comprado más adelante sin tocar el esquema de facturación.
alter table public.combo_purchases
  add column if not exists invoice_id uuid;
