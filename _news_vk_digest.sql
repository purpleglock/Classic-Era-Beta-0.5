-- ════════════════════════════════════════════════════════════════════════
--  НОВОСТИ → ВК: ЧАСОВАЯ СВОДКА ВМЕСТО КОНВЕЙЕРА
--
--  БЫЛО: триггер trg_news_vk_notify слал в беседу ОТДЕЛЬНОЕ СООБЩЕНИЕ НА
--  КАЖДУЮ строку faction_news. Любой машинный поток (заграждения, слухи,
--  сводки секторов) превращал беседу в ленту одинаковых депеш — по две
--  штуки на событие («Атака дронов: Изнанка» + «Дроны сработали: Изнанка»)
--  каждые пять минут.
--
--  СТАЛО: строки копятся, раз в час крон собирает их в ОДНО сообщение:
--  заголовок + короткие выдержки, повторы схлопнуты в «×N». Отправленное
--  помечается vk_notified_at — дважды одно и то же не уедет.
--
--  Порядок в сводке: сперва статьи игроков (их пишут руками — они и есть
--  новости), потом машинный поток по частоте. Больше 10 строк не шлём:
--  беседа — анонс, а не лента.
--
--  ⚠ Edge-функция (dynamic-responder, mode='news') склеивает переносы строк
--  и режет тело до 700 символов / 5 предложений. Поэтому сводка собирается
--  БЕЗ точек на концах строк (иначе старая функция покажет только пять
--  первых). Если задеплоишь свежий index.ts с веткой digest — те же данные
--  приедут в столбик и целиком.
--
--  Накатывать: node tools/db_run.js _news_vk_digest.sql
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

alter table public.faction_news add column if not exists fx text;
alter table public.faction_news add column if not exists kind text;
alter table public.faction_news add column if not exists vk_notified_at timestamptz;

-- ── 1) Построчная отправка снята ────────────────────────────────────────
drop trigger if exists trg_news_vk_notify on public.faction_news;

-- Функцию оставляем пустой: если старый _news_vk_feed.sql когда-нибудь
-- накатят поверх, триггер вернётся, но конвейера уже не заведёт.
create or replace function public._news_vk_notify()
returns trigger language plpgsql
set search_path = public
as $$
begin
  -- Отправку в ВК делает public.news_vk_digest() раз в час.
  return new;
end$$;

-- ── 2) Короткая выдержка: ПЕРВАЯ фраза тела, без разметки и без точки ────
-- Точка в конце строки для edge-функции — граница предложения, а их она
-- считает и обрезает на пятой. Поэтому выдержка отдаётся без неё.
create or replace function public._vk_gist(p_text text, p_len int default 120)
returns text language sql immutable as $$
  -- ⚠️ Порядок важен: сперва ТЕГИ, потом голые ссылки. Наоборот нельзя —
  -- в [fac:id|https://…webp]Имя[/fac] шаблон ссылки съедает и закрывающую
  -- скобку, после чего тег уже не разобрать и в выдержку лезет «[fac:fac_…|».
  with a as (
    select regexp_replace(                                   -- 8) пробелы в один
             regexp_replace(                                 -- 7) висячая скобка в хвосте
               regexp_replace(                               -- 6) ##, >, маркеры списка
                 regexp_replace(                             -- 5) **жирный**, __, `код`
                   regexp_replace(                           -- 4) голые ссылки
                     regexp_replace(                         -- 3) что осталось в скобках
                       regexp_replace(                       -- 2) прочие теги и закрывашки
                         regexp_replace(coalesce(p_text, ''),-- 1) [fac:id|арт]Имя[/fac] → Имя
                           '\[fac:[^\]]*\]([^\[]*)\[/fac\]', '\1', 'g'),
                         '\[/?[a-zA-Zа-яА-Я]+(?::[^\]]*)?\]', ' ', 'g'),
                       '\[[^\]]{0,200}\]', ' ', 'g'),
                     'https?://\S+', ' ', 'g'),
                   '(\*\*|__|`)', '', 'g'),
                 '(^|\s)(#{1,6}|>|[-*+])\s+', ' ', 'g'),
               '\[[^\]]*$', ' ', 'g'),
             '\s+', ' ', 'g') as s
  ), b as (
    select btrim(coalesce(substring(s from '^(.{12,}?[.!?…])\s'), s)) as s from a
  )
  select nullif(btrim(regexp_replace(
           case when length(s) <= p_len then s
                else regexp_replace(left(s, p_len), '\S*$', '') end,
           '[\s.!?…,;:—-]+$', '')), '')
    from b;
$$;

-- ── 3) Сама сводка ──────────────────────────────────────────────────────
create or replace function public.news_vk_digest(p_minutes int default 65)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t1 timestamptz := now();
  t0 timestamptz;
  ids uuid[];
  total int := 0;
  groups int := 0;
  shown int := 0;
  body text;
  head text;
begin
  t0 := t1 - (greatest(5, coalesce(p_minutes, 65)) || ' minutes')::interval;

  -- 3.1 что накопилось и ещё не уехало
  select array_agg(n.id), count(*)
    into ids, total
    from public.faction_news n
   where coalesce(n.status, '') = 'approved'
     and n.vk_notified_at is null
     and coalesce(n.fx, '') !~ '(^|,)private(,|$)'
     and coalesce(n.published_at, n.created_at) between t0 and t1;

  if coalesce(total, 0) = 0 then
    return jsonb_build_object('ok', true, 'sent', 0, 'why', 'за час ничего');
  end if;

  -- 3.2 схлопываем повторы по заголовку и собираем строки
  with src as (
    select n.id,
           case when n.owner_id is not null then 'news'
                when n.kind = 'bulletin'     then 'bulletin'
                else 'rumor' end as k,
           btrim(regexp_replace(coalesce(nullif(n.title, ''), 'Без заголовка'),
                                '[.!?…]+', '', 'g')) as grp,
           public._vk_gist(coalesce(nullif(n.excerpt, ''), n.body),
                           case when n.owner_id is not null then 160 else 110 end) as gist,
           coalesce(n.published_at, n.created_at) as at
      from public.faction_news n
     where n.id = any(ids)
  ), g as (
    select k, grp, count(*) as c, min(at) as a0,
           (array_agg(gist order by at))[1] as gist
      from src group by k, grp
  ), o as (
    select g.*, row_number() over (order by (k = 'news') desc, c desc, a0) as rn,
           count(*) over () as gn
      from g
  )
  -- ⚠️ Свой значок машинной строке не лепим: заголовки событий почти всегда
  -- начинаются со своего (🏆, 🜨, 💥, ◈) — вышло бы «◈ ◈ ПОПАДАНИЕ».
  select string_agg(
           case when k = 'news' then '📰 «' || left(grp, 90) || '»'
                else case when grp ~ '^[[:alnum:]]' then '· ' else '' end
                     || left(grp, 90) end
           || case when c > 1 then ' ×' || c else '' end
           || case when c = 1 and gist is not null then ' — ' || gist else '' end,
           E'\n' order by rn),
         max(gn), count(*)
    into body, groups, shown
    from o where rn <= 10;

  head := 'За час · событий: ' || total
       || case when groups > shown then ' · показаны ' || shown || ' из ' || groups else '' end;
  body := head || E'\n' || coalesce(body, '');
  if groups > shown then
    body := body || E'\n…остальное — в ленте на сайте';
  end if;

  -- 3.3 одно сообщение в беседу (fire-and-forget, транзакцию не держит)
  begin
    perform net.http_post(
      url := 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/dynamic-responder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS',
        'Authorization', 'Bearer sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS'
      ),
      body := jsonb_build_object(
        'mode', 'news',
        'kind', 'bulletin',
        'digest', true,                      -- для новой версии edge-функции
        'title', 'Что было за час',
        'excerpt', '',
        'body', body,
        'faction_name', ''
      )
    );
  exception when others then
    -- беседа недоступна — строки НЕ помечаем, уедут со следующей сводкой
    return jsonb_build_object('ok', false, 'why', sqlerrm, 'events', total);
  end;

  update public.faction_news set vk_notified_at = t1 where id = any(ids);

  return jsonb_build_object('ok', true, 'events', total,
                            'groups', groups, 'lines', shown, 'chars', length(body));
end$$;

revoke all on function public.news_vk_digest(int) from public;

-- ── 4) Крон: раз в час, в :00 ───────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      if exists (select 1 from cron.job where jobname = 'news-vk-digest') then
        perform cron.unschedule('news-vk-digest');
      end if;
      perform cron.schedule('news-vk-digest', '0 * * * *',
                            'select public.news_vk_digest();');
      raise notice 'pg_cron: news-vk-digest запланирован (раз в час, в :00)';
    exception when others then
      raise notice 'pg_cron для сводки настроить не удалось (%)', sqlerrm;
    end;
  else
    raise notice 'pg_cron недоступен — сводку звать вручную: select public.news_vk_digest();';
  end if;
end$$;

-- ── 5) Хвост: всё, что накопилось ДО наката, в беседу не поедет ─────────
-- Иначе первая же сводка вывалит весь архив.
update public.faction_news
   set vk_notified_at = now()
 where vk_notified_at is null
   and coalesce(published_at, created_at) < now() - interval '65 minutes';
