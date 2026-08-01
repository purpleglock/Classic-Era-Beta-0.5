-- ════════════════════════════════════════════════════════════
-- ПИРАТСКАЯ ВОЛЬНИЦА — фракционные проекты Железного Дивизиона
-- ────────────────────────────────────────────────────────────
-- 6 кораблей на fid Железного Дивизиона (fac_5bfbfad5f8): строить их
-- может только эта фракция, но в бот-боях они участвуют независимо —
-- admin_bot_battle набирает ЛЮБЫЕ опубликованные ship-проекты с hp>0,
-- фильтра по фракции там нет.
--
-- Замысел: пираты — разносторонний, но не запредельный противник.
-- Ставка на роли и позиционку (скорость, стелс, РЭБ, дистанция),
-- а не на «жирные» цифры: потолок hp 7165 = уровень пан-колониального
-- бронированного крейсера, выше не лезем.
--
-- Каналы урона выверены по _cn_wpn_kind (имя орудия → канал):
-- «Нови-Сад»/«Феникс»/«Нубранон» = missile (гасится ПРО),
-- «Фотоид»/«Гало»/«Страж»/«Стрелка»/камикадзе = ballistic→kinetic.
-- Дальнобойный урон «Стервятника» намеренно в ракетном канале, чтобы
-- у игрока был контрплей через ПРО, а не безответная стрельба с 30 гекс.
--
-- Идемпотентно: сносит прежние версии по ТОЧНОМУ списку имён.
-- ⚠ Не расширять очистку до LIKE-префикса: страж _unit_delete_guard
-- роняет весь скрипт, если под маску попадёт дизайн с построенными юнитами.
-- ════════════════════════════════════════════════════════════
do $$
declare
  v_fid   text := 'fac_5bfbfad5f8';
  v_fname text := 'Железный Дивизион';
  v_fcol  text := 'rgba(0,0,0,0.34)';
  v_data jsonb;
  v_sum  jsonb;
begin
  delete from public.faction_units where faction_id = v_fid and name = any(array[
    'Пиратский корвет «Шакал»',
    'Пиратский рейдер «Ржавый нож»',
    'Пиратская глушилка «Сорока»',
    'Пиратский катер «Гарпия»',
    'Пиратский дрон-носитель «Стервятник»',
    'Пиратский бронеход «Костолом»']);

  -- 1. «Шакал» — быстрый абордажник, роевая единица
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',2,'shield',1,'engine',3,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',3)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратский корвет «Шакал»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Скорость 10 при дальности всего 3 гекса: «Шакал» существует, чтобы добежать. Дёшев, идёт стаей, по одному не опасен — опасен, когда их шесть.');

  -- 2. «Ржавый нож» — стелс-засадник
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',1,'shield',1,'engine',4,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Конструкционные модули','idx',3)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратский рейдер «Ржавый нож»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Маскировка 3, свой радар на 13 гекс и ракеты на 30: бьёт первым с дистанции, на которой его ещё не видят. Корпус картонный — в размене погибает мгновенно.');

  -- 3. «Сорока» — РЭБ-подавление
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g','Модули радиотумана','idx',0),
      jsonb_build_object('g','Модули радиотумана','idx',5)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратская глушилка «Сорока»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Глушение 5 и сенсор 4 при скорости 10: ослепляет чужие радары и подсвечивает цели своим. Убивать им неудобно — он нужен, чтобы убивали остальные.');

  -- 4. «Гарпия» — дешёвый ракетный катер
  v_data := jsonb_build_object(
    'class','corvette','reactor',1,'armor',1,'shield',1,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',2,'q',4)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратский катер «Гарпия»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Четыре пусковые РГЧ «Феникс» на самом дешёвом корпусе флота. Ракетный залп с 15 гекс, но любая ПРО срезает его вдвое, а один удачный выстрел в ответ — и катера нет.');

  -- 5. «Стервятник» — дальнобойная «артиллерия» пиратов
  v_data := jsonb_build_object(
    'class','supportCarrier','reactor',0,'armor',2,'shield',2,'engine',2,'radar',2,
    'weapons', jsonb_build_array(
      jsonb_build_object('g','АВИАГРУППЫ И ДРОНЫ','idx',0,'q',2),
      jsonb_build_object('g','АНГАРЫ И АВИАГРУППЫ','idx',1,'q',1)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратский дрон-носитель «Стервятник»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Звенья перехватчиков и рой ударных дронов работают на 30 гекс — главный источник урона стаи. Основная часть залпа идёт ракетным каналом, поэтому ПРО против него работает. Скорость 4: догнать не может, убежать тоже.');

  -- 6. «Костолом» — вожак стаи
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',3,'armor',3,'shield',4,'engine',2,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Конструкционные модули','idx',4)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Пиратский бронеход «Костолом»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Трофейный крейсер под наноброней с активной защитой 0.35 — вожак стаи. Два рельсотрона «Годдард» ломают всё в упор, но дальность 3 и скорость 4: на дистанции его переигрывают, вблизи — почти никогда.');
end $$;
