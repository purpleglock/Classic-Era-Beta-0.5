-- ============================================================
-- ПИРАТСТВО ЧЕРЕЗ ФЛОТЫ КАРТЫ (замена вкладки «Рейды»).
-- Применять ПОСЛЕ цепочки флотов/границ:
--   _army_fleet.sql → _fleet_ops.sql → _borders_closed.sql (даёт _fleet_path)
-- и после _raid_setup.sql/_raid_combat.sql (даёт raid_missions, patrol_ships,
-- _fac_name, _destroy_ships — часть используется здесь). Идемпотентно.
--
-- ИДЕЯ: подвёл СВОЙ флот (idle) к системе, через которую ПРОХОДИТ трасса чужого
-- каравана, — жмёшь «Грабить». Единственная проверка — ЗАМЕТИЛИ или НЕТ:
--   • НЕ заметили  → тихо угоняешь часть груза (ресурсы + ГС-надбавка);
--   • ЗАМЕТИЛИ     → добычи нет, отношения с целью падают, ей приходит новость
--                     с именем атакующего.
-- Боя/потерь кораблей НЕТ (в отличие от старых raid_missions): чистый стелс-чек.
-- Шанс детекта растёт от эскорта каравана + патруля цели + размера флота.
-- ============================================================

-- Кулдаун на флот, чтобы один флот не грабил в упор каждую секунду.
alter table public.fleets add column if not exists raid_cd_until timestamptz;

-- ── Проходит ли трасса каравана через систему p_sys? ─────────
-- Путь считаем по чистой топологии гиперпутей (respect=false): концы (origin/
-- dest) и все промежуточные системы. Флот, стоящий в любой из них, «на пути».
create or replace function public._route_passes(p_route_id text, p_sys text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare o text; d text; path text[];
begin
  select origin_sys, dest_sys into o, d from public.trade_routes where id = p_route_id::uuid;
  if o is null or d is null or p_sys is null then return false; end if;
  if p_sys = o or p_sys = d then return true; end if;
  path := public._fleet_path(o, d, null, false);
  if path is null then return false; end if;
  return p_sys = any(path);
end$$;
revoke all on function public._route_passes(text,text) from public;

-- ── Список чужих караванов, которые можно грабить этим флотом ─
-- Возвращает активные караваны ДРУГИХ держав, чья трасса проходит через систему,
-- где стоит мой флот (idle). Разведка НЕ требуется — конвой физически виден в
-- космосе тому, кто рядом. Клиент рисует по этому списку кнопки «Грабить».
create or replace function public.fleet_raid_targets(p_fleet_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; fl public.fleets; arr jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into fl from public.fleets where id = p_fleet_id::uuid and faction_id = fid;
  if fl.id is null then raise exception 'no such fleet'; end if;
  if fl.status <> 'idle' or fl.system_id is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'owner_fid', r.a_fid, 'owner_name', public._fac_name(r.a_fid),
           'resource', r.resource, 'volume', r.volume, 'price', coalesce(r.price,0),
           'cargo', coalesce(r.cargo,'[]'::jsonb), 'convoy', coalesce(r.convoy,0)
         ) order by r.volume desc), '[]'::jsonb)
    into arr
    from public.trade_routes r
    where r.status = 'active' and r.a_fid <> fid
      and public._route_passes(r.id::text, fl.system_id);
  return arr;
end$$;
revoke all on function public.fleet_raid_targets(text) from public;
grant execute on function public.fleet_raid_targets(text) to authenticated;

-- ── Сам грабёж: флот стоит на пути каравана → стелс-чек ──────
create or replace function public.fleet_raid(p_fleet_id text, p_route_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; fl public.fleets; rt public.trade_routes; tgt public.faction_economy;
  ships int; conv int; pat int; det_chance int; v_detected boolean;
  loot_frac numeric; v_res text; v_price numeric; stock numeric; cargo numeric;
  loot_units numeric; loot_gc numeric; took_units numeric := 0; took_gc numeric := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();

  select * into fl from public.fleets where id = p_fleet_id::uuid and faction_id = fid for update;
  if fl.id is null then raise exception 'no such fleet'; end if;
  if fl.status <> 'idle' or fl.system_id is null then raise exception 'fleet must be idle in a system'; end if;
  if fl.raid_cd_until is not null and fl.raid_cd_until > now() then
    raise exception 'fleet on cooldown';
  end if;

  select * into rt from public.trade_routes where id = p_route_id::uuid for update;
  if rt.id is null or rt.status <> 'active' then raise exception 'caravan gone'; end if;
  if rt.a_fid = fid then raise exception 'cannot raid your own caravan'; end if;
  if not public._route_passes(rt.id::text, fl.system_id) then
    raise exception 'caravan does not pass through your fleet system';
  end if;

  ships := (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(fl.composition) c);
  if ships < 1 then raise exception 'empty fleet'; end if;

  select * into tgt from public.faction_economy where faction_id = rt.a_fid;
  conv := coalesce(rt.convoy,0);
  pat  := coalesce(tgt.patrol_ships,0);

  -- ── ЕДИНСТВЕННАЯ ПРОВЕРКА: заметили или нет ──
  -- База 30%, растёт от эскорта каравана и патруля цели, слегка — от размера
  -- флота-грабителя (большую стаю проще засечь). Границы 10..90%.
  det_chance := least(90, greatest(10, 30 + conv*5 + pat*3 + ships));
  v_detected := (random()*100) < det_chance;

  if not v_detected then
    -- ── ТИХИЙ УГОН: часть реально везомого груза + ГС-надбавка ──
    loot_frac := 0.5;
    v_res := rt.resource; v_price := coalesce(rt.price,0);
    stock := coalesce((tgt.resources->>v_res)::numeric, 0);
    cargo := least(coalesce(rt.volume,0), stock);
    loot_units := floor(cargo * loot_frac);
    loot_gc    := floor(loot_units * v_price * 0.5);
    if loot_units > 0 and tgt.faction_id is not null then
      update public.faction_economy
        set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
            to_jsonb(coalesce((resources->>v_res)::numeric,0) - loot_units), true)
        where faction_id = rt.a_fid and coalesce((resources->>v_res)::numeric,0) >= loot_units;
      if found then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
          where faction_id = fid;
        took_units := loot_units;
      end if;
    end if;
    took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
    if took_gc > 0 then
      update public.faction_economy set gc = gc - took_gc where faction_id = rt.a_fid and gc >= took_gc;
      if found then update public.faction_economy set gc = gc + took_gc where faction_id = fid;
      else took_gc := 0; end if;
    end if;
  else
    -- ── ЗАМЕТИЛИ: добычи нет, отношения падают, цель узнаёт атакующего ──
    insert into public.faction_relations(from_fid, to_fid, score, updated_at)
      values(rt.a_fid, fid, -15, now())
      on conflict (from_fid, to_fid)
      do update set score = greatest(-100, public.faction_relations.score - 15), updated_at = now();
  end if;

  -- ── Новость цели (атакующий назван только при раскрытии) ──
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values(rt.a_fid, '🏴‍☠ ПИРАТСТВО', 'rgba(200,80,80,0.55)', null, null,
      case when v_detected then 'Караван отбил налёт' else 'Караван разграблен' end, null,
      case when v_detected then
        format('Караван фракции «%s» пытался ограбить флот державы «%s», но конвой вовремя заметил засаду. Груз цел.',
          public._fac_name(rt.a_fid), public._fac_name(fid))
      else
        format('Караван фракции «%s» ограблен неизвестными пиратами. Угнано %s ед. груза%s.',
          public._fac_name(rt.a_fid), took_units::text,
          case when took_gc>0 then ' и '||took_gc::text||' ГС' else '' end)
      end,
      'approved', now(), now(), now());

  -- кулдаун флота (3 часа)
  update public.fleets set raid_cd_until = now() + interval '3 hours' where id = fl.id;

  return jsonb_build_object('detected', v_detected, 'loot_units', took_units,
    'loot_gc', took_gc, 'resource', rt.resource, 'owner_name', public._fac_name(rt.a_fid));
end$$;
revoke all on function public.fleet_raid(text,text) from public;
grant execute on function public.fleet_raid(text,text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- 1) fleet_raid_targets(id) для idle-флота на трассе чужого каравана вернёт
--    непустой список; 2) fleet_raid(id, route) один раз крадёт (или палится),
--    ставит кулдаун 3ч; повтор до истечения → 'fleet on cooldown'.
