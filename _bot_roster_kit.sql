-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🏴‍☠️ РОСТЕР БОТОВ: снаряжение, чистка и расширение
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_roster_faction.sql и _bot_ai_brain.sql. Идемпотентно.
--
-- 1) ДИСБАЛАНС. В ростере Железного Дивизиона лежали два «испытательных»
--    проекта: «Орденоносец» (броня 65 000, поле 50 000, урон 20 600) и
--    «Рейдер-02» (броня 18 000 при скорости 30). Остальная вольница ходит с
--    бронёй 0 и полем 100–1000 — то есть эти двое были не кораблями, а
--    стеной, об которую разбивался любой бой. Из набора ботов убраны.
--    НЕ УДАЛЕНЫ: проекты живые, на них могут ссылаться идущие бои и уже
--    построенные борта. Заведён явный список исключений — из него проект
--    так же явно и возвращается, если понадобится.
--
-- 2) СНАРЯЖЕНИЕ. У пиратских проектов data->'modules' был пуст, поэтому
--    триггер _bt_units_acts_fill наливал ботам acts = [] — активных модулей
--    у них не было ФИЗИЧЕСКИ, сколько бы ИИ ни умел. Теперь у каждого борта
--    есть набор под его роль: у бронехода — «Эгида» и таран, у носителя —
--    дроны и ракетный блок, у глушилки — скремблер и подавитель.
--
-- 3) АССОРТИМЕНТ. Шесть проектов на весь флот — это шесть одинаковых боёв.
--    Добавлено шесть вариантов на базе тех же корпусов, но с другой ролью:
--    брандер, ремонтный тендер, монитор с ядерной ракетой, шершень-контроль,
--    ловчий с тяговым лучом и разрядник ближнего боя. Корпуса взяты
--    клонированием — чертёж, вооружение и класс остаются штатными, меняются
--    подпись, снаряжение и умеренная правка ТТХ.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. СПИСОК ИСКЛЮЧЕНИЙ ────────────────────────────────────────────
create table if not exists public.bt_bot_exclude(
  unit_id uuid primary key references public.faction_units(id) on delete cascade,
  why     text,
  added_at timestamptz not null default now()
);
alter table public.bt_bot_exclude enable row level security;
revoke all on table public.bt_bot_exclude from anon, authenticated;

comment on table public.bt_bot_exclude is 'проекты, которые НЕ выдаются ботам: перекачанные, сюжетные, служебные';

insert into public.bt_bot_exclude(unit_id, why)
  select id, 'испытательный проект: ТТХ вне полосы ростера'
    from public.faction_units
   where category = 'ship' and name in ('Орденоносец', 'Рейдер-02')
on conflict (unit_id) do nothing;

-- ── 2. НАБОР БОТОВ ЧИТАЕТ ИСКЛЮЧЕНИЯ ────────────────────────────────
-- Патчим ЖИВОЙ admin_bot_battle: три запроса ростера отбираются по одному и
-- тому же условию, и правка нужна ровно в нём.
do $ban$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_bot_battle'
   order by p.oid desc limit 1;
  if src is null then raise exception 'admin_bot_battle не найдена'; end if;
  if position('bt_bot_exclude' in src) > 0 then
    raise notice 'исключения уже вшиты в набор ботов — пропускаю';
    return;
  end if;
  if position('where category=''ship'' and coalesce((summary->>''hp'')::numeric,0) > 0' in src) = 0 then
    raise exception 'якорь отбора ростера не найден — исключения НЕ вшиты';
  end if;
  src := replace(src,
    'where category=''ship'' and coalesce((summary->>''hp'')::numeric,0) > 0',
    'where category=''ship'' and coalesce((summary->>''hp'')::numeric,0) > 0
       and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = faction_units.id)');
  execute src;
end$ban$;
grant execute on function public.admin_bot_battle(uuid,uuid,int,text) to authenticated;

-- ── 3. СНАРЯЖЕНИЕ ДЕЙСТВУЮЩИХ ПРОЕКТОВ ──────────────────────────────
-- Ключи — индексы каталога _cn_catalog()->'ship'->'modules'. Ставим ПОЛНЫЙ
-- набор, а не дописываем: так повторный накат не плодит дубли слотов.
create or replace function public._bt_mod_kit(variadic p_keys text[])
returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_agg(
           case when k like 'rt:%'
                then jsonb_build_object('g','Модули радиотумана','idx', substr(k,4)::int)
                else jsonb_build_object('g','Конструкционные модули','idx', k::int) end),
         '[]'::jsonb)
    from unnest(p_keys) k;
$fn$;

do $kit$
declare r record; kit jsonb;
begin
  -- ⚠ 12.08 ростер вольницы переписан и переименован (_npc_roster_rework.sql):
  --   «Сороки» и «Костолома» больше нет, а §4 ниже клонирует доноров по именам
  --   и на новой базе завела бы вторых «Свечку» и «Штопор». Перекат этого файла
  --   после наката рева — пустая операция.
  if exists(select 1 from public.faction_units
             where faction_id = 'fac_5bfbfad5f8' and name like '%Жирнобровый%') then
    raise notice 'ростер вольницы уже переписан (_npc_roster_rework.sql) — §3 и §4 пропущены';
    return;
  end if;
  for r in select id, name from public.faction_units
            where category = 'ship' and faction_id = 'fac_5bfbfad5f8' loop
    kit := case
      -- глушилка: слепит и глушит шину, сама прячется
      when r.name like '%Сорока%'      then public._bt_mod_kit('rt:11','19','rt:10')
      -- бронеход: «Эгида» на своих, импульс брони, таран в упор
      when r.name like '%Костолом%'    then public._bt_mod_kit('25','32','15')
      -- носитель: дроны своим, ракетный блок вдаль, зонтик ПРО
      when r.name like '%Стервятник%'  then public._bt_mod_kit('12','8','23')
      -- катер: «Шквал», прыжок, беглый огонь
      when r.name like '%Гарпия%'      then public._bt_mod_kit('14','10','27')
      -- корвет: разрывной таран, прыжок, разгон контура
      when r.name like '%Шакал%'       then public._bt_mod_kit('16','10','11')
      -- рейдер-снайпер: ракетный блок, «Ломовик», маскировка
      when r.name like '%Ржавый нож%'  then public._bt_mod_kit('8','18','rt:10')
      else null end;
    if kit is not null then
      update public.faction_units
         set data = jsonb_set(coalesce(data,'{}'::jsonb), '{modules}', kit, true),
             updated_at = now()
       where id = r.id;
    end if;
  end loop;
end$kit$;

-- ── 4. НОВЫЕ ВАРИАНТЫ ───────────────────────────────────────────────
-- Клон берёт корпус, чертёж и вооружение донора; меняются имя, снаряжение и
-- умеренная правка ТТХ (корпус/поле/скорость/урон). Класс не трогаем: он
-- держит цену залпа, скрытность и профиль орудий.
create or replace function public._bt_bot_variant(
  p_src_like text, p_name text, p_kit jsonb,
  p_hp numeric, p_dmg numeric, p_shield numeric, p_speed numeric)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare s record; nid uuid;
begin
  if exists(select 1 from public.faction_units where name = p_name) then
    -- проект уже заведён: обновляем только снаряжение, ТТХ не двигаем
    update public.faction_units
       set data = jsonb_set(coalesce(data,'{}'::jsonb), '{modules}', p_kit, true),
           updated_at = now()
     where name = p_name
     returning id into nid;
    return nid;
  end if;

  select * into s from public.faction_units
   where category = 'ship' and faction_id = 'fac_5bfbfad5f8' and name like p_src_like
   limit 1;
  if s.id is null then
    raise notice 'донор «%» не найден — вариант «%» не заведён', p_src_like, p_name;
    return null;
  end if;

  nid := gen_random_uuid();
  insert into public.faction_units(id, category, name, faction_id, faction_name,
                                   faction_color, owner_id, owner_email, summary, data,
                                   card_text, created_at, updated_at)
  values (nid, s.category, p_name, s.faction_id, s.faction_name, s.faction_color,
          s.owner_id, s.owner_email,
          jsonb_set(jsonb_set(jsonb_set(jsonb_set(s.summary,
            '{hp}',     to_jsonb(round(coalesce((s.summary->>'hp')::numeric,100)     * p_hp))),
            '{dmg}',    to_jsonb(round(coalesce((s.summary->>'dmg')::numeric,10)     * p_dmg))),
            '{shield}', to_jsonb(round(coalesce((s.summary->>'shield')::numeric,0)   * p_shield))),
            '{speed}',  to_jsonb(greatest(1, round(coalesce((s.summary->>'speed')::numeric,4) * p_speed)))),
          jsonb_set(coalesce(s.data,'{}'::jsonb), '{modules}', p_kit, true),
          s.card_text, now(), now());
  return nid;
end$fn$;
revoke all on function public._bt_bot_variant(text,text,jsonb,numeric,numeric,numeric,numeric) from public;

do $var$
begin
  if exists(select 1 from public.faction_units
             where faction_id = 'fac_5bfbfad5f8' and name like '%Жирнобровый%') then
    raise notice 'варианты вольницы заменены ростером _npc_roster_rework.sql — §4 пропущен';
    return;
  end if;
  -- Брандер: дешёвый, быстрый, идёт на размен тараном.
  perform public._bt_bot_variant('%Шакал%', 'Пиратский брандер «Свечка»',
    public._bt_mod_kit('15','10','28'), 0.80, 0.70, 0.50, 1.30);

  -- Ремонтный тендер: сам почти не бьёт, зато держит строй на плаву.
  perform public._bt_bot_variant('%Стервятник%', 'Пиратский тендер «Штопор»',
    public._bt_mod_kit('12','20','26'), 1.15, 0.45, 1.20, 1.00);

  -- Монитор: тяжёлая артиллерия вольницы, носитель ядерной ракеты.
  perform public._bt_bot_variant('%Костолом%', 'Пиратский монитор «Ржавая длань»',
    public._bt_mod_kit('30','7','21'), 1.10, 0.85, 1.00, 0.75);

  -- Шершень: контроль — стазис и стазис-боеприпас, урон второстепенен.
  perform public._bt_bot_variant('%Гарпия%', 'Пиратский шершень «Оса»',
    public._bt_mod_kit('14','24','33'), 1.00, 0.90, 1.50, 1.10);

  -- Ловчий: выдёргивает дальнобойных из их полосы и сажает на голодный паёк.
  perform public._bt_bot_variant('%Ржавый нож%', 'Пиратский ловчий «Крюк»',
    public._bt_mod_kit('29','18','17'), 1.20, 0.80, 1.50, 0.90);

  -- Разрядник: лезет вплотную и работает по площади адскими лазерами.
  perform public._bt_bot_variant('%Сорока%', 'Пиратский разрядник «Гроза»',
    public._bt_mod_kit('22','23','rt:11'), 1.10, 1.10, 0.80, 0.90);
end$var$;

-- ── 5. ДОЛИТЬ СНАРЯЖЕНИЕ В УЖЕ ИДУЩИЕ БОИ ───────────────────────────
-- Борта, выставленные до этого наката, стоят с пустым acts. Триггер их уже
-- не тронет — доливаем вручную, по тому же _bt_acts_of.
update public.battle_units bu
   set acts = public._bt_acts_of(bu.unit_id)
 where bu.alive
   and jsonb_array_length(coalesce(bu.acts,'[]'::jsonb)) = 0
   and exists(select 1 from public.battles b
               where b.id = bu.battle_id and b.status in ('forming','active'));

notify pgrst, 'reload schema';

-- Проверка:
--   select name, jsonb_array_length(data->'modules') n
--     from faction_units where faction_id='fac_5bfbfad5f8' and category='ship' order by name;
--   select public.admin_bot_battle(null, null, 8, 'fac_5bfbfad5f8');
