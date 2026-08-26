-- ════════════════════════════════════════════════════════════════════════
--  СТАТЬИ ВЕСТНИКА — СРАЗУ И ОТДЕЛЬНЫМ СООБЩЕНИЕМ
--
--  Часовая сводка задумывалась против МАШИННОГО потока (заграждения, слухи,
--  донесения секторов). Но в неё же затягивало и статьи игроков — то, ради
--  чего беседу и читают: выпуск Вестника приезжал строкой «· Заголовок»
--  посреди двух десятков «Атака дронов ×3».
--
--  СТАЛО: строка с owner_id (написана игроком) уходит в беседу в момент
--  одобрения, своим сообщением («📰 НОВОСТЬ · Держава» + заголовок + лид) и
--  сразу помечается vk_notified_at — в часовую сводку она уже не попадёт.
--  Машинный поток по-прежнему копится и уезжает раз в час одной сводкой.
--
--  Зависит от: _news_vk_digest.sql, _news_vk_format.sql.
--  Накатывать: node tools/db_run.js _news_vk_instant.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public._news_vk_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Мгновенно — ТОЛЬКО статьи игроков. Машинный поток копится на сводку
  -- (public.news_vk_digest), иначе беседа снова станет конвейером.
  if new.owner_id is null then return new; end if;
  if coalesce(new.status, '') <> 'approved' then return new; end if;
  if new.vk_notified_at is not null then return new; end if;
  if coalesce(new.fx, '') ~ '(^|,)private(,|$)' then return new; end if;

  new.vk_notified_at := now();   -- сводка эту строку уже не возьмёт

  perform net.http_post(
    url := 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/dynamic-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS',
      'Authorization', 'Bearer sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS'
    ),
    body := jsonb_build_object(
      'mode', 'news',
      'kind', 'news',
      'title', coalesce(new.title, ''),
      'excerpt', coalesce(new.excerpt, ''),
      'body', left(coalesce(new.body, ''), 4000),
      'faction_name', coalesce(new.faction_name, '')
    )
  );
  return new;
exception when others then
  return new;   -- беседа не должна ронять публикацию
end$$;

drop trigger if exists trg_news_vk_notify on public.faction_news;
create trigger trg_news_vk_notify
  before insert or update of status on public.faction_news
  for each row execute function public._news_vk_notify();
