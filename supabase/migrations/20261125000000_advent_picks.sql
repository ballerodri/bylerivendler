-- Calendario de Adviento: una sorpresa por persona.
--
-- La llave de "una por persona" es el celular normalizado (phone_key), no el
-- nombre: "Maria" y "María" serían dos personas distintas, pero un celular es
-- un celular. El unique lo hace la BASE, no el código: dos toques al mismo
-- tiempo tienen que dejar pasar uno solo.
--
-- campaign permite repetir la acción en diciembre de 2027 sin que quien jugó
-- este año quede trabado para siempre.

create table if not exists public.advent_picks (
  id uuid primary key default gen_random_uuid(),
  campaign text not null default 'adviento-2026',

  first_name text not null,
  last_name text not null,
  phone text not null,            -- tal como lo escribió la persona
  phone_key text not null,        -- +549XXXXXXXXXX: la llave
  marketing_consent boolean not null default false,

  door int not null check (door between 1 and 24),      -- el casillero que eligió
  prize_id int not null check (prize_id between 1 and 24), -- lo que le tocó (sorteado)
  code text not null,

  redeemed_at timestamptz,
  redeemed_by uuid references public.staff(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Una sola jugada por celular y por edición.
create unique index if not exists advent_picks_campaign_phone_idx
  on public.advent_picks (campaign, phone_key);

-- El código es lo que la clienta muestra y Leri busca: no se puede repetir.
create unique index if not exists advent_picks_campaign_code_idx
  on public.advent_picks (campaign, code);

create index if not exists advent_picks_created_idx
  on public.advent_picks (created_at desc);

-- Sin acceso público: la página y el panel entran por el servidor con la clave
-- de servicio, igual que el resto del proyecto.
alter table public.advent_picks enable row level security;
