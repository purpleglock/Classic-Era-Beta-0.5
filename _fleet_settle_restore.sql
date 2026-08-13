-- ============================================================
-- ВОССТАНОВЛЕНИЕ ВОЕННОГО СЛОЯ ПОСАДКИ ФЛОТА
--
-- ЧТО СЛУЧИЛОСЬ. _fleet_route.sql (маршруты по трассам, 13.08) переопределил
-- _fleet_settle голой версией — «поставить флот в dest_sys». Вместе с ней из
-- живой базы пропало ВСЁ, что висело на посадке:
--   • перехват на маршруте (флот пролетал сквозь врага насквозь);
--   • стоп на закрытой границе;
--   • проход через заграждения (мины/дроны, _hazard_pass);
--   • завязывание боя (_war_engage) — а он звался ТОЛЬКО из _war_sweep,
--     и _war_sweep звался ТОЛЬКО из _fleet_settle: цепочка оборвана;
--   • вливание подвезённого флота в идущий бой (подкрепления);
--   • проверка оккупации.
-- Побочка: Легион не мог напасть — _legion_engage намеренно не фабрикует
-- строку battles из крона, он материализует флот и ждёт обычного перехвата.
--
-- ЧТО ЗДЕСЬ. _fleet_settle собран заново как НАДМНОЖЕСТВО трёх версий:
--   маршрутной (_fleet_route)  — сброс route/route_at, счёт плеч по маршруту;
--   военной   (_war_standing_fix) — границы, перехват, бой, sweep, оккупация;
--   минной    (_mines_drones_rework) — _hazard_pass по пути.
--
-- ДВА СОДЕРЖАТЕЛЬНЫХ ИЗМЕНЕНИЯ ПРОТИВ СТАРОГО КОДА:
--
-- 1) СНАБЖЕНИЕ. fleet_send списывает топливо ВПЕРЁД за весь маршрут
--    (fuel = have - jumps). Раньше это было безобидно: флот всегда долетал.
--    С перехватом флот встаёт на полпути — и платил бы за прыжки, которых
--    не сделал. Теперь непройденные плечи ВОЗВРАЩАЮТСЯ в бак. Цена похода
--    не изменилась, изменилась честность: платишь за пройденное.
--
-- 2) БЛОКАДА. Раньше система с идущим боем не мешала пролёту: _war_hostile_fleet
--    намеренно пропускает флоты, уже скованные боем (иначе один флот стопорил бы
--    сектор двумя боями). Из-за этого сквозь сражение можно было пройти как через
--    пустое место. Теперь _war_battle_block: если в системе идёт бой с участием
--    того, с кем я воюю, — флот ВСТАЁТ там. Не втягивается в чужой бой (стороны
--    не резиновые), просто дальше не идёт. Свой бой в этой системе → _war_sweep
--    вольёт флот подкреплением, как и раньше.
--
-- ⚠ fleet_send под гейтом прав _fm_gates (fleet_send → fleet_send__raw).
--   Здесь он НЕ трогается — _fleet_settle внутренняя, обёртку не рвёт,
--   звать _fm_wrap не нужно.
--
-- Применять: node tools/db_run.js _fleet_settle_restore.sql
-- ПОСЛЕ: _war_intercept.sql → _war_standing_fix.sql → _fleet_route.sql →
--        _fleet_tank.sql → ЭТОТ ФАЙЛ.
-- ?v=20260813settle
-- ============================================================

-- ── 1) Блокада: в системе идёт бой, и я в нём чужой ──────────
-- true, если в p_sys есть незаконченный бой, в котором p_fid НЕ сторона,
-- но с одной из сторон p_fid в состоянии войны. Свой бой блокадой не считается:
-- туда флот вливается подкреплением через _war_sweep.
create or replace function public._war_battle_block(p_fid text, p_sys text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare r record; w boolean;
begin
  if p_fid is null or p_sys is null then return false; end if;
  for r in select b.attacker_fid a, b.defender_fid d from public.battles b
            where b.system_id = p_sys and b.status <> 'done'
  loop
    -- своя драка — не блокада
    if p_fid in (r.a, r.d) then continue; end if;
    begin
      select public.at_war(p_fid, r.a) into w;
    exception when undefined_function then w := false; end;
    if coalesce(w, false) then return true; end if;
    begin
      select public.at_war(p_fid, r.d) into w;
    exception when undefined_function then w := false; end;
    if coalesce(w, false) then return true; end if;
  end loop;
  return false;
end$$;
revoke all on function public._war_battle_block(text,text) from public;

-- ── 2) _fleet_settle ────────────────────────────────────────
-- Порядок разбора маршрута важен и сохранён от _war_intercept:
--   граница режет маршрут → потом заграждения/перехват/блокада внутри
--   уже урезанного куска. Перехват не может унести флот ДАЛЬШЕ, чем
--   пустила граница.
create or replace function public._fleet_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare
  fl     record;
  path   text[];
  stop_sys text;
  i      int;
  idx    int;
  paid   int;
  flown  int;
  foe    uuid;
  hit    text;
  b      uuid;
  hz     jsonb;
  wiped  boolean;
  cap    numeric;
begin
  for fl in select id, from_sys, dest_sys, route, fuel, fuel_cap, composition
              from public.fleets
             where faction_id = p_fid and status = 'transit' and arrive_at <= now()
  loop
    -- 2.0 Маршрут, которым флот реально летел. Опора — сохранённый route
    -- (его проложил fleet_send), и только если его нет — считаем заново.
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

    -- Сколько плеч уже оплачено вылетом (fleet_send списал вперёд).
    paid := coalesce(array_length(path, 1) - 1, public._fleet_jumps(fl.from_sys, fl.dest_sys));

    -- 2.1 стоп по закрытым границам
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

    -- 2.2 идём по маршруту до stop_sys: заграждения, перехват, блокада.
    -- Первое сработавшее — конечная.
    foe := null; hit := null; wiped := false;
    if path is not null and stop_sys is distinct from fl.from_sys then
      for i in 2..array_length(path, 1) loop
        -- мины/дроны на трассе
        hz := public._hazard_pass(fl.id, p_fid, path[i]);
        if coalesce((hz->>'wiped')::boolean, false) then
          wiped := true; hit := path[i]; exit;
        end if;
        -- вражеский заслон → перехват
        foe := public._war_hostile_fleet(p_fid, path[i]);
        if foe is not null then hit := path[i]; exit; end if;
        -- чужое сражение поперёк дороги → дальше хода нет
        if public._war_battle_block(p_fid, path[i]) then
          hit := path[i]; exit;
        end if;
        exit when path[i] = stop_sys;
      end loop;
    end if;
    if hit is not null then stop_sys := hit; end if;

    -- Флот сгинул на заграждениях целиком — сажать нечего.
    if wiped then continue; end if;

    -- 2.3 СНАБЖЕНИЕ: вернуть в бак плечи, которых флот не пролетел.
    flown := paid;
    if path is not null then
      idx := array_position(path, stop_sys);
      if idx is not null then flown := idx - 1; end if;
    end if;
    cap := coalesce(fl.fuel_cap, public._fleet_cap_for(fl.composition));

    -- 2.4 посадка
    update public.fleets
       set status='idle', system_id=stop_sys, from_sys=null, dest_sys=null,
           depart_at=null, arrive_at=null, route=null, route_at=null,
           fuel = least(cap, coalesce(fuel, 0) + greatest(0, paid - flown)),
           fuel_cap = cap
     where id = fl.id;

    -- 2.5 бой: перехват на трассе либо встреча в точке прибытия
    if foe is null then foe := public._war_hostile_fleet(p_fid, stop_sys); end if;
    if foe is not null then
      b := public._war_engage(fl.id, foe, stop_sys,
             case when hit is not null then 'intercept' else 'meeting' end);
    end if;

    -- 2.6 оккупация. Систему, где идёт бой, НЕ занимаем: сначала выиграй.
    if foe is null then
      perform public._war_occupy_check(p_fid, stop_sys, fl.id);
    end if;
  end loop;

  -- 2.7 Прилёт одного флота «расшевеливает» остальные: стоящие вливаются
  -- подкреплением в свой бой, встречают врага, поднимают флаг.
  perform public._war_sweep(p_fid);
end$$;
revoke all on function public._fleet_settle(text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- 1) Война А↔Б, флот Б стоит в X на трассе А→Y. fleet_send(А, Y):
--    по прилёте флот А в X (не в Y), battles kind='intercept',
--    в ленте «🛑 Перехват», в баке вернулись плечи X→Y.
-- 2) Повторный fleet_send того же флота → «флот скован боем» (триггер
--    battle_lock_fleet из _war_intercept).
-- 3) Второй флот А прилетает в X → _war_sweep вливает его в battle_fleets,
--    он виден в battle_pool и вызывается через battle_reinforce (свежим ходом).
-- 4) Флот В (воюет с А) летит СКВОЗЬ X, где идёт бой А↔Б → встаёт в X,
--    в чужой бой не втягивается.
-- 5) Нейтрал летит сквозь X → проходит насквозь, как и раньше.
-- 6) Легион материализует флот у игрока → при следующем обращении к флотам
--    завязывается бой (kind='meeting'), а не «стоит рядом и молчит».
