-- ============================================================
-- НОВОСТИ · УПОМИНАНИЯ И ОПОВЕЩЕНИЯ
--
-- 1) faction_news.mentions — массив faction_id (jsonb), кого «пингует»
--    эта запись. Заполняется из тегов [fac:FID]…[/fac] в тексте (клиент)
--    и системными событиями (см. _news_lifecycle.sql).
-- 2) news_mentions() — лента ОПОВЕЩЕНИЙ для моей фракции: все одобренные
--    новости/сводки, где моя фракция явно «пингнута» ИЛИ упомянута по имени
--    (системные сводки, чужие новости и т.п.), кроме моих собственных.
-- 3) _post_life_news() — постер «Хроники сектора» (события жизни мира) с
--    мягким лимитом хранения и поддержкой mentions.
-- 4) news_announce_ach() — публикация события «получено достижение».
--
-- Требует: faction_news (_faction_news.sql), _ec_my_fid, _fac_name,
--          faction_applications, faction_achievements (_achievements.sql).
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── 1) Колонка упоминаний ────────────────────────────────────
alter table public.faction_news add column if not exists mentions jsonb not null default '[]'::jsonb;
create index if not exists fn_mentions_idx on public.faction_news using gin (mentions);

-- ── 2) Лента оповещений моей фракции ─────────────────────────
-- Возвращает строки faction_news (тот же формат, что и обычные dbGet),
-- чтобы клиент мог открыть статью через fnOpenArticle.
create or replace function public.news_mentions(p_limit int default 40)
returns setof public.faction_news
language plpgsql stable security definer set search_path=public as $$
declare v_fid text; v_name text;
begin
  v_fid := public._ec_my_fid();   -- моя одобренная фракция (+ проверка бана)
  select a.name into v_name from public.faction_applications a
    where a.faction_id = v_fid and a.status = 'approved'
    order by a.updated_at desc limit 1;
  return query
    select n.* from public.faction_news n
    where n.status = 'approved'
      and (n.faction_id is distinct from v_fid)          -- не мои собственные новости
      and (
        n.mentions ? v_fid                               -- явный пинг (тег [fac:FID])
        or (
          v_name is not null and length(btrim(v_name)) >= 2
          and (n.title ilike '%'||v_name||'%' or n.body ilike '%'||v_name||'%')
        )
      )
    order by coalesce(n.published_at, n.created_at) desc
    limit greatest(1, least(coalesce(p_limit, 40), 100));
end$$;
revoke all on function public.news_mentions(int) from public, anon;
grant execute on function public.news_mentions(int) to authenticated;

-- ── 3) Постер «Хроники сектора» (события жизни мира) ─────────
-- Отличается от авто-сводок сектора (_post_sector_news) тем, что помечен
-- reviewed_by='system' и faction_name='◈ ХРОНИКА СЕКТОРА' — его НЕ чистит
-- авто-уборка сводок (она трогает только reviewed_by is null). Держим
-- последние 60 хроник, чтобы лента не росла бесконечно.
create or replace function public._post_life_news(
  p_title text, p_body text, p_color text default 'rgba(120,180,140,0.5)',
  p_mentions jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, kind, mentions, reviewed_by, published_at, created_at, updated_at)
    values (null, '◈ ХРОНИКА СЕКТОРА', coalesce(p_color,'rgba(120,180,140,0.5)'), null, null,
      p_title, null, p_body, 'approved', 'bulletin', coalesce(p_mentions,'[]'::jsonb), 'system',
      now(), now(), now());
  delete from public.faction_news
    where owner_id is null and kind='bulletin' and reviewed_by='system'
      and id not in (
        select id from public.faction_news
          where owner_id is null and kind='bulletin' and reviewed_by='system'
          order by created_at desc limit 60);
end$$;
revoke all on function public._post_life_news(text,text,text,jsonb) from public;

-- ── 4) Событие «получено достижение» ─────────────────────────
-- Имя ачивки знает только клиент (EC_ACH), поэтому публикуем по запросу клиента,
-- но проверяем на сервере, что вызывающий реально владеет этой ачивкой, и
-- защищаемся от повторной публикации флагом announced.
alter table public.faction_achievements add column if not exists announced boolean not null default false;

create or replace function public.news_announce_ach(p_ach_id text, p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_name text; nm text;
begin
  if public.current_user_banned() then return jsonb_build_object('ok',false); end if;
  v_fid := public._ec_my_fid();
  -- ачивка должна реально принадлежать моей фракции и ещё не быть анонсирована
  if not exists(select 1 from public.faction_achievements
       where faction_id=v_fid and ach_id=p_ach_id and announced=false) then
    return jsonb_build_object('ok',false,'skipped',true);
  end if;
  update public.faction_achievements set announced=true
    where faction_id=v_fid and ach_id=p_ach_id;
  v_name := coalesce(nullif(public._fac_name(v_fid),''),'Одна из фракций');
  nm := coalesce(nullif(btrim(p_name),''), p_ach_id);
  perform public._post_life_news(
    '🏆 Достижение: ' || v_name,
    format('%s получает достижение «%s». Хронисты сектора отмечают новую веху в истории государства.', v_name, nm),
    'rgba(224,176,74,0.5)',
    jsonb_build_array(v_fid));
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.news_announce_ach(text,text) from public, anon;
grant execute on function public.news_announce_ach(text,text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select public.news_mentions(20);
