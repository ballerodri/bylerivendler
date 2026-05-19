create table if not exists public.medical_intake_depilation (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  nombre_apellido text not null,
  zonas_tratamiento text[] not null default '{}',
  contraindicaciones text,
  checkbox_consentimiento boolean not null default false,
  checkbox_indicaciones boolean not null default false,
  checkbox_salud boolean not null default false,
  checkbox_registro boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique(appointment_id)
);

create index if not exists idx_medical_intake_depilation_client_id
  on public.medical_intake_depilation(client_id);

create index if not exists idx_medical_intake_depilation_appointment_id
  on public.medical_intake_depilation(appointment_id);
