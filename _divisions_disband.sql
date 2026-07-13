-- ============================================================
-- РАЗОВЫЙ СКРИПТ v2: расформировать ВСЕ дивизии (2026-07-14).
-- Дивизии выпилены: армии собираются ТОЛЬКО из юнитов (ground/aviation).
--
-- v2 (ВАЖНО, лечит потерю юнитов после v1): штатные модели дивизий
-- (Ополчение, ОБТ, РСЗО, беспилотники и т.д. — CN_DIV_DATA) теперь
-- МАТЕРИАЛИЗУЮТСЯ как общедоступные юниты-проекты (faction_units без
-- фракции) и возвращаются игрокам как готовые юниты — v1 их молча
-- списывал. Повторный прогон безопасен (идемпотентно).
--
-- Срезы:
--  0) 20 штатных моделей → общедоступные проекты юнитов (метка data.stock_id)
--  1) стеки дивизий в составе → готовые юниты (tech-компоненты + штатные)
--  2) дивизии внутри армий → юниты в composition
--  3) ЛЕЧЕНИЕ ПОСЛЕ v1: армии с ПУСТЫМ составом — восстановить состав по
--     чертежу дивизии владельца ×1 (если у фракции ровно один чертёж
--     дивизии; если несколько — notice в лог, чинить вручную)
--
-- Катить ПОСЛЕ _wellbeing_armies.sql.
-- ============================================================

-- ── 0) материализация штатных моделей как общедоступных юнитов ──
do $$
declare m record;
begin
  for m in select * from (values
    ('inf_militia','Ополчение','ground',10,1,1,1,'{"Железо":1}'::jsonb),
    ('inf_regular','Регулярная пехота','ground',35,2,3,2,'{"Железо":2}'::jsonb),
    ('inf_heavy','Тяжелая/Штурмовая пехота','ground',80,5,6,2,'{"Железо":5,"Титан":1}'::jsonb),
    ('inf_spec','Спецназ / Десант','ground',150,4,10,3,'{"Железо":4,"Титан":2,"Редкоземельные руды":1}'::jsonb),
    ('inf_robot','Роботизированная пехота','ground',50,4,10,3,'{"Железо":6,"Медь":3,"Редкоземельные руды":1}'::jsonb),
    ('tank_light','Легкий танк','ground',300,30,25,4,'{"Железо":6,"Медь":2}'::jsonb),
    ('tank_mbt','Основной Боевой Танк','ground',500,80,70,5,'{"Железо":12,"Титан":4,"Медь":3}'::jsonb),
    ('tank_heavy','Тяжелый танк прорыва','ground',1000,150,110,5,'{"Железо":20,"Титан":8,"Платина":2}'::jsonb),
    ('tank_walker','Штурмовой Шагоход','ground',1500,120,140,6,'{"Железо":18,"Титан":9,"Редкоземельные руды":3}'::jsonb),
    ('btr_wheel','Колесный бронетранспортер','ground',250,15,10,2,'{"Железо":4,"Медь":1}'::jsonb),
    ('bmp_track','Гусеничная БМП','ground',450,35,25,3,'{"Железо":7,"Титан":2,"Медь":2}'::jsonb),
    ('btr_hover','Грави-транспорт','ground',800,25,15,3,'{"Железо":5,"Медь":3,"Редкоземельные руды":1}'::jsonb),
    ('art_mortar','Мобильная минометная батарея','ground',200,5,40,15,'{"Железо":4,"Изотопы":1}'::jsonb),
    ('art_sau','Самоходная артустановка','ground',900,20,90,40,'{"Железо":10,"Титан":3,"Изотопы":2}'::jsonb),
    ('art_rszo','РСЗО','ground',1200,15,150,60,'{"Железо":9,"Титан":2,"Изотопы":3}'::jsonb),
    ('art_laser','Тяжелое плазменное/лазерное орудие','ground',3500,30,250,80,'{"Железо":12,"Редкоземельные руды":5,"Гелий-3":2}'::jsonb),
    ('air_drone','Ударный беспилотник','aviation',500,2,40,50,'{"Титан":2,"Редкоземельные руды":1}'::jsonb),
    ('air_heli','Штурмовой ганшип','aviation',1500,15,100,30,'{"Титан":5,"Медь":2,"Дейтерий":1}'::jsonb),
    ('air_fighter','Атмосферный истребитель','aviation',2000,10,150,150,'{"Титан":6,"Редкоземельные руды":2,"Дейтерий":2}'::jsonb),
    ('air_bomber','Тяжелый тактический бомбардировщик','aviation',2500,25,400,200,'{"Титан":10,"Редкоземельные руды":3,"Изотопы":2,"Дейтерий":2}'::jsonb)
  ) as v(sid, nm, cat, cost, armor, dmg, dal, bill) loop
    if not exists (select 1 from public.faction_units
                   where data->>'stock_id' = m.sid) then
      insert into public.faction_units(id, name, category, faction_id, owner_id, data, summary)
        values (gen_random_uuid(), m.nm, m.cat, null, null,
                jsonb_build_object('stock_id', m.sid, 'stock', true),
                jsonb_build_object('cost', m.cost, 'armor', m.armor, 'hp', 0,
                                   'dmg', m.dmg, 'dalnost', m.dal, 'bill', m.bill));
    end if;
  end loop;
end$$;

-- Компоненты блока дивизии → (unit_id, name, category) реального юнита.
-- Понимает и 'tech:<uuid>' (зарегистрированная техника), и штатные модели.
create or replace function public._div_block_unit(p_model text,
  out o_id uuid, out o_name text, out o_cat text)
language plpgsql stable security definer set search_path=public as $$
begin
  if p_model like 'tech:%' then
    select fu.id, fu.name, fu.category into o_id, o_name, o_cat
      from public.faction_units fu
      where fu.id = nullif(substring(p_model from 6),'')::uuid
        and fu.category in ('ground','aviation');
  else
    select fu.id, fu.name, fu.category into o_id, o_name, o_cat
      from public.faction_units fu
      where fu.data->>'stock_id' = p_model limit 1;
  end if;
end$$;
revoke all on function public._div_block_unit(text) from public;

-- ── 1) стеки дивизий в составе → готовые юниты ──
do $$
declare r record; blk jsonb; u record; cnt int;
begin
  for r in select p.faction_id, p.owner_id, p.unit_id, coalesce(p.qty,1) as qty
           from public.unit_production p
           where p.category = 'division' and p.status = 'done' loop
    for blk in select value from jsonb_array_elements(coalesce(
        (select fu.data->'blocks' from public.faction_units fu where fu.id = r.unit_id),
        '[]'::jsonb)) loop
      select * into u from public._div_block_unit(blk->>'modelId');
      if u.o_id is not null then
        cnt := greatest(0, coalesce((blk->>'count')::int, 0)) * greatest(1, r.qty);
        if cnt > 0 then
          insert into public.unit_production(faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at)
            values (r.faction_id, r.owner_id, u.o_id, u.o_name, u.o_cat, 'military_factory', cnt, 'done', now());
        end if;
      end if;
    end loop;
  end loop;
  delete from public.unit_production where category = 'division';
end$$;

-- ── 2) дивизии внутри армий → юниты в composition ──
do $$
declare a record; elem jsonb; newcomp jsonb; blk jsonb; u record; cnt int;
begin
  for a in select * from public.armies loop
    newcomp := '[]'::jsonb;
    for elem in select value from jsonb_array_elements(coalesce(a.composition, '[]'::jsonb)) loop
      if coalesce(elem->>'category','') <> 'division' then
        newcomp := newcomp || elem;
      else
        for blk in select value from jsonb_array_elements(coalesce(
            (select fu.data->'blocks' from public.faction_units fu
             where fu.id = nullif(elem->>'unit_id','')::uuid),
            '[]'::jsonb)) loop
          select * into u from public._div_block_unit(blk->>'modelId');
          if u.o_id is not null then
            cnt := greatest(0, coalesce((blk->>'count')::int, 0))
                   * greatest(1, coalesce((elem->>'qty')::int, 1));
            if cnt > 0 then
              newcomp := newcomp || jsonb_build_object(
                'unit_id', u.o_id::text, 'unit_name', u.o_name, 'category', u.o_cat, 'qty', cnt);
            end if;
          end if;
        end loop;
      end if;
    end loop;
    if newcomp is distinct from a.composition then
      update public.armies set composition = newcomp where id = a.id;
    end if;
  end loop;
end$$;

-- ── 3) ЛЕЧЕНИЕ ПОСЛЕ v1: армии, опустошённые первым прогоном ──
-- v1 вычищал штатные компоненты в ноль → армия «0 юнит.». Восстанавливаем
-- состав по чертежу дивизии фракции ×1 (только если чертёж ровно один —
-- иначе неоднозначно, пишем notice и оставляем на ручную правку).
do $$
declare a record; dcount int; ddes record; blk jsonb; u record; cnt int; newcomp jsonb;
begin
  for a in select * from public.armies
           where coalesce(composition,'[]'::jsonb) = '[]'::jsonb loop
    select count(*) into dcount from public.faction_units
      where category='division' and faction_id = a.faction_id;
    if dcount <> 1 then
      raise notice 'армия % (%) пуста, у фракции % чертежей дивизий — восстановите состав вручную',
        a.id, coalesce(a.name,'-'), dcount;
      continue;
    end if;
    select * into ddes from public.faction_units
      where category='division' and faction_id = a.faction_id limit 1;
    newcomp := '[]'::jsonb;
    for blk in select value from jsonb_array_elements(coalesce(ddes.data->'blocks','[]'::jsonb)) loop
      select * into u from public._div_block_unit(blk->>'modelId');
      if u.o_id is not null then
        cnt := greatest(0, coalesce((blk->>'count')::int, 0));
        if cnt > 0 then
          newcomp := newcomp || jsonb_build_object(
            'unit_id', u.o_id::text, 'unit_name', u.o_name, 'category', u.o_cat, 'qty', cnt);
        end if;
      end if;
    end loop;
    if newcomp <> '[]'::jsonb then
      update public.armies set composition = newcomp where id = a.id;
      raise notice 'армия % (%): состав восстановлен по чертежу «%»', a.id, coalesce(a.name,'-'), ddes.name;
    end if;
  end loop;
end$$;
