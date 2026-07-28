-- ═══════════════════════════════════════════════════════════════════
-- АРТЕФАКТЫ: выдача из админки + запрет дублей одного вида на агенте
-- Накатывать ПОСЛЕ _intel_protection.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Экипировка: два слота И не два одинаковых предмета ──
-- «Сто стеклянных глаз в одну голову» больше не работает: одинаковые
-- бонусы не складываются экономически осмысленно, а из двух слотов
-- смысл имеет только ДВА РАЗНЫХ предмета.
create or replace function public.spy_artifact_equip(p_artifact_id uuid, p_agent_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_n int; v_kind text; v_lbl text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select kind into v_kind from public.spy_artifacts
    where id=p_artifact_id and faction_id=fid and coalesce(spent,false)=false;
  if v_kind is null then raise exception 'no artifact'; end if;
  if not exists(select 1 from public.spy_agents where id=p_agent_id and faction_id=fid
                and coalesce(captive,false)=false) then
    raise exception 'no agent'; end if;
  select count(*) into v_n from public.spy_artifacts
    where equipped_agent=p_agent_id and coalesce(spent,false)=false;
  if v_n >= 2 then raise exception 'slots full: у оперативника уже два предмета'; end if;
  if exists(select 1 from public.spy_artifacts
              where equipped_agent=p_agent_id and coalesce(spent,false)=false
                and kind=v_kind) then
    select label into v_lbl from public.spy_artifact_kinds where key=v_kind;
    raise exception 'duplicate: «%» уже висит на этом оперативнике — второй такой же ничего не добавит',
      coalesce(v_lbl, v_kind);
  end if;
  update public.spy_artifacts set equipped_agent=p_agent_id where id=p_artifact_id;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_artifact_equip(uuid,uuid) from public;
grant execute on function public.spy_artifact_equip(uuid,uuid) to authenticated;

-- Страховка на уровне схемы: даже прямой UPDATE не положит дубль в слот.
create unique index if not exists spy_artifacts_agent_kind_uniq
  on public.spy_artifacts(equipped_agent, kind)
  where equipped_agent is not null and coalesce(spent,false)=false;

-- ── 2. Админские RPC: выдать / отобрать экземпляр ──
create or replace function public.spy_admin_art_grant(p_fid text, p_kind text, p_n int default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i int; v_ids uuid[] := '{}'; v_id uuid; v_n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden'; end if;
  if not exists(select 1 from public.spy_artifact_kinds where key=p_kind) then
    raise exception 'no such artifact kind: %', p_kind; end if;
  if not exists(select 1 from public.map_factions where id=p_fid) then
    raise exception 'no such faction: %', p_fid; end if;
  v_n := greatest(1, least(20, coalesce(p_n,1)));
  for i in 1..v_n loop
    insert into public.spy_artifacts(faction_id, kind, source)
      values(p_fid, p_kind, 'admin') returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('ok',true,'n',v_n,'ids',to_jsonb(v_ids));
end$$;
revoke all on function public.spy_admin_art_grant(text,text,int) from public;
grant execute on function public.spy_admin_art_grant(text,text,int) to authenticated;

create or replace function public.spy_admin_art_revoke(p_artifact_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden'; end if;
  delete from public.spy_artifacts where id=p_artifact_id;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_admin_art_revoke(uuid) from public;
grant execute on function public.spy_admin_art_revoke(uuid) to authenticated;

-- ── 3. Список выданных экземпляров для админки ──
create or replace function public.spy_admin_art_list(p_fid text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'label', coalesce(k.label, a.kind), 'icon', coalesce(k.icon,'🎁'),
    'rarity', coalesce(k.rarity,'common'), 'source', a.source, 'spent', coalesce(a.spent,false),
    'faction_id', a.faction_id, 'faction', public._fac_name(a.faction_id),
    'agent', case when g.id is null then null
                  else g.first_name || ' ' || g.last_name end,
    'acquired_at', a.acquired_at) order by a.acquired_at desc), '[]'::jsonb)
    into v
    from public.spy_artifacts a
    left join public.spy_artifact_kinds k on k.key = a.kind
    left join public.spy_agents g on g.id = a.equipped_agent
   where p_fid is null or a.faction_id = p_fid;
  return v;
end$$;
revoke all on function public.spy_admin_art_list(text) from public;
grant execute on function public.spy_admin_art_list(text) to authenticated;

-- ── 4. Микустану — по одному экземпляру каждого включённого вида ──
insert into public.spy_artifacts(faction_id, kind, source)
select 'fac_26f25b449f', key, 'admin'
  from public.spy_artifact_kinds
 where enabled
 order by sort, key;
