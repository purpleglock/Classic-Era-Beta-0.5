-- ════════════════════════════════════════════════════════════════════
-- ГАЛАКТИЧЕСКАЯ ПОЭМА — мультиплеерная мини-игра новеллы (в духе DDLC).
-- Каждый день ВСЕ фракции голосуют за одно из 4 слов; в конце дня
-- слово-победитель разворачивается в строку стиха. За неделю (пн–вс)
-- складывается поэма из 7 строк.
--
-- СТРОФЫ И РИФМА. Неделя = 3 строфы: I–II (дни 0-1), III–IV (дни 2-3),
-- V–VII (дни 4-6). Внутри строфы все строки рифмуются: на неделю
-- строфам раздаётся перестановка трёх рифмовых семей, у КАЖДОГО слова
-- ровно 3 варианта строки — по одному на семью:
--   lines[1] = рифма «-ой»   lines[2] = рифма «-ит»   lines[3] = рифма «-ла́»
-- Так любые два слова-победителя одной строфы дают созвучные строки.
--
-- ТЕМЫ-АНТИПОДЫ (одно голосование может ПОРТИТЬ другое):
--   Война ↔ Единство · Надежда ↔ Тьма · Знание ↔ Хаос · Богатство ↔ Космос
-- Итог недели: доминанта = тема с наибольшим числом строк (нужно ≥3),
-- но каждая строка темы-антипода гасит одну строку доминанты; если
-- после гашения осталось <3 — «Спор тем», эффекта нет. Если доминанта
-- целиком заняла хотя бы одну строфу — «строфа сложилась», эффект ×1.5.
-- Эффект = разовая выплата/штраф по faction_economy (тик economy_accrue
-- НЕ трогаем — без клобберов).
--
-- Применять в Supabase SQL Editor ПОСЛЕ _economy_setup.sql (нужны
-- faction_applications / faction_economy / faction_news).
-- Всё лениво: _poem_ensure() дорезолвливает прошедшие дни/недели при
-- первом же обращении (poem_state / poem_vote), крон не нужен.
-- ════════════════════════════════════════════════════════════════════

-- ── Словарь: слово + тема + варианты строк, в которые оно разворачивается ──
create table if not exists public.poem_words (
  id     text primary key,
  word   text not null,
  theme  text not null,          -- war|hope|dark|love|space|wealth|knowledge|chaos
  lines  text[] not null         -- [1]=рифма «-ой», [2]=«-ит», [3]=«-ла́»
);

-- ── Недели поэмы ──
create table if not exists public.poem_weeks (
  week_start   date primary key,            -- понедельник (UTC)
  status       text not null default 'active',   -- active | done
  effect       jsonb,                       -- итог недели: {theme,title,descr,tone,mult}
  completed_at timestamptz
);

-- ── Дни: варианты слов, победитель, готовая строка ──
create table if not exists public.poem_days (
  week_start  date not null,
  day_idx     int  not null check (day_idx between 0 and 6),
  options     jsonb not null,               -- ["word_id", ...] — 4 кандидата
  winner_word text,
  line        text,
  resolved    boolean not null default false,
  primary key (week_start, day_idx)
);

-- ── Голоса: 1 фракция = 1 голос в день (можно передумать до конца дня) ──
create table if not exists public.poem_votes (
  week_start date not null,
  day_idx    int  not null,
  faction_id text not null,
  word_id    text not null,
  voter      uuid,
  created_at timestamptz not null default now(),
  primary key (week_start, day_idx, faction_id)
);

-- Всё читается/пишется ТОЛЬКО через RPC (SECURITY DEFINER) — таблицы закрыты.
alter table public.poem_words enable row level security;
alter table public.poem_weeks enable row level security;
alter table public.poem_days  enable row level security;
alter table public.poem_votes enable row level security;
revoke all on public.poem_words, public.poem_weeks, public.poem_days, public.poem_votes from anon, authenticated;

-- ── Словарь (8 тем × 6 слов; у каждого слова 3 строки: «-ой», «-ит», «-ла́») ──
insert into public.poem_words(id, word, theme, lines) values
  -- ⚔ война
  ('steel',    'сталь',     'war', array[
     'Мы говорим со вселенной сталью, а не мольбой.',
     'Сталь остывает к утру, но обида её саднит.',
     'Сталь помнит руку, что её к звёздам вознесла.']),
  ('banner',   'знамя',     'war', array[
     'Пока знамя в руках — столица стоит за спиной.',
     'Знамя молчит о цене: за него говорит гранит.',
     'Знамя встаёт из пепла — древко цело, и вера цела.']),
  ('legion',   'легион',    'war', array[
     'Легион не спит: сны у него отобраны войной.',
     'Легион считает шаги — и космос под ним гудит.',
     'Легион не дрогнул — дрогнула сама скала.']),
  ('siege',    'осада',     'war', array[
     'Осада — терпенье, ставшее крепостной стеной.',
     'Осада не кричит. Осада просто стоит.',
     'Осада снята, но в сердце своя цитадель легла.']),
  ('blade',    'клинок',    'war', array[
     'Клинок — последний довод, и довод самый прямой.',
     'Куда не дотянется слово — клинок долетит.',
     'Клинок закалён в огне, что выжег жалость дотла.']),
  ('powder',   'порох',     'war', array[
     'Держи порох сухим — и спи спокойно, герой.',
     'Порох не спорит: он ждёт, когда искра решит.',
     'Пороху всё равно, чья искра к нему снизошла.']),
  -- ☀ надежда
  ('dawn',     'рассвет',   'hope', array[
     'Рассвет не бывает чужим — он приходит за тьмой.',
     'Самый долгий рейс всё равно рассветом залит.',
     'Ночь ворчала, а всё же рассвет за собой привела.']),
  ('beacon',   'маяк',      'hope', array[
     'Маяк на краю карты шепчет: «вернись живой».',
     'Пока горит хоть один маяк — курс не забыт.',
     'Маяк затем и стоит, чтобы бездна не всех увела.']),
  ('sprout',   'росток',    'hope', array[
     'Росток сквозь палубный шов тянется к лампе дневной.',
     'Росток упрямей брони — спросите у лопнувших плит.',
     'Из трещины в бетоне жизнь ростком проросла.']),
  ('wings',    'крылья',    'hope', array[
     'Крылья не выдают по уставу — их растят мечтой.',
     'Кто отрастил крылья, того трюм не тяготит.',
     'Небо примет любого, лишь бы крылья душа несла.']),
  ('promise',  'обещание',  'hope', array[
     'Обещание вернуться тянет домой сильней, чем прибой.',
     'Кто дал обещание, того и пустота хранит.',
     'Обещанием жила станция — и потому жила.']),
  ('morning',  'утро',      'hope', array[
     'Утро является без доклада даже в штаб фронтовой.',
     'Каждое утро галактика заново себя творит.',
     'Утро перепишет всё, что ночь не дожгла.']),
  -- 🌑 тьма
  ('ash',      'пепел',     'dark', array[
     'Пепел миров оседает на плечи седой каймой.',
     'Пепел не помнит огня, но до сих пор чадит.',
     'От столиц остаётся пепел, от споров — зола.']),
  ('abyss',    'бездна',    'dark', array[
     'Бездна не торопит: у неё вечность за кормой.',
     'Бездна молчит в ответ — но очень внимательно молчит.',
     'Мы строим мосты — бездна считает, сколько сожгла.']),
  ('shadow',   'тень',      'dark', array[
     'Тень не отстанет: она терпеливей стражи ночной.',
     'Тень длиннее знамён, когда солнце к закату скользит.',
     'Чем ярче горела слава, тем шире тень пролегла.']),
  ('rust',     'ржавчина',  'dark', array[
     'Ржавчина — время, выигравшее спор со сталью самой.',
     'Ржавчина никуда не спешит — она и так победит.',
     'Ржавчина переписала всё, что сталь стерегла.']),
  ('oblivion', 'забвение',  'dark', array[
     'Забвение входит без стука, тихою порой.',
     'Забвению всё равно, как громко труба трубит.',
     'Забвение тихо взяло, чего война не взяла.']),
  ('cold',     'стужа',     'dark', array[
     'Стужа меж звёзд лечит от славы дурной.',
     'Стужа приходит туда, где смех уже не звучит.',
     'Стужа честна: она приходит, когда любовь ушла.']),
  -- ❤ единство
  ('hand',     'рука',      'love', array[
     'Рука, протянутая в шлюз, дороже казны золотой.',
     'Рука на плече защищает надёжней, чем щит.',
     'Держи мою руку — карту дорисуем, была не была.']),
  ('home',     'дом',       'love', array[
     'Дом — это координаты, зовущие домой.',
     'Дом — это причал, что любой твой борт приютит.',
     'Дом — это лампа в окне, что тебя всю ночь ждала.']),
  ('heart',    'сердце',    'love', array[
     'Сердце стучит морзянкой: «свои, свои, отбой».',
     'Реактор глохнет, а сердце знай себе стучит.',
     'Сердце — единственная печь, что флот от стужи спасла.']),
  ('letter',   'письмо',    'love', array[
     'Письмо дотянется всюду — над любой глубиной.',
     'Письмо из дома любую вахту укоротит.',
     'Даже сквозь три блокады строчка письма прошла.']),
  ('warmth',   'тепло',     'love', array[
     'Тепло провозят контрабандой через кордон любой.',
     'Раздатое тепло к тебе же назад спешит.',
     'Тепло остаётся теплом, чья б печь его ни дала.']),
  ('name',     'имя',       'love', array[
     'Имя, сказанное вслух, ведёт сквозь эфир глухой.',
     'Имя в эфире держит крепче любых орбит.',
     'Назови по имени — и ночь заметно светла.']),
  -- ✦ космос
  ('star',     'звезда',    'space', array[
     'Звезда светит всем подряд — с щедростью одной.',
     'Звезда не ждёт аплодисментов — она просто горит.',
     'Звезда — это свеча, которую тьма не залила.']),
  ('orbit',    'орбита',    'space', array[
     'Орбита — верность, записанная над головой.',
     'Кто вышел на орбиту, того притяженье щадит.',
     'Орбита замкнулась — и станция дом обрела.']),
  ('nebula',   'туманность','space', array[
     'Туманность — пыль, решившая стать пеленой цветной.',
     'Туманность — черновик, где будущее гостит.',
     'Туманность — колыбель: в ней тысяча звёзд взошла.']),
  ('comet',    'комета',    'space', array[
     'Комета не просит орбиты — летит тропой кривой.',
     'Комета не обещает вернуться — но хвост сулит.',
     'Комета чиркнула по небу — и ночь ожила.']),
  ('horizon',  'горизонт',  'space', array[
     'Горизонт отступает — но лишь перед новой верстой.',
     'Горизонт — это дверь, и она прыжку принадлежит.',
     'Прыжок — и черта горизонта снова отползла.']),
  ('silence',  'тишина',    'space', array[
     'Тишина — это космос, говорящий с тобой.',
     'Если в эфире тишина — значит, кто-то не спит.',
     'Тишина не пуста: она наше слово берегла.']),
  -- ◆ богатство
  ('gold',     'золото',    'wealth', array[
     'Золото не звенит попусту: звон у него скупой.',
     'Золото молчит на всех языках — и всех мирит.',
     'Золото тянет ко дну, если совесть не тяжела.']),
  ('caravan',  'караван',   'wealth', array[
     'Караван прошёл — и граница стала пунктирной чертой.',
     'Караван идёт — значит, путь ещё не закрыт.',
     'Караван вела не карта — прибыль его вела.']),
  ('vein',     'жила',      'wealth', array[
     'Жила в астероиде бьётся, как пульс, под корой.',
     'Жила молчала века — теперь под буром звенит.',
     'Нашедшему жилу — хвала и быстрая кабала.']),
  ('fair',     'ярмарка',   'wealth', array[
     'Ярмарка гудит — значит, фронт обойдёт стороной.',
     'Ярмарка шумит: залп сегодня не прозвучит.',
     'На ярмарке миров и рассвет — статья ремесла.']),
  ('coin',     'монета',    'wealth', array[
     'Монета звенит одинаково над любой мостовой.',
     'Монета катится дальше, чем снаряд летит.',
     'Монета — судья, что обе стороны учла.']),
  ('granary',  'амбар',     'wealth', array[
     'Полный амбар — крепость, не взятая ни одной ордой.',
     'Полный амбар красноречивей пушек говорит.',
     'Амбар полон — и зима уже не так зла.']),
  -- 📖 знание
  ('formula',  'формула',   'knowledge', array[
     'Формула — молитва, проверенная доской.',
     'Формула тиха, но громче пушек гремит.',
     'Формула хлеб растила, пока война жгла.']),
  ('archive',  'архив',     'knowledge', array[
     'Архив — тот же арсенал, но с начинкой иной.',
     'В архиве спят войны, которых никто не повторит.',
     'Архив помнит и то, что толпа давно замела.']),
  ('question', 'вопрос',    'knowledge', array[
     'Хороший вопрос открывает и люк потайной.',
     'Вопрос летит дальше зонда — и в пути не сгорит.',
     'Ответы стареют; вопросы — острей сверла.']),
  ('blueprint','чертёж',    'knowledge', array[
     'Чертёж — мечта, что выучила язык мастеровой.',
     'Каждая линия чертежа однажды в металле блестит.',
     'Чертёж — это судьба, что до срока в тубусе спала.']),
  ('lantern',  'светоч',    'knowledge', array[
     'Светоч не гаснет сам — его гасят рукой чужой.',
     'Передай светоч дальше: путь ещё предстоит.',
     'Светоч затем и держат, чтобы мгла не пришла.']),
  ('atlas',    'атлас',     'knowledge', array[
     'Атлас — письмо картографа, подписанное звездой.',
     'Атлас — старик, что на молодость звёзд ворчит.',
     'Атлас отстал на прыжок: галактика быстро росла.']),
  -- 🌀 хаос
  ('dice',     'жребий',    'chaos', array[
     'Жребий брошен давно — и катится сам собой.',
     'Жребий не даёт гарантий — этим и веселит.',
     'Жребий выпал — и карта планов в печку пошла.']),
  ('vortex',   'вихрь',     'chaos', array[
     'Вихрь не читает лоций — оттого и свободный такой.',
     'Вихрь не ждёт прогноза — он сам его сочинит.',
     'Вихрь прошёл — и роща мачт полегла.']),
  ('crack',    'трещина',   'chaos', array[
     'Всё начинается с трещины — даже свет над водой.',
     'Сначала трещина шепчет — потом купол трещит.',
     'Трещина — росчерк: эпоха черту подвела.']),
  ('laughter', 'смех',      'chaos', array[
     'Смех в рубке страшней сирены самой боевой.',
     'Смех — единственный груз, что досмотру не подлежит.',
     'Смех — это броня, что легче любого крыла.']),
  ('spark',    'искра',     'chaos', array[
     'Искра мала, но спорит с любой темнотой.',
     'Искра не спрашивает, чей порох, — она вершит.',
     'Искра мала, а пол-арсенала на воздух подняла.']),
  ('carousel', 'карусель',  'chaos', array[
     'Карусель фронтов оплачена звонкой казной.',
     'Карусель фронтов скрипит, но не тормозит.',
     'Карусель фронтов и столицу в пляс увлекла.'])
on conflict (id) do update set word = excluded.word, theme = excluded.theme, lines = excluded.lines;

-- ── Русские подписи тем + тон эффекта (зеркало в render.js!) ──
create or replace function public._poem_theme_ru(p text) returns text language sql immutable as $$
  select case p
    when 'war' then 'Война' when 'hope' then 'Надежда' when 'dark' then 'Тьма'
    when 'love' then 'Единство' when 'space' then 'Космос' when 'wealth' then 'Богатство'
    when 'knowledge' then 'Знание' when 'chaos' then 'Хаос' else 'Разноголосица' end
$$;

-- ── Тема-антипод: её строки гасят строки соперницы (зеркало в render.js!) ──
create or replace function public._poem_oppo(p text) returns text language sql immutable as $$
  select case p
    when 'war' then 'love' when 'love' then 'war'
    when 'hope' then 'dark' when 'dark' then 'hope'
    when 'knowledge' then 'chaos' when 'chaos' then 'knowledge'
    when 'wealth' then 'space' when 'space' then 'wealth' end
$$;

-- ── Детерминированный «рандом» недели/дня (одинаков при любом числе вызовов) ──
create or replace function public._poem_hash(p text) returns int language sql immutable as $$
  select ('x' || substr(md5(p), 1, 8))::bit(32)::int & 2147483647
$$;

-- ── Строфа дня: 0 = дни 0-1, 1 = дни 2-3, 2 = дни 4-6 ──
create or replace function public._poem_group(p_day int) returns int language sql immutable as $$
  select case when p_day >= 4 then 2 else p_day / 2 end
$$;

-- ── Рифмовая семья строфы: перестановка [1,2,3] по сиду недели.
--    Все строки одной строфы берутся из ОДНОЙ семьи → рифмуются между собой;
--    за неделю звучат все три рифмы («-ой», «-ит», «-ла́»). ──
create or replace function public._poem_family(p_week date, p_day int) returns int language sql immutable as $$
  select (array[
    array[1,2,3], array[1,3,2], array[2,1,3],
    array[2,3,1], array[3,1,2], array[3,2,1]
  ])[1 + public._poem_hash(p_week::text || ':fam') % 6]
   [1 + public._poem_group(p_day)]
$$;

-- ── 4 варианта слова на день: по одному кандидату от темы, из них 4 темы (сид = неделя+день) ──
create or replace function public._poem_gen_options(p_week date, p_day int)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(id)), '[]'::jsonb) from (
    select id from (
      select distinct on (theme) id, theme
      from public.poem_words
      order by theme, md5(p_week::text || ':' || p_day || ':' || id)
    ) per_theme
    order by md5(p_week::text || ':' || p_day || ':t:' || theme)
    limit 4
  ) picked
$$;
revoke all on function public._poem_gen_options(date, int) from public, anon, authenticated;

-- ── Эффект недели. Доминанта = тема с наибольшим числом строк (нужно ≥3),
--    НО каждая строка темы-антипода гасит одну строку доминанты («Спор тем»
--    = эффекта нет). Строфа, целиком спетая доминантой, усиливает эффект ×1.5.
--    Возвращает jsonb {theme,title,descr,tone,mult[,vs]} и ПРИМЕНЯЕТ выплаты/штрафы.
create or replace function public._poem_apply_effect(p_week date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_theme text; v_cnt int; v_score int; v_oppo text; v_ocnt int := 0;
  v_strofa boolean := false; v_mult numeric := 1.0; v_note text := ''; v_fx jsonb;
begin
  select w.theme, count(*) into v_theme, v_cnt
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = p_week and d.resolved
  group by w.theme
  order by count(*) desc, md5(p_week::text || w.theme)
  limit 1;

  if v_theme is null or v_cnt < 3 then
    return jsonb_build_object('theme', 'mixed', 'tone', 'none', 'mult', 1,
      'title', 'Разноголосица',
      'descr', 'Стих вышел пёстрым — галактика пожала плечами. Эффекта нет.');
  end if;

  -- антипод гасит: эффективный счёт = свои строки − строки темы-антипода
  v_oppo := public._poem_oppo(v_theme);
  select count(*) into v_ocnt
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = p_week and d.resolved and w.theme = v_oppo;
  v_score := v_cnt - coalesce(v_ocnt, 0);
  if v_score < 3 then
    return jsonb_build_object('theme', v_theme, 'tone', 'none', 'mult', 1, 'vs', v_oppo,
      'title', 'Спор тем',
      'descr', format('«%s» (%s стр.) столкнулась со своим антиподом — «%s» (%s стр.). Голоса взаимно погасли, эффекта нет.',
        public._poem_theme_ru(v_theme), v_cnt, public._poem_theme_ru(v_oppo), v_ocnt));
  end if;

  -- «строфа сложилась»: хотя бы одна строфа (I–II / III–IV / V–VII) целиком за доминантой
  select exists (
    select 1
    from public.poem_days d join public.poem_words w on w.id = d.winner_word
    where d.week_start = p_week and d.resolved
    group by public._poem_group(d.day_idx)
    having bool_and(w.theme = v_theme)
       and count(*) = (case when min(d.day_idx) >= 4 then 3 else 2 end)
  ) into v_strofa;
  if v_strofa then
    v_mult := 1.5;
    v_note := ' Строфа сложилась в один голос — эффект усилен в полтора раза.';
  end if;

  -- Числа скромные: это символический недельный штрих, а не источник дохода.
  case v_theme
    when 'hope' then
      update public.faction_economy
        set gc = gc + least(round(3000 * v_mult), greatest(round(100 * v_mult), round(gc * 0.005 * v_mult)));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Прилив надежды',
        'descr', 'Казна каждой державы выросла на 0.5% (от 100 до 3 000 ГС).' || v_note);
    when 'wealth' then
      update public.faction_economy set gc = gc + round(500 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Золотая неделя',
        'descr', 'Каждая держава получила 500 ГС.' || v_note);
    when 'knowledge' then
      update public.faction_economy set science = science + round(30 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Век просвещения',
        'descr', 'Каждая держава получила 30 очков науки.' || v_note);
    when 'love' then
      update public.faction_economy set tnp = tnp + round(30 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Узы единства',
        'descr', 'Каждая держава получила 30 товаров.' || v_note);
    when 'space' then
      update public.faction_economy set gc = gc + round(150 * v_mult), science = science + round(15 * v_mult);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Зов горизонта',
        'descr', 'Каждая держава получила 150 ГС и 15 очков науки.' || v_note);
    when 'war' then
      update public.faction_economy
        set gc = greatest(0, gc - least(round(2000 * v_mult), greatest(round(100 * v_mult), round(gc * 0.005 * v_mult))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Мобилизация',
        'descr', 'Военные приготовления съели 0.5% казны каждой державы (от 100 до 2 000 ГС).' || v_note);
    when 'dark' then
      update public.faction_economy
        set gc = greatest(0, gc - least(round(4000 * v_mult), greatest(round(200 * v_mult), round(gc * 0.01 * v_mult))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Тень над сектором',
        'descr', 'Упадок духа: −1% казны каждой державы (от 200 до 4 000 ГС).' || v_note);
    when 'chaos' then
      update public.faction_economy
        set gc = greatest(0, gc - round(200 * v_mult)
          + public._poem_hash(p_week::text || faction_id) % (round(801 * v_mult))::int);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Колесо хаоса',
        'descr', 'Каждой державе выпал свой жребий: от −200 до +600 ГС.' || v_note);
    else
      v_fx := jsonb_build_object('theme', 'mixed', 'tone', 'none', 'title', 'Разноголосица',
        'descr', 'Эффекта нет.');
  end case;
  return v_fx || jsonb_build_object('mult', v_mult);
end$$;
revoke all on function public._poem_apply_effect(date) from public, anon, authenticated;

-- ── Ленивый сеттл: дорезолвить дни, завершить недели, создать текущие строки ──
create or replace function public._poem_ensure()
returns void language plpgsql security definer set search_path=public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_week  date := date_trunc('week', (now() at time zone 'utc'))::date;
  v_day   int  := extract(isodow from (now() at time zone 'utc'))::int - 1;
  wk record; d record; v_upto int; v_winner text; v_lines text[]; v_line text; v_fx jsonb; v_poem text;
begin
  perform pg_advisory_xact_lock(hashtext('poem_settle'));

  -- текущая неделя существует
  insert into public.poem_weeks(week_start) values (v_week) on conflict do nothing;

  -- дорастить дни всех активных недель (текущая — до сегодня, прошлые — до вс)
  for wk in select * from public.poem_weeks where status = 'active' order by week_start loop
    v_upto := case when wk.week_start = v_week then v_day else 6 end;
    for i in 0..v_upto loop
      insert into public.poem_days(week_start, day_idx, options)
        values (wk.week_start, i, public._poem_gen_options(wk.week_start, i))
        on conflict do nothing;
    end loop;
  end loop;

  -- резолв всех прошедших дней: победитель по голосам, без голосов — детерминированный;
  -- строка = вариант слова из рифмовой семьи строфы (рифмуется с соседями по строфе)
  for d in select * from public.poem_days
           where not resolved and (week_start + day_idx) < v_today
           order by week_start, day_idx loop
    select v.word_id into v_winner
      from public.poem_votes v
      where v.week_start = d.week_start and v.day_idx = d.day_idx
        and v.word_id in (select jsonb_array_elements_text(d.options))
      group by v.word_id
      order by count(*) desc, md5(d.week_start::text || d.day_idx || v.word_id)
      limit 1;
    if v_winner is null then
      select o into v_winner from (
        select jsonb_array_elements_text(d.options) as o
      ) t order by md5(d.week_start::text || ':' || d.day_idx || ':w:' || o) limit 1;
    end if;
    select lines into v_lines from public.poem_words where id = v_winner;
    if v_lines is null or array_length(v_lines, 1) is null then
      v_line := null;
    else
      v_line := v_lines[least(public._poem_family(d.week_start, d.day_idx), array_length(v_lines, 1))];
    end if;
    update public.poem_days set winner_word = v_winner, line = v_line, resolved = true
      where week_start = d.week_start and day_idx = d.day_idx;
  end loop;

  -- завершить прошедшие недели: эффект всем + новость с полным стихом
  for wk in select * from public.poem_weeks where status = 'active' and week_start < v_week order by week_start loop
    v_fx := public._poem_apply_effect(wk.week_start);
    update public.poem_weeks set status = 'done', effect = v_fx, completed_at = now()
      where week_start = wk.week_start;
    select string_agg(line, E'\n' order by day_idx) into v_poem
      from public.poem_days where week_start = wk.week_start and resolved;
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values (null, '🖋 ГАЛАКТИЧЕСКАЯ ПОЭМА', 'rgba(200,170,120,0.6)', null, null,
        'Поэма недели завершена: «' || coalesce(v_fx->>'title', '…') || '»',
        null,
        coalesce(v_poem, '…') || E'\n\n— ' || coalesce(v_fx->>'descr', ''),
        'approved', now(), now(), now());
    -- в ленте держим не больше 8 поэм
    delete from public.faction_news
      where owner_id is null and faction_name = '🖋 ГАЛАКТИЧЕСКАЯ ПОЭМА'
        and id not in (select id from public.faction_news
          where owner_id is null and faction_name = '🖋 ГАЛАКТИЧЕСКАЯ ПОЭМА'
          order by created_at desc limit 8);
  end loop;
end$$;
revoke all on function public._poem_ensure() from public, anon, authenticated;

-- ── Состояние для клиента ──
create or replace function public.poem_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_week  date := date_trunc('week', (now() at time zone 'utc'))::date;
  v_day   int  := extract(isodow from (now() at time zone 'utc'))::int - 1;
  v_fid text; v_opts jsonb; v_my text; v_lines jsonb; v_last jsonb; v_total int; v_pair jsonb;
begin
  perform public._poem_ensure();
  select faction_id into v_fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;

  -- варианты сегодняшнего слова + живые счётчики голосов + ФЛАГИ проголосовавших держав;
  -- превью = вариант из рифмовой семьи текущей строфы (та же, что при резолве)
  select jsonb_agg(jsonb_build_object(
      'id', w.id, 'word', w.word, 'theme', w.theme,
      'preview', w.lines[least(public._poem_family(v_week, v_day), array_length(w.lines, 1))],
      'votes', coalesce(c.n, 0),
      'voters', coalesce(c.voters, '[]'::jsonb)) order by o.ord)
    into v_opts
  from public.poem_days d,
       lateral (select value #>> '{}' as wid, ordinality as ord
                from jsonb_array_elements(d.options) with ordinality) o
  join public.poem_words w on w.id = o.wid
  left join lateral (
      select count(*)::int as n,
             coalesce(jsonb_agg(jsonb_build_object(
                 'fid', vv.faction_id, 'name', vv.name,
                 'crest', vv.herald_url, 'color', vv.color)
               order by vv.created_at) filter (where vv.rn <= 16), '[]'::jsonb) as voters
      from (
        select v.faction_id, v.created_at, a.name, a.herald_url, a.color,
               row_number() over (order by v.created_at) as rn
        from public.poem_votes v
        left join lateral (
            select name, herald_url, color from public.faction_applications
            where faction_id = v.faction_id and status = 'approved'
            order by updated_at desc limit 1
          ) a on true
        where v.week_start = d.week_start and v.day_idx = d.day_idx and v.word_id = w.id
      ) vv
    ) c on true
  where d.week_start = v_week and d.day_idx = v_day;

  select word_id into v_my from public.poem_votes
    where week_start = v_week and day_idx = v_day and faction_id = v_fid;
  select count(*)::int into v_total from public.poem_votes
    where week_start = v_week and day_idx = v_day;

  select coalesce(jsonb_agg(jsonb_build_object('d', d.day_idx, 'line', d.line,
      'word', w.word, 'theme', w.theme) order by d.day_idx), '[]'::jsonb)
    into v_lines
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = v_week and d.resolved;

  -- строка той же строфы, с которой будет рифмоваться сегодняшняя (если уже написана)
  select jsonb_build_object('d', d.day_idx, 'line', d.line) into v_pair
  from public.poem_days d
  where d.week_start = v_week and d.resolved and d.line is not null
    and d.day_idx < v_day
    and public._poem_group(d.day_idx) = public._poem_group(v_day)
  order by d.day_idx desc limit 1;

  select jsonb_build_object('week_start', p.week_start, 'effect', p.effect, 'lines', (
      select coalesce(jsonb_agg(jsonb_build_object('d', d.day_idx, 'line', d.line,
          'word', w.word, 'theme', w.theme) order by d.day_idx), '[]'::jsonb)
      from public.poem_days d join public.poem_words w on w.id = d.winner_word
      where d.week_start = p.week_start and d.resolved))
    into v_last
  from public.poem_weeks p where p.status = 'done'
  order by p.week_start desc limit 1;

  return jsonb_build_object(
    'week_start', v_week,
    'day_idx',    v_day,
    'me',         v_fid is not null,
    'options',    coalesce(v_opts, '[]'::jsonb),
    'my_vote',    v_my,
    'total_votes', coalesce(v_total, 0),
    'lines',      coalesce(v_lines, '[]'::jsonb),
    'pair',       v_pair,
    'last',       v_last,
    'closes_s',   greatest(0, extract(epoch from ((v_today + 1)::timestamp - (now() at time zone 'utc')))::int)
  );
end$$;
revoke all on function public.poem_state() from public, anon;
grant execute on function public.poem_state() to authenticated;

-- ── Голос за слово дня (повторный голос = передумал, до конца дня UTC) ──
create or replace function public.poem_vote(p_word text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_week date := date_trunc('week', (now() at time zone 'utc'))::date;
  v_day  int  := extract(isodow from (now() at time zone 'utc'))::int - 1;
  app public.faction_applications; d public.poem_days;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;

  perform public._poem_ensure();
  select * into d from public.poem_days where week_start = v_week and day_idx = v_day;
  if not found or d.resolved then raise exception 'voting closed'; end if;
  if not (d.options ? p_word) then raise exception 'bad word'; end if;

  insert into public.poem_votes(week_start, day_idx, faction_id, word_id, voter)
    values (v_week, v_day, app.faction_id, p_word, auth.uid())
    on conflict (week_start, day_idx, faction_id)
      do update set word_id = excluded.word_id, voter = excluded.voter, created_at = now();

  return public.poem_state();
end$$;
revoke all on function public.poem_vote(text) from public, anon;
grant execute on function public.poem_vote(text) to authenticated;
