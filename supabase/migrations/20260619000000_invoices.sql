-- =====================================================================
-- By Leri Vendler — Facturación electrónica ARCA (Factura C)
-- =====================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  cbte_tipo int not null default 11,            -- 11 = Factura C
  pto_vta int not null,
  cbte_nro bigint,                              -- lo asigna ARCA
  concepto int not null default 2,              -- 1=Prod, 2=Serv, 3=ProdyServ
  receptor_doc_tipo int not null default 99,    -- 99=CF, 96=DNI, 80=CUIT
  receptor_doc_nro text not null default '0',
  receptor_nombre text,
  receptor_cond_iva int not null default 5,     -- 5 = Consumidor Final
  total_cents int not null check (total_cents >= 0),
  cae text,
  cae_vto date,
  fecha_emision date not null default current_date,
  estado text not null default 'pendiente' check (estado in ('pendiente','emitida','error')),
  error_msg text,
  qr_url text,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_invoices_client on public.invoices(client_id);
create index idx_invoices_appointment on public.invoices(appointment_id);
create unique index idx_invoices_numero
  on public.invoices(pto_vta, cbte_tipo, cbte_nro) where cbte_nro is not null;

create trigger trg_invoices_updated
  before update on public.invoices
  for each row execute function public.tg_set_updated_at();

alter table public.invoices enable row level security;
create policy "invoices_staff_all" on public.invoices
  for all using (public.is_staff()) with check (public.is_staff());

-- Token de WSAA persistido (vale 12 h). Se reutiliza para no ser
-- rechazado por ARCA al pedir un token nuevo teniendo uno válido.
create table public.arca_tokens (
  service text not null,
  environment text not null check (environment in ('homologacion','produccion')),
  token text not null,
  sign text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (service, environment)
);

alter table public.arca_tokens enable row level security;
create policy "arca_tokens_staff_all" on public.arca_tokens
  for all using (public.is_staff()) with check (public.is_staff());
