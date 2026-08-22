-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 25: НА ДОСКЕ ОНИ БЫЛИ КАЛЕКАМИ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_host.sql. Надмножество `_angel_bt_stats`,
-- `_angel_guard_const`, `_angel_host_const`. ⚠️ Ход по доске править ОТСЮДА.
--
-- ЗАМЕР ПО ЖИВОМУ КАТАЛОГУ (138 проектов кораблей):
--   средний ход 17.9, потолок 40 (движок режет `least(40, …)`);
--   корветы и гиперкрейсеры ходят на 40, эсминцы 28, крейсеры 30,
--   линкоры 22, дредноуты 20; дальность — до 30.
-- А у меня было выставлено: Херувим — ход 6, дальность 24; Офаним — ход 8,
-- дальность 18; сам ковчег — ход 12.
--
-- То есть я собрал стену, которую любой корвет обходит по кругу на тройной
-- скорости и расстреливает с дистанции, куда она не достаёт. «Стража» из
-- такого — это не стена, это мишени: подобия ползут, игрок кайтит, бой
-- превращается в тир. Ровно то, на что и жалоба.
--
-- КАК СТАЛО. Считаем по каталогу, а не на глаз:
--   • КОВЧЕГ — ход 20, дальность 30. Он не догоняет корвет и не должен: у него
--     дальность верхнего предела и залп, который одним попаданием снимает любой
--     нынешний корпус. Убегать от него можно — жить в его дальности нельзя.
--   • ХЕРУВИМ — ход 22, дальность 30. Наравне с линкором по манёвру и на
--     потолке по дальности: обойти можно, безнаказанно кружить — нет.
--   • ОФАНИМ — ход 28, дальность 26. Это перехватчик: «колёса, идущие
--     навстречу». Быстрее любого линкора и дредноута, ловит тех, кто пытается
--     разорвать дистанцию, — но уступает корвету, и это правильно: у корвета
--     скорость единственное, что есть.
--
-- ⚠️ ПОТОЛОК ДВИЖКА 40 НЕ ТРОГАЕМ. Соблазн выдать подобиям 40 и закрыть тему
-- был; это сделало бы их неуязвимыми для манёвра вообще, а доска держится на
-- том, что от быстрого можно уйти, заплатив позицией.
-- ════════════════════════════════════════════════════════════

create or replace function public._angel_guard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'n'          then 3
    when 'hp'         then 2500000
    when 'armor'      then 25000
    when 'dmg'        then 60000
    when 'rng'        then 30        -- было 24: потолок каталога
    when 'speed'      then 22        -- было 6 (!): наравне с линкором
    when 'resist'     then 0.55
    when 'wounds'      then 4
    when 'wound_doom'  then 2
    when 'wound_ball'  then 1
    when 'flak_floor'  then 30
    when 'open_resist' then 0.5
    when 'open_armor'  then 20000
    when 'seal_hp'     then 130000
    when 'press_hit'   then 0.05
    else 0 end
$$;

create or replace function public._angel_host_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'fleets'  then 2
    when 'per'     then 3
    when 'hp'      then 600000
    when 'armor'   then 8000
    when 'dmg'     then 22000
    when 'rng'     then 26        -- было 18
    when 'speed'   then 28        -- было 8 (!): перехватчик, быстрее линкора
    when 'resist'  then 0.40
    when 'wounds'  then 2
    when 'flak'    then 14
    when 'pacer_cap' then 4
    when 'pacer_mul' then 0.25
    when 'hunter_keep' then 2
    else 0 end
$$;

-- ── ПАСПОРТ КОВЧЕГА ─────────────────────────────────────────
-- Надмножество _angel_battle.sql. Тронут ОДИН показатель — ход.
create or replace function public._angel_bt_stats()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'name', 'Престол', 'cls', 'angel',
    'hp', 900000, 'armor', 4000, 'shield', 0,
    'dmg', 90000, 'speed', 20, 'rng', 30,
    'sensor', 30, 'stealth', 0, 'pd', 0.6,
    'jam', 8, 'dejam', 12, 'eccm', 12,
    'interdict', true, 'stabil', true, 'ftl', true, 'wings', 0,
    'resist', jsonb_build_object('kinetic', 0.9, 'energy', 0.9, 'missile', 0.9),
    'wpn', jsonb_build_array(
      jsonb_build_object('rng', 30, 'dmg', 42000, 'k', 'energy',  'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1),
      jsonb_build_object('rng', 26, 'dmg', 36000, 'k', 'kinetic', 'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1),
      jsonb_build_object('rng', 30, 'dmg', 30000, 'k', 'missile', 'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1)))
$$;

-- ── ПОЧИНИТЬ УЖЕ СТОЯЩИХ НА ДОСКАХ ──────────────────────────
-- Борта, выставленные до этой правки, ползают по старым числам. Живых досок с
-- ангелом сейчас нет, но накат должен быть повторяемым в любой момент.
update public.battle_units u
   set speed = public._angel_guard_const('speed')::int,
       rng   = public._angel_guard_const('rng')::int
  from public.angel_guard g
 where g.unit_id = u.unit_id and g.role = 'wall'
   and u.speed is distinct from public._angel_guard_const('speed')::int;

update public.battle_units u
   set speed = public._angel_host_const('speed')::int,
       rng   = public._angel_host_const('rng')::int
  from public.angel_guard g
 where g.unit_id = u.unit_id and g.role = 'escort'
   and u.speed is distinct from public._angel_host_const('speed')::int;

update public.battle_units u
   set speed = 20
 where u.cls = 'angel' and u.speed is distinct from 20;

-- Паспорта в каталоге (их читает резерв и драфт) — тем же накатом.
select public.angel_guard_muster();
select public.angel_host_muster();

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `select _angel_bt_stats()->'speed'` → 20.
-- 2) Расстановка стражи: ход 22, дальность 30; эскорта — 28 и 26.
-- 3) На доске корвет (ход 40) всё ещё может разорвать дистанцию — но платит
--    за это позицией, а не получает бесплатный тир.
