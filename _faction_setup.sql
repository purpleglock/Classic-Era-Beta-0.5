-- ============================================================
-- РЕГИСТРАЦИЯ ГОСУДАРСТВ — таблица анкет, RLS, RPC одобрения
-- Выполнить целиком в Supabase → SQL Editor
-- Требует: функция public.current_user_role() (создана ранее),
--          таблицы public.map_systems / public.map_factions
-- ============================================================

create table if not exists public.faction_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  owner_email text,
  status text default 'draft',                 -- draft | pending | approved | rejected
  name text,
  color text,                                  -- rgba(...) для карты
  gov text, regime text, leader text, civ_type text,
  system_id text references public.map_systems(id) on delete set null,
  system_name text, planet_name text,
  buildings jsonb default '[]'::jsonb,
  bonus_money boolean default false,
  race text, ideology text, culture text, history text, link text, herald_url text,
  faction_id text, reviewed_by text, reject_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- флаг «внесены изменения, ждут проверки» (для редактирования уже одобренной)
alter table public.faction_applications add column if not exists pending_review boolean default false;

alter table public.faction_applications enable row level security;

drop policy if exists "fa_select" on public.faction_applications;
drop policy if exists "fa_insert" on public.faction_applications;
drop policy if exists "fa_update" on public.faction_applications;
drop policy if exists "fa_delete" on public.faction_applications;

-- читать: одобренные — всем; свою — автор; все — стафф
create policy "fa_select" on public.faction_applications for select to public
  using (status = 'approved'
         or owner_id = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));

-- создавать: только от своего имени
create policy "fa_insert" on public.faction_applications for insert to authenticated
  with check (owner_id = auth.uid());

-- править: автор (свою) или стафф
create policy "fa_update" on public.faction_applications for update to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'))
  with check (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor'));

-- удалять: автор только черновик, либо стафф
create policy "fa_delete" on public.faction_applications for delete to authenticated
  using ((owner_id = auth.uid() and status = 'draft')
         or public.current_user_role() in ('superadmin','editor'));

-- ── RPC: одобрение анкеты (атомарно) ──
create or replace function public.approve_faction_application(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare app public.faction_applications; fid text; cap public.colonies;
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: only superadmin/editor can approve';
  end if;
  select * into app from public.faction_applications where id = p_id;
  if not found then raise exception 'application not found'; end if;

  fid := 'fac_' || left(replace(p_id::text, '-', ''), 10);

  -- фракция на карте (цвет уже rgba)
  insert into public.map_factions (id, name, color, sort)
    values (fid, coalesce(app.name, 'Фракция'), coalesce(app.color, 'rgba(120,140,170,0.3)'), 100)
    on conflict (id) do update set name = excluded.name, color = excluded.color;

  -- занять столичную систему на карте (спавн столицы на карте)
  if app.system_id is not null then
    update public.map_systems set faction = fid where id = app.system_id;
    -- авто-синхрон: колонии, оказавшиеся в системах, которыми фракция НЕ владеет
    -- (напр. после переезда через редактор карты), переносим в столичную систему.
    update public.colonies set system_id = app.system_id
      where faction_id = fid
        and system_id is distinct from app.system_id
        and system_id not in (select id from public.map_systems where faction = fid);
  end if;

  -- применить новое имя столичной планеты из анкеты (переименование через модерацию):
  -- меняем и реальную столичную колонию, и запись планеты на карте — единый источник.
  if app.planet_name is not null and app.planet_name <> '' then
    select * into cap from public.colonies where faction_id = fid
      order by is_capital desc, (planet_type = 'Столичный мир') desc, created_at asc limit 1;
    if found and cap.planet_name is distinct from app.planet_name then
      -- переименовываем КОНКРЕТНУЮ планету по pid (если есть), иначе по имени —
      -- иначе одноимённый двойник в системе переименовался бы заодно.
      update public.map_systems ms set planets = (
        select jsonb_agg(
          case when (case when cap.planet_pid is not null
                          then (e->>'pid')::int = cap.planet_pid
                          else e->>'name' = cap.planet_name end)
               then jsonb_set(e, '{name}', to_jsonb(app.planet_name)) else e end)
        from jsonb_array_elements(ms.planets) e)
        where ms.id = cap.system_id
          and exists (select 1 from jsonb_array_elements(ms.planets) e2
                      where (case when cap.planet_pid is not null
                                  then (e2->>'pid')::int = cap.planet_pid
                                  else e2->>'name' = cap.planet_name end));
      update public.colonies set planet_name = app.planet_name where id = cap.id;
    end if;
  end if;

  -- статус анкеты (сбрасываем флаг изменений)
  update public.faction_applications
    set status = 'approved', pending_review = false, faction_id = fid, reviewed_by = auth.jwt() ->> 'email', updated_at = now()
    where id = p_id;

  -- роль игрока (не понижая стафф/суперадмина). ВАЖНО: у зрителя часто НЕТ строки
  -- в user_roles (роль 'viewer' проставляется только в JS), поэтому одного UPDATE мало —
  -- создаём строку, если её нет, иначе локации остаются невидимыми для игрока.
  update public.user_roles set role = 'player' where user_id = app.owner_id and role = 'viewer';
  if not found and not exists (select 1 from public.user_roles where user_id = app.owner_id) then
    insert into public.user_roles (user_id, role) values (app.owner_id, 'player');
  end if;

  return fid;
end$$;

revoke all on function public.approve_faction_application(uuid) from public;
grant execute on function public.approve_faction_application(uuid) to authenticated;

-- Бэкфилл: выдать роль 'player' всем владельцам уже одобренных анкет, у кого её нет
-- (исправляет тех, кого одобрили до починки UPSERT — иначе они не видят локации).
insert into public.user_roles (user_id, role)
  select distinct a.owner_id, 'player'
  from public.faction_applications a
  where a.status = 'approved' and a.owner_id is not null
    and not exists (select 1 from public.user_roles ur where ur.user_id = a.owner_id);
update public.user_roles ur set role = 'player'
  from public.faction_applications a
  where a.status = 'approved' and a.owner_id = ur.user_id and ur.role = 'viewer';
