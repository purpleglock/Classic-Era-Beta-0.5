-- ============================================================
-- ВЕСТНИК: fn_insert = стафф + владелец + служащий с правом 'news'
-- ============================================================
-- _fn_member_write.sql (09.08) пересоздал fn_insert и потерял ветку стаффа из
-- _admin_news_authoring.sql. Итог: админ/редактор не мог писать от лица НПС
-- (там owner_id null, а политика требовала owner_id = auth.uid()) → 42501
-- "new row violates row-level security policy for table faction_news".
-- Здесь обе ветки сведены в одну политику; порядок наката значения не имеет.

drop policy if exists "fn_insert" on public.faction_news;
create policy "fn_insert" on public.faction_news for insert to authenticated
  with check (
    -- стафф: от лица НПС (owner_id null) или любой фракции — ивенты и квесты
    public.current_user_role() in ('superadmin','editor','moderator')
    -- игрок: только от своего имени
    or (
      owner_id = auth.uid()
      and (
        exists (
          select 1 from public.faction_applications fa
          where fa.owner_id = auth.uid() and fa.status = 'approved'
            and (faction_news.faction_id is null or faction_news.faction_id = fa.faction_id)
        )
        or (
          'news' = any(public._fm_my_perms())
          and faction_news.faction_id is not null
          and faction_news.faction_id = public._fm_member_fid()
        )
      )
    )
  );
