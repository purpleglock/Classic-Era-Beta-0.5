-- ============================================================
-- ЧЛЕНСТВО В ДЕРЖАВЕ + СИСТЕМА ПРАВ (ядро)
-- Применять: node tools/db_run.js _faction_members.sql
-- Затем:     node tools/db_run.js _fm_gates.sql   (обёртки над RPC)
--
-- Идея: активы НИКУДА не переезжают (в отличие от унии). Игрок без своей
-- державы подаёт заявку во фракцию; владелец принимает и выдаёт права.
-- _ec_my_fid() начинает резолвить участника в fid его державы — весь
-- остальной сервер (экономика, войска, войны, шпионаж) видит его как
-- «руку державы» без единой правки. Что именно ему МОЖНО — решает
-- _fm_gate(), навешенный на конечные RPC (см. _fm_gates.sql).
--
-- ПОРЯДОК: после _security_money.sql и _state_union.sql (переопределяет
-- _ec_my_fid / _ec_my_fid_opt). Если те перекатываются позже — перекатить
-- и этот файл, и _fm_gates.sql.
-- ============================================================

-- ── Таблица состава ─────────────────────────────────────────
create table if not exists public.faction_members (
  id uuid primary key default gen_random_uuid(),
  faction_id text not null,
  user_id    uuid not null,
  status     text not null default 'pending'
             check (status in ('pending','active','rejected','left','kicked')),
  role       text not null default 'observer',
  perms      jsonb not null default '[]'::jsonb,   -- ручные флаги поверх роли
  scope_all  boolean not null default false,       -- права на ВСЕ объекты державы
  scope      jsonb not null default '{"systems":[],"fleets":[],"armies":[]}'::jsonb,
  note       text,                                  -- сопроводительное письмо к заявке
  decided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fm_fid_idx  on public.faction_members(faction_id, status);
create index if not exists fm_user_idx on public.faction_members(user_id, status);
-- Один активный контракт на игрока: нельзя служить двум державам разом.
create unique index if not exists fm_one_active  on public.faction_members(user_id) where status = 'active';
-- Одна висящая заявка на пару игрок↔держава.
create unique index if not exists fm_one_pending on public.faction_members(user_id, faction_id) where status = 'pending';

alter table public.faction_members enable row level security;
drop policy if exists "fm_sel" on public.faction_members;
-- Видно: свои строки; весь состав своей державы (владельцу и участникам).
create policy "fm_sel" on public.faction_members for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from public.faction_applications a
               where a.owner_id = auth.uid() and a.status = 'approved'
                 and a.faction_id = faction_members.faction_id)
  or exists (select 1 from public.faction_members m
               where m.user_id = auth.uid() and m.status = 'active'
                 and m.faction_id = faction_members.faction_id)
);
-- DML клиентам не выдаём: только через SECURITY DEFINER RPC ниже.

-- ============================================================
-- СПРАВОЧНИК ПРАВ И РОЛЕЙ
-- ============================================================
-- Коды прав (что можно делать от имени державы):
--   build     строить/сносить/перестраивать в колониях
--   colonize  колонизировать, основывать станции, терраформировать, бросать колонии
--   produce   производить/списывать технику, чинить верфи, заказывать снаряды
--   design    конструкторы: корабли, орудия, реакторы, брони, палубы
--   research  исследования, очередь, обмен технологиями, дерево
--   corp      корпорации: создавать, распускать, вписывать постройки, акции
--   market    рынок и биржа: покупка/продажа, ордера, облигации, деривативы
--   treasury  прямые операции с казной: бюджет, курс державы, займы, казино
--   trade     торговые маршруты, потоки ресурсов, концессии
--   fleet     флоты: формировать, двигать, распускать, рейдить, аванпостовые корабли
--   army      армии: формировать, двигать, распускать
--   battle    командование в тактическом бою (расстановка, ход, огонь)
--   strike    применение стратегического оружия: МЗА, Длань, подпространство, ПРО
--   defense   оборона: мины, дроны, стражи, аванпосты, станции
--   diplo     дипломатия: союзы, вассалитет, границы, признание, реакции
--   war       объявление войны, вступление в чужую, мирные предложения
--   spy       разведка: агенты, операции, пленные, контрразведка
--   faith     вера: основание, догматы, монументы, вступление
--   news      депеши и объявления от имени державы
--   members   управление составом державы и правами (только владелец/соправитель)
create or replace function public._fm_all_perms()
returns text[] language sql immutable as $$
  select array['build','colonize','produce','design','research','corp','market',
               'treasury','trade','fleet','army','battle','strike','defense',
               'diplo','war','spy','faith','news','members']::text[]
$$;

-- Роли-пресеты: набор прав по умолчанию. Ручные флаги (perms) добавляются сверху.
create or replace function public._fm_role_perms(p_role text)
returns text[] language sql immutable as $$
  select case coalesce(p_role,'observer')
    when 'coruler'      then array['build','colonize','produce','design','research','corp','market','treasury','trade','fleet','army','battle','strike','defense','diplo','war','spy','faith','news']
    when 'governor'     then array['build','colonize','produce','corp','trade','defense']
    when 'admiral'      then array['fleet','battle','strike','produce','defense']
    when 'marshal'      then array['army','battle','produce']
    when 'industrialist'then array['corp','design','produce','market','trade']
    when 'treasurer'    then array['treasury','market','trade']
    when 'diplomat'     then array['diplo','news','faith']
    when 'spymaster'    then array['spy']
    when 'scientist'    then array['research','design']
    else array[]::text[]                                    -- observer
  end
$$;

create or replace function public._fm_role_title(p_role text)
returns text language sql immutable as $$
  select case coalesce(p_role,'observer')
    when 'coruler' then 'Соправитель' when 'governor' then 'Наместник'
    when 'admiral' then 'Адмирал' when 'marshal' then 'Маршал'
    when 'industrialist' then 'Промышленник' when 'treasurer' then 'Казначей'
    when 'diplomat' then 'Дипломат' when 'spymaster' then 'Глава разведки'
    when 'scientist' then 'Учёный совет' else 'Наблюдатель' end
$$;

-- ============================================================
-- РЕЗОЛВ ЛИЧНОСТИ
-- ============================================================
-- Своя одобренная держава (владелец) — приоритет над членством.
create or replace function public._fm_own_fid()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
$$;

-- Активное членство (строка) текущего игрока.
create or replace function public._fm_my_row()
returns public.faction_members language sql stable security definer set search_path=public as $$
  select * from public.faction_members
    where user_id = auth.uid() and status = 'active'
    order by updated_at desc limit 1
$$;

create or replace function public._fm_member_fid()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.faction_members
    where user_id = auth.uid() and status = 'active'
    order by updated_at desc limit 1
$$;

-- ── ПЕРЕОПРЕДЕЛЕНИЕ: свой fid → иначе fid державы, где служу ──
create or replace function public._ec_my_fid()
returns text language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._fm_own_fid();
  if fid is null then fid := public._fm_member_fid(); end if;
  if fid is null then raise exception 'no approved faction'; end if;
  return coalesce(public._su_lead_of(fid), fid);
end$$;

create or replace function public._ec_my_fid_opt()
returns text language sql stable security definer set search_path=public as $$
  select coalesce(public._fm_own_fid(), public._fm_member_fid())
$$;

-- ============================================================
-- ПРОВЕРКА ПРАВ
-- ============================================================
-- Эффективные права игрока: роль ∪ ручные флаги. Владелец — всё.
create or replace function public._fm_my_perms()
returns text[] language plpgsql stable security definer set search_path=public as $$
declare m public.faction_members; out_p text[];
begin
  if public._fm_own_fid() is not null then return public._fm_all_perms(); end if;
  m := public._fm_my_row();
  if m.id is null then return array[]::text[]; end if;
  select coalesce(array_agg(distinct x), array[]::text[]) into out_p from (
    select unnest(public._fm_role_perms(m.role)) x
    union all
    select jsonb_array_elements_text(coalesce(m.perms,'[]'::jsonb))
  ) s;
  return out_p;
end$$;

-- Попадает ли объект в закреплённый за игроком список.
-- p_kind: 'sys' | 'fleet' | 'army'; scope_all=true снимает ограничение.
create or replace function public._fm_in_scope(m public.faction_members, p_kind text, p_ref text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare arr jsonb; key text;
begin
  if p_kind is null or p_ref is null then return true; end if;
  if coalesce(m.scope_all, false) then return true; end if;
  key := case p_kind when 'sys' then 'systems' when 'fleet' then 'fleets'
                     when 'army' then 'armies' else null end;
  if key is null then return true; end if;
  arr := coalesce(m.scope -> key, '[]'::jsonb);
  -- Пустой список при scope_all=false = «ничего не закреплено» → запрет.
  if jsonb_array_length(arr) = 0 then return false; end if;
  return exists (select 1 from jsonb_array_elements_text(arr) v where v = p_ref);
end$$;

-- ── ГЛАВНЫЙ ГЕЙТ ────────────────────────────────────────────
-- Вызывается обёрткой перед оригиналом RPC. Пропускает:
--   • серверный контекст (auth.uid() is null — крон, тик, служебные вызовы);
--   • администрацию (superadmin/editor);
--   • владельца своей державы;
--   • участника, у которого есть право p_code и объект в его зоне ответственности.
create or replace function public._fm_gate(p_code text, p_kind text default null, p_ref text default null)
returns void language plpgsql stable security definer set search_path=public as $$
declare m public.faction_members; sys text; perms text[];
begin
  if auth.uid() is null then return; end if;
  begin
    if exists (select 1 from public.user_roles where user_id = auth.uid()
                 and coalesce(role,'') in ('superadmin','editor')) then return; end if;
  exception when others then null; end;
  if public._fm_own_fid() is not null then return; end if;   -- сам себе держава
  m := public._fm_my_row();
  if m.id is null then return; end if;   -- не участник: пусть решает старая проверка fid

  perms := public._fm_my_perms();
  if not (p_code = any(perms)) then
    raise exception 'forbidden: нет права «%» в державе (роль: %)',
      p_code, public._fm_role_title(m.role) using errcode = '42501';
  end if;

  -- Привязка к объекту: колонию/постройку сводим к системе.
  sys := p_ref;
  if p_kind = 'colony' then
    select c.system_id into sys from public.colonies c where c.id = p_ref::uuid;
    p_kind := 'sys';
  elsif p_kind = 'bld' then
    select c.system_id into sys from public.colony_buildings b
      join public.colonies c on c.id = b.colony_id where b.id = p_ref::uuid;
    p_kind := 'sys';
  end if;
  if sys is null then return; end if;   -- объект не нашли — пусть ругается оригинал

  if not public._fm_in_scope(m, p_kind, sys) then
    raise exception 'forbidden: объект вне вашей зоны ответственности'
      using errcode = '42501';
  end if;
end$$;

-- ============================================================
-- RPC СОСТАВА
-- ============================================================
-- Держава, которой я владею (иначе исключение) — для владельческих операций.
create or replace function public._fm_owner_fid()
returns text language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._fm_own_fid();
  if fid is null then raise exception 'только владелец державы'; end if;
  return fid;
end$$;

-- Нормализация набора флагов: отсекаем неизвестные коды.
create or replace function public._fm_clean_perms(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce((select jsonb_agg(distinct v) from jsonb_array_elements_text(coalesce(p,'[]'::jsonb)) v
                    where v = any(public._fm_all_perms())), '[]'::jsonb)
$$;

create or replace function public._fm_clean_scope(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'systems', coalesce(p->'systems','[]'::jsonb),
    'fleets',  coalesce(p->'fleets','[]'::jsonb),
    'armies',  coalesce(p->'armies','[]'::jsonb))
$$;

-- ── Мой статус: играю за себя / служу державе / жду ответа ──
create or replace function public.fm_me()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.faction_members; own text; pend jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('anon', true); end if;
  own := public._fm_own_fid();
  m   := public._fm_my_row();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'faction_id', r.faction_id, 'created_at', r.created_at,
           'faction_name', (select a.name from public.faction_applications a
                              where a.faction_id = r.faction_id and a.status='approved' limit 1))), '[]'::jsonb)
    into pend from public.faction_members r
    where r.user_id = auth.uid() and r.status = 'pending';
  return jsonb_build_object(
    'own_fid', own,
    'is_owner', own is not null,
    -- сколько заявок ждёт МОЕГО решения (бейдж на вкладке «Двор»)
    'inbox', case when own is null then 0 else
      (select count(*) from public.faction_members r
         where r.faction_id = own and r.status = 'pending') end,
    'membership', case when m.id is null then null else jsonb_build_object(
        'id', m.id, 'faction_id', m.faction_id, 'role', m.role,
        'role_title', public._fm_role_title(m.role),
        'scope_all', m.scope_all, 'scope', m.scope,
        'faction_name', (select a.name from public.faction_applications a
                           where a.faction_id = m.faction_id and a.status='approved' limit 1),
        'faction_color', (select a.color from public.faction_applications a
                            where a.faction_id = m.faction_id and a.status='approved' limit 1),
        'herald_url', (select a.herald_url from public.faction_applications a
                         where a.faction_id = m.faction_id and a.status='approved' limit 1)) end,
    'perms', to_jsonb(public._fm_my_perms()),
    'pending', pend);
end$$;

-- ── Подать заявку в державу ─────────────────────────────────
create or replace function public.fm_apply(p_fid text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare nm text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'не авторизован'; end if;
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if public._fm_own_fid() is not null then
    raise exception 'у вас своя держава — сначала откажитесь от неё, чтобы служить чужой';
  end if;
  if public._fm_member_fid() is not null then
    raise exception 'вы уже служите державе — сначала выйдите из состава';
  end if;
  select name into nm from public.faction_applications
    where faction_id = p_fid and status = 'approved' limit 1;
  if nm is null then raise exception 'держава не найдена'; end if;
  -- Повторная заявка после отказа/ухода: оживляем старую строку.
  update public.faction_members
     set status='pending', note=left(coalesce(p_note,''),1000), updated_at=now()
   where user_id = auth.uid() and faction_id = p_fid and status in ('rejected','left','kicked')
   returning id into v_id;
  if v_id is null then
    insert into public.faction_members(faction_id, user_id, note)
      values (p_fid, auth.uid(), left(coalesce(p_note,''),1000))
      returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'faction_name', nm);
end$$;

-- ── Отозвать свою заявку ────────────────────────────────────
create or replace function public.fm_withdraw(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  delete from public.faction_members where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'заявка не найдена'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Выйти из состава державы ────────────────────────────────
create or replace function public.fm_leave()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.faction_members set status='left', updated_at=now()
    where user_id = auth.uid() and status='active';
  if not found then raise exception 'вы не состоите в державе'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Состав и заявки моей державы (для владельца) ────────────
create or replace function public.fm_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._fm_owner_fid();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'user_id', m.user_id, 'status', m.status,
      'role', m.role, 'role_title', public._fm_role_title(m.role),
      'role_perms', to_jsonb(public._fm_role_perms(m.role)),
      'perms', m.perms, 'scope_all', m.scope_all, 'scope', m.scope,
      'note', m.note, 'created_at', m.created_at,
      'name', coalesce(nullif(p.display_name,''), nullif(split_part(coalesce(p.email,''), '@', 1),''), 'Игрок'),
      'avatar_url', p.avatar_url)
      order by (m.status='pending') desc, m.created_at asc)
    from public.faction_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.faction_id = fid and m.status in ('pending','active')
  ), '[]'::jsonb);
end$$;

-- ── Принять / отклонить заявку ──────────────────────────────
create or replace function public.fm_respond(
  p_id uuid, p_accept boolean,
  p_role text default 'observer', p_perms jsonb default '[]'::jsonb,
  p_scope_all boolean default false, p_scope jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.faction_members;
begin
  fid := public._fm_owner_fid();
  select * into m from public.faction_members where id = p_id and faction_id = fid and status = 'pending';
  if m.id is null then raise exception 'заявка не найдена'; end if;
  if not p_accept then
    update public.faction_members set status='rejected', decided_by=auth.uid(), updated_at=now() where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  -- Игрок мог за это время завести свою державу или уйти служить другой.
  if exists (select 1 from public.faction_applications a
               where a.owner_id = m.user_id and a.status='approved') then
    raise exception 'игрок за это время основал свою державу';
  end if;
  if exists (select 1 from public.faction_members x
               where x.user_id = m.user_id and x.status='active') then
    raise exception 'игрок уже служит другой державе';
  end if;
  update public.faction_members set
      status = 'active', role = coalesce(p_role,'observer'),
      perms = public._fm_clean_perms(p_perms),
      scope_all = coalesce(p_scope_all,false),
      scope = public._fm_clean_scope(coalesce(p_scope, m.scope)),
      decided_by = auth.uid(), updated_at = now()
    where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'active');
end$$;

-- ── Переписать права участника ──────────────────────────────
create or replace function public.fm_set(
  p_id uuid, p_role text, p_perms jsonb,
  p_scope_all boolean default false, p_scope jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._fm_owner_fid();
  update public.faction_members set
      role = coalesce(p_role, role),
      perms = public._fm_clean_perms(p_perms),
      scope_all = coalesce(p_scope_all,false),
      scope = public._fm_clean_scope(coalesce(p_scope, scope)),
      updated_at = now()
    where id = p_id and faction_id = fid and status = 'active';
  if not found then raise exception 'участник не найден'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Исключить из состава ────────────────────────────────────
create or replace function public.fm_kick(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._fm_owner_fid();
  update public.faction_members set status='kicked', updated_at=now()
    where id = p_id and faction_id = fid and status='active';
  if not found then raise exception 'участник не найден'; end if;
  return jsonb_build_object('ok', true);
end$$;

-- ── Объекты для закрепления: системы, флоты, армии державы ──
create or replace function public.fm_assets()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := public._fm_owner_fid();
  fid := coalesce(public._su_lead_of(fid), fid);
  return jsonb_build_object(
    'systems', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
                           from public.map_systems s where s.faction = fid), '[]'::jsonb),
    'fleets',  coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.name)
                           from public.fleets f where f.faction_id = fid), '[]'::jsonb),
    'armies',  coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name)
                           from public.armies a where a.faction_id = fid), '[]'::jsonb));
end$$;

-- ── Список держав, куда можно проситься ─────────────────────
create or replace function public.fm_open_factions()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'faction_id', a.faction_id, 'name', a.name, 'color', a.color,
      'herald_url', a.herald_url, 'gov', a.gov, 'race', a.race,
      'members', (select count(*) from public.faction_members m
                    where m.faction_id = a.faction_id and m.status='active'))
      order by a.name), '[]'::jsonb)
  from public.faction_applications a where a.status = 'approved'
$$;

grant execute on function public.fm_me()            to authenticated;
grant execute on function public.fm_apply(text,text) to authenticated;
grant execute on function public.fm_withdraw(uuid)  to authenticated;
grant execute on function public.fm_leave()         to authenticated;
grant execute on function public.fm_list()          to authenticated;
grant execute on function public.fm_respond(uuid,boolean,text,jsonb,boolean,jsonb) to authenticated;
grant execute on function public.fm_set(uuid,text,jsonb,boolean,jsonb) to authenticated;
grant execute on function public.fm_kick(uuid)      to authenticated;
grant execute on function public.fm_assets()        to authenticated;
grant execute on function public.fm_open_factions() to authenticated;

-- ============================================================
-- УНИЯ ГОСУДАРСТВ УПРАЗДНЕНА
-- Новые унии не заключаются: их место заняло членство с правами.
-- Действующие продолжают работать; su_dissolve с реституцией доступен.
-- ============================================================
create or replace function public.su_propose(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Старая уния упразднена. Объединить две ГОТОВЫЕ державы в одно государство — annex_propose (вкладка «Союзы» → «Объединение держав»); принять игрока БЕЗ державы к себе на службу — состав державы.';
end$$;
