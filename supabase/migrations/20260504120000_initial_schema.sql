-- =====================================================================
-- By Leri Vendler — Initial schema (Fase 1)
-- Reservas + ficha clínica + catálogo
-- Convenciones: snake_case, uuid PKs, timestamptz, RLS desde día 1.
-- Precios en centavos (int) para evitar problemas de float.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. HELPER FUNCTIONS
-- =====================================================================

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Marca si el usuario actual pertenece al staff activo.
-- Se redefine luego de crear staff. La declaramos primero en una versión
-- inocua para evitar dependencias circulares en RLS.
create or replace function public.is_staff()
returns boolean language sql security definer stable as $$ select false; $$;

-- =====================================================================
-- 2. CATÁLOGO: CATEGORÍAS Y SERVICIOS
-- =====================================================================

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  tagline text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_service_categories_updated
  before update on public.service_categories
  for each row execute function public.tg_set_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete restrict,
  slug text unique not null,
  name text not null,
  description text,
  duration_min int not null check (duration_min > 0),
  price_cents int not null check (price_cents >= 0),
  promo_price_cents int check (promo_price_cents >= 0),
  requires_deposit boolean not null default true,
  deposit_pct numeric(5,2) not null default 30.00 check (deposit_pct >= 0 and deposit_pct <= 100),
  protocol_followup_days int,
  visible_public boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_services_category on public.services(category_id);

create trigger trg_services_updated
  before update on public.services
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- 3. STAFF Y GABINETES
-- =====================================================================

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  role text not null check (role in ('admin','professional','reception')),
  email text,
  phone text,
  avatar_url text,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_staff_user on public.staff(user_id);

create trigger trg_staff_updated
  before update on public.staff
  for each row execute function public.tg_set_updated_at();

create table public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active','maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_rooms_updated
  before update on public.rooms
  for each row execute function public.tg_set_updated_at();

create table public.room_services (
  room_id uuid not null references public.rooms(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  primary key (room_id, service_id)
);

-- Redefinir is_staff() ahora que staff existe.
create or replace function public.is_staff()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.staff
    where user_id = auth.uid() and active = true
  );
$$;

-- =====================================================================
-- 4. CLIENTES
-- =====================================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  dni text,
  date_of_birth date,
  source text,
  notes text,
  preferred_channel text not null default 'email' check (preferred_channel in ('email','sms','whatsapp')),
  marketing_consent boolean not null default false,
  loyalty_points int not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_clients_user on public.clients(user_id);
create index idx_clients_email on public.clients(lower(email));

create trigger trg_clients_updated
  before update on public.clients
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- 5. FICHA CLÍNICA (versionada — solo una vigente por clienta)
-- =====================================================================

create table public.client_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  version int not null default 1,
  is_current boolean not null default true,
  allergies text[] not null default '{}',
  allergies_other text,
  medications_status text not null default 'no' check (medications_status in ('no','si')),
  medications_note text,
  pregnancy text not null default 'no' check (pregnancy in ('no','embarazo','lactancia')),
  skin_conditions text[] not null default '{}',
  skin_type text,
  aesthetic_history text,
  contraindications text[] not null default '{}',
  alert_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index idx_records_client on public.client_records(client_id);
-- Solo puede haber UNA ficha vigente por clienta.
create unique index idx_one_current_record_per_client
  on public.client_records (client_id) where is_current = true;

-- =====================================================================
-- 6. CONSENTIMIENTOS INFORMADOS
-- =====================================================================

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  appointment_id uuid,
  doc_version text not null,
  doc_hash text not null,
  signed_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  signature_data text
);

create index idx_consents_client on public.consents(client_id);

-- =====================================================================
-- 7. TURNOS
-- =====================================================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_min int not null check (duration_min > 0),
  total_cents int not null default 0,
  deposit_cents int not null default 0,
  deposit_paid boolean not null default false,
  deposit_payment_ref text,
  status text not null default 'pending' check (status in ('pending','confirmed','in_progress','completed','cancelled','no_show')),
  source text not null default 'web' check (source in ('web','whatsapp','admin','phone')),
  notes_internal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index idx_appts_client on public.appointments(client_id);
create index idx_appts_staff on public.appointments(staff_id);
create index idx_appts_starts on public.appointments(starts_at);

create trigger trg_appointments_updated
  before update on public.appointments
  for each row execute function public.tg_set_updated_at();

-- FK diferida ahora que appointments existe
alter table public.consents
  add constraint consents_appointment_fk
  foreign key (appointment_id) references public.appointments(id) on delete set null;

create table public.appointment_services (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  duration_min int not null check (duration_min > 0),
  price_cents int not null check (price_cents >= 0),
  primary key (appointment_id, service_id)
);

-- =====================================================================
-- 8. ROW LEVEL SECURITY
-- =====================================================================
-- Patrón general:
--   - anon: solo lee catálogo público (servicios visibles + categorías)
--   - authenticated client: lee/actualiza solo sus datos
--   - staff: acceso total (via is_staff())
--   - server actions con service_role: bypasean RLS
-- La inserción inicial de turnos/clientes la hacen Server Actions
-- de Next.js usando SUPABASE_SERVICE_ROLE_KEY.
-- =====================================================================

alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_services enable row level security;
alter table public.rooms enable row level security;
alter table public.room_services enable row level security;
alter table public.clients enable row level security;
alter table public.client_records enable row level security;
alter table public.consents enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;

-- Catálogo público
create policy "categories_public_read" on public.service_categories
  for select using (active = true);
create policy "categories_staff_write" on public.service_categories
  for all using (public.is_staff()) with check (public.is_staff());

create policy "services_public_read" on public.services
  for select using (active = true and visible_public = true);
create policy "services_staff_write" on public.services
  for all using (public.is_staff()) with check (public.is_staff());

-- Staff y rooms
create policy "staff_authenticated_read" on public.staff
  for select to authenticated using (active = true);
create policy "staff_self_write" on public.staff
  for all using (public.is_staff()) with check (public.is_staff());

create policy "staff_services_read" on public.staff_services for select using (true);
create policy "staff_services_write" on public.staff_services
  for all using (public.is_staff()) with check (public.is_staff());

create policy "rooms_authenticated_read" on public.rooms
  for select to authenticated using (active = true);
create policy "rooms_staff_write" on public.rooms
  for all using (public.is_staff()) with check (public.is_staff());

create policy "room_services_read" on public.room_services for select using (true);
create policy "room_services_write" on public.room_services
  for all using (public.is_staff()) with check (public.is_staff());

-- Clientes
create policy "clients_self_read" on public.clients
  for select using (user_id = auth.uid() or public.is_staff());
create policy "clients_self_update" on public.clients
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clients_staff_write" on public.clients
  for all using (public.is_staff()) with check (public.is_staff());

-- Ficha clínica
create policy "records_self_read" on public.client_records
  for select using (
    public.is_staff()
    or exists (select 1 from public.clients c where c.id = client_records.client_id and c.user_id = auth.uid())
  );
create policy "records_staff_write" on public.client_records
  for all using (public.is_staff()) with check (public.is_staff());

-- Consentimientos
create policy "consents_self_read" on public.consents
  for select using (
    public.is_staff()
    or exists (select 1 from public.clients c where c.id = consents.client_id and c.user_id = auth.uid())
  );
create policy "consents_staff_write" on public.consents
  for all using (public.is_staff()) with check (public.is_staff());

-- Turnos
create policy "appts_self_read" on public.appointments
  for select using (
    public.is_staff()
    or exists (select 1 from public.clients c where c.id = appointments.client_id and c.user_id = auth.uid())
  );
create policy "appts_self_update" on public.appointments
  for update using (
    exists (select 1 from public.clients c where c.id = appointments.client_id and c.user_id = auth.uid())
  );
create policy "appts_staff_write" on public.appointments
  for all using (public.is_staff()) with check (public.is_staff());

create policy "appt_services_read" on public.appointment_services
  for select using (
    public.is_staff()
    or exists (
      select 1 from public.appointments a
      join public.clients c on c.id = a.client_id
      where a.id = appointment_services.appointment_id and c.user_id = auth.uid()
    )
  );
create policy "appt_services_staff_write" on public.appointment_services
  for all using (public.is_staff()) with check (public.is_staff());

-- =====================================================================
-- 9. SEED INICIAL (catálogo y staff base)
-- =====================================================================

insert into public.service_categories (slug, name, tagline, sort_order) values
  ('facial',   'Facial',   'Rituales de piel',          1),
  ('corporal', 'Corporal', 'Tratamientos de cuerpo',    2),
  ('masaje',   'Masajes',  'Relajación y bienestar',    3);

insert into public.services (category_id, slug, name, description, duration_min, price_cents) values
  ((select id from public.service_categories where slug='facial'),   'limpieza-facial-profunda', 'Limpieza facial profunda', 'Extracción, vapor ozonizado y máscara calmante. Ideal como primer encuentro con la piel.', 60, 3500000),
  ((select id from public.service_categories where slug='facial'),   'hydrafacial-signature',    'Hydrafacial signature',    'Exfoliación, infusión de sérums y hidratación intensiva con efecto luminoso inmediato.',     75, 7800000),
  ((select id from public.service_categories where slug='facial'),   'radiofrecuencia-facial',   'Radiofrecuencia facial',   'Tensado progresivo con aparatología. Serie de 6 sesiones recomendadas.',                     50, 5800000),
  ((select id from public.service_categories where slug='facial'),   'peeling-quimico',          'Peeling químico editorial','Renovación celular con ácidos seleccionados según ficha dermatológica.',                     45, 5400000),
  ((select id from public.service_categories where slug='corporal'), 'drenaje-linfatico',        'Drenaje linfático manual', 'Técnica Vodder clásica. Reduce retención y activa circulación.',                             60, 3800000),
  ((select id from public.service_categories where slug='corporal'), 'masaje-descontracturante', 'Masaje descontracturante', 'Presión profunda sobre zonas de tensión. Con aceites esenciales.',                           60, 3600000),
  ((select id from public.service_categories where slug='corporal'), 'maderoterapia',            'Maderoterapia modeladora', 'Remodelado de silueta con instrumental de madera. Serie recomendada.',                       75, 4800000),
  ((select id from public.service_categories where slug='corporal'), 'ritual-de-espalda',        'Ritual de espalda',        'Limpieza, exfoliación y masaje. Para pieles con acné o tensión crónica.',                    50, 3400000),
  ((select id from public.service_categories where slug='masaje'),   'masaje-relajante',         'Masaje relajante',         'Maniobras suaves sobre cuerpo completo. Aromaterapia personalizada.',                        60, 3200000),
  ((select id from public.service_categories where slug='masaje'),   'piedras-calientes',        'Piedras calientes',        'Basaltos termoregulados. Calor que desbloquea tensiones profundas.',                         75, 4400000),
  ((select id from public.service_categories where slug='masaje'),   'masaje-en-pareja',         'Masaje en pareja',         'Cabina doble, dos terapeutas, misma sincronía. Con copa de espumante.',                      60, 6200000);

insert into public.rooms (name, description) values
  ('Cabina principal', 'Gabinete polivalente para faciales, corporales y masajes.');

-- Staff: Leri se carga manualmente luego del primer signup (asociando user_id),
-- o por seed admin. Dejamos un placeholder visible que no bloquea el flujo.
insert into public.staff (full_name, role, color, active)
  values ('Leri Vendler', 'admin', '#C9A78E', true);
