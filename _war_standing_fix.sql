-- ============================================================
-- ВОЙНА, ФИКС: ОККУПАЦИЯ И БОИ ДЛЯ УЖЕ СТОЯЩИХ ФЛОТОВ
--
-- БАГ (срезы 2-3): и оккупация, и завязка боя проверялись ТОЛЬКО в момент
-- приземления флота — внутри цикла _fleet_settle по флотам со status='transit'.
-- Флот, который УЖЕ стоит в системе, никакого перехода не совершает, поэтому:
--   • стоишь во вражеской системе — оккупация не поднимается;
--   • стоишь в одной системе с вражеским флотом — бой не начинается;
--   • война объявлена ПОСЛЕ того, как флоты разошлись по местам — вообще
--     ничего не происходит, пока кто-нибудь куда-нибудь не полетит.
--
-- ЛЕЧЕНИЕ: обход текущих позиций (_war_sweep) — смотрим, ГДЕ флоты стоят
-- сейчас, а не кто куда только что прилетел. Зовём его из тех же ленивых
-- точек, что и _fleet_settle: при обращении к флотам, боям и карте.
--
-- Применять в Supabase → SQL Editor ПОСЛЕ:
--   _war_declare.sql → _war_borders_occupation.sql → _war_intercept.sql →
--   _war_battle.sql → ЭТОТ ФАЙЛ (последним из военных).
-- ?v=20260718war6
-- ============================================================

-- ── 1) Обход стоящих флотов ──────────────────────────────────
-- Для каждого idle-флота фракции: сначала бой (если рядом враг),
-- иначе оккупация. Порядок тот же, что в _fleet_settle: система под
-- боем не оккупируется — сначала победи.
--
-- Дёшево: работаем только по своим idle-флотам (обычно единицы), выходим
-- сразу, если фракция ни с кем не воюет. Это важно для бюджета Disk I/O —
-- функция дёргается на каждом обращении к карте и кабинету.
create or replace function public._war_sweep(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; foe uuid; b uuid;
begin
  if p_fid is null then return; end if;
  -- Нет активных войн у фракции — ничего проверять не надо.
  if not exists(select 1 from public.war_sides s
                  join public.wars w on w.id = s.war_id
                 where s.fid = p_fid and w.status = 'active') then
    return;
  end if;

  for fl in select id, system_id from public.fleets
             where faction_id = p_fid and status = 'idle' and system_id is not null
  loop
    -- Флот, уже скованный боем, пропускаем: он своё отвоёвывает.
    if public._fleet_in_battle(fl.id) is not null then continue; end if;

    -- ПОДВЕЗЁННОЕ ПОДКРЕПЛЕНИЕ: в этой системе уже идёт МОЙ бой → вливаем
    -- флот в него. Без этого привезённые корабли не попадали в battle_fleets,
    -- а значит и в резерв (battle_pool) — «подвези подкрепление» не работало.
    select b2.id into b from public.battles b2
     where b2.system_id = fl.system_id and b2.status <> 'done'
       and (b2.attacker_fid = p_fid or b2.defender_fid = p_fid)
     limit 1;
    if b is not null then
      insert into public.battle_fleets(battle_id, fleet_id, fid, side)
        values (b, fl.id, p_fid,
                case when (select attacker_fid from public.battles where id=b) = p_fid
                     then 'attacker' else 'defender' end)
      on conflict (battle_id, fleet_id) do nothing;
      continue;
    end if;

    foe := public._war_hostile_fleet(p_fid, fl.system_id);
    if foe is not null then
      b := public._war_engage(fl.id, foe, fl.system_id, 'meeting');
    else
      perform public._war_occupy_check(p_fid, fl.system_id, fl.id);
    end if;
  end loop;
end$$;
revoke all on function public._war_sweep(text) from public;

-- ── 2) _fleet_settle — НАДМНОЖЕСТВО _war_intercept.sql ───────
-- Логика перехвата и стопа на границе сохранена дословно; в конце добавлен
-- обход стоящих флотов, чтобы прилёт одного флота «расшевелил» и остальные.
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare fl record; path text[]; stop_sys text; i int; foe uuid; hit text; b uuid;
begin
  for fl in select id, from_sys, dest_sys from public.fleets
            where faction_id=p_fid and status='transit' and arrive_at <= now()
  loop
    -- стоп по закрытым границам
    stop_sys := fl.dest_sys;
    if public._borders_blocked(p_fid, fl.dest_sys) then
      path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, true);
      if path is null then
        path := public._fleet_path(fl.from_sys, fl.dest_sys, p_fid, false);
      end if;
      stop_sys := coalesce(fl.from_sys, fl.dest_sys);
      if path is not null then
        for i in 2..array_length(path, 1) loop
          exit when public._borders_blocked(p_fid, path[i]);
          stop_sys := path[i];
        end loop;
      end if;
    end if;

    -- перехват на маршруте
    foe := null; hit := null;
    if stop_sys is distinct from fl.from_sys then
      path := public._fleet_path(fl.from_sys, stop_sys, p_fid, true);
      if path is null then path := public._fleet_path(fl.from_sys, stop_sys, p_fid, false); end if;
      if path is not null then
        for i in 2..array_length(path, 1) loop
          foe := public._war_hostile_fleet(p_fid, path[i]);
          if foe is not null then hit := path[i]; exit; end if;
        end loop;
      end if;
    end if;
    if hit is not null then stop_sys := hit; end if;

    update public.fleets
      set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
          depart_at=null, arrive_at=null
      where id = fl.id;

    if foe is null then foe := public._war_hostile_fleet(p_fid, stop_sys); end if;
    if foe is not null then
      b := public._war_engage(fl.id, foe, stop_sys,
             case when hit is not null then 'intercept' else 'meeting' end);
    end if;
    if foe is null then
      perform public._war_occupy_check(p_fid, stop_sys, fl.id);
    end if;
  end loop;

  -- НОВОЕ: разобраться с флотами, которые никуда не летели, но стоят там,
  -- где теперь идёт война.
  perform public._war_sweep(p_fid);
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── 3) Точки, где обход обязан отрабатывать ──────────────────
-- Карта: игрок открыл слой оккупации — состояние должно быть свежим.
create or replace function public.occupations_all()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text;
begin
  -- Обход по СВОИМ флотам: чужие оккупации поднимет их владелец, когда
  -- откроет карту или кабинет. Иначе один запрос тянул бы весь сектор.
  begin
    fid := public._ec_my_fid();
    perform public._fleet_settle(fid);   -- settle + sweep
  exception when others then null;        -- гость/без фракции — просто читаем
  end;

  begin
    delete from public.system_occupation o
     where not public.at_war(o.occupier_fid, o.owner_fid);
  exception when undefined_function then null; end;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'system_id', o.system_id,
      'occupier', o.occupier_fid,
      'occupier_name', public._war_nm(o.occupier_fid),
      'occupier_color', (select mf.color from public.map_factions mf where mf.id = o.occupier_fid),
      'owner', o.owner_fid,
      'owner_name', public._war_nm(o.owner_fid),
      'since', o.since) order by o.since desc)
    from public.system_occupation o), '[]'::jsonb);
end$$;
revoke all on function public.occupations_all() from public;
grant execute on function public.occupations_all() to authenticated;

-- ── 4) Разовая раскрутка для УЖЕ стоящих флотов ──────────────
-- Прогоняем обход по всем фракциям, у которых есть активные войны: без
-- этого флоты, припаркованные до наката фикса, ждали бы первого вылета.
do $$
declare f text;
begin
  for f in select distinct s.fid from public.war_sides s
             join public.wars w on w.id = s.war_id where w.status = 'active'
  loop
    begin
      perform public._war_sweep(f);
    exception when others then null;   -- одна кривая фракция не валит всю раскрутку
    end;
  end loop;
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- 0) Привезти новый флот в систему, где идёт мой бой → он появляется в
--    резерве (battle_pool) и его можно вызвать подкреплением.
-- 1) Два враждебных флота УЖЕ стоят в одной системе (никто никуда не летел):
--    после наката — строка в battles, во вкладке «Война» блок «Идут сражения».
-- 2) Свой флот стоит во вражеской системе, боя нет → строка в
--    system_occupation, слой карты «Оккупация» рисует флаг.
-- 3) select * from public.system_occupation;  select * from public.battles;
--    — должны быть непустыми там, где флоты реально стоят.
