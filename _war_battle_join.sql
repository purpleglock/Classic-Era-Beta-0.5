-- ============================================================
-- ВСТУПЛЕНИЕ В ИДУЩИЙ БОЙ НА КАРТЕ
--
-- ЗАЧЕМ. Прилетевшая в систему боя держава, состоящая в этой войне, должна
-- ВСТУПАТЬ в сражение на своей стороне — а не стоять рядом. До этого файла:
--   • battles знает ровно два fid (attacker_fid/defender_fid);
--   • реестр сторон battle_allies существует (_fc_bot_arena), и _bt_side его
--     читает — но на КАРТЕ в него не писал никто: он заполнялся только ареной
--     клуба и доктриной бота. Вступить в бой на карте было физически нечем;
--   • _war_sweep вливал флот только если фракция — один из двух главных fid;
--   • _fleet_settle_restore ставил третью сторону в системе боя (блокада) —
--     это была остановка вместо присоединения. Здесь исправляется.
--
-- ЧТО ЗДЕСЬ.
--   1) _war_side_for  — на чьей стороне этого боя данная держава (по войне
--      боя, затем по at_war). null = решать игроку, автоматом не втягиваем.
--   2) _war_join_battle — вступление: battle_allies + battle_fleets + лента.
--   3) _war_sweep      — стоящий флот вливается и в СОЮЗНЫЙ бой, не только в свой.
--   4) _fleet_settle   — прилёт в систему боя = вступление (а не блокада).
--   5) RLS + battles_mine — бой видят и союзники, иначе вступивший его не увидит.
--
-- ПОСЛЕ ВСТУПЛЕНИЯ. Корабли союзника попадают в battle_pool и вводятся
-- battle_reinforce — тот пускает борт только СВЕЖИМ ходом (стоит все
-- активации), то есть подкрепление вступает в дело со следующего хода.
-- Пока союзник не вывел ни одного борта, он не значится в _bt_side_actors
-- и не задерживает очередь ходов.
--
-- Применять: node tools/db_run.js _war_battle_join.sql
-- ПОСЛЕ: _war_intercept.sql → _war_standing_fix.sql → _fc_bot_arena.sql →
--        _fleet_settle_restore.sql → ЭТОТ ФАЙЛ.
-- ?v=20260813join
-- ============================================================

-- ── 1) Моя сторона в ЧУЖОМ бою ──────────────────────────────
-- Порядок: главный участник → уже записанный союзник → война этого боя →
-- отношения at_war. Воюю с обеими сторонами или ни с одной → null:
-- в мясорубку сама по себе держава не лезет.
create or replace function public._war_side_for(p_battle uuid, p_fid text)
returns text language plpgsql stable security definer set search_path=public as $$
declare b public.battles; my text; sa text; sd text; wa boolean; wd boolean;
begin
  if p_fid is null then return null; end if;
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return null; end if;

  if p_fid = b.attacker_fid then return 'attacker'; end if;
  if p_fid = b.defender_fid then return 'defender'; end if;

  select a.side into my from public.battle_allies a
   where a.battle_id = p_battle and a.fid = p_fid;
  if my is not null then return my; end if;

  -- по войне, из-за которой идёт бой
  if b.war_id is not null then
    select s.side into my from public.war_sides s where s.war_id = b.war_id and s.fid = p_fid;
    select s.side into sa from public.war_sides s where s.war_id = b.war_id and s.fid = b.attacker_fid;
    select s.side into sd from public.war_sides s where s.war_id = b.war_id and s.fid = b.defender_fid;
    if my is not null then
      if my is not distinct from sa and my is distinct from sd then return 'attacker'; end if;
      if my is not distinct from sd and my is distinct from sa then return 'defender'; end if;
    end if;
  end if;

  -- бой без войны (перехват до объявления и т.п.) — по отношениям
  begin select public.at_war(p_fid, b.attacker_fid) into wa;
  exception when undefined_function then wa := false; end;
  begin select public.at_war(p_fid, b.defender_fid) into wd;
  exception when undefined_function then wd := false; end;
  if coalesce(wa,false) and not coalesce(wd,false) then return 'defender'; end if;
  if coalesce(wd,false) and not coalesce(wa,false) then return 'attacker'; end if;

  return null;
end$$;
revoke all on function public._war_side_for(uuid,text) from public;

-- ── 2) Вступить в бой, идущий в системе ─────────────────────
-- Возвращает id боя, если флот вступил (или уже был в нём), иначе null.
-- Держава, не являющаяся главным участником, записывается в battle_allies.
create or replace function public._war_join_battle(p_fid text, p_sys text, p_fleet uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare r record; sd text; fresh boolean; sysname text; foe_name text;
begin
  if p_fid is null or p_sys is null or p_fleet is null then return null; end if;

  for r in select b.* from public.battles b
            where b.system_id = p_sys and b.status <> 'done'
            order by b.created_at
  loop
    sd := public._war_side_for(r.id, p_fid);
    if sd is null then continue; end if;   -- не моя война — следующий бой

    -- Новичок на стороне? Запоминаем ДО вставки: главные участники в
    -- battle_allies не пишутся, им и объявляться незачем.
    fresh := (p_fid not in (r.attacker_fid, r.defender_fid))
             and not exists(select 1 from public.battle_allies a
                             where a.battle_id = r.id and a.fid = p_fid);

    if p_fid not in (r.attacker_fid, r.defender_fid) then
      insert into public.battle_allies(battle_id, fid, side, ready)
        values (r.id, p_fid, sd, false)
      on conflict (battle_id, fid) do nothing;
    end if;

    insert into public.battle_fleets(battle_id, fleet_id, fid, side)
      values (r.id, p_fleet, p_fid, sd)
    on conflict (battle_id, fleet_id) do nothing;

    if fresh then
      select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;
      foe_name := public._war_nm(case when sd = 'attacker' then r.defender_fid else r.attacker_fid end);
      perform public._bt_log(r.id, format('%s вступает в бой на стороне %s.',
        public._war_nm(p_fid),
        public._war_nm(case when sd = 'attacker' then r.attacker_fid else r.defender_fid end)));
      perform public._war_news(
        '⚔ В бой вступает третья сила: ' || sysname,
        format('Флоты %s выходят из прыжка в системе %s и с ходу принимают сторону против %s. Расклад сил меняется.',
               public._war_nm(p_fid), sysname, foe_name),
        jsonb_build_array(p_fid, r.attacker_fid, r.defender_fid));
    else
      perform public._bt_log(r.id, format('%s подводит подкрепление.', public._war_nm(p_fid)));
    end if;

    return r.id;
  end loop;

  return null;
end$$;
revoke all on function public._war_join_battle(text,text,uuid) from public;

-- ── 3) _war_sweep — вливаться и в СОЮЗНЫЙ бой ───────────────
-- Отличие от _war_standing_fix: поиск боя «где я один из двух главных»
-- заменён на _war_join_battle, который знает и про battle_allies.
create or replace function public._war_sweep(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; foe uuid; b uuid;
begin
  if p_fid is null then return; end if;
  if not exists(select 1 from public.war_sides s
                  join public.wars w on w.id = s.war_id
                 where s.fid = p_fid and w.status = 'active') then
    return;
  end if;

  for fl in select id, system_id from public.fleets
             where faction_id = p_fid and status = 'idle' and system_id is not null
  loop
    if public._fleet_in_battle(fl.id) is not null then continue; end if;

    -- идёт бой, который меня касается → вступаем (свой или союзный)
    b := public._war_join_battle(p_fid, fl.system_id, fl.id);
    if b is not null then continue; end if;

    foe := public._war_hostile_fleet(p_fid, fl.system_id);
    if foe is not null then
      b := public._war_engage(fl.id, foe, fl.system_id, 'meeting');
    else
      perform public._war_occupy_check(p_fid, fl.system_id, fl.id);
    end if;
  end loop;
end$$;
revoke all on function public._war_sweep(text) from public;

-- ── 4) _fleet_settle — прилёт в систему боя = ВСТУПЛЕНИЕ ────
-- Надмножество _fleet_settle_restore.sql. Единственная правка — блок 2.2:
-- бой поперёк дороги больше не «стоп», а «стоп И вступил, если это моя война».
-- Блокада остаётся ровно для случая, когда стороны нет (_war_side_for = null):
-- воюю с обеими сторонами разом или ни с одной — дальше не пущу, но и в чужую
-- мясорубку не потащу.
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  fl record; path text[]; stop_sys text; i int; idx int; paid int; flown int;
  foe uuid; hit text; b uuid; hz jsonb; wiped boolean; cap numeric; joined uuid;
begin
  for fl in select id, from_sys, dest_sys, route, fuel, fuel_cap, composition
              from public.fleets
             where faction_id = p_fid and status = 'transit' and arrive_at <= now()
  loop
    path := null;
    if fl.route is not null and jsonb_typeof(fl.route) = 'array'
       and jsonb_array_length(fl.route) > 1 then
      path := array(select jsonb_array_elements_text(fl.route));
    end if;
    if path is null then
      path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, true);
      if path is null then
        path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, false);
      end if;
    end if;
    paid := coalesce(array_length(path, 1) - 1, public._fleet_jumps(fl.from_sys, fl.dest_sys));

    -- 4.1 стоп по закрытым границам
    stop_sys := fl.dest_sys;
    if public._borders_blocked(p_fid, fl.dest_sys) then
      stop_sys := coalesce(fl.from_sys, fl.dest_sys);
      if path is not null then
        for i in 2..array_length(path, 1) loop
          exit when public._borders_blocked(p_fid, path[i]);
          stop_sys := path[i];
        end loop;
      end if;
    end if;

    -- 4.2 заграждения / перехват / бой поперёк дороги
    foe := null; hit := null; wiped := false;
    if path is not null and stop_sys is distinct from fl.from_sys then
      for i in 2..array_length(path, 1) loop
        hz := public._hazard_pass(fl.id, p_fid, path[i]);
        if coalesce((hz->>'wiped')::boolean, false) then
          wiped := true; hit := path[i]; exit;
        end if;
        foe := public._war_hostile_fleet(p_fid, path[i]);
        if foe is not null then hit := path[i]; exit; end if;
        -- бой в системе: моя война → встану и вступлю (втягивание ниже,
        -- после посадки — флоту сперва нужно оказаться в системе);
        -- не моя → просто дальше не пройду.
        if exists(select 1 from public.battles bb
                   where bb.system_id = path[i] and bb.status <> 'done')
           and (public._war_battle_block(p_fid, path[i])
                or exists(select 1 from public.battles bb
                           where bb.system_id = path[i] and bb.status <> 'done'
                             and public._war_side_for(bb.id, p_fid) is not null))
        then
          hit := path[i]; exit;
        end if;
      end loop;
    end if;
    if hit is not null then stop_sys := hit; end if;
    if wiped then continue; end if;

    -- 4.3 возврат непройденных плеч в бак
    flown := paid;
    if path is not null then
      idx := array_position(path, stop_sys);
      if idx is not null then flown := idx - 1; end if;
    end if;
    cap := coalesce(fl.fuel_cap, public._fleet_cap_for(fl.composition));

    -- 4.4 посадка
    update public.fleets
       set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
           depart_at=null, arrive_at=null, route=null, route_at=null,
           fuel = least(cap, coalesce(fuel, 0) + greatest(0, paid - flown)),
           fuel_cap = cap
     where id = fl.id;

    -- 4.5 идёт бой и это моя война → ВСТУПАЕМ (свой, союзный, любой)
    joined := public._war_join_battle(p_fid, stop_sys, fl.id);
    if joined is not null then continue; end if;

    -- 4.6 иначе — обычная встреча/перехват
    if foe is null then foe := public._war_hostile_fleet(p_fid, stop_sys); end if;
    if foe is not null then
      b := public._war_engage(fl.id, foe, stop_sys,
             case when hit is not null then 'intercept' else 'meeting' end);
    end if;

    if foe is null then
      perform public._war_occupy_check(p_fid, stop_sys, fl.id);
    end if;
  end loop;

  perform public._war_sweep(p_fid);
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── 5) Бой видят и союзники ─────────────────────────────────
-- Без этого вступивший в бой не увидел бы ни его самого, ни своих флотов:
-- политики знали только двух главных участников.
drop policy if exists battles_read on public.battles;
create policy battles_read on public.battles for select to authenticated
  using (attacker_fid = public._ec_my_fid()
      or defender_fid = public._ec_my_fid()
      or exists(select 1 from public.battle_allies a
                 where a.battle_id = id and a.fid = public._ec_my_fid()));

drop policy if exists battle_fleets_read on public.battle_fleets;
create policy battle_fleets_read on public.battle_fleets for select to authenticated
  using (exists(select 1 from public.battles b
                 where b.id = battle_id
                   and (b.attacker_fid = public._ec_my_fid()
                     or b.defender_fid = public._ec_my_fid()
                     or exists(select 1 from public.battle_allies a
                                where a.battle_id = b.id and a.fid = public._ec_my_fid()))));

-- ── 6) battles_mine — показывать и союзные бои ──────────────
-- my_side берём через _bt_side (он знает battle_allies), список врагов —
-- противоположная сторона целиком, а не «второй главный fid».
create or replace function public.battles_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_fid text;
begin
  v_fid := public._ec_my_fid();
  perform public._fleet_settle(v_fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'system_id', b.system_id,
      'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
      'status', b.status, 'kind', b.kind,
      'my_side', public._bt_side(b.id, v_fid),
      'ally', (v_fid not in (b.attacker_fid, b.defender_fid)),
      'foe', case when public._bt_side(b.id, v_fid) = 'attacker' then b.defender_fid else b.attacker_fid end,
      'foe_name', public._war_nm(case when public._bt_side(b.id, v_fid) = 'attacker'
                                      then b.defender_fid else b.attacker_fid end),
      'allies', (select coalesce(jsonb_agg(jsonb_build_object(
                          'fid', a.fid, 'name', public._war_nm(a.fid), 'side', a.side)), '[]'::jsonb)
                 from public.battle_allies a where a.battle_id = b.id),
      'my_fleets', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)), '[]'::jsonb)
                    from public.battle_fleets bf join public.fleets f on f.id = bf.fleet_id
                    where bf.battle_id = b.id and bf.fid = v_fid),
      'created_at', b.created_at) order by b.created_at desc)
    from public.battles b
    where b.status <> 'done'
      and (b.attacker_fid = v_fid or b.defender_fid = v_fid
        or exists(select 1 from public.battle_allies a where a.battle_id = b.id and a.fid = v_fid))
  ), '[]'::jsonb);
end$$;
revoke all on function public.battles_mine() from public;
grant execute on function public.battles_mine() to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Бой А↔Б в системе X. Держава В воюет с Б на стороне А. Флот В садится
--    в X → battle_allies(В,'сторона А'), battle_fleets(флот В), в ленте боя
--    «вступает в бой», в новостях «третья сила». battles_mine у В видит бой.
-- 2) Корабли В доступны в battle_pool(бой, В) и вводятся battle_reinforce
--    свежим ходом → в дело со следующего хода.
-- 3) Держава Г воюет и с А, и с Б (или ни с кем) → _war_side_for = null:
--    флот встаёт в X, в бой не втягивается (блокада как была).
-- 4) Нейтрал летит сквозь X → проходит насквозь.
