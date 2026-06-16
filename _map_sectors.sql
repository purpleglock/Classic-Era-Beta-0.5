-- ============================================================
-- СЕКТОРА КАРТЫ — именованные группы систем с лором и особой границей
-- Выполнить целиком в Supabase → SQL Editor
-- ============================================================

create table if not exists public.map_sectors (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Новый сектор',
  color text default 'rgba(120, 200, 255, 0.5)',
  lore text default '',
  system_ids text[] not null default '{}',
  created_at timestamptz default now()
);

alter table public.map_sectors enable row level security;

-- RLS: читать всем, писать superadmin/editor (как у остальных таблиц карты)
drop policy if exists "read"  on public.map_sectors;
drop policy if exists "write" on public.map_sectors;
create policy "read"  on public.map_sectors for select to public using (true);
create policy "write" on public.map_sectors for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
