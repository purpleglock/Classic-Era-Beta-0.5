-- ════════════════════════════════════════════════════════════
-- ГЛАДИАТОРЫ БОЙЦОВСКОГО КЛУБА — арена со своим ростером
-- ────────────────────────────────────────────────────────────
-- §1  8 уникальных кораблей на синтетическом fid 'club'.
-- §2  _fc_qualifies → драфт дуэли берёт ТОЛЬКО клубные корабли.
-- §3  admin_bot_battle → клубные корабли НЕ утекают в бот-бои.
--
-- Зачем ростер: до этой правки _fc_make_pool выдавал КАЖДОЙ стороне
-- свой случайный пул из проектов всех фракций (36 шт., разброс цены
-- 13 133 … 1 719 197 ГС). Одному могли выпасть шесть дешёвок, другому —
-- элита; бюджет общий, а качество выбора нет. Теперь обе стороны
-- драфтят из одного выверенного ростера — решает состав, не везение.
--
-- Никто не может их СТРОИТЬ: fid 'club' не принадлежит ни одному игроку,
-- а economy_produce пускает только свои либо общедоступные (faction_id null).
-- В каталоге конструкторов их видит только стафф (cnCanSeeUnit).
--
-- Баланс: бюджет драфта = 5 × медиана ростера ≈ 204 000 ГС. За него берут
-- 1 тяжёлого ИЛИ 14 лёгких — это и есть выбор. Каналы урона выверены по
-- _cn_wpn_kind: у всех дальнобойных гладиаторов залп РАКЕТНЫЙ, поэтому
-- ПРО «Мурмиллона» against них работает и кайт не бесплатен.
-- Идемпотентно: чистка по ТОЧНОМУ списку имён (страж _unit_delete_guard).
-- ════════════════════════════════════════════════════════════

-- ── §1. Ростер арены ────────────────────────────────────────
do $$
declare
  v_fid   text := 'club';
  v_fname text := 'Бойцовский клуб';
  v_fcol  text := '#ff3c82';
  v_data jsonb;
  v_sum  jsonb;
begin
  delete from public.faction_units where faction_id = v_fid and name = any(array[
    'Гладиатор «Мурмиллон»', 'Гладиатор «Димахер»', 'Гладиатор «Секутор»',
    'Гладиатор «Ретиарий»', 'Гладиатор «Провокатор»', 'Гладиатор «Андабат»',
    'Гладиатор «Эквит»', 'Гладиатор «Велит»']);

  -- Мурмиллон: щитоносец арены — стена с активной защитой
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',3,'armor',3,'shield',4,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Конструкционные модули','idx',4)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Мурмиллон»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Стена арены: 7165 корпуса, 1000 щита и активная защита 0.35 против ракет. Съедает почти весь бюджет целиком — берёшь его, значит идёшь в бой почти без свиты. Бьёт на 3 гекса, скорость 4: всё, что от него убегает, он не достанет.');

  -- Димахер: два клинка — энергетический размен на средней дистанции
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',4,'armor',2,'shield',4,'engine',3,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Димахер»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Два лазера «Плага»: 3678 урона на 6 гексах — вдвое дальше любой пушки и вдвое больнее. Платит корпусом: 4716 против 7165 у «Мурмиллона», и никакой ПРО. Размен в его пользу, пока по нему не попали.');

  -- Секутор: догоняющий — быстрый, бьёт в упор
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Секутор»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Преследователь: скорость 10 и 2372 урона рельсотронами в упор. Ответ на кайт — догоняет стрелков и вскрывает их за ход. Дальность 3: пока бежит, по нему стреляют, и ответить нечем.');

  -- Ретиарий: сеть с дистанции — ракетный залп на 30 гексов
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',1,'shield',2,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',3)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Ретиарий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Сеть на 30 гексов: три пусковые «Нови-Сад» бьют через всю арену, свой радар на 13 наводит без чужой помощи. Залп ракетный — вражеская ПРО срезает его. Корпус 1822: догнали — умер.');

  -- Провокатор: РЭБ — ослепляет чужие радары
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Модули радиотумана','idx',0)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Провокатор»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Глушение 5 при скорости 10: лезет вперёд и слепит чужие радары, обрубая наведение дальнобойным. Сам почти не убивает — 808 урона на 3 гекса. Его берут не ради урона, а чтобы вражеский «Ретиарий» перестал попадать.');

  -- Андабат: слепой боец — бьёт из невидимости
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',1,'shield',1,'engine',4,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Конструкционные модули','idx',3)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Андабат»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Маскировка 3 и ракеты на 30 гексов: стреляет раньше, чем его опознают. Контрится «Эквитом» — сенсор 4 вскрывает маскировку. Щит 100 и корпус 1822: один залп в ответ — и его нет.');

  -- Эквит: конный дозор — вскрывает маскировку
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',2)),
    'modules', jsonb_build_array(jsonb_build_object('g','Модули радиотумана','idx',5)));
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Эквит»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Глаза отряда: сенсор 4, радар на 13 и ECCM 4 при скорости 10 и цене в 20 тысяч. Вскрывает «Андабата» и держит наведение под глушением. Урон 326 — он не убивает, он показывает.');

  -- Велит: застрельщик — дешёвое ракетное мясо
  v_data := jsonb_build_object(
    'class','corvette','reactor',0,'armor',1,'shield',1,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',2,'q',3)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Велит»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Самый дешёвый боец арены: 13 885 ГС, три «Феникса» на 15 гексов. За бюджет их влезает четырнадцать — рой, который заваливает числом. Залп ракетный, поэтому одна активная защита обесценивает половину стаи.');
end $$;

-- ── §2. Драфт клуба — только клубный ростер ─────────────────
-- Было: любой ship-проект любой фракции, обновлённый после _fc_fresh_since().
-- Стало: только арена. Функцию читают _fc_make_pool (состав пула) и
-- _fc_spawn_duel (медиана для бюджета) — обе автоматически переезжают.
create or replace function public._fc_qualifies(fu public.faction_units)
returns boolean language sql immutable as $$
  select fu.category = 'ship'
     and fu.faction_id = 'club'
     and coalesce((fu.summary->>'hp')::numeric,  0) > 0
     and coalesce((fu.summary->>'dmg')::numeric, 0) > 0
$$;
grant execute on function public._fc_qualifies(public.faction_units) to anon, authenticated, service_role;

-- ── §3. Гладиаторы не утекают в бот-бои ─────────────────────
-- admin_bot_battle раздаёт ботам ЛЮБОЙ опубликованный ship с hp>0 — без этой
-- правки клубный ростер перестал бы быть клубным. Тело живое, изменена одна
-- строка выборки bships (добавлен отсев fid 'club').
-- ⚠ Дефолты параметров обязаны совпадать с живой сигнатурой, иначе
-- create or replace падает: «cannot remove parameter defaults».
create or replace function public.admin_bot_battle(
  p_my_ship uuid default null, p_bot_ship uuid default null, p_n integer default 3)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; bot text := public._bt_bot_fid();
        sys text; bid uuid; old uuid;
        sb jsonb; bship uuid; i int; placed int := 0;
        bships uuid[]; nb_ships int;
        n int := least(80, greatest(1, coalesce(p_n,3)));
        w int := public._bt_wbig(); h int := public._bt_hbig(); yy int;
        percol int; coff int; ridx int;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;
  if me = bot then raise exception 'fid игрока совпал с fid бота — поменяйте _bt_bot_fid()'; end if;

  -- снести прошлый бот-бой целиком
  select battle_id into old from public.admin_bot_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  -- фаза расстановки: ты (att_ready=false) раскладываешь сам, боты уже готовы
  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             att_turns_left, def_turns_left, deadline_at)
    values (sys, me, bot, 'forming', 'meeting', false, true, 'attacker', 0, public._bt_acts(),
            6, 6, null)
    returning id into bid;
  perform public._bt_log(bid, '🤖 Тестовый бой с ботами. Ты — нападающий (слева): '
    || 'расставь свой флот из полного каталога и жми «В бой». Боты уже стоят справа.');

  -- РАЗНЫЕ корабли ботам: собираем перемешанный список всех опубликованных
  -- ship-проектов и раздаём по одному — пока хватает уникальных, дальше по кругу.
  -- Так у ботов смешанный состав (разные классы и снаряжение), а не клоны.
  if p_bot_ship is not null then
    bships := array[p_bot_ship];                      -- принудительно один проект на всех
  else
    select array_agg(id order by random()) into bships
      from public.faction_units
     where category='ship' and coalesce((summary->>'hp')::numeric,0) > 0
       -- ростер Бойцовского клуба — только для арены, в бот-бои не выдаём
       and coalesce(faction_id,'') <> 'club';
  end if;
  nb_ships := coalesce(array_length(bships, 1), 0);
  if nb_ships = 0 then raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов'; end if;

  -- боты у своего (правого) края. При большом числе бортов заполняем несколько
  -- колонок вглубь, чтобы не налезали.
  percol := greatest(1, h / 2);
  for i in 1..n loop
    coff := (i - 1) / percol;                       -- смещение колонки вглубь от края
    ridx := (i - 1) % percol;                        -- строка в колонке
    yy := least(h-1, greatest(0, ridx * 2 + (coff % 2)));

    bship := bships[((i - 1) % nb_ships) + 1];        -- разные проекты, потом по кругу
    sb := public._bt_stats(bship);
    if sb is null then continue; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil)
      values (bid, bot, 'defender', bship, sb->>'name', sb->>'cls', greatest(w/2+1, w-2-coff), yy,
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        3, public._bt_turnneed(sb->>'cls'),
        coalesce((sb->>'sensor')::int,0), coalesce((sb->>'stealth')::int,0),
        coalesce(sb->'wpn','[]'::jsonb), coalesce(sb->'resist','{}'::jsonb),
        coalesce((sb->>'pd')::numeric,0), coalesce((sb->>'jam')::int,0), coalesce((sb->>'wings')::int,0),
        coalesce((sb->>'dejam')::int,0), coalesce((sb->>'eccm')::int,0),
        coalesce((sb->>'interdict')::bool,false), coalesce((sb->>'stabil')::bool,false));
    placed := placed + 1;
  end loop;
  if placed = 0 then raise exception 'нет опубликованных кораблей (ship с hp>0) для ботов'; end if;

  insert into public.admin_bot_duel(one, battle_id) values (1, bid)
    on conflict (one) do update set battle_id = excluded.battle_id, created_at = now();

  return jsonb_build_object('ok', true, 'battle_id', bid, 'n', placed, 'phase', 'forming');
end$$;
grant execute on function public.admin_bot_battle(uuid,uuid,integer) to anon, authenticated, service_role;
