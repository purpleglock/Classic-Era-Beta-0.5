-- Служебный журнал накатов: клиенту он не нужен вообще.
revoke all on table public._migrations from anon, authenticated;
alter table public._migrations enable row level security;
