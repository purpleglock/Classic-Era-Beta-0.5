-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА, ЭТАП 2 — НАЗЕМНЫЙ БОЙ НА АРЕНЕ  (19.10.2026)
-- ------------------------------------------------------------
-- Наземный бой (battles.kind = 'ground', его открывает высадка этапа 1)
-- идёт на том же движке арены, что и космос: доска, ходы, огонь, ИИ.
-- Отличия от космоса:
--   • ОТРЯДЫ. На доске стоит не один юнит, а отряд из n юнитов одного
--     проекта (battle_units.pk->'n'). Корпус и урон отряда = n × юнит.
--     Потери считаются по доле снятого корпуса.
--   • СОСТАВ. Резерв стороны — армии в бою (ground_battle_armies), только
--     наземные юниты; авиация заморожена и в бой не идёт.
--   • ОБОРОНА БЕЗ АРМИИ. За колонию всегда стоят ополчение (по населению,
--     центр подготовки делает его крепче), оборонительные постройки (ПВО,
--     ПРО, «Немезида», Гиперпейсер — неподвижные точки огня) и узел обороны
--     колонии — обязательная цель. Ими ходит только ИИ: держава
--     'ground_militia' — союзник защитника, записанный в battle_ai_fids.
--   • ЛИМИТ ХОДОВ. По 10 ходов на сторону; не добил — ничья, десант отходит.
--   • ПОБЕДА. Сторона, у которой на доске не осталось живых отрядов,
--     проиграла. Невыставленный резерв проигравшего гибнет вместе с ним.
--   • ИТОГ. Потери списываются с армий; гарнизон снова свободен; при ничьей
--     десант летит домой; при победе десанта армия остаётся на колонии,
--     а захват (оккупацию и переход колонии) делает этап 3 через функцию
--     _ground_on_capture, если она уже есть.
--   • СБОРЫ. На расстановку 12 часов; кто не успел — ИИ расставит его
--     отряды сам. Сторону, где одни НПС, и просроченный ход разыгрывает
--     планировщик ground-battle-tick (раз в 5 минут).
-- Ландшафт пока общий с космосом (те же коды клеток); вид по типу планеты —
-- забота клиента этапа 4.
-- Повторный запуск безопасен: правки движка точечные и не дублируются.
-- ════════════════════════════════════════════════════════════

-- ── Константы ────────────────────────────────────────────────
create or replace function public._ground_const(p_key text) returns numeric
language sql immutable as $$
  select case p_key
    when 'fly_mult'       then 1.5    -- этап 1: армия летит в полтора раза дольше флота
    when 'same_sys_h'     then 0.5    -- этап 1: высадка с орбиты своей системы
    when 'turns'          then 10     -- ходов на сторону до ничьей
    when 'form_h'         then 12     -- часов на расстановку
    when 'militia_per_pop' then 0.5   -- ополченцев на единицу населения
    when 'militia_stacks' then 3      -- отрядов ополчения
    when 'militia_min'    then 20     -- ополченцев не меньше
    when 'training_mult'  then 1.5    -- центр подготовки: ополчение крепче
    when 'hq_hp_per_bld'  then 400    -- корпус узла обороны за каждую постройку колонии
    else null end
$$;

create or replace function public._ground_npc_fid() returns text
language sql immutable as $$ select 'ground_militia'::text $$;

-- Имя НПС-стороны в логах и сводках
do $$
declare d text;
begin
  d := pg_get_functiondef('public._war_nm(text)'::regprocedure);
  if position('ground_militia' in d) = 0 then
    execute replace(d, 'select case when p_fid = public._bt_bot_fid() then public._bt_bot_name()',
      'select case when p_fid = public._bt_bot_fid() then public._bt_bot_name()
              when p_fid = ''ground_militia'' then ''Ополчение колонии''');
  end if;
end $$;

-- ── Служебные проекты обороны ────────────────────────────────
-- Принадлежат псевдо-державе 'ground_npc': заказать их нельзя (чужой проект),
-- выдаются только в бою. cls 'ss13' = неподвижная точка (как станция).
create or replace function public._ground_npc_design(p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; nm text; cls text; sm jsonb;
begin
  select case p_key
    when 'militia' then 'Ополчение'
    when 'flak'    then 'Зенитная батарея'
    when 'abm'     then 'Батарея ПРО'
    when 'nemesis' then 'Береговая «Немезида»'
    when 'doomgun' then 'Гиперпейсер (наземный огонь)'
    when 'hq'      then 'Узел обороны колонии'
    end into nm;
  if nm is null then return null; end if;
  select id into v from public.faction_units where faction_id = 'ground_npc' and name = nm limit 1;
  if v is not null then return v; end if;

  cls := case when p_key = 'militia' then 'peh' else 'ss13' end;
  sm := case p_key
    when 'militia' then '{"hp":60,"dmg":6,"rng":3,"speed":1,"armor":0,"shield":0,"radar":6}'
    when 'flak'    then '{"hp":1800,"dmg":160,"rng":6,"speed":0,"armor":40,"shield":0,"radar":10}'
    when 'abm'     then '{"hp":1800,"dmg":110,"rng":8,"speed":0,"armor":40,"shield":0,"radar":12}'
    when 'nemesis' then '{"hp":2600,"dmg":320,"rng":9,"speed":0,"armor":60,"shield":0,"radar":12}'
    when 'doomgun' then '{"hp":3200,"dmg":520,"rng":12,"speed":0,"armor":80,"shield":0,"radar":14}'
    when 'hq'      then '{"hp":2000,"dmg":40,"rng":4,"speed":0,"armor":80,"shield":0,"radar":8}'
    end::jsonb;
  insert into public.faction_units(category, name, faction_id, faction_name, summary, data)
    values ('ground', nm, 'ground_npc', 'Оборона колонии', sm,
            jsonb_build_object('class', cls, 'npc', true))
    returning id into v;
  return v;
end $$;
revoke all on function public._ground_npc_design(text) from public, anon, authenticated;

-- ── Отряд на доске: юнит × n ─────────────────────────────────
create or replace function public._ground_place(p_battle uuid, p_fid text, p_side text, p_unit uuid,
                                                p_n int, p_x int, p_y int, p_hp_override numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st jsonb; b public.battles; fc int; n int; v uuid; hp numeric;
begin
  st := public._bt_stats(p_unit);
  if st is null then return null; end if;
  select * into b from public.battles where id = p_battle;
  fc := public._bt_spawn_facing(b.spawn, p_side);
  n  := greatest(1, coalesce(p_n, 1));
  hp := coalesce(p_hp_override, (st->>'hp')::numeric * n);
  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
      facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
      dejam, eccm, interdict, stabil, ftl, pk)
    values (p_battle, p_fid, p_side, p_unit,
      case when n > 1 then format('%s ×%s', st->>'name', n) else st->>'name' end,
      st->>'cls', p_x, p_y,
      hp, hp, (st->>'armor')::numeric,
      (st->>'shield')::numeric * n, (st->>'shield')::numeric * n,
      (st->>'dmg')::numeric * n,
      (st->>'speed')::int, (st->>'rng')::int,
      fc, public._bt_turnneed(st->>'cls'), (st->>'sensor')::int, (st->>'stealth')::int,
      (select coalesce(jsonb_agg(g || jsonb_build_object('dmg', (g->>'dmg')::numeric * n)), '[]'::jsonb)
         from jsonb_array_elements(coalesce(st->'wpn','[]'::jsonb)) g),
      st->'resist',
      coalesce((st->>'pd')::numeric,0), coalesce((st->>'jam')::int,0), 0,
      coalesce((st->>'dejam')::int,0), coalesce((st->>'eccm')::int,0),
      false, false, false,
      jsonb_build_object('n', n))
    returning id into v;
  return v;
end $$;
revoke all on function public._ground_place(uuid, text, text, uuid, int, int, int, numeric) from public, anon, authenticated;

-- Свободная клетка в секторе стороны (по кольцам от якоря)
create or replace function public._ground_free_cell(p_battle uuid, p_side text, p_extra int default 0)
returns int[] language plpgsql security definer set search_path = public as $$
declare sh jsonb; sp jsonb; ax int; ay int; r int; k text; res int[];
begin
  perform public._bt_ensure_field(p_battle);
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  k := case when p_side = 'attacker' then 'att' else 'def' end;
  ax := (sp->k->>'x')::int; ay := (sp->k->>'y')::int; r := (sp->k->>'r')::int + greatest(0, p_extra);
  select array[gx, gy] into res
    from generate_series(greatest(0, ax - r), least(public._bt_w() - 1, ax + r)) gx,
         generate_series(greatest(0, ay - r - 1), least(public._bt_h() - 1, ay + r + 1)) gy
   where public._bt_dist(ax, ay, gx, gy) <= r
     and public._bt_in_arena(sh, gx, gy)
     and coalesce(public._bt_terra(
           (select terrain from public.battles where id = p_battle), gx, gy), '') <> 'ast'
     and not exists (select 1 from public.battle_units bu
                      where bu.battle_id = p_battle and bu.alive and bu.x = gx and bu.y = gy)
   order by public._bt_dist(ax, ay, gx, gy), gx, gy
   limit 1;
  return res;
end $$;

-- ── Резерв стороны в наземном бою ────────────────────────────
-- Наземные юниты армий игрока в этом бою минус уже выставленные (по n).
create or replace function public._ground_pool(p_battle uuid, p_fid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '[]'::jsonb; r record; used int; st jsonb;
begin
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
      'wpn', coalesce(st->'wpn','[]'::jsonb), 'acts', '[]'::jsonb, 'stack', true));
  end loop;
  return res;
end $$;

-- ── Расстановка игрока в наземном бою ────────────────────────
-- Как battle_deploy, но элемент может нести n — размер отряда.
create or replace function public._ground_deploy(p_battle uuid, p_units jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text; sd text; b record; e jsonb; uid uuid; px int; py int; n int; k int := 0;
        free int; sk text; cnt int;
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
    n   := greatest(1, coalesce((e->>'n')::int, 1));
    if uid is null then continue; end if;
    if px < 0 or px >= public._bt_w() or py < 0 or py >= public._bt_h() then raise exception 'клетка вне доски'; end if;
    if not public._bt_in_arena(b.shape, px, py) then raise exception 'клетка %:% вне поля', px, py; end if;
    if not coalesce(public._bt_in_spawn(b.spawn, sk, px, py), true) then
      raise exception 'клетка %:% вне вашей зоны высадки', px, py;
    end if;
    select coalesce((p->>'free')::int, 0) into free
      from jsonb_array_elements(public._ground_pool(p_battle, me)) p
     where (p->>'unit_id')::uuid = uid;
    if coalesce(free, 0) < n then
      raise exception 'в резерве не хватает юнитов «%»: нужно %, есть %', coalesce(e->>'unit_name','проект'), n, coalesce(free,0);
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

-- ИИ-расстановка резерва стороны: все юниты, отрядами поровну
create or replace function public._ground_auto_deploy(p_battle uuid, p_fid text) returns int
language plpgsql security definer set search_path = public as $$
declare sd text; p jsonb; free int; stacks int; i int; n int; xy int[]; placed int := 0; slots int;
begin
  sd := public._bt_side(p_battle, p_fid);
  if sd is null then return 0; end if;
  slots := public._bt_cap() - (select count(*) from public.battle_units where battle_id = p_battle and fid = p_fid);
  for p in select value from jsonb_array_elements(public._ground_pool(p_battle, p_fid)) loop
    free := (p->>'free')::int;
    stacks := greatest(1, least(4, slots, ceil(free / 50.0)::int));
    for i in 1..stacks loop
      exit when slots <= 0;
      n := ceil(free::numeric / (stacks - i + 1))::int;
      exit when n <= 0;
      xy := public._ground_free_cell(p_battle, sd);
      if xy is null then xy := public._ground_free_cell(p_battle, sd, 3); end if;
      exit when xy is null;
      perform public._ground_place(p_battle, p_fid, sd, (p->>'unit_id')::uuid, n, xy[1], xy[2]);
      free := free - n; slots := slots - 1; placed := placed + 1;
    end loop;
  end loop;
  return placed;
end $$;
revoke all on function public._ground_auto_deploy(uuid, text) from public, anon, authenticated;

-- ── Оборона колонии без армии: ополчение, постройки, узел ────
create or replace function public._ground_npc_deploy(p_battle uuid) returns int
language plpgsql security definer set search_path = public as $$
declare b public.battles; c public.colonies; npc text := public._ground_npc_fid();
        total int; stacks int; i int; n int; xy int[]; placed int := 0; mult numeric := 1;
        r record; nbld int; v uuid;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.kind <> 'ground' or b.status <> 'forming' then return 0; end if;
  if exists (select 1 from public.battle_units where battle_id = p_battle and fid = npc) then return 0; end if;
  select * into c from public.colonies where id = b.colony_id;
  if c.id is null then return 0; end if;
  perform public._bt_ensure_field(p_battle);

  insert into public.battle_allies(battle_id, fid, side, ready) values (p_battle, npc, 'defender', true)
    on conflict do nothing;
  insert into public.battle_ai_fids(battle_id, fid) values (p_battle, npc) on conflict do nothing;

  -- ополчение
  if exists (select 1 from public.colony_buildings where colony_id = c.id and btype = 'training') then
    mult := public._ground_const('training_mult');
  end if;
  total  := greatest(public._ground_const('militia_min')::int,
                     round(coalesce(c.pop, 0) * public._ground_const('militia_per_pop') * mult)::int);
  stacks := public._ground_const('militia_stacks')::int;
  v := public._ground_npc_design('militia');
  for i in 1..stacks loop
    n := ceil(total::numeric / (stacks - i + 1))::int;
    xy := public._ground_free_cell(p_battle, 'defender');
    exit when xy is null or n <= 0;
    perform public._ground_place(p_battle, npc, 'defender', v, n, xy[1], xy[2]);
    total := total - n; placed := placed + 1;
  end loop;

  -- оборонительные постройки — по точке огня на каждую
  for r in select btype from public.colony_buildings
            where colony_id = c.id and btype in ('flak','abm','nemesis','doomgun') limit 20 loop
    xy := public._ground_free_cell(p_battle, 'defender', 2);
    exit when xy is null;
    perform public._ground_place(p_battle, npc, 'defender', public._ground_npc_design(r.btype), 1, xy[1], xy[2]);
    placed := placed + 1;
  end loop;

  -- узел обороны: корпус растёт с застройкой колонии
  select count(*) into nbld from public.colony_buildings where colony_id = c.id;
  xy := public._ground_free_cell(p_battle, 'defender');
  if xy is not null then
    perform public._ground_place(p_battle, npc, 'defender', public._ground_npc_design('hq'), 1, xy[1], xy[2],
                                 2000 + nbld * public._ground_const('hq_hp_per_bld'));
    placed := placed + 1;
  end if;
  perform public._bt_log(p_battle, format('Колония поднимает оборону: %s отрядов ополчения и укреплений.', placed));
  return placed;
end $$;
revoke all on function public._ground_npc_deploy(uuid) from public, anon, authenticated;

-- ── Перед стартом: доложить остатки резерва, выставить лимит ходов ──
create or replace function public._ground_prestart(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f text; p jsonb; tok uuid; st jsonb; n int;
begin
  for f in select distinct fid from public.ground_battle_armies where battle_id = p_battle loop
    for p in select value from jsonb_array_elements(public._ground_pool(p_battle, f)) loop
      n := (p->>'free')::int;
      select id into tok from public.battle_units
       where battle_id = p_battle and fid = f and unit_id = (p->>'unit_id')::uuid and alive
       order by created_at limit 1;
      if tok is null then continue; end if;          -- проекта на поле нет: остаётся в резерве
      st := public._bt_stats((p->>'unit_id')::uuid);
      update public.battle_units
         set pk = jsonb_set(coalesce(pk,'{}'::jsonb), '{n}', to_jsonb(coalesce((pk->>'n')::int,1) + n)),
             hp = hp + (st->>'hp')::numeric * n, max_hp = max_hp + (st->>'hp')::numeric * n,
             dmg = dmg + (st->>'dmg')::numeric * n,
             wpn = (select coalesce(jsonb_agg(g || jsonb_build_object('dmg',
                      (g->>'dmg')::numeric * (coalesce((pk->>'n')::int,1) + n) / greatest(1, coalesce((pk->>'n')::int,1)))), '[]'::jsonb)
                      from jsonb_array_elements(coalesce(wpn,'[]'::jsonb)) g),
             unit_name = format('%s ×%s', st->>'name', coalesce((pk->>'n')::int,1) + n)
       where id = tok;
    end loop;
  end loop;
  update public.battles
     set att_turns_left = public._ground_const('turns')::int,
         def_turns_left = public._ground_const('turns')::int
   where id = p_battle;
end $$;
revoke all on function public._ground_prestart(uuid) from public, anon, authenticated;

-- ── Передать ход без участия стороны (НПС-сторона, просрочка) ──
create or replace function public._ground_pass_turn(p_battle uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.battles; nxt text;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.status <> 'active' then return; end if;
  if b.side_to_move = 'attacker' then
    update public.battles set att_turns_left = greatest(0, att_turns_left - 1) where id = p_battle;
  else
    update public.battles set def_turns_left = greatest(0, def_turns_left - 1) where id = p_battle;
  end if;
  perform public._bt_env_end(p_battle, b.side_to_move);
  nxt := case when b.side_to_move = 'attacker' then 'defender' else 'attacker' end;
  perform public._bt_tp_refresh(p_battle, nxt);
  update public.battles
     set side_to_move = nxt, turn_no = turn_no + 1, acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  if p_note is not null then perform public._bt_log(p_battle, p_note); end if;
  perform public._bt_check_end(p_battle);
end $$;
revoke all on function public._ground_pass_turn(uuid, text) from public, anon, authenticated;

-- ── Итог наземного боя ───────────────────────────────────────
create or replace function public._ground_finish(p_battle uuid, p_winner text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.battles; c public.colonies; loser_side text; g record; a public.armies;
        lost jsonb; e jsonb; comp jsonb; want int; q int; units_left int; home uuid; back_h numeric;
        nm_c text; outcome text;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return; end if;
  select * into c from public.colonies where id = b.colony_id;
  loser_side := case when p_winner is null then null
                     when p_winner = b.attacker_fid then 'defender' else 'attacker' end;

  -- потери по проектам у каждой державы: убитые отряды целиком, живые — по доле корпуса
  for g in select distinct fid, side from public.ground_battle_armies where battle_id = p_battle loop
    select coalesce(jsonb_object_agg(uid, dead), '{}'::jsonb) into lost from (
      select u.unit_id::text uid,
             sum(case when not u.alive then coalesce((u.pk->>'n')::int, 1)
                      else round(coalesce((u.pk->>'n')::int, 1) * (1 - u.hp / greatest(1, u.max_hp)))::int end) dead
        from public.battle_units u
       where u.battle_id = p_battle and u.fid = g.fid and u.unit_id is not null
       group by u.unit_id) q;

    for a in select ar.* from public.armies ar
               join public.ground_battle_armies x on x.army_id = ar.id
              where x.battle_id = p_battle and x.fid = g.fid
              order by ar.created_at for update of ar loop
      comp := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(a.composition,'[]'::jsonb)) loop
        q := greatest(0, coalesce((e->>'qty')::int, 0));
        if coalesce(nullif(e->>'category',''),'ground') = 'ground' then
          if g.side = loser_side then
            q := 0;                                   -- проигравшая сторона теряет всё
          else
            want := coalesce((lost->>(e->>'unit_id'))::int, 0);
            if want > 0 then
              lost := jsonb_set(lost, array[e->>'unit_id'], to_jsonb(greatest(0, want - q)));
              q := greatest(0, q - want);
            end if;
          end if;
        end if;
        if q > 0 then comp := comp || jsonb_build_array(jsonb_set(e, '{qty}', to_jsonb(q))); end if;
      end loop;

      select coalesce(sum((x->>'qty')::int), 0) into units_left from jsonb_array_elements(comp) x;
      if units_left = 0 then
        delete from public.armies where id = a.id;
        continue;
      end if;

      if g.side = 'defender' then
        update public.armies set composition = comp, status = 'idle', battle_id = null, mission = 'move'
         where id = a.id;
      elsif p_winner is not null and p_winner = b.attacker_fid then
        -- десант взял колонию: стоит на ней (захват — этап 3)
        update public.armies set composition = comp, status = 'idle', battle_id = null, mission = 'move',
               colony_id = b.colony_id
         where id = a.id;
      else
        -- ничья: десант отходит домой
        home := coalesce(a.home_colony, a.from_colony);
        back_h := coalesce(public._fleet_fly_hours(b.system_id,
                    (select system_id from public.colonies where id = home)), 2.0) * public._ground_const('fly_mult');
        update public.armies set composition = comp, status = 'transit', mission = 'move', battle_id = null,
               from_colony = b.colony_id, dest_colony = home, colony_id = null,
               depart_at = now(), arrive_at = now() + (back_h || ' hours')::interval
         where id = a.id;
      end if;
    end loop;
  end loop;

  update public.battles set status = 'done', winner_fid = p_winner, ended_at = now(), side_to_move = null
   where id = p_battle;

  nm_c := coalesce('«' || c.planet_name || '»', 'колонию');
  outcome := case
    when p_winner is null then format('Бой за %s окончен вничью: оборона %s выстояла, десант %s отходит.',
                                      nm_c, public._war_nm(b.defender_fid), public._war_nm(b.attacker_fid))
    when p_winner = b.attacker_fid then format('Десант %s сломил оборону %s и взял %s.',
                                      public._war_nm(b.attacker_fid), public._war_nm(b.defender_fid), nm_c)
    else format('Оборона %s сбросила десант %s: %s устояла.',
                public._war_nm(b.defender_fid), public._war_nm(b.attacker_fid), nm_c) end;
  perform public._bt_log(p_battle, outcome);
  perform public._war_news('🪖 Наземный бой: ' || coalesce(c.planet_name, 'колония'), outcome,
                           jsonb_build_array(b.attacker_fid, b.defender_fid));

  if p_winner is not null and p_winner = b.attacker_fid
     and to_regprocedure('public._ground_on_capture(uuid)') is not null then
    execute 'select public._ground_on_capture($1)' using p_battle;
  end if;
end $$;
revoke all on function public._ground_finish(uuid, text) from public, anon, authenticated;

-- ── Конец наземного боя ──────────────────────────────────────
create or replace function public._ground_check_end(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.battles; a_alive int; d_alive int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  select count(*) filter (where side = 'attacker'), count(*) filter (where side = 'defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;
  if a_alive = 0 and d_alive = 0 then perform public._ground_finish(p_battle, null);
  elsif a_alive = 0 then perform public._ground_finish(p_battle, b.defender_fid);
  elsif d_alive = 0 then perform public._ground_finish(p_battle, b.attacker_fid);
  elsif coalesce(b.att_turns_left, 0) <= 0 and coalesce(b.def_turns_left, 0) <= 0 then
    perform public._ground_finish(p_battle, null);
  end if;
end $$;
revoke all on function public._ground_check_end(uuid) from public, anon, authenticated;

-- ── Планировщик наземных боёв ────────────────────────────────
create or replace function public._ground_battle_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.battles; f text; started int := 0; moved int := 0; npc_side boolean;
        guard int; att_has boolean; def_has boolean;
begin
  -- сборы
  for b in select * from public.battles where kind = 'ground' and status = 'forming' order by created_at loop
    perform public._ground_npc_deploy(b.id);
    att_has := exists (select 1 from public.battle_units where battle_id = b.id and side = 'attacker');
    def_has := exists (select 1 from public.battle_units u where u.battle_id = b.id and u.side = 'defender'
                        and u.fid <> public._ground_npc_fid());
    -- у защитника нет армии на колонии — расставлять ему нечего
    if not b.def_ready and jsonb_array_length(public._ground_pool(b.id, b.defender_fid)) = 0 and not def_has then
      update public.battles set def_ready = true where id = b.id;
    end if;
    if b.created_at < now() - (public._ground_const('form_h') || ' hours')::interval then
      for f in select distinct fid from public.ground_battle_armies where battle_id = b.id loop
        perform public._ground_auto_deploy(b.id, f);
      end loop;
      update public.battles set att_ready = true, def_ready = true where id = b.id;
    end if;
    select * into b from public.battles where id = b.id;
    if b.att_ready and b.def_ready and b.status = 'forming' then
      if not exists (select 1 from public.battle_units where battle_id = b.id and side = 'attacker') then
        perform public._ground_auto_deploy(b.id, b.attacker_fid);
      end if;
      perform public._fc_kick_off(b.id);
      started := started + 1;
    end if;
  end loop;

  -- ходы: сторона из одних НПС ходит сама, просроченный ход сгорает
  for b in select * from public.battles where kind = 'ground' and status = 'active' order by created_at loop
    guard := 0;
    loop
      guard := guard + 1;
      exit when guard > 4;
      select * into b from public.battles where id = b.id;
      exit when b.status <> 'active';
      npc_side := not exists (
        select 1 from public.battle_units u
         where u.battle_id = b.id and u.side = b.side_to_move and u.alive
           and not exists (select 1 from public.battle_ai_fids a where a.battle_id = b.id and a.fid = u.fid));
      if npc_side then
        begin perform public._bt_ally_turn(b.id, public._bt_acts()); exception when others then null; end;
        perform public._ground_pass_turn(b.id, null);
        moved := moved + 1;
      elsif b.deadline_at is not null and b.deadline_at < now() then
        begin perform public._bt_ally_turn(b.id, public._bt_acts()); exception when others then null; end;
        perform public._ground_pass_turn(b.id, 'Сторона не явилась к сроку — ход сгорел.');
        moved := moved + 1;
      else
        exit;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'started', started, 'turns', moved);
end $$;
revoke all on function public._ground_battle_tick() from public, anon, authenticated;

-- ── Врезки в движок арены ────────────────────────────────────
-- Каждая — одна ветка «если бой наземный» в начале функции. Остальное
-- поведение космических боёв не меняется. Повторный прогон не дублирует.
do $$
declare d text;
begin
  -- резерв
  d := pg_get_functiondef('public.battle_pool(uuid,text)'::regprocedure);
  if position('_ground_pool' in d) = 0 then
    execute regexp_replace(d, '\mbegin\M',
      'begin
  if exists (select 1 from public.battles gb where gb.id = p_battle and gb.kind = ''ground'') then
    return public._ground_pool(p_battle, p_fid);
  end if;');
  end if;

  -- расстановка
  d := pg_get_functiondef('public.battle_deploy__raw(uuid,jsonb)'::regprocedure);
  if position('_ground_deploy' in d) = 0 then
    execute regexp_replace(d, '\mbegin\M',
      'begin
  if exists (select 1 from public.battles gb where gb.id = p_battle and gb.kind = ''ground'') then
    if public.current_user_banned() then raise exception ''forbidden: account banned''; end if;
    return public._ground_deploy(p_battle, p_units);
  end if;');
  end if;

  -- подкрепления в наземном бою пока не предусмотрены
  d := pg_get_functiondef('public.battle_reinforce__raw(uuid,uuid,integer)'::regprocedure);
  if position('kind = ''ground''' in d) = 0 then
    execute regexp_replace(d, '\mbegin\M',
      'begin
  if exists (select 1 from public.battles gb where gb.id = p_battle and gb.kind = ''ground'') then
    raise exception ''в наземном бою подкреплений нет: весь резерв выходит на поле при старте'';
  end if;');
  end if;

  -- старт: остатки резерва в отряды, лимит ходов
  d := pg_get_functiondef('public._fc_kick_off(uuid)'::regprocedure);
  if position('_ground_prestart' in d) = 0 then
    execute replace(d, 'if b.id is null or b.status <> ''forming'' then return; end if;',
      'if b.id is null or b.status <> ''forming'' then return; end if;
  if b.kind = ''ground'' then perform public._ground_prestart(p_battle); end if;');
  end if;

  -- конец боя
  d := pg_get_functiondef('public._bt_check_end(uuid)'::regprocedure);
  if position('_ground_check_end' in d) = 0 then
    execute replace(d, 'if b.id is null or b.status = ''done'' then return; end if;',
      'if b.id is null or b.status = ''done'' then return; end if;
  if b.kind = ''ground'' then perform public._ground_check_end(p_battle); return; end if;');
  end if;
end $$;

-- ── Расписание ───────────────────────────────────────────────
do $$ begin
  perform cron.unschedule('ground-battle-tick');
exception when others then null; end $$;
select cron.schedule('ground-battle-tick', '1-59/5 * * * *', 'select public._ground_battle_tick();');
