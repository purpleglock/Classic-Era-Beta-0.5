-- ============================================================
-- ДИПЛОМАТИЯ: ОТНОШЕНИЯ (РЕСПЕКТ) + РЕАКЦИИ НА НОВОСТИ
--
-- Идея: в конце новости игрок-читатель выбирает реакцию своего государства
-- (одобряю / нейтрально / осуждаю). Реакция меняет НАКОПИТЕЛЬНЫЙ балл отношений
-- его фракции к фракции-автору (−100..+100). Баллы видны в таблице «Дипломатия».
--
-- Требует: current_user_role(), current_user_banned(), assert_not_banned()
-- (см. _ban_enforcement.sql), faction_applications, faction_news.
-- Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── 1) Направленный балл отношений (from → to) ──────────────
create table if not exists public.faction_relations (
  from_fid   text not null,
  to_fid     text not null,
  score      int  not null default 0,        -- клампится −100..+100
  updated_at timestamptz not null default now(),
  primary key (from_fid, to_fid)
);
create index if not exists fr_from_idx on public.faction_relations(from_fid);
create index if not exists fr_to_idx   on public.faction_relations(to_fid);

alter table public.faction_relations enable row level security;

drop policy if exists "fr_select" on public.faction_relations;
-- Видны ТОЛЬКО свои пары: где я — отправитель ИЛИ получатель. Стафф видит всё.
create policy "fr_select" on public.faction_relations for select to authenticated
  using (
    public.current_user_role() in ('superadmin','editor','moderator')
    or exists (select 1 from public.faction_applications fa
               where fa.owner_id = auth.uid() and fa.status = 'approved'
                 and fa.faction_id in (from_fid, to_fid))
  );
-- Прямой записи игрокам НЕ даём — только через RPC news_react (security definer).
-- (Стаффу оставим ручную правку для отладки/админки.)
drop policy if exists "fr_write" on public.faction_relations;
create policy "fr_write" on public.faction_relations for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 2) Реакции на новости (одна на пару новость×фракция) ────
create table if not exists public.news_reactions (
  id            uuid primary key default gen_random_uuid(),
  news_id       uuid not null,
  reactor_fid   text not null,
  reactor_owner uuid not null,
  stance        text not null,                -- approve | neutral | disapprove
  weight        int  not null default 0,      -- применённая дельта к баллу
  created_at    timestamptz not null default now(),
  unique (news_id, reactor_fid)
);
create index if not exists nr_news_idx  on public.news_reactions(news_id);
create index if not exists nr_owner_idx on public.news_reactions(reactor_owner);

alter table public.news_reactions enable row level security;

drop policy if exists "nr_select" on public.news_reactions;
-- Своя реакция или стафф (агрегаты для всех — позже, при необходимости).
create policy "nr_select" on public.news_reactions for select to authenticated
  using (reactor_owner = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));
-- Запись — только через RPC.
drop policy if exists "nr_write" on public.news_reactions;
create policy "nr_write" on public.news_reactions for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

-- ── 3) Кастомные опции реакций автора новости ───────────────
alter table public.faction_news add column if not exists reactions jsonb default '[]'::jsonb;

-- ── 4) RPC: поставить/сменить реакцию на новость ────────────
-- Вес считается СЕРВЕРОМ из stance (клиент его не передаёт — защита от накрутки).
create or replace function public.news_react(p_news_id uuid, p_stance text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_fid text; v_owner uuid; v_to text;
  v_old int := 0; v_new int := 0; v_score int;
begin
  perform public.assert_not_banned();

  -- фракция реактора (одобренная анкета текущего пользователя)
  select faction_id, owner_id into v_fid, v_owner
    from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if v_fid is null then raise exception 'no approved faction'; end if;

  -- фракция-автор новости
  select faction_id into v_to from public.faction_news where id = p_news_id;
  if v_to is null then raise exception 'news not found'; end if;
  if v_to = v_fid then raise exception 'cannot react to own faction news'; end if;

  -- вес по позиции
  v_new := case p_stance
    when 'approve'    then  8
    when 'neutral'    then  0
    when 'disapprove' then -8
    else null end;
  if v_new is null then raise exception 'bad stance'; end if;

  -- прежняя реакция на эту новость (для снятия её дельты)
  select weight into v_old from public.news_reactions
    where news_id = p_news_id and reactor_fid = v_fid;
  v_old := coalesce(v_old, 0);

  -- upsert реакции
  insert into public.news_reactions (news_id, reactor_fid, reactor_owner, stance, weight)
    values (p_news_id, v_fid, v_owner, p_stance, v_new)
    on conflict (news_id, reactor_fid)
    do update set stance = excluded.stance, weight = excluded.weight, created_at = now();

  -- upsert балла отношений: снять старую дельту, добавить новую, кламп
  insert into public.faction_relations (from_fid, to_fid, score, updated_at)
    values (v_fid, v_to, greatest(-100, least(100, v_new)), now())
    on conflict (from_fid, to_fid)
    do update set score = greatest(-100, least(100,
                   public.faction_relations.score - v_old + v_new)),
                  updated_at = now();

  select score into v_score from public.faction_relations
    where from_fid = v_fid and to_fid = v_to;
  return v_score;
end$$;

revoke all on function public.news_react(uuid, text) from public;
grant execute on function public.news_react(uuid, text) to authenticated;

-- ── Проверка (необязательно) ────────────────────────────────
-- select * from public.faction_relations;
-- select * from public.news_reactions order by created_at desc limit 20;
