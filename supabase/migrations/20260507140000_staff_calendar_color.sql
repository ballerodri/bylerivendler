alter table public.staff
  add column if not exists calendar_color_id text default null;
