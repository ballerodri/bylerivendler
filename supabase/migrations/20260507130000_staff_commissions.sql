create table if not exists public.staff_service_commissions (
  staff_id         uuid not null references public.staff(id) on delete cascade,
  service_id       uuid not null references public.services(id) on delete cascade,
  commission_type  text not null default 'percentage' check (commission_type in ('percentage', 'fixed')),
  commission_value numeric(10,2) not null default 0 check (commission_value >= 0),
  primary key (staff_id, service_id)
);

alter table public.staff_service_commissions enable row level security;

drop policy if exists "commissions_service_role" on public.staff_service_commissions;
create policy "commissions_service_role" on public.staff_service_commissions
  using (true) with check (true);
