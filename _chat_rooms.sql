-- ════════════════════════════════════════════════════════════════════════
--  ЧАТ: КОМНАТЫ И ЗАКРЫТЫЙ ЭФИР
--
--  ⚠️ ГЛАВНОЕ ПРО СЕКРЕТНОСТЬ. Раньше чат был ОДИН и жил на публичном
--  broadcast-канале: имя канала знал клиент, а значит — любой, кто открыл
--  консоль. Для державных переговоров это негодно: сообщение нельзя просто
--  «не показывать» — его нельзя ДОСТАВИТЬ чужому.
--
--  Поэтому закрыт КАЖДЫЙ уровень, а не экран:
--    1) ИСТОРИЯ — RLS на public.chat_messages: строка комнаты видна только
--       тому, кто состоит в её субъекте. Прямой запрос к REST у чужого
--       вернёт пусто.
--    2) ЖИВОЙ ЭФИР — не broadcast, а подписка на ВСТАВКУ в chat_messages
--       (postgres_changes). Realtime прогоняет строку через RLS каждого
--       подписчика, поэтому чужой не получает пакет вовсе. Broadcast для
--       закрытых комнат не годится принципиально: канал с известным именем
--       слушает кто угодно, а имя знает клиент.
--    3) СОЗДАНИЕ — комнату заводит только тот, кто состоит в субъекте
--       (chat_room_create), а список своих комнат считает сервер
--       (chat_my_rooms): клиент не перечисляет чужие ключи и не угадывает их.
--
--  ⚠️ ЧЕГО ЗДЕСЬ НЕТ — СКВОЗНОГО ШИФРА (E2E). Он потребовал бы раздачи
--  ключей между игроками, и тогда: вошедший позже не прочтёт историю (ключа
--  у него нет), потеря ключа = потеря переписки, модерация невозможна вовсе.
--  Здесь модель другая: шифрование канала (TLS/WSS) + проверка права на
--  сервере. Кто не в державе — не получает ни байта.
--
--  СТАФФ ЧУЖИЕ КОМНАТЫ НЕ ЧИТАЕТ. Обычно админ у нас видит всё, но «своя
--  секретность у каждой державы» этого не терпит: право читать даёт только
--  членство. Публичные комнаты (общая, рыбалка) стаффу видны как всем.
--
--  СУБЪЕКТЫ КОМНАТ (scope):
--    global  — общий чат (все вошедшие)
--    fishing — рыбалка (все вошедшие): своя заводь, чтобы не топить общий
--    fac     — держава: владелец + активный состав (faction_members)
--    un      — альянс/конфедерация (diplo_unions + diplo_members)
--    su      — уния держав (state_unions: ведущий + партнёр)
--  Зависимости: _ec_my_fid_opt(), current_user_role(), current_user_banned().
--  Требует накатанного _chat_history.sql.
-- ════════════════════════════════════════════════════════════════════════

-- ── Комната как строка: базовые (общая, рыбалка, чат державы) заводятся
--    сами, дополнительные создаёт игрок внутри СВОЕГО субъекта.
create table if not exists public.chat_rooms (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null check (scope in ('global','fishing','fac','un','su')),
  subj       text not null default '',      -- fid державы / id унии / '' у публичных
  name       text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists chat_rooms_subj_idx on public.chat_rooms(scope, subj);

-- Ключ комнаты в сообщениях: 'global' | 'fishing' | 'fac:<fid>' | 'un:<uuid>'
-- | 'su:<uuid>' | 'r:<uuid>' (дополнительная комната из chat_rooms).
alter table public.chat_messages add column if not exists room text not null default 'global';
create index if not exists chat_messages_room_idx on public.chat_messages(room, id desc);

-- ── Право на субъект ────────────────────────────────────────────────────
create or replace function public.chat_can_subj(p_scope text, p_subj text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare me text;
begin
  if auth.uid() is null or public.current_user_banned() then return false; end if;
  if public.current_user_role() not in ('superadmin','editor','moderator','player') then return false; end if;
  if p_scope in ('global','fishing') then return true; end if;

  me := public._ec_my_fid_opt();            -- моя держава: владелец или служащий
  if me is null then return false; end if;  -- внефракционный дальше не проходит

  if p_scope = 'fac' then return me = p_subj; end if;

  if p_scope = 'un' then
    return exists (select 1 from public.diplo_unions u
                    where u.id::text = p_subj and u.status = 'approved'
                      and (u.leader_fid = me
                        or exists (select 1 from public.diplo_members m
                                    where m.union_id = u.id and m.fid = me)));
  end if;

  if p_scope = 'su' then
    return exists (select 1 from public.state_unions s
                    where s.id::text = p_subj and s.status = 'active'
                      and me in (s.lead_fid, s.partner_fid));
  end if;
  return false;
end $$;

-- ── Право на комнату по её ключу ────────────────────────────────────────
create or replace function public.chat_can_read(p_room text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare sc text; sj text; r record;
begin
  if p_room is null then return false; end if;
  if p_room in ('global','fishing') then return public.chat_can_subj(p_room, ''); end if;
  sc := split_part(p_room, ':', 1);
  sj := substr(p_room, length(sc) + 2);
  if sc = 'r' then                                   -- дополнительная комната
    select scope, subj into r from public.chat_rooms where id::text = sj;
    if not found then return false; end if;
    return public.chat_can_subj(r.scope, r.subj);
  end if;
  if sc in ('fac','un','su') then return public.chat_can_subj(sc, sj); end if;
  return false;
end $$;

-- ── История: видит и пишет только состав комнаты ────────────────────────
drop policy if exists "chm_sel" on public.chat_messages;
create policy "chm_sel" on public.chat_messages for select to authenticated
  using (public.chat_can_read(room));

drop policy if exists "chm_ins" on public.chat_messages;
create policy "chm_ins" on public.chat_messages for insert to authenticated
  with check (author_id = auth.uid() and length(body) between 1 and 500
              and public.chat_can_read(room));

-- Прибирает эфир стафф — но только там, куда сам вхож.
drop policy if exists "chm_del" on public.chat_messages;
create policy "chm_del" on public.chat_messages for delete to authenticated
  using (public.current_user_role() in ('superadmin','editor','moderator')
         and public.chat_can_read(room));

-- ── Кольцо на 300 — теперь В КАЖДОЙ комнате своё ────────────────────────
create or replace function public.chat_trim() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; cut bigint;
begin
  for r in select distinct room from new_rows loop
    select id into cut from public.chat_messages
      where room = r.room order by id desc offset 300 limit 1;
    if cut is not null then delete from public.chat_messages where room = r.room and id <= cut; end if;
  end loop;
  return null;
end $$;

drop trigger if exists chat_trim_tg on public.chat_messages;
create trigger chat_trim_tg after insert on public.chat_messages
  referencing new table as new_rows
  for each statement execute function public.chat_trim();

-- ── Комнаты: читать свои, заводить в своём субъекте ─────────────────────
alter table public.chat_rooms enable row level security;
drop policy if exists "chr_sel" on public.chat_rooms;
create policy "chr_sel" on public.chat_rooms for select to authenticated
  using (public.chat_can_subj(scope, subj));
grant select on public.chat_rooms to authenticated;

-- Список МОИХ комнат считает сервер: клиент не перебирает чужие ключи.
create or replace function public.chat_my_rooms()
returns table(room text, scope text, subj text, name text, subtitle text)
language plpgsql stable security definer set search_path = public as $$
declare me text;
begin
  if auth.uid() is null or public.current_user_banned() then return; end if;
  if public.current_user_role() not in ('superadmin','editor','moderator','player') then return; end if;

  room := 'global';  scope := 'global';  subj := ''; name := 'Общий';   subtitle := 'все, кто в игре'; return next;
  room := 'fishing'; scope := 'fishing'; subj := ''; name := 'Рыбалка'; subtitle := 'у воды';          return next;

  me := public._ec_my_fid_opt();
  if me is null then return; end if;

  for room, scope, subj, name, subtitle in
    select 'fac:' || me, 'fac', me, coalesce(f.name, 'Держава'), 'только состав державы'
      from public.faction_applications f
     where f.faction_id = me and f.status = 'approved' limit 1
  loop return next; end loop;

  for room, scope, subj, name, subtitle in
    select 'un:' || u.id::text, 'un', u.id::text, u.name, 'союз держав'
      from public.diplo_unions u
     where u.status = 'approved'
       and (u.leader_fid = me
         or exists (select 1 from public.diplo_members m where m.union_id = u.id and m.fid = me))
  loop return next; end loop;

  for room, scope, subj, name, subtitle in
    select 'su:' || s.id::text, 'su', s.id::text,
           coalesce(nullif(fl.name,''), s.lead_fid) || ' + ' || coalesce(nullif(fp.name,''), s.partner_fid),
           'обе стороны унии'
      from public.state_unions s
      left join public.faction_applications fl on fl.faction_id = s.lead_fid    and fl.status='approved'
      left join public.faction_applications fp on fp.faction_id = s.partner_fid and fp.status='approved'
     where s.status = 'active' and me in (s.lead_fid, s.partner_fid)
  loop return next; end loop;

  for room, scope, subj, name, subtitle in
    select 'r:' || c.id::text, c.scope, c.subj, c.name,
           case c.scope when 'fac' then 'комната державы' when 'un' then 'комната союза'
                        when 'su'  then 'комната унии'    else 'общая комната' end
      from public.chat_rooms c
     where public.chat_can_subj(c.scope, c.subj)
     order by c.created_at
  loop return next; end loop;
end $$;

-- Завести комнату можно только внутри субъекта, где ты состоишь.
create or replace function public.chat_room_create(p_scope text, p_subj text, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare nm text; nid uuid;
begin
  if not public.chat_can_subj(p_scope, coalesce(p_subj,'')) then
    raise exception 'нет права заводить комнату в этом субъекте';
  end if;
  if p_scope in ('global','fishing') and public.current_user_role() not in ('superadmin','editor') then
    raise exception 'общие комнаты заводит только администрация';
  end if;
  nm := btrim(coalesce(p_name,''));
  if length(nm) < 2 or length(nm) > 40 then raise exception 'название: от 2 до 40 знаков'; end if;
  if (select count(*) from public.chat_rooms where scope = p_scope and subj = coalesce(p_subj,'')) >= 8 then
    raise exception 'на субъект не больше 8 своих комнат';
  end if;
  insert into public.chat_rooms(scope, subj, name) values (p_scope, coalesce(p_subj,''), nm) returning id into nid;
  return 'r:' || nid::text;
end $$;

-- Снести свою комнату может тот, кто её завёл (вместе с её эфиром).
create or replace function public.chat_room_delete(p_room text)
returns void language plpgsql security definer set search_path = public as $$
declare rid uuid; r record;
begin
  if p_room !~ '^r:' then raise exception 'базовую комнату снести нельзя'; end if;
  rid := substr(p_room, 3)::uuid;
  select * into r from public.chat_rooms where id = rid;
  if not found then return; end if;
  if not public.chat_can_subj(r.scope, r.subj) then raise exception 'чужая комната'; end if;
  if r.created_by <> auth.uid() and public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'снести может только тот, кто завёл';
  end if;
  delete from public.chat_messages where room = p_room;
  delete from public.chat_rooms where id = rid;
end $$;

grant execute on function public.chat_my_rooms()                    to authenticated;
grant execute on function public.chat_room_create(text, text, text) to authenticated;
grant execute on function public.chat_room_delete(text)             to authenticated;
grant execute on function public.chat_can_read(text)                to authenticated;

-- ── ЖИВОЙ ЭФИР: доставка через саму таблицу ────────────────────────────
-- Раньше сообщение летело broadcast'ом по каналу с известным именем: кто знал
-- имя — тот и слушал. Теперь живая строка приходит подпиской на ВСТАВКУ в
-- chat_messages (postgres_changes), а Realtime перед отправкой пакета
-- прогоняет строку через RLS подписчика — ту же chat_can_read. Не член
-- державы не получает пакет вовсе; перехватывать нечего.
alter table public.chat_messages replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'chat_messages')
  then alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
