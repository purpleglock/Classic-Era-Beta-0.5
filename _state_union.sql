-- ============================================================
-- УНИЯ ГОСУДАРСТВ — два игрока правят одной державой
-- Применять в Supabase → SQL Editor. Идемпотентно.
-- ПОРЯДОК: строго ПОСЛЕ _security_money.sql (переопределяет _ec_my_fid)
-- и ПОСЛЕ _unit_publish.sql (переопределяет _ec_my_fid_opt).
--
-- Механика: держава A предлагает унию державе B. B соглашается —
-- все игровые активы B (колонии, постройки, войска, системы, казна,
-- ресурсы, исследования) переливаются на fid A («ведущий» fid),
-- а _ec_my_fid()/_ec_my_fid_opt() ОБОИХ игроков с этого момента
-- возвращают fid A. Весь остальной сервер (экономика, войска, войны,
-- шпионаж) автоматически видит их как ОДНО государство: общий бюджет,
-- общие колонии, общие ВС. Профили/флаги обеих фракций остаются.
-- Расторжение возможно, но активы остаются у ведущего (предупреждаем в UI).
-- ============================================================

create table if not exists public.state_unions (
  id uuid primary key default gen_random_uuid(),
  lead_fid    text not null,   -- инициатор; общие активы живут на этом fid
  partner_fid text not null,
  status text not null default 'pending' check (status in ('pending','active','declined','dissolved')),
  created_at timestamptz default now(),
  sealed_at  timestamptz
);
create index if not exists su_lead_idx    on public.state_unions(lead_fid, status);
create index if not exists su_partner_idx on public.state_unions(partner_fid, status);

alter table public.state_unions enable row level security;
drop policy if exists "su_sel" on public.state_unions;
create policy "su_sel" on public.state_unions for select to authenticated using (true);
-- запись только через SECURITY DEFINER RPC (DML для клиентов не выдаём)

-- ── «Сырой» fid игрока (без учёта унии) ─────────────────────
create or replace function public._su_raw_fid()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
$$;

-- ── Ведущий fid активной унии для данного fid (или null) ────
create or replace function public._su_lead_of(p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select lead_fid from public.state_unions
    where status='active' and (lead_fid=p_fid or partner_fid=p_fid)
    order by sealed_at desc limit 1
$$;

-- ── ПЕРЕОПРЕДЕЛЕНИЕ: _ec_my_fid учитывает унию ──────────────
-- (тело = оригинал из _security_money.sql + маппинг через state_unions)
create or replace function public._ec_my_fid()
returns text language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select faction_id into fid from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1;
  if fid is null then raise exception 'no approved faction'; end if;
  return coalesce(public._su_lead_of(fid), fid);
end$$;

create or replace function public._ec_my_fid_opt()
returns text language sql stable security definer set search_path=public as $$
  select coalesce(public._su_lead_of(f.faction_id), f.faction_id)
  from (select faction_id from public.faction_applications
          where owner_id = auth.uid() and status = 'approved'
          order by updated_at desc limit 1) f
$$;

-- ── Слияние активов партнёра в ведущий fid ──────────────────
-- Обобщённый проход: все таблицы public с текстовой колонкой faction_id
-- перекидываются partner→lead (кроме справочников/профилей). Отдельно:
-- faction_economy (казна+ресурсы+исследования суммируются) и map_systems.faction.
create or replace function public._su_merge_assets(p_lead text, p_partner text)
returns void language plpgsql security definer set search_path=public as $$
declare r record; t text;
begin
  -- 1) Казна/ресурсы/исследования: партнёр вливается в ведущего
  begin
    update public.faction_economy le set
      gc = coalesce(le.gc,0) + coalesce(pe.gc,0),
      resources = (
        select coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb) from (
          select key as k, sum(value::numeric) as v from (
            select * from jsonb_each_text(coalesce(le.resources,'{}'::jsonb))
            union all
            select * from jsonb_each_text(coalesce(pe.resources,'{}'::jsonb))
          ) x group by key
        ) s
      ),
      research = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from (
          select jsonb_array_elements(coalesce(le.research,'[]'::jsonb)) e
          union all
          select jsonb_array_elements(coalesce(pe.research,'[]'::jsonb))
        ) u
      )
    from public.faction_economy pe
    where le.faction_id = p_lead and pe.faction_id = p_partner;
    -- партнёрскую казну обнуляем (строка остаётся ради целостности профиля)
    update public.faction_economy set gc = 0, resources = '{}'::jsonb
      where faction_id = p_partner;
  exception when others then raise notice 'su merge economy: %', sqlerrm; end;

  -- 2) Системы на карте: территория партнёра переходит под ведущего
  begin
    update public.map_systems set faction = p_lead where faction = p_partner;
  exception when others then raise notice 'su merge systems: %', sqlerrm; end;

  -- 3) Обобщённо: всё, что помечено faction_id (колонии, постройки,
  --    проекты, юниты, производство, оборона, агенты, дизайны и т.д.)
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='faction_id'
      and c.data_type in ('text','character varying')
      and c.table_name not in ('faction_applications','faction_economy','state_unions')
  loop
    t := r.table_name;
    begin
      execute format('update public.%I set faction_id = $1 where faction_id = $2', t)
        using p_lead, p_partner;
    exception when others then raise notice 'su merge % : %', t, sqlerrm; end;
  end loop;
end$$;

-- ── RPC: предложить унию ────────────────────────────────────
create or replace function public.su_propose(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;
  if p_target_fid is null or p_target_fid = v_fid then raise exception 'bad target'; end if;
  if not exists(select 1 from public.faction_applications where faction_id=p_target_fid and status='approved') then
    raise exception 'target faction not found'; end if;
  if public._su_lead_of(v_fid) is not null then raise exception 'already in a state union'; end if;
  if public._su_lead_of(p_target_fid) is not null then raise exception 'target already in a state union'; end if;
  if exists(select 1 from public.state_unions where status='pending'
      and ((lead_fid=v_fid and partner_fid=p_target_fid) or (lead_fid=p_target_fid and partner_fid=v_fid))) then
    raise exception 'proposal already pending'; end if;
  insert into public.state_unions(lead_fid, partner_fid) values (v_fid, p_target_fid);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.su_propose(text) from public;
grant execute on function public.su_propose(text) to authenticated;

-- ── RPC: ответить на предложение (принять = слияние) ────────
create or replace function public.su_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; u public.state_unions;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  select * into u from public.state_unions where id=p_id and status='pending';
  if not found then raise exception 'proposal not found'; end if;
  if u.partner_fid <> v_fid then raise exception 'not your proposal'; end if;
  if not p_accept then
    update public.state_unions set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'joined',false);
  end if;
  if public._su_lead_of(v_fid) is not null or public._su_lead_of(u.lead_fid) is not null then
    raise exception 'one of the states is already in a union'; end if;
  update public.state_unions set status='active', sealed_at=now() where id=p_id;
  perform public._su_merge_assets(u.lead_fid, u.partner_fid);
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.su_respond(uuid,boolean) from public;
grant execute on function public.su_respond(uuid,boolean) to authenticated;

-- ── RPC: отозвать своё предложение ──────────────────────────
create or replace function public.su_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  v_fid := public._su_raw_fid();
  update public.state_unions set status='declined'
    where id=p_id and status='pending' and lead_fid=v_fid;
  if not found then raise exception 'proposal not found'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.su_withdraw(uuid) from public;
grant execute on function public.su_withdraw(uuid) to authenticated;

-- ── RPC: расторгнуть унию (активы ОСТАЮТСЯ у ведущего) ──────
create or replace function public.su_dissolve()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  update public.state_unions set status='dissolved'
    where status='active' and (lead_fid=v_fid or partner_fid=v_fid);
  if not found then raise exception 'no active union'; end if;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.su_dissolve() from public;
grant execute on function public.su_dissolve() to authenticated;
