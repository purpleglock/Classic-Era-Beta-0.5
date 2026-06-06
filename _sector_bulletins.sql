-- ============================================================
-- СВОДКИ СЕКТОРА: захват систем + появление новых фракций → в Вестник
--
-- Публичные события (в отличие от тайных «слухов») оформляются официальной
-- сводкой с названием фракции и системы. Реализовано ТРИГГЕРАМИ — не трогает
-- большие RPC, маленький и надёжный файл. Идемпотентно.
--
-- Требует: faction_news, map_systems, faction_applications, _fac_name.
-- Выполнить в Supabase → SQL Editor один раз.
-- ============================================================

-- тип записи новости: news (игрок) | rumor (слух) | bulletin (сводка)
alter table public.faction_news add column if not exists kind text default 'news';

-- ── Постер официальной сводки ──
create or replace function public._post_sector_news(p_title text, p_body text, p_color text default 'rgba(95,176,230,0.5)')
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, kind, published_at, created_at, updated_at)
    values (null, '◈ СВОДКА СЕКТОРА', coalesce(p_color,'rgba(95,176,230,0.5)'), null, null,
      p_title, null, p_body, 'approved', 'bulletin', now(), now(), now());
  -- держим не более 20 сводок
  delete from public.faction_news where owner_id is null and kind='bulletin'
    and id not in (select id from public.faction_news where owner_id is null and kind='bulletin'
      order by created_at desc limit 20);
end$$;
revoke all on function public._post_sector_news(text,text,text) from public;

-- ── 1) Захват системы (экспансия): map_systems.faction null → задан ──
create or replace function public._sector_claim_after()
returns trigger language plpgsql security definer set search_path=public as $$
declare nm text;
begin
  if NEW.faction is not null and OLD.faction is null then
    begin
      nm := coalesce(nullif(public._fac_name(NEW.faction),''), 'Одна из фракций');
      perform public._post_sector_news(
        'Экспансия: ' || nm || ' — система ' || coalesce(NEW.name,'—'),
        format('%s установила контроль над системой %s. Границы сектора сместились, наблюдатели фиксируют новый флаг над звездой.', nm, coalesce(NEW.name,'—')));
    exception when others then null;   -- сводка не должна ломать захват
    end;
  end if;
  return NEW;
end$$;
drop trigger if exists trg_sector_claim on public.map_systems;
create trigger trg_sector_claim
  after update on public.map_systems
  for each row execute function public._sector_claim_after();

-- ── 2) Появление новой фракции: status → approved ──
create or replace function public._sector_newfaction_after()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status = 'approved' and (OLD.status is distinct from 'approved') then
    begin
      perform public._post_sector_news(
        'Новое государство: ' || coalesce(NEW.name,'—'),
        format('На карте сектора заявило о себе новое государство — %s. Дипломаты пересматривают расстановку сил, торговые гильдии уже строят прогнозы.', coalesce(NEW.name,'неизвестная фракция')),
        NEW.color);
    exception when others then null;
    end;
  end if;
  return NEW;
end$$;
drop trigger if exists trg_sector_newfaction on public.faction_applications;
create trigger trg_sector_newfaction
  after update on public.faction_applications
  for each row execute function public._sector_newfaction_after();
