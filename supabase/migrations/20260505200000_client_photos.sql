-- Private storage bucket for before/after photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-photos',
  'client-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create table if not exists public.client_photos (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  storage_path  text not null,
  type          text not null check (type in ('before', 'after')),
  visible_to_client boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.client_photos enable row level security;
-- All access is via service role (server-side only); no client-facing RLS needed.
