-- ============================================================
-- РЕЙДЫ · БАЛАНС: добыча из груза-в-пути + срыв трассы + мощь флота по cost
-- Применять в Supabase → SQL Editor ПОСЛЕ _raid_policy.sql. Идемпотентно, аддитивно.
--
-- Чинит три проблемы боя:
--  1) ДОБЫЧА. Раньше грабёж брался из СКЛАДА жертвы (faction_economy.resources).
--     Но export-караваны возят свежедобытое (mine_flow), которого на складе нет →
--     stock=0 → угнано 0. Теперь грабим ГРУЗ В ПУТИ (cargo_vol), захват не зависит
--     от склада жертвы; со склада списываем сколько есть (без блокировки захвата).
--  2) СРЫВ ТРАССЫ. При победе пирата караван уходит в транзит-кулдаун (2 хода не
--     возит) — то самое «караван разграблен», а не «ничего не случилось».
--  3) МОЩЬ ФЛОТА. Сила больше НЕ «1 корабль = 10». Теперь A/D взвешены по серверной
--     стоимости юнита (faction_units.summary.cost): дредноут >> корвет. cost честен —
--     это же число, по которому экономика списывает ГС за постройку (подделка cost
--     либо ослабляет юнит, либо удорожает его — самобалансируется против читов).
-- ============================================================

-- ── helper: средняя «мощь» одного корабля фракции по cost ────
-- Нормировка cost/10: крейсер (cost~100) ≈ 10 (старое A на корабль), дредноут
-- (cost~4000-5000) ≈ 400-500. Берём среднее по готовому флоту (учитываются модули
-- и броня — они уже зашиты в summary.cost конструктором). Фолбэк 10 для юнитов без
-- дизайна. s=A/(A+D) — ратио, поэтому абсолютная шкала роли не играет; флэт-защита
-- политики (pol_def) калибруется в «крейсеро-эквивалентах».
create or replace function public._ship_power_avg(p_fid text)
returns numeric language sql stable security definer set search_path=public as $fn$
  select coalesce(
    sum(up.qty * greatest(1, coalesce((u.summary->>'cost')::numeric, 100) / 10.0))
      / nullif(sum(up.qty), 0),
    10)
  from public.unit_production up
  left join public.faction_units u on u.id = up.unit_id
  where up.faction_id = p_fid and up.category = 'ship' and up.status = 'done' and up.qty > 0
$fn$;
revoke all on function public._ship_power_avg(text) from public;

-- ── raid_launch: снимок силы атаки теперь взвешен по cost ────
create or replace function public.raid_launch(p_target_fid text, p_route_id uuid, p_ships int)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare fid text; me public.faction_economy; rt public.trade_routes;
  n int; freep int; adj boolean; turns int; powa int; tgt_owner uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  n := greatest(1, coalesce(p_ships,1));
  if p_target_fid = fid then raise exception 'cannot raid yourself'; end if;

  select * into rt from public.trade_routes where id = p_route_id and a_fid = p_target_fid and status='active';
  if not found then raise exception 'target caravan not active'; end if;

  select owner_id into tgt_owner from public.faction_economy where faction_id = p_target_fid;
  if tgt_owner is null then raise exception 'target has no economy'; end if;

  select * into me from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  freep := public._raid_free_ships(fid);
  if n > freep then raise exception 'not enough free ships (free: %)', greatest(0, freep); end if;

  select exists(
    select 1 from public.map_systems ms
    join public.map_hyperlanes h on (h.a_id = ms.id or h.b_id = ms.id)
    where ms.faction = fid
      and (rt.origin_sys in (h.a_id, h.b_id) or rt.dest_sys in (h.a_id, h.b_id))
  ) into adj;
  turns := case when adj then 1 else 2 end;

  powa := round(n * public._ship_power_avg(fid));   -- ◄ мощь = число × средняя cost-мощь корабля

  insert into public.raid_missions(actor_fid, actor_owner, target_fid, target_owner, target_name,
      route_id, ships, power_att, status, started_at, ready_at)
    values(fid, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid),
      p_route_id, n, powa, 'active', now(), now() + (turns || ' days')::interval);

  return jsonb_build_object('ok', true, 'ships', n, 'turns', turns, 'power', powa, 'adjacent', adj);
end$fn$;
revoke all on function public.raid_launch(text,uuid,int) from public;
grant execute on function public.raid_launch(text,uuid,int) to authenticated;

-- ── Разрешение рейдов: cost-мощь + грабёж груза-в-пути + срыв трассы ──
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
    def_power := public._ship_power_avg(m.target_fid);   -- средняя cost-мощь корабля жертвы (для эскорта)

    -- двусторонний бой: мощь взвешена по cost (снимок атаки + эскорт жертвы)
    A := coalesce(nullif(m.power_att,0), m.ships * 10);   -- cost-снимок (легаси рейды: фолбэк ×10)
    D := conv * def_power + pol_def;                      -- эскорт (cost-мощь жертвы) + NPC-политика
    T := greatest(1, A + D);
    s := A / T;
    k := 0.5 * (0.8 + random()*0.4);
    att_losses := round(m.ships * (1 - s) * k);
    def_losses := round(conv     *    s  * k);            -- гибнут СВОИ корабли конвоя (число, не NPC)
    loot_frac  := greatest(0, least(0.7, (s - 0.5) * 1.4));
    won        := loot_frac > 0;                          -- пират победил (перевес > 50%)

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
    -- ── ДОБЫЧА: грабим ГРУЗ В ПУТИ (cargo_vol), не склад жертвы ──
    if won and v_res is not null then
      cargo      := greatest(0, coalesce(cargo_vol,0));   -- что реально везёт караван
      loot_units := floor(cargo * loot_frac);
      loot_gc    := floor(loot_units * v_price * 0.5);    -- ГС-надбавка за разбой
      if loot_units > 0 then
        -- атакующий перехватывает груз в пути (захват не зависит от склада жертвы)
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
              to_jsonb(coalesce((resources->>v_res)::numeric,0) + loot_units), true)
          where faction_id=m.actor_fid;
        took_units := loot_units;
        -- жертва теряет со склада столько, сколько там есть (не блокирует захват)
        if tgt.faction_id is not null then
          update public.faction_economy
            set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[v_res],
                to_jsonb(greatest(0, coalesce((resources->>v_res)::numeric,0) - loot_units)), true)
            where faction_id=m.target_fid;
        end if;
      end if;
      -- ГС-добыча (с guard по казне жертвы)
      took_gc := least(floor(loot_gc), greatest(0, floor(coalesce(tgt.gc,0))));
      if took_gc > 0 then
        update public.faction_economy set gc = gc - took_gc where faction_id=m.target_fid and gc >= took_gc;
        if found then update public.faction_economy set gc = gc + took_gc where faction_id=m.actor_fid;
        else took_gc := 0; end if;
      end if;
    end if;

    -- ── ПОТЕРИ кораблей с обеих сторон ──
    if att_losses > 0 then perform public._destroy_ships(m.actor_fid, att_losses); end if;
    if def_losses > 0 then
      perform public._destroy_ships(m.target_fid, def_losses);
      update public.trade_routes set convoy = greatest(0, coalesce(convoy,0) - def_losses) where id=m.route_id;
    end if;

    -- ── СРЫВ ТРАССЫ: при победе караван встаёт в транзит-кулдаун (2-3 хода) ──
    disrupt_days := 0;
    if won then
      disrupt_days := 2 + round(loot_frac);   -- сильнее перевес → дольше восстановление (2-3 хода)
      update public.trade_routes
        set transit_until = greatest(coalesce(transit_until, now()), now()) + (disrupt_days || ' days')::interval
        where id=m.route_id;
    end if;

    -- ── РАСКРЫТИЕ (бой с эскортом — громче) ──
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

    -- ── ФИКСИРУЕМ исход ──
    update public.raid_missions
      set status='done', detected=v_detected,
          outcome = jsonb_build_object('ships',m.ships,'power_att',A,'power_def',round(D),
                    'att_losses',att_losses,'def_losses',def_losses,
                    'loot_units',took_units,'loot_gc',took_gc,'resource',v_res,
                    'loot_frac',round(loot_frac,2),'disrupt_days',disrupt_days,'detected',v_detected)
      where id=m.id;
  end loop;
end$fn$;
revoke all on function public._raid_resolve(text) from public;

-- ── Проверка ────────────────────────────────────────────────
-- Флот дредноутов на караван без эскорта: A огромен → s≈1 → loot_frac=0.7,
-- угоняется ~70% возимого груза, ГС-надбавка с казны жертвы, трасса срывается на
-- 2-3 хода. select outcome from raid_missions order by created_at desc limit 1;
