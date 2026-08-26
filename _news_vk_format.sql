-- ════════════════════════════════════════════════════════════════════════
--  ВК-БЕСЕДА: ОДИН МАКЕТ НА ВСЕ СООБЩЕНИЯ
--
--  БЫЛО: беседа читалась как помойка. Часовая сводка склеивала в один
--  столбик разнородные строки: у статей игроков — «📰 «Заголовок» — кусок
--  текста», у машинных — голый заголовок со своим значком в начале, у
--  третьих — просто фраза без всякой шапки. Плюс шапка сводки ехала как
--  «Сводка сектора» с заголовком «Что было за час» (сводка НЕ секторная).
--
--  СТАЛО: тело собирается СЕКЦИЯМИ с одинаковой строкой «· Заголовок ×N
--  — выдержка». Ведущие значки у машинных заголовков срезаются (колонка
--  ровная, «◈ ◈» больше не бывает). Шапку и разделитель рисует конверт в
--  edge-функции (envelope в supabase/functions/ticket-vk/index.ts) — она же
--  теперь одинаково оформляет тикеты, заявки на вход и новости.
--
--  Зависит от: _news_vk_digest.sql (таблица-поля, крон, _vk_gist).
--  Накатывать: node tools/db_run.js _news_vk_format.sql
-- ════════════════════════════════════════════════════════════════════════

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
begin
  t0 := t1 - (greatest(5, coalesce(p_minutes, 65)) || ' minutes')::interval;

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

  with src as (
    select n.id,
           case when n.owner_id is not null then 'news'
                when n.kind = 'bulletin'     then 'bulletin'
                else 'rumor' end as k,
           -- ⚠ Ведущие значки/пунктуацию машинных заголовков срезаем: строку
           -- открывает наш маркер «· », иначе колонка рвётся на «· ◈ …».
           btrim(regexp_replace(
             regexp_replace(coalesce(nullif(n.title, ''), 'Без заголовка'),
                            '[.!?…]+', '', 'g'),
             '^[^[:alnum:]«"(]+', '')) as grp,
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
    select g.*,
           -- Порядок секций: статьи игроков → донесения → слухи.
           case k when 'news' then 1 when 'bulletin' then 2 else 3 end as sec,
           row_number() over (order by (k = 'news') desc, c desc, a0) as rn,
           count(*) over () as gn
      from g
  ), keep as (
    select * from o where rn <= 10
  ), lines as (
    -- ОДНА форма строки на все секции: «· Заголовок ×N — выдержка».
    select sec, min(rn) as ord,
           case sec when 1 then 'Новости держав'
                    when 2 then 'Донесения'
                    else 'Слухи' end as cap,
           string_agg('· ' || left(grp, 90)
                      || case when c > 1 then ' ×' || c else '' end
                      || case when c = 1 and gist is not null then ' — ' || gist else '' end,
                      E'\n' order by rn) as txt
      from keep group by sec
  )
  select string_agg(cap || E'\n' || txt, E'\n\n' order by sec, ord),
         (select max(gn) from o), (select count(*) from keep)
    into body, groups, shown
    from lines;

  body := 'Событий: ' || total
       || case when groups > shown then ' · строк ' || shown || ' из ' || groups else '' end
       || E'\n\n' || coalesce(body, '')
       ;   -- подвал со ссылкой на сайт дорисовывает конверт edge-функции

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
        'digest', true,          -- шапку «📡 СВОДКА ЗА ЧАС» рисует конверт
        'title', '',
        'excerpt', '',
        'body', body,
        'faction_name', ''
      )
    );
  exception when others then
    return jsonb_build_object('ok', false, 'why', sqlerrm, 'events', total);
  end;

  update public.faction_news set vk_notified_at = t1 where id = any(ids);

  return jsonb_build_object('ok', true, 'events', total,
                            'groups', groups, 'lines', shown, 'chars', length(body));
end$$;

revoke all on function public.news_vk_digest(int) from public;
