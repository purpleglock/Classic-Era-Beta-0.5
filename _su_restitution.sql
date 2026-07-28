-- ============================================================
-- УНИЯ ГОСУДАРСТВ: РЕСТИТУЦИЯ ПРИ РАСТОРЖЕНИИ
-- Применять ПОСЛЕ _state_union.sql. Идемпотентно.
--
-- Было: при расторжении ВСЁ оставалось у ведущего (lead_fid),
-- партнёр исчезал с карты (случай «Тетославия × Микустан»).
-- Стало: при слиянии каждая перенесённая строка помечается
-- union_origin = fid партнёра, и при расторжении возвращается
-- владельцу. Казна/ресурсы партнёра снимаются снимком в момент
-- слияния и возвращаются при расторжении (не больше, чем есть
-- у ведущего на этот момент — совместно проеденное не воскрешаем).
-- ============================================================

alter table public.state_unions add column if not exists partner_snapshot jsonb;

-- ── Провенанс-колонка union_origin во всех «фракционных» таблицах ──
create or replace function public._su_prov_columns()
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
    where c.table_schema='public' and c.column_name='faction_id'
      and c.data_type in ('text','character varying')
      and c.table_name not in ('faction_applications','faction_economy','state_unions')
  loop
    begin
      execute format('alter table public.%I add column if not exists union_origin text', r.table_name);
    exception when others then raise notice 'su prov % : %', r.table_name, sqlerrm; end;
  end loop;
  begin
    alter table public.map_systems add column if not exists union_origin text;
  exception when others then null; end;
end$$;
revoke all on function public._su_prov_columns() from public;
select public._su_prov_columns();

-- ── Слияние активов: теперь с пометкой происхождения ──────────
create or replace function public._su_merge_assets(p_lead text, p_partner text)
returns void language plpgsql security definer set search_path=public as $$
declare r record; t text;
begin
  perform public._su_prov_columns();

  -- 0) Снимок казны/ресурсов партнёра — вернём при расторжении
  begin
    update public.state_unions su set partner_snapshot = jsonb_build_object(
        'gc', coalesce((select gc from public.faction_economy where faction_id=p_partner),0),
        'resources', coalesce((select resources from public.faction_economy where faction_id=p_partner),'{}'::jsonb))
      where su.status='active' and su.lead_fid=p_lead and su.partner_fid=p_partner;
  exception when others then raise notice 'su snapshot: %', sqlerrm; end;

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
    update public.faction_economy set gc = 0, resources = '{}'::jsonb
      where faction_id = p_partner;
  exception when others then raise notice 'su merge economy: %', sqlerrm; end;

  -- 2) Системы на карте
  begin
    update public.map_systems
      set union_origin = coalesce(union_origin, faction), faction = p_lead
      where faction = p_partner;
  exception when others then raise notice 'su merge systems: %', sqlerrm; end;

  -- 3) Всё, что помечено faction_id
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
      execute format('update public.%I set union_origin = coalesce(union_origin,faction_id), faction_id = $1 where faction_id = $2', t)
        using p_lead, p_partner;
    exception when others then raise notice 'su merge % : %', t, sqlerrm; end;
  end loop;
end$$;

-- ── Возврат активов партнёру ──────────────────────────────────
create or replace function public._su_restitute(p_lead text, p_partner text, p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r record; t text; v_gc numeric; v_have numeric; v_back numeric; v_res jsonb;
begin
  -- 1) Системы
  begin
    update public.map_systems set faction = union_origin, union_origin = null
      where faction = p_lead and union_origin = p_partner;
  exception when others then raise notice 'su restitute systems: %', sqlerrm; end;

  -- 2) Всё «фракционное»
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
      execute format('update public.%I set faction_id = union_origin, union_origin = null where faction_id = $1 and union_origin = $2', t)
        using p_lead, p_partner;
    exception when others then raise notice 'su restitute % : %', t, sqlerrm; end;
  end loop;

  -- 3) Казна: возвращаем внесённое, но не больше остатка ведущего
  begin
    v_gc := coalesce((p_snapshot->>'gc')::numeric, 0);
    select coalesce(gc,0) into v_have from public.faction_economy where faction_id = p_lead;
    v_back := least(coalesce(v_gc,0), coalesce(v_have,0));
    if v_back > 0 then
      update public.faction_economy set gc = coalesce(gc,0) - v_back where faction_id = p_lead;
      update public.faction_economy set gc = coalesce(gc,0) + v_back where faction_id = p_partner;
    end if;
  exception when others then raise notice 'su restitute gc: %', sqlerrm; end;

  -- 4) Ресурсы: по каждому ключу — min(внесённое, остаток ведущего)
  begin
    v_res := coalesce(p_snapshot->'resources', '{}'::jsonb);
    for r in select key k, value::numeric v from jsonb_each_text(v_res) loop
      select coalesce((resources->>r.k)::numeric,0) into v_have from public.faction_economy where faction_id = p_lead;
      v_back := least(coalesce(r.v,0), coalesce(v_have,0));
      if v_back > 0 then
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[r.k], to_jsonb(coalesce(v_have,0) - v_back))
          where faction_id = p_lead;
        update public.faction_economy
          set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[r.k],
                to_jsonb(coalesce((resources->>r.k)::numeric,0) + v_back))
          where faction_id = p_partner;
      end if;
    end loop;
  exception when others then raise notice 'su restitute res: %', sqlerrm; end;
end$$;
revoke all on function public._su_restitute(text,text,jsonb) from public;

-- ── RPC: расторгнуть унию (активы ВОЗВРАЩАЮТСЯ владельцам) ────
create or replace function public.su_dissolve()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; u public.state_unions; v_lead_name text; v_partner_name text; v_lead_color text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._su_raw_fid();
  select * into u from public.state_unions
    where status='active' and (lead_fid=v_fid or partner_fid=v_fid)
    order by sealed_at desc limit 1;
  if not found then raise exception 'no active union'; end if;
  update public.state_unions set status='dissolved' where id=u.id;
  perform public._su_restitute(u.lead_fid, u.partner_fid, coalesce(u.partner_snapshot,'{}'::jsonb));
  select name, color into v_lead_name, v_lead_color from public.faction_applications where faction_id=u.lead_fid and status='approved' limit 1;
  select name into v_partner_name from public.faction_applications where faction_id=u.partner_fid and status='approved' limit 1;
  perform public._su_news(
    format('Распалась уния: «%s» и «%s»', coalesce(v_lead_name,u.lead_fid), coalesce(v_partner_name,u.partner_fid)),
    format('Государственное объединение «%s» и «%s» расторгнуто. Каждая держава забирает своё: колонии, системы, войска и внесённая казна возвращаются прежним владельцам. Совместно нажитое остаётся там, где было создано.',
      coalesce(v_lead_name,u.lead_fid), coalesce(v_partner_name,u.partner_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.su_dissolve() from public;
grant execute on function public.su_dissolve() to authenticated;

-- ── Бэкфилл провенанса для УЖЕ действующих уний ───────────────
-- Слияние прошло до этой правки → union_origin пуст. Восстанавливаем
-- его по owner_id: строки, созданные не владельцем ведущей фракции,
-- считаем внесёнными партнёром.
do $$
declare u record; r record; v_lead_owner uuid; t text;
begin
  for u in select * from public.state_unions where status='active' loop
    select owner_id into v_lead_owner from public.faction_applications
      where faction_id=u.lead_fid and status='approved' limit 1;
    if v_lead_owner is null then continue; end if;
    for r in
      select c.table_name from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema='public' and tb.table_name=c.table_name and tb.table_type='BASE TABLE'
      where c.table_schema='public' and c.column_name='faction_id'
        and c.data_type in ('text','character varying')
        and c.table_name not in ('faction_applications','faction_economy','state_unions')
        and exists (select 1 from information_schema.columns o
                    where o.table_schema='public' and o.table_name=c.table_name and o.column_name='owner_id')
    loop
      t := r.table_name;
      begin
        execute format('update public.%I set union_origin = $1 where faction_id = $2 and union_origin is null and owner_id is not null and owner_id <> $3', t)
          using u.partner_fid, u.lead_fid, v_lead_owner;
      exception when others then raise notice 'su backfill % : %', t, sqlerrm; end;
    end loop;
  end loop;
end$$;
