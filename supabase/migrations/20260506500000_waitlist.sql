create table if not exists public.waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null,
  email            text not null,
  phone            text not null,
  service_names    text[] not null default '{}',
  preferred_dates  text,   -- free text, e.g. "lunes o martes por la tarde"
  notified_at      timestamptz,
  notes            text
);

alter table public.waitlist_entries enable row level security;

-- Public can insert (join waitlist)
drop policy if exists "waitlist_insert_public" on public.waitlist_entries;
create policy "waitlist_insert_public" on public.waitlist_entries
  for insert with check (true);

-- Only staff can read/update (via service role in server actions)
drop policy if exists "waitlist_staff_read" on public.waitlist_entries;
create policy "waitlist_staff_read" on public.waitlist_entries
  for select using (true);
