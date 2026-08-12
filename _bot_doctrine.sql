-- © 2025–2026. Все права защищены.
-- ═══════════════════════════════════════════════════════════════════
-- 🧠 ИИ: ДОКТРИНА ДРАФТА И ЗАМЫСЕЛ НА ХОД
-- ═══════════════════════════════════════════════════════════════════
-- ПОРЯДОК: после _bot_ai_brain.sql, _bot_roster_kit.sql, _fc_bot_arena.sql,
-- _fc_bot_turn_guard.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК
--
-- 1) ФЛОТ СОБИРАЛСЯ ЖРЕБИЕМ. _fc_place_bots брал борта
--    `order by random() * price` — смещение к тяжёлым и больше ничего. На
--    арену выходили то шесть бронеходов без единого дальнобоя, то стая
--    катеров без брони. Состава как замысла не существовало.
--    Стало: у каждого проекта есть РОЛЬ (таран / скирмишер / снайпер /
--    поддержка), у стороны — ДОКТРИНА (доли ролей в бюджете), и драфт
--    добирает ту роль, которой сейчас не хватает больше всего. Один и тот же
--    проект не берётся больше трёх раз — легион перестал быть клоном.
--
-- 2) ЛЕГИОН НЕ ВИДЕЛ, ПРОТИВ КОГО ВЫХОДИТ. Боты расставлялись в момент
--    жеребьёвки, ЗАДОЛГО до того, как игрок утвердит состав. Подобрать
--    ответ было физически не из чего.
--    Стало: бюджет вольницы запоминается в бою (battles.bot_budget), а сам
--    флот собирается на гонге, в _fc_kick_off, когда состав игроков уже на
--    доске. Доктрина читает ЕГО: против дальнобойного строя — свалка
--    накоротке, против ближнего боя — кайт, против малого и жирного —
--    арта и поддержка.
--
-- 3) СТРОЙ. Борта сыпались в первую свободную клетку от центра сектора:
--    тендер оказывался впереди бронехода. Стало: тараны — по кромке к
--    врагу, снайперы и поддержка — в тылу сектора.
--
-- 4) ХОД БЫЛ СУММОЙ ОДИНОЧЕК. Каждый борт сам выбирал цель «где залп ближе
--    к убийству» — и шесть активаций расходились по шести разным целям, ни
--    одной не добив. И каждый лез в драку по одному, как приходил.
--    Стало: у стороны есть ЗАМЫСЕЛ на ход (bt_bot_plan):
--      • ФОКУС — одна цель на ход: сперва лекарь/тендер врага, затем самый
--        зубастый из тех, до кого дотягиваются хотя бы двое. Выбор цели у
--        борта смещается к фокусу, если фокус ему по зубам.
--      • РУБЕЖ РАЗВЁРТЫВАНИЯ — пока в дальность врага не вышла половина
--        флота, ударные борта ждут на шаг дальше его залпа, а не заходят в
--        огонь поодиночке. На четвёртом ходу выдержка снимается, чтобы бой
--        не превращался в переглядки.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. РОЛЬ ПРОЕКТА (до боя, по ТТХ и снаряжению) ───────────────────
-- Читается тем же, чем живёт борт в бою: полосы орудий из _bt_stats и
-- активные модули из _bt_acts_of. Пороги рубежа здесь СВОИ (16/5 против
-- 10/4 у боевого _bt_bot_role): в драфте важно, кто держит середину поля,
-- а не кто как ведёт себя в перестрелке.
create or replace function public._bt_bot_role_kit(p_unit uuid)
returns text language plpgsql stable security definer set search_path=public as $fn$
declare st jsonb; acts jsonb; reach int; heal boolean; ram boolean; spd int;
begin
  st := public._bt_stats(p_unit);
  if st is null then return 'skirm'; end if;
  acts := coalesce(public._bt_acts_of(p_unit), '[]'::jsonb);

  reach := coalesce((
    select max((g->>'rng')::int)
      from jsonb_array_elements(coalesce(st->'wpn','[]'::jsonb)) g
     where coalesce(g->>'k','kinetic') <> 'repair'
       and coalesce((g->>'dmg')::numeric, 0) > 0),
    coalesce((st->>'rng')::int, 1));
  reach := greatest(1, reach);

  -- поддержка — только те, кто чинит и разгоняет своих; глушилки и
  -- «адские лучи» — обычные драчуны, их место определяет рубеж
  heal := exists(select 1 from jsonb_array_elements(coalesce(st->'wpn','[]'::jsonb)) g
                  where g->>'k' = 'repair')
       or exists(select 1 from jsonb_array_elements(acts) a
                  where a->>'k' in ('drones','wboost'));
  ram  := exists(select 1 from jsonb_array_elements(acts) a
                  where a->>'k' in ('ram','rupture'));
  spd  := coalesce((st->>'speed')::int, 0);

  if heal then return 'support'; end if;
  if coalesce(st->>'cls','') = 'ss13' or spd <= 0 then return 'sniper'; end if;
  if ram and reach <= 6 then return 'brawler'; end if;
  if reach >= 16 then return 'sniper'; end if;
  if reach <= 4  then return 'brawler'; end if;
  return 'skirm';
end$fn$;
revoke all on function public._bt_bot_role_kit(uuid) from public;
grant execute on function public._bt_bot_role_kit(uuid) to authenticated;

comment on function public._bt_bot_role_kit(uuid) is
  'роль проекта для драфта ИИ: brawler / skirm / sniper / support';

-- ── 2. ДОКТРИНА: ответ на состав врага ──────────────────────────────
-- Возвращает доли бюджета по ролям и подпись замысла для журнала.
-- Читает доску: борта врага уже выставлены (драфт идёт на гонге).
create or replace function public._bt_bot_doctrine(p_battle uuid, p_side text)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare n int; longs numeric; fat numeric; d jsonb;
begin
  select count(*),
         coalesce(avg(case when coalesce(e.rng,0) >= 10 then 1 else 0 end), 0),
         coalesce(avg(coalesce(e.hp,0) + coalesce(e.shield,0)), 0)
    into n, longs, fat
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> p_side;

  if coalesce(n, 0) = 0 then
    -- врага на доске нет (ранний вызов, диагностика) — ровный строй
    return jsonb_build_object('brawler', 0.30, 'skirm', 0.30, 'sniper', 0.25,
                              'support', 0.15, 'why', 'сбалансированный строй');
  end if;

  if longs >= 0.5 then
    -- враг держит дистанцию: доходить до него нужно быстро и массой
    d := jsonb_build_object('brawler', 0.42, 'skirm', 0.30, 'sniper', 0.18,
                            'support', 0.10, 'why', 'свалка накоротке против дальнобоя');
  elsif longs <= 0.25 then
    -- враг работает в упор: не подпускать, бить с рубежа
    d := jsonb_build_object('brawler', 0.15, 'skirm', 0.30, 'sniper', 0.40,
                            'support', 0.15, 'why', 'кайт против ближнего боя');
  else
    d := jsonb_build_object('brawler', 0.30, 'skirm', 0.30, 'sniper', 0.25,
                            'support', 0.15, 'why', 'сбалансированный строй');
  end if;

  -- малый и жирный строй: числом его не проломить, нужна арта и ремонт
  if n <= 4 and fat > 0 then
    d := jsonb_build_object('brawler', (d->>'brawler')::numeric * 0.7,
                            'skirm',   (d->>'skirm')::numeric   * 0.9,
                            'sniper',  (d->>'sniper')::numeric  * 1.3,
                            'support', (d->>'support')::numeric * 1.4,
                            'why', (d->>'why') || ' + арта по тяжёлому кулаку');
  end if;
  return d;
end$fn$;
revoke all on function public._bt_bot_doctrine(uuid,text) from public;

-- ── 3. СТРОЙ: где чья клетка в секторе высадки ──────────────────────
-- Тараны идут по кромке, снайперы и поддержка — в тылу. Якорь чужого
-- сектора берём из spawn: строй разворачивается ОТ противника, а не от
-- геометрии доски.
create or replace function public._bt_bot_slot(p_battle uuid, p_role text)
returns int[] language plpgsql stable security definer set search_path=public as $fn$
declare sh jsonb; sp jsonb; ax int; ay int; r int; ex int; ey int;
        w int; h int; out_xy int[];
begin
  perform public._bt_arm(p_battle);
  w := public._bt_w(); h := public._bt_h();
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  if sp is null then return null; end if;
  ax := (sp->'def'->>'x')::int; ay := (sp->'def'->>'y')::int; r := (sp->'def'->>'r')::int;
  ex := (sp->'att'->>'x')::int; ey := (sp->'att'->>'y')::int;
  if ax is null or ex is null then return public._bt_spawn_free(p_battle, 'def'); end if;

  select array[gx, gy] into out_xy
    from generate_series(greatest(0, ax - r), least(w - 1, ax + r)) gx,
         generate_series(greatest(0, ay - r - 1), least(h - 1, ay + r + 1)) gy
   where public._bt_dist(ax, ay, gx, gy) <= r
     and public._bt_in_arena(sh, gx, gy)
     and not exists(select 1 from public.battle_units bu
                     where bu.battle_id = p_battle and bu.alive and bu.x = gx and bu.y = gy)
   order by case p_role
              when 'brawler' then public._bt_dist(ex, ey, gx, gy)              -- вперёд
              when 'skirm'   then abs(public._bt_dist(ex, ey, gx, gy)
                                      - public._bt_dist(ex, ey, ax, ay))       -- по центру
              else            -public._bt_dist(ex, ey, gx, gy)                 -- в тыл
            end,
            public._bt_dist(ax, ay, gx, gy), gx, gy
   limit 1;
  return coalesce(out_xy, public._bt_spawn_free(p_battle, 'def'));
end$fn$;
revoke all on function public._bt_bot_slot(uuid,text) from public;

-- ── 4. ДРАФТ ЛЕГИОНА ────────────────────────────────────────────────
-- Бюджет режется по долям доктрины; каждый шаг добирает роль с самым
-- большим недобором. Один проект — не больше трёх бортов: иначе доктрина
-- вырождается в шесть копий самого дорогого корпуса.
create or replace function public._fc_place_bots(p_battle uuid, p_budget numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare bot text := public._bt_bot_fid(); rf text := public._bt_bot_roster_default();
        sp jsonb; fc int; k numeric; spent numeric := 0; placed int := 0;
        guard int := 0; cap int := least(public._bt_cap(), 12); xy int[]; sb jsonb;
        doc jsonb; cand jsonb; roles text[]; rl text; lim numeric;
        by_role jsonb := '{}'::jsonb; dupcap int := 3;
        pick_id uuid; pick_price numeric; pick_role text; rest numeric;
begin
  perform public._bt_ensure_field(p_battle);      -- форма и сектора — до расстановки
  select b.spawn into sp from public.battles b where b.id = p_battle;
  fc := public._bt_spawn_facing(sp, 'defender');
  k  := public._fc_price_k();
  doc := public._bt_bot_doctrine(p_battle, 'defender');

  -- ростер с ценой и ролью считаем ОДИН раз: дальше драфт только выбирает
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', fu.id, 'name', fu.name,
           'price', greatest(1, round(public._fc_pw(fu.id) * k)),
           'role', public._bt_bot_role_kit(fu.id))), '[]'::jsonb)
    into cand
    from public.faction_units fu
   where fu.category = 'ship'
     and coalesce(fu.faction_id,'') = rf
     and coalesce((fu.summary->>'hp')::numeric, 0) > 0
     and not exists(select 1 from public.bt_bot_exclude bx where bx.unit_id = fu.id);
  if jsonb_array_length(cand) = 0 then
    raise exception 'у ростера ботов «%» нет боеспособных проектов', rf;
  end if;

  loop
    guard := guard + 1;
    exit when guard > 200 or placed >= cap;
    rest := p_budget - spent;

    -- Роли по ДОЛЕ НАБРАННОГО, а не по абсолютному недобору: иначе дорогая
    -- роль (снайперы, арта) выгребает весь предел бортов, а дешёвая — вроде
    -- поддержки — не набирается вовсе, потому что её недобор всегда меньше.
    select array_agg(q.rl order by q.fill, q.rl) into roles
      from (select r as rl,
                   coalesce((by_role->>r)::numeric, 0)
                     / greatest(1, coalesce((doc->>r)::numeric, 0) * p_budget) as fill
              from unnest(array['brawler','skirm','sniper','support']) r) q;

    pick_id := null;
    foreach rl in array roles loop
      -- потолок покупки: недобор роли плюс десятина бюджета, но не больше остатка
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
               where bu.battle_id = p_battle and bu.unit_id = (c->>'id')::uuid) < dupcap
       order by (c->>'price')::numeric desc, random()
       limit 1;
      if pick_id is not null then pick_role := rl; exit; end if;
    end loop;

    -- остаток бюджета доедаем чем придётся: доктрина уже набрана
    if pick_id is null then
      select (c->>'id')::uuid, (c->>'price')::numeric, c->>'role'
        into pick_id, pick_price, pick_role
        from jsonb_array_elements(cand) c
       where (c->>'price')::numeric <= rest
         and (select count(*) from public.battle_units bu
               where bu.battle_id = p_battle and bu.unit_id = (c->>'id')::uuid) < dupcap + 1
       order by (c->>'price')::numeric desc, random()
       limit 1;
    end if;

    -- Ростер беден: доли роли выбраны, а бюджет ещё есть. Ослабляем предел
    -- копий и заходим на второй круг — лучше три «Крюка», чем непотраченная
    -- четверть казны. Выше девяти копий одного проекта не поднимаемся.
    if pick_id is null and dupcap < 9 and rest > 0 then
      dupcap := dupcap + 1;
      continue;
    end if;
    exit when pick_id is null;

    xy := public._bt_bot_slot(p_battle, pick_role);
    exit when xy is null;                          -- сектор забит
    sb := public._bt_stats(pick_id);
    if sb is null then continue; end if;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl)
      values (p_battle, bot, 'defender', pick_id, sb->>'name', sb->>'cls', xy[1], xy[2],
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

  if placed = 0 then
    raise exception 'у ростера ботов «%» нет бортов по карману арены', rf;
  end if;
  return jsonb_build_object('n', placed, 'spent', spent, 'budget', p_budget,
                            'doctrine', doc->>'why', 'by_role', by_role);
end$$;
revoke all on function public._fc_place_bots(uuid,numeric) from public;

-- ── 5. ДРАФТ НА ГОНГЕ, А НЕ НА ЖЕРЕБЬЁВКЕ ───────────────────────────
alter table public.battles add column if not exists bot_budget numeric;
comment on column public.battles.bot_budget is
  'бюджет легиона: флот собирается на гонге, когда состав игроков уже виден';

create or replace function public._fc_spawn_bot_duel(p_fids text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare bid uuid; sys text; med numeric; total numeric; per numeric; botb numeric;
        n int := coalesce(array_length(p_fids, 1), 0); f text;
        bot text := public._bt_bot_fid();
begin
  if n < 1 then raise exception 'на арену некого выпускать'; end if;
  if n > public._fc_party_max() then raise exception 'жребий вытянул слишком много держав'; end if;
  if bot = any(p_fids) then raise exception 'fid бота совпал с державой игрока'; end if;

  select percentile_cont(0.5) within group (order by coalesce((fu.summary->>'cost')::numeric, 0))
    into med
    from public.faction_units fu
   where public._fc_qualifies(fu);
  if med is null then
    raise exception 'в клубе нет боеспособных гладиаторов — накатите _club_gladiators*.sql';
  end if;

  total := greatest(1, round(public._fc_pool_mult() * greatest(med, 1)));
  per   := greatest(1, round(total / n));
  botb  := greatest(1, round(total * public._fc_bot_edge()));

  select id into sys from public.map_systems order by random() limit 1;
  if sys is null then raise exception 'нет систем для арены'; end if;

  insert into public.battles(system_id, attacker_fid, defender_fid, status, kind,
                             att_ready, def_ready, side_to_move, turn_no, acts_left,
                             duel_budget, bot_budget, deadline_at)
    values (sys, p_fids[1], bot, 'forming', 'duel', false, true, 'attacker', 0,
            public._bt_acts(), per, botb,
            now() + (public._fc_form_hours() || ' hours')::interval)
    returning id into bid;

  foreach f in array p_fids loop
    insert into public.battle_allies(battle_id, fid, side, ready)
      values (bid, f, 'attacker', false)
      on conflict (battle_id, fid) do nothing;
    perform public._fc_make_pool(bid, f, 'attacker', per, sys);
  end loop;

  perform public._bt_log(bid, format(
    '🥊 Арена Бойцовского клуба: %s против вольницы «%s». Бюджет драфта — %s ГС на державу; у легиона его на %s%% больше. Состав вольницы соберут по гонгу — под ваш строй. Победа — только на уничтожение.',
    (select string_agg(public._war_nm(x), ', ') from unnest(p_fids) x),
    public._war_nm(bot), per::bigint,
    round((public._fc_bot_edge() - 1) * 100)::int));

  return jsonb_build_object('battle_id', bid, 'budget', per, 'total', total,
    'bot_budget', botb, 'bots', 0, 'party', to_jsonb(p_fids));
end$$;
revoke all on function public._fc_spawn_bot_duel(text[]) from public;

create or replace function public._fc_kick_off(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b record; bots jsonb;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'forming' then return; end if;

  -- ДРАФТ ЛЕГИОНА. Строй игроков уже на доске — доктрина читает именно его.
  if b.defender_fid = public._bt_bot_fid() and coalesce(b.bot_budget, 0) > 0
     and not exists(select 1 from public.battle_units u
                     where u.battle_id = p_battle and u.side = 'defender') then
    begin
      bots := public._fc_place_bots(p_battle, b.bot_budget);
      perform public._bt_log(p_battle, format(
        'Вольница выставила %s бортов на %s ГС. Замысел: %s.',
        (bots->>'n'), (bots->>'spent')::numeric::bigint, (bots->>'doctrine')));
    exception when others then
      perform public._bt_log(p_battle, 'Легион не смог собрать состав: ' || sqlerrm);
    end;
  end if;

  update public.battle_units set moved = false, fired = false, acted = false, flash = false
   where battle_id = p_battle and side = 'attacker';
  update public.battle_units u
     set facing = case when b.spawn is null
                       then (case when u.side = 'defender' then 3 else 0 end)
                       else public._bt_spawn_facing(b.spawn, u.side) end
   where u.battle_id = p_battle;
  update public.battles
     set status = 'active', side_to_move = 'attacker', turn_no = 1,
         acts_left = public._bt_acts(),
         deadline_at = now() + (public._bt_turn_hours() || ' hours')::interval
   where id = p_battle;
  perform public._bt_log(p_battle, 'Бой начался. Первый ход за нападающими.');
end$$;
revoke all on function public._fc_kick_off(uuid) from public;

-- ── 6. ЗАМЫСЕЛ НА ХОД: фокус огня и рубеж развёртывания ─────────────
create unlogged table if not exists public.bt_bot_plan(
  battle_id uuid primary key,
  side      text not null,
  focus     uuid,
  committed boolean not null default true,
  turn_no   int not null default 0
);
alter table public.bt_bot_plan enable row level security;
revoke all on table public.bt_bot_plan from anon, authenticated;

comment on table public.bt_bot_plan is
  'замысел ИИ на ход: цель фокуса огня и решение «пора сходиться»';

create or replace function public._bt_bot_plan_build(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $fn$
declare b record; seen uuid[]; fo uuid; mine int; ready int; nearest int; go boolean;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null then return; end if;

  delete from public.bt_bot_plan p
   where not exists(select 1 from public.battles z where z.id = p.battle_id);
  delete from public.bt_bot_plan where battle_id = p_battle;

  seen := public._bt_seen_get(p_battle, p_side);
  if seen is null then seen := public._bt_seen_calc(p_battle, p_side); end if;
  if seen is null then seen := '{}'::uuid[]; end if;

  -- ФОКУС: лекарь врага, затем самый зубастый из тех, до кого дотягиваются
  -- хотя бы двое — цель, которую сторона реально способна снять за ход.
  select e.id into fo
    from public.battle_units e
    cross join lateral (
      select count(*) as reachers
        from public.battle_units f
       where f.battle_id = p_battle and f.alive and f.side = p_side
         and public._bt_dist(f.x, f.y, e.x, e.y) <= public._bt_bot_reach(f.id)
                                                    + coalesce(f.speed, 0)
    ) rr
   where e.battle_id = p_battle and e.alive and e.side <> p_side
     and e.id = any(seen)
     and rr.reachers > 0
   order by exists(select 1 from jsonb_array_elements(coalesce(e.acts,'[]'::jsonb)) a
                    where a->>'k' in ('drones','wboost','hard')) desc,   -- лекарь и «Эгида»
            (rr.reachers >= 2) desc,
            (coalesce(e.dmg,0) * (1 + coalesce(jsonb_array_length(e.acts), 0)))
              / greatest(1, coalesce(e.hp,0) + coalesce(e.shield,0)) desc,
            e.id
   limit 1;

  -- РУБЕЖ РАЗВЁРТЫВАНИЯ: заходим в огонь всем строем, а не по одному.
  select count(*) into mine from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side;
  select count(*) into ready from public.battle_units f
   where f.battle_id = p_battle and f.alive and f.side = p_side
     and exists(select 1 from public.battle_units e
                 where e.battle_id = p_battle and e.alive and e.side <> p_side
                   and public._bt_dist(f.x, f.y, e.x, e.y) <= public._bt_bot_reach(f.id));
  select coalesce(min(public._bt_dist(f.x, f.y, e.x, e.y)), 999) into nearest
    from public.battle_units f
    join public.battle_units e
      on e.battle_id = p_battle and e.alive and e.side <> p_side
   where f.battle_id = p_battle and f.alive and f.side = p_side;

  go := coalesce(b.turn_no, 0) >= 4                 -- выдержка не вечна
        or mine <= 2
        or ready * 2 >= mine                        -- полстроя уже достаёт
        or nearest <= 2;                            -- враг сам зашёл в упор

  insert into public.bt_bot_plan(battle_id, side, focus, committed, turn_no)
    values (p_battle, p_side, fo, go, coalesce(b.turn_no, 0));
end$fn$;
revoke all on function public._bt_bot_plan_build(uuid,text) from public;

create or replace function public._bt_bot_focus(p_battle uuid)
returns uuid language sql stable security definer set search_path=public as $$
  select p.focus from public.bt_bot_plan p where p.battle_id = p_battle;
$$;
revoke all on function public._bt_bot_focus(uuid) from public;

create or replace function public._bt_bot_committed(p_battle uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select p.committed from public.bt_bot_plan p
                    where p.battle_id = p_battle), true);
$$;
revoke all on function public._bt_bot_committed(uuid) from public;

-- ── 7. ВЫБОР ЦЕЛИ СО ССЫЛКОЙ НА ФОКУС ───────────────────────────────
-- Правило прежнее (добить → больнее и опаснее), но между ними встаёт фокус
-- стороны: если цель замысла борту по зубам, залп идёт туда. Так шесть
-- активаций складываются в один убитый борт, а не в шесть поцарапанных.
create or replace function public._bt_bot_target(p_battle uuid, p_unit uuid)
returns uuid language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; maxr int; res uuid; seen uuid[]; fo uuid;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.fired then return null; end if;
  select * into b from public.battles where id = p_battle;
  maxr := public._bt_bot_reach(p_unit);
  fo   := public._bt_bot_focus(p_battle);

  seen := public._bt_seen_get(p_battle, u.side);
  if seen is null then seen := public._bt_seen_calc(p_battle, u.side); end if;
  if array_length(seen, 1) is null then return null; end if;

  select t.id into res
    from public.battle_units t
    cross join lateral (
      select coalesce(sum((g->>'dmg')::numeric
               * (1 - least(0.9, greatest(-0.75,
                   coalesce((t.resist->>coalesce(g->>'k','kinetic'))::numeric, 0))))), 0) as eff
        from jsonb_array_elements(
               case when u.wpn is null or jsonb_array_length(u.wpn) = 0
                    then jsonb_build_array(jsonb_build_object('rng', u.rng, 'dmg', u.dmg))
                    else u.wpn end) g
       where coalesce(g->>'k','kinetic') <> 'repair'
         and public._bt_dist(u.x, u.y, t.x, t.y)
             between greatest(1, coalesce((g->>'dmin')::int, 1)) and (g->>'rng')::int
    ) w
   where t.battle_id = p_battle and t.alive and t.side <> u.side
     and t.id = any(seen)
     and public._bt_dist(u.x, u.y, t.x, t.y) between 1 and maxr
     and public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y)
     and w.eff > 0
   order by (w.eff >= t.hp + t.shield) desc,                       -- добить
            (fo is not null and t.id = fo) desc,                   -- фокус стороны
            w.eff / greatest(1, t.hp + t.shield)
              * (1 + greatest(0, t.dmg) / greatest(1, u.max_hp)) desc,   -- больнее и опаснее
            t.id
   limit 1;
  return res;
end$fn$;
revoke all on function public._bt_bot_target(uuid,uuid) from public;

-- ── 8. ХОД БОРТА: выдержка до общего захода ─────────────────────────
create or replace function public._bt_bot_act(p_battle uuid, p_unit uuid, p_fid text)
returns boolean language plpgsql security definer set search_path=public as $fn$
declare u record; role text; band int; mode text; did boolean := false;
        m jsonb; tgt uuid; path jsonb; reserve numeric; i int; hpq numeric;
        near int; threat numeric; foe_reach int;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive then return false; end if;

  role := public._bt_bot_role(p_battle, p_unit);
  band := public._bt_bot_band(p_battle, p_unit);
  hpq  := coalesce(u.hp,0) / greatest(1, coalesce(u.max_hp,1));
  select coalesce(min(public._bt_dist(u.x, u.y, e.x, e.y)), 999) into near
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;
  threat := public._bt_threat_at(p_battle, u.side, u.x, u.y, false);
  select coalesce(max(greatest(1, e.rng)), 1) into foe_reach
    from public.battle_units e
   where e.battle_id = p_battle and e.alive and e.side <> u.side;

  -- ОТСТУПЛЕНИЕ: борт на последних процентах под сосредоточенным огнём
  -- уходит, а не разменивается — уцелевший корпус ещё повоюет.
  if hpq < 0.35 and threat > (u.hp + u.shield) * 0.5 then
    mode := 'back'; band := greatest(band, public._bt_bot_reach(p_unit) + 3);
  elsif not public._bt_bot_committed(p_battle)
        and role in ('brawler','skirm') and foe_reach <= 12
        and public._bt_bot_target(p_battle, p_unit) is null then
    -- ВЫДЕРЖКА: пока строй не собрался, ждём на шаг дальше чужого залпа.
    -- Тому, кому уже есть по кому стрелять, ждать нечего.
    mode := 'stand'; band := greatest(band, foe_reach + 1);
  elsif role = 'brawler' then
    mode := 'close';
  elsif near > band + 2 then
    mode := 'close';                      -- ещё далеко: сокращаем по потоку
  else
    mode := 'stand';                      -- на рубеже: держим и правим позицию
  end if;

  -- секунды под главный залп резервируем заранее
  reserve := case when not u.fired and public._bt_bot_target(p_battle, p_unit) is not null
                  then public._bt_fire_cost(u.cls) else 0 end;

  -- 8.1 предманёвренные модули (спасение, накрытие, разгон)
  for i in 1..2 loop
    m := public._bt_bot_module(p_battle, p_unit, reserve);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  -- 8.2 манёвр
  select * into u from public.battle_units where id = p_unit;
  if u.alive and not u.moved then
    path := public._bt_bot_route(p_battle, p_unit, mode, band);
    if coalesce(jsonb_array_length(path), 0) > 0 then
      begin
        perform public._bt_do_move(p_battle, p_unit, path, p_fid);
        did := true;
        perform public._bt_seen_arm(p_battle, u.side);
      exception when others then null; end;
    end if;
  end if;

  -- 8.3 залп
  tgt := public._bt_bot_target(p_battle, p_unit);
  if tgt is not null then
    begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
    exception when others then null; end;
  else
    tgt := public._bt_bot_repair(p_battle, p_unit);
    if tgt is not null then
      begin perform public._bt_do_fire(p_battle, p_unit, tgt, p_fid); did := true;
      exception when others then null; end;
    end if;
  end if;

  -- 8.4 остаток секунд — в модули
  for i in 1..3 loop
    m := public._bt_bot_module(p_battle, p_unit, 0);
    exit when m is null;
    begin
      perform public._bt_do_module(p_battle, p_unit, m->>'k',
                nullif(m->>'t','')::uuid, (m->>'x')::int, (m->>'y')::int, p_fid);
      did := true;
    exception when others then exit; end;
  end loop;

  -- 8.5 авиакрыло поднимаем, когда есть кому его встретить
  select * into u from public.battle_units where id = p_unit;
  if u.alive and coalesce(u.wings,0) > 0 and not u.is_wing and near <= 10 then
    begin perform public._bt_do_launch(p_battle, p_unit, p_fid); did := true;
    exception when others then null; end;
  end if;

  return did;
end$fn$;
revoke all on function public._bt_bot_act(uuid,uuid,text) from public;

-- ── 9. ХОД СТОРОНЫ: замысел строится вместе с полем ─────────────────
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

  -- поле потока, карту угрозы и замысел строим ОДИН раз: за наш ход враг с
  -- места не сходит
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

    -- очередь активации: добивающие → бьющие по фокусу → стреляющие →
    -- поддержка → сближающиеся
    select bu.id into pick
      from public.battle_units bu
      left join lateral (select public._bt_bot_target(p_battle, bu.id) as tid) tg on true
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and not bu.acted and not (bu.id = any(skip))
     order by
       (tg.tid is not null and exists(
          select 1 from public.battle_units z where z.id = tg.tid
            and z.hp + z.shield <= bu.dmg)) desc,          -- этот залп кого-то снимет
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
end$fn$;
revoke all on function public._bt_bot_turn(uuid) from public;

notify pgrst, 'reload schema';

-- Проверка:
--   select name, public._bt_bot_role_kit(id), public._fc_arena_price(id)
--     from faction_units where faction_id = public._bt_bot_roster_default()
--       and category='ship' order by 2, 3;
--   select public._bt_bot_doctrine('<battle>', 'defender');
--   select public._fc_place_bots('<battle>', 3000000);   → n / spent / doctrine
