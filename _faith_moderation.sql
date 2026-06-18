-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 5: МОДЕРАЦИЯ КОНТЕНТА + КАРТИНКА + ПРОСМОТР/ПРАВКА
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_sect.sql. Идемпотентно.
--
-- Что добавляет:
--   1) Картинку вере (faiths.image_url) — грузится клиентом в Storage.
--   2) Публичный просмотр религии с описанием (faith_detail) — видно всем.
--   3) Редактирование веры основателем (faith_edit).
--   4) Модерацию КОНТЕНТА «как анкета»: новые религии и правки названия/догмы/
--      цвета/картинки проходят проверку стаффа (faith_review / faith_pending_list).
--
-- РЕШЕНИЕ ПО БАЛАНСУ (выбрано пользователем): игровые БОНУСЫ работают сразу с
-- момента основания (храмы/доход/скидка не трогаются — economy_* не правим).
-- На модерации держится только ПУБЛИЧНЫЙ КОНТЕНТ: пока веру не одобрят, её
-- название/догма/картинка не показываются миру (faith_list отдаёт только
-- approved), а правки одобренной веры висят «в кармане» (faiths.pending) и
-- применяются к живым полям лишь после одобрения стаффом.
--
-- Жизненный цикл (зеркало faction_applications):
--   faith_found     → status='pending'                 (новая, ждёт одобрения)
--   faith_review ✓  → status='approved'                (показана миру)
--   faith_review ✕  → status='rejected'                (основатель правит/пере-подаёт)
--   faith_edit (approved) → pending_review=true + pending={...}  (мир видит старое)
--   faith_review ✓ (edit) → pending → живые поля, pending_review=false
--   faith_review ✕ (edit) → pending очищается, контент остаётся прежним
--
-- ВАЖНО: пересоздаёт faith_status / faith_list как СТРОГИЕ надмножества версий
-- из _faith_sect.sql / _faith_setup.sql (добавлено только помеченное «-- МОД:»;
-- строки слайсов 2-4 «-- ВЕРА-2/-4» сохранены). При будущих слайсах, трогающих
-- эти функции, продублируйте строки «-- МОД:».
-- ============================================================

-- ── 1) СХЕМА: контент-поля модерации ────────────────────────
alter table public.faiths add column if not exists image_url     text;
alter table public.faiths add column if not exists status        text not null default 'approved';  -- существующие веры grandfathered
alter table public.faiths add column if not exists pending_review boolean not null default false;
alter table public.faiths add column if not exists pending        jsonb;       -- застейдженная правка {name,dogma,color,image_url}
alter table public.faiths add column if not exists reject_reason  text;
alter table public.faiths add column if not exists reviewed_by    text;
alter table public.faiths add column if not exists reviewed_at    timestamptz;

do $$ begin
  alter table public.faiths add constraint faiths_status_chk
    check (status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;

-- ── 2) RLS: неодобренный контент скрыт от мира ──────────────
-- Одобренные веры читает любой; pending/rejected — только основатель и стафф.
-- (Весь клиентский доступ всё равно идёт через SECURITY DEFINER RPC; это защита
--  прямого REST, чтобы немодерированное название не утекло в мир.)
drop policy if exists "faith_sel" on public.faiths;
create policy "faith_sel" on public.faiths for select to authenticated using (
  status = 'approved'
  or founder_owner = auth.uid()
  or public.current_user_role() in ('superadmin','editor','moderator')
);

-- ── 3) faith_found v2: + картинка, статус 'pending' ─────────
-- Бонусы работают сразу (членство founder создаётся), но контент ждёт одобрения.
drop function if exists public.faith_found(text,text,text);
create or replace function public.faith_found(
  p_name text, p_dogma text default null, p_color text default null, p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; new_id uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if not public._faith_can_found(v_fid) then
    raise exception 'only spiritualists, theocracies or admins may found a faith';
  end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if exists(select 1 from public.faith_membership where faction_id = v_fid) then
    raise exception 'already follow a faith — leave it first';
  end if;
  if exists(select 1 from public.faiths where lower(name) = lower(btrim(p_name))) then
    raise exception 'faith name already taken';
  end if;
  insert into public.faiths(name, founder_fid, founder_owner, dogma, color, image_url, status)
    values(btrim(p_name), v_fid, v_uid, nullif(btrim(coalesce(p_dogma,'')),''),
           coalesce(nullif(btrim(coalesce(p_color,'')),''),'#c9a227'),
           nullif(btrim(coalesce(p_image_url,'')),''),
           'pending')                                            -- МОД: новая вера на модерации
    returning id into new_id;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, new_id, 'founder', v_uid);
  return jsonb_build_object('ok', true, 'faith_id', new_id, 'status', 'pending');
end$$;
revoke all on function public.faith_found(text,text,text,text) from public;
grant execute on function public.faith_found(text,text,text,text) to authenticated;

-- ── 4) faith_edit: правка контента основателем (с модерацией) ─
-- Если вера уже approved — правка стейджится в faiths.pending и ждёт одобрения
-- (мир продолжает видеть старый контент). Если pending/rejected — правим живые
-- поля и (пере)подаём на модерацию (status='pending').
create or replace function public.faith_edit(
  p_name text, p_dogma text default null, p_color text default null, p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  nm text; dg text; cl text; img text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into m from public.faith_membership where faction_id = v_fid;
  if not found or m.role <> 'founder' then
    raise exception 'only the founder may edit the faith';
  end if;
  select * into f from public.faiths where id = m.faith_id;

  nm  := btrim(coalesce(p_name,''));
  if nm = '' then raise exception 'name required'; end if;
  dg  := nullif(btrim(coalesce(p_dogma,'')),'');
  cl  := coalesce(nullif(btrim(coalesce(p_color,'')),''),'#c9a227');
  img := nullif(btrim(coalesce(p_image_url,'')),'');

  -- имя не должно конфликтовать с ЖИВЫМ именем другой веры
  if exists(select 1 from public.faiths where lower(name) = lower(nm) and id <> f.id) then
    raise exception 'faith name already taken';
  end if;

  if f.status = 'approved' then
    -- одобренная вера: прячем правку в карман, мир видит прежнее
    update public.faiths set
      pending = jsonb_build_object('name', nm, 'dogma', dg, 'color', cl, 'image_url', img),
      pending_review = true, reject_reason = null
    where id = f.id;
    return jsonb_build_object('ok', true, 'staged', true);
  else
    -- ещё не одобрена (pending/rejected): правим живые поля и (пере)подаём
    update public.faiths set
      name = nm, dogma = dg, color = cl, image_url = img,
      status = 'pending', pending_review = false, pending = null, reject_reason = null
    where id = f.id;
    return jsonb_build_object('ok', true, 'staged', false, 'status', 'pending');
  end if;
end$$;
revoke all on function public.faith_edit(text,text,text,text) from public;
grant execute on function public.faith_edit(text,text,text,text) to authenticated;

-- ── 5) faith_review: одобрение/отклонение стаффом ───────────
create or replace function public.faith_review(
  p_faith_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.faiths; v_email text; nm text;
begin
  if public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'forbidden: staff only';
  end if;
  select * into f from public.faiths where id = p_faith_id;
  if not found then raise exception 'faith not found'; end if;
  select email into v_email from auth.users where id = auth.uid();

  if p_approve then
    if f.pending_review and f.pending is not null then
      -- одобряем застейдженную правку → переносим в живые поля
      nm := btrim(coalesce(f.pending->>'name', f.name));
      if exists(select 1 from public.faiths where lower(name) = lower(nm) and id <> f.id) then
        raise exception 'faith name already taken';
      end if;
      update public.faiths set
        name = nm,
        dogma = nullif(btrim(coalesce(f.pending->>'dogma','')),''),
        color = coalesce(nullif(btrim(coalesce(f.pending->>'color','')),''),'#c9a227'),
        image_url = nullif(btrim(coalesce(f.pending->>'image_url','')),''),
        status = 'approved', pending = null, pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = f.id;
    else
      -- одобряем новую (или повторно поданную) веру
      update public.faiths set
        status = 'approved', pending_review = false, reject_reason = null,
        reviewed_by = v_email, reviewed_at = now()
      where id = f.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'approved');
  else
    if f.pending_review then
      -- отклоняем ПРАВКУ — живой контент остаётся прежним (approved)
      update public.faiths set
        pending = null, pending_review = false, reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = f.id;
    else
      -- отклоняем новую веру (бонусы продолжают работать; основатель правит/переподаёт)
      update public.faiths set
        status = 'rejected', reject_reason = p_reason,
        reviewed_by = v_email, reviewed_at = now()
      where id = f.id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
end$$;
revoke all on function public.faith_review(uuid,boolean,text) from public;
grant execute on function public.faith_review(uuid,boolean,text) to authenticated;

-- ── 6) faith_pending_list: очередь модерации (стафф) ────────
-- Отдаёт новые веры (status='pending') и правки (pending_review=true) с текущим
-- и предлагаемым контентом, чтобы стафф сравнил.
create or replace function public.faith_pending_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.current_user_role() in ('superadmin','editor','moderator')
    then coalesce((select jsonb_agg(t.r order by t.kind, (t.r->>'created_at')) from (
      select (case when f.pending_review then 'edit' else 'new' end) as kind,
        jsonb_build_object(
          'id', f.id, 'status', f.status, 'is_edit', f.pending_review,
          'founder_fid', f.founder_fid, 'created_at', f.created_at,
          'founder_name', (select a.name from public.faction_applications a
                           where a.faction_id = f.founder_fid and a.status = 'approved'
                           order by a.updated_at desc limit 1),
          'name', f.name, 'dogma', f.dogma, 'color', f.color, 'image_url', f.image_url,
          'proposed', f.pending,
          'adepts', (select count(*) from public.faith_membership m where m.faith_id = f.id)
        ) as r
      from public.faiths f
      where f.status = 'pending' or f.pending_review = true
    ) t), '[]'::jsonb)
    else '[]'::jsonb end
$$;
revoke all on function public.faith_pending_list() from public;
grant execute on function public.faith_pending_list() to authenticated;

-- ── 7) faith_detail: публичный просмотр религии с описанием ──
-- суммарная паства веры (слоты храмов всех адептов) — хелпер для detail
create or replace function public._faith_strength_total(p_faith_id uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(cb.slots_open),0)::int
  from public.faith_membership m
  join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
  where m.faith_id = p_faith_id
$$;

-- Видит любой (одобренные); основатель/стафф видят и неодобренные.
create or replace function public.faith_detail(p_faith_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare f public.faiths; v_fid text;
begin
  select * into f from public.faiths where id = p_faith_id;
  if not found then raise exception 'faith not found'; end if;
  v_fid := public._ec_my_fid();
  if f.status <> 'approved'
     and f.founder_owner is distinct from auth.uid()
     and public.current_user_role() not in ('superadmin','editor','moderator') then
    raise exception 'faith not found';   -- скрываем существование немодерированной
  end if;
  return jsonb_build_object(
    'id', f.id, 'name', f.name, 'dogma', f.dogma, 'color', f.color,
    'image_url', f.image_url, 'open', f.open, 'status', f.status,
    'founder_fid', f.founder_fid, 'created_at', f.created_at,
    'flock', public._faith_strength_total(f.id),
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_strength(mm.faction_id)) order by mm.joined_at), '[]'::jsonb)
               from public.faith_membership mm where mm.faith_id = f.id));
end$$;
revoke all on function public.faith_detail(uuid) from public;
grant execute on function public.faith_detail(uuid) to authenticated;

-- ── 8) faith_list v2: только approved + картинка ────────────
-- База: _faith_setup.sql. Добавлено помеченное «-- МОД:».
create or replace function public.faith_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(row order by created_at), '[]'::jsonb) from (
    select f.id, f.name, f.founder_fid, f.dogma, f.color, f.open, f.created_at,
      f.image_url,                                              -- МОД: картинка
      (select count(*) from public.faith_membership m where m.faith_id = f.id) as adepts,
      coalesce((select sum(cb.slots_open) from public.faith_membership m
        join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
        where m.faith_id = f.id), 0) as flock
    from public.faiths f
    where f.status = 'approved'                                 -- МОД: только одобренные в реестре мира
  ) row
$$;
revoke all on function public.faith_list() from public;
grant execute on function public.faith_list() to authenticated;

-- ── 9) faith_status v4: + контент-модерация в объекте веры ──
-- База: _faith_sect.sql (v3). Сохранены строки «-- ВЕРА-2/-4». Добавлено «-- МОД:».
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric; is_founder boolean;
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);
  select * into m from public.faith_membership where faction_id = v_fid;

  if not found then
    return jsonb_build_object('faith', null, 'can_found', public._faith_can_found(v_fid),
      'strength', s, 'unit_discount', disc, 'temple_income', 150, 'tithe_pct', 0.20,
      'offers_in', public._faith_offers_in(v_fid),
      'sects', '[]'::jsonb, 'exposed_here', public._faith_exposed_here(v_fid));   -- ВЕРА-4
  end if;

  select * into f from public.faiths where id = m.faith_id;
  is_founder := (m.role = 'founder');
  return jsonb_build_object(
    'faith', jsonb_build_object('id', f.id, 'name', f.name, 'dogma', f.dogma,
       'color', f.color, 'open', f.open, 'founder_fid', f.founder_fid,
       'image_url', f.image_url,                                -- МОД: картинка
       'status', f.status,                                      -- МОД: pending/approved/rejected
       'pending_review', f.pending_review,                      -- МОД: правка ждёт проверки
       'pending', case when is_founder then f.pending else null end,  -- МОД: что предложено (видит основатель)
       'reject_reason', f.reject_reason),                       -- МОД: причина отклонения
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', 150,
    'tithe_pct', 0.20,
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_strength(mm.faction_id)) order by mm.joined_at), '[]'::jsonb)
               from public.faith_membership mm where mm.faith_id = f.id),
    'offers_in', public._faith_offers_in(v_fid),
    'offers_out', case when is_founder then (
        select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'to_fid', o.to_fid) order by o.created_at), '[]'::jsonb)
        from public.faith_offers o where o.faith_id = f.id and o.status = 'pending')
      else '[]'::jsonb end,
    -- ВЕРА-4: мои тайные секты (где сижу, риск вскрытия) + вскрытые у меня
    'sects', (select coalesce(jsonb_agg(jsonb_build_object(
        'host_fid', x.host_fid, 'exposure', round(x.exposure)) order by x.planted_at), '[]'::jsonb)
        from public.faith_sects x where x.owner_fid = v_fid and x.status = 'active'),
    'exposed_here', public._faith_exposed_here(v_fid));
end$$;
revoke all on function public.faith_status() from public;
grant execute on function public.faith_status() to authenticated;

-- ── Проверка после применения ───────────────────────────────
-- select public.faith_found('Культ Звёздного Огня','Свет ведёт нас','#e0a000', null); -- status=pending
-- select public.faith_pending_list();                 -- под стаффом: новая в очереди
-- select public.faith_review('<id>'::uuid, true, null);-- одобрить
-- select public.faith_list();                          -- появилась в реестре мира
-- select public.faith_detail('<id>'::uuid);            -- публичная карточка
