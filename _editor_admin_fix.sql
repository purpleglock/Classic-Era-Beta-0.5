-- ============================================================
-- ФИКС: ЭДИТОРЫ НЕ МОГУТ РАБОТАТЬ С ПАНЕЛЬЮ УПРАВЛЕНИЯ ФРАКЦИЯМИ
--
-- Симптом: эдитор открывает «🛠 Управление», но чужие фракции не грузятся и
-- любые изменения (казна, ресурсы, колонии, постройки, территория) падают —
-- «панель открывается, но ничего не работает».
--
-- Причина: рассинхрон клиента и сервера по роли.
--   • Клиент (auth.js) нормализует роль: lower-case + алиасы (admin→superadmin,
--     mod→moderator). Поэтому при роли 'Editor'/'EDITOR'/'admin' панель ВСЁ РАВНО
--     показывается.
--   • Сервер current_user_role() возвращал роль КАК ЕСТЬ, а RLS-политики сверяют
--     точное in ('superadmin','editor'). 'Editor' ≠ 'editor' → сервер блокировал
--     все чтения чужих фракций и все записи эдитора.
--   • Суперадмин не страдал: его роль хранится ровно как 'superadmin'.
--
-- Что делает скрипт (идемпотентно, безопасно повторять):
--   1) Переопределяет current_user_role() с нормализацией (зеркало клиента).
--   2) На всякий случай переустанавливает стафф-политики записи/чтения для всех
--      таблиц панели управления — с включённым 'editor' (если в БД остались
--      старые политики только под 'superadmin').
--
-- Применить: Supabase → SQL Editor → вставить целиком → Run.
-- ============================================================

-- ── 1) Устойчивый current_user_role() ───────────────────────
-- Чинит ДВЕ проблемы старой версии:
--   а) LIMIT 1 без ORDER BY: при нескольких строках user_roles для одного
--      пользователя возвращалась СЛУЧАЙНАЯ роль (клиент мог получить 'editor',
--      сервер — 'player'/'viewer' → RLS блокировала всё). Теперь берётся самая
--      ПРИВИЛЕГИРОВАННАЯ роль среди всех строк пользователя.
--   б) регистр/алиасы: 'Editor'/'admin'/'mod' нормализуются как на клиенте.
create or replace function public.current_user_role()
returns text
language sql stable security definer set search_path = public as $$
  with rows as (
    select lower(btrim(role)) as raw, coalesce(is_banned, false) as banned
    from public.user_roles where user_id = auth.uid()
  ), canon as (
    select
      case raw
        when 'admin' then 'superadmin' when 'super' then 'superadmin' when 'superadmin' then 'superadmin'
        when 'editor' then 'editor'
        when 'mod' then 'moderator' when 'moderator' then 'moderator'
        when 'player' then 'player'
        else 'viewer'
      end as role,
      banned
    from rows
  )
  select case
    when exists (select 1 from canon where banned) then 'banned'
    else coalesce(
      (select role from canon
        order by case role
          when 'superadmin' then 0 when 'editor' then 1 when 'moderator' then 2
          when 'player' then 3 else 4 end
        limit 1),
      'viewer')
  end
$$;
grant execute on function public.current_user_role() to anon, authenticated;

-- ── 2) Переустановка стафф-политик (editor включён) ─────────

-- faction_economy: казна, ресурсы, исследования
drop policy if exists "fe_sel" on public.faction_economy;
drop policy if exists "fe_ins" on public.faction_economy;
drop policy if exists "fe_upd" on public.faction_economy;
drop policy if exists "fe_del" on public.faction_economy;
create policy "fe_sel" on public.faction_economy for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "fe_ins" on public.faction_economy for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "fe_upd" on public.faction_economy for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "fe_del" on public.faction_economy for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- colonies, colony_buildings: колонии и постройки
do $$
declare t text;
begin
  foreach t in array array['colonies','colony_buildings'] loop
    execute format('drop policy if exists "ec_sel" on public.%I', t);
    execute format('drop policy if exists "ec_ins" on public.%I', t);
    execute format('drop policy if exists "ec_upd" on public.%I', t);
    execute format('drop policy if exists "ec_del" on public.%I', t);
    execute format('create policy "ec_sel" on public.%I for select to public using (true)', t);
    execute format('create policy "ec_ins" on public.%I for insert to authenticated with check (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
    execute format('create policy "ec_upd" on public.%I for update to authenticated using (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor'')) with check (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
    execute format('create policy "ec_del" on public.%I for delete to authenticated using (owner_id = auth.uid() or public.current_user_role() in (''superadmin'',''editor''))', t);
  end loop;
end$$;

-- unit_production: армия / очередь производства
drop policy if exists "up_sel" on public.unit_production;
drop policy if exists "up_ins" on public.unit_production;
drop policy if exists "up_upd" on public.unit_production;
drop policy if exists "up_del" on public.unit_production;
create policy "up_sel" on public.unit_production for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "up_ins" on public.unit_production for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "up_upd" on public.unit_production for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "up_del" on public.unit_production for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- colony_projects: терраформ / стройка / habitat
drop policy if exists "cp_sel" on public.colony_projects;
drop policy if exists "cp_ins" on public.colony_projects;
drop policy if exists "cp_del" on public.colony_projects;
create policy "cp_sel" on public.colony_projects for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "cp_ins" on public.colony_projects for insert to authenticated
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "cp_del" on public.colony_projects for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- faction_applications: анкеты (правка/удаление фракций стаффом)
drop policy if exists "fa_update" on public.faction_applications;
drop policy if exists "fa_delete" on public.faction_applications;
create policy "fa_update" on public.faction_applications for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));
create policy "fa_delete" on public.faction_applications for delete to authenticated
  using ((owner_id = auth.uid() and status = 'draft')
         or public.current_user_role() in ('superadmin','editor'));

-- map_systems: вкладка «Территория» (захват/освобождение систем)
drop policy if exists "write" on public.map_systems;
create policy "write" on public.map_systems for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 3) Диагностика (посмотреть, как реально хранятся роли) ───
-- Раскомментируйте и выполните отдельно, чтобы увидеть «сырые» значения ролей:
--   select user_id, role, is_banned from public.user_roles order by role;
-- Проверить свою нормализованную роль (под нужным аккаунтом):
--   select public.current_user_role();
