create table if not exists public.google_calendar_config (
  id               integer primary key default 1 check (id = 1), -- single row
  refresh_token    text,
  google_email     text,
  connected_at     timestamptz
);

-- Insert the single row so updates always find it
insert into public.google_calendar_config (id) values (1)
  on conflict (id) do nothing;

alter table public.google_calendar_config enable row level security;

-- Solo el service role puede leer/escribir (server actions)
