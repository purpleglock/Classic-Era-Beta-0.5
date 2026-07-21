-- ============================================================
-- tech_nodes ДЛЯ KV-КАТАЛОГА (АВТОГЕН) — НЕ РЕДАКТИРОВАТЬ РУКАМИ
-- Источник: constructors_kv*.js. Перегенерация: node tools/gen_tech_nodes_kv.js
-- Применять в Supabase ПОСЛЕ _research_total.sql (и ВМЕСТЕ с выкатом клиента,
-- где CN_BASE = стартеры: без клиента игроки не увидят замки, без SQL сервер
-- не примет новые id). Идемпотентно.
--
-- 1) Ресид каталога узлов конструктора под KV-классы/группы (политика pol.* не
--    трогается). 2) Миграция faction_economy.research: легаси-ключи → KV-ключи,
--    ключи-стартеры выпадают (база бесплатна), мусор чистится. 3) Overlay
--    стаффских правок связей (tech_prereq) переприменяется.
-- ============================================================

-- ── 1) Каталог: KV-узлы конструктора ──
insert into public.tech_nodes (node_id, base_cost, prereq) values
('cls.ship.destroyer',5,'[]'),
('cls.ship.supportCarrier',10,'["cls.ship.destroyer"]'),
('cls.ship.mediumCruiser',20,'["cls.ship.supportCarrier"]'),
('cls.ship.hyperCruiser',40,'["cls.ship.mediumCruiser"]'),
('cls.ship.multiroleCarrier',80,'["cls.ship.hyperCruiser"]'),
('cls.ship.battleship',160,'["cls.ship.multiroleCarrier"]'),
('cls.ship.dreadnought',320,'["cls.ship.battleship"]'),
('cls.ship.ss13',640,'["cls.ship.dreadnought"]'),
('wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ',12,'["cls.ship.destroyer"]'),
('wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ',20,'["cls.ship.mediumCruiser"]'),
('wpn.ship.АНГАРЫ И АВИАГРУППЫ',28,'["cls.ship.supportCarrier"]'),
('wpn.ship.АВИАГРУППЫ И ДРОНЫ',36,'["cls.ship.supportCarrier"]'),
('comp.ship.reactor',16,'["cls.ship.destroyer"]'),
('comp.ship.armor',14,'["cls.ship.mediumCruiser"]'),
('comp.ship.shield',16,'["cls.ship.mediumCruiser"]'),
('comp.ship.engine',10,'["cls.ship.destroyer"]'),
('comp.ship.radar',12,'["cls.ship.destroyer"]'),
('mod.ship.Конструкционные модули',8,'[]'),
('mod.ship.Модули радиотумана',13,'["mod.ship.Конструкционные модули"]'),
('mod.ship.Десант',18,'["mod.ship.Модули радиотумана"]'),
('mod.ship.Модули станции',23,'["mod.ship.Десант"]'),
('cls.ground.btr',5,'[]'),
('cls.ground.tanki',10,'["cls.ground.btr"]'),
('cls.ground.arta',20,'["cls.ground.tanki"]'),
('wpn.ground.ШТУРМОВОЕ ОРУЖИЕ',12,'[]'),
('wpn.ground.ПУЛЕМЕТЫ',20,'["cls.ground.btr"]'),
('wpn.ground.ГРАНАТЫ И МИНЫ',28,'[]'),
('wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ',36,'["cls.ground.btr"]'),
('wpn.ground.КИНЕТИКА',44,'["cls.ground.tanki"]'),
('wpn.ground.ЭНЕРГЕТИКА',52,'["cls.ground.tanki"]'),
('wpn.ground.РАКЕТНОЕ (БУМ)',60,'["cls.ground.tanki"]'),
('wpn.ground.ПУЛЕМЕТЫ И ТУРЕЛИ',68,'["cls.ground.btr"]'),
('wpn.ground.ОСНОВНОЙ КАЛИБР',76,'["cls.ground.tanki"]'),
('wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ',84,'["cls.ground.arta"]'),
('wpn.ground.РЕАКТИВНЫЕ СИСТЕМЫ',92,'["cls.ground.arta"]'),
('comp.ground.reactor',16,'["cls.ground.btr"]'),
('comp.ground.armor',14,'["cls.ground.tanki"]'),
('comp.ground.shield',16,'["cls.ground.tanki"]'),
('comp.ground.engine',10,'["cls.ground.btr"]'),
('comp.ground.radar',12,'["cls.ground.btr"]'),
('mod.ground.Конструкционные модули',8,'[]'),
('mod.ground.Десант',13,'["mod.ground.Конструкционные модули"]'),
('cls.aviation.aviacia',5,'[]'),
('cls.aviation.vertihui',10,'["cls.aviation.aviacia"]'),
('cls.aviation.dronkos',20,'["cls.aviation.vertihui"]'),
('cls.aviation.mla',40,'["cls.aviation.dronkos"]'),
('wpn.aviation.АВИАПУШКИ',12,'["cls.aviation.aviacia"]'),
('wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ',20,'["cls.aviation.aviacia"]'),
('wpn.aviation.ПУШКИ И ТУРЕЛИ',28,'["cls.aviation.vertihui"]'),
('wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ',36,'["cls.aviation.dronkos"]'),
('comp.aviation.reactor',16,'["cls.aviation.aviacia"]'),
('comp.aviation.armor',14,'["cls.aviation.vertihui"]'),
('comp.aviation.shield',16,'["cls.aviation.dronkos"]'),
('comp.aviation.engine',10,'["cls.aviation.aviacia"]'),
('comp.aviation.radar',12,'["cls.aviation.aviacia"]'),
('mod.aviation.Десант',8,'[]'),
('mod.aviation.Конструкционные модули',13,'["mod.aviation.Десант"]')
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- Старые узлы конструктора, которых нет в KV-дереве — убрать (pol.* остаются)
delete from public.tech_nodes
 where (node_id like 'cls.%' or node_id like 'wpn.%' or node_id like 'comp.%'
     or node_id like 'mod.%' or node_id like 'type.%' or node_id like 'hangar.%')
   and node_id not in ('cls.ship.destroyer','cls.ship.supportCarrier','cls.ship.mediumCruiser','cls.ship.hyperCruiser','cls.ship.multiroleCarrier','cls.ship.battleship','cls.ship.dreadnought','cls.ship.ss13','wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ','wpn.ship.АНГАРЫ И АВИАГРУППЫ','wpn.ship.АВИАГРУППЫ И ДРОНЫ','comp.ship.reactor','comp.ship.armor','comp.ship.shield','comp.ship.engine','comp.ship.radar','mod.ship.Конструкционные модули','mod.ship.Модули радиотумана','mod.ship.Десант','mod.ship.Модули станции','cls.ground.btr','cls.ground.tanki','cls.ground.arta','wpn.ground.ШТУРМОВОЕ ОРУЖИЕ','wpn.ground.ПУЛЕМЕТЫ','wpn.ground.ГРАНАТЫ И МИНЫ','wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ','wpn.ground.КИНЕТИКА','wpn.ground.ЭНЕРГЕТИКА','wpn.ground.РАКЕТНОЕ (БУМ)','wpn.ground.ПУЛЕМЕТЫ И ТУРЕЛИ','wpn.ground.ОСНОВНОЙ КАЛИБР','wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ','wpn.ground.РЕАКТИВНЫЕ СИСТЕМЫ','comp.ground.reactor','comp.ground.armor','comp.ground.shield','comp.ground.engine','comp.ground.radar','mod.ground.Конструкционные модули','mod.ground.Десант','cls.aviation.aviacia','cls.aviation.vertihui','cls.aviation.dronkos','cls.aviation.mla','wpn.aviation.АВИАПУШКИ','wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ','wpn.aviation.ПУШКИ И ТУРЕЛИ','wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ','comp.aviation.reactor','comp.aviation.armor','comp.aviation.shield','comp.aviation.engine','comp.aviation.radar','mod.aviation.Десант','mod.aviation.Конструкционные модули');

-- ── 2) Миграция исследований фракций: легаси → KV ──
with mig(old_id, new_id) as (values
  ('cls.ship.frigate','cls.ship.destroyer'),
  ('cls.ship.cruiser','cls.ship.mediumCruiser'),
  ('cls.ground.light',null),
  ('cls.ground.medium','cls.ground.btr'),
  ('cls.ground.heavy','cls.ground.tanki'),
  ('cls.ground.artillery','cls.ground.arta'),
  ('cls.ground.walker','cls.ground.tanki'),
  ('cls.aviation.light',null),
  ('cls.aviation.medium','cls.aviation.aviacia'),
  ('cls.aviation.heavy','cls.aviation.vertihui'),
  ('cls.aviation.cargo','cls.aviation.dronkos'),
  ('wpn.ship.Легкие',null),
  ('wpn.ship.Средние',null),
  ('wpn.ship.Тяжёлые','wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ'),
  ('wpn.ship.Сверхтяжёлые','wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ'),
  ('wpn.ship.Ракетное','wpn.ship.ВЗРЫВНОЕ ВООРУЖЕНИЕ'),
  ('wpn.ship.Зенитное','wpn.ship.ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ'),
  ('wpn.ground.Противопехотное','wpn.ground.ШТУРМОВОЕ ОРУЖИЕ'),
  ('wpn.ground.Противотанковое','wpn.ground.ТЯЖЕЛОЕ ВООРУЖЕНИЕ'),
  ('wpn.ground.Артиллерия и ПВО','wpn.ground.СТВОЛЬНАЯ АРТИЛЛЕРИЯ'),
  ('wpn.aviation.Курсовое вооружение','wpn.aviation.АВИАПУШКИ'),
  ('wpn.aviation.Ракетное и бомбовое','wpn.aviation.РАКЕТНОЕ ВООРУЖЕНИЕ'),
  ('wpn.aviation.Спецоборудование','wpn.aviation.КОСМИЧЕСКОЕ ВООРУЖЕНИЕ'),
  ('mod.ship.Радарное оборудование','comp.ship.radar'),
  ('mod.ship.Радиоэлектронная борьба','mod.ship.Модули радиотумана'),
  ('mod.ship.Активная защита','mod.ship.Конструкционные модули'),
  ('mod.ship.Управление','mod.ship.Конструкционные модули'),
  ('mod.ship.Спец. системы','mod.ship.Модули станции'),
  ('mod.ground.Оптика и Связь','mod.ground.Конструкционные модули'),
  ('mod.ground.Защита и Поддержка','mod.ground.Десант'),
  ('mod.aviation.Авионика и Радары','mod.aviation.Конструкционные модули'),
  ('mod.aviation.Защита и РЭБ','mod.aviation.Конструкционные модули'),
  ('mod.aviation.Служебные','mod.aviation.Десант'),
  ('hangar.ship','wpn.ship.АНГАРЫ И АВИАГРУППЫ'),
  ('hangar.ship.heavy','wpn.ship.АВИАГРУППЫ И ДРОНЫ')
)
update public.faction_economy e
set research = (
  select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (
    select coalesce(m.new_id, r.x) as v
    from jsonb_array_elements_text(coalesce(e.research,'[]'::jsonb)) r(x)
    left join mig m on m.old_id = r.x
  ) t
  -- оставляем только живые узлы (KV-дерево + политика); null (стартеры) выпадают
  where v is not null
    and (v like 'pol.%' or exists (select 1 from public.tech_nodes n where n.node_id = v))
)
where coalesce(e.research,'[]'::jsonb) <> '[]'::jsonb;

-- Очередь исследований: выкинуть отовсюду умершие id
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name='faction_economy' and column_name='research_queue') then
    update public.faction_economy e
    set research_queue = (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(e.research_queue,'[]'::jsonb)) r(x)
      where exists (select 1 from public.tech_nodes n where n.node_id = x))
    where coalesce(e.research_queue,'[]'::jsonb) <> '[]'::jsonb;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name='faction_economy' and column_name='research_slots') then
    update public.faction_economy e
    set research_slots = (
      select coalesce(jsonb_agg(x), '[]'::jsonb)
      from jsonb_array_elements_text(coalesce(e.research_slots,'[]'::jsonb)) r(x)
      where exists (select 1 from public.tech_nodes n where n.node_id = x))
    where coalesce(e.research_slots,'[]'::jsonb) <> '[]'::jsonb;
  end if;
end $$;

-- ── 3) Overlay стаффских правок связей поверх сида ──
do $$ begin
  if to_regclass('public.tech_prereq') is not null then
    update public.tech_nodes n
       set prereq = tp.prereq
      from public.tech_prereq tp
     where tp.node_id = n.node_id
       and n.prereq is distinct from tp.prereq;
    -- правки, указывающие на умершие узлы — убрать, чтобы не блокировали дерево
    delete from public.tech_prereq tp
     where not exists (select 1 from public.tech_nodes n where n.node_id = tp.node_id);
  end if;
end $$;

-- Проверка:
-- select count(*) from public.tech_nodes where node_id like 'cls.%';  -- 15
-- select count(*) from public.tech_nodes;  -- KV-узлов: 57 (+ pol.*)
