-- ════════════════════════════════════════════════════════════
-- ОБНОВЛЕНИЯ ПРАВИЛ: что поменялось — в оповещения, с якорем в гайдбук.
-- Применять: node tools/db_run.js _rules_updates.sql
-- ПОРЯДОК: после _notifications.sql (метки просмотра notif_seen) и
--          _ban_enforcement.sql (current_user_role — кто вправе писать).
--
-- ЗАЧЕМ. Правила меняются каждую неделю, а узнаёт об этом только тот, кто
-- перечитывает гайдбук целиком. Игрок садится играть по вчерашним правилам и
-- узнаёт о переменах, когда что-то не сработало. Депеша тут не помощник:
-- сводки сектора живут внутри мира, а правка правил — снаружи.
--
-- ЧТО ЗДЕСЬ. Строка обновления = заголовок, текст «что поменялось» и ЯКОРЬ
-- секции гайдбука, куда прыгает читатель. Счётчик непрочитанного считается по
-- той же машине, что все прочие бейджи (_notif_since/notif_seen), — отдельной
-- ленты не заводим (см. шапку _notifications.sql).
--
-- ⚠ notif_counts НЕ перезаливается: живое тело бывает новее файла. Оригинал
-- уезжает в notif_counts__pre, на его место встаёт обёртка, добавляющая один
-- ключ. Приём тот же, что у _fm_wrap, и так же идемпотентен.
-- ════════════════════════════════════════════════════════════

create table if not exists public.rules_updates (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  title   text not null,
  body    text not null,          -- что именно поменялось, человеческим языком
  anchor  text,                   -- id секции гайдбука ('gb-defense'), куда вести
  tag     text,                   -- метка темы: «Флот», «Экономика», «Разведка»
  author  uuid
);
create index if not exists rules_updates_at_idx on public.rules_updates(at desc);

alter table public.rules_updates enable row level security;
do $rls$
begin
  -- Правила публичны: читать может кто угодно, включая незалогиненного гостя.
  if not exists(select 1 from pg_policies where schemaname='public'
                  and tablename='rules_updates' and policyname='rules_updates_read') then
    create policy rules_updates_read on public.rules_updates
      for select to authenticated, anon using (true);
  end if;
end$rls$;
-- Писать — только через RPC (security definer): прямой INSERT клиенту не нужен.
revoke insert, update, delete on public.rules_updates from authenticated, anon;

-- ── Кто вправе объявлять правки правил ──
create or replace function public._rules_can_post()
returns boolean language plpgsql stable security definer set search_path=public as $$
declare r text;
begin
  begin r := public.current_user_role();
  exception when others then r := null; end;
  return coalesce(r, '') in ('superadmin','editor','moderator');
end$$;

-- ── Лента обновлений + признак «этого вы ещё не видели» ──
create or replace function public.rules_updates_list(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ts timestamptz;
begin
  begin ts := public._notif_since('rules');
  exception when others then ts := now() - interval '1 day'; end;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'at', u.at, 'title', u.title, 'body', u.body,
      'anchor', u.anchor, 'tag', u.tag,
      'is_new', (auth.uid() is not null and u.at > ts)
    ) order by u.at desc)
    from (select * from public.rules_updates
           order by at desc limit greatest(1, least(coalesce(p_limit,30), 100))) u
  ), '[]'::jsonb);
end$$;
revoke all on function public.rules_updates_list(int) from public;
grant execute on function public.rules_updates_list(int) to authenticated, anon;

-- ── Объявить правку правил (стафф) ──
create or replace function public.rules_update_post(
  p_title text, p_body text, p_anchor text default null,
  p_tag text default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public._rules_can_post() then raise exception 'править правила может только стафф'; end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'нужен заголовок'; end if;
  if coalesce(btrim(p_body),'')  = '' then raise exception 'нужно описание: что именно поменялось'; end if;
  insert into public.rules_updates(at, title, body, anchor, tag, author)
    values(coalesce(p_at, now()), btrim(p_title), btrim(p_body),
           nullif(btrim(coalesce(p_anchor,'')),''), nullif(btrim(coalesce(p_tag,'')),''), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end$$;
revoke all on function public.rules_update_post(text,text,text,text,timestamptz) from public;
grant execute on function public.rules_update_post(text,text,text,text,timestamptz) to authenticated;

-- ── Снять ошибочное объявление (стафф) ──
create or replace function public.rules_update_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public._rules_can_post() then raise exception 'править правила может только стафф'; end if;
  delete from public.rules_updates where id = p_id;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.rules_update_delete(uuid) from public;
grant execute on function public.rules_update_delete(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- СЧЁТЧИК: канал 'rules' в общий ответ notif_counts
-- ════════════════════════════════════════════════════════════
do $wrap$
declare src text;
begin
  select p.prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='notif_counts';
  if src is null then
    raise notice 'notif_counts нет — _notifications.sql не накачен, счётчик пропущен';
    return;
  end if;
  -- Наша обёртка уже стоит? Тогда ничего не переименовываем.
  if src like '%notif_counts__pre%' then return; end if;
  drop function if exists public.notif_counts__pre();
  alter function public.notif_counts() rename to notif_counts__pre;
end$wrap$;

do $cnt$
begin
  if to_regprocedure('public.notif_counts__pre()') is null then return; end if;
  execute $fn$
    create or replace function public.notif_counts()
    returns jsonb language plpgsql stable security definer set search_path=public as $body$
    declare o jsonb; n int; ts timestamptz;
    begin
      o := coalesce(public.notif_counts__pre(), '{}'::jsonb);
      if auth.uid() is null then return o; end if;
      n := 0;
      begin
        ts := public._notif_since('rules');
        select count(*) into n from public.rules_updates u where u.at > ts;
      exception when others then n := 0; end;
      return o || jsonb_build_object('rules', least(coalesce(n,0), 99));
    end$body$;
  $fn$;
  revoke all on function public.notif_counts() from public, anon;
  grant execute on function public.notif_counts() to authenticated;
  revoke all on function public.notif_counts__pre() from public, anon;
end$cnt$;

-- ── Метка «прочитано» для нового канала ──
-- Надмножество прежнего белого списка: 'rules' добавлен к тем же каналам-'new'.
create or replace function public.notif_mark(p_chan text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return; end if;
  if p_chan is null or p_chan not in
     ('news','ticket','exch.orders','intel.incoming','press.notif','stat.ach','rules') then return; end if;
  insert into public.notif_seen(user_id, chan, seen_at)
    values (auth.uid(), p_chan, now())
  on conflict (user_id, chan) do update set seen_at = excluded.seen_at;
end$$;
revoke all on function public.notif_mark(text) from public, anon;
grant execute on function public.notif_mark(text) to authenticated;

notify pgrst, 'reload schema';
