-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🤝 НПС-СОЮЗНИКИ: ЧУЖОЙ ИИ НА ТВОЕЙ СТОРОНЕ
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _fc_bot_arena.sql, _bot_doctrine.sql, _bot_engage_fix.sql,
-- _bot_pressure.sql, _bot_admin_doctrine.sql. Идемпотентно.
--
-- ЗАЧЕМ. На арене клуба сторона игроков — это до трёх держав (battle_allies),
-- но ходить за них может только живой человек. Значит, союзника-НПС посадить
-- было некуда: его борта просто стояли бы мебелью.
--
-- КАК СДЕЛАНО
--   • Реестр battle_ai_fids — кем в этом бою играет ИИ. Пусто для всех
--     обычных боёв, поэтому поведение старых досок не меняется ни на йоту.
--   • _bt_draft_fleet — тот же доктринальный драфт, что и у легиона, но для
--     ЛЮБОЙ стороны и любого ростера: роли по долям доктрины, строй по
--     _bt_bot_slot (тараны к врагу, снайперы и поддержка в тыл).
--   • _bt_ally_turn — ход союзников. Активации у стороны общие, поэтому ИИ
--     берёт себе не больше половины (p_cap) и НЕ закрывает ход: остаток и
--     кнопка «конец хода» остаются за игроком.
--   • Зовётся автоматически из хода легиона: бот отходил → ход вернулся
--     твоей стороне → союзники сразу отработали свою половину активаций.
--     Клиент для этого трогать не нужно.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. КЕМ ИГРАЕТ ИИ ────────────────────────────────────────────────
create table if not exists public.battle_ai_fids(
  battle_id uuid not null references public.battles(id) on delete cascade,
  fid       text not null,
  primary key (battle_id, fid)
);
alter table public.battle_ai_fids enable row level security;
drop policy if exists battle_ai_fids_read on public.battle_ai_fids;
create policy battle_ai_fids_read on public.battle_ai_fids for select to authenticated using (true);
revoke insert, update, delete on public.battle_ai_fids from anon, authenticated;

comment on table public.battle_ai_fids is
  'державы, за которые в этом бою ходит ИИ (НПС-союзники и НПС-противники, кроме самого бота)';

-- ── 2. ДРАФТ ДЛЯ ЛЮБОЙ СТОРОНЫ ──────────────────────────────────────
-- Клетка строя по роли, но для произвольной стороны.
create or replace function public._bt_bot_slot_side(p_battle uuid, p_role text, p_side text)
returns int[] language plpgsql stable security definer set search_path=public as $fn$
declare sh jsonb; sp jsonb; mk text; fk text; ax int; ay int; r int; ex int; ey int;
        w int; h int; out_xy int[];
begin
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  if sp is null then return null; end if;
  mk := case when p_side = 'attacker' then 'att' else 'def' end;
  fk := case when p_side = 'attacker' then 'def' else 'att' end;
  ax := (sp->mk->>'x')::int; ay := (sp->mk->>'y')::int; r := (sp->mk->>'r')::int;
  ex := (sp->fk->>'x')::int; ey := (sp->fk->>'y')::int;
  if ax is null or ex is null then return public._bt_spawn_free(p_battle, mk); end if;

  select array[gx, gy] into out_xy
    from generate_series(greatest(0, ax - r), least(w - 1, ax + r)) gx,
         generate_series(greatest(0, ay - r - 1), least(h - 1, ay + r + 1)) gy
   where public._bt_dist(ax, ay, gx, gy) <= r
     and public._bt_in_arena(sh, gx, gy)
     and not exists(select 1 from public.battle_units bu
                     where bu.battle_id = p_battle and bu.alive and bu.x = gx and bu.y = gy)
   order by case p_role
              when 'brawler' then public._bt_dist(ex, ey, gx, gy)
              when 'skirm'   then abs(public._bt_dist(ex, ey, gx, gy)
                                      - public._bt_dist(ex, ey, ax, ay))
              else            -public._bt_dist(ex, ey, gx, gy)
            end,
            public._bt_dist(ax, ay, gx, gy), gx, gy
   limit 1;
  return coalesce(out_xy, public._bt_spawn_free(p_battle, mk));
end$fn$;
revoke all on function public._bt_bot_slot_side(uuid,text,text) from public;

-- Драфт на бюджет для произвольной державы и стороны. Ростер: fid державы
-- («club» — гладиаторы клуба) либо NULL = весь каталог, кроме клуба.
create or replace function public._bt_draft_fleet(p_battle uuid, p_fid text, p_side text,
                                                  p_budget numeric, p_roster text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare sp jsonb; fc int; spent numeric := 0; placed int := 0; guard int := 0;
        cap int := least(public._bt_cap(), 12); xy int[]; sb jsonb;
        doc jsonb; cand jsonb; roles text[]; rl text; lim numeric; rest numeric;
        by_role jsonb := '{}'::jsonb; dupcap int := 3;
        pick_id uuid; pick_price numeric; pick_role text;
begin
  perform public._bt_ensure_field(p_battle);
  select b.spawn into sp from public.battles b where b.id = p_battle;
  fc  := public._bt_spawn_facing(sp, p_side);
  doc := public._bt_bot_doctrine(p_battle, p_side);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fu.id, 'price', public._fc_arena_price(fu.id),
           'role', public._bt_bot_role_kit(fu.id))), '[]'::jsonb)
    into cand
    from public.faction_units fu
   where fu.category = 'ship'
     and coalesce((fu.summary->>'hp')::numeric, 0) > 0
     and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id)
     and (case when p_roster is null then coalesce(fu.faction_id,'') <> 'club'
               else fu.faction_id = p_roster end);
  if coalesce(jsonb_array_length(cand), 0) = 0 then
    raise exception 'ростер «%» пуст — драфт невозможен', coalesce(p_roster, 'весь каталог');
  end if;

  loop
    guard := guard + 1;
    exit when guard > 200 or placed >= cap;
    rest := p_budget - spent;

    select array_agg(q.rl order by q.fill, q.rl) into roles
      from (select r as rl,
                   coalesce((by_role->>r)::numeric, 0)
                     / greatest(1, coalesce((doc->>r)::numeric, 0) * p_budget) as fill
              from unnest(array['brawler','skirm','sniper','support']) r) q;

    pick_id := null;
    foreach rl in array roles loop
      lim := least(rest, greatest(
               coalesce((doc->>rl)::numeric, 0) * p_budget
                 - coalesce((by_role->>rl)::numeric, 0), 0) + p_budget * 0.12);
      continue when lim < 1;
      select (c->>'id')::uuid, (c->>'price')::numeric
        into pick_id, pick_price
        from jsonb_array_elements(cand) c
       where c->>'role' = rl
         and (c->>'price')::numeric <= lim
         and (select count(*) from public.battle_units bu
               where bu.battle_id = p_battle and bu.fid = p_fid
                 and bu.unit_id = (c->>'id')::uuid) < dupcap
       order by (c->>'price')::numeric desc, random()
       limit 1;
      if pick_id is not null then pick_role := rl; exit; end if;
    end loop;

    if pick_id is null and dupcap < 9 and rest > 0 then
      dupcap := dupcap + 1;
      continue;
    end if;
    exit when pick_id is null;

    xy := public._bt_bot_slot_side(p_battle, pick_role, p_side);
    exit when xy is null;
    sb := public._bt_stats(pick_id);
    if sb is null then exit; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, p_fid, p_side, pick_id, sb->>'name', sb->>'cls', xy[1], xy[2],
        (sb->>'hp')::numeric, (sb->>'hp')::numeric, (sb->>'armor')::numeric,
        (sb->>'shield')::numeric, (sb->>'shield')::numeric, (sb->>'dmg')::numeric,
        (sb->>'speed')::int, (sb->>'rng')::int,
        fc, public._bt_turnneed(sb->>'cls'),
        coalesce((sb->>'sensor')::int,0), coalesce((sb->>'stealth')::int,0),
        coalesce(sb->'wpn','[]'::jsonb), coalesce(sb->'resist','{}'::jsonb),
        coalesce((sb->>'pd')::numeric,0), coalesce((sb->>'jam')::int,0), coalesce((sb->>'wings')::int,0),
        coalesce((sb->>'dejam')::int,0), coalesce((sb->>'eccm')::int,0),
        coalesce((sb->>'interdict')::bool,false), coalesce((sb->>'stabil')::bool,false),
        coalesce((sb->>'ftl')::bool,false));

    spent   := spent + pick_price;
    placed  := placed + 1;
    by_role := jsonb_set(by_role, array[pick_role],
                 to_jsonb(coalesce((by_role->>pick_role)::numeric, 0) + pick_price), true);
  end loop;

  if placed = 0 then raise exception 'не удалось выставить ни одного борта'; end if;
  return jsonb_build_object('n', placed, 'spent', spent, 'doctrine', doc->>'why');
end$fn$;
revoke all on function public._bt_draft_fleet(uuid,text,text,numeric,text) from public;

-- ── 3. ХОД СОЮЗНИКОВ ────────────────────────────────────────────────
-- Активации общие, поэтому берём не больше p_cap и ход НЕ закрываем.
create or replace function public._bt_ally_turn(p_battle uuid, p_cap int default 3)
returns int language plpgsql security definer set search_path=public as $fn$
declare b record; sd text; ai text[]; pick uuid; pfid text;
        used int := 0; guard int := 0; st text; acts int; did boolean;
        skip uuid[] := '{}';
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return 0; end if;
  sd := b.side_to_move;

  select array_agg(a.fid) into ai
    from public.battle_ai_fids a
   where a.battle_id = p_battle
     and public._bt_side(p_battle, a.fid) = sd
     and a.fid <> public._bt_bot_fid();
  if ai is null then return 0; end if;

  perform public._bt_arm(p_battle);
  perform public._bt_flow_build(p_battle, sd);
  perform public._bt_risk_build(p_battle, sd);
  perform public._bt_seen_arm(p_battle, sd);
  perform public._bt_bot_plan_build(p_battle, sd);

  loop
    guard := guard + 1;
    exit when guard > 40 or used >= greatest(1, p_cap);
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0 or b.side_to_move <> sd;

    select bu.id, bu.fid into pick, pfid
      from public.battle_units bu
      left join lateral (select public._bt_bot_target(p_battle, bu.id) as tid) tg on true
     where bu.battle_id = p_battle and bu.side = sd and bu.alive
       and bu.fid = any(ai) and not bu.acted and not (bu.id = any(skip))
     order by
       (tg.tid is not null and exists(
          select 1 from public.battle_units z where z.id = tg.tid
            and z.hp + z.shield <= bu.dmg)) desc,
       (tg.tid is not null and tg.tid = public._bt_bot_focus(p_battle)) desc,
       (tg.tid is not null) desc,
       coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                   from public.battle_units t
                  where t.battle_id = p_battle and t.alive and t.side <> sd), 999) asc,
       bu.id
     limit 1;
    exit when pick is null;

    did := public._bt_bot_act(p_battle, pick, pfid);
    if did then used := used + 1; else skip := skip || pick; end if;
  end loop;

  delete from public.bt_bot_flow where battle_id = p_battle;
  delete from public.bt_bot_risk where battle_id = p_battle;
  delete from public.bt_bot_plan where battle_id = p_battle;
  return used;
end$fn$;
revoke all on function public._bt_ally_turn(uuid,int) from public;

-- Ручной прогон союзников: если ход уже твой, а они ещё не ходили.
create or replace function public.fc_ally_turn(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare n int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if public._bt_side(p_battle, public._ec_my_fid()) is null
     and public.current_user_role() not in ('superadmin','editor') then
    raise exception 'вы не участвуете в этом бою';
  end if;
  n := public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
  return jsonb_build_object('ok', true, 'acted', n);
end$fn$;
revoke all on function public.fc_ally_turn(uuid) from public;
grant execute on function public.fc_ally_turn(uuid) to authenticated;

-- ── 4. СОЮЗНИКИ ХОДЯТ СРАЗУ ПОСЛЕ ЛЕГИОНА ───────────────────────────
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare bot text := public._bt_bot_fid(); botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  if (botside = 'attacker' and b.attacker_fid <> bot)
     or (botside = 'defender' and b.defender_fid <> bot) then
    return;
  end if;

  if botside = 'defender'
     and not exists(select 1 from public.battle_units u
                     where u.battle_id = p_battle and u.side = 'defender') then
    begin perform public._bt_bot_draft_due(p_battle); exception when others then null; end;
  end if;

  perform public._bt_flow_build(p_battle, botside);
  perform public._bt_risk_build(p_battle, botside);
  perform public._bt_seen_arm(p_battle, botside);
  perform public._bt_bot_plan_build(p_battle, botside);

  loop
    guard := guard + 1;
    exit when guard > 60;
    select status, acts_left into st, acts from public.battles where id = p_battle;
    exit when st <> 'active' or coalesce(acts, 0) <= 0;

    perform public._bt_seen_arm(p_battle, botside);

    select bu.id into pick
      from public.battle_units bu
      left join lateral (select public._bt_bot_target(p_battle, bu.id) as tid) tg on true
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and not bu.acted and not (bu.id = any(skip))
     order by
       (tg.tid is not null and exists(
          select 1 from public.battle_units z where z.id = tg.tid
            and z.hp + z.shield <= bu.dmg)) desc,
       (tg.tid is not null and tg.tid = public._bt_bot_focus(p_battle)) desc,
       (tg.tid is not null) desc,
       (public._bt_bot_repair(p_battle, bu.id) is not null) desc,
       coalesce((select min(public._bt_dist(bu.x, bu.y, t.x, t.y))
                   from public.battle_units t
                  where t.battle_id = p_battle and t.alive and t.side <> botside), 999) asc,
       bu.id
     limit 1;
    exit when pick is null;

    did := public._bt_bot_act(p_battle, pick, bot);
    if not did then skip := skip || pick; end if;
  end loop;

  delete from public.bt_bot_flow where battle_id = p_battle;
  delete from public.bt_bot_risk where battle_id = p_battle;
  delete from public.bt_bot_plan where battle_id = p_battle;

  select status into st from public.battles where id = p_battle;
  if st = 'active' then
    begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
  end if;

  -- ход вернулся живой стороне — НПС-союзники отрабатывают свою половину
  select * into b from public.battles where id = p_battle;
  if b.status = 'active' and b.side_to_move is distinct from botside then
    begin
      perform public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
    exception when others then null; end;
  end if;
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select public._bt_draft_fleet('<battle>', 'empire', 'attacker', 700000, 'club');
--   insert into battle_ai_fids values ('<battle>', 'empire');
--   select public.fc_ally_turn('<battle>');
