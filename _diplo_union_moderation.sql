-- ============================================================
-- ДИПЛОМАТИЯ · СОЮЗЫ — СЛАЙС 4: РЕДАКТИРОВАНИЕ + ФЛАГ + МОДЕРАЦИЯ + РЕЕСТР
-- Применять в Supabase → SQL Editor ПОСЛЕ _diplo_unions.sql. Идемпотентно.
--
-- Что добавляет (зеркало _faith_moderation.sql для союзов):
--   1) Профиль союза: описание, цвет, ФЛАГ (herald_url) — грузится клиентом в Storage.
--   2) Публичный просмотр союза с участниками (union_detail) — видно всем.
--   3) Реестр одобренных союзов на странице «Фракции» (union_list).
--   4) Редактирование союза ЛИДЕРОМ (union_edit) — через модерацию.
--   5) Модерацию «как анкета»: новые союзы и правки имени/описания/цвета/флага
--      проходят проверку стаффа (union_review / union_pending_list).
--
-- РЕШЕНИЕ ПО БАЛАНСУ (как у веры): игровые БОНУСЫ союза работают сразу с момента
-- создания (членство/лидерство/эффекты не трогаются). На модерации держится только
-- ПУБЛИЧНЫЙ КОНТЕНТ: пока союз не одобрят, он не показывается в реестре мира
-- (union_list отдаёт только approved); правки одобренного союза висят «в кармане»
-- (diplo_unions.pending) и применяются к живым полям лишь после одобрения стаффом.
-- Участники союза всегда видят свой союз во вкладке «Дипломатия» (diplo_status),
-- независимо от статуса модерации.
--
-- Жизненный цикл (зеркало faction_applications / faiths):
--   union_create           → status='pending'                (новый, ждёт одобрения)
--   union_review ✓         → status='approved'               (показан в реестре)
--   union_review ✕         → status='rejected'               (лидер правит/пере-подаёт)
--   union_edit (approved)  → pending_review=true + pending={...}  (мир видит старое)
--   union_review ✓ (edit)  → pending → живые поля, pending_review=false
--   union_review ✕ (edit)  → pending очищается, контент остаётся прежним
-- ============================================================

-- ── 1) СХЕМА: профиль + контент-поля модерации ──────────────
alter table public.diplo_unions add column if not exists description    text;
alter table public.diplo_unions add column if not exists color          text;
alter table public.diplo_unions add column if not exists herald_url     text;       -- ФЛАГ союза
alter table public.diplo_unions add column if not exists status         text not null default 'approved';  -- существующие союзы grandfathered
alter table public.diplo_unions add column if not exists pending_review boolean not null default false;
alter table public.diplo_unions add column if not exists pending        jsonb;       -- застейдженная правка {name,description,color,herald_url}
alter table public.diplo_unions add column if not exists reject_reason  text;
alter table public.diplo_unions add column if not exists reviewed_by    text;
alter table public.diplo_unions add column if not exists reviewed_at    timestamptz;

do $$ begin
  alter table public.diplo_unions add constraint diplo_unions_status_chk
    check (status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;

-- ── 2) RLS: неодобренный контент скрыт от мира ──────────────
-- Одобренные союзы читает любой; pending/rejected — только участник и стафф.
-- (Весь клиентский доступ всё равно идёт через SECURITY DEFINER RPC; это защита
--  прямого REST, чтобы немодерированное название/флаг не утекли в мир.)
drop policy if exists "du_sel" on public.diplo_unions;
create policy "du_sel" on public.diplo_unions for select to authenticated using (
  status = 'approved'
  or exists(select 1 from public.diplo_members m where m.union_id = diplo_unions.id and m.owner_id = auth.uid())
  or public.current_user_role() in ('superadmin','editor','moderator')
);

-- ── 3) union_create v2: новый союз на модерацию (status='pending') ──
-- База: _diplo_unions.sql. Бонусы работают сразу (членство лидера создаётся),
-- но публичный контент ждёт одобрения.
create or replace function public.union_create(p_kind text, p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; new_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if p_kind not in ('federation','confederation') then raise exception 'bad kind'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if exists(select 1 from public.diplo_members m where m.fid=v_fid) then raise exception 'already in a union'; end if;
  insert into public.diplo_unions(kind, name, leader_fid, status)              -- МОД: новый союз на модерации
    values(p_kind, btrim(p_name), v_fid, 'pending') returning id into new_id;
  insert into public.diplo_members(union_id, fid, owner_id) values(new_id, v_fid, v_uid);
  return jsonb_build_object('ok',true,'union_id',new_id,'status','pending');
end$$;
revoke all on function public.union_create(text,text) from public;
grant execute on function public.union_create(text,text) to authenticated;

-- ── 4) union_edit: правка профиля лидером (с модерацией) ─────
-- Если союз уже approved — правка стейджится в diplo_unions.pending и ждёт
-- одобрения (мир продолжает видеть старый контент). Если pending/rejected —
-- правим живые поля и (пере)подаём на модерацию (status='pending').
create or replace function public.union_edit(
  p_name text, p_description text default null, p_color text default null, p_herald_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; u public.diplo_unions; nm text; ds text; cl text; img text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into u from public.diplo_unions where leader_fid = v_fid;
  if not found then raise exception 'only the union leader may edit it'; end if;

  nm := btrim(coalesce(p_name,''));
  if nm = '' then raise exception 'name required'; end if;
  ds  := nullif(btrim(coalesce(p_description,'')),'');
  cl  := nullif(btrim(coalesce(p_color,'')),'');
  img := nullif(btrim(coalesce(p_herald_url,'')),'');

  if u.status = 'approved' then
    -- одобренный союз: прячем правку в карман, мир видит прежнее
    update public.diplo_unions set
      pending = jsonb_build_object('name', nm, 'description', ds, 'color', cl, 'herald_url', img),
      pending_review = true, reject_reason = null
    where id = u.id;
    return jsonb_build_object('ok', true, 'staged', true);
  else
    -- ещё не одобрен (pending/rejected): правим живые поля и (пере)подаём
    update public.diplo_unions set
      name = nm, description = ds, color = cl, herald_url = img,
      status = 'pending', pending_review = false, pending = null, reject_reason = null
    where id = u.id;
    return jsonb_build_object('ok', true, 'staged', false, 'status', 'pending');
  end if;
end$$;
revoke all on function public.union_edit(text,text,text,text) from public;
grant execute on function public.union_edit(text,text,text,text) to authenticated;

-- ── 5) union_review: одобрение/отклонение стаффом ───────────
create or replace function public.union_review(
  p_union_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.diplo_unions; v_email text;
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  select * into u from public.diplo_unions where id = p_union_id;
  if not found then raise exception 'union not found'; end if;
  select email into v_email from auth.users where id = auth.uid();

  if p_approve then
    if u.pending_review and u.pending is not null then
      -- одобряем застейдженную правку → переносим в живые поля
      update public.diplo_unions set
        name = btrim(coalesce(u.pending->>'name', u.name)),
        description = nullif(btrim(coalesce(u.pending->>'description','')),''),
        color = nullif(btrim(coalesce(u.pending->>'color','')),''),
        herald_url = nullif(btrim(coalesce(u.pending->>'herald_url','')),''),
        status = 'approved', pending = null, pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = u.id;
    else
      -- одобряем новый (или повторно поданный) союз
      update public.diplo_unions set
        status = 'approved', pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = u.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'approved');
  else
    if u.pending_review then
      -- отклоняем ПРАВКУ — живой контент остаётся прежним (approved)
      update public.diplo_unions set
        pending = null, pending_review = false, reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = u.id;
    else
      -- отклоняем новый союз (бонусы продолжают работать; лидер правит/переподаёт)
      update public.diplo_unions set
        status = 'rejected', reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = u.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
end$$;
revoke all on function public.union_review(uuid,boolean,text) from public;
grant execute on function public.union_review(uuid,boolean,text) to authenticated;

-- ── 6) union_pending_list: очередь модерации (стафф) ────────
-- Новые союзы (status='pending') и правки (pending_review=true) с текущим и
-- предлагаемым контентом, чтобы стафф сравнил.
create or replace function public.union_pending_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_role() in ('superadmin','editor','moderator')
    then coalesce((select jsonb_agg(t.r order by t.kind, (t.r->>'created_at')) from (
      select (case when u.pending_review then 'edit' else 'new' end) as kind,
        jsonb_build_object(
          'id', u.id, 'status', u.status, 'is_edit', u.pending_review,
          'kind_union', u.kind, 'leader_fid', u.leader_fid, 'created_at', u.created_at,
          'leader_name', public._fac_name(u.leader_fid),
          'name', u.name, 'description', u.description, 'color', u.color, 'herald_url', u.herald_url,
          'proposed', u.pending,
          'members', (select count(*) from public.diplo_members m where m.union_id = u.id)
        ) as r
      from public.diplo_unions u
      where u.status = 'pending' or u.pending_review = true
    ) t), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke all on function public.union_pending_list() from public;
grant execute on function public.union_pending_list() to authenticated;

-- ── 7) union_detail: публичный просмотр союза с участниками ──
-- Видит любой (одобренные); участник/стафф видят и неодобренные.
create or replace function public.union_detail(p_union_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u public.diplo_unions;
begin
  select * into u from public.diplo_unions where id = p_union_id;
  if not found then raise exception 'union not found'; end if;
  if u.status <> 'approved'
     and not exists(select 1 from public.diplo_members m where m.union_id = u.id and m.owner_id = auth.uid())
     and public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'union not found';   -- скрываем существование немодерированного
  end if;
  return jsonb_build_object(
    'id', u.id, 'kind', u.kind, 'name', u.name, 'description', u.description,
    'color', u.color, 'herald_url', u.herald_url, 'status', u.status,
    'leader_fid', u.leader_fid, 'leader_name', public._fac_name(u.leader_fid),
    'created_at', u.created_at,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', m.fid, 'name', public._fac_name(m.fid),
                 'is_leader', (m.fid = u.leader_fid)) order by m.joined_at), '[]'::jsonb)
               from public.diplo_members m where m.union_id = u.id));
end$$;
revoke all on function public.union_detail(uuid) from public;
grant execute on function public.union_detail(uuid) to authenticated;

-- ── 8) union_list: реестр одобренных союзов (страница «Фракции») ──
create or replace function public.union_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(row order by (row->>'name')), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'name', u.name, 'description', u.description,
      'color', u.color, 'herald_url', u.herald_url,
      'leader_fid', u.leader_fid, 'leader_name', public._fac_name(u.leader_fid),
      'members', (select count(*) from public.diplo_members m where m.union_id = u.id)
    ) as row
    from public.diplo_unions u
    where u.status = 'approved'
  ) rows
$$;
revoke all on function public.union_list() from public;
grant execute on function public.union_list() to authenticated;

-- ── 9) diplo_status v2: + профиль/статус союза в объекте ────
-- База: _diplo_unions.sql. Союз отдаётся явным объектом (а не to_jsonb) — с полями
-- профиля и модерации; pending видит только лидер.
create or replace function public.diplo_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; v_uid uuid; v_union jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select m.union_id into v_uid from public.diplo_members m where m.fid=v_fid limit 1;
  v_union := (select jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'name', u.name, 'leader_fid', u.leader_fid,
      'description', u.description, 'color', u.color, 'herald_url', u.herald_url,
      'status', u.status, 'pending_review', u.pending_review,
      'pending', case when u.leader_fid = v_fid then u.pending else null end,  -- предлагаемое видит лидер
      'reject_reason', u.reject_reason)
    from public.diplo_unions u where u.id = v_uid);
  return jsonb_build_object(
    'union', v_union,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('fid',m.fid,'name',public._fac_name(m.fid)) order by m.joined_at), '[]'::jsonb)
                from public.diplo_members m where m.union_id=v_uid),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'union_id',i.union_id,
                  'kind',(select kind from public.diplo_unions where id=i.union_id),
                  'name',(select name from public.diplo_unions where id=i.union_id),
                  'leader',public._fac_name((select leader_fid from public.diplo_unions where id=i.union_id))) order by i.created_at desc), '[]'::jsonb)
                from public.diplo_invites i where i.fid=v_fid and i.status='pending'),
    'vassals', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'overlord',d.overlord_fid,'overlord_name',public._fac_name(d.overlord_fid),
                  'vassal',d.vassal_fid,'vassal_name',public._fac_name(d.vassal_fid),'tribute_pct',d.tribute_pct,'status',d.status) order by d.created_at desc), '[]'::jsonb)
                from public.diplo_vassals d where (d.overlord_fid=v_fid or d.vassal_fid=v_fid) and d.status in ('pending','active')));
end$$;
revoke all on function public.diplo_status() from public;
grant execute on function public.diplo_status() to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public.union_create('confederation','Лига Эрленда');  -- status=pending
-- select public.union_edit('Лига Эрленда','Оборонительный пакт фронтира','#5a7fb0', null);
-- select public.union_pending_list();             -- под стаффом: новый/правка в очереди
-- select public.union_review('<id>'::uuid, true, null);  -- одобрить
-- select public.union_list();                      -- появился в реестре мира
-- select public.union_detail('<id>'::uuid);        -- публичная карточка с участниками
