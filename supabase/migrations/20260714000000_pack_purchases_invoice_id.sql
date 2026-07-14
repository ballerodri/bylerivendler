-- Vincula la compra de un pack con la Factura C que se emitió al venderlo (si
-- se facturó en el momento, desde `venderPack`). Sirve para poder bloquear el
-- borrado de un pack ya facturado desde la ficha de la clienta: una Factura C
-- emitida es un documento legal y no puede quedar huérfana.
--
-- Nota: se guarda en `pack_purchases` (no en `invoices`) a propósito, para no
-- tocar el esquema/servicio de facturación (`invoice-service.ts`) — sólo el
-- flujo de venta de packs, que ya inserta esta fila, pasa a anotar el id de
-- la factura que emitió.
alter table public.pack_purchases
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
