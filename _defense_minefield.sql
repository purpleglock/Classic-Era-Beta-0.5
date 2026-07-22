-- ============================================================
-- ОБОРОННЫЕ СТРУКТУРЫ — СЛАЙС 3: МИННЫЕ ПОЛЯ (ГЕКС-ЗАСТРОЙКА)
-- Применять в Supabase → SQL Editor ПОСЛЕ _defense_repair.sql и _raid_combat.sql.
-- Идемпотентно.
--
-- ИДЕЯ (переработка): минное поле строится У ПЛАНЕТЫ своей колонии и застраивается
-- ГЕКС ЗА ГЕКСОМ — кольцо из mine_hex_max гексов вокруг планеты. Каждый гекс
-- кладётся ОТДЕЛЬНО (свой клик, своя цена mine_hex_cost). Никакой кнопки
-- «заминировать всё сразу» — поле растёт по одному гексу.
-- Чем больше гексов закрыто — тем сильнее поле бьёт вражеский флот, заходящий
-- рейдить (потери ДО основного боя), и тем больше гексов оно теряет при срабатывании.
-- Видимость: своё поле видно всегда; чужое — только если ты «разведал систему»
-- (колония в системе / флаг / интел / аванпост — расширяется слайсом 4).
-- ============================================================

create table if not exists public.system_minefields (
  id          uuid primary key default gen_random_uuid(),
  system_id   text not null references public.map_systems(id) on delete cascade,
  planet_pid  int,
  owner_id    uuid,
  faction_id  text not null,
  hexes       int  not null default 1,        -- сколько гексов кольца закрыто минами (1..mine_hex_max)
  created_at  timestamptz default now()
);
-- На случай ранее применённой версии с колонкой coverage — мягко мигрируем в hexes.
alter table public.system_minefields add column if not exists hexes int not null default 1;
do $$ begin
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='system_minefields' and column_name='coverage') then
    update public.system_minefields
      set hexes = greatest(1, least(6, round(coalesce(coverage,1) * 6)::int))
      where hexes is null or hexes < 1;
    alter table public.system_minefields drop column coverage;
  end if;
end $$;
create unique index if not exists minefields_uidx
  on public.system_minefields(system_id, coalesce(planet_pid,-1), faction_id);
create index if not exists minefields_sys_idx on public.system_minefields(system_id);
create index if not exists minefields_fac_idx on public.system_minefields(faction_id);

alter table public.system_minefields enable row level security;
-- Приватно: писать/видеть напрямую — только владелец+стафф. Чужие — через RPC-гейт.
drop policy if exists "mf_sel" on public.system_minefields;
drop policy if exists "mf_all" on public.system_minefields;
create policy "mf_sel" on public.system_minefields for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "mf_all" on public.system_minefields for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── Константы (надмножество _defense_repair.sql) ──
create or replace function public._defense_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'starbase_cap_per_slot' then 50
    when 'repair_fraction'       then 0.40
    when 'repair_cost_frac'      then 0.50
    when 'repair_days'           then 1
    when 'mine_hex_max'          then 6       -- гексов в кольце вокруг планеты (полное поле)
    when 'mine_hex_cost'         then 1000    -- ГС за ОДИН гекс мин (минимум 1к)
    when 'mine_hex_attrition'    then 0.05    -- доля флота-рейдера, выбиваемая за каждый закрытый гекс
    when 'mine_wear_hexes'       then 1       -- сколько гексов поле теряет при срабатывании
    when 'mine_refund_frac'      then 0.50    -- доля возврата ГС при разминировании
    -- outpost-ключи (полный набор, чтобы этот _defense_const не ломал постройку
    -- носителя при клоббере — см. _outpost_ship_const_fix.sql):
    when 'outpost_ship_cost'     then 2000
    when 'outpost_build_h'       then 24
    when 'outpost_cap'           then 20
    when 'outpost_refund'        then 0.50
    when 'outpost_mine_gc'       then 75
    when 'op_fly_h_min'          then 2
    when 'op_fly_h_max'          then 18
    else null end
$$;

-- ── Видимость скрытых оборонных объектов в системе ──
-- (Слайс 4 «Аванпосты» переопределит эту функцию, добавив «есть мой аванпост».)
create or replace function public._defense_can_see(p_fid text, p_system_id text, p_owner_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select
    p_fid = p_owner_fid                                                        -- своё
    or exists(select 1 from public.colonies c                                  -- есть колония в системе
              where c.faction_id = p_fid and c.system_id = p_system_id)
    or exists(select 1 from public.map_systems s                              -- система под моим флагом
              where s.id = p_system_id and s.faction = p_fid)
    or public._spy_intel(p_fid, p_owner_fid) is not null                       -- есть интел на владельца
$$;
revoke all on function public._defense_can_see(text,text,text) from public;
grant execute on function public._defense_can_see(text,text,text) to authenticated;

-- ── RPC: заложить ОДИН гекс мин у своей планеты (растим поле по гексу) ──
create or replace function public.minefield_lay(p_system_id text, p_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; cost numeric; hexmax int; cur int; v_id uuid; v_hexes int;
begin
  fid := public._ec_my_fid();
  -- мины можно ставить только у своей колонии на этой планете.
  -- p_pid может быть NULL у «старых» колоний без planet_pid — тогда матчим по системе
  -- (NULL=NULL в SQL не истинно, поэтому отдельная ветка через IS NULL).
  if not exists(select 1 from public.colonies
                where faction_id=fid and system_id=p_system_id
                  and (p_pid is null or planet_pid is not distinct from p_pid)) then
    raise exception 'lay mines only at your own colony (system %, planet %)', p_system_id, p_pid;
  end if;
  hexmax := public._defense_const('mine_hex_max')::int;
  select hexes into cur from public.system_minefields
    where system_id=p_system_id and coalesce(planet_pid,-1)=coalesce(p_pid,-1) and faction_id=fid;
  if coalesce(cur,0) >= hexmax then
    raise exception 'minefield already full (% / % гексов)', cur, hexmax;
  end if;
  cost := public._defense_const('mine_hex_cost');
  update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
  if not found then raise exception 'not enough GC: гекс мин стоит %', cost; end if;

  insert into public.system_minefields(system_id, planet_pid, owner_id, faction_id, hexes)
    values(p_system_id, p_pid, auth.uid(), fid, 1)
    on conflict (system_id, coalesce(planet_pid,-1), faction_id)
    do update set hexes = least(hexmax, public.system_minefields.hexes + 1)
    returning id, hexes into v_id, v_hexes;

  return jsonb_build_object('ok', true, 'id', v_id, 'cost', cost, 'hexes', v_hexes, 'hex_max', hexmax);
end$$;
revoke all on function public.minefield_lay(text,int) from public;
grant execute on function public.minefield_lay(text,int) to authenticated;

-- ── RPC: снять ОДИН гекс мин у своей планеты (обратное к minefield_lay) ──
create or replace function public.minefield_unlay(p_system_id text, p_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mf public.system_minefields; refund numeric; left_hex int;
begin
  fid := public._ec_my_fid();
  select * into mf from public.system_minefields
    where system_id=p_system_id and coalesce(planet_pid,-1)=coalesce(p_pid,-1) and faction_id=fid;
  if not found or coalesce(mf.hexes,0) <= 0 then raise exception 'no mined hexes here'; end if;
  refund := floor(public._defense_const('mine_hex_cost') * public._defense_const('mine_refund_frac'));
  if mf.hexes <= 1 then
    delete from public.system_minefields where id=mf.id; left_hex := 0;
  else
    update public.system_minefields set hexes = hexes - 1 where id=mf.id returning hexes into left_hex;
  end if;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'hexes', left_hex, 'refund', refund);
end$$;
revoke all on function public.minefield_unlay(text,int) from public;
grant execute on function public.minefield_unlay(text,int) to authenticated;

-- ── RPC: разминировать поле целиком (частичный возврат пропорц. гексам) ──
create or replace function public.minefield_clear(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; mf public.system_minefields; refund numeric;
begin
  fid := public._ec_my_fid();
  select * into mf from public.system_minefields where id=p_id;
  if not found then raise exception 'minefield not found'; end if;
  if mf.faction_id is distinct from fid then raise exception 'not your minefield'; end if;
  refund := floor(public._defense_const('mine_hex_cost')
                  * public._defense_const('mine_refund_frac') * coalesce(mf.hexes,1));
  delete from public.system_minefields where id=p_id;
  update public.faction_economy set gc = gc + refund where faction_id=fid;
  return jsonb_build_object('ok', true, 'refund', refund);
end$$;
revoke all on function public.minefield_clear(uuid) from public;
grant execute on function public.minefield_clear(uuid) to authenticated;

-- ── RPC: видимые мне минные поля (свои + разведанные чужие) ──
create or replace function public.minefields_visible()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', mf.id, 'system_id', mf.system_id, 'planet_pid', mf.planet_pid,
      'faction_id', mf.faction_id, 'hexes', mf.hexes,
      'hex_max', public._defense_const('mine_hex_max')::int,
      'mine', (mf.faction_id = fid)
    ))
    from public.system_minefields mf
    where public._defense_can_see(fid, mf.system_id, mf.faction_id)
  ), '[]'::jsonb);
end$$;
revoke all on function public.minefields_visible() from public;
grant execute on function public.minefields_visible() to authenticated;

-- ── Хелпер: минный «привет» рейдеру в системах p_systems ──
-- Возвращает сколько кораблей атакующего выбито. Сила = сумма закрытых ГЕКСОВ полей
-- защитника в этих системах × mine_hex_attrition (кап 60%). Применяет потери
-- (часть → в ремонт через _destroy_ships) и ИЗНАШИВАЕТ поля на mine_wear_hexes гексов.
create or replace function public._minefield_defend(p_attacker_fid text, p_defender_fid text,
                                                    p_systems text[], p_attacker_ships int)
returns int language plpgsql security definer set search_path=public as $$
declare tot_hex int; frac numeric; losses int; wear int;
begin
  if p_attacker_ships <= 0 then return 0; end if;
  select coalesce(sum(hexes),0) into tot_hex
    from public.system_minefields
    where faction_id=p_defender_fid and system_id = any(p_systems);
  if tot_hex <= 0 then return 0; end if;
  frac   := least(0.6, tot_hex * public._defense_const('mine_hex_attrition'));
  losses := round(p_attacker_ships * frac);
  if losses <= 0 then return 0; end if;
  perform public._destroy_ships(p_attacker_fid, losses);
  -- срабатывание выбивает гексы (детонация)
  wear := public._defense_const('mine_wear_hexes')::int;
  update public.system_minefields
    set hexes = hexes - wear
    where faction_id=p_defender_fid and system_id = any(p_systems);
  delete from public.system_minefields where hexes <= 0;
  return losses;
end$$;
revoke all on function public._minefield_defend(text,text,text[],int) from public;

-- ════════════════════════════════════════════════════════════════════════════
--  _raid_resolve — НАДМНОЖЕСТВО версии из _raid_combat.sql + МИННЫЙ ХУК.
--  Отличие: до основного боя минные поля цели в системах маршрута бьют рейдера
--  (eff_ships = m.ships − минные потери), затем обычный размен по конвою/патрулю.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public._raid_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m record; rt public.trade_routes; tgt public.faction_economy;
  A numeric; D numeric; T numeric; s numeric; k numeric;
  att_losses int; def_losses int; loot_frac numeric;
  v_res text; v_price numeric; stock numeric; cargo numeric;
  loot_units numeric; loot_gc numeric; took_units numeric; took_gc numeric;
  det_chance int; v_detected boolean; conv int; pat int;
  eff_ships int; mine_losses int;        -- МИННЫЙ ХУК
begin
  for m in select * from public.raid_missions
           where actor_fid=p_fid and status='active' and ready_at <= now()
           for update loop

    select * into rt from public.trade_routes where id=m.route_id;
    if rt.id is null or rt.status <> 'active' then
      update public.raid_missions set status='done', detected=false,
        outcome = jsonb_build_object('result','no_target') where id=m.id;
      continue;
    end if;

    select * into tgt from public.faction_economy where faction_id=m.target_fid;
    conv := coalesce(rt.convoy,0);
    pat  := coalesce(tgt.patrol_ships,0);

    -- ⛯ МИННЫЕ ПОЛЯ ЦЕЛИ в системах маршрута бьют рейдера ДО боя
    mine_losses := public._minefield_defend(m.actor_fid, m.target_fid,
                     array_remove(array[rt.origin_sys, rt.dest_sys], null), m.ships);
    eff_ships := greatest(0, m.ships - mine_losses);

    -- двусторонний бой по соотношению сил (атакующий уже прорежен минами)
    A := eff_ships * 10;
    D := conv * 12 + pat * 9;
    T := greatest(1, A + D);
    s := A / T;
    k := 0.5 * (0.8 + random()*0.4);
    att_losses := round(eff_ships * (1 - s) * k);
    def_losses := round(conv     *    s  * k);
    loot_frac  := greatest(0, least(0.7, (s - 0.5) * 1.4));

    took_units := 0; took_gc := 0;
    if loot_frac > 0 and tgt.faction_id is not null then
      v_res := rt.resource; v_price := coalesce(rt.price,0);
      stock := coalesce((tgt.resources->>v_res)::numeric, 0);
      cargo := least(coalesce(rt.volume,0), stock);
      loot_units := floor(cargo * loot_frac);
      loot_gc    := floor(loot_units * v_price * 0.5);
      if loot_units > 0 then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) - loot_units), true)
          where faction_id=m.target_fid and coalesce((resources->>v_res)::numeric,0) >= loot_units;
        if found then
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
                to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
            where faction_id=m.actor_fid;
          took_units := loot_units;
        end if;
      end if;
      took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
      if took_gc > 0 then
        update public.faction_economy set gc = gc - took_gc where faction_id=m.target_fid and gc >= took_gc;
        if found then update public.faction_economy set gc = gc + took_gc where faction_id=m.actor_fid;
        else took_gc := 0; end if;
      end if;
    end if;

    -- ── ПОТЕРИ кораблей (минные уже сняты выше) ──
    if att_losses > 0 then perform public._destroy_ships(m.actor_fid, att_losses); end if;
    if def_losses > 0 then
      perform public._destroy_ships(m.target_fid, def_losses);
      update public.trade_routes set convoy = greatest(0, coalesce(convoy,0) - def_losses) where id=m.route_id;
    end if;

    -- ── РАСКРЫТИЕ ── (мины — громкое событие)
    det_chance := case when D > 0 or mine_losses > 0 then 70 else 30 end;
    v_detected := (random()*100) < det_chance;
    if v_detected then
      insert into public.faction_relations(from_fid, to_fid, score, updated_at)
        values(m.target_fid, m.actor_fid, -15, now())
        on conflict (from_fid, to_fid)
        do update set score = greatest(-100, public.faction_relations.score - 15), updated_at=now();
    end if;

    -- ── НОВОСТЬ цели ──
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(m.target_fid, '🏴‍☠ ПИРАТСТВО', 'rgba(200,80,80,0.55)', null, null,
        'Караван разграблен', null,
        format('Караван фракции «%s» атакован %s. Угнано %s ед. груза%s. Потери эскорта: %s кораблей.%s',
          public._fac_name(m.target_fid),
          case when v_detected then 'флотом «'||public._fac_name(m.actor_fid)||'»' else 'неизвестными пиратами' end,
          took_units::text,
          case when took_gc>0 then ' и '||took_gc::text||' ГС' else '' end,
          def_losses::text,
          case when mine_losses>0 then ' Минные поля выбили '||mine_losses::text||' кораблей нападавших.' else '' end),
        'approved', now(), now(), now());

    update public.raid_missions
      set status='done', detected=v_detected,
          outcome = jsonb_build_object('ships',m.ships,'mine_losses',mine_losses,'att_losses',att_losses,
                    'def_losses',def_losses,'loot_units',took_units,'loot_gc',took_gc,'resource',rt.resource,
                    'loot_frac',round(loot_frac,2),'detected',v_detected)
      where id=m.id;
  end loop;
end$$;
revoke all on function public._raid_resolve(text) from public;
