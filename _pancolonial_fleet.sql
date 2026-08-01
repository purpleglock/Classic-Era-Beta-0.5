-- ════════════════════════════════════════════════════════════
-- ПАН-КОЛОНИАЛЬНЫЙ ФЛОТ — публичные учебные проекты кораблей
-- ────────────────────────────────────────────────────────────
-- 7 дешёвых кораблей (faction_id=null → «Общедоступная» в каталоге
-- конструкторов), каждый — витрина ОДНОЙ боевой механики: ракеты,
-- стелс, броня, РЭБ, радар, орудия, нано-ремонт. Строятся любой
-- фракцией сразу и без исследований — это уже так для общедоступных
-- дизайнов в economy_produce ("свои ИЛИ общедоступные").
-- ОН с казны не списывается (публикация в обход economy_publish_unit,
-- как заведено для стафф-контента без фракции).
-- Идемпотентно: сносит прежние версии по имени перед вставкой.
-- ════════════════════════════════════════════════════════════
do $$
declare
  -- нужен только как owner_id нано-турели (faction_turrets.owner_id NOT NULL);
  -- сам корабль/турель остаются faction_id=null — общедоступны всем.
  v_staff uuid := 'aae388fd-c3ed-4592-bad0-7a61e32e9b00';
  v_turret_cfg jsonb := '{"klass":"medium","tech":"nano","caliber":150,"barrels":2,"barrelLen":50,"size":1,"layout":"row"}'::jsonb;
  v_turret_id uuid;
  v_data jsonb;
  v_sum jsonb;
begin
  delete from public.faction_units where faction_id is null and name = any(array[
    'Пан-колониальный ракетный корвет',
    'Пан-колониальный стелс-разведчик',
    'Пан-колониальный бронированный крейсер',
    'Пан-колониальный корабль РЭБ',
    'Пан-колониальный радар-разведчик',
    'Пан-колониальный артиллерийский эсминец',
    'Пан-колониальный ремонтный крейсер']);
  delete from public.faction_turrets where faction_id is null and name = 'Ремонтный нанорой «Гефест»';

  -- ── Нано-турель для ремонтного крейсера ─────────────────────
  insert into public.faction_turrets (owner_id, faction_id, name, cfg, stats, carriers)
  values (
    v_staff, null, 'Ремонтный нанорой «Гефест»',
    public._tg_norm(v_turret_cfg),
    public._tg_stats(v_turret_cfg),
    public._tg_carriers(public._tg_norm(v_turret_cfg), public._tg_stats(v_turret_cfg))
  ) returning id into v_turret_id;

  -- 1. Ракетный корвет — канал missile
  v_data := jsonb_build_object(
    'class','corvette','reactor',1,'armor',1,'shield',1,'engine',2,'radar',0,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный ракетный корвет', null, null, v_sum, v_data,
    'Витрина канала «ракеты»: пусковые УР-4 «Нови-Сад» бьют на дистанции до 30 гекс — дальше любых пушек, но снаряд летит по прямой и перехватывается ПРО цели.');

  -- 2. Стелс-разведчик — канал stealth
  -- ⚠ armor=0 («Нет выбранной брони») в _cn_kv_armor_hp жёстко даёт hp=0 —
  -- корабль без брони физически не имеет корпуса. Ставим базовую броню.
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',1)),
    'modules', jsonb_build_array(jsonb_build_object('g','Конструкционные модули','idx',3)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный стелс-разведчик', null, null, v_sum, v_data,
    'Витрина маскировки: ренегатский транспондер поднимает скрытность корпуса, а собственный дальний радар (13 гекс) находит противника раньше, чем находят его самого.');

  -- 3. Бронированный крейсер — канал armor
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',1,'armor',3,'shield',1,'engine',1,'radar',0,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный бронированный крейсер', null, null, v_sum, v_data,
    'Витрина брони: эрлендийская наноброня «Мелоди» держит корпус в разы дольше стандартной стали — ставка на прочность корпуса, а не на щит.');

  -- 4. Корабль РЭБ — канал jam
  v_data := jsonb_build_object(
    'class','destroyer','reactor',2,'armor',1,'shield',1,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',1)),
    'modules', jsonb_build_array(jsonb_build_object('g','Модули радиотумана','idx',0)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный корабль РЭБ', null, null, v_sum, v_data,
    'Витрина радиотумана: «Оруэл» СРТ-25 глушит вражеские радары в бою — противник хуже захватывает и наводится на цели.');

  -- 5. Радар-разведчик — канал sensor/radar
  v_data := jsonb_build_object(
    'class','destroyer','reactor',3,'armor',1,'shield',1,'engine',2,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',1)),
    'modules', jsonb_build_array(jsonb_build_object('g','Модули радиотумана','idx',5)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный радар-разведчик', null, null, v_sum, v_data,
    'Витрина радаров: лучший радар класса (дальность 13, ECCM 4) плюс усилитель сенсора «Хайнлайн» — раскрывает дальние и замаскированные контакты для всей эскадры.');

  -- 6. Артиллерийский эсминец — канал kinetic/energy
  v_data := jsonb_build_object(
    'class','destroyer','reactor',3,'armor',1,'shield',2,'engine',3,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный артиллерийский эсминец', null, null, v_sum, v_data,
    'Витрина классической артиллерии: спаренные рельсотроны ПРВ-30 «Басл» — надёжный прямой урон в упор, без экзотики.');

  -- 7. Ремонтный крейсер — канал repair (нано-рой)
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',1,'armor',1,'shield',1,'engine',1,'radar',0,
    'weapons', jsonb_build_array(jsonb_build_object('turretId', v_turret_id::text,'q',1)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,owner_id,summary,data,card_text)
  values ('ship','Пан-колониальный ремонтный крейсер', null, null, v_sum, v_data,
    'Витрина нано-роя: ремонтная турель «Гефест» лечит корпус союзного корабля на дистанции вместо урона — по врагу не бьёт и сама себя не чинит. Носитель только средний крейсер.');
end $$;
