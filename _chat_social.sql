-- ════════════════════════════════════════════════════════════════════════
--  ЧАТ «ГИПЕРСВЯЗЬ»: ЖИВОЙ РАЗГОВОР, А НЕ ЛЕНТА РЕПЛИК
--
--  ⚠️ ПОЧЕМУ. Эфир умел ровно одно — «сказать в пустоту». Ответить конкретному
--  человеку было нельзя (все переспрашивали «это ты кому?»), согласиться молча
--  нельзя (шло третье «+» подряд), поправить опечатку нельзя, забрать слово
--  назад нельзя. Разговор на десять человек рассыпался в кашу.
--
--  ЧТО ЗДЕСЬ, слоями:
--    1) ОТВЕТ  — chat_messages.re: id того, кому отвечают. Ветки НЕ заводим:
--       цитата одной строкой над репликой, клик по ней прыгает к оригиналу.
--       Дерево в игровом чате читать невозможно, а цитату — сразу видно.
--    2) ПРАВКА/СНОС — свои и только свои: ed (когда правил) и del (забрал
--       слово). Снос МЯГКИЙ: строка остаётся заглушкой «сообщение удалено»,
--       иначе ответы на неё повисают в воздухе, а модерация теряет улику.
--       Окно правки — 15 минут: позже переписывать сказанное нечестно.
--    3) РЕАКЦИИ — chat_reactions, по одной на (сообщение, человек, значок).
--       Право на реакцию = право читать комнату; комнату строки сверяем с
--       самим сообщением, чтобы нельзя было подложить реакцию в чужой эфир.
--    4) «ПЕЧАТАЕТ…» — chat_typing, НЕ broadcast. Broadcast-топик с именем
--       комнаты слушает всякий, кто знает ключ (а `fac:<fid>` угадывается) →
--       состав закрытой комнаты читался бы снаружи по одному тому, кто в ней
--       печатает. Здесь та же дорога, что у сообщений: строка с RLS, и
--       Realtime сам не отдаёт пакет чужому.
--
--  Требует накатанных _chat_history.sql и _chat_rooms.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1-2. Ответ, правка, мягкий снос ─────────────────────────────────────
alter table public.chat_messages add column if not exists re  bigint;
alter table public.chat_messages add column if not exists ed  timestamptz;
alter table public.chat_messages add column if not exists del boolean not null default false;

-- Кольцо на 300 сносит старое физически: ссылка на съеденную строку должна
-- гаснуть, а не ронять удаление внешним ключом.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_re_fk') then
    alter table public.chat_messages
      add constraint chat_messages_re_fk foreign key (re)
      references public.chat_messages(id) on delete set null;
  end if;
end $$;

-- Правит автор и только своё, в течение 15 минут; забрать слово — когда угодно.
-- grant update перечисляет колонки: подпись, время и комнату строки не тронуть.
drop policy if exists "chm_upd" on public.chat_messages;
create policy "chm_upd" on public.chat_messages for update to authenticated
  using (author_id = auth.uid() and public.chat_can_read(room))
  with check (author_id = auth.uid() and length(body) between 1 and 500);
grant update (body, ed, del) on public.chat_messages to authenticated;

-- Окно правки и неизменность текста после сноса — на триггере: RLS сравнивать
-- старую строку с новой не умеет.
create or replace function public.chat_edit_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.del and new.body is distinct from old.body then
    raise exception 'сообщение уже удалено';
  end if;
  if new.body is distinct from old.body then
    if now() - old.created_at > interval '15 minutes' then
      raise exception 'править можно 15 минут после отправки';
    end if;
    new.ed := now();
  end if;
  if new.del and not old.del then new.body := 'сообщение удалено'; end if;
  if old.del and not new.del then raise exception 'вернуть удалённое нельзя'; end if;
  return new;
end $$;

drop trigger if exists chat_edit_guard_tg on public.chat_messages;
create trigger chat_edit_guard_tg before update on public.chat_messages
  for each row execute function public.chat_edit_guard();

-- Ответ — только на строку из ТОЙ ЖЕ комнаты (иначе чужая цитата утекала бы
-- вместе с id в открытый эфир).
create or replace function public.chat_reply_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare rr text;
begin
  if new.re is null then return new; end if;
  select room into rr from public.chat_messages where id = new.re;
  if rr is null or rr <> new.room then new.re := null; end if;
  return new;
end $$;

drop trigger if exists chat_reply_guard_tg on public.chat_messages;
create trigger chat_reply_guard_tg before insert on public.chat_messages
  for each row execute function public.chat_reply_guard();

-- ── 3. Реакции ──────────────────────────────────────────────────────────
create table if not exists public.chat_reactions (
  msg_id    bigint not null references public.chat_messages(id) on delete cascade,
  author_id uuid   not null default auth.uid(),
  emoji     text   not null,
  room      text   not null,
  name      text   not null default '',
  created_at timestamptz not null default now(),
  primary key (msg_id, author_id, emoji)
);
create index if not exists chat_reactions_room_idx on public.chat_reactions(room, msg_id);

alter table public.chat_reactions enable row level security;

drop policy if exists "chrx_sel" on public.chat_reactions;
create policy "chrx_sel" on public.chat_reactions for select to authenticated
  using (public.chat_can_read(room));

drop policy if exists "chrx_ins" on public.chat_reactions;
create policy "chrx_ins" on public.chat_reactions for insert to authenticated
  with check (author_id = auth.uid() and public.chat_can_read(room)
              and length(emoji) between 1 and 12
              and room = (select m.room from public.chat_messages m where m.id = msg_id));

-- Снимает свою — и только свою (стафф прибирает чужие в своей комнате).
drop policy if exists "chrx_del" on public.chat_reactions;
create policy "chrx_del" on public.chat_reactions for delete to authenticated
  using (author_id = auth.uid()
         or (public.current_user_role() in ('superadmin','editor','moderator')
             and public.chat_can_read(room)));

grant select, insert, delete on public.chat_reactions to authenticated;

-- ── 4. «Печатает…» ──────────────────────────────────────────────────────
-- Одна строка на человека в комнате, обновляется не чаще раза в 3 с (клиент),
-- читается только свежая (клиент отсеивает старше 6 с).
create table if not exists public.chat_typing (
  room      text not null,
  author_id uuid not null default auth.uid(),
  name      text not null default '',
  at        timestamptz not null default now(),
  primary key (room, author_id)
);
alter table public.chat_typing enable row level security;

drop policy if exists "chty_sel" on public.chat_typing;
create policy "chty_sel" on public.chat_typing for select to authenticated
  using (public.chat_can_read(room));

drop policy if exists "chty_ins" on public.chat_typing;
create policy "chty_ins" on public.chat_typing for insert to authenticated
  with check (author_id = auth.uid() and public.chat_can_read(room));

drop policy if exists "chty_upd" on public.chat_typing;
create policy "chty_upd" on public.chat_typing for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "chty_del" on public.chat_typing;
create policy "chty_del" on public.chat_typing for delete to authenticated
  using (author_id = auth.uid());

grant select, insert, update, delete on public.chat_typing to authenticated;

-- Протухшее (минута) прибираем на вставке — крон ради этого не заводим.
create or replace function public.chat_typing_trim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.chat_typing where at < now() - interval '1 minute';
  return null;
end $$;

drop trigger if exists chat_typing_trim_tg on public.chat_typing;
create trigger chat_typing_trim_tg after insert on public.chat_typing
  for each statement execute function public.chat_typing_trim();

-- ── Живая доставка для новых таблиц ─────────────────────────────────────
-- replica identity full нужен, чтобы Realtime мог прогнать через RLS СТАРУЮ
-- строку на удалении (иначе снятая реакция не долетит ни до кого).
alter table public.chat_reactions replica identity full;
alter table public.chat_typing    replica identity full;
do $$
declare t text;
begin
  foreach t in array array['chat_reactions','chat_typing'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
