-- ============================================================
-- РЕЙДЫ · СОСТАВ ФЛОТА: рейд собирается КОНКРЕТНЫМИ кораблями (дизайнами),
-- а не абстрактным «числом кораблей». Применять в Supabase → SQL Editor
-- ПОСЛЕ _raid_balance.sql. Идемпотентно, аддитивно.
--
-- Что меняется:
--  1) raid_missions.comp jsonb — снимок состава рейда: [{"unit_id":"…","qty":N}].
--  2) raid_launch(target, route, p_comp jsonb) — вместо p_ships int. Каждый дизайн
--     проверяется на принадлежность фракции и свободу (готовые − рейды − караваны).
--     Мощь = Σ qty × cost-мощь дизайна (cost/10), как _ship_power_avg, но ПОИМЁННО,
--     а не по среднему флоту → реальный состав влияет на силу.
--  3) Потери атакующего падают ТОЛЬКО на дизайны отправленного состава
--     (_destroy_ships_in) — корвет-рейд не топит дредноуты, оставшиеся дома.
--  4) Глобальный потолок (_raid_free_ships) сохранён: всего нельзя послать больше,
--     чем свободно с учётом конвоев и других рейдов.
--
-- Безопасность: всё через SECURITY DEFINER RPC; cost честен (самобаланс против
-- читов: подделка cost либо слабит юнит, либо удорожает постройку). См. [[piracy-raid-mechanic]].
-- ============================================================

-- ── Снимок состава рейда ────────────────────────────────────
alter table public.raid_missions add column if not exists comp jsonb;

-- ── Свободно кораблей КОНКРЕТНОГО дизайна ───────────────────
-- готовые этого дизайна − занятые активными рейдами (по comp) − закреплённые
-- за караванами (поштучно в trade_routes.ships). Глобальный конвой-эскорт
-- (count без привязки к дизайну) ловится отдельно глобальным _raid_free_ships.
create or replace function public._raid_free_design(p_fid text, p_unit_id uuid)
returns int language sql stable security definer set search_path=public as $fn$
  select greatest(0,
      coalesce((select sum(qty) from public.unit_production
                where faction_id=p_fid and category='ship' and status='done' and unit_id=p_unit_id),0)
    - coalesce((select sum((c->>'qty')::int)
                from public.raid_missions rm, jsonb_array_elements(coalesce(rm.comp,'[]'::jsonb)) c
                where rm.actor_fid=p_fid and rm.status='active' and (c->>'unit_id')::uuid = p_unit_id),0)
    - coalesce((select sum((tr.ships->>(p_unit_id::text))::int)
                from public.trade_routes tr
                where tr.a_fid=p_fid and tr.status in ('pending','active')
                  and tr.ships ? (p_unit_id::text)),0)
  )
$fn$;
revoke all on function public._raid_free_design(text,uuid) from public;

-- ── RPC: запуск рейда по СОСТАВУ ────────────────────────────
-- Меняем сигнатуру p_ships int → p_comp jsonb. PostgREST различает перегрузки по
-- именам аргументов, но во избежание неоднозначности старую версию удаляем.
drop function if exists public.raid_launch(text,uuid,int);
create or replace function public.raid_launch(p_target_fid text, p_route_id uuid, p_comp jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare fid text; me public.faction_economy; rt public.trade_routes;
  tot int := 0; powa numeric := 0; adj boolean; turns int; tgt_owner uuid;
  c jsonb; uid uuid; q int; freed int; ucost numeric; ucat text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if p_target_fid = fid then raise exception 'cannot raid yourself'; end if;
  if p_comp is null or jsonb_array_length(p_comp) = 0 then raise exception 'empty fleet: pick ships'; end if;

  -- цель — активный ИСХОДЯЩИЙ караван жертвы (грабить нечего, если не торгует)
  select * into rt from public.trade_routes where id = p_route_id and a_fid = p_target_fid and status='active';
  if not found then raise exception 'target caravan not active'; end if;

  select owner_id into tgt_owner from public.faction_economy where faction_id = p_target_fid;
  if tgt_owner is null then raise exception 'target has no economy'; end if;

  -- LOCK казны: сериализуем учёт занятых кораблей (нельзя послать одни корабли в 2 рейда гонкой)
  select * into me from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  -- разбор состава: каждый дизайн — твой готовый корабль, qty ≤ свободных этого дизайна
  for c in select value from jsonb_array_elements(p_comp) loop
    uid := (c->>'unit_id')::uuid;
    q   := coalesce((c->>'qty')::int, 0);
    if q <= 0 then continue; end if;

    select coalesce((u.summary->>'cost')::numeric,100), u.category
      into ucost, ucat
      from public.faction_units u where u.id = uid;
    if not found then raise exception 'unknown ship design %', uid; end if;
    if ucat is distinct from 'ship' then raise exception 'design % is not a ship', uid; end if;

    freed := public._raid_free_design(fid, uid);
    if q > freed then raise exception 'not enough free ships of design % (free: %)', uid, greatest(0, freed); end if;

    tot  := tot + q;
    powa := powa + q * greatest(1, ucost/10.0);   -- cost-мощь поимённо (не средняя по флоту)
  end loop;
  if tot < 1 then raise exception 'empty fleet: pick ships'; end if;

  -- глобальный потолок: с учётом конвоя/рейдов всего нельзя превысить свободный флот
  if tot > public._raid_free_ships(fid) then
    raise exception 'not enough free ships (free: %)', greatest(0, public._raid_free_ships(fid));
  end if;

  -- дистанция: смежна ли твоя территория с маршрутом жертвы → 1 ход, иначе 2
  select exists(
    select 1 from public.map_systems ms
    join public.map_hyperlanes h on (h.a_id = ms.id or h.b_id = ms.id)
    where ms.faction = fid
      and (rt.origin_sys in (h.a_id, h.b_id) or rt.dest_sys in (h.a_id, h.b_id))
  ) into adj;
  turns := case when adj then 1 else 2 end;

  insert into public.raid_missions(actor_fid, actor_owner, target_fid, target_owner, target_name,
      route_id, ships, power_att, comp, status, started_at, ready_at)
    values(fid, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid),
      p_route_id, tot, round(powa), p_comp, 'active', now(), now() + (turns || ' days')::interval);

  return jsonb_build_object('ok', true, 'ships', tot, 'turns', turns, 'power', round(powa), 'adjacent', adj);
end$fn$;
revoke all on function public.raid_launch(text,uuid,jsonb) from public;
grant execute on function public.raid_launch(text,uuid,jsonb) to authenticated;

-- ── helper: уничтожить N кораблей ТОЛЬКО из отправленного состава ──
-- Гибнут только дизайны рейда (по comp), старшие партии раньше. Если состава
-- не хватило (часть уже потеряна в др. рейде) — добиваем из общего ростера.
create or replace function public._destroy_ships_in(p_fid text, p_comp jsonb, p_n int)
returns void language plpgsql security definer set search_path=public as $fn$
declare rem int; c jsonb; uid uuid; r record; take int;
begin
  rem := greatest(0, coalesce(p_n,0));
  if rem <= 0 then return; end if;
  if p_comp is null or jsonb_array_length(p_comp) = 0 then
    perform public._destroy_ships(p_fid, rem); return;   -- легаси-рейды без состава
  end if;
  for c in select value from jsonb_array_elements(p_comp) loop
    exit when rem <= 0;
    uid := (c->>'unit_id')::uuid;
    for r in select id, qty from public.unit_production
             where faction_id=p_fid and category='ship' and status='done' and unit_id=uid and qty>0
             order by created_at asc loop
      exit when rem <= 0;
      take := least(rem, r.qty);
      if take >= r.qty then delete from public.unit_production where id=r.id;
      else update public.unit_production set qty=qty-take where id=r.id; end if;
      rem := rem - take;
    end loop;
  end loop;
  if rem > 0 then perform public._destroy_ships(p_fid, rem); end if;
end$fn$;
revoke all on function public._destroy_ships_in(text,jsonb,int) from public;

-- ── Разрешение рейдов: версия _raid_balance.sql + потери по составу ──
-- Отличия от _raid_balance.sql: потери атакующего бьют только по comp
-- (_destroy_ships_in), а в outcome кладём comp для отображения в журнале.
create or replace function public._raid_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $fn$
declare m record; rt public.trade_routes; tgt public.faction_economy;
  A numeric; D numeric; T numeric; s numeric; k numeric;
  att_losses int; def_losses int; loot_frac numeric;
  v_res text; v_price numeric; cargo numeric; cargo_vol numeric;
  loot_units numeric; loot_gc numeric; took_units numeric; took_gc numeric;
  det_chance int; v_detected boolean; conv int; pol_def int;
  won boolean; disrupt_days int; def_power numeric;
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
    conv      := coalesce(rt.convoy,0);
    pol_def   := public._trade_policy_def(coalesce(tgt.trade_policy,0));
    def_power := public._ship_power_avg(m.target_fid);

    A := coalesce(nullif(m.power_att,0), m.ships * 10);   -- cost-снимок состава (легаси: ×10)
    D := conv * def_power + pol_def;
    T := greatest(1, A + D);
    s := A / T;
    k := 0.5 * (0.8 + random()*0.4);
    att_losses := round(m.ships * (1 - s) * k);
    def_losses := round(conv     *    s  * k);
    loot_frac  := greatest(0, least(0.7, (s - 0.5) * 1.4));
    won        := loot_frac > 0;

    -- самый ценный груз каравана (мультигруз или легаси один ресурс)
    if jsonb_array_length(coalesce(rt.cargo,'[]'::jsonb)) > 0 then
      select ci->>'res', coalesce((ci->>'vol')::numeric,0) into v_res, cargo_vol
        from jsonb_array_elements(rt.cargo) ci
        order by public._res_price(coalesce((select rarity from public.resource_rarity where name=ci->>'res'),'common')) desc
        limit 1;
      v_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=v_res),'common'));
    else
      v_res := rt.resource; v_price := coalesce(rt.price,0); cargo_vol := coalesce(rt.volume,0);
    end if;

    took_units := 0; took_gc := 0;
    if won and v_res is not null then
      cargo      := greatest(0, coalesce(cargo_vol,0));
      loot_units := floor(cargo * loot_frac);
      loot_gc    := floor(loot_units * v_price * 0.5);
      if loot_units > 0 then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
          where faction_id=m.actor_fid;
        took_units := loot_units;
        if tgt.faction_id is not null then
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
                to_jsonb(greatest(0, coalesce((resources->>v_res)::numeric,0) - loot_units)), true)
            where faction_id=m.target_fid;
        end if;
      end if;
      took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
      if took_gc > 0 then
        update public.faction_economy set gc = gc - took_gc where faction_id=m.target_fid and gc >= took_gc;
        if found then update public.faction_economy set gc = gc + took_gc where faction_id=m.actor_fid;
        else took_gc := 0; end if;
      end if;
    end if;

    -- ── ПОТЕРИ: атакующий теряет ТОЛЬКО корабли отправленного состава ──
    if att_losses > 0 then perform public._destroy_ships_in(m.actor_fid, m.comp, att_losses); end if;
    if def_losses > 0 then
      perform public._destroy_ships(m.target_fid, def_losses);
      update public.trade_routes set convoy = greatest(0, coalesce(convoy,0) - def_losses) where id=m.route_id;
    end if;

    -- ── СРЫВ ТРАССЫ при победе ──
    disrupt_days := 0;
    if won then
      disrupt_days := 2 + round(loot_frac);
      update public.trade_routes
        set transit_until = greatest(coalesce(transit_until, now()), now()) + (disrupt_days || ' days')::interval
        where id=m.route_id;
    end if;

    -- ── РАСКРЫТИЕ ──
    det_chance := case when D > 0 then 70 else 30 end;
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
          case when disrupt_days>0 then ' Маршрут сорван на '||disrupt_days::text||' хода.' else '' end),
        'approved', now(), now(), now());

    -- ── ФИКСИРУЕМ исход (с составом) ──
    update public.raid_missions
      set status='done', detected=v_detected,
          outcome = jsonb_build_object('ships',m.ships,'power_att',A,'power_def',round(D),
                    'att_losses',att_losses,'def_losses',def_losses,
                    'loot_units',took_units,'loot_gc',took_gc,'resource',v_res,
                    'loot_frac',round(loot_frac,2),'disrupt_days',disrupt_days,'detected',v_detected,
                    'comp',coalesce(m.comp,'[]'::jsonb))
      where id=m.id;
  end loop;
end$fn$;
revoke all on function public._raid_resolve(text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- raid_launch('<цель>','<route_uuid>','[{"unit_id":"<design>","qty":3}]'::jsonb)
-- → рейд с конкретным составом; мощь считается поимённо по cost дизайнов.
-- На тике автора потери падают только на отправленные дизайны.
