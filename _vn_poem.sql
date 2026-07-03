-- ════════════════════════════════════════════════════════════════════
-- ГАЛАКТИЧЕСКАЯ ПОЭМА — мультиплеерная мини-игра новеллы (в духе DDLC).
-- Каждый день ВСЕ фракции голосуют за одно из 4 слов; в конце дня
-- слово-победитель разворачивается в строку стиха. За неделю (пн–вс)
-- складывается поэма из 7 строк. В конце недели считается доминирующая
-- тема стиха → ВСЕ державы получают баф / дебаф / ничего (разовая
-- выплата/штраф, тик economy_accrue НЕ трогаем — без клобберов).
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
  lines  text[] not null
);

-- ── Недели поэмы ──
create table if not exists public.poem_weeks (
  week_start   date primary key,            -- понедельник (UTC)
  status       text not null default 'active',   -- active | done
  effect       jsonb,                       -- итог недели: {theme,title,descr,tone}
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

-- ── Словарь (8 тем × 6 слов, у каждого 2 варианта строки) ──
insert into public.poem_words(id, word, theme, lines) values
  -- ⚔ война
  ('steel',    'сталь',     'war', array['И сталь запоёт, разрывая молчанье орбит.', 'Мы куём из рассветов сталь — и не просим прощенья.']),
  ('banner',   'знамя',     'war', array['Поднимем знамя над пеплом чужих столиц.', 'Знамя рвётся на солнечном ветре — вперёд.']),
  ('legion',   'легион',    'war', array['Легион не спит — легион считает шаги до цели.', 'И легион шагнёт в пустоту, не спросив дороги.']),
  ('siege',    'осада',     'war', array['Осада длится ровно столько, сколько бьётся сердце.', 'Города падут — но осада внутри останется.']),
  ('blade',    'клинок',    'war', array['Клинок говорит короче любых дипломатов.', 'Под ребром галактики прячется тёплый клинок.']),
  ('powder',   'порох',     'war', array['Пахнет порохом даже в стерильных отсеках.', 'Сухой порох веры — вот всё, что осталось нам.']),
  -- ☀ надежда
  ('dawn',     'рассвет',   'hope', array['Рассвет догонит любой, даже самый тёмный рейс.', 'И над мёртвой равниной всё-таки встанет рассвет.']),
  ('beacon',   'маяк',      'hope', array['Маяк на краю карты мигает: вы не одни.', 'Пока горит хоть один маяк — курс есть.']),
  ('sprout',   'росток',    'hope', array['Сквозь палубный шов пробивается тонкий росток.', 'Росток упрямее брони — спросите у руин.']),
  ('wings',    'крылья',    'hope', array['У кораблей отрастают крылья, когда их ждут.', 'Крылья не выдают по уставу — их выращивают.']),
  ('promise',  'обещание',  'hope', array['Обещание вернуться весит больше топлива.', 'Мы держим обещание, как держат высоту.']),
  ('morning',  'утро',      'hope', array['Утро приходит без пропуска даже на дальний форпост.', 'Каждое утро галактика начинает сначала.']),
  -- 🌑 тьма
  ('ash',      'пепел',     'dark', array['И пепел миров оседает на наших плечах.', 'Пепел не помнит, кем был до огня.']),
  ('abyss',    'бездна',    'dark', array['Бездна вежлива: она никогда не торопит.', 'Мы строим мосты, а бездна считает пролёты.']),
  ('shadow',   'тень',      'dark', array['Тень государства длиннее его границ.', 'У каждого маяка есть тень — и она терпеливей.']),
  ('rust',     'ржавчина',  'dark', array['Ржавчина — это просто время, победившее сталь.', 'Ржавчина тихо переписывает наши флаги.']),
  ('oblivion', 'забвение',  'dark', array['Забвение приходит без флота и берёт без боя.', 'Архивы горят молча — забвение любит тишину.']),
  ('cold',     'стужа',     'dark', array['Стужа межзвёздная лечит от громких слов.', 'Стужа заходит в дом, когда гаснут имена.']),
  -- ❤ единство
  ('hand',     'рука',      'love', array['Рука, протянутая в шлюз, стоит целого флота.', 'Держи мою руку — карту дорисуем потом.']),
  ('home',     'дом',       'love', array['Дом — это координаты, которые помнят тебя.', 'Любой причал становится домом, если ждут.']),
  ('heart',    'сердце',    'love', array['Сердце стучит по азбуке Морзе: свои, свои.', 'Реактор глохнет — сердце работает дальше.']),
  ('letter',   'письмо',    'love', array['Письмо летит дольше торпеды, но бьёт точнее.', 'В трюме сухогруза — одно письмо, и он не пустой.']),
  ('warmth',   'тепло',     'love', array['Тепло делится на всех и не убывает.', 'Мы возим тепло контрабандой через любые границы.']),
  ('name',     'имя',       'love', array['Имя, сказанное вслух, держит лучше стыковки.', 'У звёзд есть номера, у своих — имена.']),
  -- ✦ космос
  ('star',     'звезда',    'space', array['Звезда не спрашивает, кто смотрит, — она светит.', 'Каждая звезда — черновик чьего-то дома.']),
  ('orbit',    'орбита',    'space', array['Орбита — это верность, записанная математикой.', 'Мы кружим по орбите привычек и зовём это судьбой.']),
  ('nebula',   'туманность','space', array['Туманность — это пыль, которая решила стать светом.', 'В туманности прячутся недописанные миры.']),
  ('comet',    'комета',    'space', array['Комета — письмо без адреса, но с огнём.', 'Комета не возвращается — она просто обещает.']),
  ('horizon',  'горизонт',  'space', array['Горизонт событий — единственная честная граница.', 'Мы сдвигаем горизонт каждым прыжком.']),
  ('silence',  'тишина',    'space', array['Тишина космоса громче любых парадов.', 'В эфире тишина — значит, кто-то слушает.']),
  -- ◆ богатство
  ('gold',     'золото',    'wealth', array['Золото молчит на всех языках одинаково.', 'Золото тяжелее совести — проверено трюмами.']),
  ('caravan',  'караван',   'wealth', array['Караван идёт — и границы делают вид, что их нет.', 'Считай не звёзды, а огни каравана.']),
  ('vein',     'жила',      'wealth', array['Жила в астероиде бьётся, как второй пульс.', 'Кто нашёл жилу — тот переписал карту.']),
  ('fair',     'ярмарка',   'wealth', array['Ярмарка гудит — значит, войны сегодня не будет.', 'На ярмарке миров торгуют даже рассветами.']),
  ('coin',     'монета',    'wealth', array['Монета падает орлом на обеих сторонах.', 'Монета звонче клятвы — и дольше живёт.']),
  ('granary',  'амбар',     'wealth', array['Полный амбар — лучшая из всех крепостей.', 'Амбар пахнет будущим сильнее, чем арсенал.']),
  -- 📖 знание
  ('formula',  'формула',   'knowledge', array['Формула короче молитвы, но тоже сбывается.', 'Одна формула кормит целые поколения.']),
  ('archive',  'архив',     'knowledge', array['Архив — это флот, стоящий на якоре времени.', 'В архиве спят войны, которых удалось избежать.']),
  ('question', 'вопрос',    'knowledge', array['Вопрос — единственный двигатель без топлива.', 'Хороший вопрос долетает дальше зонда.']),
  ('blueprint','чертёж',    'knowledge', array['Чертёж — это мечта, пережившая линейку.', 'По одному чертежу строят и мост, и судьбу.']),
  ('lantern',  'светоч',    'knowledge', array['Светоч разума не гаснет — его гасят.', 'Передай светоч дальше — руки уже не мои.']),
  ('atlas',    'атлас',     'knowledge', array['Атлас стареет быстрее, чем растёт галактика.', 'В атласе белых пятен больше, чем чернил.']),
  -- 🌀 хаос
  ('dice',     'жребий',    'chaos', array['Жребий брошен — и катится до сих пор.', 'Жребий не ошибается: он просто не обещал.']),
  ('vortex',   'вихрь',     'chaos', array['Вихрь не читает лоций — и потому свободен.', 'Мы вышли из вихря другими — и не жалеем.']),
  ('crack',    'трещина',   'chaos', array['Трещина в куполе рисует новые созвездия.', 'Всё начинается с трещины — даже свет.']),
  ('laughter', 'смех',      'chaos', array['Смех в рубке страшнее сирены тревоги.', 'Смех — единственный груз без декларации.']),
  ('spark',    'искра',     'chaos', array['Искра не спрашивает, чей это порох.', 'Одна искра — и расписание галактики отменено.']),
  ('carousel', 'карусель',  'chaos', array['Карусель фронтов крутится без билетов.', 'Слезть с карусели можно только на ходу.'])
on conflict (id) do update set word = excluded.word, theme = excluded.theme, lines = excluded.lines;

-- ── Русские подписи тем + тон эффекта (зеркало в render.js!) ──
create or replace function public._poem_theme_ru(p text) returns text language sql immutable as $$
  select case p
    when 'war' then 'Война' when 'hope' then 'Надежда' when 'dark' then 'Тьма'
    when 'love' then 'Единство' when 'space' then 'Космос' when 'wealth' then 'Богатство'
    when 'knowledge' then 'Знание' when 'chaos' then 'Хаос' else 'Разноголосица' end
$$;

-- ── Детерминированный «рандом» недели/дня (одинаков при любом числе вызовов) ──
create or replace function public._poem_hash(p text) returns int language sql immutable as $$
  select ('x' || substr(md5(p), 1, 8))::bit(32)::int & 2147483647
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

-- ── Эффект недели по доминирующей теме (нужно ≥3 строк одной темы из 7) ──
--    Возвращает jsonb {theme,title,descr,tone} и ПРИМЕНЯЕТ разовые выплаты/штрафы.
create or replace function public._poem_apply_effect(p_week date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_theme text; v_cnt int; v_fx jsonb;
begin
  select w.theme, count(*) into v_theme, v_cnt
  from public.poem_days d join public.poem_words w on w.id = d.winner_word
  where d.week_start = p_week and d.resolved
  group by w.theme
  order by count(*) desc, md5(p_week::text || w.theme)
  limit 1;

  if v_theme is null or v_cnt < 3 then
    return jsonb_build_object('theme', 'mixed', 'tone', 'none',
      'title', 'Разноголосица',
      'descr', 'Стих вышел пёстрым — галактика пожала плечами. Эффекта нет.');
  end if;

  case v_theme
    when 'hope' then
      update public.faction_economy set gc = gc + least(15000, greatest(500, round(gc * 0.02)));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Прилив надежды',
        'descr', 'Казна каждой державы выросла на 2% (от 500 до 15 000 ГС).');
    when 'wealth' then
      update public.faction_economy set gc = gc + 3000;
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Золотая неделя',
        'descr', 'Каждая держава получила 3 000 ГС.');
    when 'knowledge' then
      update public.faction_economy set science = science + 250;
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Век просвещения',
        'descr', 'Каждая держава получила 250 очков науки.');
    when 'love' then
      update public.faction_economy set tnp = tnp + 250;
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Узы единства',
        'descr', 'Каждая держава получила 250 товаров.');
    when 'space' then
      update public.faction_economy set gc = gc + 1000, science = science + 100;
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Зов горизонта',
        'descr', 'Каждая держава получила 1 000 ГС и 100 очков науки.');
    when 'war' then
      update public.faction_economy set gc = greatest(0, gc - least(10000, greatest(300, round(gc * 0.015))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Мобилизация',
        'descr', 'Военные приготовления съели 1.5% казны каждой державы (от 300 до 10 000 ГС).');
    when 'dark' then
      update public.faction_economy set gc = greatest(0, gc - least(20000, greatest(500, round(gc * 0.025))));
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'bad', 'title', 'Тень над сектором',
        'descr', 'Упадок духа: −2.5% казны каждой державы (от 500 до 20 000 ГС).');
    when 'chaos' then
      update public.faction_economy
        set gc = greatest(0, gc - 1000 + public._poem_hash(p_week::text || faction_id) % 4001);
      v_fx := jsonb_build_object('theme', v_theme, 'tone', 'good', 'title', 'Колесо хаоса',
        'descr', 'Каждой державе выпал свой жребий: от −1 000 до +3 000 ГС.');
    else
      v_fx := jsonb_build_object('theme', 'mixed', 'tone', 'none', 'title', 'Разноголосица',
        'descr', 'Эффекта нет.');
  end case;
  return v_fx;
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

  -- резолв всех прошедших дней: победитель по голосам, без голосов — детерминированный
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
      v_line := v_lines[1 + public._poem_hash(d.week_start::text || d.day_idx || v_winner) % array_length(v_lines, 1)];
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
  v_fid text; v_opts jsonb; v_my text; v_lines jsonb; v_last jsonb; v_total int;
begin
  perform public._poem_ensure();
  select faction_id into v_fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;

  -- варианты сегодняшнего слова + живые счётчики голосов + ФЛАГИ проголосовавших держав
  select jsonb_agg(jsonb_build_object(
      'id', w.id, 'word', w.word, 'theme', w.theme,
      'preview', w.lines[1 + public._poem_hash(v_week::text || v_day || w.id) % array_length(w.lines, 1)],
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
