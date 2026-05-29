-- ============================================================
-- КОНСТРУКТОРЫ — таблица юнитов фракций (корабли / техника / авиация / дивизии)
-- Выполнить целиком в Supabase → SQL Editor
-- Требует: функция public.current_user_role() (создана ранее),
--          таблица public.faction_applications (см. _faction_setup.sql)
-- ============================================================

create table if not exists public.faction_units (
  id uuid primary key default gen_random_uuid(),
  category text not null,                      -- ship | ground | aviation | division
  name text not null,
  faction_id text,                             -- fac_xxxx из одобренной анкеты (может быть null у стаффа без фракции)
  faction_name text,
  faction_color text,                          -- rgba(...) для бейджа/рамки в каталоге
  owner_id uuid,
  owner_email text,
  summary jsonb default '{}'::jsonb,           -- заголовочные ТТХ для карточек (hp, dmg, cost, on, ...)
  data jsonb default '{}'::jsonb,              -- полный конфиг билдера (для перезагрузки/редактирования)
  card_text text,                              -- человекочитаемая «спецификация»
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists faction_units_category_idx on public.faction_units (category);
create index if not exists faction_units_faction_idx  on public.faction_units (faction_id);
create index if not exists faction_units_owner_idx    on public.faction_units (owner_id);

alter table public.faction_units enable row level security;

drop policy if exists "fu_select" on public.faction_units;
drop policy if exists "fu_insert" on public.faction_units;
drop policy if exists "fu_update" on public.faction_units;
drop policy if exists "fu_delete" on public.faction_units;

-- читать: каталоги публичны — видно всем (включая гостей)
create policy "fu_select" on public.faction_units for select to public
  using (true);

-- создавать: только от своего имени И только стафф ИЛИ владелец одобренной анкеты
create policy "fu_insert" on public.faction_units for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (
      public.current_user_role() in ('superadmin','editor')
      or exists (
        select 1 from public.faction_applications fa
        where fa.owner_id = auth.uid() and fa.status = 'approved'
      )
    )
  );

-- править: автор (свой юнит) или стафф
create policy "fu_update" on public.faction_units for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- удалять: автор (свой юнит) или стафф
create policy "fu_delete" on public.faction_units for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
