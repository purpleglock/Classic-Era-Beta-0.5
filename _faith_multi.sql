-- ============================================================
-- ВЕРА (РЕЛИГИЯ) · СЛАЙС 6: МУЛЬТИВЕРА — несколько религий на державу
-- Применять в Supabase → SQL Editor ПОСЛЕ _faith_moderation.sql (и всех _spy_agents*).
-- Идемпотентно.
--
-- Что меняет:
--   1) Держава может ИСПОВЕДОВАТЬ НЕСКОЛЬКО религий (faith_membership: PK теперь
--      составной (faction_id, faith_id); ОСНОВАТЬ можно по-прежнему лишь ОДНУ
--      (partial-unique на role='founder')).
--   2) ХРАМ привязан к КОНКРЕТНОЙ ВЕРЕ (colony_buildings.faith_id). Строя храм,
--      игрок выбирает, чьей веры это храм. В карточке здания пишется религия.
--   3) Доход храма идёт, только пока держава исповедует ЕГО веру; десятина и
--      «паства» считаются по конкретной вере.
--   Старые храмы (без метки) миграция привязывает к текущей (единственной) вере.
--
-- ВАЖНО (источники истины): пересоздаёт как СТРОГИЕ надмножества —
--   economy_accrue   (база _faith_sect.sql: строки -- ВЕРА / -- ВЕРА-2 / -- ВЕРА-4),
--   faith_status     (база _faith_moderation.sql: -- ВЕРА-2/-4 / -- МОД),
--   faith_list / _faith_strength_total / faith_detail (база _faith_moderation.sql),
--   faith_found / faith_join / faith_leave / faith_offer_recognition /
--   faith_offer_respond / economy_build / _apply_colony_projects.
--   Добавленное помечено «-- МУЛЬТИ:». При будущих слайсах, трогающих эти функции,
--   продублируйте строки «-- МУЛЬТИ:».
-- НЕ трогает spy_launch/_spy_resolve (источник истины — _spy_agents8.sql).
-- ============================================================

-- ── 1) СХЕМА: мультичленство + метка веры у храма ───────────
-- faith_membership: с одной веры (PK по faction_id) на несколько (PK составной).
alter table public.faith_membership drop constraint if exists faith_membership_pkey;
do $$ begin
  alter table public.faith_membership add constraint faith_membership_pkey
    primary key (faction_id, faith_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;
-- Основать можно лишь ОДНУ веру: максимум одна строка role='founder' на державу.
create unique index if not exists fm_one_founder
  on public.faith_membership(faction_id) where role = 'founder';

-- Храм знает свою веру.
alter table public.colony_buildings
  add column if not exists faith_id uuid references public.faiths(id) on delete set null;
create index if not exists cb_temple_faith_idx
  on public.colony_buildings(faith_id) where btype = 'temple';

-- Миграция: старым храмам (без метки) проставить веру, которую держава исповедует
-- сейчас. До этого слайса у каждой державы ровно одна вера — выбор однозначен.
update public.colony_buildings cb
  set faith_id = m.faith_id
  from public.faith_membership m
  where cb.btype = 'temple' and cb.faith_id is null and m.faction_id = cb.faction_id;

-- ── 2) ХЕЛПЕРЫ МУЛЬТИВЕРЫ ───────────────────────────────────
-- Исповедует ли держава конкретную веру.
create or replace function public._faith_member(p_fid text, p_faith_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.faith_membership
                where faction_id = p_fid and faith_id = p_faith_id)
$$;
revoke all on function public._faith_member(text,uuid) from public;

-- «Паства» державы по КОНКРЕТНОЙ вере: слоты её храмов этой веры + её активные
-- секты этой веры. (Общая «сила веры» для скидки на войска — _faith_strength.)
create or replace function public._faith_flock(p_fid text, p_faith_id uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select sum(slots_open) from public.colony_buildings
                   where faction_id = p_fid and btype = 'temple' and faith_id = p_faith_id),0)::int
       + coalesce((select count(*) from public.faith_sects
                   where owner_fid = p_fid and faith_id = p_faith_id and status = 'active'),0)::int
$$;
revoke all on function public._faith_flock(text,uuid) from public;

-- ── 3) faith_found: основать ОДНУ (даже исповедуя другие) ────
-- База: _faith_moderation.sql v2. МУЛЬТИ: блокируем только повторное ОСНОВАНИЕ.
drop function if exists public.faith_found(text,text,text,text);
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
  if exists(select 1 from public.faith_membership where faction_id = v_fid and role = 'founder') then
    raise exception 'you already founded a faith — a nation may found only one';  -- МУЛЬТИ
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

-- ── 3b) faith_edit: основатель правит ИМЕННО свою основанную веру ──
-- База: _faith_moderation.sql. МУЛЬТИ: при мультичленстве нужно выбрать строку
-- role='founder' (иначе select-into мог бы взять чужую веру-членство и решить,
-- что игрок «не основатель»). Логика модерации правок не меняется.
create or replace function public.faith_edit(
  p_name text, p_dogma text default null, p_color text default null, p_image_url text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  nm text; dg text; cl text; img text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into m from public.faith_membership
    where faction_id = v_fid and role = 'founder';            -- МУЛЬТИ: именно основанная вера
  if not found then
    raise exception 'only the founder may edit the faith';
  end if;
  select * into f from public.faiths where id = m.faith_id;

  nm  := btrim(coalesce(p_name,''));
  if nm = '' then raise exception 'name required'; end if;
  dg  := nullif(btrim(coalesce(p_dogma,'')),'');
  cl  := coalesce(nullif(btrim(coalesce(p_color,'')),''),'#c9a227');
  img := nullif(btrim(coalesce(p_image_url,'')),'');

  if exists(select 1 from public.faiths where lower(name) = lower(nm) and id <> f.id) then
    raise exception 'faith name already taken';
  end if;

  if f.status = 'approved' then
    update public.faiths set
      pending = jsonb_build_object('name', nm, 'dogma', dg, 'color', cl, 'image_url', img),
      pending_review = true, reject_reason = null
    where id = f.id;
    return jsonb_build_object('ok', true, 'staged', true);
  else
    update public.faiths set
      name = nm, dogma = dg, color = cl, image_url = img,
      status = 'pending', pending_review = false, pending = null, reject_reason = null
    where id = f.id;
    return jsonb_build_object('ok', true, 'staged', false, 'status', 'pending');
  end if;
end$$;
revoke all on function public.faith_edit(text,text,text,text) from public;
grant execute on function public.faith_edit(text,text,text,text) to authenticated;

-- ── 4) faith_join: вступить в ещё одну открытую веру ────────
-- База: _faith_setup.sql. МУЛЬТИ: убран запрет «уже исповедуете веру»; нельзя
-- лишь вступить в ту, что уже исповедуешь.
create or replace function public.faith_join(p_faith_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; f public.faiths;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  if not public._faith_can_found(v_fid) then
    raise exception 'only spiritualists or theocracies may adopt a faith (recognition comes later)';
  end if;
  if public._faith_member(v_fid, p_faith_id) then
    raise exception 'you already follow this faith';                    -- МУЛЬТИ
  end if;
  select * into f from public.faiths where id = p_faith_id;
  if not found then raise exception 'faith not found'; end if;
  if not f.open then raise exception 'this faith is closed for new adepts'; end if;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, p_faith_id, 'member', v_uid);
  return jsonb_build_object('ok', true, 'faith_id', p_faith_id);
end$$;
revoke all on function public.faith_join(uuid) from public;
grant execute on function public.faith_join(uuid) to authenticated;

-- ── 5) faith_leave(p_faith_id): отречься от КОНКРЕТНОЙ веры ──
-- База: _faith_setup.sql. МУЛЬТИ: новая сигнатура с p_faith_id (старая без аргумента
-- удаляется). Основатель уходит только если он последний — вера распускается.
-- Снимаем метку с осиротевших храмов этой веры (их доход прекратится).
drop function if exists public.faith_leave();
create or replace function public.faith_leave(p_faith_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; others int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select * into m from public.faith_membership where faction_id = v_fid and faith_id = p_faith_id;
  if not found then raise exception 'you do not follow this faith'; end if;
  if m.role = 'founder' then
    select count(*) into others from public.faith_membership
      where faith_id = m.faith_id and faction_id <> v_fid;
    if others > 0 then
      raise exception 'founder cannot abandon a faith with other adepts (transfer comes later)';
    end if;
    delete from public.faiths where id = m.faith_id;          -- каскадом снимет членство
    -- осиротевшие храмы этой веры теряют метку (доход прекратится)
    update public.colony_buildings set faith_id = null
      where faction_id = v_fid and btype = 'temple' and faith_id = p_faith_id;  -- МУЛЬТИ
    return jsonb_build_object('ok', true, 'dissolved', true);
  end if;
  delete from public.faith_membership where faction_id = v_fid and faith_id = p_faith_id;
  return jsonb_build_object('ok', true, 'dissolved', false);
end$$;
revoke all on function public.faith_leave(uuid) from public;
grant execute on function public.faith_leave(uuid) to authenticated;

-- ── 6) Предложение признания: цель может уже иметь другие веры ─
-- База: _faith_spread.sql. МУЛЬТИ: блокируем лишь повтор ЭТОЙ веры у цели.
create or replace function public.faith_offer_recognition(p_to_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_faith uuid; v_to_owner uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid();
  select faith_id into v_faith from public.faith_membership where faction_id = v_fid and role = 'founder';
  if v_faith is null then raise exception 'only a faith founder may offer recognition'; end if;
  if coalesce(btrim(p_to_fid),'') = '' or p_to_fid = v_fid then raise exception 'bad target'; end if;
  if public._faith_member(p_to_fid, v_faith) then
    raise exception 'target already follows your faith';                -- МУЛЬТИ
  end if;
  select owner_id into v_to_owner from public.faction_applications
    where faction_id = p_to_fid and status = 'approved' order by updated_at desc limit 1;
  if v_to_owner is null then raise exception 'target faction not found'; end if;
  if exists(select 1 from public.faith_offers where faith_id = v_faith and to_fid = p_to_fid and status = 'pending') then
    raise exception 'offer already pending';
  end if;
  insert into public.faith_offers(faith_id, from_fid, to_fid, to_owner)
    values(v_faith, v_fid, p_to_fid, v_to_owner);
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.faith_offer_recognition(text) from public;
grant execute on function public.faith_offer_recognition(text) to authenticated;

-- База: _faith_spread.sql. МУЛЬТИ: принять можно, даже исповедуя другие веры.
create or replace function public.faith_offer_respond(p_offer_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; v_uid uuid; o public.faith_offers;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._ec_my_fid(); v_uid := auth.uid();
  select * into o from public.faith_offers where id = p_offer_id and to_fid = v_fid and status = 'pending';
  if not found then raise exception 'offer not found'; end if;
  if not p_accept then
    update public.faith_offers set status = 'declined' where id = p_offer_id;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;
  if public._faith_member(v_fid, o.faith_id) then
    raise exception 'you already follow this faith';                    -- МУЛЬТИ
  end if;
  insert into public.faith_membership(faction_id, faith_id, role, owner_id)
    values(v_fid, o.faith_id, 'recognized', v_uid);
  update public.faith_offers set status = 'accepted' where id = p_offer_id;
  -- прочие висящие предложения ЭТОЙ ЖЕ веры снимаем (другие веры — оставляем)
  update public.faith_offers set status = 'declined'
    where to_fid = v_fid and faith_id = o.faith_id and status = 'pending' and id <> p_offer_id;  -- МУЛЬТИ
  return jsonb_build_object('ok', true, 'accepted', true);
end$$;
revoke all on function public.faith_offer_respond(uuid,boolean) from public;
grant execute on function public.faith_offer_respond(uuid,boolean) to authenticated;

-- ── 7) economy_build: храм требует выбора веры ──────────────
-- База: _faith_setup.sql. МУЛЬТИ: p_faith_id — какой веры храм; гейт по членству
-- в этой вере; метка кладётся в payload и переносится в colony_buildings.
drop function if exists public.economy_build(uuid,text);
create or replace function public.economy_build(p_colony_id uuid, p_btype text, p_faith_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; base numeric; cost numeric;
  used int; pending int;
begin
  fid := public._ec_my_fid();
  if public._ec_bld_base(p_btype) is null then raise exception 'bad btype'; end if;
  -- МУЛЬТИ: храм можно строить только исповедуя веру; метка = выбранная вера
  if p_btype = 'temple' then
    if not exists(select 1 from public.faith_membership where faction_id = fid) then
      raise exception 'no faith: found or join a faith before building a temple';
    end if;
    if p_faith_id is null then
      -- по умолчанию: основанная вера, иначе первая принятая
      select faith_id into p_faith_id from public.faith_membership
        where faction_id = fid order by (role = 'founder') desc, joined_at asc limit 1;
    elsif not public._faith_member(fid, p_faith_id) then
      raise exception 'you do not follow that faith';
    end if;
  else
    p_faith_id := null;
  end if;
  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects
    where colony_id = p_colony_id and kind = 'build';
  if used + pending >= coalesce(col.cells, 6) then raise exception 'no free cells'; end if;

  base := public._ec_bld_base(p_btype);
  cost := public._ec_build_cost(fid, base);

  update public.faction_economy set gc = gc - cost
    where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', p_btype, p_colony_id,
     jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', p_btype,
                        'free_slots', public._ec_bld_free(p_btype),
                        'faith_id', p_faith_id),                 -- МУЛЬТИ: метка веры
     'Постройка', now() + interval '1 day');

  return jsonb_build_object('ok', true, 'cost', cost);
end$$;
revoke all on function public.economy_build(uuid,text,uuid) from public;
grant execute on function public.economy_build(uuid,text,uuid) to authenticated;

-- ── 8) _apply_colony_projects: переносит метку веры на здание ─
-- База: _economy_setup.sql. Добавлено только перенос payload->>'faith_id' (МУЛЬТИ).
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                coalesce((pr.payload->>'free_slots')::int, 1), false,
                nullif(pr.payload->>'faith_id','')::uuid);       -- МУЛЬТИ: метка веры храма
    elsif pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and (case when pr.planet_pid is not null
                                 then c.planet_pid = pr.planet_pid
                                 else c.planet_name = pr.planet_name end)) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- ── 9) faith_list / _faith_strength_total / faith_detail ────
-- «Паства» веры = слоты храмов ИМЕННО ЭТОЙ веры (МУЛЬТИ: + cb.faith_id = f.id).
create or replace function public.faith_list()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(row order by created_at), '[]'::jsonb) from (
    select f.id, f.name, f.founder_fid, f.dogma, f.color, f.open, f.created_at,
      f.image_url,                                              -- МОД: картинка
      (select count(*) from public.faith_membership m where m.faith_id = f.id) as adepts,
      coalesce((select sum(cb.slots_open) from public.faith_membership m
        join public.colony_buildings cb on cb.faction_id = m.faction_id
          and cb.btype = 'temple' and cb.faith_id = f.id        -- МУЛЬТИ: храмы этой веры
        where m.faith_id = f.id), 0) as flock
    from public.faiths f
    where f.status = 'approved'                                 -- МОД: только одобренные в реестре мира
  ) row
$$;
revoke all on function public.faith_list() from public;
grant execute on function public.faith_list() to authenticated;

create or replace function public._faith_strength_total(p_faith_id uuid)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(sum(cb.slots_open),0)::int
  from public.faith_membership m
  join public.colony_buildings cb on cb.faction_id = m.faction_id
    and cb.btype = 'temple' and cb.faith_id = p_faith_id        -- МУЛЬТИ
  where m.faith_id = p_faith_id
$$;
revoke all on function public._faith_strength_total(uuid) from public;

-- База: _faith_moderation.sql. МУЛЬТИ: паства адепта = _faith_flock по этой вере.
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
                 'flock', public._faith_flock(mm.faction_id, f.id)) order by mm.joined_at), '[]'::jsonb)  -- МУЛЬТИ
               from public.faith_membership mm where mm.faith_id = f.id));
end$$;
revoke all on function public.faith_detail(uuid) from public;
grant execute on function public.faith_detail(uuid) to authenticated;

-- ── 10) faith_status v5: все исповедуемые веры ──────────────
-- База: _faith_moderation.sql v4 (сохранены -- ВЕРА-2/-4 / -- МОД). МУЛЬТИ:
--   - выбираем ПЕРВИЧНУЮ веру (основанная > раньше принятая) для совместимости
--     старого UI (поле 'faith' / 'role' / 'adepts');
--   - добавлено поле 'faiths' — массив ВСЕХ исповедуемых вер.
create or replace function public.faith_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_fid text; m public.faith_membership; f public.faiths;
  s int; disc numeric; is_founder boolean; v_faiths jsonb;
begin
  v_fid := public._ec_my_fid();
  s    := public._faith_strength(v_fid);
  disc := public._faith_unit_discount(v_fid);

  -- МУЛЬТИ: массив всех исповедуемых вер (с ролью, паствой и контент-модерацией)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ff.id, 'name', ff.name, 'dogma', ff.dogma, 'color', ff.color,
      'image_url', ff.image_url, 'open', ff.open, 'founder_fid', ff.founder_fid,
      'status', ff.status, 'pending_review', ff.pending_review,
      'pending', case when mm.role = 'founder' then ff.pending else null end,
      'reject_reason', ff.reject_reason,
      'role', mm.role, 'flock', public._faith_flock(v_fid, ff.id))
      order by (mm.role = 'founder') desc, mm.joined_at asc), '[]'::jsonb)
    into v_faiths
  from public.faith_membership mm join public.faiths ff on ff.id = mm.faith_id
  where mm.faction_id = v_fid;

  -- первичная вера = основанная, иначе самая ранняя принятая
  select * into m from public.faith_membership
    where faction_id = v_fid order by (role = 'founder') desc, joined_at asc limit 1;

  if not found then
    return jsonb_build_object('faith', null, 'faiths', '[]'::jsonb,             -- МУЛЬТИ
      'can_found', public._faith_can_found(v_fid),
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
    'faiths', v_faiths,                                         -- МУЛЬТИ: все исповедуемые веры
    'role', m.role,
    'can_found', public._faith_can_found(v_fid),
    'strength', s,
    'unit_discount', disc,
    'temple_income', 150,
    'tithe_pct', 0.20,
    'adepts', (select coalesce(jsonb_agg(jsonb_build_object(
                 'fid', mm.faction_id, 'role', mm.role,
                 'flock', public._faith_flock(mm.faction_id, f.id)) order by mm.joined_at), '[]'::jsonb)  -- МУЛЬТИ
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

-- ── 11) economy_accrue v5: доход храма по его вере + десятина ─
-- База: _faith_sect.sql v4 (строки -- ВЕРА / -- ВЕРА-2 / -- ВЕРА-4 сохранены).
-- МУЛЬТИ: доход храма идёт, лишь пока держава исповедует ЕГО веру; десятина —
-- только с храмов веры основателя.
create or replace function public.economy_accrue(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  eco public.faction_economy; d int;
  inc_gc numeric:=0; inc_sci numeric:=0; inc_agents int:=0; trade_gc numeric:=0; pirate boolean:=false;
  r record; col record; bld record; relem jsonb; thr jsonb;
  res_add jsonb := '{}'::jsonb; res_sub jsonb := '{}'::jsonb; merged jsonb; k text;
  rname text; rr text; rate numeric; escorted boolean; attacked boolean; chance numeric; avail numeric; shipped numeric;
  mods jsonb; m_mine numeric; m_gc numeric;
  market_cap numeric; market_gc numeric := 0; sell numeric;
  export_gc numeric := 0; cap numeric;
  rel_score int; dip_coef numeric;
  mine_flow jsonb := '{}'::jsonb;
  flow_rar  jsonb := '{}'::jsonb;
  citem jsonb; cargo_price numeric;
  policy_cost numeric := 0;
  has_faith boolean := false;                       -- ВЕРА
  tithe_gc numeric := 0;                             -- ВЕРА-2: десятина основателю
  v_sects int := 0;                                  -- ВЕРА-4: мои активные секты
  sct record; v_ci_host int; v_new_exp numeric;      -- ВЕРА-4: вскрытие чужих сект
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return jsonb_build_object('faction_id',p_fid,'days',0); end if;

  mods := public._faction_mods(p_fid);
  m_mine := (mods->>'mine')::numeric;
  m_gc   := (mods->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  policy_cost := public._trade_policy_cost(coalesce(eco.trade_policy,0));

  update public.unit_production set status='done' where faction_id=p_fid and status='queued' and ready_at<=now();

  perform public._apply_colony_projects(p_fid);
  perform public._spy_resolve(p_fid);
  perform public._raid_resolve(p_fid);

  d := floor(extract(epoch from (now()-eco.last_tick))/86400.0);

  has_faith := exists(select 1 from public.faith_membership where faction_id = p_fid);  -- ВЕРА

  for r in select btype, slots_open, faith_id from public.colony_buildings where faction_id=p_fid loop  -- МУЛЬТИ: + faith_id
    if r.btype='factory' then inc_gc := inc_gc + r.slots_open*200;
    elsif r.btype='trade' then inc_gc := inc_gc + r.slots_open*100;
    elsif r.btype='science' then inc_sci := inc_sci + r.slots_open*1;
    elsif r.btype='intel' then inc_agents := inc_agents + r.slots_open*1;
    elsif r.btype='temple' and (                                                      -- МУЛЬТИ: доход лишь пока исповедуешь веру храма
        (r.faith_id is not null and public._faith_member(p_fid, r.faith_id))
        or (r.faith_id is null and has_faith)) then inc_gc := inc_gc + r.slots_open*150;  -- ВЕРА
    end if;
  end loop;

  -- ВЕРА-2: если я основатель веры — получаю 20% дохода храмов всех адептов/признавших.
  if exists(select 1 from public.faiths where founder_fid = p_fid) then
    select coalesce(sum(cb.slots_open),0) * 150 * 0.20 into tithe_gc
    from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    join public.colony_buildings cb on cb.faction_id = m.faction_id and cb.btype = 'temple'
      and (cb.faith_id = f.id or cb.faith_id is null)            -- МУЛЬТИ: только храмы этой веры (null=старые)
    where m.role <> 'founder';
    inc_gc := inc_gc + coalesce(tithe_gc, 0);
  end if;

  -- ВЕРА-4: доход моих тайных сект (covert temples) — каждая как храм, +150 ГС
  select count(*) into v_sects from public.faith_sects where owner_fid = p_fid and status = 'active';
  if v_sects > 0 then inc_gc := inc_gc + v_sects * 150; end if;

  if d >= 1 then
    cap := 1000 + coalesce((select sum(slots_open) from public.colony_buildings
                            where faction_id=p_fid and btype='warehouse'),0) * 500;

    -- ВЕРА-4: контрразведка хозяина вскрывает чужие секты на его территории
    if exists(select 1 from public.faith_sects where host_fid = p_fid and status = 'active') then
      v_ci_host := public._spy_ci_power(p_fid, 'hq');
      for sct in select * from public.faith_sects where host_fid = p_fid and status = 'active' loop
        v_new_exp := least(100, sct.exposure + greatest(3, v_ci_host * 12) * d);
        if v_new_exp >= 100 then
          update public.faith_sects set exposure = 100, status = 'exposed', exposed_at = now() where id = sct.id;
          insert into public.faction_relations(from_fid,to_fid,score,updated_at)
            values(p_fid, sct.owner_fid, -10, now())
            on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
          insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
              title, excerpt, body, status, published_at, created_at, updated_at)
            values(p_fid, '🛐 КОНТРРАЗВЕДКА', 'rgba(200,150,40,0.55)', null, null,
              'Вскрыта тайная секта', null,
              format('Контрразведка «%s» раскрыла тайную секту веры «%s», насаждённую фракцией «%s». Ячейка ликвидирована.',
                public._fac_name(p_fid),
                coalesce((select name from public.faiths where id=sct.faith_id),'неизвестной веры'),
                public._fac_name(sct.owner_fid)),
              'approved', now(), now(), now());
        else
          update public.faith_sects set exposure = v_new_exp where id = sct.id;
        end if;
      end loop;
    end if;

    for bld in
      select cb.mining_targets, coalesce(cb.mine_mode,'store') as mine_mode, c.resources as cres
      from public.colony_buildings cb
      join public.colonies c on c.id = cb.colony_id
      where cb.faction_id = p_fid and cb.btype = 'mining'
        and jsonb_array_length(coalesce(cb.mining_targets,'[]'::jsonb)) > 0
        and c.resources is not null and jsonb_array_length(c.resources) > 0
    loop
      for rname in select value from jsonb_array_elements_text(bld.mining_targets) loop
        select value into relem from jsonb_array_elements(bld.cres) where value->>'name' = rname limit 1;
        if relem is null then continue; end if;
        rr := coalesce(relem->>'r','common');
        rate := case rr when 'uncommon' then 12 when 'rare' then 6 when 'epic' then 3 when 'legendary' then 1 else 25 end;
        rate := greatest(1, round(rate * public._richness_mult(relem->>'amt') * m_mine));
        if bld.mine_mode = 'export' then
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(coalesce((mine_flow->>rname)::numeric,0) + rate*d), true);
          flow_rar  := jsonb_set(flow_rar,  array[rname], to_jsonb(rr), true);
        else
          res_add := jsonb_set(res_add, array[rname], to_jsonb(coalesce((res_add->>rname)::numeric,0) + rate*d), true);
        end if;
      end loop;
    end loop;

    for r in select cargo, resource, volume, price, convoy, threats, b_fid, transit_until from public.trade_routes where status='active' and a_fid=p_fid loop
      if r.transit_until is not null and r.transit_until > now() then continue; end if;
      escorted := coalesce(r.convoy,0) > 0; attacked := false;
      for thr in select value from jsonb_array_elements(coalesce(r.threats,'[]'::jsonb)) loop
        if (thr->>'type') = 'ancient' then chance := case when escorted then 0.65 else 0.80 end;
        else chance := case when escorted then 0.40 else 0.80 end; end if;
        if random() < chance then attacked := true; end if;
      end loop;
      if attacked then pirate := true; continue; end if;
      select coalesce(score,0) into rel_score from public.faction_relations where from_fid=p_fid and to_fid=r.b_fid;
      dip_coef := greatest(0.8, least(1.2, 1 + coalesce(rel_score,0)/500.0));

      if jsonb_array_length(coalesce(r.cargo,'[]'::jsonb)) > 0 then
        for citem in select value from jsonb_array_elements(r.cargo) loop
          rname := citem->>'res';
          avail := coalesce((mine_flow->>rname)::numeric, 0);
          shipped := least(coalesce((citem->>'vol')::numeric,0)*d, avail);
          if shipped <= 0 then continue; end if;
          mine_flow := jsonb_set(mine_flow, array[rname], to_jsonb(avail - shipped), true);
          cargo_price := public._res_price(coalesce((select rarity from public.resource_rarity where name=rname),'common'));
          trade_gc := trade_gc + shipped * cargo_price * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*cargo_price*0.5*dip_coef) where faction_id = r.b_fid;
        end loop;
      else
        avail := coalesce((mine_flow->>r.resource)::numeric, 0);
        shipped := least(coalesce(r.volume,0)*d, avail);
        if shipped > 0 then
          mine_flow := jsonb_set(mine_flow, array[r.resource], to_jsonb(avail - shipped), true);
          trade_gc := trade_gc + shipped * coalesce(r.price,0) * dip_coef;
          update public.faction_economy set gc = gc + round(shipped*coalesce(r.price,0)*0.5*dip_coef) where faction_id = r.b_fid;
        end if;
      end if;
    end loop;
    trade_gc := round(trade_gc * m_gc);

    for rname in select jsonb_object_keys(mine_flow) loop
      avail := coalesce((mine_flow->>rname)::numeric, 0);
      if avail > 0 then
        export_gc := export_gc + avail * public._res_value(rname, coalesce(flow_rar->>rname,'common')) * 0.6;
      end if;
    end loop;
    export_gc := round(export_gc * m_gc);

    market_cap := (select coalesce(sum(slots_open),0) from public.colony_buildings
                   where faction_id = p_fid and btype = 'market') * 25 * d;
    if market_cap > 0 then
      for r in
        select res_name, res_rar, avail from (
          select distinct on (q.nm) q.nm as res_name, q.rr as res_rar,
            greatest(0, coalesce((eco.resources->>q.nm)::numeric,0)
                        + coalesce((res_add->>q.nm)::numeric,0)
                        - coalesce((res_sub->>q.nm)::numeric,0)) as avail
          from (
            select (e.value->>'name') as nm, coalesce(e.value->>'r','common') as rr
            from public.colonies c, jsonb_array_elements(c.resources) e
            where c.faction_id = p_fid
          ) q
          order by q.nm, public._res_value(q.nm, q.rr) desc
        ) u
        where avail > 0
        order by public._res_value(res_name, res_rar) desc
      loop
        exit when market_cap <= 0;
        sell := least(r.avail, market_cap);
        res_sub := jsonb_set(res_sub, array[r.res_name],
                     to_jsonb(coalesce((res_sub->>r.res_name)::numeric,0) + sell), true);
        market_gc := market_gc + sell * public._res_value(r.res_name, r.res_rar) *
          (case r.res_rar when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65 when 'uncommon' then 0.55 else 0.5 end);
        market_cap := market_cap - sell;
      end loop;
      market_gc := round(market_gc * m_gc);
    end if;

    merged := coalesce(eco.resources,'{}'::jsonb);
    for k in select jsonb_object_keys(res_add) loop
      merged := jsonb_set(merged, array[k], to_jsonb(least(cap, coalesce((merged->>k)::numeric,0) + (res_add->>k)::numeric)), true);
    end loop;
    for k in select jsonb_object_keys(res_sub) loop
      merged := jsonb_set(merged, array[k], to_jsonb(greatest(0, coalesce((merged->>k)::numeric,0) - (res_sub->>k)::numeric)), true);
    end loop;

    update public.faction_economy
      set gc = greatest(0, gc + round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d),
          science = science + greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
          agents  = agents  + greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
          resources = merged,
          last_tick = last_tick + (d || ' days')::interval
      where faction_id=p_fid returning * into eco;

    insert into public.income_history(faction_id, owner_id, days, gc_build, gc_trade, gc_market, gc_export, gc_policy, gc_net, gc_after, sci, agents_n, mined)
      values(p_fid, eco.owner_id, d,
        round(inc_gc * m_gc * d), trade_gc, market_gc, export_gc, policy_cost * d,
        round(inc_gc * m_gc * d) + trade_gc + market_gc + export_gc - policy_cost * d,
        eco.gc,
        greatest(0, inc_sci    + (mods->>'sci_flat')::numeric)    * d,
        greatest(0, inc_agents + (mods->>'agents_flat')::numeric) * d,
        (select coalesce(sum(value::numeric),0) from jsonb_each_text(res_add)));
    delete from public.income_history where faction_id=p_fid
      and id not in (select id from public.income_history where faction_id=p_fid order by tick_at desc limit 30);
  end if;

  perform public._research_step(p_fid);
  select * into eco from public.faction_economy where faction_id = p_fid;

  return jsonb_build_object('faction_id',eco.faction_id,'gc',eco.gc,'science',eco.science,'agents',eco.agents,
    'resources',eco.resources,'last_tick',eco.last_tick,'days',d, 'mods', mods,
    'income', jsonb_build_object(
      'gc',     round(inc_gc * m_gc),
      'science',greatest(0, inc_sci    + (mods->>'sci_flat')::numeric),
      'agents', greatest(0, inc_agents + (mods->>'agents_flat')::numeric),
      'trade',  trade_gc, 'market', market_gc, 'export', export_gc,
      'policy', policy_cost, 'pirate', pirate));
end$$;
revoke all on function public.economy_accrue(text) from public;

-- ── Проверка после применения ───────────────────────────────
-- select public.faith_found('Вторая вера', 'Догмат', '#3aa0ff', null); -- уже исповедуя другую: ошибка, если уже основатель
-- select public.faith_join('<id чужой открытой веры>');                 -- вступить во вторую
-- select public.economy_build('<colony>', 'temple', '<faith_id>');      -- храм конкретной веры
-- select public.faith_status();   -- поле faiths = массив всех исповедуемых вер
-- select public.faith_leave('<faith_id>');                              -- отречься от одной из вер
