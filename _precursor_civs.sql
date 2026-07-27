-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ ЦИВИЛИЗАЦИИ (лор: lore/precursor_civs.md, этап 2)
--
-- Одна строка = одна цивилизация на конкретном теле (system_id + pid).
-- История детерминирована от (system_id, pid, seed) — но хранится развёрнутой:
-- пересчитывать её на каждый показ дорого, а читать игрок будет часто.
--
-- Пишет только админ (генератор карты). Клиент — только select.
-- Этап 3 (решения игрока) добавит отдельные поля/RPC поверх этой таблицы.
-- ════════════════════════════════════════════════════════════

create table if not exists public.primitive_civs (
  system_id    text not null references public.map_systems(id) on delete cascade,
  pid          int  not null,
  seed         text not null default 'v1',
  system_name  text,
  planet_name  text,
  self_name    text not null,
  races        text[] not null default '{}',
  synergy      text,
  env          text,
  phase        int  not null default 0,     -- 0..11 (E0..E11)
  tier         int  not null default 0,     -- 0..5
  visible_tier int  not null default 0,     -- то, что видит разведка (может врать)
  ideology     text,
  gov          text,
  scars        text[] not null default '{}',
  pop          bigint not null default 0,
  wellbeing    int  not null default 50,
  attitude     int  not null default 0,     -- −100..+100, отношение к контакту
  ruins        text default 'нет',
  flags        jsonb not null default '{}'::jsonb,
  race_scar    text,
  chronicle    jsonb not null default '[]'::jsonb,  -- [{ph,text,scar?}]
  contacted_by text,                        -- faction_id первооткрывателя (без FK, как в colonies)
  contacted_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (system_id, pid)
);

create index if not exists idx_prim_civ_sys  on public.primitive_civs(system_id);
create index if not exists idx_prim_civ_tier on public.primitive_civs(tier);

alter table public.primitive_civs enable row level security;

-- RLS: читать всем (видимость на карте гейтится клиентом/разведкой),
-- писать — только superadmin/editor, как у остальных таблиц карты.
drop policy if exists "read"  on public.primitive_civs;
drop policy if exists "write" on public.primitive_civs;
create policy "read"  on public.primitive_civs for select to public using (true);
create policy "write" on public.primitive_civs for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));
