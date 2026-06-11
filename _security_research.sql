-- ============================================================
-- ЭТАП 2d — ИССЛЕДОВАНИЯ НА СЕРВЕРЕ (закрывает free-tech через консоль)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Было: economy_research доверял p_cost от клиента и НЕ проверял prereq →
--   из консоли можно изучить любой узел за 0 ОН, минуя зависимости, и получить
--   доктринные бонусы (которые читает _faction_mods) бесплатно.
-- Стало: цена и зависимости берутся из каталога tech_nodes (на сервере).
--   Сигнатура RPC прежняя — старый p_cost игнорируется (клиент не трогаем).
--
-- ⚠ tech_nodes — зеркало ecBuildResearch() из economy.js. Если ДОБАВЛЯЕШЬ
--   техи/юниты — перегенерируй список (в консоли на странице «Экономика»:
--     copy(JSON.stringify(ecBuildResearch().map(n=>({id:n.id,cost:n.cost,prereq:n.prereq||[]}))))
--   ) и обнови вставку ниже, иначе новый узел нельзя будет изучить.
-- ============================================================

-- ── Каталог узлов исследований (источник истины цены и зависимостей) ──
create table if not exists public.tech_nodes (
  node_id   text primary key,
  base_cost numeric not null,
  prereq    jsonb not null default '[]'::jsonb
);
alter table public.tech_nodes enable row level security;
drop policy if exists "tn_sel" on public.tech_nodes;
create policy "tn_sel" on public.tech_nodes for select to public using (true);  -- каталог, не секрет

-- ── Наполнение (зеркало дерева на 2026-06-11) ───────────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
('cls.ship.frigate',5,'[]'),
('cls.ship.destroyer',10,'["cls.ship.frigate"]'),
('cls.ship.cruiser',20,'["cls.ship.destroyer"]'),
('cls.ship.battleship',40,'["cls.ship.cruiser"]'),
('cls.ship.dreadnought',80,'["cls.ship.battleship"]'),
('wpn.ship.Тяжёлые',12,'["cls.ship.cruiser"]'),
('wpn.ship.Сверхтяжёлые',20,'["cls.ship.battleship"]'),
('wpn.ship.Ракетное',28,'["cls.ship.destroyer"]'),
('wpn.ship.Зенитное',36,'["cls.ship.frigate"]'),
('comp.ship.reactor',16,'["cls.ship.destroyer"]'),
('comp.ship.armor',14,'["cls.ship.destroyer"]'),
('comp.ship.shield',16,'["cls.ship.cruiser"]'),
('comp.ship.engine',10,'["cls.ship.frigate"]'),
('type.ship.corvette',10,'[]'),
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
('cls.ground.medium',5,'[]'),
('cls.ground.artillery',10,'["cls.ground.medium"]'),
('cls.ground.heavy',20,'["cls.ground.artillery"]'),
('cls.ground.walker',40,'["cls.ground.heavy"]'),
('wpn.ground.Артиллерия и ПВО',12,'["cls.ground.artillery"]'),
('comp.ground.armor',14,'["cls.ground.heavy"]'),
('comp.ground.shield',16,'["cls.ground.heavy"]'),
('comp.ground.engine',10,'["cls.ground.medium"]'),
('mod.ground.Оптика и Связь',8,'[]'),
('mod.ground.Защита и Поддержка',13,'["mod.ground.Оптика и Связь"]'),
('cls.aviation.medium',5,'[]'),
('cls.aviation.heavy',10,'["cls.aviation.medium"]'),
('cls.aviation.cargo',20,'["cls.aviation.heavy"]'),
('wpn.aviation.Ракетное и бомбовое',12,'["cls.aviation.medium"]'),
('wpn.aviation.Спецоборудование',20,'["cls.aviation.heavy"]'),
('comp.aviation.reactor',16,'["cls.aviation.medium"]'),
('comp.aviation.armor',14,'["cls.aviation.heavy"]'),
('comp.aviation.shield',16,'["cls.aviation.heavy"]'),
('comp.aviation.engine',10,'["cls.aviation.medium"]'),
('type.aviation.light',10,'[]'),
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
('pol.cel_anomaly',60,'["pol.cel_giants"]')
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── Новый economy_research: цена и prereq считает СЕРВЕР ─────
-- Сигнатура та же (text, numeric), p_cost от клиента игнорируется.
create or replace function public.economy_research(p_node text, p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; tn public.tech_nodes;
  max_slots int := 1; active_cnt int; cost numeric; missing text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_node is null or p_node = '' then raise exception 'bad node'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  select * into eco from public.faction_economy where faction_id=app.faction_id;
  if not found then raise exception 'no economy'; end if;

  -- узел из каталога — источник истины цены и зависимостей (НЕ клиентский p_cost)
  select * into tn from public.tech_nodes where node_id = p_node;
  if not found then raise exception 'unknown tech node'; end if;

  if public._faction_is_robot(app.faction_id) then max_slots := 2; end if;
  active_cnt := (eco.research_active is not null)::int + (eco.research_active2 is not null)::int;
  if active_cnt >= max_slots then raise exception 'research in progress'; end if;
  if eco.research_active = p_node or eco.research_active2 = p_node then raise exception 'already in progress'; end if;
  if coalesce(eco.research,'[]'::jsonb) ? p_node then raise exception 'already researched'; end if;

  -- ВСЕ предшественники должны быть изучены (раньше проверялось только на клиенте)
  select string_agg(value, ', ') into missing
    from jsonb_array_elements_text(coalesce(tn.prereq,'[]'::jsonb)) as value
    where not (coalesce(eco.research,'[]'::jsonb) ? value);
  if missing is not null then raise exception 'missing prerequisites: %', missing; end if;

  -- цена на сервере: max(1, round(base * mods.research)) — зеркало ecResearchCost
  cost := greatest(1, round(tn.base_cost * (public._faction_mods(app.faction_id)->>'research')::numeric));
  if coalesce(eco.science,0) < cost then raise exception 'not enough science'; end if;

  if eco.research_active is null then
    update public.faction_economy
      set science = science - cost, research_active = p_node, research_ready = now() + interval '1 day'
      where faction_id = app.faction_id;
  else
    update public.faction_economy
      set science = science - cost, research_active2 = p_node, research_ready2 = now() + interval '1 day'
      where faction_id = app.faction_id;
  end if;
  return jsonb_build_object('ok', true, 'cost', cost, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.economy_research(text,numeric) from public;
grant execute on function public.economy_research(text,numeric) to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select count(*) from public.tech_nodes;   -- должно быть 62
-- В игре: исследование изучается за нормальную цену; из консоли нельзя
-- изучить узел с невыполненными prereq или за заниженную цену.
