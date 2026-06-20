-- ============================================================
-- ПЕРЕДАЧА / ОСВОБОЖДЕНИЕ ГОСУДАРСТВА (без удаления страны)
--
-- Две независимые админ-функции (superadmin/editor):
--   1) admin_vacate_faction  — СНЯТЬ игрока с государства. Страна остаётся
--      целой (анкета, карта, экономика, колонии, армия, дизайны), но без
--      владельца («бесхозная»). Бывший владелец → роль viewer (сможет подать
--      новую анкету). Никаких игровых данных не удаляется.
--   2) admin_assign_faction  — ПОСТАВИТЬ другого игрока за государство НА
--      ПОСТОЯНКУ (передача). Переназначает owner_id во ВСЕХ игровых таблицах
--      фракции, выдаёт новому игроку роль player; прежний владелец (если был)
--      сбрасывается на viewer. Один игрок = одно государство (проверка).
--
-- «Вход в чужой кабинет без снятия игрока» делается на клиенте (стафф уже
-- проходит RLS на чтение любой фракции) — здесь только смена владельца.
--
-- Выполнить целиком в Supabase → SQL Editor (после _delete_faction.sql).
-- ============================================================

-- ── Внутренний помощник: переназначить владельца всех игровых строк фракции ──
-- p_owner = null → освободить (vacate); иначе — назначить нового владельца.
-- Опциональные модули (вера/шпионаж) защищены to_regclass — если таблица не
-- создана в этом окружении, шаг пропускается.
create or replace function public._admin_reassign_owner(p_faction_id text, p_owner uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ядро экономики/анкеты (всегда есть)
  update public.faction_applications set owner_id = p_owner, owner_email = p_email where faction_id = p_faction_id;
  update public.faction_economy      set owner_id = p_owner, owner_email = p_email where faction_id = p_faction_id;
  update public.colonies             set owner_id = p_owner where faction_id = p_faction_id;
  update public.colony_buildings     set owner_id = p_owner where faction_id = p_faction_id;
  update public.colony_projects      set owner_id = p_owner where faction_id = p_faction_id;
  update public.unit_production       set owner_id = p_owner where faction_id = p_faction_id;
  update public.faction_units         set owner_id = p_owner where faction_id = p_faction_id;

  -- опциональные модули
  if to_regclass('public.spy_agents') is not null then
    execute 'update public.spy_agents set owner_id = $1 where faction_id = $2' using p_owner, p_faction_id;
  end if;
  if to_regclass('public.faith_membership') is not null then
    execute 'update public.faith_membership set owner_id = $1 where faction_id = $2' using p_owner, p_faction_id;
  end if;
  if to_regclass('public.faiths') is not null then
    execute 'update public.faiths set founder_owner = $1 where founder_fid = $2' using p_owner, p_faction_id;
  end if;
end$$;
revoke all on function public._admin_reassign_owner(text, uuid, text) from public;

-- ── 1) Снять игрока с государства (страна остаётся) ─────────
create or replace function public.admin_vacate_faction(p_faction_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_owner uuid; v_email text; v_name text;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  select owner_id, owner_email, name into v_owner, v_email, v_name
    from public.faction_applications where faction_id = p_faction_id limit 1;
  if not found then raise exception 'faction not found: %', p_faction_id; end if;

  -- освобождаем владельца во всех таблицах (страна цела, но бесхозна)
  perform public._admin_reassign_owner(p_faction_id, null, null);

  -- бывший владелец → viewer, если больше не владеет ни одной одобренной анкетой
  if v_owner is not null
     and not exists (select 1 from public.faction_applications
                     where owner_id = v_owner and status = 'approved') then
    update public.user_roles set role = 'viewer'
      where user_id = v_owner and role = 'player';
  end if;

  return jsonb_build_object(
    'faction_id', p_faction_id, 'name', v_name,
    'prev_owner_id', v_owner, 'prev_owner_email', v_email
  );
end$$;
revoke all on function public.admin_vacate_faction(text) from public;
grant execute on function public.admin_vacate_faction(text) to authenticated;

-- ── 2) Поставить другого игрока за государство (передача) ────
create or replace function public.admin_assign_faction(p_faction_id text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_old uuid; v_name text; v_email text;
begin
  if public.current_user_role() not in ('superadmin', 'editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  select email::text into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'user not found'; end if;

  select owner_id, name into v_old, v_name
    from public.faction_applications where faction_id = p_faction_id limit 1;
  if not found then raise exception 'faction not found: %', p_faction_id; end if;

  -- один игрок = одно государство: цель не должна владеть ДРУГОЙ одобренной анкетой
  if exists (select 1 from public.faction_applications
             where owner_id = p_user_id and status = 'approved'
               and faction_id is distinct from p_faction_id) then
    raise exception 'target user already owns an approved faction';
  end if;

  -- прежний владелец (если другой) → viewer (если не владеет иной одобренной анкетой)
  if v_old is not null and v_old <> p_user_id
     and not exists (select 1 from public.faction_applications
                     where owner_id = v_old and status = 'approved'
                       and faction_id is distinct from p_faction_id) then
    update public.user_roles set role = 'viewer'
      where user_id = v_old and role = 'player';
  end if;

  -- переназначить владельца во всех игровых таблицах фракции
  perform public._admin_reassign_owner(p_faction_id, p_user_id, v_email);

  -- роль нового игрока: viewer → player (выше по иерархии — superadmin/editor/moderator — не понижаем)
  update public.user_roles set role = 'player'
    where user_id = p_user_id and role = 'viewer';
  if not found and not exists (select 1 from public.user_roles where user_id = p_user_id) then
    insert into public.user_roles (user_id, role) values (p_user_id, 'player');
  end if;

  return jsonb_build_object(
    'faction_id', p_faction_id, 'name', v_name,
    'prev_owner_id', v_old,
    'new_owner_id', p_user_id, 'new_owner_email', v_email
  );
end$$;
revoke all on function public.admin_assign_faction(text, uuid) from public;
grant execute on function public.admin_assign_faction(text, uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Снять игрока:   select public.admin_vacate_faction('fac_xxxx');
--    → owner_id анкеты/экономики = null, бывший владелец снова viewer.
-- 2) Передать:       select public.admin_assign_faction('fac_xxxx', '<uuid-игрока>');
--    → owner_id во всех таблицах = новый игрок, у него роль player.
