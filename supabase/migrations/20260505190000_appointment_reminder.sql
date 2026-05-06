-- Tracks when a 24h reminder was sent for an appointment.
-- NULL means no reminder sent yet.
alter table public.appointments
  add column if not exists reminder_sent_at timestamptz default null;
