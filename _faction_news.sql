-- ============================================================
-- НОВОСТИ ФРАКЦИЙ — таблица, RLS, бан-блокировка.
--
-- Поток: игрок (владелец одобренной фракции) пишет новость → status='pending'
-- → администрация одобряет (status='approved', published_at) или отклоняет
-- (status='rejected', reject_reason). Одобренные видны всем на главной.
--
-- Выполнить целиком в Supabase → SQL Editor. Требует current_user_role(),
-- current_user_banned() (см. _ban_enforcement.sql), faction_applications.
-- ============================================================

create table if not exists public.faction_news (
  id            uuid primary key default gen_random_uuid(),
  faction_id    text,
  faction_name  text,
  faction_color text,                              -- rgba(...) для акцента «газеты»
  owner_id      uuid,
  owner_email   text,
  title         text,
  excerpt       text,                              -- лид/превью (если пусто — берём начало body)
  body          text,                              -- полный текст (объёмный)
  image_url     text,                              -- обложка (необязательно)
  status        text default 'pending',            -- pending | approved | rejected
  reject_reason text,
  reviewed_by   text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  published_at  timestamptz
);

create index if not exists fn_faction_idx on public.faction_news(faction_id);
create index if not exists fn_owner_idx    on public.faction_news(owner_id);
create index if not exists fn_status_idx   on public.faction_news(status);

alter table public.faction_news enable row level security;

drop policy if exists "fn_select" on public.faction_news;
drop policy if exists "fn_insert" on public.faction_news;
drop policy if exists "fn_update" on public.faction_news;
drop policy if exists "fn_delete" on public.faction_news;

-- читать: одобренные — всем; свою — автор; все — стафф
create policy "fn_select" on public.faction_news for select to public
  using (status = 'approved'
         or owner_id = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));

-- создавать: ТОЛЬКО владелец одобренной фракции (игрок), от своего имени.
-- Стафф новости не пишет — он только модерирует (см. fn_update ниже).
create policy "fn_insert" on public.faction_news for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.faction_applications fa
      where fa.owner_id = auth.uid() and fa.status = 'approved'
    )
  );

-- править: автор (свою) или стафф (для модерации статуса)
create policy "fn_update" on public.faction_news for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- удалять: автор (свою) или стафф
create policy "fn_delete" on public.faction_news for delete to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));

-- ── Бан-блокировка записи (RESTRICTIVE, объединяется по AND) ──
-- Требует public.current_user_banned() из _ban_enforcement.sql.
drop policy if exists "ban_no_insert" on public.faction_news;
drop policy if exists "ban_no_update" on public.faction_news;
drop policy if exists "ban_no_delete" on public.faction_news;
create policy "ban_no_insert" on public.faction_news as restrictive for insert to authenticated
  with check (not public.current_user_banned());
create policy "ban_no_update" on public.faction_news as restrictive for update to authenticated
  using (not public.current_user_banned()) with check (not public.current_user_banned());
create policy "ban_no_delete" on public.faction_news as restrictive for delete to authenticated
  using (not public.current_user_banned());
