-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 11: НА ДОСКУ ВЫХОДЯТ ДОБРОВОЛЬНО
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_moves_on.sql, перед _angel_lock.sql.
--   node tools/db_run.js _angel_no_conscript.sql
--   node tools/db_run.js _angel_lock.sql
-- Идемпотентно.
--
-- ЖАЛОБА: «то есть он опять прибудет в Микони и будет бой?!». Да, и это была
-- дыра, а не задумка. Разбор по фактам той системы:
--   • Микони — ДОМ игрока: 8 колоний. «Пусть флот отступит» — пустой совет;
--   • `_angel_pick_target` правило 1 сортирует цели по числу вражеских
--     колоний, так что Микони — первый кандидат, как только выпадет из памяти
--     похода на 12 систем;
--   • `_war_sweep` (_war_standing_fix.sql) цепляет ЛЮБОЙ стоящий флот, если в
--     системе враг. Флот игрока выводили на доску против того, кого флотом
--     убить нельзя ПО ЗАМЫСЛУ (_angel_battle.sql), — и так каждый прилёт.
-- Итог: шаги 9-10 сменили вечное зависание на регулярную мясорубку. Лечить
-- надо не сроки возврата, а само правило встречи.
--
-- ПРАВИЛО. «С ангелом не сражаются. От него бегут» — это записано в замысле
-- первой строкой. Значит бой на доске с ковчегом не может НАЧАТЬСЯ сам собой:
-- на него выходят. Стоящий флот больше не втягивают — он держит орбиту, и
-- ангел его не трогает.
--
-- ⚠️ ЭТО НЕ ДЕЛАЕТ АНГЕЛА БЕЗЗУБЫМ. Он и не был флотским противником: держава
-- получает от него не абордаж, а «Длань» по колониям (_angel_doom) и «Сполох»
-- по флотам в прыжке (_angel_hunter) — оба слоя работают без всякой доски и
-- этим файлом не тронуты. Стоящий флот цел, но система под обстрелом.
--
-- ⚠️ И НЕ ДЕЛАЕТ ЕГО НЕУЯЗВИМЫМ. Печати по-прежнему рвутся Дланью и
-- Гиперпейсером (_angel_shells.sql); поймать его на доске по-прежнему можно —
-- через дверь ниже. Разница одна: теперь это выбор игрока, а не наряд.
--
-- ⚠️ ЗАБРАКОВАНО: делать исключение в `_war_sweep`. Точек, заводящих бой,
-- восемь (_fleet_settle, _war_sweep, _legion_standoff, _legion_intercept,
-- мины, join…), и все сходятся в `_war_engage`. Правим одну дверь.
-- ════════════════════════════════════════════════════════════

-- ── 1. НАМЕРЕНИЕ ────────────────────────────────────────────
-- Признак «этот бой завязывает живой человек кнопкой». Локальная настройка
-- транзакции: снаружи её выставить нельзя — PostgREST шлёт запросы своей
-- сессией, а set_config(..., true) живёт до конца вызова.
create or replace function public._angel_engage_meant()
returns boolean language sql stable as $$
  select coalesce(current_setting('angel.engage', true), '') = '1'
$$;

-- ── 2. САМ БОЙ НЕ ЗАВЯЗЫВАЕТСЯ ──────────────────────────────
-- Дословный _war_intercept.sql, плюс ранний выход по ангелу.
create or replace function public._war_engage(p_mover_fleet uuid, p_foe_fleet uuid, p_sys text, p_kind text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare a_fid text; d_fid text; b uuid; wid uuid; sysname text;
begin
  select faction_id into a_fid from public.fleets where id = p_mover_fleet;
  select faction_id into d_fid from public.fleets where id = p_foe_fleet;
  if a_fid is null or d_fid is null or a_fid = d_fid then return null; end if;

  -- ◈ ПРЕСТОЛ: на доску с ним выходят добровольно. Ни прилёт, ни обход
  -- стоящих флотов, ни перехват на трассе боя с ковчегом не заводят.
  -- ⚠️ Уже идущий бой это НЕ трогает: ниже мы просто не создаём новый.
  begin
    if (public._angel_is(a_fid) or public._angel_is(d_fid))
       and not public._angel_engage_meant() then
      return null;
    end if;
  exception when undefined_function then null; end;

  select b2.id into b from public.battles b2
   where b2.system_id = p_sys and b2.status <> 'done'
     and ((b2.attacker_fid = a_fid and b2.defender_fid = d_fid)
       or (b2.attacker_fid = d_fid and b2.defender_fid = a_fid))
   limit 1;

  if b is null then
    select w.id into wid from public.wars w
      join public.war_sides sa on sa.war_id = w.id and sa.fid = a_fid
      join public.war_sides sd on sd.war_id = w.id and sd.fid = d_fid and sd.side <> sa.side
     where w.status = 'active' limit 1;
    insert into public.battles(system_id, war_id, attacker_fid, defender_fid, kind)
      values (p_sys, wid, a_fid, d_fid, coalesce(p_kind,'meeting'))
      returning id into b;

    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = p_sys;
    perform public._war_news(
      (case when p_kind = 'intercept' then '🛑 Перехват: ' else '⚔ Столкновение флотов: ' end) || sysname,
      public._news_pick(array[
        format('Флоты %s и %s сходятся в системе %s. Отступать некуда — бой неизбежен.',
               public._war_nm(a_fid), public._war_nm(d_fid), sysname),
        format('В %s замечены встречные курсы: корабли %s наткнулись на заслон %s. Начинается сражение.',
               sysname, public._war_nm(a_fid), public._war_nm(d_fid)),
        format('%s перехвачена силами %s в системе %s. Орудия расчехлены.',
               public._war_nm(a_fid), public._war_nm(d_fid), sysname)
      ]),
      jsonb_build_array(a_fid, d_fid));
  end if;

  -- Втягиваем оба флота (повторный вызов безвреден).
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    select b, p_mover_fleet, a_fid,
           case when (select attacker_fid from public.battles where id=b) = a_fid then 'attacker' else 'defender' end
  on conflict (battle_id, fleet_id) do nothing;
  insert into public.battle_fleets(battle_id, fleet_id, fid, side)
    select b, p_foe_fleet, d_fid,
           case when (select attacker_fid from public.battles where id=b) = d_fid then 'attacker' else 'defender' end
  on conflict (battle_id, fleet_id) do nothing;
  return b;
end$function$;
revoke all on function public._war_engage(uuid,uuid,text,text) from public;

-- ── 3. ДВЕРЬ: ВЫЙТИ НАВСТРЕЧУ ───────────────────────────────
-- Единственный способ оказаться с ковчегом на одной доске. Никаких проверок
-- «а стоит ли» — это выбор державы, и он её собственный.
create or replace function public.angel_engage(p_fleet uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl record; af text; ark record; b uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  select * into fl from public.fleets where id = p_fleet;
  if fl.id is null or fl.faction_id is distinct from fid then
    return jsonb_build_object('ok', false, 'why', 'это не ваш флот');
  end if;
  if fl.status <> 'idle' or fl.system_id is null then
    return jsonb_build_object('ok', false, 'why', 'флот в пути');
  end if;
  if public._fleet_in_battle(fl.id) is not null then
    return jsonb_build_object('ok', false, 'why', 'флот уже в бою');
  end if;

  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', false, 'why', 'цели нет'); end if;
  select f.* into ark from public.fleets f
    join public.angel_state a on a.fleet_id = f.id
   where a.faction_id = af and f.status = 'idle' and f.system_id = fl.system_id;
  if ark.id is null then
    return jsonb_build_object('ok', false, 'why', 'в этой системе его нет');
  end if;

  -- Война оформляется по факту: разговаривать с той стороной не о чем.
  begin
    if not public.at_war(af, fid) then perform public._angel_declare(fid); end if;
  exception when others then null; end;

  perform set_config('angel.engage', '1', true);
  b := public._war_engage(fl.id, ark.id, fl.system_id, 'meeting');
  perform set_config('angel.engage', '0', true);
  if b is null then return jsonb_build_object('ok', false, 'why', 'сойтись не вышло'); end if;

  -- Ковчег выходит на доску сразу: совещаться ему не с кем.
  begin perform public.angel_battle_deploy(b); exception when others then null; end;

  perform public._bt_log(b, public._angel_glitch(
    '◈ Приказ отдан. Курс на сближение. Дальномер держит отметку', 0.24)
    || ' ' || public._angel_scream(9));

  return jsonb_build_object('ok', true, 'battle', b);
end$$;
revoke all on function public.angel_engage(uuid) from public, anon;
grant execute on function public.angel_engage(uuid) to authenticated;

-- ── 4. РАЗБОР НАРЯДОВ ───────────────────────────────────────
-- Бои, куда флоты согнали обходом, а не приказом, закрываем: они начались по
-- правилу, которого больше нет.
do $$
declare af text; r record; n int := 0;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  for r in select b.id from public.battles b
            where b.status <> 'done' and (b.attacker_fid = af or b.defender_fid = af)
  loop
    begin perform public._angel_slip(r.id); n := n + 1;
    exception when others then raise notice 'battle % : %', r.id, sqlerrm; end;
  end loop;
  raise notice 'angel conscript battles closed: %', n;
end$$;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Ковчег садится в систему с чужим флотом → войну объявляет, боя на доске
--    НЕТ, сводки «Столкновение флотов» нет, флот игрока стоит и цел.
-- 2) `select angel_engage('<флот>')` → бой заводится, ковчег на доске.
-- 3) Обычные две державы: встречи, перехваты, обход стоящих — как были.
-- 4) «Длань» и «Сполох» ангела бьют по колониям и флотам как раньше.
