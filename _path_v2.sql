-- © 2025–2026. Все права защищены.
-- Применять: node tools/db_run.js _path_v2.sql
-- Требует уже накатанного _promo_path.sql (таблицы starter_path/_done, _reward_grant).
--
-- ЗАЧЕМ. «Путь становления» жил одной панелькой в «Обзоре»: десять строк,
-- эмодзи вместо иконок, никакой структуры. Это первое, что видит новичок, и
-- по нему судят обо всей игре — значит, у пути должна быть своя дверь, свои
-- главы и свой каталог вех, покрывающий все подсистемы, а не только стройку.
--
-- Что делает файл:
--   1) starter_path получает главы (chapter), ключ SVG-глифа (glyph) и строку
--      лора (lore) — картинка и текст больше не зашиты в клиент;
--   2) path_check считает ВСЕ счётчики державы (постройки по типам, флот,
--      армии, аванпосты, концессии, вера, вестник, союзы, войны, Длань…),
--      каждый — под своим exception-блоком: падение одной проверки не должно
--      обнулять весь список;
--   3) каталог расширен до 30 вех в 7 главах. Повторный накат НЕ затирает
--      правки админки (on conflict do nothing), но чинит поля главы/глифа у
--      десяти старых вех — они были заведены до появления колонок.
-- ════════════════════════════════════════════════════════════

-- ── 1. Схема ────────────────────────────────────────────────
alter table public.starter_path add column if not exists chapter text not null default 'roots';
alter table public.starter_path add column if not exists glyph   text not null default '';
alter table public.starter_path add column if not exists lore    text not null default '';

-- Главы: порядок и подписи живут в таблице, а не в js — админка правит текстом.
create table if not exists public.starter_chapters (
  id    text primary key,
  ord   int  not null default 100,
  title text not null default '',
  sub   text not null default '',
  glyph text not null default ''
);
alter table public.starter_chapters enable row level security;
drop policy if exists sc_read on public.starter_chapters;
create policy sc_read on public.starter_chapters for select to authenticated using (true);
revoke insert, update, delete on public.starter_chapters from anon, authenticated;
grant  select                 on public.starter_chapters to authenticated;

insert into public.starter_chapters (id, ord, title, sub, glyph) values
  ('roots',    10, 'Основание',    'земля, люди, первый камень',        'roots'),
  ('industry', 20, 'Хозяйство',    'сырьё, заводы, торговые пути',      'factory'),
  ('science',  30, 'Знание',       'наука и древо технологий',          'science'),
  ('expand',   40, 'Расширение',   'колонии, системы, заставы',         'planet'),
  ('fleet',    50, 'Верфи',        'свой корабль от чертежа до флота',  'shipyard'),
  ('war',      60, 'Сила',         'армия, разведка, первое сражение',  'shield'),
  ('world',    70, 'Голос',        'вера, вестник, союзы, наследие',    'temple')
on conflict (id) do update set ord = excluded.ord, title = excluded.title,
  sub = excluded.sub, glyph = excluded.glyph;

-- ── 2. Каталог вех ──────────────────────────────────────────
-- Новые вехи. Старые десять (first_*) остаются как есть — им ниже проставляются
-- глава и глиф отдельным update, чтобы не терять правки текстов из админки.
insert into public.starter_path (id, ord, chapter, glyph, icon, title, hint, lore, check_key, threshold, reward) values
  -- I. Основание
  ('p_capital',   5,  'roots', 'house',   '•', 'Столица на месте',
   'Кабинет → «Управление колониями»: у державы уже есть столичная планета. Осмотрите её ячейки — с них начинается всё остальное.',
   'Держава начинается не с флага, а с первой распаханной ячейки.', 'colonies', 1, '{"gc":1000}'),
  ('p_store',     15, 'roots', 'vault',   '•', 'Склад под сырьё',
   'Постройте склад: без него добыча упирается в потолок хранения и сырьё просто не приходит.',
   'Пустой амбар честнее полного обоза: он показывает, сколько вы способны удержать.', 'b_warehouse', 1, '{"gc":1500}'),
  ('p_pop',       25, 'roots', 'people',  '•', 'Пять тысяч душ',
   'Стройте жильё и держите благополучие: население растёт само, но только если ему есть где жить и что есть.',
   'Народ — единственный ресурс, который считает себя сам.', 'pop', 5000, '{"gc":2000}'),
  ('p_cells',     35, 'roots', 'cells',   '•', 'Шесть отраслей',
   'Займите шесть ячеек любыми постройками — держава перестаёт быть посёлком и становится хозяйством.',
   'Шесть труб на горизонте — и соседи начинают считать вас всерьёз.', 'buildings', 6, '{"gc":2500}'),

  -- II. Хозяйство
  ('p_goods',     55, 'industry', 'goodsfab', '•', 'Товары для народа',
   'Поставьте фабрику товаров: она гасит спрос населения и держит благополучие, а с ним и рост.',
   'Довольный подданный не пишет писем в столицу.', 'b_goodsfab', 1, '{"gc":2000}'),
  ('p_mines3',    58, 'industry', 'mining_deep', '•', 'Три прииска',
   'Кабинет → «Добыча ресурсов»: заложите ещё две шахты и распределите рабочих по залежам.',
   'Одна шахта — удача. Три — уже промышленность.', 'b_mining', 3, '{"gc":3000,"coupons":1}'),
  ('p_market',    62, 'industry', 'trade',  '•', 'Тридцать тысяч в казне',
   'Хозяйство → «Торговля» → «Рынок»: продайте излишек сырья. Цена ходит — смотрите на график перед продажей.',
   'Цена — это чужое мнение о вашем сырье. Иногда его стоит послушать.', 'gc', 30000, '{"gc":3000}'),
  ('p_conc',      66, 'industry', 'pact',   '•', 'Концессия',
   'Хозяйство → «Добыча» → «Концессии»: отдайте залежь соседу или возьмите чужую. Доход идёт обеим сторонам.',
   'Проще делить прибыль, чем делить планету.', 'conc', 1, '{"gc":3500}'),

  -- III. Знание
  ('p_tech5',     95, 'science', 'tech',    '•', 'Пять технологий',
   'Держите очередь исследований непустой: свободный слот науки — потерянные сутки.',
   'Знание — единственное, что не отнимут вместе с колонией.', 'research', 5, '{"gc":4000,"science":250}'),
  ('p_sci2',      97, 'science', 'sci_giant', '•', 'Второй научный дом',
   'Постройте ещё один научный центр: слоты исследований открываются от их числа.',
   'Два спорящих института делают больше, чем один согласный.', 'b_science', 2, '{"gc":3500,"science":200}'),
  ('p_tech12',    99, 'science', 'sci_anomaly', '•', 'Двенадцать узлов',
   'Древо технологий → ведите одну ветку до конца: профильные узлы дешевле, чем всё подряд.',
   'Ветка, доведённая до края, стоит трёх начатых.', 'research', 12, '{"gc":6000,"science":500}'),

  -- IV. Расширение
  ('p_systems2',  105, 'expand', 'systems', '•', 'Вторая система',
   'Карта → соседняя система → «Занять». Смежность считается по гиперпутям, а не по расстоянию на глаз.',
   'Граница державы — это место, где кончается ваш патруль.', 'systems', 2, '{"gc":4000}'),
  ('p_col4',      110, 'expand', 'planet',  '•', 'Четыре колонии',
   'Заселяйте планеты в занятых системах: каждая даёт ячейки, а ячейки — всё остальное.',
   'Планет много. Рук — нет.', 'colonies', 4, '{"gc":5000,"coupons":1}'),
  ('p_outpost',   115, 'expand', 'outpost', '•', 'Застава в пустоте',
   'Внешняя политика → «Аванпосты»: поставьте пост вне границ. Режим «застава» ещё и заправляет флот.',
   'Пост в пустоте стоит дёшево ровно до тех пор, пока не понадобится.', 'outposts', 1, '{"gc":4500}'),
  ('p_col8',      120, 'expand', 'colony8', '•', 'Восемь миров',
   'Держава на восьми планетах живёт уже своей логистикой: смотрите на плечи караванов и склады.',
   'С восьмого мира начинается разговор о том, кто вы для галактики.', 'colonies', 8, '{"gc":8000,"coupons":2}'),

  -- V. Верфи
  ('p_yard',      145, 'fleet', 'shipyard', '•', 'Своя верфь',
   'Постройте верфь: без неё корпуса собирать негде, а флот заправлять нечем.',
   'Верфь — это обещание, которое держава даёт своему флоту.', 'b_shipyard', 1, '{"gc":4000}'),
  ('p_turret',    150, 'fleet', 'turret',  '•', 'Своё орудие',
   'Оружейная верфь: соберите ствол под свою доктрину — калибр, длина, энергия. Он встанет в ваши корабли.',
   'Чужая пушка всегда чуть-чуть не про вашу войну.', 'turrets', 1, '{"gc":3500}'),
  ('p_design3',   155, 'fleet', 'design',  '•', 'Три дизайна',
   'Конструктор: корвет для разведки, носитель для линии, что-то третье под свой вкус.',
   'Флот из одного класса проигрывает флоту из трёх.', 'units_designed', 3, '{"gc":4000,"shards":{"corvette":2}}'),
  ('p_built5',    160, 'fleet', 'build',   '•', 'Пять корпусов',
   'Вооружённые силы → «Военпром»: поставьте свои дизайны в постройку. Осколки цикла закрывают срок мгновенно.',
   'Чертёж без корпуса — это красивая бумага.', 'units_built', 5, '{"gc":5000}'),
  ('p_fleet2',    165, 'fleet', 'fleet',   '•', 'Два флота',
   'Разведке и линии нужны разные корабли и разные приказы — держите хотя бы два соединения.',
   'Один флот — это один ход. Два — уже выбор.', 'fleets', 2, '{"gc":6000}'),

  -- VI. Сила
  ('p_army',      175, 'war', 'army',    '•', 'Наземная армия',
   'Вооружённые силы: соберите наземное соединение. Орбиту берут корабли, планету — солдаты.',
   'Флаг над планетой ставит пехотинец, а не дредноут.', 'armies', 1, '{"gc":4000}'),
  ('p_spy',       180, 'war', 'intel',   '•', 'Первый агент',
   'Разведуправление → «Рынок рекрутов»: наймите агента и дайте ему дело. Досье соседей дороже залпа.',
   'Дешевле знать, чем стрелять.', 'agents', 1, '{"gc":3500}'),
  ('p_battle2',   190, 'war', 'battle',  '•', 'Второе сражение',
   'Клуб бойцов или война: второй бой вы уже ведёте, а не досматриваете.',
   'Первый бой учит правилам. Второй — себе.', 'battles', 2, '{"gc":7000,"coupons":2}'),
  ('p_milfab',    195, 'war', 'military_factory', '•', 'Военпром',
   'Постройте военный завод: наземная техника и авиация идут только через него.',
   'Война — это в первую очередь график поставок.', 'b_military_factory', 1, '{"gc":4500}'),

  -- VII. Голос
  ('p_temple',    205, 'world', 'temple', '•', 'Храм',
   'Внутренняя политика → «Вера»: постройте храм и примкните к вере или заведите свою.',
   'Держава без веры управляема, но не любима.', 'faith', 1, '{"gc":4000}'),
  ('p_news',      210, 'world', 'news',   '•', 'Слово державы',
   'Вестник державы → «Редакция»: напишите новость от лица государства. После проверки её увидит вся галактика.',
   'История пишется теми, кто не поленился её написать.', 'news', 1, '{"gc":3500}'),
  ('p_members',   215, 'world', 'people', '•', 'Двор',
   'Внутренняя политика → «Двор»: примите игрока на службу и выдайте ему права. Державу тяжело нести одному.',
   'Один человек — это не держава, а хутор с гербом.', 'members', 1, '{"gc":5000}'),
  ('p_ach5',      220, 'world', 'medal',  '•', 'Пять достижений',
   'Статистика державы → «Достижения»: зал заполняется сам, пока вы играете. Загляните, что осталось.',
   'Достижения — это следы, по которым потом читают вашу историю.', 'ach', 5, '{"gc":6000}'),
  ('p_treasury',  225, 'world', 'gc',     '•', 'Казна державы',
   'Держите запас: 250 000 ГС — это не богатство, а право на ошибку.',
   'Казна — это количество ошибок, которые держава переживёт.', 'gc', 250000, '{"gc":10000,"coupons":3}')
on conflict (id) do nothing;

-- Старые десять вех: проставляем главу и глиф (их не было в момент заведения).
update public.starter_path set chapter = v.ch, glyph = v.gl
  from (values
    ('first_mine','roots','mining'), ('first_factory','industry','factory'),
    ('first_science','science','science'), ('first_tech','science','tech'),
    ('first_trade','industry','caravan'), ('first_colony','expand','planet'),
    ('first_design','fleet','design'), ('first_build','fleet','build'),
    ('first_fleet','fleet','fleet'), ('first_battle','war','battle')
  ) as v(id, ch, gl)
 where starter_path.id = v.id and (starter_path.glyph = '' or starter_path.chapter = 'roots' and v.ch <> 'roots');

-- Порядок старых вех разводим по главам, чтобы они встали между новыми.
update public.starter_path set ord = 10  where id = 'first_mine'    and ord = 10;
update public.starter_path set ord = 50  where id = 'first_factory' and ord = 20;
update public.starter_path set ord = 60  where id = 'first_trade'   and ord = 50;
update public.starter_path set ord = 90  where id = 'first_science' and ord = 30;
update public.starter_path set ord = 93  where id = 'first_tech'    and ord = 40;
update public.starter_path set ord = 100 where id = 'first_colony'  and ord = 60;
update public.starter_path set ord = 140 where id = 'first_design'  and ord = 70;
update public.starter_path set ord = 158 where id = 'first_build'   and ord = 80;
update public.starter_path set ord = 163 where id = 'first_fleet'   and ord = 90;
update public.starter_path set ord = 185 where id = 'first_battle'  and ord = 100;

-- ── 3. Проверка и выдача ────────────────────────────────────
create or replace function public.path_check()
returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare
  fid text;
  st  public.starter_path;
  prog numeric;
  vals jsonb := '{}'::jsonb;
  steps jsonb := '[]'::jsonb;
  chaps jsonb := '[]'::jsonb;
  new_ids jsonb := '[]'::jsonb;
  newly int := 0;
  got jsonb;
  d public.starter_path_done;
  v numeric;
  v_max_age numeric;
  v_age     numeric;
  v_stale   boolean := false;
begin
  fid := public._ec_my_fid();

  select coalesce((value->>'max_age_days')::numeric, 30) into v_max_age
    from public.promo_settings where key = 'path';
  select extract(epoch from (now() - coalesce(created_at, now()))) / 86400.0 into v_age
    from public.faction_economy where faction_id = fid;
  v_stale := coalesce(v_max_age, 30) > 0 and coalesce(v_age, 0) > coalesce(v_max_age, 30);

  -- Казна, наука, осколки, изученные узлы.
  begin
    select coalesce(jsonb_array_length(coalesce(research,'[]'::jsonb)),0) into v
      from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('research', coalesce(v,0));
    select coalesce(gc,0) into v from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('gc', coalesce(v,0));
    select coalesce(science,0) into v from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('science', coalesce(v,0));
    select coalesce(build_coupons,0) into v from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('coupons', coalesce(v,0));
  exception when others then null; end;

  -- Земля и люди.
  begin
    select count(*) into v from public.colonies where faction_id = fid;
    vals := vals || jsonb_build_object('colonies', coalesce(v,0));
    select count(distinct system_id) into v from public.colonies where faction_id = fid;
    vals := vals || jsonb_build_object('systems', coalesce(v,0));
    select coalesce(sum(pop),0) into v from public.colonies where faction_id = fid;
    vals := vals || jsonb_build_object('pop', coalesce(v,0));
  exception when others then null; end;

  -- Постройки: всего и по типам (один проход, чтобы не бить по диску).
  begin
    select count(*) into v from public.colony_buildings where faction_id = fid;
    vals := vals || jsonb_build_object('buildings', coalesce(v,0));
    select coalesce(jsonb_object_agg('b_' || btype, n), '{}'::jsonb) into got
      from (select btype, count(*) n from public.colony_buildings
             where faction_id = fid group by btype) t;
    vals := vals || coalesce(got, '{}'::jsonb);
  exception when others then null; end;

  -- Конструкторы и производство.
  begin
    select count(*) into v from public.faction_units where faction_id = fid;
    vals := vals || jsonb_build_object('units_designed', coalesce(v,0));
  exception when others then null; end;
  begin
    select coalesce(sum(qty),0) into v from public.unit_production
      where faction_id = fid and status = 'done';
    vals := vals || jsonb_build_object('units_built', coalesce(v,0));
  exception when others then null; end;
  begin
    select count(*) into v from public.faction_turrets where faction_id = fid;
    vals := vals || jsonb_build_object('turrets', coalesce(v,0));
  exception when others then null; end;

  -- Подсистемы: каждая под своим guard'ом — окружения различаются.
  if to_regclass('public.trade_routes') is not null then
    begin
      execute 'select count(*) from public.trade_routes where (a_fid = $1 or b_fid = $1) and status = ''active''' into v using fid;
      vals := vals || jsonb_build_object('routes', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.fleets') is not null then
    begin
      execute 'select count(*) from public.fleets where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('fleets', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.armies') is not null then
    begin
      execute 'select count(*) from public.armies where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('armies', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.battles') is not null then
    begin
      execute 'select count(*) from public.battles where (attacker_fid = $1 or defender_fid = $1)' into v using fid;
      vals := vals || jsonb_build_object('battles', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.spy_agents') is not null then
    begin
      execute 'select count(*) from public.spy_agents where faction_id = $1 and coalesce(captive,false) = false' into v using fid;
      vals := vals || jsonb_build_object('agents', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.outposts') is not null then
    begin
      execute 'select count(*) from public.outposts where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('outposts', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.mining_concessions') is not null then
    begin
      execute 'select count(*) from public.mining_concessions where from_fid = $1 or to_fid = $1' into v using fid;
      vals := vals || jsonb_build_object('conc', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.faith_membership') is not null then
    begin
      execute 'select count(*) from public.faith_membership where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('faith', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.faction_news') is not null then
    begin
      execute 'select count(*) from public.faction_news where faction_id = $1 and status = ''published''' into v using fid;
      vals := vals || jsonb_build_object('news', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.faction_achievements') is not null then
    begin
      execute 'select count(*) from public.faction_achievements where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('ach', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.faction_members') is not null then
    begin
      execute 'select count(*) from public.faction_members where faction_id = $1 and status = ''approved''' into v using fid;
      vals := vals || jsonb_build_object('members', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.diplo_members') is not null then
    begin
      execute 'select count(*) from public.diplo_members where fid = $1' into v using fid;
      vals := vals || jsonb_build_object('unions', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.war_sides') is not null then
    begin
      execute 'select count(*) from public.war_sides where fid = $1' into v using fid;
      vals := vals || jsonb_build_object('wars', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.doom_guns') is not null then
    begin
      execute 'select count(*) from public.doom_guns where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('doom', coalesce(v,0));
    exception when others then null; end;
  end if;

  -- ── Выдача ──
  for st in select * from public.starter_path where active order by ord, id loop
    prog := coalesce((vals->>st.check_key)::numeric, 0);
    select * into d from public.starter_path_done
      where faction_id = fid and step_id = st.id;

    if d.step_id is null and prog >= st.threshold and not v_stale then
      got := public._reward_grant(fid, st.reward);
      insert into public.starter_path_done(faction_id, step_id, granted)
           values (fid, st.id, got)
        on conflict do nothing;
      if found then
        newly   := newly + 1;
        new_ids := new_ids || to_jsonb(st.id);
      end if;
      select * into d from public.starter_path_done where faction_id = fid and step_id = st.id;
    end if;

    steps := steps || jsonb_build_array(jsonb_build_object(
      'id', st.id, 'ord', st.ord, 'icon', st.icon, 'glyph', st.glyph,
      'chapter', st.chapter, 'lore', st.lore,
      'title', st.title, 'hint', st.hint,
      'check_key', st.check_key, 'threshold', st.threshold, 'reward', st.reward,
      'progress', prog, 'done', (d.step_id is not null), 'done_at', d.done_at));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'ord', c.ord, 'title', c.title,
                                               'sub', c.sub, 'glyph', c.glyph) order by c.ord, c.id), '[]'::jsonb)
    into chaps from public.starter_chapters c;

  select coalesce(gc,0) into v from public.faction_economy where faction_id = fid;
  return jsonb_build_object('steps', steps, 'chapters', chaps, 'newly', newly, 'new_ids', new_ids,
                            'gc', coalesce(v,0), 'stale', v_stale,
                            'age_days', round(coalesce(v_age,0), 1), 'max_age_days', v_max_age);
end$$;
grant execute on function public.path_check() to authenticated;

-- ── 4. Админка: сохранение вехи знает про главу, глиф и лор ──
create or replace function public.admin_path_save(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i text;
begin
  perform public._promo_staff();
  i := btrim(coalesce(p->>'id',''));
  if i = '' then raise exception 'Пустой id вехи'; end if;

  insert into public.starter_path as t
    (id, ord, icon, glyph, chapter, lore, title, hint, check_key, threshold, reward, active)
  values (i,
          coalesce((p->>'ord')::int, 100), coalesce(p->>'icon','•'),
          coalesce(p->>'glyph',''), coalesce(nullif(p->>'chapter',''),'roots'),
          coalesce(p->>'lore',''),
          coalesce(p->>'title',''), coalesce(p->>'hint',''),
          coalesce(p->>'check_key','gc'),
          coalesce((p->>'threshold')::numeric, 1),
          coalesce(p->'reward','{}'::jsonb),
          coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set
    ord = excluded.ord, icon = excluded.icon, glyph = excluded.glyph,
    chapter = excluded.chapter, lore = excluded.lore,
    title = excluded.title, hint = excluded.hint,
    check_key = excluded.check_key, threshold = excluded.threshold,
    reward = excluded.reward, active = excluded.active;

  return jsonb_build_object('ok', true, 'id', i);
end$$;
grant execute on function public.admin_path_save(jsonb) to authenticated;

-- Список для админки: добавились главы (каталог глав редактируется отдельно).
create or replace function public.admin_promo_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out_j jsonb;
begin
  perform public._promo_staff();
  select jsonb_build_object(
    'codes', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.promo_codes c), '[]'::jsonb),
    'path',  coalesce((select jsonb_agg(to_jsonb(s) order by s.ord, s.id) from public.starter_path s), '[]'::jsonb),
    'chapters', coalesce((select jsonb_agg(to_jsonb(x) order by x.ord, x.id) from public.starter_chapters x), '[]'::jsonb),
    'settings', coalesce((select value from public.promo_settings where key = 'path'), '{"max_age_days":30}'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                         from (select * from public.promo_redemptions order by created_at desc limit 50) r), '[]'::jsonb)
  ) into out_j;
  return out_j;
end$$;
grant execute on function public.admin_promo_list() to authenticated;
