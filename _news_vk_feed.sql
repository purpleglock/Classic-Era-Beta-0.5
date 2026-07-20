-- ════════════════════════════════════════════════════════════════════════
--  НОВОСТИ → БЕСЕДА VK. Триггер на faction_news: как только запись становится
--  approved (новость игрока, слух или сводка сектора), сервер шлёт превью
--  в Edge Function ticket-vk (mode='news'), а та — в беседу VK_NEWS_PEER_ID
--  (если секрет не задан — падает назад на VK_PEER_ID, т.е. лички).
--
--  Очистку разметки и обрезку до 5 предложений делает сама функция —
--  здесь только сырой текст. Личные послания (fx содержит 'private')
--  и повторные апдейты (vk_notified_at уже стоит) не шлются.
--
--  Требует расширение pg_net (в Supabase: Database → Extensions → pg_net).
--  После применения: задать секрет VK_NEWS_PEER_ID у функции dynamic-responder
--  (peer_id беседы = 2000000000 + chat_id; список — вызов функции с {"list":true}).
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- Колонки могли не появиться, если поздние миграции ещё не катились — добираем.
alter table public.faction_news add column if not exists fx text;
alter table public.faction_news add column if not exists kind text;
alter table public.faction_news add column if not exists vk_notified_at timestamptz;

create or replace function public._news_vk_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  -- шлём один раз: только в момент, когда запись стала approved
  if new.status is distinct from 'approved' then return new; end if;
  if new.vk_notified_at is not null then return new; end if;
  -- личное послание фракции — не в ленту и не в беседу
  if coalesce(new.fx, '') ~ '(^|,)private(,|$)' then return new; end if;

  -- тип записи как в ленте: игрок → news; системное → bulletin | rumor
  if new.owner_id is not null then v_kind := 'news';
  elsif new.kind = 'bulletin' then v_kind := 'bulletin';
  else v_kind := 'rumor';
  end if;

  new.vk_notified_at := now();

  -- fire-and-forget: pg_net кладёт запрос в очередь, транзакцию не держит
  perform net.http_post(
    url := 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/dynamic-responder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS',
      'Authorization', 'Bearer sb_publishable_f_xjq0WQcf2AUdHWjk1-XQ_BDLpsoiS'
    ),
    body := jsonb_build_object(
      'mode', 'news',
      'kind', v_kind,
      'title', coalesce(new.title, ''),
      'excerpt', coalesce(new.excerpt, ''),
      'body', left(coalesce(new.body, ''), 4000),
      'faction_name', coalesce(new.faction_name, '')
    )
  );
  return new;
exception when others then
  -- ВК-уведомление не должно ронять публикацию новости
  return new;
end;
$$;

drop trigger if exists trg_news_vk_notify on public.faction_news;
create trigger trg_news_vk_notify
  before insert or update of status on public.faction_news
  for each row execute function public._news_vk_notify();
