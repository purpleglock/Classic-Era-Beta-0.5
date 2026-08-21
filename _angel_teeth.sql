-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 8: ОН ДЕЙСТВИТЕЛЬНО СТРЕЛЯЕТ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_no_grip.sql, перед _angel_lock.sql.
--   node tools/db_run.js _angel_teeth.sql
--   node tools/db_run.js _angel_lock.sql
-- Идемпотентно.
--
-- ЖАЛОБА: «он играет пассивно». Так и есть, и это не настройка чисел, а
-- арифметика активаций. Разбор:
--   • ход машинной стороны (_bt_bot_turn) перебирает борта с `not acted`;
--   • первое же действие борта зовёт _bt_use_act, а тот ставит acted = true
--     и снимает одну из шести активаций стороны (_war_battle_rework.sql);
--   • у ангела на доске РОВНО ОДИН борт (_angel_battle.sql, «ковчег один»).
-- Значит: борт активируется, делает одну активацию — до двух модулей, один
-- манёвр, ОДИН залп, ещё до трёх модулей — и в переборе больше некого взять.
-- Цикл выходит, ход заканчивается. Пять активаций из шести стороне ангела
-- просто некуда потратить.
--
-- А один залп _bt_do_fire — это все огневые группы по ОДНОЙ цели. То есть
-- ангел убивает ровно один корабль за ход. Ровно с той скоростью, с какой
-- игрок выставляет корветы по одному. Отсюда и ощущение «сосёт»: не потому,
-- что слаб, а потому, что ему выдали один спусковой крючок на ход.
--
-- ⚠️ И ЕЩЁ: tp_max = 60 (десять ходов обычного борта) выдан ему в
-- _angel_battle.sql ОСОЗНАННО — «за ход успевает всё, что позволит бюджет
-- действий стороны». Бюджет ему этого не позволял: пул времени не тратился,
-- потому что до второго залпа дело не доходило. Ведомость обещала одно, доска
-- давала другое.
--
-- ЛЕЧЕНИЕ. Ангелу — своя активация в _bt_bot_turn: борт поднимается заново,
-- пока есть кого бить, до acts_per_turn раз. Не «шесть кораблей по разу», как
-- у всех, а один корабль шесть раз — это и есть тот самый бюджет стороны,
-- просто потраченный единственным бортом. Ничьи другие правила не меняются:
-- у Легиона, ботов и клуба перебор остаётся прежним.
--
-- ЧТО ЭТО ЗНАЧИТ НА ДОСКЕ. Шесть залпов по 18 выстрелов из трёх каналов,
-- каждый с манёвром между ними при speed 12. Эскадрилья, вышедшая целиком,
-- перестаёт существовать за ход. Это и было написано в замысле: «бой с ним —
-- не бой, а протокол уничтожения того, кто пришёл».
-- ════════════════════════════════════════════════════════════

-- ── 0. ВЕДОМОСТЬ БОРТА НЕ ЗАТИРАТЬ ──────────────────────────
-- Вторая причина пассивности, и она грубее первой. В _bt_timepool.sql на
-- battle_units висит BEFORE INSERT триггер `trg_bt_tp_fill`: он переписывает
-- каждому вставленному борту tp_max = _bt_tp_max() (6 секунд), mitig и reduc —
-- по классу. Ангел вставляется тем же INSERT, значит его собственные числа
-- умирали, не дожив до доски:
--   • tp_max 60 → 6. Пул времени, которым он и должен был «успевать всё за
--     ход», обрезан до корветного. Один залп стоит 3.3 с — после манёвра на
--     второй уже не хватало;
--   • mitig/reduc → 500/0.8 из _bt_shield_spec('angel'), хотя в расстановке
--     стоит 1/1: у него нет щита вовсе, и щитовая арифметика ему не нужна.
-- Ведомость из _angel_battle.sql обещала одно, доска считала другое.
--
-- ⚠️ Это НЕ поблажка и не исключение из правил боя: правило «пул времени
-- задаёт борту его паспорт» как раз соблюдается — просто ангела вносили в
-- список после того, как паспорт уже затёрли. Надмножество живого триггера,
-- вставка одна.
create or replace function public._bt_tp_fill()
returns trigger language plpgsql as $fn$
declare sp jsonb; rg jsonb; k numeric; wm jsonb;
begin
  -- ◈ ПРЕСТОЛ. Свои числа расстановки — не трогаем ничего.
  if public._angel_is(new.fid) then return new; end if;

  sp := public._bt_shield_spec(new.cls);
  new.tp_max     := public._bt_tp_max();
  new.tp         := new.tp_max;
  new.mitig      := (sp->>'m')::numeric;
  new.reduc      := (sp->>'r')::numeric;
  new.shield     := 0;
  new.max_shield := 0;

  rg := public._rg_unit_reactor(new.unit_id);
  if rg ? 'stab' then
    k := public._rg_tp_coef((rg->>'stab')::numeric);
    new.tp_max := round(new.tp_max * k, 2);
    new.tp     := new.tp_max;
    new.stealth := greatest(1, new.stealth - round(coalesce((rg->>'sig')::numeric, 0))::int);
  end if;

  begin
    wm := public._fm_war_mods(new.fid);
    if coalesce((wm->>'tp')::numeric, 0) <> 0 then
      new.tp_max := greatest(1, round(new.tp_max * (1 + (wm->>'tp')::numeric), 2));
      new.tp     := new.tp_max;
    end if;
    if coalesce((wm->>'armor')::numeric, 0) <> 0 and coalesce(new.armor, 0) > 0 then
      new.armor := round(new.armor * (1 + (wm->>'armor')::numeric), 2);
    end if;
  exception when others then null;
  end;

  return new;
end$fn$;
drop trigger if exists trg_bt_tp_fill on public.battle_units;
create trigger trg_bt_tp_fill before insert on public.battle_units
  for each row execute function public._bt_tp_fill();

-- Уже стоящие на доске борта ангела чиним на месте.
update public.battle_units u
   set tp_max = public._bt_tp_max() * 10,
       tp     = public._bt_tp_max() * 10,
       mitig  = 1, reduc = 1, shield = 0, max_shield = 0
 where public._angel_is(u.fid) and u.tp_max is distinct from public._bt_tp_max() * 10;

create or replace function public._angel_bt_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'acts_per_turn' then 6   -- активаций единственного борта за свой ход
    else 0 end
$$;

-- ── 1. ХОД МАШИННОЙ СТОРОНЫ — НАДМНОЖЕСТВО ──────────────────
-- Живая версия из _legion_battle_ai.sql, слово в слово. Добавлена ОДНА ветка:
-- если машинная сторона — ангел, крутим его борт заново.
-- ⚠️ Правки хода машинной стороны вести ОТСЮДА: этот файл теперь последний.
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer as $$
declare bot text; botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
        au uuid; foes int; cap int; i int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status <> 'active' then return; end if;
  perform public._bt_arm(p_battle);
  botside := b.side_to_move;
  bot := case when botside = 'attacker' then b.attacker_fid else b.defender_fid end;
  if not public._bt_is_machine(bot) then return; end if;

  if botside = 'defender'
     and not exists(select 1 from public.battle_units u
                     where u.battle_id = p_battle and u.side = 'defender') then
    begin perform public._bt_bot_draft_due(p_battle); exception when others then null; end;
  end if;

  perform public._bt_flow_build(p_battle, botside);
  perform public._bt_risk_build(p_battle, botside);
  perform public._bt_seen_arm(p_battle, botside);
  perform public._bt_bot_plan_build(p_battle, botside);

  -- ── ◈ ПРЕСТОЛ: ОДИН БОРТ, ШЕСТЬ АКТИВАЦИЙ ─────────────────
  if public._angel_is(bot) then
    cap := greatest(1, public._angel_bt_const('acts_per_turn')::int);
    select bu.id into au from public.battle_units bu
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and bu.fid = bot limit 1;

    for i in 1..cap loop
      exit when au is null;
      select status into st from public.battles where id = p_battle;
      exit when st <> 'active';
      select count(*) into foes from public.battle_units z
       where z.battle_id = p_battle and z.alive and z.side <> botside;
      exit when foes = 0;

      -- Борт поднимается заново: активация возвращается ему и стороне.
      -- ⚠️ Только для ангела и только внутри его собственного хода — за
      -- пределами этой ветки acted по-прежнему означает «отработал».
      update public.battle_units
         set acted = false, moved = false, fired = false
       where battle_id = p_battle and fid = bot and alive;
      update public.battles
         set acts_left = greatest(coalesce(acts_left,0), 1) where id = p_battle;

      perform public._bt_seen_arm(p_battle, botside);
      did := public._bt_bot_act(p_battle, au, bot);
      exit when not did;          -- бить некого и идти некуда — хватит
    end loop;

    delete from public.bt_bot_flow where battle_id = p_battle;
    delete from public.bt_bot_risk where battle_id = p_battle;
    delete from public.bt_bot_plan where battle_id = p_battle;

    select status into st from public.battles where id = p_battle;
    if st = 'active' then
      begin perform public._bt_do_end_turn(p_battle, bot); exception when others then null; end;
    end if;
    return;
  end if;

  -- ── обычная машинная сторона: как было ────────────────────
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

  select * into b from public.battles where id = p_battle;
  if b.status = 'active' and b.side_to_move is distinct from botside then
    begin
      perform public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
    exception when others then null; end;
  end if;
end $$;

-- ── 2. ОТКУП: КОМУ РАЗРЕШЕНО ТЯНУТЬ ─────────────────────────
-- Именной пропуск на бой с ангелом без ограничителей шага 7: ни лимита ходов,
-- ни получасовых часов. Заводится ТОЛЬКО руками стаффа и ТОЛЬКО на срок —
-- пока он висит, ковчег действительно стоит на месте, и это касается всей
-- галактики, а не только владельца пропуска.
create table if not exists public.angel_grip_waiver (
  fid    text primary key,
  until  timestamptz not null,
  note   text,
  since  timestamptz not null default now()
);
alter table public.angel_grip_waiver enable row level security;

create or replace function public._angel_waived(p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.angel_grip_waiver w
                 where w.fid = p_fid and w.until > now())
$$;
revoke all on function public._angel_waived(text) from public;

create or replace function public.admin_angel_waiver(p_fid text, p_hours numeric default 24)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  if coalesce(p_hours, 0) <= 0 then
    delete from public.angel_grip_waiver where fid = p_fid;
    return jsonb_build_object('ok', true, 'fid', p_fid, 'cleared', true);
  end if;
  insert into public.angel_grip_waiver(fid, until, note)
    values (p_fid, now() + (p_hours || ' hours')::interval, 'ручной пропуск')
  on conflict (fid) do update set until = excluded.until, since = now();
  return jsonb_build_object('ok', true, 'fid', p_fid, 'hours', p_hours);
end$$;
revoke all on function public.admin_angel_waiver(text, numeric) from public;
revoke all on function public.admin_angel_waiver(text, numeric) from anon;
grant execute on function public.admin_angel_waiver(text, numeric) to authenticated;

-- ── 3. ОБХОД УЧИТЫВАЕТ ПРОПУСК ──────────────────────────────
-- Надмножество шага 5 из _angel_no_grip.sql. Вставка одна: у кого пропуск —
-- того не торопим и бой не закрываем. Правило «его там нет» остаётся для всех:
-- доска без ковчега сломана независимо от чьих-либо прав.
create or replace function public._angel_grip_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; fsys text; fst text; b record; sd text; foe text;
        spent int; over int := 0; slipped int := 0; forced int := 0;
        clamped int := 0; ghost int := 0; waived int := 0;
        cap int; lim interval; frm interval; tmin int;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  select f.system_id, f.status into fsys, fst
    from public.fleets f
    join public.angel_state a on a.fleet_id = f.id
   where a.faction_id = af;
  cap  := public._angel_grip_const('turn_cap')::int;
  lim  := (public._angel_grip_const('grip_h') || ' hours')::interval;
  frm  := (public._angel_grip_const('form_h') || ' hours')::interval;
  tmin := public._angel_grip_const('turn_min')::int;

  for b in select * from public.battles
            where status <> 'done' and (attacker_fid = af or defender_fid = af)
  loop
    -- 5.0 ЕГО ТАМ НЕТ — сильнее любого пропуска.
    if coalesce(fst,'') <> 'idle' or fsys is null or fsys is distinct from b.system_id then
      begin perform public._angel_slip(b.id); ghost := ghost + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.0.1 ПРОПУСК: этот бой живёт по старым правилам доски.
    foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;
    if public._angel_waived(foe) then waived := waived + 1; continue; end if;

    -- 5.1 ХОДЫ КОНЧИЛИСЬ.
    spent := coalesce(b.turn_no, 0);
    if b.status = 'active'
       and (spent >= cap
            or coalesce(b.att_turns_left, 1) <= 0
            or coalesce(b.def_turns_left, 1) <= 0) then
      begin perform public._angel_slip(b.id); over := over + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.2 СТЕНА ПО ЧАСАМ.
    if now() - b.created_at > lim
       or (b.status = 'forming' and now() - b.created_at > frm) then
      begin perform public._angel_slip(b.id); slipped := slipped + 1;
      exception when others then null; end;
      continue;
    end if;

    -- 5.3 ЧАСЫ.
    if b.status = 'active' and b.side_to_move is not null then
      sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;
      if b.side_to_move <> sd then
        if b.deadline_at is null or b.deadline_at > now() + (tmin || ' minutes')::interval then
          update public.battles set deadline_at = now() + (tmin || ' minutes')::interval
           where id = b.id;
          clamped := clamped + 1;
        elsif b.deadline_at <= now() then
          begin
            if public._angel_force_turn(b.id) then forced := forced + 1; end if;
          exception when others then null; end;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'over', over, 'slipped', slipped,
                            'ghost', ghost, 'forced', forced, 'clamped', clamped,
                            'waived', waived);
end$$;
revoke all on function public._angel_grip_sweep() from public;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) select public.fc_bot_turn('<бой>'); на ходу ангела → в журнале несколько
--    залпов подряд с манёврами между ними, а не один.
-- 2) select public.admin_angel_waiver('fac_...', 24); → его бой перестаёт
--    закрываться по ходам и часам; select public.admin_angel_waiver('fac_...', 0)
--    снимает пропуск.
-- 3) Бой Легиона: ход по-прежнему шесть РАЗНЫХ бортов по разу.
