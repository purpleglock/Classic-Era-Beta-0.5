-- ============================================================
-- УДАЛЕНИЕ ФРАКЦИИ: ПОЛНАЯ ДОЧИСТКА ХВОСТОВ (v2)
--
-- Проблема: живая _faction_purge_tails() была РУЧНЫМ списком таблиц
-- (вера, залпы, оккупация, войны, флоты). Всё, что не попало в список,
-- оставалось на карте и в мире: посты дронов, минные поля, аванпосты,
-- армии, турели, лоты в Синли-бее, рабы, ставки клуба и т.д.
--
-- Решение — ДИНАМИКА: один проход по ВСЕМ таблицам public, у которых
-- есть текстовая колонка-ссылка на фракцию ('faction_id' | 'faction' |
-- 'fid' | '%_fid'). Новые таблицы покрываются сами.
--
-- Два режима на колонку:
--   del  — строка ПРИНАДЛЕЖИТ фракции → удалить;
--   null — колонка лишь ССЫЛАЕТСЯ на фракцию у чужой строки
--          (победитель боя, происхождение рабов, патрон разлома,
--          фракция персонажа) → обнулить, строку сохранить.
-- Режим null берётся только для nullable-колонок из списка «происхождения»;
-- всё остальное — del. Это защищает живых: например faction_economy
-- с rift_patron_fid мёртвой фракции НЕ должна удаляться.
--
-- Синтетические fid ('bot', 'club', 'legion', 'npc_*') НЕ трогаем:
-- цель — только id формата 'fac_%', которых нет ни в map_factions,
-- ни в faction_applications.
-- ============================================================

-- ── 1) Реестр фракц-колонок с режимом ─────────────────────────
-- Сигнатуры поменялись (добавлен mode, purge_tails возвращает счётчик).
drop function if exists public._faction_ref_columns();
drop function if exists public._faction_purge_tails(text);

create or replace function public._faction_ref_columns()
returns table(tbl text, col text, mode text)
language sql stable security definer set search_path = public
as $$
  select c.table_name::text,
         c.column_name::text,
         case when c.is_nullable = 'YES' and c.column_name in (
                'faction','winner_fid','victim_fid','def_fid','origin_fid',
                'orig_fid','prev_fid','patron_fid','faith_fid','covenant_fid',
                'map_fid','rift_patron_fid','bot_fid')
              then 'null' else 'del' end
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = 'public' and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.data_type = 'text'
    and (c.column_name in ('faction_id','faction','fid')
         or c.column_name like '%\_fid')
    and c.table_name not in ('faction_applications','faction_deletions',
                             'faction_audit','map_factions')
    and c.table_name not like '%\_log'
    and c.table_name not like '%\_audit'
$$;
revoke all on function public._faction_ref_columns() from public;

-- ── 2) Снести все хвосты ОДНОЙ фракции ────────────────────────
create or replace function public._faction_purge_tails(p_faction_id text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare rec record; pass int; progressed boolean; n bigint; total bigint := 0;
begin
  for pass in 1..8 loop
    progressed := false;
    for rec in select tbl, col, mode from public._faction_ref_columns() loop
      begin
        if rec.mode = 'null' then
          execute format('update public.%I set %I = null where %I = $1',
                         rec.tbl, rec.col, rec.col) using p_faction_id;
        else
          execute format('delete from public.%I where %I = $1',
                         rec.tbl, rec.col) using p_faction_id;
        end if;
        get diagnostics n = row_count;
        if n > 0 then progressed := true; total := total + n; end if;
      exception
        when foreign_key_violation then progressed := true;  -- добьём следующим проходом
        when others then raise notice 'skip %.%: %', rec.tbl, rec.col, sqlerrm;
      end;
    end loop;
    exit when not progressed;
  end loop;

  -- Война без двух сторон — закончилась.
  if to_regclass('public.wars') is not null and to_regclass('public.war_sides') is not null then
    update public.wars w set status = 'done', ended_at = coalesce(w.ended_at, now())
     where w.status = 'active'
       and (select count(distinct s.side) from public.war_sides s where s.war_id = w.id) < 2;
  end if;

  return total;
end$$;
revoke all on function public._faction_purge_tails(text) from public;

-- ── 3) Сброс «бедности» по системам без владельца ─────────────
create or replace function public._system_econ_clear_orphans()
returns int
language plpgsql security definer set search_path = public
as $$
declare n int := 0;
begin
  if to_regclass('public.system_econ') is null then return 0; end if;
  if to_regclass('public.map_systems') is null then return 0; end if;
  delete from public.system_econ se
    where not exists (
      select 1 from public.map_systems ms
      where ms.id = se.system_id and ms.faction is not null);
  get diagnostics n = row_count;
  return n;
end$$;
revoke all on function public._system_econ_clear_orphans() from public;

-- ── 4) Полное удаление фракции ────────────────────────────────
create or replace function public.admin_delete_faction(p_faction_id text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_owner_id uuid; v_owner_email text; v_name text;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;

  select owner_id, owner_email, name into v_owner_id, v_owner_email, v_name
    from public.faction_applications where faction_id = p_faction_id limit 1;

  insert into public.faction_deletions (faction_id, faction_name, owner_id, owner_email, deleted_by)
    values (p_faction_id, coalesce(v_name, p_faction_id), v_owner_id, v_owner_email, auth.jwt() ->> 'email');

  -- Реестр карты сносим ПЕРВЫМ: дальше фракция уже «мертва» для всех проверок.
  delete from public.map_factions where id = p_faction_id;

  -- Все хвосты по всем фракц-колонкам (динамически).
  perform public._faction_purge_tails(p_faction_id);

  perform public._system_econ_clear_orphans();

  delete from public.faction_applications where faction_id = p_faction_id;

  if v_owner_id is not null then
    update public.user_roles set role = 'viewer'
      where user_id = v_owner_id and role = 'player';
  end if;
end$$;
revoke all on function public.admin_delete_faction(text) from public;
grant execute on function public.admin_delete_faction(text) to authenticated;

-- ── 5) Дочистка ВСЕХ уже удалённых фракций ────────────────────
-- Только 'fac_%', которых нет ни в реестре карты, ни в анкетах.
create or replace function public._purge_orphan_factions()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare rec record; pass int; progressed boolean; n bigint; total bigint := 0; n_sys int := 0;
  -- ВАЖНО: format() нельзя смешивать нумерованные и обычные спецификаторы,
  -- поэтому нумеруем все: %1$I = таблица, %2$I = колонка.
  cond constant text := $c$ t.%2$I is not null and t.%2$I like 'fac\_%%'
        and not exists (select 1 from public.map_factions m where m.id = t.%2$I)
        and not exists (select 1 from public.faction_applications a where a.faction_id = t.%2$I) $c$;
begin
  for pass in 1..8 loop
    progressed := false;
    for rec in select tbl, col, mode from public._faction_ref_columns() loop
      begin
        if rec.mode = 'null' then
          execute format('update public.%1$I t set %2$I = null where' || cond, rec.tbl, rec.col);
        else
          execute format('delete from public.%1$I t where' || cond, rec.tbl, rec.col);
        end if;
        get diagnostics n = row_count;
        if n > 0 then progressed := true; total := total + n; end if;
      exception
        when foreign_key_violation then progressed := true;
        when others then raise notice 'skip %.%: %', rec.tbl, rec.col, sqlerrm;
      end;
    end loop;
    exit when not progressed;
  end loop;

  if to_regclass('public.wars') is not null and to_regclass('public.war_sides') is not null then
    update public.wars w set status = 'done', ended_at = coalesce(w.ended_at, now())
     where w.status = 'active'
       and (select count(distinct s.side) from public.war_sides s where s.war_id = w.id) < 2;
  end if;

  n_sys := public._system_econ_clear_orphans();
  return jsonb_build_object('rows', total, 'system_econ', n_sys);
end$$;
revoke all on function public._purge_orphan_factions() from public;

create or replace function public.admin_purge_orphans()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: superadmin/editor only';
  end if;
  return public._purge_orphan_factions();
end$$;
revoke all on function public.admin_purge_orphans() from public;
grant execute on function public.admin_purge_orphans() to authenticated;

-- ── 6) Разовая дочистка накопленных сирот ─────────────────────
select public._purge_orphan_factions();

drop function if exists public._orphan_scan();
