-- ============================================================
-- ЖУРНАЛ ДОСТУПА · антимультиакк (собственный, не вычищается как auth-логи)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- ЗАЧЕМ: системная auth.audit_log_entries чистится Supabase (там пусто),
-- поэтому IP/отпечаток входов теряются. Пишем СВОЙ журнал, который живёт
-- вечно и позволяет ловить один IP / одно устройство на несколько аккаунтов.
--
-- КТО ПИШЕТ: только Edge Function `log-access` под service_role (реальный IP
-- берётся из заголовка запроса на сервере — с клиента его не подделать).
-- Прямая запись игроку ЗАПРЕЩЕНА (RLS + revoke), как и по всей базе.
-- КТО ЧИТАЕТ: только стафф, и только через admin-RPC ниже.
-- ============================================================

create table if not exists public.access_log (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null,
  email       text,
  ip          text,
  fingerprint text,                 -- отпечаток браузера (canvas+screen+tz), с клиента
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists access_log_ip_idx   on public.access_log (ip);
create index if not exists access_log_fp_idx    on public.access_log (fingerprint);
create index if not exists access_log_uid_idx   on public.access_log (user_id);
create index if not exists access_log_time_idx  on public.access_log (created_at desc);

-- ── RLS: наглухо. service_role его обходит (Edge Function пишет им). ──
alter table public.access_log enable row level security;
revoke all on public.access_log from anon, authenticated;
-- Никаких policy для anon/authenticated не создаём: значит игрок не читает и
-- не пишет напрямую. Всё чтение — через SECURITY DEFINER функции ниже.

-- ── ПОЛНЫЙ ОБЗОР: ВСЕ зарегистрированные игроки + их IP/устройство ─────
-- Возвращает строку на КАЖДОГО пользователя (включая тех, кто ещё не заходил
-- после включения журнала — у них ip=null). Для каждого считается, СКОЛЬКО
-- РАЗНЫХ аккаунтов делят его IP и его отпечаток: ip_shared/fp_shared ≥ 2 —
-- это и есть подозрение. Сортировка — самые «горячие» сверху.
create or replace function public.admin_access_overview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;

  with last_a as (          -- последний известный доступ каждого пользователя
    select distinct on (user_id) user_id, ip, fingerprint, created_at
    from public.access_log
    order by user_id, created_at desc
  ),
  ip_n as (                 -- сколько разных аккаунтов на каждом IP
    select ip, count(distinct user_id) as n
    from public.access_log where ip is not null and ip <> '' group by ip
  ),
  fp_n as (                 -- сколько разных аккаунтов на каждом отпечатке
    select fingerprint, count(distinct user_id) as n
    from public.access_log where fingerprint is not null and fingerprint <> '' group by fingerprint
  ),
  vis as (                  -- сколько всего записей входа
    select user_id, count(*) as c from public.access_log group by user_id
  )
  select coalesce(jsonb_agg(row_to_json(t)
           order by greatest(t.ip_shared, t.fp_shared) desc, t.registered), '[]'::jsonb)
  into res
  from (
    select
      u.id                        as uid,
      u.email                     as email,
      u.created_at                as registered,
      u.last_sign_in_at           as last_login,
      l.ip                        as ip,
      l.fingerprint               as fp,
      l.created_at                as last_access,
      coalesce(ipn.n, 0)          as ip_shared,
      coalesce(fpn.n, 0)          as fp_shared,
      coalesce(v.c, 0)            as visits
    from auth.users u
    left join last_a l   on l.user_id = u.id
    left join ip_n  ipn  on ipn.ip = l.ip
    left join fp_n  fpn  on fpn.fingerprint = l.fingerprint
    left join vis   v    on v.user_id = u.id
  ) t;

  return res;
end$$;
revoke all on function public.admin_access_overview() from public;
grant execute on function public.admin_access_overview() to authenticated;

-- ── История доступа одного пользователя (для разбора конкретного дела) ─
create or replace function public.admin_access_history(p_uid uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into res
  from (
    select ip, fingerprint, user_agent, created_at
    from public.access_log where user_id = p_uid
    order by created_at desc limit 200
  ) t;
  return res;
end$$;
revoke all on function public.admin_access_history(uuid) from public;
grant execute on function public.admin_access_history(uuid) to authenticated;
