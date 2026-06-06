-- ============================================================
-- ПОЛНОЕ УДАЛЕНИЕ ФРАКЦИИ — атомарная RPC для суперадминов/эдиторов.
-- Удаляет: шпионские миссии, производство юнитов, постройки,
--          колонии, экономику, дизайны, запись на карте, анкету.
-- Сбрасывает роль владельца player → viewer (может подать заново).
-- Запустить в Supabase → SQL Editor
-- ============================================================

create or replace function public.admin_delete_faction(p_faction_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner_id uuid; v_owner_email text; v_name text;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  -- Сохраняем данные владельца/имя до удаления анкеты
  select owner_id, owner_email, name into v_owner_id, v_owner_email, v_name
    from public.faction_applications
    where faction_id = p_faction_id
    limit 1;

  -- Аудит: фиксируем, чью анкету удалили (требует таблицы из _admin_users.sql)
  insert into public.faction_deletions (faction_id, faction_name, owner_id, owner_email, deleted_by)
    values (p_faction_id, coalesce(v_name, p_faction_id), v_owner_id, v_owner_email, auth.jwt() ->> 'email');

  -- Игровые данные (порядок по FK-зависимостям).
  -- Внимание: у части таблиц колонка фракции называется НЕ faction_id:
  --   spy_missions → actor_fid / target_fid
  --   trade_routes → a_fid / b_fid
  --   loans        → lender_fid / borrower_fid
  delete from public.spy_missions     where actor_fid  = p_faction_id or target_fid   = p_faction_id;
  delete from public.trade_routes     where a_fid      = p_faction_id or b_fid        = p_faction_id;
  delete from public.loans            where lender_fid = p_faction_id or borrower_fid = p_faction_id;
  delete from public.unit_production  where faction_id = p_faction_id;
  delete from public.colony_buildings where faction_id = p_faction_id;
  delete from public.colonies         where faction_id = p_faction_id;
  delete from public.faction_economy  where faction_id = p_faction_id;
  delete from public.faction_units    where faction_id = p_faction_id;

  -- Карта: FK map_systems.faction → map_factions(id) ON DELETE SET NULL
  -- автоматически зачищает faction во всех системах фракции
  delete from public.map_factions where id = p_faction_id;

  -- Анкета (регистрация)
  delete from public.faction_applications where faction_id = p_faction_id;

  -- Роль: player → viewer, чтобы владелец мог подать новую анкету
  if v_owner_id is not null then
    update public.user_roles
      set role = 'viewer'
      where user_id = v_owner_id and role = 'player';
  end if;
end$$;

revoke all on function public.admin_delete_faction(text) from public;
grant execute on function public.admin_delete_faction(text) to authenticated;
