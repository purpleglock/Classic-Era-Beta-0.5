-- ================================================================
-- ADMIN NEWS AUTHORING
-- Разрешаем стаффу (superadmin/editor/moderator) создавать новости
-- от лица НПС или любой фракции игрока — для выдачи ивентов и квестов.
-- Раньше fn_insert требовал owner_id = auth.uid() И собственную одобренную
-- фракцию, поэтому админ мог только модерировать чужие новости.
--
-- Применять в Supabase SQL Editor. Идемпотентно (drop/create).
-- ================================================================

-- Визуальный эффект статьи (например 'glitch') — задаётся админом в композиторе.
alter table public.faction_news add column if not exists fx text;
-- Флаг/герб автора-НПС (URL картинки) — для карточки и шапки статьи.
alter table public.faction_news add column if not exists author_herald text;

drop policy if exists "fn_insert" on public.faction_news;

create policy "fn_insert" on public.faction_news for insert to authenticated
  with check (
    -- стафф: публикация от лица НПС (owner_id null) или любой фракции
    public.current_user_role() in ('superadmin','editor','moderator')
    -- игрок: только от своего имени и при наличии одобренной фракции
    or (
      owner_id = auth.uid()
      and exists (
        select 1 from public.faction_applications fa
        where fa.owner_id = auth.uid() and fa.status = 'approved'
      )
    )
  );

-- fn_update / fn_delete уже разрешают стаффу править/удалять любые строки
-- (см. _faction_news.sql), поэтому их менять не нужно.
-- Бан-блокировка (ban_no_insert, RESTRICTIVE) остаётся в силе поверх этой политики.

-- ────────────────────────────────────────────────────────────
-- ЗАЩИТА АДМИН-ИВЕНТОВ ОТ АВТОЧИСТКИ СВОДОК
-- Постер авто-сводок сектора (_post_sector_news из _sector_bulletins.sql)
-- держал не более 20 строк с owner_id is null и kind='bulletin' и удалял
-- остальные. Админские НПС-ивенты/квесты тоже owner_id null + kind='bulletin',
-- поэтому могли быть удалены. Отличаем их по reviewed_by (у админских он задан,
-- у авто-сводок — null) и чистим ТОЛЬКО авто-сводки.
-- Требует наличия _sector_bulletins.sql (там определён _fac_name и триггеры).
create or replace function public._post_sector_news(p_title text, p_body text, p_color text default 'rgba(95,176,230,0.5)')
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, kind, published_at, created_at, updated_at)
    values (null, '◈ СВОДКА СЕКТОРА', coalesce(p_color,'rgba(95,176,230,0.5)'), null, null,
      p_title, null, p_body, 'approved', 'bulletin', now(), now(), now());
  -- держим не более 20 АВТО-сводок; админские ивенты (reviewed_by задан) не трогаем
  delete from public.faction_news
    where owner_id is null and kind='bulletin' and reviewed_by is null
      and id not in (
        select id from public.faction_news
          where owner_id is null and kind='bulletin' and reviewed_by is null
          order by created_at desc limit 20);
end$$;
revoke all on function public._post_sector_news(text,text,text) from public;
