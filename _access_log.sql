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

-- ── Отчёт: аккаунты, сидящие на одном IP ИЛИ одном отпечатке ──────────
-- Возвращает кластеры «подозрительных совпадений»: для каждого IP/отпечатка,
-- где засветилось >1 РАЗНОГО пользователя, — список этих пользователей.
create or replace function public.admin_multiacc_report()
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;

  with by_ip as (
    select 'ip'::text as kind, ip as key,
           count(distinct user_id) as accounts,
           jsonb_agg(distinct jsonb_build_object('email', email, 'uid', user_id)) as who,
           max(created_at) as last_seen
    from public.access_log
    where ip is not null and ip <> ''
    group by ip
    having count(distinct user_id) > 1
  ),
  by_fp as (
    select 'fp'::text as kind, fingerprint as key,
           count(distinct user_id) as accounts,
           jsonb_agg(distinct jsonb_build_object('email', email, 'uid', user_id)) as who,
           max(created_at) as last_seen
    from public.access_log
    where fingerprint is not null and fingerprint <> ''
    group by fingerprint
    having count(distinct user_id) > 1
  )
  select jsonb_agg(row_to_json(t) order by t.accounts desc, t.last_seen desc)
  into res
  from (select * from by_ip union all select * from by_fp) t;

  return coalesce(res, '[]'::jsonb);
end$$;
revoke all on function public.admin_multiacc_report() from public;
grant execute on function public.admin_multiacc_report() to authenticated;

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
