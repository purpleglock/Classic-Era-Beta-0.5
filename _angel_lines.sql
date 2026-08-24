-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ГОЛОС: ОНО ГОВОРИТ С ИГРОКОМ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_cause.sql и _angel_voice.sql. Надмножество
-- `_angel_slip`, `_angel_declare`, `_angel_anchor_sweep`, `_angel_clock_tick`,
-- `_angel_ascend`. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Ангел «разговаривал» глитчем: канцелярская фраза, побитая
-- случайными символами. Выглядело как машинный мусор и портило атмосферу.
-- И оно же ломало сводку: часовая рассылка группирует новости ПО ЗАГОЛОВКУ,
-- а `_angel_glitch` мангляет заголовок СЛУЧАЙНО на каждый вызов. Семь
-- распущенных досок за час дали семь РАЗНЫХ заголовков — группировка не
-- сработала, и в беседу уехала стена нечитаемого шума вместо одной строки.
--
-- То есть «атмосферный» глитч был ещё и техническим багом: любой повторяемый
-- текст, прогнанный через рандом, ломает всякую дедупликацию ниже по течению.
--
-- ПРАВИЛО. Ангел — не журнал событий, а БОСС. Он говорит короткими написанными
-- фразами, на «ты», обращаясь к ИГРОКУ, а не к штабу державы. Он знает, что
-- на него смотрят. Спокойно, неторопливо, иногда любуясь видом — это страшнее
-- любых помех.
--
-- ⚠️ ОДНА РЕПЛИКА — ОДИН РАЗ ЗА ОКНО. У каждой ситуации свой отбой (по
-- умолчанию 90 минут). Босс, повторивший фразу семь раз за час, перестаёт
-- быть боссом и снова становится журналом. Это же чинит и сводку.
--
-- ⚠️ ЗАГОЛОВКИ БОЛЬШЕ НЕ ГЛИТЧАТСЯ НИКОГДА. Помехи допустимы только там, где
-- текст одноразовый и его никто не группирует (журнал боя, повод войны).
--
-- ⚠️ Реплики лежат В ТАБЛИЦЕ, а не в коде: дописать фразу должно быть можно
-- одной строкой, без наката функции.
-- ════════════════════════════════════════════════════════════

-- ── 0. СХЕМА ────────────────────────────────────────────────
create table if not exists public.angel_line (
  id     bigserial primary key,
  sit    text not null,                    -- ситуация
  txt    text not null,
  weight int  not null default 10,         -- редкие реплики — вес поменьше
  unique (sit, txt)
);
create index if not exists angel_line_sit_idx on public.angel_line (sit);

alter table public.angel_line enable row level security;
drop policy if exists angel_line_read on public.angel_line;
create policy angel_line_read on public.angel_line for select to authenticated using (true);
revoke insert, update, delete on public.angel_line from anon, authenticated;

-- Когда он в последний раз говорил про это. Отбой держится ЗДЕСЬ, а не в
-- вызывающем коде: иначе каждый новый вызов пришлось бы помнить отдельно.
create table if not exists public.angel_said (
  sit    text primary key,
  at     timestamptz not null default now(),
  last   text
);
alter table public.angel_said enable row level security;
drop policy if exists angel_said_read on public.angel_said;
create policy angel_said_read on public.angel_said for select to authenticated using (true);
revoke insert, update, delete on public.angel_said from anon, authenticated;

-- ── 1. РЕПЛИКИ ──────────────────────────────────────────────
-- Регистр: спокойно, коротко, на «ты», без пафоса и без угроз в лоб. Оно не
-- пугает — оно разговаривает, и пугает именно это.
-- ⚠️ Вес 3 — реплики, которые прямо ломают четвёртую стену. Они должны быть
-- РЕДКИМИ: сказанная часто, такая фраза превращается из жути в шутку.
insert into public.angel_line(sit, txt, weight) values
  -- ПРИШЛО К СИСТЕМЕ
  ('arrive', 'Это небо прекрасно… Что скажешь?', 10),
  ('arrive', 'Красивая система. Я подожду — посмотри и ты.', 10),
  ('arrive', 'Ты уже видишь меня. Хорошо.', 10),
  ('arrive', 'Здесь тихо. Пока.', 10),
  ('arrive', 'Я никуда не спешу. У тебя ведь тоже есть время?', 10),
  ('arrive', 'Ты смотришь на это через стекло. Я — нет.', 3),

  -- ДОСКА ЗАВЯЗАЛАСЬ
  ('ready',  'Готов?', 10),
  ('ready',  'Ну наконец-то.', 10),
  ('ready',  'Покажи, что придумал.', 10),
  ('ready',  'Иди сюда.', 10),
  ('ready',  'Ты можешь просто закрыть вкладку. Но не закроешь.', 3),

  -- ДОСКА РАСПУЩЕНА, БОЯ НЕ ВЫШЛО  ← это и спамило в беседу
  ('stand_down', 'Не в этот раз. Отдохни.', 10),
  ('stand_down', 'Ты не пришёл. Я не в обиде.', 10),
  ('stand_down', 'Всё. Расходимся.', 10),
  ('stand_down', 'Оставим это на потом.', 10),

  -- СОРВАНА ПЕЧАТЬ
  ('hit',    'Вот так. Ещё.', 10),
  ('hit',    'Считаешь? Я тоже.', 10),
  ('hit',    'Ты научился. Поздно, но научился.', 10),
  ('hit',    'Больно. Не останавливайся.', 10),

  -- ФЛОТ БЬЁТ ПО ТЕЛУ ВПУСТУЮ
  ('nohit',  'Ты же видишь, что это не работает.', 10),
  ('nohit',  'Не сюда.', 10),
  ('nohit',  'Хорошая попытка. Честно.', 10),
  ('nohit',  'Цифры не меняются. Ты их видишь так же, как я.', 3),

  -- МИР ПЕРЕПЛАВЛЕН
  ('ate',    'Их больше нет. Ты был занят.', 10),
  ('ate',    'Они не сопротивлялись. А ты бы стал?', 10),
  ('ate',    'Одним меньше. Продолжаем.', 10),

  -- ЯКОРЬ СНЯТ
  ('anchor_lost', 'Ах вот как. Ты понял.', 10),
  ('anchor_lost', 'Умно. Правда умно.', 10),
  ('anchor_lost', 'Забирай. У меня ещё есть.', 10),
  ('anchor_lost', 'Наконец-то интересно.', 10),

  -- СНЯТ ПОСЛЕДНИЙ ЯКОРЬ
  ('anchor_last', 'Больше нечем. Теперь стреляй.', 10),

  -- УХОДИТ ЗАЛЕЧИВАТЬСЯ
  ('flee',   'Мне нужно уйти. Ненадолго.', 10),
  ('flee',   'Не радуйся.', 10),

  -- ЧАСЫ
  ('rung25', 'Четверть. Ты ещё успеваешь.', 10),
  ('rung50', 'Половина. Ты не успеваешь.', 10),
  ('rung75', 'Осталось немного. Тебе — тоже.', 10),
  ('rung90', 'Почти. Побудь со мной.', 10),
  ('ascend', 'Спасибо. Было хорошо.', 10),

  -- ФИНАЛ И ВОЗВРАЩЕНИЕ
  ('fall',   'Хорошо… хорошо. Ты молодец. Правда.', 10),
  ('rise',   'Ещё раз?', 10)
on conflict (sit, txt) do update set weight = excluded.weight;

-- ── 2. ВЫБОР РЕПЛИКИ ────────────────────────────────────────
-- По весу и НЕ ту, что сказана прошлый раз: повтор подряд убивает всё.
create or replace function public._angel_say(p_sit text)
returns text language plpgsql security definer set search_path=public as $$
declare prev text; res text;
begin
  select last into prev from public.angel_said where sit = p_sit;
  select l.txt into res
    from public.angel_line l
   where l.sit = p_sit
     and (prev is null or l.txt is distinct from prev
          or (select count(*) from public.angel_line z where z.sit = p_sit) = 1)
   order by random() * (1.0 / greatest(1, l.weight))     -- вес: чем больше, тем чаще
   limit 1;
  return res;
end$$;
revoke all on function public._angel_say(text) from public;

-- ── 3. СКАЗАТЬ ──────────────────────────────────────────────
-- Возвращает true, если реплика ушла в ленту. Молчание — штатный ответ.
create or replace function public._angel_speak(p_sit text, p_cd_min int default 90,
                                               p_fid text default null, p_tail text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare txt text; last_at timestamptz;
begin
  select at into last_at from public.angel_said where sit = p_sit;
  if last_at is not null and now() - last_at < (greatest(0, p_cd_min) || ' minutes')::interval then
    return false;                                   -- он уже это говорил. Он не попугай.
  end if;
  txt := public._angel_say(p_sit);
  if txt is null then return false; end if;

  insert into public.angel_said(sit, at, last) values (p_sit, now(), txt)
  on conflict (sit) do update set at = now(), last = excluded.last;

  begin
    -- Заголовок — САМА РЕПЛИКА, без глитча и без префикса-ведомства. Тело —
    -- сухой факт одной строкой, если он вообще нужен.
    if p_fid is null then
      perform public._post_sector_news('◈ ' || txt, coalesce(p_tail, ''), 'rgba(250,240,190,0.55)');
    else
      perform public._war_news('◈ ' || txt, coalesce(p_tail, ''), jsonb_build_array(p_fid));
    end if;
  exception when others then null;                  -- лента не критична для механики
  end;
  return true;
end$$;
revoke all on function public._angel_speak(text,int,text,text) from public;

notify pgrst, 'reload schema';
