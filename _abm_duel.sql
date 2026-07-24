-- ============================================================
-- ПРО: «ОКНО ПЕРЕХВАТА» — МНОГООСЕВАЯ дуэль вместо склада снарядов
-- Применять ПОСЛЕ _defense_planetary.sql. Идемпотентно, катится повторно.
-- Порядок с _interstellar_artillery.sql / _doom_shells.sql / _mza.sql НЕ важен:
-- все резолвы зовут перехват через to_regprocedure('public._abm_intercept(text,int)').
--
-- ЗАЧЕМ. Старая ПРО = склад снарядов на колонии: микроменеджмент. Первая версия
-- дуэли = один выбор из трёх с каждой стороны — по сути монетка. Слишком тонко.
-- Теперь дуэль идёт по НЕСКОЛЬКИМ скрытым осям, и перехват требует совпадения по
-- ВСЕМ активным осям сразу — это уже блеф, а не угадайка.
--
-- ОСИ ДУЭЛИ (атакующий задаёт, защитник угадывает, всё скрыто друг от друга):
--   1) approach — траектория: low / high / decoy (3 варианта);
--   2) window   — окно подлёта: early / late (2 варианта, «раньше/позже» в рамках ETA);
--   3) target   — планета-цель: активна ТОЛЬКО если у защитника ≥2 колонии в системе
--                 (иначе цель очевидна и угадывать нечего).
--   + FEINT — атакующий может выставить ЛОЖНЫЙ профиль (decoy-приманку). Тогда именно
--     он «утечёт» защите как отсеянная-наоборот подсказка: разведка отбросит честно
--     неверный вариант, а приманка останется в игре как правдоподобная ловушка.
--
-- ЧТО ДАЮТ СЛОТЫ ПРО (не боезапас, а РАЗВЕДКУ по осям, порогами):
--   ≥2 слота — narrow: отсеять один заведомо неверный профиль (approach → 2 из 3);
--   ≥4 слота — radar:  раскрыть ОКНО подлёта (early/late видно точно);
--   ≥6 слотов — clear: шанс взять чистую отметку (виден истинный approach) И
--                      раскрыть планету-цель.
--   Не зашёл до подлёта — сеть стреляет сама, малым шансом от числа слотов.
-- ============================================================

-- ── 1) Константы: суперсет всех ключей обороны + ключи дуэли ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    when 'mine_hex_max'          then 6
    when 'mine_hex_cost'         then 400
    when 'mine_hex_attrition'    then 0.05
    when 'mine_wear_hexes'       then 1
    when 'mine_refund_frac'      then 0.50
    when 'outpost_ship_cost'     then 2000
    when 'outpost_build_h'       then 24
    when 'outpost_cap'           then 20
    when 'outpost_refund'        then 0.50
    when 'outpost_mine_gc'       then 75
    when 'op_fly_h_min'          then 2
    when 'op_fly_h_max'          then 18
    when 'flak_per_slot'         then 0.15
    when 'flak_cap'              then 0.60
    -- окно перехвата
    when 'abm_narrow_slots'      then 2     -- слотов: отсеять один неверный профиль
    when 'abm_radar_slots'       then 4     -- слотов: раскрыть окно подлёта
    when 'abm_clear_slots'       then 6     -- слотов: чистая отметка + раскрытие цели
    when 'abm_clear_chance'      then 0.50  -- шанс чистой отметки при clear
    when 'abm_auto_per_slot'     then 0.06  -- авто-отработка без игрока: шанс за слот
    when 'abm_auto_cap'          then 0.30  -- потолок авто-отработки
    else null end
$$;

-- ── 2) Поля дуэли на залпе (обе стороны пишут ровно один раз) ──
alter table public.doom_salvos add column if not exists approach     text;        -- истинная траектория атакующего
alter table public.doom_salvos add column if not exists appr_window  text;        -- истинное окно подлёта early|late
alter table public.doom_salvos add column if not exists feint        text;        -- ложный профиль-приманка (необязателен)
alter table public.doom_salvos add column if not exists approach_at  timestamptz;
alter table public.doom_salvos add column if not exists def_approach text;         -- ставка защитника: траектория
alter table public.doom_salvos add column if not exists def_window   text;         -- ставка защитника: окно
alter table public.doom_salvos add column if not exists def_pid      int;          -- ставка защитника: планета
alter table public.doom_salvos add column if not exists def_pick_at  timestamptz;
alter table public.doom_salvos add column if not exists def_fid      text;         -- кто оборонялся
alter table public.doom_salvos add column if not exists duel_result  text;         -- 'pick'|'auto'|'miss'|'nocover'
-- Носитель-Гиперпейсер (дублируем _mza.sql, чтобы doom_salvos_mine работала при
-- любом порядке применения — залпы носителя тоже несут оси подхода).
alter table public.doom_salvos add column if not exists mza_id       uuid;

-- ── 3) Справочники осей ──
create or replace function public._abm_profiles()
returns text[] language sql immutable as $$ select array['low','high','decoy'] $$;
create or replace function public._abm_windows()
returns text[] language sql immutable as $$ select array['early','late'] $$;

-- Детерминированный «жребий» по залпу: одинаков при любом числе перечитываний,
-- поэтому подсказки не перекатываются от F5 к F5.
create or replace function public._abm_roll(p_salvo uuid, p_salt text)
returns int language sql immutable as $$
  select abs(hashtext(p_salvo::text || ':' || coalesce(p_salt,''))) % 100
$$;

-- Истинные значения осей: явно выбранное, иначе жребий (считается одинаково всегда).
create or replace function public._abm_approach(p_salvo uuid, p_set text)
returns text language sql immutable as $$
  select coalesce(p_set, (public._abm_profiles())[1 + public._abm_roll(p_salvo,'ap') % 3])
$$;
create or replace function public._abm_window(p_salvo uuid, p_set text)
returns text language sql immutable as $$
  select coalesce(p_set, (public._abm_windows())[1 + public._abm_roll(p_salvo,'win') % 2])
$$;

-- Профиль, который «отсеет» разведка (narrow): заведомо неверный И не приманка.
-- Если приманка задана — отбрасываем третий (честно неверный), приманка остаётся
-- ловушкой. Если нет — отбрасываем детерминированно выбранный неверный.
create or replace function public._abm_narrow_out(p_salvo uuid, p_real text, p_feint text)
returns text language sql immutable as $$
  select p from unnest(public._abm_profiles()) p
   where p <> p_real and (p_feint is null or p <> p_feint)
   order by public._abm_roll(p_salvo, 'narrow'||p)
   limit 1
$$;

-- Слоты ПРО державы p_fid в системе p_sys.
create or replace function public._abm_slots(p_fid text, p_sys text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select sum(greatest(coalesce(cb.slots_open,0),0))
                     from public.colony_buildings cb
                     join public.colonies c on c.id = cb.colony_id
                    where cb.faction_id = p_fid and cb.btype='abm' and c.system_id = p_sys), 0)
$$;

-- Сколько колоний защитника в системе-цели залпа (ось «планета» активна при ≥2).
create or replace function public._abm_targets(p_fid text, p_sys text)
returns int language sql stable security definer set search_path=public as $$
  select count(*)::int from public.colonies c
   where c.faction_id = p_fid and c.system_id = p_sys
$$;

-- ── 4) АТАКУЮЩИЙ: задать оси залпа (пока снаряд в полёте, один раз) ──
create or replace function public.doom_set_duel(
  p_salvo_id uuid, p_approach text, p_window text default null, p_feint text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; s public.doom_salvos;
begin
  fid := public._ec_my_fid();
  if not (p_approach = any(public._abm_profiles())) then raise exception 'bad approach'; end if;
  if p_window is not null and not (p_window = any(public._abm_windows())) then raise exception 'bad window'; end if;
  if p_feint is not null then
    if not (p_feint = any(public._abm_profiles())) then raise exception 'bad feint'; end if;
    if p_feint = p_approach then raise exception 'приманка не может совпадать с истинным профилем'; end if;
  end if;
  select * into s from public.doom_salvos where id = p_salvo_id and faction_id = fid for update;
  if not found then raise exception 'not your salvo'; end if;
  if s.status <> 'in_flight' then raise exception 'залп уже отработал — оси не изменить'; end if;
  if s.approach is not null then raise exception 'оси подхода уже заданы и не меняются'; end if;
  update public.doom_salvos
     set approach = p_approach,
         appr_window = coalesce(p_window, public._abm_window(s.id, null)),
         feint = p_feint,
         approach_at = now()
   where id = s.id;
  return jsonb_build_object('ok', true, 'approach', p_approach,
                            'window', coalesce(p_window, public._abm_window(s.id, null)), 'feint', p_feint);
end$$;
revoke all on function public.doom_set_duel(uuid,text,text,text) from public;
grant execute on function public.doom_set_duel(uuid,text,text,text) to authenticated;

-- Легаси-шим: старый клиент звал одноосевую doom_set_approach(salvo, profile).
create or replace function public.doom_set_approach(p_salvo_id uuid, p_profile text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.doom_set_duel(p_salvo_id, p_profile, null, null);
end$$;
revoke all on function public.doom_set_approach(uuid,text) from public;
grant execute on function public.doom_set_approach(uuid,text) to authenticated;

-- ── 5) ЗАЩИТНИК: входящие отметки по моим колониям + разведка по осям ──
create or replace function public.abm_incoming()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'salvo_id',   s.id,
      'system_id',  s.target_system_id,
      'planet',     s.target_planet,
      'pid',        s.target_pid,
      'ready_at',   s.ready_at,
      'slots',      d.slots,
      -- ставки защитника
      'my_approach', s.def_approach,
      'my_window',   s.def_window,
      'my_pid',      s.def_pid,
      -- ось «планета»: активна при ≥2 колониях; список кандидатов
      'needs_target', d.needs_target,
      'candidates',   d.candidates,
      -- разведка approach: 'clear' (виден истинный) | 'narrow' (один отсеян) | 'none'
      'ap_hint_kind',  d.ap_kind,
      'ap_hint_value', d.ap_value,
      -- разведка окна: раскрыто ли и что
      'window_known',  d.window_known,
      'window_value',  d.window_value,
      -- разведка цели: раскрыт ли pid
      'target_known',  d.target_known,
      'target_value',  d.target_value
    ) order by s.ready_at)
    from public.doom_salvos s
    join public.colonies c
      on c.system_id = s.target_system_id and c.planet_pid = s.target_pid and c.faction_id = fid
    cross join lateral (
      select
        sl.slots,
        (tg.n >= 2) as needs_target,
        (select jsonb_agg(jsonb_build_object('pid', cc.planet_pid, 'name', cc.planet_name)
                   order by cc.planet_name)
           from public.colonies cc
          where cc.faction_id = fid and cc.system_id = s.target_system_id) as candidates,
        -- approach
        case when sl.slots >= public._defense_const('abm_clear_slots')
                  and public._abm_roll(s.id,'clear') < public._defense_const('abm_clear_chance')*100
               then 'clear'
             when sl.slots >= public._defense_const('abm_narrow_slots') then 'narrow'
             else 'none' end as ap_kind,
        case when sl.slots >= public._defense_const('abm_clear_slots')
                  and public._abm_roll(s.id,'clear') < public._defense_const('abm_clear_chance')*100
               then public._abm_approach(s.id, s.approach)
             when sl.slots >= public._defense_const('abm_narrow_slots')
               then public._abm_narrow_out(s.id, public._abm_approach(s.id, s.approach), s.feint)
             else null end as ap_value,
        -- окно
        (sl.slots >= public._defense_const('abm_radar_slots')) as window_known,
        case when sl.slots >= public._defense_const('abm_radar_slots')
               then public._abm_window(s.id, s.appr_window) else null end as window_value,
        -- цель
        (sl.slots >= public._defense_const('abm_clear_slots') and tg.n >= 2) as target_known,
        case when sl.slots >= public._defense_const('abm_clear_slots') and tg.n >= 2
               then s.target_pid else null end as target_value
      from (select public._abm_slots(fid, s.target_system_id) as slots) sl
      cross join (select public._abm_targets(fid, s.target_system_id) as n) tg
    ) d
    where s.status = 'in_flight'
  ), '[]'::jsonb);
end$$;
revoke all on function public.abm_incoming() from public;
grant execute on function public.abm_incoming() to authenticated;

-- ── 6) ЗАЩИТНИК: навести сеть по осям (один раз, до подлёта) ──
--  approach обязателен; window и pid — если соответствующие оси активны.
create or replace function public.abm_set_defense(
  p_salvo_id uuid, p_approach text, p_window text default null, p_pid int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; s public.doom_salvos; ok boolean; n_targets int;
begin
  fid := public._ec_my_fid();
  if not (p_approach = any(public._abm_profiles())) then raise exception 'bad approach'; end if;
  if p_window is not null and not (p_window = any(public._abm_windows())) then raise exception 'bad window'; end if;
  select * into s from public.doom_salvos where id = p_salvo_id for update;
  if not found or s.status <> 'in_flight' then raise exception 'отметка уже отработала'; end if;

  select exists(select 1 from public.colonies c
                 where c.system_id = s.target_system_id and c.planet_pid = s.target_pid
                   and c.faction_id = fid) into ok;
  if not ok then raise exception 'это не ваша планета'; end if;
  if public._abm_slots(fid, s.target_system_id) <= 0 then
    raise exception 'в этой системе нет Комплекса ПРО — вести перехват нечем';
  end if;
  if s.def_approach is not null then raise exception 'сеть уже наведена — решение одно'; end if;

  n_targets := public._abm_targets(fid, s.target_system_id);
  if n_targets >= 2 and p_pid is null then raise exception 'укажите планету-цель'; end if;

  update public.doom_salvos
     set def_approach = p_approach,
         def_window   = coalesce(p_window, (public._abm_windows())[1]),  -- окно всегда фиксируем
         def_pid      = case when n_targets >= 2 then p_pid else s.target_pid end,
         def_pick_at  = now(), def_fid = fid
   where id = s.id;
  return jsonb_build_object('ok', true, 'approach', p_approach, 'window', p_window, 'pid', p_pid);
end$$;
revoke all on function public.abm_set_defense(uuid,text,text,int) from public;
grant execute on function public.abm_set_defense(uuid,text,text,int) to authenticated;

-- Легаси-шим: старый одноосевой abm_pick(salvo, profile).
create or replace function public.abm_pick(p_salvo_id uuid, p_profile text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  return public.abm_set_defense(p_salvo_id, p_profile, null, null);
end$$;
revoke all on function public.abm_pick(uuid,text) from public;
grant execute on function public.abm_pick(uuid,text) to authenticated;

-- ── 7) РАЗБОР: тот же хук _abm_intercept(system,pid), что зовут все резолвы ──
create or replace function public._abm_intercept(p_system_id text, p_pid int)
returns boolean language plpgsql security definer set search_path=public as $$
declare s public.doom_salvos; owner_fid text; slots numeric; n_targets int;
        real_ap text; real_win text; hit boolean; matched boolean;
begin
  select c.faction_id into owner_fid from public.colonies c
   where c.system_id = p_system_id and c.planet_pid = p_pid limit 1;
  if owner_fid is null then return false; end if;

  slots := public._abm_slots(owner_fid, p_system_id);

  select * into s from public.doom_salvos
   where target_system_id = p_system_id and target_pid = p_pid and status = 'in_flight'
   order by ready_at limit 1;

  if slots <= 0 then
    if found then update public.doom_salvos set duel_result='nocover' where id = s.id; end if;
    return false;                                  -- нечем прикрывать
  end if;
  if not found then return false; end if;          -- нечего перехватывать

  real_ap  := public._abm_approach(s.id, s.approach);
  real_win := public._abm_window(s.id, s.appr_window);
  n_targets := public._abm_targets(owner_fid, p_system_id);

  if s.def_approach is not null then
    -- Игрок принял решение сам: перехват — только если совпали ВСЕ активные оси.
    matched := (s.def_approach = real_ap)
           and (s.def_window is null or s.def_window = real_win)
           and (n_targets < 2 or s.def_pid = s.target_pid);
    hit := matched;
    update public.doom_salvos set duel_result = case when hit then 'pick' else 'miss' end
     where id = s.id;
  else
    -- Игрок не зашёл: сеть отрабатывает автоматически, вполсилы.
    hit := public._abm_roll(s.id,'auto')
           < least(public._defense_const('abm_auto_cap'),
                   slots * public._defense_const('abm_auto_per_slot')) * 100;
    update public.doom_salvos set duel_result = case when hit then 'auto' else 'miss' end
     where id = s.id;
  end if;
  return hit;
end$$;
revoke all on function public._abm_intercept(text,int) from public;
grant execute on function public._abm_intercept(text,int) to authenticated;

-- ── 8) Хроника дуэлей: чем кончились отработавшие отметки ──
create or replace function public.abm_log()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'salvo_id', s.id, 'planet', s.target_planet, 'system_id', s.target_system_id,
      'at', s.resolved_at, 'result', s.duel_result,
      'approach', s.approach, 'window', s.appr_window,
      'def_approach', s.def_approach, 'def_window', s.def_window, 'status', s.status
    ) order by s.resolved_at desc)
    from public.doom_salvos s
    where s.status <> 'in_flight' and s.duel_result is not null
      and (s.def_fid = fid or s.victim_fid = fid)
    limit 12
  ), '[]'::jsonb);
end$$;
revoke all on function public.abm_log() from public;
grant execute on function public.abm_log() to authenticated;

-- ── 9) Сводка планетарной обороны для UI: боезапаса больше нет ──
create or replace function public.planet_defense_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'colony_id', cb.colony_id, 'building_id', cb.id, 'btype', cb.btype,
      'slots', cb.slots_open))
    from public.colony_buildings cb
    where cb.faction_id = fid and cb.btype in ('flak','abm')
  ), '[]'::jsonb);
end$$;
revoke all on function public.planet_defense_status() from public;
grant execute on function public.planet_defense_status() to authenticated;

-- ── 10) Старые склады снарядов больше не участвуют: обнуляем, поля оставляем ──
update public.colony_buildings set ammo = 0, ammo_pending = 0, ammo_ready = null
 where btype = 'abm' and (coalesce(ammo,0) <> 0 or coalesce(ammo_pending,0) <> 0);

create or replace function public.abm_buy_ammo(p_colony_id uuid, p_qty int)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'снаряды ПРО отменены: перехват ведётся вручную в «Окне перехвата» (обновите страницу)';
end$$;
revoke all on function public.abm_buy_ammo(uuid,int) from public;
grant execute on function public.abm_buy_ammo(uuid,int) to authenticated;

-- ── 11) Мои залпы в полёте с осями подхода (пульт Длани и карточка Гиперпейсера) ──
--  Отдаёт оси обеим платформам: gun_id — стационарная «Длань», mza_id — Гиперпейсер.
create or replace function public.doom_salvos_mine()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'gun_id', s.gun_id,
      'mza_id', s.mza_id,
      'approach', s.approach, 'window', s.appr_window, 'feint', s.feint,
      'ready_at', s.ready_at, 'target_planet', s.target_planet))
    from public.doom_salvos s
    where s.faction_id = fid and s.status = 'in_flight'
  ), '[]'::jsonb);
end$$;
revoke all on function public.doom_salvos_mine() from public;
grant execute on function public.doom_salvos_mine() to authenticated;
