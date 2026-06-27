-- ============================================================
-- ЛИЧНЫЕ СВОДКИ СПЕЦСЛУЖБ → НЕ В ОБЩУЮ ЛЕНТУ (status='private')
--
-- БАГ: десятки персональных уведомлений («Ваш агент схвачен / казнён»,
-- контрразведка, пиратский налёт, беспорядки, выкуп, измена, возврат агента)
-- вставлялись в faction_news c owner_id=null и status='approved'. Клиент
-- показывает «Ленту сектора» по фильтру (owner_id is null AND status='approved'),
-- поэтому ВСЕ игроки читали чужие сводки спецслужб — «чей-то агент схвачен».
--
-- ФИКС: эти записи адресные (faction_id = пострадавшая фракция). Делаем их
-- ЛИЧНЫМИ (status='private', fx содержит 'private') — тогда они уходят из общей
-- ленты, но видны в кабинете своей фракции (грузится по faction_id без фильтра
-- статуса) и один раз всплывают депешей при входе (fnCheckPrivatePopup).
--
-- Реализовано ТРИГГЕРОМ before insert + бэкфилл уже утёкших строк. Не трогает
-- большие RPC (десяток функций _spy_*/_faith_*/_raid_*/_poverty), идемпотентно.
-- Выполнить в Supabase → SQL Editor один раз.
-- ============================================================

alter table public.faction_news add column if not exists fx text;

-- Маркеры (faction_name) персональных сводок: адресные уведомления одной
-- фракции, которым НЕ место в общей ленте сектора. Публичные сводки/слухи
-- (◈ СВОДКА СЕКТОРА, ⚠ СЕКТОРНЫЕ СЛУХИ, 🏆 достижения, колонизации) сюда НЕ входят.
create or replace function public._fn_is_private_marker(p_name text)
returns boolean language sql immutable as $$
  select p_name in (
    '🕵 СПЕЦСЛУЖБА',     -- агент схвачен / казнён
    '🕊 ДИПЛОМАТИЯ',     -- агент возвращён даром
    '💰 ВЫКУП',          -- предложен / уплачен выкуп за пленника
    '🕵 ИЗМЕНА',         -- пленник перевербован против вас
    '🕵 КОНТРРАЗВЕДКА',  -- ваша КР раскрыла/обезвредила вражеского агента
    '🛐 КОНТРРАЗВЕДКА',  -- КР культовой ветви (вера)
    '🏴‍☠ ПИРАТСТВО',     -- ваш караван ограблен
    '🔥 БЕСПОРЯДКИ'      -- волнения / восстание в вашей державе
  );
$$;

-- ── Триггер: персональную сводку с owner_id=null превращаем в личную ──
create or replace function public._faction_news_privatize()
returns trigger language plpgsql as $$
begin
  if NEW.owner_id is null
     and coalesce(NEW.status,'') = 'approved'
     and public._fn_is_private_marker(NEW.faction_name) then
    NEW.status := 'private';
    -- добавляем флаг 'private' в fx, не теряя уже стоящие эффекты
    if NEW.fx is null or NEW.fx = '' then
      NEW.fx := 'private';
    elsif position('private' in NEW.fx) = 0 then
      NEW.fx := NEW.fx || ',private';
    end if;
  end if;
  return NEW;
end$$;

drop trigger if exists trg_faction_news_privatize on public.faction_news;
create trigger trg_faction_news_privatize
  before insert on public.faction_news
  for each row execute function public._faction_news_privatize();

-- ── Бэкфилл: убрать уже утёкшие персональные сводки из общей ленты ──
update public.faction_news
  set status = 'private',
      fx = case when fx is null or fx = '' then 'private'
                when position('private' in fx) = 0 then fx || ',private'
                else fx end
  where owner_id is null
    and status = 'approved'
    and public._fn_is_private_marker(faction_name);
