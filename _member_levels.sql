-- ============================================================
-- УРОВНИ УЧАСТНИКОВ САЙТА
--
-- Правда — на сервере: клиент НЕ считает опыт и не может его вписать
-- (см. memory: client-write RLS hole). Клиент только читает витрину
-- public.member_levels и рисует бейдж/карточку/досье.
--
-- Опыт складывается из пяти осей, каждая со своим потолком, чтобы одна
-- ось не съедала уровень целиком (у державы 1700 колоний на 23 фракции —
-- без потолка «игра» перебивала бы всё остальное):
--   стаж (дни с регистрации), активность (дни с заходами),
--   вклад (страницы/комментарии/новости), игра (колонии/наука/бои), ачивки.
--
-- Уровень: L = 1 + floor(sqrt(xp/25)), потолок 30. Порог следующего = 25·L².
-- ============================================================

-- ── Витрина ─────────────────────────────────────────────────
create table if not exists public.member_levels (
  user_id     uuid        primary key,
  xp          int         not null default 0,
  level       int         not null default 1,
  title       text        not null default 'Пришелец',
  parts       jsonb       not null default '{}'::jsonb,  -- разбивка опыта по осям
  days        int         not null default 0,            -- стаж на сайте, суток
  active_days int         not null default 0,
  last_seen   timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.member_levels enable row level security;

-- Витрина публична (ни почты, ни ip — только имя-уровень-опыт).
drop policy if exists ml_read_all on public.member_levels;
create policy ml_read_all on public.member_levels for select using (true);

-- Писать может ТОЛЬКО SECURITY DEFINER-пересчёт.
revoke insert, update, delete on public.member_levels from anon, authenticated;
grant  select on public.member_levels to anon, authenticated;

-- ── Титул по уровню ─────────────────────────────────────────
create or replace function public.ml_title(p_level int)
returns text language sql immutable as $$
  select case
    when p_level >= 20 then 'Вечный'
    when p_level >= 18 then 'Столп Эры'
    when p_level >= 16 then 'Архонт'
    when p_level >= 14 then 'Сенатор'
    when p_level >= 12 then 'Претор'
    when p_level >= 10 then 'Легат'
    when p_level >=  9 then 'Архивариус'
    when p_level >=  8 then 'Магистр'
    when p_level >=  7 then 'Навигатор'
    when p_level >=  6 then 'Картограф'
    when p_level >=  5 then 'Летописец'
    when p_level >=  4 then 'Хронист'
    when p_level >=  3 then 'Странник'
    when p_level >=  2 then 'Послушник'
    else 'Пришелец'
  end;
$$;

-- ── Полный пересчёт ─────────────────────────────────────────
-- Пользователей полсотни, страниц/комментариев — сотни: полный пересчёт
-- дешевле инкрементального учёта и не расходится с правдой.
create or replace function public.ml_recompute()
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  with u as (
    select au.id as user_id, lower(coalesce(au.email,'')) as email, au.created_at as reg_at
      from auth.users au
  ),
  -- заходы: ось «активность» и «последний раз в сети»
  act as (
    select user_id, count(distinct (created_at at time zone 'UTC')::date) as adays,
           max(created_at) as last_seen
      from public.access_log where user_id is not null group by user_id
  ),
  -- вики: автор = author_id (uuid), created_by-email — легаси со старых страниц
  pg as (
    select u.user_id,
           count(*) filter (where p.status = 'published') as pub,
           count(*) filter (where p.status <> 'published') as draft
      from u join public.pages p
        on p.author_id = u.user_id
        or (u.email <> '' and lower(coalesce(p.created_by,'')) = u.email)
     group by u.user_id
  ),
  cm as (
    select u.user_id, count(*) as cnt
      from u join public.comments c
        on (c.user_id = u.user_id or (u.email <> '' and lower(coalesce(c.user_email,'')) = u.email))
     where coalesce(c.is_deleted, false) = false
     group by u.user_id
  ),
  nw as (
    select owner_id as user_id, count(*) as cnt
      from public.faction_news where status = 'published' and owner_id is not null
     group by owner_id
  ),
  -- держава: владельцу — полный вес, служащему (active) — 0.4
  fac as (
    select fe.faction_id, fe.owner_id as user_id, 1.0::numeric as w
      from public.faction_economy fe where fe.owner_id is not null
    union all
    select fm.faction_id, fm.user_id, 0.4::numeric
      from public.faction_members fm
     where fm.status = 'active' and fm.user_id is not null
       and not exists (select 1 from public.faction_economy fe2
                        where fe2.faction_id = fm.faction_id and fe2.owner_id = fm.user_id)
  ),
  fstat as (
    select f.faction_id, f.user_id, f.w,
           (select count(*) from public.colonies co where co.faction_id = f.faction_id) as colonies,
           coalesce((select jsonb_array_length(fe.research) from public.faction_economy fe
                      where fe.faction_id = f.faction_id
                        and jsonb_typeof(fe.research) = 'array'), 0) as research,
           (select count(*) from public.faction_achievements fa
             where fa.faction_id = f.faction_id) as achs,
           (select count(*) from public.battles b
             where b.attacker_fid = f.faction_id or b.defender_fid = f.faction_id) as battles,
           (select count(*) from public.battles b
             where b.winner_fid = f.faction_id) as wins
      from fac f
  ),
  fagg as (
    select user_id,
           sum(w * colonies)  as colonies,
           sum(w * research)  as research,
           sum(w * achs)      as achs,
           sum(w * battles)   as battles,
           sum(w * wins)      as wins
      from fstat group by user_id
  ),
  calc as (
    select u.user_id,
           greatest(0, floor(extract(epoch from (now() - u.reg_at)) / 86400))::int as days,
           coalesce(a.adays, 0)::int as adays,
           a.last_seen,
           coalesce(p.pub, 0)::int   as pub,
           coalesce(p.draft, 0)::int as draft,
           coalesce(c.cnt, 0)::int   as comments,
           coalesce(n.cnt, 0)::int   as news,
           coalesce(g.colonies, 0)::numeric as colonies,
           coalesce(g.research, 0)::numeric as research,
           coalesce(g.achs, 0)::numeric     as achs,
           coalesce(g.battles, 0)::numeric  as battles,
           coalesce(g.wins, 0)::numeric     as wins
      from u
      left join act  a on a.user_id = u.user_id
      left join pg   p on p.user_id = u.user_id
      left join cm   c on c.user_id = u.user_id
      left join nw   n on n.user_id = u.user_id
      left join fagg g on g.user_id = u.user_id
  ),
  xp as (
    select c.*,
           least(1500, c.days  * 2)::int  as xp_tenure,
           least(1200, c.adays * 6)::int  as xp_active,
           least(3000, c.pub * 60 + c.draft * 15 + c.comments * 6 + c.news * 30)::int as xp_wiki,
           least(2500, (c.colonies * 4 + c.research * 8 + c.battles * 25 + c.wins * 25))::int as xp_game,
           least(1200, (c.achs * 12))::int as xp_ach
      from calc c
  ),
  fin as (
    select x.*, (x.xp_tenure + x.xp_active + x.xp_wiki + x.xp_game + x.xp_ach) as total
      from xp x
  ),
  lvl as (
    select f.*, least(30, 1 + floor(sqrt(f.total / 25.0)))::int as level from fin f
  )
  insert into public.member_levels
        (user_id, xp, level, title, parts, days, active_days, last_seen, updated_at)
  select l.user_id, l.total, l.level, public.ml_title(l.level),
         jsonb_build_object(
           'tenure', l.xp_tenure, 'active', l.xp_active, 'wiki', l.xp_wiki,
           'game',   l.xp_game,   'ach',    l.xp_ach,
           'pub', l.pub, 'draft', l.draft, 'comments', l.comments, 'news', l.news,
           'colonies', round(l.colonies)::int, 'research', round(l.research)::int,
           'achs', round(l.achs)::int, 'battles', round(l.battles)::int, 'wins', round(l.wins)::int,
           'next_xp', 25 * l.level * l.level,
           'prev_xp', case when l.level > 1 then 25 * (l.level-1) * (l.level-1) else 0 end
         ),
         l.days, l.adays, l.last_seen, now()
    from lvl l
  on conflict (user_id) do update set
        xp = excluded.xp, level = excluded.level, title = excluded.title,
        parts = excluded.parts, days = excluded.days, active_days = excluded.active_days,
        last_seen = excluded.last_seen, updated_at = now();

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.ml_recompute() from public, anon, authenticated;

-- ── Витрина для клиента ─────────────────────────────────────
-- Пересчитывает, если данные протухли (> 10 минут), и отдаёт всех
-- участников с именем и аватаром. Почты здесь нет (см. _author_id_privacy).
create or replace function public.ml_list()
returns table (
  user_id uuid, display_name text, avatar_url text,
  xp int, level int, title text, parts jsonb,
  days int, active_days int, last_seen timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.member_levels
                  where updated_at > now() - interval '10 minutes') then
    perform public.ml_recompute();
  end if;

  return query
    select m.user_id,
           coalesce(nullif(pr.display_name, ''), 'Участник'),
           pr.avatar_url,
           m.xp, m.level, m.title, m.parts, m.days, m.active_days, m.last_seen
      from public.member_levels m
      left join public.profiles pr on pr.user_id = m.user_id
     order by m.xp desc, m.level desc;
end $$;

grant execute on function public.ml_list() to anon, authenticated;
grant execute on function public.ml_title(int) to anon, authenticated;

-- Первый расчёт сразу, чтобы витрина не была пустой до первого захода.
select public.ml_recompute();
