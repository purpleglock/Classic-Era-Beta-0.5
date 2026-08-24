-- ════════════════════════════════════════════════════════════════════════
--  ЧАТ «ГИПЕРСВЯЗЬ»: ПОСЛЕДНИЕ 300 СООБЩЕНИЙ ЖИВУТ В БАЗЕ
--
--  ⚠️ ПОЧЕМУ. Чат был эфемерным: broadcast по вебсокету + sessionStorage.
--  Закрыл вкладку — эфир пропал; зашёл позже — «в эфире тишина», хотя люди
--  переписывались весь вечер. Разговор не склеивался.
--
--  ЧТО ЗДЕСЬ. Одна таблица-кольцо на 300 строк. Живая доставка остаётся на
--  broadcast (быстро, без круга через БД), а запись в таблицу — ради истории:
--  вошедший читает последние 300 и видит, о чём речь.
--
--  ХВОСТ РЕЖЕТ ТРИГГЕР. Не крон и не клиент: удаление привязано к самой
--  вставке, поэтому таблица физически не может распухнуть, даже если клиент
--  забудет позвать чистку. Ключ bigserial — «оставить последние 300» это
--  один id-порог, без сортировки по времени.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.chat_messages (
  id         bigserial primary key,
  author_id  uuid not null default auth.uid(),
  name       text not null,
  fac        text,
  fc         text,
  av         text,
  staff      boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_id_idx on public.chat_messages(id desc);

-- ── Кольцо на 300: после вставки сносим всё, что старше 300-й строки с конца.
--    security definer — политики на delete игроку не нужны.
create or replace function public.chat_trim() returns trigger
language plpgsql security definer set search_path = public as $$
declare cut bigint;
begin
  select id into cut from public.chat_messages order by id desc offset 300 limit 1;
  if cut is not null then delete from public.chat_messages where id <= cut; end if;
  return null;
end $$;

drop trigger if exists chat_trim_tg on public.chat_messages;
create trigger chat_trim_tg after insert on public.chat_messages
  for each statement execute function public.chat_trim();

alter table public.chat_messages enable row level security;

-- Читают все вошедшие: чат общий.
drop policy if exists "chm_sel" on public.chat_messages;
create policy "chm_sel" on public.chat_messages for select to authenticated using (true);

-- Пишут за себя: подпись в строке = тот, кто её вставил (иначе можно говорить
-- чужим именем — broadcast и так на доверии, но в истории это остаётся навсегда).
drop policy if exists "chm_ins" on public.chat_messages;
create policy "chm_ins" on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and length(body) between 1 and 500
              and public.current_user_role() in ('superadmin','editor','moderator','player'));

-- Удаляет только стафф — модерация эфира.
drop policy if exists "chm_del" on public.chat_messages;
create policy "chm_del" on public.chat_messages for delete to authenticated
  using (public.current_user_role() in ('superadmin','editor','moderator'));

grant select, insert, delete on public.chat_messages to authenticated;
grant usage, select on sequence public.chat_messages_id_seq to authenticated;
