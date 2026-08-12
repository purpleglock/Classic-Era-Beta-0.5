-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🏴‍☠️🏛 РОСТЕРЫ NPC: пираты, арена и общедоступные — под модули и перки
-- ═══════════════════════════════════════════════════════════════════
-- ЦЕПОЧКА: после _bot_roster_kit.sql, _club_gladiators3.sql, _bt_perks2.sql.
-- Идемпотентно: катится повторно без дублей.
--
-- ЧТО БЫЛО НЕ ТАК.
--  1) ПЕРКИ ФИЗИЧЕСКИ НЕ РАБОТАЛИ У NPC. `_bt_perks_of` требует, чтобы
--     держава ИЗУЧИЛА одноимённый узел древа (faction_economy.research).
--     У клуба ('club'), у ботов ('bot') и у пиратской вольницы никакой
--     экономики и исследований нет — значит любая карточка, положенная в
--     data.perks, на доске молча стиралась. §1 открывает карточки NPC-державам
--     напрямую: право у них не от науки, а от того, что они NPC.
--  2) ПИРАТЫ. Ростер собирался до модулей: имена служебные («Рейдер-02»),
--     снаряжение дописывалось поверх кусками. §2 переписывает все 12 бортов
--     целиком (класс, вооружение, набор кнопок, описание) и добавляет два
--     новых — крепость и матку. Четверо получают карточки экипажа.
--  3) АРЕНА. Гладиаторы назывались «Гладиатор «X»» — §3 переводит ростер на
--     имперскую номенклатуру (преторий, дестроер, сателлоид…), латинское имя
--     бойца остаётся в кавычках. Четверым выдаются карточки.
--     ⚠ Переименование идёт UPDATE'ом: id бортов сохраняются, живая дуэль
--       в forming не рассыпается.
--  4) ОБЩЕДОСТУПНЫЕ. У «Пан-колониальных» проектов modules был ПУСТ — восемь
--     кораблей, доступных всем, не нажимали на доске ни одной кнопки. §4
--     выдаёт каждому набор под его роль. Карточки им НЕ ставим: их строят
--     живые державы, и перк там открывается наукой, как у всех.
--
-- ⚠ Модули адресуются парой {g,idx}; индексы сверены с живым _cn_catalog()
--   12.08 (К: 3 транспондер, 4 КАЗ, 7 осада, 8 «Буревестник», 10 «Мгла»,
--   11 «Ярость», 12 дроны, 13 «Голиаф», 14 «Шквал», 15 плазм. таран,
--   16 разрывной, 17 иссушитель, 18 «Ломовик», 19 подавитель, 20 усилитель,
--   21 «Хорал», 22 адские лазеры, 23 ПР-лазеры, 24 стазис, 25 «Эгида»,
--   26 перезапуск, 27 беглый огонь, 28 энергогенератор, 29 тяга, 30 ядерная,
--   31 «Тартар», 32 импульс брони, 33 стазис-боеприпас; Р: 0 глушение,
--   5 сенсор, 10 «Вуаль», 11 скремблер).
-- ═══════════════════════════════════════════════════════════════════

-- ═══ §1. КАРТОЧКИ ЭКИПАЖА ДЛЯ NPC ══════════════════════════════════
-- NPC-держава: у неё нет ни экономики, ни анкеты, ни древа. Список явный —
-- случайная фракция без экономики карточки задаром не получит.
create or replace function public._perk_npc(p_fid text)
returns boolean language sql stable as $$
  select coalesce(p_fid, '') in ('club', 'bot')
      or coalesce(p_fid, '') = coalesce(public._bt_bot_roster_default(), '~');
$$;
grant execute on function public._perk_npc(text) to anon, authenticated, service_role;

comment on function public._perk_npc(text) is
  'держава-NPC (арена, боты, пиратская вольница): перки без исследований и гейта происхождения';

-- Гейт науки/происхождения обходится ТОЛЬКО для NPC. Для живых держав всё
-- по-прежнему: узел древа изучен + происхождение подходит.
create or replace function public._bt_perks_of(p_unit uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; res jsonb; cls text; fid text; npc boolean;
begin
  if p_unit is null then return '[]'::jsonb; end if;
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return '[]'::jsonb; end if;
  cls := nullif(u.data->>'class','');
  fid := coalesce(p_fid, u.faction_id);
  -- борт на доске стоит под fid 'bot', а проект принадлежит вольнице:
  -- NPC-ем считается любая из двух сторон этой пары
  npc := public._perk_npc(fid) or public._perk_npc(u.faction_id);

  select coalesce(jsonb_agg(k), '[]'::jsonb) into res
  from (
    select distinct on (e.value) e.value as k
      from jsonb_array_elements_text(coalesce(u.data->'perks','[]'::jsonb)) e
     where public._perk_cat() ? e.value
       and public._perk_cls_ok(e.value, cls)
       and (npc or (public._perk_gate_ok(e.value, fid)
                    and exists (select 1 from public.faction_economy fe
                                 where fe.faction_id = fid
                                   and coalesce(fe.research,'[]'::jsonb) ? e.value)))
     order by e.value
     limit public._perk_slots()
  ) q;
  return res;
end$$;
revoke all on function public._bt_perks_of(uuid, text) from public;
grant execute on function public._bt_perks_of(uuid, text) to authenticated;

-- ═══ §2. ПИРАТСКАЯ ВОЛЬНИЦА ════════════════════════════════════════
-- Правка ВСЕГДА UPDATE'ом по старому имени: id проекта сохраняется, идущие
-- бои и уже построенные борта не осиротеют. Нет ни старого, ни нового имени —
-- проект заводится с нуля.
create or replace function public._pir_put(p_old text, p_name text,
                                           p_data jsonb, p_card text)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare v_fid text := 'fac_5bfbfad5f8'; nid uuid; s record; v_sum jsonb;
begin
  v_sum := public._cn_recompute('ship', p_data);
  select id into nid from public.faction_units
   where faction_id = v_fid and category = 'ship'
     and (name = p_name or name like p_old) limit 1;
  if nid is not null then
    update public.faction_units
       set name = p_name, data = p_data, summary = v_sum,
           card_text = p_card, updated_at = now()
     where id = nid;
    return nid;
  end if;
  -- новый борт: реквизиты державы берём с любого её живого проекта
  select faction_name, faction_color, owner_id, owner_email into s
    from public.faction_units where faction_id = v_fid limit 1;
  insert into public.faction_units(category, name, faction_id, faction_name,
                                   faction_color, owner_id, owner_email,
                                   summary, data, card_text)
  values ('ship', p_name, v_fid, coalesce(s.faction_name,'Железный Дивизион'),
          coalesce(s.faction_color,'#8a8f98'), s.owner_id, s.owner_email,
          v_sum, p_data, p_card)
  returning id into nid;
  return nid;
end$fn$;
revoke all on function public._pir_put(text,text,jsonb,text) from public;

do $pir$
declare
  v_K text := 'Конструкционные модули';
  v_R text := 'Модули радиотумана';
begin
  -- ── Жирнобровый: рейдер-задира. «Ярость» + беглый огонь, «Мгла» в догон ──
  perform public._pir_put('%Ржавый нож%', 'Пиратский рейдер «Жирнобровый»',
    jsonb_build_object(
      'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',11), jsonb_build_object('g',v_K,'idx',10),
        jsonb_build_object('g',v_K,'idx',27)),
      'perks', jsonb_build_array('perk.beamrider')),
    'Первый борт вольницы и её вывеска. «Мгла» подтаскивает его вплотную, «Ярость» и беглый огонь превращают один ход в два залпа. Держать удар он не умеет — либо размен в свою пользу с первого круга, либо труп.');

  -- ── Роковой Феникс: носитель. Дроны своим, «Буревестник» вдаль ──
  perform public._pir_put('%Стервятник%', 'Пиратский носитель «Роковой Феникс»',
    jsonb_build_object(
      'class','supportCarrier','reactor',0,'armor',2,'shield',3,'engine',2,'radar',2,
      'weapons', jsonb_build_array(
        jsonb_build_object('g','АВИАГРУППЫ И ДРОНЫ','idx',0,'q',2),
        jsonb_build_object('g','АНГАРЫ И АВИАГРУППЫ','idx',1,'q',1)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',12), jsonb_build_object('g',v_K,'idx',8),
        jsonb_build_object('g',v_K,'idx',23)),
      'perks', '[]'::jsonb),
    'Плавучая ремонтная мастерская с крыльями. Сам держится позади: авиагруппа работает за него, ремонтные дроны латают подбитых, противоракетные лазеры держат зонт над строем. Дошли до него — считайте, бой уже выигран.');

  -- ── Идофронт: ловчий. Тяга, «Ломовик», иссушитель ──
  perform public._pir_put('%Крюк%', 'Пиратский ловчий «Идофронт»',
    jsonb_build_object(
      'class','destroyer','reactor',4,'armor',1,'shield',2,'engine',3,'radar',3,
      'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',29), jsonb_build_object('g',v_K,'idx',18),
        jsonb_build_object('g',v_K,'idx',17)),
      'perks', '[]'::jsonb),
    'Охотник на дальнобойных. Тяговый луч выдёргивает стрелка из его полосы, «Ломовик» вполовину срезает ему залп, торпеда-иссушитель сажает энергосеть. Урона почти нет: он не убивает, он сдаёт цель остальным.');

  -- ── Ларпитель: тендер. Дроны, усилитель, перезапуск ──
  perform public._pir_put('%Штопор%', 'Пиратский тендер «Ларпитель»',
    jsonb_build_object(
      'class','supportCarrier','reactor',0,'armor',2,'shield',3,'engine',2,'radar',1,
      'weapons', jsonb_build_array(
        jsonb_build_object('g','АВИАГРУППЫ И ДРОНЫ','idx',0,'q',1),
        jsonb_build_object('g','АНГАРЫ И АВИАГРУППЫ','idx',1,'q',1)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',12), jsonb_build_object('g',v_K,'idx',20),
        jsonb_build_object('g',v_K,'idx',26)),
      'perks', '[]'::jsonb),
    'Мастерская вольницы. Ремонтные дроны возвращают в строй подбитого, ракета-усилитель разгоняет контур союзника на 75%, «перезапуск снаряжения» снимает по два хода со всех кулдаунов рядом. Стрелять ему по большому счёту нечем.');

  -- ── Бутчер: бронеход. Эгида, импульс брони, плазменный таран ──
  perform public._pir_put('%Костолом%', 'Пиратский бронеход «Бутчер»',
    jsonb_build_object(
      'class','mediumCruiser','reactor',3,'armor',3,'shield',3,'engine',2,'radar',1,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',25), jsonb_build_object('g',v_K,'idx',32),
        jsonb_build_object('g',v_K,'idx',15)),
      'perks', jsonb_build_array('perk.altaan')),
    'Таран с приваренной бронёй. «Эгида» уводит на него чужой залп, импульс брони режет входящий всем своим в трёх гексах, плазменный таран проходит сквозь щит в корпус. «Альтаанская стойкость» на экипаже: чем крепче бьют, тем дольше он стоит.');

  -- ── Король Кримзон: монитор. Осада, ядерная ракета, «Хорал» ──
  perform public._pir_put('%Ржавая длань%', 'Пиратский монитор «Король Кримзон»',
    jsonb_build_object(
      'class','mediumCruiser','reactor',4,'armor',3,'shield',2,'engine',1,'radar',3,
      'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',5,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',7), jsonb_build_object('g',v_K,'idx',30),
        jsonb_build_object('g',v_K,'idx',21)),
      'perks', jsonb_build_array('perk.bloodlust')),
    'Осадная батарея вольницы и её самый дорогой аргумент. Разложенный «Кряж» удваивает урон и отодвигает рубеж, ядерная ракета летит через полдоски. Скорость единица: если он развернулся не туда, весь бой пройдёт мимо него.');

  -- ── Адмирабилис: флагман. Хорал, импульс брони, дроны ──
  perform public._pir_put('%Гроза%', 'Пиратский флагман «Адмирабилис»',
    jsonb_build_object(
      'class','mediumCruiser','reactor',4,'armor',3,'shield',3,'engine',2,'radar',2,
      'weapons', jsonb_build_array(jsonb_build_object('g','ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',21), jsonb_build_object('g',v_K,'idx',32),
        jsonb_build_object('g',v_K,'idx',12)),
      'perks', jsonb_build_array('perk.despair')),
    'Штабной борт: сам дерётся вполсилы, зато вокруг него вольница воюет как флот. «Хорал» даёт +50% урона всем своим в трёх гексах, импульс брони — столько же в защиту, дроны латают. «Отчаяние» держит его в бою тогда, когда бежать уже поздно.');

  -- ── Изерлон: крепость. Осада, КАЗ, Эгида ──
  perform public._pir_put('~нет такого~', 'Пиратская крепость «Изерлон»',
    jsonb_build_object(
      'class','mediumCruiser','reactor',3,'armor',3,'shield',4,'engine',1,'radar',3,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',7), jsonb_build_object('g',v_K,'idx',4),
        jsonb_build_object('g',v_K,'idx',25)),
      'perks', '[]'::jsonb),
    'Не корабль, а узел обороны на ходу — если это можно назвать ходом. Осадная платформа, активная защита от ракет и «Эгида», забирающая чужой залп на себя. Всё, что от него требуется, — стоять на входе в коридор и не пускать.');

  -- ── Лилит: брандер. Разрывной таран, «Мгла», энергогенератор ──
  perform public._pir_put('%Свечка%', 'Пиратский брандер «Лилит»',
    jsonb_build_object(
      'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',1,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',3)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',16), jsonb_build_object('g',v_K,'idx',10),
        jsonb_build_object('g',v_K,'idx',28)),
      'perks', '[]'::jsonb),
    'Размен в чистом виде. Прыгает «Мглой» вплотную и сдирает разрывным тараном треть стойкости брони — следующий залп своих проходит глубже. Живёт ровно до чужого хода, и это заложено в цену.');

  -- ── Лас Ночес: матка. Дроны, «Шквал», ПР-лазеры ──
  perform public._pir_put('~нет такого~', 'Пиратская матка «Лас Ночес»',
    jsonb_build_object(
      -- ⚠ броня 3 у носителя — РПП-покрытие: скрытность вместо корпуса (hp 266).
      --   Матке нужен корпус, поэтому 2 — «Вероника».
      'class','supportCarrier','reactor',0,'armor',2,'shield',3,'engine',1,'radar',2,
      'weapons', jsonb_build_array(
        jsonb_build_object('g','АВИАГРУППЫ И ДРОНЫ','idx',1,'q',1),
        jsonb_build_object('g','АВИАГРУППЫ И ДРОНЫ','idx',0,'q',1),
        jsonb_build_object('g','АНГАРЫ И АВИАГРУППЫ','idx',1,'q',1)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',12), jsonb_build_object('g',v_K,'idx',14),
        jsonb_build_object('g',v_K,'idx',23)),
      'perks', '[]'::jsonb),
    'Логово, которое умеет летать: полный ангар, ремонтная палуба и противоракетный зонт на всю стаю. Скорость — единица. Вольница строит бой вокруг него, потому что без него ей негде чиниться.');

  -- ── Сквилер: глушилка. Скремблер, подавитель, «Вуаль» ──
  perform public._pir_put('%Сорока%', 'Пиратская глушилка «Сквилер»',
    jsonb_build_object(
      'class','destroyer','reactor',4,'armor',1,'shield',2,'engine',3,'radar',2,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_R,'idx',11), jsonb_build_object('g',v_K,'idx',19),
        jsonb_build_object('g',v_R,'idx',10)),
      'perks', '[]'::jsonb),
    'Доносчик вольницы. Скремблер сажает сенсоры всем врагам в трёх гексах, ракета-подавитель на ход отбирает у выбранного борта ВСЕ его кнопки, «Вуаль» прячет его самого. Против эскадры на активных модулях он дороже любой пушки.');

  -- ── Джаставей: катер. «Шквал», «Мгла», беглый огонь ──
  perform public._pir_put('%Гарпия%', 'Пиратский катер «Джаставей»',
    jsonb_build_object(
      'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',1,
      'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',2,'q',4)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',14), jsonb_build_object('g',v_K,'idx',10),
        jsonb_build_object('g',v_K,'idx',27)),
      'perks', '[]'::jsonb),
    'Дешёвая свора. Четыре пусковые, прыжок в упор и беглый огонь: по одному он не значит ничего, вчетвером снимает крейсер за круг. Любая активная защита обесценивает половину его залпа.');

  -- ── Кирхайс: корсар. Стазис-боеприпас, ПР-лазеры, «Ярость» ──
  perform public._pir_put('%Шакал%', 'Пиратский корсар «Кирхайс»',
    jsonb_build_object(
      'class','corvette','reactor',2,'armor',2,'shield',2,'engine',3,'radar',2,
      'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',33), jsonb_build_object('g',v_K,'idx',23),
        jsonb_build_object('g',v_K,'idx',11)),
      'perks', jsonb_build_array('perk.patience')),
    'Единственный в вольнице, кто дерётся по правилам. Стазис-боеприпас сажает цель в вязкое поле КАЖДЫМ залпом, «Ярость» добавляет урона, противоракетные лазеры прикрывают соседей. «Терпение» на экипаже: чем дольше он ждёт, тем злее бьёт.');

  -- ── Ишвар: шершень. Стазис-лучи, тяга, «Тартар» ──
  perform public._pir_put('%Оса%', 'Пиратский шершень «Ишвар»',
    jsonb_build_object(
      'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',2,
      'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
      'modules', jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',24), jsonb_build_object('g',v_K,'idx',29),
        jsonb_build_object('g',v_K,'idx',31)),
      'perks', '[]'::jsonb),
    'Мелкий и злой. Стазис-лучи делают ход вдвое дороже каждому врагу в двух гексах, «Тартар» вычёркивает ход выбранному борту целиком, тяговый луч довешивает. Урон символический — он ворует у врага время.');
end$pir$;

-- ═══ §3. АРЕНА: имперская номенклатура ═════════════════════════════
-- Только имя и карточка экипажа: сам ростер (роли, модули, ценник) собран
-- уже под модули и переделки не требует. id бортов сохраняются.
do $glad$
declare r record;
  m jsonb := '{
    "Мурмиллон":   "Имперский преторий",
    "Димахер":     "Имперский легат",
    "Секутор":     "Имперский дестроер",
    "Ретиарий":    "Имперский ланцет",
    "Провокатор":  "Имперский ликтор",
    "Андабат":     "Имперский умбратор",
    "Эквит":       "Имперский сателлоид",
    "Велит":       "Имперский скиммер",
    "Ланиста":     "Имперский магистрат",
    "Гопломах":    "Имперский торпедоносец",
    "Крупеллярий": "Имперский монитор",
    "Эсседарий":   "Имперский интерцептор",
    "Сагиттарий":  "Имперский вигил",
    "Скиссор":     "Имперский абордажник",
    "Ноксий":      "Имперский брандер",
    "Рудиарий":    "Имперский триарий"
  }'::jsonb;
  k text; nn text;
begin
  for k in select jsonb_object_keys(m) loop
    nn := (m->>k) || ' «' || k || '»';
    update public.faction_units
       set name = nn, updated_at = now()
     where faction_id = 'club' and category = 'ship'
       and name = 'Гладиатор «' || k || '»';
  end loop;

  -- Карточки экипажа — четверым, не всем: перк сильный, слот один.
  for r in select * from (values
      ('Имперский преторий «Мурмиллон»',   'perk.altaan'),     -- стена: держит удар
      ('Имперский монитор «Крупеллярий»',  'perk.slow'),       -- арта: стоит и бьёт
      ('Имперский абордажник «Скиссор»',   'perk.bloodlust'),  -- свалка: живёт с добивания
      ('Имперский сателлоид «Эквит»',      'perk.shine')       -- дозор: работает на других
    ) v(nm, pk) loop
    update public.faction_units
       set data = jsonb_set(coalesce(data,'{}'::jsonb), '{perks}',
                            jsonb_build_array(r.pk), true),
           updated_at = now()
     where faction_id = 'club' and name = r.nm;
  end loop;
end$glad$;

-- ═══ §4. ОБЩЕДОСТУПНЫЕ «ПАН-КОЛОНИАЛЬНЫЕ» ══════════════════════════
-- Ставим ПОЛНЫЙ набор (а не дописываем), сохраняя пассивку, которая уже была:
-- у РЭБ — глушение, у радар-разведчика — сенсор, у стелса — транспондер.
--
-- ⚠ У части этих проектов уровень узла ВЫШЕ, чем есть в каталоге сегодня
--   (у «Лорелеи» reactor=3, а у корвета их три: 0..2 — см. _lorelei_tender.sql).
--   Пересчёт на таком data падает «bad reactor», поэтому перед ним уровни
--   подрезаются по живому каталогу. Правка сохраняется в data: следующая
--   публикация из конструктора не воскресит несуществующий узел.
create or replace function public._pub_clamp(p_data jsonb)
returns jsonb language sql stable as $fn$
  select (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
            from (select k, case when k in ('reactor','armor','shield','engine','radar')
                                 then to_jsonb(least(greatest(coalesce((p_data->>k)::int, 0), 0),
                                        coalesce(jsonb_array_length(
                                          public._cn_catalog()->'ship'->(k||'s')
                                            ->coalesce(p_data->>'class','corvette')), 1) - 1))
                                 else p_data->k end as v
                    from jsonb_object_keys(p_data) k) q);
$fn$;

do $pub$
declare r record; kit jsonb; nd jsonb;
  v_K text := 'Конструкционные модули';
  v_R text := 'Модули радиотумана';
begin
  for r in select id, name from public.faction_units
            where category = 'ship' and faction_id is null loop
    kit := case
      -- арт-эсминец: осадная платформа + ракетный залп вдаль
      when r.name like '%артиллерийский эсминец%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',7), jsonb_build_object('g',v_K,'idx',8))
      -- бронированный крейсер: «Эгида» на своих + КАЗ от ракет
      when r.name like '%бронированный крейсер%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',25), jsonb_build_object('g',v_K,'idx',4))
      -- РЭБ: постоянное глушение + скремблер + подавитель кнопок
      when r.name like '%корабль РЭБ%' then jsonb_build_array(
        jsonb_build_object('g',v_R,'idx',0), jsonb_build_object('g',v_R,'idx',11),
        jsonb_build_object('g',v_K,'idx',19))
      -- радар-разведчик: сенсор + ракета-усилитель союзнику
      when r.name like '%радар-разведчик%' then jsonb_build_array(
        jsonb_build_object('g',v_R,'idx',5), jsonb_build_object('g',v_K,'idx',20))
      -- ракетный корвет: «Буревестник» — свой ракетный залп сверх пусковых
      when r.name like '%ракетный корвет%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',8))
      -- ремонтный крейсер: дроны + перезапуск снаряжения строю
      when r.name like '%ремонтный крейсер%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',12), jsonb_build_object('g',v_K,'idx',26))
      -- стелс-разведчик: транспондер + «Вуаль»
      when r.name like '%стелс-разведчик%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',3), jsonb_build_object('g',v_R,'idx',10))
      -- «Лорелея»: ремонтный тендер, дроны и ничего больше
      when r.name like '%Лорелея%' then jsonb_build_array(
        jsonb_build_object('g',v_K,'idx',12))
      else null end;
    if kit is null then continue; end if;
    select public._pub_clamp(jsonb_set(coalesce(u.data,'{}'::jsonb), '{modules}', kit, true))
      into nd from public.faction_units u where u.id = r.id;
    -- пересчёт сводки не всегда возможен: у «Лорелеи» и ремонтного крейсера
    -- стоят именные орудия из верфи, которые сегодняшний валидатор на этот
    -- класс уже не пускает. Набор кнопок таким бортам всё равно нужен —
    -- ставим модули, сводку оставляем прежней.
    begin
      update public.faction_units u
         set data = nd, summary = public._cn_recompute('ship', nd), updated_at = now()
       where u.id = r.id;
    exception when others then
      raise notice 'сводка «%» не пересчитана (%) — ставлю только модули', r.name, sqlerrm;
      update public.faction_units u
         set data = jsonb_set(coalesce(u.data,'{}'::jsonb), '{modules}', kit, true),
             updated_at = now()
       where u.id = r.id;
    end;
  end loop;
end$pub$;

-- ═══ §5. ДОЛИТЬ В ИДУЩИЕ БОИ ═══════════════════════════════════════
-- Борта, выставленные до наката, стоят с пустыми acts/perks: триггер их уже
-- не тронет.
update public.battle_units bu
   set acts  = public._bt_acts_of(bu.unit_id),
       perks = case when jsonb_array_length(coalesce(bu.perks,'[]'::jsonb)) = 0
                    then public._bt_perks_of(bu.unit_id, bu.fid) else bu.perks end
 where bu.alive
   and exists(select 1 from public.battles b
               where b.id = bu.battle_id and b.status in ('forming','active'));

notify pgrst, 'reload schema';

-- Проверка:
--   select name, jsonb_array_length(data->'modules') m, data->'perks' p, summary->>'cost' c
--     from faction_units where category='ship' and faction_id='fac_5bfbfad5f8' order by name;
--   select name, data->'perks' from faction_units where faction_id='club' order by name;
--   select public.admin_bot_battle(null, null, 8, 'fac_5bfbfad5f8');
