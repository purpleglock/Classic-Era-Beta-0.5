-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА · ТЕСТОВЫЙ НАЗЕМНЫЙ БОЙ С БОТОМ (админка → «🧪 Тест»)  19.10.2026
-- ------------------------------------------------------------
-- Песочница по образцу «Тестового боя с ботами»: стафф — десант, бот садится
-- за оборону выбранной державы. Оборону собирает с её колонии (столица или
-- самая населённая): ополчение по населению, оборонительные постройки,
-- узел обороны; по желанию — гарнизон из тестовых проектов.
-- НИЧЕГО НЕ ОТНИМАЕТ: у боя нет колонии (colony_id пуст), армий и войны;
-- итог не пишет новостей, не ставит оккупацию, не трогает экономику.
-- Свою сторону стафф выкладывает из тестового каталога наземки — отрядами
-- (пехота по 100, техника по 10), бот ходит сам (легион-тик раз в минуту
-- или кнопка «Ход ботов»). Повторное создание сносит прежнюю доску.
-- Тестовые проекты принадлежат 'ground_test': заказать их нельзя.
-- Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════

create table if not exists public.admin_ground_duel (
  one        int primary key default 1 check (one = 1),
  battle_id  uuid,
  bot_as     text,
  colony_id  uuid,
  created_at timestamptz not null default now()
);
alter table public.admin_ground_duel enable row level security;

-- ── Тестовый каталог наземки ─────────────────────────────────
create or replace function public._ground_test_designs() returns setof uuid
language plpgsql security definer set search_path = public as $$
declare r record; v uuid;
begin
  for r in select * from (values
    ('Тест: пехотинец',      'peh',       '{"hp":177,"dmg":36,"rng":5,"speed":2,"armor":0,"shield":10,"radar":8,"cost":100}'),
    ('Тест: БТР',            'btr',       '{"hp":420,"dmg":90,"rng":5,"speed":5,"armor":20,"shield":40,"radar":8,"cost":400}'),
    ('Тест: танк',           'tanki',     '{"hp":1165,"dmg":266,"rng":4,"speed":4,"armor":40,"shield":100,"radar":8,"cost":1000}'),
    ('Тест: артиллерия',     'arta',      '{"hp":300,"dmg":420,"rng":9,"speed":2,"armor":10,"shield":0,"radar":10,"cost":900}'),
    ('Тест: тяжёлый шагоход','walker',    '{"hp":3000,"dmg":520,"rng":5,"speed":3,"armor":80,"shield":300,"radar":9,"cost":3000}')
  ) t(nm, cls, sm) loop
    select id into v from public.faction_units where faction_id = 'ground_test' and name = r.nm limit 1;
    if v is null then
      insert into public.faction_units(category, name, faction_id, faction_name, summary, data)
        values ('ground', r.nm, 'ground_test', 'Тестовый каталог', r.sm::jsonb,
                jsonb_build_object('class', r.cls, 'test', true))
        returning id into v;
    end if;
    return next v;
  end loop;
end $$;
revoke all on function public._ground_test_designs() from public, anon, authenticated;

create or replace function public._ground_is_sandbox(p_battle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (pk->>'sandbox')::boolean from public.battles where id = p_battle), false)
$$;

-- Размер отряда по умолчанию, если клиент его не прислал
create or replace function public._ground_default_stack(p_unit uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when (select data->>'class' from public.faction_units where id = p_unit) = 'peh' then 100 else 10 end
$$;

-- ── Резерв: в песочнице у стаффа полный тестовый каталог ─────
create or replace function public._ground_pool(p_battle uuid, p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '[]'::jsonb; r record; used int; st jsonb;
begin
  if public._ground_is_sandbox(p_battle)
     and p_fid = (select attacker_fid from public.battles where id = p_battle) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'unit_id', fu.id, 'unit_name', fu.name, 'free', 9999, 'cost', coalesce((fu.summary->>'cost')::numeric, 0),
      'cls', public._bt_stats(fu.id)->>'cls', 'hp', public._bt_stats(fu.id)->'hp', 'dmg', public._bt_stats(fu.id)->'dmg',
      'speed', public._bt_stats(fu.id)->'speed', 'rng', public._bt_stats(fu.id)->'rng',
      'shield', public._bt_stats(fu.id)->'shield', 'armor', public._bt_stats(fu.id)->'armor',
      'sensor', public._bt_stats(fu.id)->'sensor', 'stealth', public._bt_stats(fu.id)->'stealth',
      'wpn', '[]'::jsonb, 'acts', '[]'::jsonb, 'stack', true, 'stack_default', public._ground_default_stack(fu.id))
      order by coalesce((fu.summary->>'cost')::numeric, 0)), '[]'::jsonb)
      into res
      from public.faction_units fu where fu.faction_id = 'ground_test';
    return res;
  end if;

  for r in
    select nullif(c->>'unit_id','')::uuid uid, coalesce(c->>'unit_name','Юнит') nm,
           sum(greatest(0, coalesce((c->>'qty')::int, 0))) qty
      from public.ground_battle_armies g
      join public.armies a on a.id = g.army_id
      cross join lateral jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) c
     where g.battle_id = p_battle and g.fid = p_fid
       and coalesce(nullif(c->>'category',''),'ground') = 'ground'
       and nullif(c->>'unit_id','') is not null
     group by 1, 2
  loop
    select coalesce(sum(coalesce((u.pk->>'n')::int, 1)), 0) into used
      from public.battle_units u where u.battle_id = p_battle and u.fid = p_fid and u.unit_id = r.uid;
    if r.qty - used <= 0 then continue; end if;
    st := public._bt_stats(r.uid);
    if st is null then continue; end if;
    res := res || jsonb_build_array(jsonb_build_object(
      'unit_id', r.uid, 'unit_name', r.nm, 'free', r.qty - used,
      'cost', (select coalesce((fu.summary->>'cost')::numeric, 0) from public.faction_units fu where fu.id = r.uid),
      'cls', st->>'cls', 'hp', st->'hp', 'dmg', st->'dmg', 'speed', st->'speed', 'rng', st->'rng',
      'shield', st->'shield', 'armor', st->'armor', 'sensor', st->'sensor', 'stealth', st->'stealth',
      'wpn', coalesce(st->'wpn','[]'::jsonb), 'acts', '[]'::jsonb, 'stack', true,
      'stack_default', least(r.qty - used, public._ground_default_stack(r.uid))));
  end loop;
  return res;
end $$;

-- ── Расстановка: без n — отряд по умолчанию (пехота 100, техника 10) ──
create or replace function public._ground_deploy(p_battle uuid, p_units jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; sd text; b record; e jsonb; uid uuid; px int; py int; n int; k int := 0;
        free int; sk text; cnt int; pool jsonb;
begin
  perform public._bt_ensure_field(p_battle);
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle for update;
  if b.status <> 'forming' then raise exception 'состав уже утверждён — бой идёт'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;
  if (sd = 'attacker' and b.att_ready) or (sd = 'defender' and b.def_ready) then
    raise exception 'вы уже подтвердили состав';
  end if;
  sk := case when sd = 'attacker' then 'att' else 'def' end;

  delete from public.battle_units where battle_id = p_battle and fid = me;

  for e in select value from jsonb_array_elements(coalesce(p_units,'[]'::jsonb)) loop
    uid := nullif(e->>'unit_id','')::uuid;
    px  := coalesce((e->>'x')::int, -1);
    py  := coalesce((e->>'y')::int, -1);
    if uid is null then continue; end if;
    if px < 0 or px >= public._bt_w() or py < 0 or py >= public._bt_h() then raise exception 'клетка вне доски'; end if;
    if not public._bt_in_arena(b.shape, px, py) then raise exception 'клетка %:% вне поля', px, py; end if;
    if not coalesce(public._bt_in_spawn(b.spawn, sk, px, py), true) then
      raise exception 'клетка %:% вне вашей зоны высадки', px, py;
    end if;
    pool := public._ground_pool(p_battle, me);
    select coalesce((p->>'free')::int, 0) into free
      from jsonb_array_elements(pool) p where (p->>'unit_id')::uuid = uid;
    free := coalesce(free, 0);
    n := coalesce((e->>'n')::int, least(free, public._ground_default_stack(uid)));
    n := greatest(1, n);
    if free < n then
      raise exception 'в резерве не хватает юнитов «%»: нужно %, есть %', coalesce(e->>'unit_name','проект'), n, free;
    end if;
    if exists (select 1 from public.battle_units where battle_id = p_battle and alive and x = px and y = py) then
      raise exception 'клетка %:% уже занята', px, py;
    end if;
    perform public._ground_place(p_battle, me, sd, uid, n, px, py);
    k := k + 1;
    if k > public._bt_cap() then raise exception 'на поле можно вывести не больше % отрядов', public._bt_cap(); end if;
  end loop;
  select count(*) into cnt from public.battle_units where battle_id = p_battle and fid = me;
  return jsonb_build_object('ok', true, 'deployed', cnt);
end $$;

-- ── Создать / перезапустить песочницу ────────────────────────
create or replace function public.admin_ground_battle(p_bot_fid text, p_garrison int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text; bot text := public._bt_bot_fid(); old uuid; c public.colonies; bid uuid;
        total int; stacks int; i int; n int; xy int[]; placed int := 0; mult numeric := 1;
        r record; nbld int; designs uuid[]; g int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  me := public._ec_my_fid();
  if me is null then raise exception 'нет фракции у текущего пользователя'; end if;

  select * into c from public.colonies
   where faction_id = p_bot_fid order by is_capital desc nulls last, pop desc nulls last limit 1;
  if c.id is null then raise exception 'у державы нет колоний — обороне не с чего собраться'; end if;

  select battle_id into old from public.admin_ground_duel where one = 1;
  if old is not null then delete from public.battles where id = old; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind, att_ready, def_ready, pk)
    values (c.system_id, me, bot, 'forming', 'ground', false, true,
            jsonb_build_object('sandbox', true, 'no_militia', true, 'bot_as', p_bot_fid, 'ref_colony', c.id))
    returning id into bid;
  perform public._bt_ensure_field(bid);

  -- оборона колонии, но за неё ходит бот
  if exists (select 1 from public.colony_buildings where colony_id = c.id and btype = 'training') then
    mult := public._ground_const('training_mult');
  end if;
  total  := greatest(public._ground_const('militia_min')::int,
                     round(coalesce(c.pop, 0) * public._ground_const('militia_per_pop') * mult)::int);
  stacks := public._ground_const('militia_stacks')::int;
  for i in 1..stacks loop
    n := ceil(total::numeric / (stacks - i + 1))::int;
    xy := public._ground_free_cell(bid, 'defender');
    exit when xy is null or n <= 0;
    perform public._ground_place(bid, bot, 'defender', public._ground_npc_design('militia'), n, xy[1], xy[2]);
    total := total - n; placed := placed + 1;
  end loop;
  for r in select btype from public.colony_buildings
            where colony_id = c.id and btype in ('flak','abm','nemesis','doomgun') limit 20 loop
    xy := public._ground_free_cell(bid, 'defender', 2);
    exit when xy is null;
    perform public._ground_place(bid, bot, 'defender', public._ground_npc_design(r.btype), 1, xy[1], xy[2]);
    placed := placed + 1;
  end loop;
  select count(*) into nbld from public.colony_buildings where colony_id = c.id;
  xy := public._ground_free_cell(bid, 'defender');
  if xy is not null then
    perform public._ground_place(bid, bot, 'defender', public._ground_npc_design('hq'), 1, xy[1], xy[2],
                                 2000 + nbld * public._ground_const('hq_hp_per_bld'));
    placed := placed + 1;
  end if;

  -- гарнизон бота из тестового каталога: пехота и танки по очереди
  select array_agg(id) into designs from (select * from public._ground_test_designs() id) q;
  for g in 1..least(20, greatest(0, coalesce(p_garrison, 0))) loop
    xy := public._ground_free_cell(bid, 'defender', 2);
    exit when xy is null;
    if g % 2 = 1 then
      perform public._ground_place(bid, bot, 'defender', designs[1], 100, xy[1], xy[2]);
    else
      perform public._ground_place(bid, bot, 'defender', designs[3], 10, xy[1], xy[2]);
    end if;
    placed := placed + 1;
  end loop;

  perform public._bt_log(bid, format(
    '🪖 Тестовый наземный бой: бот держит оборону колонии %s державы %s (%s отрядов). '
    || 'Ты — десант: выложи отряды из тестового каталога в своей зоне высадки и жми «В бой». Ничего не отнимается.',
    coalesce('«' || c.planet_name || '»', ''), public._war_nm(p_bot_fid), placed));

  insert into public.admin_ground_duel(one, battle_id, bot_as, colony_id) values (1, bid, p_bot_fid, c.id)
    on conflict (one) do update set battle_id = excluded.battle_id, bot_as = excluded.bot_as,
                                    colony_id = excluded.colony_id, created_at = now();
  return jsonb_build_object('ok', true, 'battle_id', bid, 'placed', placed,
    'colony', c.planet_name, 'bot_as', p_bot_fid, 'bot_fname', public._war_nm(p_bot_fid));
end $$;
revoke all on function public.admin_ground_battle(text, int) from public, anon;
grant execute on function public.admin_ground_battle(text, int) to authenticated;

create or replace function public.admin_ground_battle_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.admin_ground_duel; b public.battles;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  select * into t from public.admin_ground_duel where one = 1;
  if t.battle_id is null then return jsonb_build_object('battle_id', null); end if;
  select * into b from public.battles where id = t.battle_id;
  if b.id is null then return jsonb_build_object('battle_id', null); end if;
  return jsonb_build_object('battle_id', b.id, 'status', b.status, 'side_to_move', b.side_to_move,
    'turn', b.turn_no, 'att_left', b.att_turns_left, 'def_left', b.def_turns_left,
    'winner', case when b.status = 'done' then coalesce(public._war_nm(b.winner_fid), 'ничья') end,
    'bot_as', t.bot_as, 'bot_fname', public._war_nm(t.bot_as),
    'bot_turn', b.side_to_move = 'defender');
end $$;
revoke all on function public.admin_ground_battle_state() from public, anon;
grant execute on function public.admin_ground_battle_state() to authenticated;

-- ── Врезки: песочница не пишет итогов и не трогается планировщиком ──
do $$
declare d text;
begin
  d := pg_get_functiondef('public._ground_finish(uuid,text)'::regprocedure);
  if position('sandbox' in d) = 0 then
    execute replace(d, 'if b.id is null or b.status = ''done'' then return; end if;',
      'if b.id is null or b.status = ''done'' then return; end if;
  if coalesce((b.pk->>''sandbox'')::boolean, false) then
    update public.battles set status = ''done'', winner_fid = p_winner, ended_at = now(), side_to_move = null
     where id = p_battle;
    perform public._bt_log(p_battle, case when p_winner is null then ''Тестовый бой окончен вничью.''
      when p_winner = b.attacker_fid then ''Тестовый бой: десант взял колонию.''
      else ''Тестовый бой: оборона устояла.'' end);
    return;
  end if;');
  end if;

  d := pg_get_functiondef('public._ground_battle_tick()'::regprocedure);
  if position('sandbox' in d) = 0 then
    execute replace(d, 'where kind = ''ground'' and status = ''forming'' order by created_at',
                       'where kind = ''ground'' and status = ''forming''
                    and not coalesce((pk->>''sandbox'')::boolean, false) order by created_at');
  end if;

  -- если этап 3 ещё не прогнан: песочнице всё равно нельзя поднимать ополчение колонии
  d := pg_get_functiondef('public._ground_npc_deploy(uuid)'::regprocedure);
  if position('no_militia' in d) = 0 then
    execute replace(d, 'if b.kind <> ''ground'' or b.status <> ''forming'' then return 0; end if;',
      'if b.kind <> ''ground'' or b.status <> ''forming'' then return 0; end if;
  if coalesce((b.pk->>''no_militia'')::boolean, false) then return 0; end if;');
  end if;
end $$;

select count(*) from public._ground_test_designs();
