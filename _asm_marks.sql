-- ═══════════════════════════════════════════════════════════════
-- АССАМБЛЕЯ · ЖЕТОНЫ ПОДОЗРЕНИЯ/ДОВЕРИЯ (публичные)
-- Каждая держава может положить на любого делегата один жетон:
-- 🎯 'sus' (подозреваю) или 🤝 'trust' (доверяю). Жетоны видят ВСЕ —
-- это открытый язык стола, как обвинения вслух в настольной партии.
-- Катить ПОСЛЕ _vn_assembly.sql. Клиент: assembly_marks_list /
-- assembly_set_mark (render.js, ?v=20260718asmboard2).
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.assembly_marks (
  conv_id    bigint not null references public.assembly_convocations(id) on delete cascade,
  marker_fid text   not null,          -- кто поставил
  target_fid text   not null,          -- на ком лежит жетон
  kind       text   not null check (kind in ('sus','trust')),
  updated_at timestamptz not null default now(),
  primary key (conv_id, marker_fid, target_fid)
);
revoke all on public.assembly_marks from anon, authenticated;
-- RLS без политик = прямой доступ закрыт всем; работа только через
-- security definer RPC ниже (они RLS обходят по определению).
alter table public.assembly_marks enable row level security;

-- ── Все жетоны текущего созыва: { target_fid: {sus:[fid..], trust:[fid..]} } ──
create or replace function public.assembly_marks_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare c_id bigint; v jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select id into c_id from public.assembly_convocations
    where status in ('signup','active') order by id desc limit 1;
  if c_id is null then return '{}'::jsonb; end if;
  select coalesce(jsonb_object_agg(t.target_fid, t.o), '{}'::jsonb) into v
  from (
    select target_fid,
           jsonb_build_object(
             'sus',   coalesce(jsonb_agg(marker_fid order by updated_at) filter (where kind='sus'),   '[]'::jsonb),
             'trust', coalesce(jsonb_agg(marker_fid order by updated_at) filter (where kind='trust'), '[]'::jsonb)
           ) as o
    from public.assembly_marks where conv_id = c_id
    group by target_fid
  ) t;
  return v;
end$$;
revoke all on function public.assembly_marks_list() from public, anon;
grant execute on function public.assembly_marks_list() to authenticated;

-- ── Поставить/сменить/снять свой жетон (p_kind: 'sus' | 'trust' | null=снять) ──
create or replace function public.assembly_set_mark(p_target text, p_kind text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; c_id bigint;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_kind is not null and p_kind not in ('sus','trust') then raise exception 'bad kind'; end if;
  v_fid := public._asm_my_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;
  select id into c_id from public.assembly_convocations
    where status in ('signup','active') order by id desc limit 1;
  if c_id is null then raise exception 'no active convocation'; end if;
  if v_fid = p_target then raise exception 'cannot mark yourself'; end if;
  if not exists (select 1 from public.assembly_members where conv_id=c_id and faction_id=p_target) then
    raise exception 'target not at the table';
  end if;
  if p_kind is null then
    delete from public.assembly_marks where conv_id=c_id and marker_fid=v_fid and target_fid=p_target;
  else
    insert into public.assembly_marks (conv_id, marker_fid, target_fid, kind)
    values (c_id, v_fid, p_target, p_kind)
    on conflict (conv_id, marker_fid, target_fid)
    do update set kind = excluded.kind, updated_at = now();
  end if;
  return public.assembly_marks_list();
end$$;
revoke all on function public.assembly_set_mark(text, text) from public, anon;
grant execute on function public.assembly_set_mark(text, text) to authenticated;
