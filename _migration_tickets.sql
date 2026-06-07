-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: система тикетов (поддержка) — всё на сайте
--  Игрок: создаёт тикет (категория, описание, скриншоты, ссылка VK) и
--    переписывается с админом в треде. Админ: читает, отвечает, закрывает.
--  Скриншоты при закрытии удаляются (клиент чистит Storage + обнуляет столбец).
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Зависимость: public.current_user_role().
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  user_email  text,
  user_name   text,
  category    text not null,
  description text not null,
  vk_link     text,
  screenshots jsonb not null default '[]'::jsonb,   -- массив публичных URL
  status      text not null default 'open',          -- open | closed
  created_at  timestamptz default now(),
  closed_at   timestamptz,
  closed_by   text
);
create index if not exists tickets_user_idx   on public.tickets(user_id);
create index if not exists tickets_status_idx on public.tickets(status);

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author_id   uuid not null default auth.uid(),
  author_name text,
  is_staff    boolean not null default false,
  body        text not null,
  created_at  timestamptz default now()
);
create index if not exists tm_ticket_idx on public.ticket_messages(ticket_id);

alter table public.tickets         enable row level security;
alter table public.ticket_messages enable row level security;

-- ── tickets ──
drop policy if exists "tk_sel" on public.tickets;
create policy "tk_sel" on public.tickets for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
drop policy if exists "tk_ins" on public.tickets;
create policy "tk_ins" on public.tickets for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "tk_upd" on public.tickets;       -- закрытие/статус — только стафф
create policy "tk_upd" on public.tickets for update to authenticated
  using (public.current_user_role() in ('superadmin','editor','moderator'));

-- ── ticket_messages ──
drop policy if exists "tm_sel" on public.ticket_messages;
create policy "tm_sel" on public.ticket_messages for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id
     and (t.user_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'))));
drop policy if exists "tm_ins" on public.ticket_messages;
create policy "tm_ins" on public.ticket_messages for insert to authenticated
  with check (author_id = auth.uid() and exists (
     select 1 from public.tickets t where t.id = ticket_id
       and (t.user_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'))));

grant select, insert, update on public.tickets         to authenticated;
grant select, insert         on public.ticket_messages to authenticated;
