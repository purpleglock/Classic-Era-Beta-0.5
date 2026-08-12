-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🧠 ИИ: РУБЕЖ ПО ГЛАЗАМ, А НЕ ПО СТВОЛУ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_ai_brain.sql и _bot_doctrine.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Легион вставал по кромке доски и не делал НИЧЕГО —
-- тринадцать ходов без единого выстрела.
--
-- 1) РУБЕЖ СЧИТАЛСЯ ОТ ДАЛЬНОСТИ ОРУДИЙ. _bt_bot_band брал 80% от рубежа
--    борта: у пиратского рейдера ствол на 30 клеток → рубеж 24. А сенсор у
--    него 13, у катеров и вовсе 6. То есть борт честно вставал на 24 клетки
--    и оттуда не видел НИКОГО: цели нет — стрелять не по кому, а режим
--    «держать рубеж» гнал его ещё дальше, к самому краю. Стрелять дальше,
--    чем видишь, нельзя — теперь рубеж режется по глазам СТОРОНЫ (лучший
--    сенсор минус две клетки) и общим потолком в 14.
--
-- 2) «СТОЯТЬ» БЫЛО РАЗРЕШЕНО БЕЗ ЦЕЛИ. Борт, которому не по кому стрелять,
--    выбирал 'stand' просто потому, что дистанция уже меньше рубежа. Стоять,
--    когда стрелять не по кому, — это не позиционка, а простой: если цели
--    нет, борт идёт на сближение, пока она не появится. Исключений два —
--    отступление подранка и выдержка до общего захода (до 4-го хода).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. РУБЕЖ ПО ГЛАЗАМ ──────────────────────────────────────────────
-- Видит сторона, а не борт в одиночку: разведчик подсвечивает цель всем.
-- Поэтому берём ЛУЧШИЙ сенсор на стороне, а не свой собственный.
create or replace function public._bt_bot_eyes(p_battle uuid, p_side text)
returns int language sql stable security definer set search_path=public as $$
  select greatest(4, coalesce((select max(m.sensor) from public.battle_units m
                                where m.battle_id = p_battle and m.side = p_side and m.alive), 8));
$$;
revoke all on function public._bt_bot_eyes(uuid,text) from public;

create or replace function public._bt_bot_band(p_battle uuid, p_unit uuid)
returns int language plpgsql stable security definer set search_path=public as $fn$
declare u record; reach int; role text; band int; eyes int;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null then return 2; end if;
  reach := public._bt_bot_reach(p_unit);
  role  := public._bt_bot_role(p_battle, p_unit);
  band  := case role
    when 'sniper'  then greatest(4, floor(reach * 0.80)::int)
    when 'skirm'   then greatest(2, floor(reach * 0.70)::int)
    when 'support' then greatest(3, least(6, floor(reach * 0.60)::int))
    else 1 end;

  -- дальше собственных глаз рубеж не имеет смысла: цель нужно ВИДЕТЬ
  eyes := public._bt_bot_eyes(p_battle, u.side) - 2;
  return greatest(1, least(band, greatest(3, eyes), 14));
end$fn$;
revoke all on function public._bt_bot_band(uuid,uuid) from public;

-- ── 2. НЕТ ЦЕЛИ — ИДЁМ ИСКАТЬ ───────────────────────────────────────
create or replace function public._bt_bot_act(p_battle uuid, p_unit uuid, p_fid text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare u record; role text; band int; mode text; did boolean := false;
        m jsonb; tgt uuid; path jsonb; reserve numeric; i int; hpq numeric;
        near int; threat numeric; foe_reach int; has_tgt boolean;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive then return false; end if;

  role := public._bt_bot_role(p_battle, p_unit);
  band := public._bt_bot_band(p_battle, p_unit);
  hpq  := coalesce(u.hp,0) / greatest(1, coalesce(u.max_hp,1));
  select coalesce(min(public._bt_dist(u.x, u.y, e.x, e.y)), 999) into near
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  threat := public._bt_threat_at(p_battle, u.side, u.x, u.y, false);
  select coalesce(max(greatest(1, e.rng)), 1) into foe_reach
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  has_tgt := public._bt_bot_target(p_battle, p_unit) is not null;

  -- ОТСТУПЛЕНИЕ: борт на последних процентах под сосредоточенным огнём
  -- уходит, а не разменивается — уцелевший корпус ещё повоюет.
  if hpq < 0.35 and threat > (u.hp + u.shield) * 0.5 then
    mode := 'back'; band := greatest(band, public._bt_bot_reach(p_unit) + 3);
  elsif not public._bt_bot_committed(p_battle)
        and role in ('brawler','skirm') and foe_reach <= 12 and not has_tgt then
    -- ВЫДЕРЖКА: пока строй не собрался, ждём на шаг дальше чужого залпа
    mode := 'stand'; band := greatest(band, foe_reach + 1);
  elsif not has_tgt then
    -- стрелять не по кому: стоять незачем, идём искать цель
    mode := 'close';
  elsif role = 'brawler' then
    mode := 'close';
  elsif near > band + 2 then
    mode := 'close';
  else
    mode := 'stand';
  end if;

  reserve := case when not u.fired and has_tgt
                  then public._bt_fire_cost(u.cls) else 0 end;

  for i in 1..2 loop
    m := public._bt_bot_module(p_battle, p_unit, reserve);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  select * into u from public.battle_units where id = p_unit;
  if u.alive and not u.moved then
    path := public._bt_bot_route(p_battle, p_unit, mode, band);
    if coalesce(jsonb_array_length(path), 0) > 0 then
      begin
        perform public._bt_do_move(p_battle, p_unit, path, p_fid);
        did := true;
        perform public._bt_seen_arm(p_battle, u.side);
      exception when others then null; end;
    end if;
  end if;

  tgt := public._bt_bot_target(p_battle, p_unit);
  if tgt is not null then
    begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
    exception when others then null; end;
  else
    tgt := public._bt_bot_repair(p_battle, p_unit);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
      exception when others then null; end;
    end if;
  end if;

  for i in 1..3 loop
    m := public._bt_bot_module(p_battle, p_unit, 0);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  select * into u from public.battle_units where id = p_unit;
  if u.alive and coalesce(u.wings,0) > 0 and not u.is_wing and near <= 10 then
    begin perform public._bt_do_launch(p_battle, p_unit, p_fid); did := true;
    exception when others then null; end;
  end if;

  return did;
end$fn$;
revoke all on function public._bt_bot_act(uuid,uuid,text) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select unit_name, public._bt_bot_role(b,id), public._bt_bot_band(b,id)
--     from battle_units where battle_id = '<battle>' and side='defender';
