-- ════════════════════════════════════════════════════════════════════════
--  ИССЛЕДОВАТЬ ВСЁ В КОНСТРУКТОРАХ + КУЛДАУН ТОРГОВЛИ ТЕХНОЛОГИЯМИ
--
--  1) Бесплатной «базы» конструкторов больше нет: КАЖДЫЙ класс и КАЖДАЯ
--     группа оружия — исследование. Бывшая база стала дешёвыми корнями
--     дерева (стартеры: классы 3 ОН, оружие 5 ОН) — зеркало EC_TECH_STARTER
--     в economy.js и пустого CN_BASE в constructors.js.
--     Каталог tech_nodes ниже — ПОЛНОЕ зеркало ecBuildResearch() на
--     2026-07-09 (сгенерировано из живого дерева, легаси-цены сохранены).
--  2) БЭКФИЛЛ «не с нуля»: все существующие фракции пользовались базой —
--     8 стартовых узлов выдаются им даром, ничего не ломается.
--  3) ТОРГОВЛЯ ТЕХНОЛОГИЯМИ: каждая фракция может закрыть не больше
--     1 сделки в 3 дня (проверяются ОБЕ стороны сделки; tech_offers.accepted_at).
--
--  Применять в Supabase → SQL Editor ПОСЛЕ _research_queue.sql и
--  _migration_tech_market.sql (переопределяет tech_offer_propose/accept).
--  Идемпотентно.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0) Уборка черновой версии среза (имперские техи/триггер — ОТМЕНЕНЫ) ──
drop trigger if exists colony_buildings_tech_gate on public.colony_buildings;
drop function if exists public._bld_tech_gate();
drop function if exists public._tech_has(text, text);
delete from public.tech_nodes
  where node_id like 'inf.%' or node_id like 'esp.%'
     or node_id like 'com.%' or node_id like 'soc.%';

-- ── 1) Каталог: полное зеркало дерева (стартеры + легаси + политика) ──
insert into public.tech_nodes (node_id, base_cost, prereq) values
('cls.ship.corvette',3,'[]'),
('cls.ship.frigate',5,'["cls.ship.corvette"]'),
('cls.ship.destroyer',10,'["cls.ship.frigate"]'),
('cls.ship.cruiser',20,'["cls.ship.destroyer"]'),
('cls.ship.battleship',40,'["cls.ship.cruiser"]'),
('cls.ship.dreadnought',80,'["cls.ship.battleship"]'),
('wpn.ship.Легкие',5,'["cls.ship.corvette"]'),
('wpn.ship.Средние',5,'["cls.ship.frigate"]'),
('wpn.ship.Тяжёлые',12,'["cls.ship.cruiser"]'),
('wpn.ship.Сверхтяжёлые',20,'["cls.ship.battleship"]'),
('wpn.ship.Ракетное',28,'["cls.ship.destroyer"]'),
('wpn.ship.Зенитное',36,'["cls.ship.frigate"]'),
('comp.ship.reactor',16,'["cls.ship.destroyer"]'),
('comp.ship.armor',14,'["cls.ship.destroyer"]'),
('comp.ship.shield',16,'["cls.ship.cruiser"]'),
('comp.ship.engine',10,'["cls.ship.frigate"]'),
('type.ship.corvette',10,'["cls.ship.corvette"]'),
('type.ship.frigate',10,'["cls.ship.frigate"]'),
('type.ship.destroyer',10,'["cls.ship.destroyer"]'),
('type.ship.cruiser',10,'["cls.ship.cruiser"]'),
('type.ship.battleship',10,'["cls.ship.battleship"]'),
('type.ship.dreadnought',10,'["cls.ship.dreadnought"]'),
('mod.ship.Радарное оборудование',8,'[]'),
('mod.ship.Радиоэлектронная борьба',13,'["mod.ship.Радарное оборудование"]'),
('mod.ship.Активная защита',18,'["mod.ship.Радиоэлектронная борьба"]'),
('mod.ship.Управление',23,'["mod.ship.Активная защита"]'),
('mod.ship.Спец. системы',28,'["mod.ship.Управление"]'),
('hangar.ship',22,'["cls.ship.destroyer"]'),
('hangar.ship.heavy',40,'["hangar.ship"]'),
('cls.ground.light',3,'[]'),
('cls.ground.medium',5,'["cls.ground.light"]'),
('cls.ground.artillery',10,'["cls.ground.medium"]'),
('cls.ground.heavy',20,'["cls.ground.artillery"]'),
('cls.ground.walker',40,'["cls.ground.heavy"]'),
('wpn.ground.Противопехотное',5,'["cls.ground.light"]'),
('wpn.ground.Противотанковое',5,'["cls.ground.medium"]'),
('wpn.ground.Артиллерия и ПВО',12,'["cls.ground.artillery"]'),
('comp.ground.armor',14,'["cls.ground.heavy"]'),
('comp.ground.shield',16,'["cls.ground.heavy"]'),
('comp.ground.engine',10,'["cls.ground.medium"]'),
('mod.ground.Оптика и Связь',8,'[]'),
('mod.ground.Защита и Поддержка',13,'["mod.ground.Оптика и Связь"]'),
('cls.aviation.light',3,'[]'),
('cls.aviation.medium',5,'["cls.aviation.light"]'),
('cls.aviation.heavy',10,'["cls.aviation.medium"]'),
('cls.aviation.cargo',20,'["cls.aviation.heavy"]'),
('wpn.aviation.Курсовое вооружение',5,'["cls.aviation.light"]'),
('wpn.aviation.Ракетное и бомбовое',12,'["cls.aviation.medium"]'),
('wpn.aviation.Спецоборудование',20,'["cls.aviation.heavy"]'),
('comp.aviation.reactor',16,'["cls.aviation.medium"]'),
('comp.aviation.armor',14,'["cls.aviation.heavy"]'),
('comp.aviation.shield',16,'["cls.aviation.heavy"]'),
('comp.aviation.engine',10,'["cls.aviation.medium"]'),
('type.aviation.light',10,'["cls.aviation.light"]'),
('type.aviation.medium',10,'["cls.aviation.medium"]'),
('type.aviation.heavy',10,'["cls.aviation.heavy"]'),
('type.aviation.cargo',10,'["cls.aviation.cargo"]'),
('mod.aviation.Авионика и Радары',8,'[]'),
('mod.aviation.Защита и РЭБ',13,'["mod.aviation.Авионика и Радары"]'),
('mod.aviation.Служебные',18,'["mod.aviation.Защита и РЭБ"]'),
('pol.new_deal',30,'[]'),
('pol.mercantile',50,'["pol.new_deal"]'),
('pol.five_year',35,'[]'),
('pol.goelro',55,'["pol.five_year"]'),
('pol.land_reform',30,'[]'),
('pol.total_mob',55,'["pol.land_reform"]'),
('pol.house_heavens',90,'["pol.total_mob"]'),
('pol.cel_asteroid',20,'[]'),
('pol.cel_giants',40,'["pol.cel_asteroid"]'),
('pol.cel_anomaly',60,'["pol.cel_giants"]'),
('pol.light_knowledge',70,'[]'),
('pol.mind_supremacy',140,'["pol.light_knowledge"]'),
('pol.inevitability',5000,'[]')
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── 2) БЭКФИЛЛ: стартеры (бывшая бесплатная база) — всем существующим ──
-- Фракции строили корветы/лёгкую технику и стреляли базовым оружием ДО
-- реформы — выдаём эти 8 узлов даром, чтобы ни один чертёж не сломался.
update public.faction_economy e
set research = coalesce(e.research,'[]'::jsonb) || (
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  from unnest(array[
    'cls.ship.corvette','cls.ground.light','cls.aviation.light',
    'wpn.ship.Легкие','wpn.ship.Средние',
    'wpn.ground.Противопехотное','wpn.ground.Противотанковое',
    'wpn.aviation.Курсовое вооружение'
  ]) t
  where not (coalesce(e.research,'[]'::jsonb) ? t))
where exists (
  select 1 from unnest(array[
    'cls.ship.corvette','cls.ground.light','cls.aviation.light',
    'wpn.ship.Легкие','wpn.ship.Средние',
    'wpn.ground.Противопехотное','wpn.ground.Противотанковое',
    'wpn.aviation.Курсовое вооружение'
  ]) t
  where not (coalesce(e.research,'[]'::jsonb) ? t));

-- ── 3) ТОРГОВЛЯ ТЕХНОЛОГИЯМИ: кулдаун «1 сделка в 3 дня» на фракцию ──
alter table public.tech_offers add column if not exists accepted_at timestamptz;
-- бэкдейт старых принятых сделок (точного времени нет — берём created_at)
update public.tech_offers set accepted_at = created_at where status = 'accepted' and accepted_at is null;

-- Последняя закрытая сделка фракции (любая сторона) моложе 3 дней?
create or replace function public._tech_trade_on_cooldown(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.tech_offers
    where status = 'accepted' and accepted_at > now() - interval '3 days'
      and (seller_fid = p_fid or buyer_fid = p_fid));
$$;
revoke all on function public._tech_trade_on_cooldown(text) from public;
grant execute on function public._tech_trade_on_cooldown(text) to authenticated;

-- Предложить (продавец): ранняя проверка кулдауна — не даём вешать
-- предложения, которые всё равно нельзя будет принять.
create or replace function public.tech_offer_propose(
  p_buyer_fid text, p_kind text,
  p_tech_key text, p_tech_label text,
  p_unit_name text, p_unit_category text, p_unit_snapshot jsonb, p_req_tech jsonb,
  p_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; b_owner uuid; sresearch jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_price is null or p_price < 0 then raise exception 'bad price'; end if;
  if p_kind not in ('tech','blueprint') then raise exception 'bad kind'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_buyer_fid = app.faction_id then raise exception 'self'; end if;
  select owner_id into b_owner from public.faction_applications where faction_id=p_buyer_fid and status='approved' order by updated_at desc limit 1;
  if b_owner is null then raise exception 'recipient not found'; end if;

  -- кулдаун: сделка (в любой роли) не чаще раза в 3 дня — ранняя проверка продавца
  if public._tech_trade_on_cooldown(app.faction_id) then raise exception 'tech trade cooldown'; end if;

  if p_kind = 'tech' then
    if coalesce(p_tech_key,'') = '' then raise exception 'no tech'; end if;
    select research into sresearch from public.faction_economy where faction_id=app.faction_id;
    if not (coalesce(sresearch,'[]'::jsonb) ? p_tech_key) then raise exception 'seller lacks tech'; end if;
  else
    if p_unit_snapshot is null then raise exception 'no blueprint'; end if;
  end if;

  insert into public.tech_offers(seller_fid, seller_owner, seller_name, buyer_fid, buyer_owner,
    kind, tech_key, tech_label, unit_name, unit_category, unit_snapshot, req_tech, price, status)
  values(app.faction_id, auth.uid(), app.name, p_buyer_fid, b_owner,
    p_kind, p_tech_key, p_tech_label, p_unit_name, p_unit_category, p_unit_snapshot,
    coalesce(p_req_tech,'[]'::jsonb), p_price, 'pending');
  return jsonb_build_object('ok', true);
end$$;

-- Принять (покупатель): кулдаун проверяется у ОБЕИХ сторон в момент сделки
create or replace function public.tech_offer_accept(p_offer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare off public.tech_offers; bapp public.faction_applications; bal numeric; bresearch jsonb; missing text; tk text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into off from public.tech_offers where id=p_offer_id for update;
  if not found then raise exception 'offer not found'; end if;
  if off.status <> 'pending' then raise exception 'offer not pending'; end if;
  if off.buyer_owner <> auth.uid() then raise exception 'forbidden'; end if;

  -- 1 сделка в 3 дня на фракцию (обе стороны сделки)
  if public._tech_trade_on_cooldown(off.seller_fid) then raise exception 'tech trade cooldown'; end if;
  if public._tech_trade_on_cooldown(off.buyer_fid)  then raise exception 'tech trade cooldown'; end if;

  select gc, research into bal, bresearch from public.faction_economy where faction_id=off.buyer_fid for update;
  if bal is null then raise exception 'no economy'; end if;
  if bal < off.price then raise exception 'not enough gc'; end if;

  if off.kind = 'blueprint' then
    for tk in select jsonb_array_elements_text(coalesce(off.req_tech,'[]'::jsonb)) loop
      if not (coalesce(bresearch,'[]'::jsonb) ? tk) then missing := tk; exit; end if;
    end loop;
    if missing is not null then raise exception 'missing prerequisites: %', missing; end if;
  end if;

  update public.faction_economy set gc = gc - off.price where faction_id=off.buyer_fid;
  update public.faction_economy set gc = gc + off.price where faction_id=off.seller_fid;

  if off.kind = 'tech' then
    if not (coalesce(bresearch,'[]'::jsonb) ? off.tech_key) then
      update public.faction_economy
        set research = coalesce(research,'[]'::jsonb) || to_jsonb(off.tech_key)
        where faction_id=off.buyer_fid;
    end if;
  else
    select * into bapp from public.faction_applications where faction_id=off.buyer_fid and status='approved' order by updated_at desc limit 1;
    insert into public.faction_units(category, name, summary, data, card_text,
      faction_id, faction_name, faction_color, owner_id, owner_email, updated_at)
    values(off.unit_category,
      coalesce(off.unit_snapshot->>'name', off.unit_name, 'Чертёж'),
      off.unit_snapshot->'summary',
      off.unit_snapshot->'data',
      off.unit_snapshot->>'card_text',
      off.buyer_fid, bapp.name, bapp.color, off.buyer_owner, null, now());
  end if;

  update public.tech_offers set status='accepted', accepted_at=now() where id=p_offer_id;
  return jsonb_build_object('ok', true, 'gc', bal - off.price);
end$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'tech_offer_propose(text,text,text,text,text,text,jsonb,jsonb,numeric)',
    'tech_offer_accept(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end$$;

-- ── Проверка после применения ───────────────────────────────
-- select count(*) from public.tech_nodes;                              -- 73
-- select node_id from public.tech_nodes where base_cost <= 5;          -- стартеры на месте
-- select faction_id, research ? 'cls.ship.corvette' from public.faction_economy limit 5;  -- бэкфилл
-- select public._tech_trade_on_cooldown('<fid>');
