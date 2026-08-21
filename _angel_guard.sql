-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 15: СТРАЖА. КОВЧЕГ ПЕРЕСТАЁТ БЫТЬ НЕПРИКАСАЕМЫМ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: последним в цепочке ангела — после _angel_core, _angel_battle,
-- _angel_shells, _angel_ai, _angel_no_grip, _angel_teeth, _angel_moves_on,
-- _angel_no_conscript, _angel_wipe_end, _bt_arm_perf. Это надмножество девяти
-- живых функций (_bt_hit, _bt_arm, _bt_tp_fill, _fleet_kill_ships, _angel_slip,
-- _bt_check_end, _angel_grip_sweep, _bt_bot_turn, angel_engage, angel_status):
-- ⚠️ правки перечисленного вести ОТСЮДА.
--
-- ЗАЧЕМ. До этого шага ковчег не брало НИЧТО, кроме печатей: доска боя ему
-- ничего не делала, флот был декорацией, а единственным инструментом кампании
-- оставалась «Длань» с МЗА. Это честно как загадка, но мертво как игра: держава
-- без стратегического оружия не могла даже начать, а держава с ним не имела
-- причин строить флот.
--
-- ЧТО МЕНЯЕМ. У Престола появляется СТРАЖА: три дредноута в системе «Великий
-- трон» — там же, где гнездо. Это не ангелы, это подобия: тот же спрайт,
-- снятый на ступень вниз (четыре крыла вместо шести, два обода вместо трёх,
-- ни нимба, ни огня — см. opt.guard в angel_fx.js). Для боевого движка они
-- ОБЫЧНЫЕ дредноуты класса dreadnought: обычный пул времени, обычный урон,
-- обычная смерть. Отличает их только метка pk.gd, по которой клиент выбирает
-- облик, — и то, зачем они стоят.
--
-- ПОЧЕМУ КЛАСС ЧЕСТНЫЙ. Соблазн был завести cls='angel_guard'. Нельзя: класс
-- читают щиты (_bt_shield_spec), доворот (_bt_turnneed), скрытность, размер
-- силуэта на клиенте и драфт ботов. Новый ключ дал бы им умолчания везде и
-- разом — то есть тихо неправильные числа в пяти местах. Облик — дело метки,
-- а не класса.
--
-- ПРАВИЛО. Пока жива хоть одна стража — ковчег на доске неуязвим, как и был.
-- Стражи не стало — и попадания флота начинают рвать печати (перевод урона в
-- печати ниже, _angel_bt_take). Парирование при этом работает: без подавления
-- баллистикой флот прогрызает вчетверо медленнее. Тактика складывается сама —
-- сначала выбить стражу, потом глушить, потом бить.
--
-- ПОЧЕМУ СТРАЖА НЕ ВОЗРОЖДАЕТСЯ. Печати зарастают, стража — нет. Иначе стена
-- восстанавливалась бы быстрее, чем её ломают, и весь шаг был бы декорацией.
-- Убитая стража убита навсегда (пересбор — только руками стаффа).
-- ════════════════════════════════════════════════════════════

-- ── 1. БАЛАНС СТРАЖИ ────────────────────────────────────────
create or replace function public._angel_guard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'n'          then 3       -- сколько дредноутов в страже
    when 'hp'         then 42000
    when 'armor'      then 700
    when 'dmg'        then 5200
    when 'rng'        then 22
    when 'speed'      then 6
    when 'resist'     then 0.35
    -- перевод урона по ковчегу в печати (работает ТОЛЬКО когда стражи нет)
    when 'open_resist' then 0.45   -- вместо каталожных 0.9: стена пала
    when 'open_armor'  then 1200
    when 'seal_hp'     then 2500   -- корпуса на одну печать
    when 'press_hit'   then 0.05   -- давление за попадание с доски
    else 0 end
$$;

-- ── 2. РЕЕСТР ───────────────────────────────────────────────
-- Кто такая стража, определяется НАЛИЧИЕМ строки, а не классом борта.
create table if not exists public.angel_guard (
  unit_id    uuid primary key,
  faction_id text not null,
  fleet_id   uuid,
  name       text not null,
  ord        int  not null default 1,
  dead_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.angel_guard enable row level security;

create or replace function public._angel_guard_left()
returns int language sql stable security definer set search_path=public as $$
  select count(*)::int from public.angel_guard where dead_at is null
$$;

-- Ковчег НА ЭТОЙ доске. Все особые правила боя с ангелом (роспуск, лимит
-- ходов, часы, конец по пустой доске) держатся именно на этом, а не на fid:
-- бой со стражей — обычный бой обычной державы и живёт по общим правилам.
create or replace function public._angel_ark_bt(p_battle uuid)
returns text language sql stable security definer set search_path=public as $$
  select u.fid from public.battle_units u
   where u.battle_id = p_battle and u.cls = 'angel' limit 1
$$;

-- ── 3. СБОР СТРАЖИ ──────────────────────────────────────────
-- Идемпотентно: зовётся и накатом, и админской дверью. Убитых не воскрешает.
create or replace function public.angel_guard_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; app record; ecoown uuid; n int; i int; uid uuid; flid uuid;
        made int := 0; comp jsonb := '[]'::jsonb; nm text;
        ord_nm text[] := array['Первый','Второй','Третий','Четвёртый','Пятый'];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false, 'why', 'ангела нет'); end if;
  select * into app from public.faction_applications
   where faction_id = a.faction_id and status = 'approved' order by updated_at desc limit 1;
  select owner_id into ecoown from public.faction_economy where faction_id = a.faction_id;
  n := greatest(1, public._angel_guard_const('n')::int);

  -- Флот стражи: один на всех, стоит в гнезде и никуда не ходит.
  select g.fleet_id into flid from public.angel_guard g
   where g.faction_id = a.faction_id and g.fleet_id is not null limit 1;
  if flid is not null and not exists(select 1 from public.fleets where id = flid) then flid := null; end if;
  if flid is null then
    insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                              composition, is_station, fuel, fuel_cap)
      values (a.faction_id, ecoown, 'СТРАЖА', 'idle', a.home_sys, a.home_sys,
              '[]'::jsonb, false, 99, 99)
      returning id into flid;
  end if;

  for i in 1..n loop
    uid := ('a0000000-0000-4000-8000-e261f549aa0' || i)::uuid;
    nm  := 'Херувим. ' || coalesce(ord_nm[i], i::text);
    -- Убитого не собираем заново: строка осталась, dead_at стоит.
    if exists(select 1 from public.angel_guard g where g.unit_id = uid and g.dead_at is not null) then
      continue;
    end if;

    insert into public.faction_units(id, category, name, faction_id, faction_name,
                                     faction_color, owner_id, summary, data, card_text)
      values (uid, 'ship', nm, a.faction_id, coalesce(app.name, 'Престол'),
              coalesce(app.color, '#e6d38f'), ecoown,
              jsonb_build_object(
                'hp',    public._angel_guard_const('hp'),
                'armor', public._angel_guard_const('armor'),
                'dmg',   public._angel_guard_const('dmg'),
                'rng',   public._angel_guard_const('rng'),
                'speed', public._angel_guard_const('speed'),
                'radar', 18,
                'armor_resist', jsonb_build_object(
                  'kinetic', public._angel_guard_const('resist'),
                  'energy',  public._angel_guard_const('resist'),
                  'missile', public._angel_guard_const('resist'))),
              jsonb_build_object('class', 'dreadnought', 'angel_guard', true,
                                 'layout', jsonb_build_object('mounts', '[]'::jsonb),
                                 'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
              'Оно сделало их по своему подобию и оставило у порога.')
      on conflict (id) do update
        set name = excluded.name, faction_id = excluded.faction_id,
            summary = excluded.summary, data = excluded.data;

    -- Из драфта ботов исключаем: это не каталожный борт, а часть кризиса.
    begin
      insert into public.bt_bot_exclude(unit_id, why) values (uid, 'стража Престола')
        on conflict (unit_id) do nothing;
    exception when others then null; end;

    insert into public.angel_guard(unit_id, faction_id, fleet_id, name, ord)
      values (uid, a.faction_id, flid, nm, i)
      on conflict (unit_id) do update set fleet_id = excluded.fleet_id, name = excluded.name;
    made := made + 1;
    comp := comp || jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1));
  end loop;

  if jsonb_array_length(comp) > 0 then
    update public.fleets set composition = comp, system_id = a.home_sys,
                             status = 'idle', dest_sys = null, from_sys = null
     where id = flid;
  end if;

  return jsonb_build_object('ok', true, 'fleet', flid, 'made', made,
                            'left', public._angel_guard_left());
end$$;
revoke all on function public.angel_guard_muster() from public, anon;

create or replace function public.admin_angel_guard_muster()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._angel_staff_only();
  return public.angel_guard_muster();
end$$;
revoke all on function public.admin_angel_guard_muster() from public, anon;
grant execute on function public.admin_angel_guard_muster() to authenticated;

-- Полный пересбор (стража поднимается заново) — только руками стаффа.
create or replace function public.admin_angel_guard_reset()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._angel_staff_only();
  delete from public.angel_guard;
  return public.angel_guard_muster();
end$$;
revoke all on function public.admin_angel_guard_reset() from public, anon;
grant execute on function public.admin_angel_guard_reset() to authenticated;

-- ── 4. СМЕРТЬ СТРАЖА ────────────────────────────────────────
-- Триггером, а не разбором в конце боя: доску можно кончить пятью способами
-- (роспуск, лимит ходов, часы, выбитая доска, ручная дверь), и на каждом из
-- них потерю пришлось бы ловить заново. Строка «alive → false» одна на все.
create or replace function public._angel_guard_fell()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare g record; left_n int;
begin
  if new.alive or coalesce(old.alive, true) = false then return new; end if;
  select * into g from public.angel_guard where unit_id = new.unit_id and dead_at is null;
  if g.unit_id is null then return new; end if;

  update public.angel_guard set dead_at = now() where unit_id = new.unit_id;
  left_n := public._angel_guard_left();

  begin
    perform public._bt_log(new.battle_id, public._angel_glitch(
      '◈ ' || g.name || ' больше не отвечает. Обломки идут прежним курсом', 0.24)
      || ' ' || public._angel_scream(9));
  exception when others then null; end;

  if left_n <= 0 then
    -- ⚠️ Игроку НЕ объясняем, что именно изменилось: он увидит это сам, когда
    -- следующее попадание перестанет быть бесполезным.
    begin
      perform public._angel_news(public._angel_glitch('◈ У ПОРОГА ПУСТО', 0.26),
        public._angel_glitch(
          'Отметки сопровождения погасли одна за другой. Отметка в центре '
          || 'держит курс и не меняет ни скорости, ни высоты', 0.18)
        || ' ' || public._angel_scream(12));
    exception when others then null; end;
  end if;
  return new;
end$fn$;
drop trigger if exists trg_angel_guard_fell on public.battle_units;
create trigger trg_angel_guard_fell after update of alive on public.battle_units
  for each row execute function public._angel_guard_fell();

-- ── 5. ПЕРЕВОД УРОНА В ПЕЧАТИ ───────────────────────────────
-- Зовётся ТОЛЬКО когда стражи не осталось. Парирование то же самое, что у
-- залпов: без подавления баллистикой флот прогрызает вчетверо медленнее.
create or replace function public._angel_bt_take(p_fid text, p_dmg numeric, p_k text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; rk numeric; hull numeric; loss numeric; pp numeric; left_s numeric;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  rk   := public._angel_guard_const('open_resist');
  hull := greatest(0, p_dmg * (1 - rk) - public._angel_guard_const('open_armor'));
  if hull <= 0 then return jsonb_build_object('ok', true, 'loss', 0); end if;

  pp   := public._angel_parry_p(p_fid);
  loss := hull / public._angel_guard_const('seal_hp') * (1 - pp);

  update public.angel_state
     set press = least(public._angel_const('press_cap'),
                       press + public._angel_guard_const('press_hit')),
         last_press = now(),
         seals = greatest(0, seals - loss),
         last_hit = case when loss > 0 then now() else last_hit end,
         last_regen = case when loss > 0 then now() else last_regen end
   where faction_id = p_fid
  returning seals into left_s;

  if left_s <= 0 then perform public._angel_fall(p_fid, null); end if;
  return jsonb_build_object('ok', true, 'loss', round(loss, 3), 'fell', (left_s <= 0));
end$$;
revoke all on function public._angel_bt_take(text,numeric,text) from public;

-- ── 6. ПОПАДАНИЕ ПО КОВЧЕГУ ─────────────────────────────────
-- Надмножество _angel_battle.sql. Изменений два: ветка ангела ловится по КЛАССУ
-- борта (иначе неуязвимой становилась и стража — у неё тот же fid), и сама
-- неуязвимость держится только пока стража жива.
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text,
                                         p_terr jsonb, p_pierce boolean default false,
                                         p_src uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
        gid uuid; redirected boolean := false; nseen int; took jsonb;
begin
  -- ◈ ПРЕСТОЛ. Ковчег отличаем по классу борта, а не по державе: стража носит
  -- тот же fid и обязана умирать как обычный дредноут.
  if exists(select 1 from public.battle_units z
             where z.id = p_target and z.cls = 'angel' and public._angel_is(z.fid)) then
    select * into t from public.battle_units where id = p_target;
    nseen := coalesce((t.pk->>'ang')::int, 0) + 1;
    update public.battle_units
       set hp = max_hp, alive = true, deb = '{}'::jsonb, blind = 0,
           pk = coalesce(pk, '{}'::jsonb) || jsonb_build_object('ang', nseen)
     where id = p_target;

    if public._angel_guard_left() > 0 then
      -- Стража цела — попадание не значит ничего, как и раньше.
      -- ⚠️ НЕ ПИШЕМ «урона нет»: это готовая инструкция «флотом не пытайся».
      if nseen % 5 = 1 then
        perform public._bt_log(t.battle_id, public._angel_glitch(
          '◈ Попадание подтверждено оптикой. Оценка ущерба ', 0.22)
          || public._angel_scream(13));
      end if;
      return jsonb_build_object('hull', 0, 'shield_absorbed', 0, 'killed', false,
                                'angel', true);
    end if;

    -- Стражи нет: попадание рвёт печати. Чисел наружу не отдаём — ни в ответе
    -- двери, ни в журнале: полоса у ковчега по-прежнему одна, и она секретна.
    took := public._angel_bt_take(t.fid, p_dmg, p_k);
    if nseen % 4 = 1 then
      perform public._bt_log(t.battle_id, public._angel_glitch(
        '◈ Попадание. Что-то в нём подалось', 0.30) || ' ' || public._angel_scream(11));
    end if;
    return jsonb_build_object('hull', 0, 'shield_absorbed', 0, 'killed', false,
                              'angel', true, 'open', true);
  end if;

  -- «Эгида»: удар по прикрытому союзнику переадресуется гвардейцу целиком —
  -- вместе со щитом, бронёй и корпусом. Считаем ДО блокировки строки цели.
  gid := public._bt_guard_for(p_target);
  if gid is not null then p_target := gid; redirected := true; end if;

  select * into t from public.battle_units where id = p_target for update;
  if t.id is null or not t.alive then return jsonb_build_object('hull',0,'shield_absorbed',0,'killed',false); end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if p_pierce then rsh := 0; end if;                    -- таран идёт сквозь поле
  if public._bt_terra(p_terr, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(p_terr, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  if public._bt_deb_has(t.deb, 'soft') then rk := rk * 0.7; end if;
  if coalesce(p_k,'kinetic') = 'missile' then
    rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
  end if;
  if p_pierce then rk := greatest(0, rk) * 0.35; end if;
  gdmg := p_dmg * (1 - rk) * dmgfac;

  if rsh > 0 and gdmg > 0 then
    use_sec := least(rsh, gdmg / greatest(1, t.mitig));
    absb    := use_sec * t.mitig * t.reduc;
    rsh     := rsh - use_sec;
  end if;

  hull := greatest(gdmg * 0.10, (gdmg - absb) - case when p_pierce then 0 else t.armor end);
  if gdmg <= 0 then hull := 0; end if;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set shield = case when p_pierce then shield else rsh end,
         hp = greatest(0, t.hp - hull), alive = not killed
   where id = p_target;
  if redirected and hull > 0 then
    perform public._bt_log(t.battle_id, format('«Эгида» %s принимает удар на себя: %s урона%s',
      t.unit_name, round(hull), case when killed then ' — гвардеец уничтожен' else '' end));
  end if;

  if public._bt_perk_martyr(p_target, hull) then
    select bu.alive into killed from public.battle_units bu where bu.id = p_target;
    killed := not killed;
  end if;

  if killed then
    if public._bt_perk_save(p_target) then killed := false;
    else perform public._bt_grave_add(t.battle_id, t.x, t.y); end if;
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absb);
    perform public._bt_perk_side(p_target, absb + hull, p_src);
    perform public._bt_perk_despair(p_target);
  end if;

  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb),
                            'killed', killed, 'guard', redirected);
end$$;

-- ── 7. ВОССТАНОВЛЕНИЕ — ТОЛЬКО КОВЧЕГУ ──────────────────────
-- Надмножество _bt_arm_perf.sql. Вставка одна: «u.cls = 'angel'». Без неё
-- стража воскресала бы к началу каждого хода — и выбить её было бы нельзя.
create or replace function public._bt_arm(p_battle uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare vw int; vh int; af text; sf numeric; dim numeric; seen text;
begin
  select b.bw, b.bh into vw, vh from public.battles b where b.id = p_battle;
  perform set_config('bt.w', coalesce(vw, public._bt_wbig())::text, true);
  perform set_config('bt.h', coalesce(vh, public._bt_hbig())::text, true);

  af := public._angel_fid();
  if af is null then return; end if;

  seen := coalesce(current_setting('bt.armed', true), '');
  if position(('|' || p_battle::text || '|') in ('|' || seen || '|')) > 0 then return; end if;

  if not exists(select 1 from public.battle_units u
                 where u.battle_id = p_battle and u.fid = af and u.cls = 'angel') then return; end if;

  perform set_config('bt.armed', nullif(seen,'') || case when seen = '' then '' else '|' end
                                 || p_battle::text, true);

  select greatest(0, least(1, a.seals / nullif(public._angel_const('seals_max'),0)))
    into sf from public.angel_state a where a.faction_id = af;
  dim := case when sf > 0.62 then 1.0 when sf > 0.24 then 0.62 else 0.34 end;

  update public.battle_units u
     set hp = u.max_hp, alive = true,
         tp = u.tp_max, mcd = '{}'::jsonb, deb = '{}'::jsonb,
         blind = 0, moved = false, fired = false,
         pk = (coalesce(u.pk, '{}'::jsonb) - 'seal') || jsonb_build_object('dim', dim)
   where u.battle_id = p_battle and u.fid = af and u.cls = 'angel'
     and (u.hp is distinct from u.max_hp
       or u.alive is distinct from true
       or u.tp is distinct from u.tp_max
       or coalesce(u.mcd, '{}'::jsonb) <> '{}'::jsonb
       or coalesce(u.deb, '{}'::jsonb) <> '{}'::jsonb
       or coalesce(u.blind, 0) <> 0
       or coalesce(u.moved, false)
       or coalesce(u.fired, false)
       or coalesce(u.pk, '{}'::jsonb) ? 'seal'
       or (coalesce(u.pk, '{}'::jsonb)->>'dim') is distinct from dim::text);
end$function$;

-- ── 8. ПАСПОРТ ПРИ РАССТАНОВКЕ ──────────────────────────────
-- Надмножество _angel_teeth.sql. Там ангел ловился по державе, и стража
-- получила бы пустой пул времени — сторона не смогла бы ей ходить.
create or replace function public._bt_tp_fill()
returns trigger language plpgsql as $fn$
declare sp jsonb; rg jsonb; k numeric; wm jsonb;
begin
  -- ◈ ПРЕСТОЛ. Свои числа расстановки — только у ковчега. Стража идёт общим
  -- путём: она обычный дредноут и должна считаться как дредноут.
  if new.cls = 'angel' and public._angel_is(new.fid) then return new; end if;

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

-- ── 9. КОРАБЛИ СНИМАЕТ ТОЛЬКО У КОВЧЕГА ─────────────────────
-- Надмножество _angel_shells.sql. Заслонка стояла по державе — под неё попадала
-- и стража: «Сполох», мины и ловушки её не брали. Оставляем заслонку ровно
-- одному флоту — тому, который и есть тело.
create or replace function public._fleet_kill_ships(p_fleet uuid, p_kill int)
returns int language plpgsql security definer set search_path=public as $$
declare fl public.fleets; elem jsonb; comp jsonb := '[]'::jsonb;
        total int := 0; kill int; left_k int; q int; cut int; killed int := 0;
begin
  select * into fl from public.fleets where id = p_fleet for update;
  if not found then return 0; end if;
  -- ◈ ПРЕСТОЛ: сам ковчег по кораблям не считают. Урон по нему — только печати.
  if exists(select 1 from public.angel_state a where a.fleet_id = p_fleet) then return 0; end if;

  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into total
    from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c;
  if total <= 0 then return 0; end if;
  kill := least(total, greatest(0, p_kill));
  if kill <= 0 then return 0; end if;
  left_k := kill;
  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    q := greatest(0, coalesce((elem->>'qty')::int, 0));
    cut := least(q, ceil(kill * q::numeric / total)::int, left_k);
    left_k := left_k - cut; killed := killed + cut;
    if q - cut > 0 then
      comp := comp || jsonb_set(elem, '{qty}', to_jsonb(q - cut));
    end if;
  end loop;
  if killed < kill and jsonb_array_length(comp) > 0 then
    q := greatest(0, coalesce((comp->0->>'qty')::int, 0));
    cut := least(q, kill - killed); killed := killed + cut;
    if q - cut > 0 then comp := jsonb_set(comp, '{0,qty}', to_jsonb(q - cut));
    else comp := comp - 0; end if;
  end if;
  -- Стража, погибшая ВНЕ доски (мины, «Сполох»), тоже считается погибшей.
  if killed > 0 then
    update public.angel_guard g set dead_at = now()
     where g.fleet_id = p_fleet and g.dead_at is null
       and not exists (select 1 from jsonb_array_elements(comp) c
                        where (c->>'unit_id')::uuid = g.unit_id
                          and coalesce((c->>'qty')::int, 0) > 0);
  end if;
  if jsonb_array_length(comp) = 0 then
    delete from public.fleets where id = p_fleet;
  else
    update public.fleets set composition = comp where id = p_fleet;
  end if;
  return killed;
end$$;

-- ── 10. СТРАЖА ВЫХОДИТ НА ДОСКУ ─────────────────────────────
-- Своя расстановка, а не общий драфт: паспорт стражи задан здесь (турелей у
-- этих бортов нет, каталожный счёт дал бы им ноль урона), а сторона у них
-- машинная — выставлять их некому.
create or replace function public._angel_guard_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; g record; n int := 0;
        dmg numeric; rng int; res numeric; wpn jsonb;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', false, 'why', 'нет боя'); end if;

  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;

  -- Выставляем только тех, чей флот втянут в ЭТОТ бой.
  if not exists (select 1 from public.angel_guard g2
                  join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
                 where bf.battle_id = p_battle and g2.dead_at is null) then
    return jsonb_build_object('ok', true, 'placed', 0, 'why', 'стражи в этом бою нет');
  end if;

  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, sd);
  dmg := public._angel_guard_const('dmg');
  rng := public._angel_guard_const('rng')::int;
  res := public._angel_guard_const('resist');
  wpn := jsonb_build_array(
    jsonb_build_object('rng', rng,     'dmg', round(dmg * 0.50), 'k', 'energy',  'shots', 4,
                       'opt', public._bt_wpn_opt('energy'),  'far', public._bt_wpn_far('energy'),
                       'dmin', public._bt_wpn_dmin('energy')),
    jsonb_build_object('rng', rng - 4, 'dmg', round(dmg * 0.32), 'k', 'kinetic', 'shots', 4,
                       'opt', public._bt_wpn_opt('kinetic'), 'far', public._bt_wpn_far('kinetic'),
                       'dmin', public._bt_wpn_dmin('kinetic')),
    jsonb_build_object('rng', rng + 4, 'dmg', round(dmg * 0.18), 'k', 'missile', 'shots', 3,
                       'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
                       'dmin', public._bt_wpn_dmin('missile')));

  for g in select g2.* from public.angel_guard g2
             join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
            where bf.battle_id = p_battle and g2.dead_at is null
            order by g2.ord
  loop
    continue when exists (select 1 from public.battle_units u
                           where u.battle_id = p_battle and u.unit_id = g.unit_id);
    xy := public._bt_bot_slot_side(p_battle, 'brawler', sd);
    if xy is null then xy := public._bt_bot_slot_side(p_battle, 'skirm', sd); end if;
    exit when xy is null;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl, pk)
      values (p_battle, af, sd, g.unit_id, g.name, 'dreadnought', xy[1], xy[2],
        public._angel_guard_const('hp'), public._angel_guard_const('hp'),
        public._angel_guard_const('armor'), 0, 0, dmg,
        public._angel_guard_const('speed')::int, rng,
        fc, public._bt_turnneed('dreadnought'), 18, 1, wpn,
        jsonb_build_object('kinetic', res, 'energy', res, 'missile', res),
        0.25, 2, 0, 2, 2, false, true, false,
        -- ⚠️ МЕТКА ОБЛИКА. Класс у них честный, а рисуются они спрайтом ангела
        -- на ступень ниже (см. opt.guard в angel_fx.js).
        jsonb_build_object('gd', 1));
    n := n + 1;
  end loop;

  if n > 0 then
    if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
    perform public._bt_log(p_battle, public._angel_glitch(
      '◈ Сопровождение разворачивается в линию. Три отметки, одинаковые до последнего знака', 0.24)
      || ' ' || public._angel_scream(8));
  end if;

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    begin perform public._fc_kick_off(p_battle); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'placed', n);
end$$;
revoke all on function public._angel_guard_deploy(uuid) from public;

-- ── 11. ВЫЙТИ НАВСТРЕЧУ ─────────────────────────────────────
-- Надмножество _angel_no_conscript.sql. Раньше дверь искала в системе ТОЛЬКО
-- ковчег; теперь целью может быть и стража — а если в системе стоят оба, на
-- доску выходят оба разом. Стража прикрывает не «по правилу неуязвимости»,
-- а буквально: она стоит рядом и стреляет.
create or replace function public.angel_engage(p_fleet uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl record; af text; foe record; b uuid; extra record; n int := 0;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  select * into fl from public.fleets where id = p_fleet;
  if fl.id is null or fl.faction_id is distinct from fid then
    return jsonb_build_object('ok', false, 'why', 'это не ваш флот');
  end if;
  if fl.status <> 'idle' or fl.system_id is null then
    return jsonb_build_object('ok', false, 'why', 'флот в пути');
  end if;
  if public._fleet_in_battle(fl.id) is not null then
    return jsonb_build_object('ok', false, 'why', 'флот уже в бою');
  end if;

  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', false, 'why', 'цели нет'); end if;

  -- Первым берём ковчег, если он здесь; иначе — флот стражи.
  select f.* into foe from public.fleets f
    join public.angel_state a on a.fleet_id = f.id
   where a.faction_id = af and f.status = 'idle' and f.system_id = fl.system_id;
  if foe.id is null then
    select f.* into foe from public.fleets f
     where f.faction_id = af and f.status = 'idle' and f.system_id = fl.system_id
       and exists (select 1 from public.angel_guard g
                    where g.fleet_id = f.id and g.dead_at is null)
     limit 1;
  end if;
  if foe.id is null then
    return jsonb_build_object('ok', false, 'why', 'в этой системе его нет');
  end if;

  begin
    if not public.at_war(af, fid) then perform public._angel_declare(fid); end if;
  exception when others then null; end;

  perform set_config('angel.engage', '1', true);
  b := public._war_engage(fl.id, foe.id, fl.system_id, 'meeting');
  -- Остальные его флоты в этой системе втягиваем в тот же бой: разделять
  -- ковчег и стражу нечестно — они стоят вместе.
  if b is not null then
    for extra in select f.id from public.fleets f
                  where f.faction_id = af and f.status = 'idle'
                    and f.system_id = fl.system_id and f.id <> foe.id
    loop
      insert into public.battle_fleets(battle_id, fleet_id, fid, side)
        select b, extra.id, af,
               case when (select attacker_fid from public.battles where id = b) = af
                    then 'attacker' else 'defender' end
      on conflict (battle_id, fleet_id) do nothing;
      n := n + 1;
    end loop;
  end if;
  perform set_config('angel.engage', '0', true);
  if b is null then return jsonb_build_object('ok', false, 'why', 'сойтись не вышло'); end if;

  begin perform public.angel_battle_deploy(b); exception when others then null; end;
  begin perform public._angel_guard_deploy(b); exception when others then null; end;

  perform public._bt_log(b, public._angel_glitch(
    '◈ Приказ отдан. Курс на сближение. Дальномер держит отметку', 0.24)
    || ' ' || public._angel_scream(9));

  return jsonb_build_object('ok', true, 'battle', b, 'fleets', n + 1);
end$$;
revoke all on function public.angel_engage(uuid) from public, anon;
grant execute on function public.angel_engage(uuid) to authenticated;

-- ── 12. РОСПУСК ДОСКИ ───────────────────────────────────────
-- Надмножество _angel_moves_on.sql. Вставка одна: с доски снимаем ТОЛЬКО
-- ковчег. Раньше здесь стояло «все борта его державы», и вместе с ковчегом
-- исчезала убитая стража — потери не доходили до состава флота, и выбитые
-- дредноуты оказывались живы.
create or replace function public._angel_slip(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; foe text; sysname text; r record; f record;
        comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
        dest text; gone jsonb := null;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', true, 'skip', true); end if;
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;

  -- Борт ангела снимаем с доски: доска кончилась, тело возвращается ковчегу.
  delete from public.battle_units where battle_id = p_battle and fid = af and cls = 'angel';

  -- Потери — только реально погибшие на доске (стража сюда входит).
  for r in select fid, unit_id, count(*) as n
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
            group by 1,2
  loop
    dead := dead + r.n;
    loss := r.n;
    for f in select bf.fleet_id from public.battle_fleets bf
              where bf.battle_id = p_battle and bf.fid = r.fid
    loop
      exit when loss <= 0;
      select composition into comp from public.fleets where id = f.fleet_id for update;
      newc := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) loop
        if (e->>'unit_id')::uuid = r.unit_id and loss > 0 then
          q := greatest(0, coalesce((e->>'qty')::int,0));
          if q <= loss then loss := loss - q; q := 0;
          else q := q - loss; loss := 0; end if;
          if q > 0 then newc := newc || jsonb_build_array(jsonb_set(e, array['qty'], to_jsonb(q), true)); end if;
        else
          newc := newc || jsonb_build_array(e);
        end if;
      end loop;
      update public.fleets set composition = newc where id = f.fleet_id;
    end loop;
  end loop;

  -- Флот, у которого не осталось ни одного корабля, распускаем.
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  -- ⚠️ winner_fid НЕ ставим: победы не было. Флага никто не поднимает.
  update public.battles
     set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
   where id = p_battle;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._angel_tell(foe,
    public._angel_glitch('◈ ' || coalesce(sysname,'?') || ': стрельба прекратилась', 0.22),
    public._angel_glitch(
      'Цель перестала отвечать на манёвры и держит орбиту так, будто боя не было. '
      || 'Уцелевшие возвращаются. Что считать итогом, штаб', 0.16)
    || ' ' || public._angel_scream(13));

  -- ── ОНО ИДЁТ ДАЛЬШЕ ───────────────────────────────────────
  begin
    if exists(select 1 from public.angel_state s
               where s.faction_id = af and s.stance = 'roost') then
      select case when s.home_sys is distinct from b.system_id then s.home_sys end
        into dest from public.angel_state s where s.faction_id = af;
    end if;
    if dest is null then dest := public._angel_pick_target(); end if;
    if dest is not null and dest is distinct from b.system_id then
      gone := public._angel_send(dest);
    end if;
  exception when others then gone := jsonb_build_object('ok', false, 'why', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'battle', p_battle, 'foe', foe, 'dead', dead,
                            'left', gone);
end$$;
revoke all on function public._angel_slip(uuid) from public;

-- ── 13. КОНЕЦ БОЯ ───────────────────────────────────────────
-- Надмножество _angel_wipe_end.sql. Ветка ангела включается по КОВЧЕГУ НА
-- ДОСКЕ, а не по державе: бой с одной стражей — обычный бой, и кончаться он
-- обязан обычным образом, с победителем, флагом и разбором резерва.
create or replace function public._bt_check_end(p_battle uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare b record; a_alive int; d_alive int; a_pool int; d_pool int;
        win text; is_bot boolean; af text;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return; end if;
  if b.status <> 'active' then return; end if;

  select count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'attacker'),
         count(*) filter (where coalesce(pk->'hj'->>'s', side) = 'defender')
    into a_alive, d_alive
    from public.battle_units where battle_id = p_battle and alive;

  -- ── ◈ ПРЕСТОЛ: доска пуста — сражение отгремело ───────────
  af := public._angel_ark_bt(p_battle);
  if af is not null then
    if (b.attacker_fid = af and d_alive = 0)
       or (b.defender_fid = af and a_alive = 0)
       -- ковчега на доске не стало (пал по печатям, снят админом) — тоже конец
       or not exists (select 1 from public.battle_units u
                       where u.battle_id = p_battle and u.cls = 'angel' and u.alive) then
      perform public._angel_slip(p_battle);
    end if;
    return;
  end if;

  select exists(select 1 from public.admin_bot_duel where one = 1 and battle_id = p_battle)
    into is_bot;

  if is_bot then
    if a_alive = 0 then win := b.defender_fid;
    elsif d_alive = 0 then win := b.attacker_fid;
    end if;
  else
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.attacker_fid)),0) into a_pool;
    select coalesce(jsonb_array_length(public.battle_pool(p_battle, b.defender_fid)),0) into d_pool;
    if a_alive = 0 and a_pool = 0 then win := b.defender_fid;
    elsif d_alive = 0 and d_pool = 0 then win := b.attacker_fid;
    end if;
  end if;

  if win is null then return; end if;
  perform public._bt_finish(p_battle, win);
end$function$;
revoke all on function public._bt_check_end(uuid) from public;
grant execute on function public._bt_check_end(uuid) to authenticated;

-- ── 14. ОБХОД БОЁВ ──────────────────────────────────────────
-- Надмножество _angel_teeth.sql. Вставка одна: обход берёт только доски, НА
-- КОТОРЫХ СТОИТ КОВЧЕГ. Ограничители шага 7 (получасовые часы, лимит ходов,
-- роспуск по стене) придуманы против одного — против того, что ковчег нельзя
-- держать боем. Стражу держать боем можно и нужно: её для того и выбивают.
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
              and public._angel_ark_bt(id) is not null
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

-- ── 15. ХОД МАШИННОЙ СТОРОНЫ ────────────────────────────────
-- Надмножество _angel_teeth.sql. Раньше ветка ангела выбирала ОДИН борт и
-- уходила из функции — стража на доске стояла бы столбами. Теперь: ковчег
-- получает свои шесть активаций, а дальше сторона доигрывает ход обычным
-- перебором, и стража ходит как любой машинный флот.
create or replace function public._bt_bot_turn(p_battle uuid)
returns void language plpgsql security definer as $$
declare bot text; botside text;
        b record; pick uuid; skip uuid[] := '{}'; guard int := 0;
        st text; acts int; did boolean;
        au uuid; foes int; cap int; i int; ang boolean := false;
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
  ang := public._angel_is(bot);
  if ang then
    select bu.id into au from public.battle_units bu
     where bu.battle_id = p_battle and bu.side = botside and bu.alive
       and bu.fid = bot and bu.cls = 'angel' limit 1;

    if au is not null then
      cap := greatest(1, public._angel_bt_const('acts_per_turn')::int);
      for i in 1..cap loop
        select status into st from public.battles where id = p_battle;
        exit when st <> 'active';
        select count(*) into foes from public.battle_units z
         where z.battle_id = p_battle and z.alive and z.side <> botside;
        exit when foes = 0;

        -- Борт поднимается заново: активация возвращается ему и стороне.
        -- ⚠️ Только ковчегу и только внутри его собственного хода.
        update public.battle_units
           set acted = false, moved = false, fired = false
         where id = au;
        update public.battles
           set acts_left = greatest(coalesce(acts_left,0), 1) where id = p_battle;

        perform public._bt_seen_arm(p_battle, botside);
        did := public._bt_bot_act(p_battle, au, bot);
        exit when not did;          -- бить некого и идти некуда — хватит
      end loop;

      -- Ковчег отработал: дальше он в переборе не участвует.
      update public.battle_units set acted = true where id = au;
      skip := skip || au;
      -- Страже полагается свой обычный ход — возвращаем бюджет стороне.
      update public.battles
         set acts_left = greatest(coalesce(acts_left, 0), public._bt_acts())
       where id = p_battle and status = 'active';
    end if;
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

  if not ang then
    select * into b from public.battles where id = p_battle;
    if b.status = 'active' and b.side_to_move is distinct from botside then
      begin
        perform public._bt_ally_turn(p_battle, greatest(1, public._bt_acts() / 2));
      exception when others then null; end;
    end if;
  end if;
end $$;

-- ── 16. РАССТАНОВКА В УЖЕ ЗАВЯЗАВШИХСЯ БОЯХ ─────────────────
-- Надмножество _angel_no_grip.sql: тот же тик, плюс выход стражи.
create or replace function public.angel_battle_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; d int := 0; g int := 0; af text;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  for b in select id from public.battles
            where status = 'forming' and (attacker_fid = af or defender_fid = af)
  loop
    begin
      if (public.angel_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null;
    end;
    begin
      g := g + coalesce((public._angel_guard_deploy(b.id)->>'placed')::int, 0);
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'deployed', d, 'guards', g);
end$$;
revoke all on function public.angel_battle_tick() from public;

-- ── 17. СВОДКА ──────────────────────────────────────────────
-- Надмножество _angel_core.sql. Наружу добавлены ровно две вещи: id флота
-- ковчега (карта по нему отличает тело от стражи и рисует облик) и СКОЛЬКО
-- стражи осталось. Второе — не секрет: отметки на карте и так пересчитываются
-- глазами, а прятать то, что видно, значит врать.
create or replace function public.angel_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; me text; mine boolean; f record; frac numeric; sysname text;
begin
  select * into a from public.angel_state order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'exists', false); end if;
  begin me := public._ec_my_fid_opt(); exception when others then me := null; end;
  mine := (me is not null and me = a.faction_id);

  select * into f from public.fleets where id = a.fleet_id;
  select coalesce(nullif(name,''), id) into sysname from public.map_systems
   where id = coalesce(f.system_id, f.from_sys, a.home_sys);
  frac := greatest(0, least(1, a.seals / nullif(public._angel_const('seals_max'), 0)));

  return jsonb_build_object(
    'ok', true, 'exists', true, 'fid', a.faction_id, 'mine', mine,
    'fell', (a.fell_at is not null), 'fell_at', a.fell_at,
    'stance', a.stance, 'system', sysname,
    'moving', (f.status = 'transit'), 'arrive_at', f.arrive_at,
    'fleet', a.fleet_id,
    'guards', public._angel_guard_left(),
    'guards_all', (select count(*)::int from public.angel_guard),
    'seals_frac', case when mine then round(frac, 3) end,
    'seals_word', case when mine then
                    case when a.fell_at is not null then 'пал'
                         when frac > 0.85 then 'целы'
                         when frac > 0.6  then 'тронуты'
                         when frac > 0.35 then 'рвутся'
                         when frac > 0.12 then 'на исходе'
                         else 'последняя' end
                  else public._angel_scream(7) end,
    'salvos_seen', case when mine then a.salvos_seen end,
    'salvos_parried', case when mine then a.salvos_parried end,
    'seals', case when mine then round(a.seals, 1) end,
    'press', case when mine then round(a.press, 2) end,
    'parry', case when mine then public._angel_parry_p(a.faction_id) end);
end$$;
revoke all on function public.angel_status() from public;
grant execute on function public.angel_status() to authenticated, anon;

-- ── 18. СОБРАТЬ СТРАЖУ ПРЯМО СЕЙЧАС ─────────────────────────
do $$
declare r jsonb;
begin
  begin
    r := public.angel_guard_muster();
    raise notice 'стража: %', r;
  exception when others then raise notice 'стражу собрать не вышло: %', sqlerrm;
  end;
end$$;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `select angel_status()` → guards = 3, fleet = id ковчега.
-- 2) В «Великом троне» стоит флот «СТРАЖА» из трёх бортов; на карте у него
--    ангельский спрайт на ступень ниже и бейдж численности.
-- 3) Флот игрока в той же системе → «Выйти навстречу» заводит бой; стража на
--    доске ходит и стреляет, восстановление к началу хода ей НЕ идёт.
-- 4) Попадание по страже снимает корпус; убитый борт уходит из состава флота
--    насовсем (перезайти и увидеть его живым нельзя).
-- 5) Пока стража жива — попадание по ковчегу даёт нуль, как и раньше.
-- 6) Стражи не осталось → попадания по ковчегу рвут печати (angel_status:
--    seals у своей державы убывает), при этом ковчег на доске не убивается.
-- 7) Бой, где ковчега нет вовсе, живёт по ОБЩИМ правилам: без получасовых
--    часов, без лимита ходов, кончается победой и флагом.

-- ── 19. КОВЧЕГ ВЫХОДИТ ДАЖЕ ТОГДА, КОГДА СТРАЖА УЖЕ НА ДОСКЕ ─
-- Надмножество _angel_battle.sql. Заслонка «его борт уже выставлен» смотрела
-- на ДЕРЖАВУ, а не на класс: стоило страже занять доску первой — и ковчег на
-- неё больше не выходил вовсе (проба: три Херувима стоят, «Престола» нет).
-- ⚠️ Правки расстановки ковчега вести ОТСЮДА.
create or replace function public.angel_battle_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; xy int[]; st jsonb; tpm numeric; fc int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then return jsonb_build_object('ok', false, 'why', 'нет боя'); end if;
  if b.status <> 'forming' then return jsonb_build_object('ok', false, 'why', 'бой уже идёт'); end if;

  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  if not public._angel_alive(af) then
    return jsonb_build_object('ok', false, 'why', 'ангел пал — выставлять нечего');
  end if;
  sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;

  -- ⚠️ ПО КЛАССУ, А НЕ ПО ДЕРЖАВЕ: борта той же державы на доске — это стража.
  if exists (select 1 from public.battle_units u
              where u.battle_id = p_battle and u.fid = af and u.cls = 'angel') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, sd);
  xy  := public._bt_bot_slot_side(p_battle, 'brawler', sd);
  if xy is null then xy := public._bt_bot_slot_side(p_battle, 'sniper', sd); end if;
  if xy is null then return jsonb_build_object('ok', false, 'why', 'сектор подхода забит'); end if;
  st  := public._angel_bt_stats();
  tpm := public._bt_tp_max() * 10;    -- десять полных ходов обычного борта

  insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
      hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
      facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
      dejam, eccm, interdict, stabil, ftl, tp, tp_max, acts, mcd, deb, mitig, reduc)
    values (p_battle, af, sd,
      (select unit_id from public.angel_state where faction_id = af),
      st->>'name', st->>'cls', xy[1], xy[2],
      (st->>'hp')::numeric, (st->>'hp')::numeric, (st->>'armor')::numeric,
      0, 0, (st->>'dmg')::numeric, (st->>'speed')::int, (st->>'rng')::int,
      fc, 0, (st->>'sensor')::int, (st->>'stealth')::int,
      st->'wpn', st->'resist', (st->>'pd')::numeric, (st->>'jam')::int, 0,
      (st->>'dejam')::int, (st->>'eccm')::int, true, true, true,
      tpm, tpm, public._angel_acts(), '{}'::jsonb, '{}'::jsonb, 1, 1);

  if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
  else                     update public.battles set def_ready = true where id = p_battle; end if;

  perform public._bt_log(p_battle, public._angel_glitch(
    '◈ Оно вошло в систему. Прицелы держат цель. Дальномер отказывается верить в её размер.', 0.26)
    || ' ' || public._angel_scream(10));

  select * into b from public.battles where id = p_battle;
  if b.att_ready and b.def_ready then perform public._fc_kick_off(p_battle); end if;

  return jsonb_build_object('ok', true, 'side', sd, 'x', xy[1], 'y', xy[2],
                            'started', (b.att_ready and b.def_ready));
end$$;
grant execute on function public.angel_battle_deploy(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 16: СТРАЖА ПО ЖИВОМУ МЕТАГЕЙМУ + ЗАЛП ПО КОВЧЕГУ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: сразу за шагом 15 (тот же файл, ниже по тексту).
--
-- ЧТО ВСКРЫЛОСЬ. Первая редакция стражи была собрана «на глаз»: 42 тысячи
-- корпуса и 5.2 тысячи урона. Замер по каталогу живых проектов:
--   «Победоносец» — 1 209 218 урона за залп, «Гигачад-тест» — 857 859,
--   «Бревноут» — 752 086, полдюжины линкоров в полосе 430-730 тысяч,
--   корпуса при этом 8-52 тысячи.
-- То есть нынешний метагейм — это размен «кто первый выстрелил, тот и убил»:
-- урон на порядок больше корпусов. Стража из первой редакции умирала от ОДНОГО
-- выстрела любого из этих бортов и не успевала выстрелить в ответ ни разу. Это
-- не стена, это лента на входе.
--
-- ВТОРОЕ, ХУЖЕ. Ветка ковчега стояла только в `_bt_hit`, а обычная стрельба
-- идёт мимо неё — через `_bt_do_fire`. Пока ковчег был неуязвим ВЕЗДЕ, это не
-- проявлялось: `_bt_arm` поднимал его каждым чихом. Стоило открыть его для
-- флота — и первый же залп на 700 тысяч снёс бы 900 тысяч корпуса не по
-- печатям, а напрямую, закрыв бой «выбитой доской» вместо кампании. Ниже
-- надмножество `_bt_do_fire` с той же веткой. ⚠️ Правки залпа вести ОТСЮДА.
--
-- КАК СЧИТАЛИ ЧИСЛА.
--   • Корпус стража 2 500 000 при стойкости 0.55: залп на 600 тысяч оставляет
--     ~245 тысяч, то есть десять залпов на одного Херувима, тридцать на всю
--     стражу. Флот из дюжины бортов кладёт стену за две-три ХОДА — долго, но
--     не бесконечно. Три борта — не кладут вовсе.
--   • Урон стража 60 000 в залпе (треть ковчега). Этого хватает, чтобы убивать
--     корпуса в 8-50 тысяч, но не хватает, чтобы снимать по два за активацию.
--   • Печать = 130 000 корпуса. Залп на 600 тысяч даёт ~2.15 печати ДО
--     парирования: под подавлением ~50 залпов на слом, без него — вчетверо
--     больше. Это ровно та же вилка, что у «Длани» (30-45 снарядов), только
--     платит за неё флот и временем боя.
--
-- МОДУЛИ. Первая редакция выдала страже пустой список действий — они умели
-- только стрелять и ходить. Теперь у них свой кит: «Эгида» (закрывают собой
-- соседа), броневой замок на своих рядом, ПРО, ракетный залп и бортовой
-- накрывающий. Ковчег в радиусе «Эгиды» ничего не получает и получить не
-- может — по нему урон не считают вовсе, — а вот друг друга они держат.
--
-- ПЕРКОВ У НИХ НЕТ. Перк — это карточка ЭКИПАЖА, а у подобий экипажа нет:
-- «оно сделало их по своему подобию», а не набрало команду. Поэтому ни
-- «Пульса покойника», ни «Пути мученика» — умирают они окончательно и молча.
-- ════════════════════════════════════════════════════════════

create or replace function public._angel_guard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'n'          then 3          -- сколько дредноутов в страже
    when 'hp'         then 2500000    -- ~10 залпов нынешнего линкора на борт
    when 'armor'      then 25000
    when 'dmg'        then 60000      -- треть ковчега; убивает любой корпус
    when 'rng'        then 24
    when 'speed'      then 6
    when 'resist'     then 0.55
    -- перевод урона по ковчегу в печати (работает ТОЛЬКО когда стражи нет)
    when 'open_resist' then 0.5       -- вместо каталожных 0.9: стена пала
    when 'open_armor'  then 20000
    when 'seal_hp'     then 130000    -- корпуса на одну печать
    when 'press_hit'   then 0.05      -- давление за попадание с доски
    else 0 end
$$;

-- Кит модулей стражи. Отдельной функцией — чтобы правился в одном месте и
-- ставился одинаково при расстановке и при разборе.
create or replace function public._angel_guard_acts()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('k', 'hard',      'cd', 3, 'val', 0.35, 'rng', 2),
    jsonb_build_object('k', 'aboost',    'cd', 4, 'val', 0.30, 'rng', 3),
    jsonb_build_object('k', 'pdup',      'cd', 4, 'val', 0.35, 'rng', 3),
    jsonb_build_object('k', 'salvo',     'cd', 3, 'dmg', 60000, 'rng', 12),
    jsonb_build_object('k', 'broadside', 'cd', 3, 'dmg', 45000, 'rng', 4),
    jsonb_build_object('k', 'rapid',     'cd', 4, 'val', 0.5))
$$;

-- ── РАССТАНОВКА СТРАЖИ: та же, плюс модули ──────────────────
create or replace function public._angel_guard_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; g record; n int := 0;
        dmg numeric; rng int; res numeric; wpn jsonb;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', false, 'why', 'нет боя'); end if;

  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  sd := case when b.attacker_fid = af then 'attacker' else 'defender' end;

  if not exists (select 1 from public.angel_guard g2
                  join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
                 where bf.battle_id = p_battle and g2.dead_at is null) then
    return jsonb_build_object('ok', true, 'placed', 0, 'why', 'стражи в этом бою нет');
  end if;

  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, sd);
  dmg := public._angel_guard_const('dmg');
  rng := public._angel_guard_const('rng')::int;
  res := public._angel_guard_const('resist');
  wpn := jsonb_build_array(
    jsonb_build_object('rng', rng,     'dmg', round(dmg * 0.50), 'k', 'energy',  'shots', 4,
                       'opt', public._bt_wpn_opt('energy'),  'far', public._bt_wpn_far('energy'),
                       'dmin', public._bt_wpn_dmin('energy')),
    jsonb_build_object('rng', rng - 4, 'dmg', round(dmg * 0.32), 'k', 'kinetic', 'shots', 4,
                       'opt', public._bt_wpn_opt('kinetic'), 'far', public._bt_wpn_far('kinetic'),
                       'dmin', public._bt_wpn_dmin('kinetic')),
    jsonb_build_object('rng', rng + 4, 'dmg', round(dmg * 0.18), 'k', 'missile', 'shots', 3,
                       'opt', public._bt_wpn_opt('missile'), 'far', public._bt_wpn_far('missile'),
                       'dmin', public._bt_wpn_dmin('missile')));

  for g in select g2.* from public.angel_guard g2
             join public.battle_fleets bf on bf.fleet_id = g2.fleet_id
            where bf.battle_id = p_battle and g2.dead_at is null
            order by g2.ord
  loop
    continue when exists (select 1 from public.battle_units u
                           where u.battle_id = p_battle and u.unit_id = g.unit_id);
    xy := public._bt_bot_slot_side(p_battle, 'brawler', sd);
    if xy is null then xy := public._bt_bot_slot_side(p_battle, 'skirm', sd); end if;
    exit when xy is null;

    insert into public.battle_units(battle_id, fid, side, unit_id, unit_name, cls, x, y,
        hp, max_hp, armor, shield, max_shield, dmg, speed, rng,
        facing, straight, sensor, stealth, wpn, resist, pd, jam, wings,
        dejam, eccm, interdict, stabil, ftl, acts, pk)
      values (p_battle, af, sd, g.unit_id, g.name, 'dreadnought', xy[1], xy[2],
        public._angel_guard_const('hp'), public._angel_guard_const('hp'),
        public._angel_guard_const('armor'), 0, 0, dmg,
        public._angel_guard_const('speed')::int, rng,
        fc, public._bt_turnneed('dreadnought'), 18, 1, wpn,
        jsonb_build_object('kinetic', res, 'energy', res, 'missile', res),
        0.25, 2, 0, 2, 2, false, true, false,
        public._angel_guard_acts(),
        -- ⚠️ МЕТКА ОБЛИКА. Класс у них честный, а рисуются они спрайтом ангела
        -- на ступень ниже (см. opt.guard в angel_fx.js).
        jsonb_build_object('gd', 1));
    n := n + 1;
  end loop;

  if n > 0 then
    if sd = 'attacker' then update public.battles set att_ready = true where id = p_battle;
    else                     update public.battles set def_ready = true where id = p_battle; end if;
    perform public._bt_log(p_battle, public._angel_glitch(
      '◈ Сопровождение разворачивается в линию. Отметки одинаковые до последнего знака', 0.24)
      || ' ' || public._angel_scream(8));
  end if;

  select * into b from public.battles where id = p_battle;
  if b.status = 'forming' and b.att_ready and b.def_ready then
    begin perform public._fc_kick_off(p_battle); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'placed', n);
end$$;
revoke all on function public._angel_guard_deploy(uuid) from public;

-- Паспорта уже собранной стражи подтянуть под новые числа.
select public.angel_guard_muster();

-- ── 20. ЗАЛП ФЛОТА: НАДМНОЖЕСТВО _bt_do_fire ───────────────
CREATE OR REPLACE FUNCTION public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО _bt_do_fire (см. _angel_guard.sql, шаг 20).
-- Вставка одна — ветка ковчега перед применением урона. Остальное слово в слово.
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false; too_close boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        use_sec numeric; covered numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
        fcost numeric; boost numeric := 1; rmul numeric := 1;
        grng int; gopt int; gfar numeric; fmul numeric; gdmin int;
        ride int := 0;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  fcost := public._bt_fire_cost(u.cls);
  if u.stance = 'wpn' then fcost := fcost * public._bt_wpn_cost(); end if;
  if coalesce(u.rapid, false) then fcost := fcost * 0.5; end if;   -- беглый огонь
  fcost := fcost * public._bt_perk_kchau(u.perks, u.stance);       -- «Кчау» вне разгона
  if u.tp + 1e-9 < fcost then
    raise exception '«%» не успевает дать залп: нужно % c, осталось % c',
      u.unit_name, round(fcost, 1), round(u.tp, 1);
  end if;
  if u.stance = 'wpn'   then boost := public._bt_wpn_mult(); end if;   -- ФОРСАЖ ОРУДИЙ
  if u.stance = 'siege' then                                          -- ОСАДНЫЙ РЕЖИМ
    boost := public._bt_siege_dmg();
    rmul  := public._bt_siege_rng();
  end if;
  boost := boost * (1 + coalesce(u.amp, 0));
  if public._bt_deb_has(u.deb, 'wbreak') then boost := boost * 0.5; end if;   -- «Ломовик»
  if public._bt_deb_has(u.deb, 'fury')   then boost := boost * 1.30; end if;  -- «Жажда крови»
  -- «Капитан-конформист»: за ход не сдвинулся — станки вышли на точность
  if public._bt_pk_has(u.perks, 'perk.conformist') and not coalesce(u.moved, false) then
    boost := boost * 1.25; rmul := rmul * 1.25;
  end if;
  -- «Бимрайдер»: разгон копился по гексам, сгорает этим залпом
  if public._bt_pk_has(u.perks, 'perk.beamrider') and u.cls = 'destroyer' then
    ride := least(5, greatest(0, coalesce((u.pk->>'ride')::int, 0)));
    boost := boost * (1 + 0.05 * ride);
  end if;

  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;

  if t.side <> u.side then
    declare g uuid; begin
      g := public._bt_guard_for(t.id);
      if g is not null then
        perform public._bt_log(p_battle, format('«Эгида» перехватывает залп, назначенный %s', t.unit_name));
        p_target := g;
        select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
      end if;
    end; end if;
  ally := (t.side = u.side);
  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- ══ РЕМОНТ СОЮЗНИКА (нано-рой) ═════════════════════════════
  if ally then
    if t.id = u.id then
      raise exception 'нано-рой чинит только ДРУГОЙ корабль — себя им не залатать';
    end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g
                   where g->>'k' = 'repair') then
      raise exception 'по своим не стреляем: на «%» нет ремонтных нано-роёв', u.unit_name;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'путь рою перекрыт астероидами';
    end if;
    for wg in select value from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) loop
      if wg->>'k' = 'repair' and dist >= 1 and dist <= (wg->>'rng')::int then
        band_ok := true;
        heal_sum := heal_sum + (wg->>'dmg')::numeric;
      end if;
    end loop;
    if not band_ok then
      raise exception 'дистанция % — дальше, чем добрасывает ремонтный рой «%». Сблизьтесь', dist, u.unit_name;
    end if;
    heal_sum := heal_sum * boost;      -- форсаж орудий качает и ремонтный рой
    if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then heal_sum := heal_sum * 0.7; end if;
    healed := least(round(heal_sum), greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел — ремонтировать нечего', t.unit_name; end if;

    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set hp = least(max_hp, hp + healed) where id = p_target;
    update public.battle_units
       set fired = true, flash = true, tp = greatest(0, tp - fcost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s ⟳ %s: нано-рой восстановил %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    perform public._bt_perk_heal(p_unit, healed);            -- «Сияй другим»
    return jsonb_build_object('ok', true, 'healed', round(healed), 'hull', 0,
                              'shield_absorbed', 0, 'resisted', 0, 'killed', false,
                              'tp', round(u.tp - fcost, 1));
  end if;

  -- ══ ОБЫЧНЫЙ ЗАЛП ═══════════════════════════════════════════
  if not exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing,
                                           greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                           t.x, t.y, t.stealth, t.flash)) then
    raise exception 'цель не захвачена: неопознанный контакт. Подведите корабль с радаром ближе (визуал — 3 гекса) или выбейте РЭБ-глушилки врага';
  end if;

  if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
    raise exception 'линия огня перекрыта астероидами';
  end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));   -- броневой замок цели
  if public._bt_deb_has(t.deb, 'soft') then dmgfac := dmgfac * 1.2; end if;   -- обшивка вспорота

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair' then
      -- Дальность группы: осадный режим и «Конформист» раздвигают рубеж.
      grng  := greatest(1, ceil((wg->>'rng')::numeric * rmul)::int);
      gdmin := greatest(1, coalesce((wg->>'dmin')::int,
                                    public._bt_wpn_dmin(wg->>'k')));
      if dist >= 1 and dist < gdmin then
        too_close := true;                       -- ракеты вплотную не наводятся
      elsif dist >= gdmin and dist <= grng then
        band_ok := true;
        -- Модель урона по дистанции: до gopt — полный, дальше линейно до gfar.
        gopt := greatest(1, floor(grng * coalesce((wg->>'opt')::numeric,
                                                  public._bt_wpn_opt(wg->>'k')))::int);
        gfar := coalesce((wg->>'far')::numeric, public._bt_wpn_far(wg->>'k'));
        if dist <= gopt or grng <= gopt then
          fmul := 1;
        else
          fmul := 1 - (1 - gfar) * (dist - gopt)::numeric / (grng - gopt)::numeric;
        end if;
        fmul := greatest(0.05, least(1, fmul));

        rk := least(0.9, greatest(-0.75, coalesce(
                (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
        if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
          rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
        end if;
        gdmg     := (wg->>'dmg')::numeric * boost * fmul * (1 - rk) * dmgfac;
        resisted := resisted + (wg->>'dmg')::numeric * boost * fmul * rk * dmgfac;
        grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
        per_shot := gdmg / grp_shots;
        for i in 1..grp_shots loop
          absb := 0;
          if rsh > 0 and per_shot > 0 then
            use_sec := least(rsh, per_shot / greatest(1, t.mitig));
            covered := use_sec * t.mitig;
            absb    := covered * t.reduc;
            rsh     := rsh - use_sec;
          end if;
          shabs     := shabs + absb;
          total_dmg := total_dmg + per_shot;
          hull_leak := hull_leak + (per_shot - absb);
        end loop;
      end if;
    end if;
  end loop;
  if not band_ok then
    if too_close then
      raise exception 'дистанция % — ракетам не хватает разгона на захват, отойдите дальше (нужно от % гексов)',
        dist, (select min(greatest(1, coalesce((g->>'dmin')::int, 1)))
                 from jsonb_array_elements(u.wpn) g
                where coalesce(g->>'k','kinetic') = 'missile');
    end if;
    raise exception 'дистанция % — дальше, чем бьют огневые группы «%». Сблизьтесь', dist, u.unit_name;
  end if;

  -- ── ◈ ПРЕСТОЛ: ЗАЛП ФЛОТА ПО КОВЧЕГУ ──────────────────────
  -- Сюда приходит ОБЫЧНАЯ стрельба, и именно здесь живут те 500-700 тысяч, что
  -- вливают нынешние дредноуты. Через `_bt_hit` идут только модули, таран и
  -- ядерка — если ветку ковчега держать лишь там, залп из орудий пойдёт мимо
  -- всей механики печатей и просто «убьёт» борт на 900 тысяч корпуса, закрыв
  -- бой. Поэтому ветка стоит и здесь, и там.
  --
  -- ЧТО ПЕРЕДАЁМ: урон ДО стойкостей ковчега (total_dmg уже вычтен на 0.9 его
  -- каталожной брони, resisted — как раз вычтенное). Свою стойкость «открытого»
  -- ковчега считает _angel_bt_take, иначе 0.9 применилась бы дважды.
  if t.cls = 'angel' and public._angel_is(t.fid) then
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units
       set fired = true, flash = true, tp = greatest(0, tp - fcost)
     where id = p_unit;
    update public.battle_units
       set hp = max_hp, alive = true, deb = '{}'::jsonb, blind = 0
     where id = p_target;
    if public._angel_guard_left() > 0 then
      -- Стража цела: попадание не значит ничего. Про «урона нет» молчим —
      -- это готовая инструкция «флотом не пытайся».
      perform public._bt_log(p_battle, public._angel_glitch(
        format('%s → %s: попадание подтверждено оптикой. Оценка ущерба ', u.unit_name, t.unit_name), 0.22)
        || public._angel_scream(11));
      return jsonb_build_object('ok', true, 'shield_absorbed', 0, 'hull', 0,
                                'resisted', 0, 'killed', false, 'healed', 0,
                                'angel', true, 'tp', round(u.tp - fcost, 1));
    end if;
    perform public._angel_bt_take(t.fid, total_dmg + resisted, 'kinetic');
    perform public._bt_log(p_battle, public._angel_glitch(
      format('%s → %s: попадание. Что-то в нём подалось', u.unit_name, t.unit_name), 0.28)
      || ' ' || public._angel_scream(10));
    perform public._bt_check_end(p_battle);
    return jsonb_build_object('ok', true, 'shield_absorbed', 0, 'hull', 0,
                              'resisted', 0, 'killed', false, 'healed', 0,
                              'angel', true, 'open', true, 'tp', round(u.tp - fcost, 1));
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  absorbed := shabs;
  hull := greatest(total_dmg * 0.10, hull_leak - t.armor);
  if total_dmg <= 0 then hull := 0; end if;
  update public.battle_units
     set shield = rsh,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  -- «Путь мученика»: половина урона уходит на пастыря в 4 гексах
  if public._bt_perk_martyr(p_target, hull) then
    select bu.alive into killed from public.battle_units bu where bu.id = p_target;
    killed := not killed;
  end if;
  update public.battle_units
     set fired = true, flash = true, tp = greatest(0, tp - fcost),
         pk = coalesce(pk,'{}'::jsonb) - 'ride'     -- разгон «Бимрайдера» сгорел
   where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when u.stance = 'siege' then ' (осадный режим)'
         when boost > 1 then ' (форсаж орудий)' else '' end,
    case when ride > 0 then format(' (разгон +%s%%)', ride * 5) else '' end,
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  -- ── ПЕРКИ ЦЕЛИ И СТРЕЛЯВШЕГО ─────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;
    else perform public._bt_grave_add(p_battle, t.x, t.y); end if;
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absorbed);
    perform public._bt_perk_side(p_target, absorbed + hull, p_unit);
    perform public._bt_perk_despair(p_target);
  else
    perform public._bt_perk_kill(p_unit, 'wpn');            -- «Жажда крови»
  end if;

  if coalesce(u.sammo, false) then
    perform public._bt_deb_add(p_target, 'stasis', 1);
    perform public._bt_log(p_battle, format('%s сажает %s в стазис-поле: следующий ход вдвое дороже',
      u.unit_name, t.unit_name));
  end if;
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$function$;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 17: СТРАЖУ НЕ СДУВАЕТ СНАРЯДОМ ПО ШТУКЕ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: за шагом 16, тем же файлом. Надмножество `_doom_resolve`,
-- `_fleet_kill_ships` и `_fleet_flak`. ⚠️ Правки вести ОТСЮДА.
--
-- ЧТО НАШЛОСЬ. «Сполох» по флоту резолвится НЕ через `_fleet_kill_ships`, а
-- правит состав прямо в `_doom_resolve`. Дальше два правила складывались в
-- дыру: доля выжигания 15-35% на трёх бортах даёт округление в ноль, а на этот
-- случай стоит «малый флот — хотя бы один корабль». Итог: один дешёвый
-- баллистический снаряд = минус один Херувим, вся стена — за три пуска, причём
-- реестр `angel_guard` об этом не узнавал вовсе (состав правится мимо него) —
-- то есть борта с карты исчезали, а ковчег оставался неуязвимым НАВСЕГДА.
-- Зенитный расчёт при этом считался по составу: три борта = 0.6 ствола, шанс
-- сбить ~1%. Стража ловила снаряды с гарантией.
--
-- КАК ТЕПЕРЬ. Снаряд Херувима не сдувает, а РАНИТ. Четыре раны — и он гаснет:
-- «Длань» кладёт две раны за снаряд, баллистика — одну. Значит на всю стражу
-- нужно шесть снарядов Длани или двенадцать баллистических — против тридцати
-- восьми, которых стоят печати самого ковчега. Стратегическим оружием стену
-- снять МОЖНО (иначе держава без флота осталась бы вовсе без хода), но это
-- отдельная кампания, а не три нажатия.
--
-- ЗЕНИТКИ. У стражи свой пол расчёта: 30 стволов, то есть ~39% на перехват.
-- Не «неуязвимы», а «дорого»: в среднем каждый третий снаряд сгорает зря.
-- Считать им зенитки по составу нельзя — у этих бортов нет ни схемы палубы,
-- ни лёгких скорострелок, они вообще не строились на верфи.
-- ════════════════════════════════════════════════════════════

alter table public.angel_guard add column if not exists wounds int not null default 0;

create or replace function public._angel_guard_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'n'          then 3          -- сколько дредноутов в страже
    when 'hp'         then 2500000    -- ~10 залпов нынешнего линкора на борт
    when 'armor'      then 25000
    when 'dmg'        then 60000      -- треть ковчега; убивает любой корпус
    when 'rng'        then 24
    when 'speed'      then 6
    when 'resist'     then 0.55
    -- стратегическое оружие: раны, а не «корабль за снаряд»
    when 'wounds'      then 4         -- ран на одного Херувима
    when 'wound_doom'  then 2         -- ран за снаряд «Длани»
    when 'wound_ball'  then 1         -- ран за баллистику
    when 'flak_floor'  then 30        -- пол зенитного расчёта (≈39% перехвата)
    -- перевод урона по ковчегу в печати (работает ТОЛЬКО когда стражи нет)
    when 'open_resist' then 0.5       -- вместо каталожных 0.9: стена пала
    when 'open_armor'  then 20000
    when 'seal_hp'     then 130000    -- корпуса на одну печать
    when 'press_hit'   then 0.05      -- давление за попадание с доски
    else 0 end
$$;

-- ── РАНА СТРАЖА ─────────────────────────────────────────────
-- Бьём того, кто УЖЕ горит: добить подранка осмысленнее, чем ровно размазать
-- урон по троим, — и читается это правильно, «его добивают».
create or replace function public._angel_guard_hurt(p_fleet uuid, p_w int, p_src text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g record; cap int; w int; dead boolean := false; comp jsonb; shooter text;
begin
  cap := greatest(1, public._angel_guard_const('wounds')::int);
  select * into g from public.angel_guard
   where fleet_id = p_fleet and dead_at is null
   order by (wounds > 0) desc, wounds desc, ord limit 1;
  if g.unit_id is null then return jsonb_build_object('ok', true, 'why', 'стражи нет'); end if;

  w := g.wounds + greatest(1, coalesce(p_w, 1));
  begin shooter := public._fac_name(p_src); exception when others then shooter := null; end;

  if w >= cap then
    update public.angel_guard set wounds = cap, dead_at = now() where unit_id = g.unit_id;
    dead := true;
    -- Снимаем борт из состава флота: он и правда перестал существовать.
    select composition into comp from public.fleets where id = p_fleet for update;
    comp := coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) c
                       where (c->>'unit_id')::uuid is distinct from g.unit_id), '[]'::jsonb);
    update public.fleets set composition = comp where id = p_fleet;
    perform public._angel_news(
      public._angel_glitch('◈ ОДНА ИЗ ТРЁХ ОТМЕТОК ПОГАСЛА', 0.24),
      public._angel_glitch(
        'Подлёт зафиксирован, перехвата не было. ' || coalesce(g.name, 'Отметка')
        || ' держалась ещё сорок секунд и перестала', 0.18)
      || ' ' || public._angel_scream(11));
  else
    update public.angel_guard set wounds = w where unit_id = g.unit_id;
    perform public._angel_news(
      public._angel_glitch('◈ ПОПАДАНИЕ У ПОРОГА', 0.26),
      public._angel_glitch(
        'Вспышка легла точно. Отметка ушла с курса, вернулась на курс и '
        || 'продолжает держать строй', 0.2)
      || ' ' || public._angel_scream(9));
  end if;

  if public._angel_guard_left() <= 0 then
    perform public._angel_news(public._angel_glitch('◈ У ПОРОГА ПУСТО', 0.26),
      public._angel_glitch(
        'Отметки сопровождения погасли одна за другой. Отметка в центре '
        || 'держит курс и не меняет ни скорости, ни высоты', 0.18)
      || ' ' || public._angel_scream(12));
  end if;

  return jsonb_build_object('ok', true, 'dead', dead, 'wounds', least(w, cap),
                            'cap', cap, 'left', public._angel_guard_left(),
                            'by', shooter);
end$$;
revoke all on function public._angel_guard_hurt(uuid,int,text) from public;

-- ── ЗЕНИТКИ СТРАЖИ ──────────────────────────────────────────
-- Надмножество _shell_fleet_hunter.sql: та же формула, плюс пол для стражи.
create or replace function public._fleet_flak(p_fleet uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select greatest(
    coalesce((
      select sum(greatest(0,(c->>'qty')::int) * (0.2 + public._unit_flak((c->>'unit_id')::uuid)))
        from public.fleets f, lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
       where f.id = p_fleet and (c->>'unit_id') ~ '^[0-9a-fA-F-]{36}$'), 0),
    -- ◈ У стражи нет ни схемы палубы, ни лёгких скорострелок: она не строилась
    -- на верфи. Считать ей стволы по составу — значит выдать 0.6 ствола на трёх
    -- бортах и ~1% перехвата, то есть «ловят снаряды с гарантией».
    case when exists (select 1 from public.angel_guard g
                       where g.fleet_id = p_fleet and g.dead_at is null)
         then public._angel_guard_const('flak_floor') else 0 end)
$$;

-- ── МИНЫ, ЛОВУШКИ И ПРОЧЕЕ СНЯТИЕ КОРАБЛЕЙ ──────────────────
-- Надмножество шага 15: страже здесь тоже не «минус борт за срабатывание», а
-- рана. Иначе минное поле у порога стоило бы дешевле трёх дредноутов.
create or replace function public._fleet_kill_ships(p_fleet uuid, p_kill int)
returns int language plpgsql security definer set search_path=public as $$
declare fl public.fleets; elem jsonb; comp jsonb := '[]'::jsonb;
        total int := 0; kill int; left_k int; q int; cut int; killed int := 0;
begin
  select * into fl from public.fleets where id = p_fleet for update;
  if not found then return 0; end if;
  -- ◈ ПРЕСТОЛ: сам ковчег по кораблям не считают. Урон по нему — только печати.
  if exists (select 1 from public.angel_state a where a.fleet_id = p_fleet) then return 0; end if;
  -- ◈ СТРАЖА: рана, а не смерть. Смерть считает _angel_guard_hurt.
  if exists (select 1 from public.angel_guard g where g.fleet_id = p_fleet and g.dead_at is null) then
    if coalesce(p_kill, 0) > 0 then
      perform public._angel_guard_hurt(p_fleet, 1, null);
    end if;
    return 0;
  end if;

  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into total
    from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c;
  if total <= 0 then return 0; end if;
  kill := least(total, greatest(0, p_kill));
  if kill <= 0 then return 0; end if;
  left_k := kill;
  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    q := greatest(0, coalesce((elem->>'qty')::int, 0));
    cut := least(q, ceil(kill * q::numeric / total)::int, left_k);
    left_k := left_k - cut; killed := killed + cut;
    if q - cut > 0 then
      comp := comp || jsonb_set(elem, '{qty}', to_jsonb(q - cut));
    end if;
  end loop;
  if killed < kill and jsonb_array_length(comp) > 0 then
    q := greatest(0, coalesce((comp->0->>'qty')::int, 0));
    cut := least(q, kill - killed); killed := killed + cut;
    if q - cut > 0 then comp := jsonb_set(comp, '{0,qty}', to_jsonb(q - cut));
    else comp := comp - 0; end if;
  end if;
  if jsonb_array_length(comp) = 0 then
    delete from public.fleets where id = p_fleet;
  else
    update public.fleets set composition = comp where id = p_fleet;
  end if;
  return killed;
end$$;

-- ── СВОДКА: РАНЫ НАРУЖУ НЕ ОТДАЁМ ───────────────────────────
-- `guards` в angel_status — это число живых отметок, его и так видно на карте.
-- Раны — нет: по ним считался бы точный остаток снарядов до слома стены.

-- ── 17.1 РЕЗОЛВ СНАРЯДОВ: НАДМНОЖЕСТВО _doom_resolve ───────
CREATE OR REPLACE FUNCTION public._doom_resolve(p_fid text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- ⚠️ НАДМНОЖЕСТВО ЖИВОГО _doom_resolve (см. _angel_guard.sql, шаг 17).
-- Вставка одна — ветка стражи перед вспышкой по составу. Остальное слово в слово.
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_icept text; bp jsonb; pop0 numeric; frac numeric; dead_pop numeric; dice int; killed int; bnames text;
  bpf jsonb; fl public.fleets; cur_sys text; flak numeric; fp numeric; nships int; dead_ships int;
  newcomp jsonb; c jsonb; take int; left_ships int;
  ang_fid text; hit jsonb; shooter text;
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
    -- ══ ◈ ПРЕСТОЛ: ПЕЧАТЬ ══════════════════════════════════════════════
    -- Ковчег ловим по флоту-цели: и Длань (doom_fire_angel), и Гиперпейсер
    -- (mza_fire_fleet) наводятся на сигнатуру, так что цель у обоих одна.
    ang_fid := null;
    if s.target_fleet_id is not null then
      select a.faction_id into ang_fid from public.angel_state a
        where a.fleet_id = s.target_fleet_id and a.fell_at is null;
    end if;
    if ang_fid is not null then
      shooter := public._fac_name(p_fid);
      hit := public._angel_take_salvo(ang_fid,
               case when coalesce(s.kind,'doom') = 'doom' then 'doom' else 'ball' end, p_fid);

      if coalesce((hit->>'parried')::boolean, false) then
        update public.doom_salvos
           set status='intercepted', resolved_at=now(), duel_result='parry',
               victim_fid = ang_fid
         where id = s.id;
        -- ⚠️ Ни слова про «печати целы» и почему промах: стрелявший должен
        -- увидеть, что снаряд пропал, и не понять причины.
        perform public._doom_news(public._angel_glitch('◈ ЦЕЛЬ НЕ ПОРАЖЕНА', 0.24),
          public._angel_glitch(
            'Снаряд ('||coalesce(shooter,'???')||') шёл точно и пришёл точно — в то место, где цели уже не было.', 0.20)
          ||' '||public._angel_scream(12)||' '||
          public._angel_glitch('Расход боекомплекта — полный.', 0.12));
      else
        update public.doom_salvos
           set status='done', resolved_at=now(), duel_result='seal',
               victim_fid = ang_fid
         where id = s.id;
        if coalesce((hit->>'fell')::boolean, false) then
          -- сводку о падении уже дал _angel_fall — здесь молчим, чтобы в ленте
          -- не стояло двух строк об одном событии (см. news-terse)
          null;
        else
          -- ⚠️ ШКАЛУ СНЯЛИ. Здесь стояло «печати: рвутся / на исходе» — то есть
          -- ровно та подсказка, ради которой всю затею и стоило прятать: по ней
          -- считалось, сколько залпов осталось. Теперь попадание видно, а
          -- ПОСЛЕДСТВИЙ не видно. Понять, работает ли кампания, можно только
          -- продолжая её.
          perform public._doom_news(
            public._angel_glitch('◈ ПОПАДАНИЕ ЗАФИКСИРОВАНО', 0.26),
            public._angel_glitch(
              'Залп ('||coalesce(shooter,'???')||') дошёл до отметки. Вспышка держалась дольше расчётной.', 0.20)
            ||' '||public._angel_scream(10)||' '||
            public._angel_glitch('Оно не издало ни звука. Оценка состояния цели', 0.24)
            ||' '||public._angel_scream(15));
        end if;
      end if;
      continue;
    end if;

    -- 🔥 Х77 «СПОЛОХ»: цель — не координата, а тепловая сигнатура флота.
    -- Уйти нельзя: берём флот там, где он сейчас. Отвечает только он сам —
    -- зенитным огнём, либо Ожерелье Немезиды над системой, где его застали.
    bpf := public._ball_params(coalesce(s.kind,'doom'));
    if s.target_fleet_id is not null then
      select * into fl from public.fleets where id = s.target_fleet_id;
      select coalesce(sum(greatest(0,(x->>'qty')::int)),0) into nships
        from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) x;
      if not found or coalesce(nships,0) <= 0 then
        perform public._doom_news('🔥 «СПОЛОХ» ПОТЕРЯЛ ЦЕЛЬ',
          'Снаряд Х77 пришёл на сигнатуру флота «'||coalesce(s.target_planet,'???')||
          '», но жечь было уже нечего: флота не существует. Вспышка ушла в пустоту.');
        update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
        continue;
      end if;
      cur_sys := fl.system_id;
      if cur_sys is not null and exists(
           select 1 from public.colony_buildings cb
             join public.colonies c2 on c2.id = cb.colony_id
            where cb.btype='nemesis' and c2.system_id = cur_sys) then
        update public.doom_salvos set status='intercepted', resolved_at=now(), duel_result='nemesis' where id = s.id;
        perform public._doom_news('⛨ «СПОЛОХ» СНЯТ ОЖЕРЕЛЬЕМ',
          'Флот «'||coalesce(fl.name,'???')||'» встретил подлёт под Ожерельем Немезиды. '||
          'Кольцо перехватчиков сняло Х77 на подходе — на мостиках даже не сыграли тревогу.');
        continue;
      end if;
      flak := public._fleet_flak(fl.id);
      fp   := public._fleet_flak_p(flak);
      update public.doom_salvos set flak_p = fp, victim_fid = fl.faction_id where id = s.id;
      if random() < fp then
        update public.doom_salvos set status='intercepted', resolved_at=now(), duel_result='flak' where id = s.id;
        perform public._doom_news('⛨ ЗЕНИТНЫЙ ОГОНЬ: «СПОЛОХ» СБИТ',
          'Флот «'||coalesce(fl.name,'???')||'» встретил Х77 плотным зенитным огнём: '||
          to_char(flak,'FM999990')||' расчётных стволов, шанс перехвата '||
          to_char(round(fp*100),'FM990')||'%. Боеголовка сгорела в стороне.');
        continue;
      end if;
      -- ── ◈ СТРАЖА ПРЕСТОЛА ─────────────────────────────────────
      -- Обычному флоту «Сполох» выжигает долю состава, а у малого флота
      -- округление подменяется правилом «хотя бы один». Для стражи это значило
      -- бы: три дешёвых баллистических снаряда — и стены нет, причём реестр
      -- об этом даже не узнал бы (состав правится здесь напрямую, мимо
      -- `_fleet_kill_ships`), так что ковчег остался бы неуязвимым навсегда.
      -- Поэтому у стражи свой счёт: снаряд не сдувает Херувима, а РАНИТ его.
      if exists (select 1 from public.angel_guard g where g.fleet_id = fl.id) then
        hit := public._angel_guard_hurt(fl.id,
                 case when coalesce(s.kind,'doom') = 'doom' then 2 else 1 end, p_fid);
        update public.doom_salvos
           set status = 'done', resolved_at = now(), duel_result = 'guard',
               victim_fid = fl.faction_id
         where id = s.id;
        continue;
      end if;

      -- 💥 Вспышка: часть кораблей просто перестаёт быть.
      frac := (bpf->>'kmin')::numeric + random() * (((bpf->>'kmax')::numeric) - ((bpf->>'kmin')::numeric));
      newcomp := '[]'::jsonb; dead_ships := 0;
      for c in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
        take := round(greatest(0,(c->>'qty')::int) * frac);
        dead_ships := dead_ships + take;
        newcomp := newcomp || jsonb_build_array(
          c || jsonb_build_object('qty', greatest(0,(c->>'qty')::int) - take));
      end loop;
      if dead_ships = 0 then       -- малый флот: округление съело потери, но вспышка была
        newcomp := '[]'::jsonb; dead_ships := 0;
        for c in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
          take := case when dead_ships = 0 and greatest(0,(c->>'qty')::int) > 0 then 1 else 0 end;
          dead_ships := dead_ships + take;
          newcomp := newcomp || jsonb_build_array(
            c || jsonb_build_object('qty', greatest(0,(c->>'qty')::int) - take));
        end loop;
      end if;
      select coalesce(sum(greatest(0,(x->>'qty')::int)),0) into left_ships
        from jsonb_array_elements(newcomp) x;
      if left_ships <= 0 then
        delete from public.fleets where id = fl.id;
      else
        update public.fleets set composition = (
          select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(newcomp) x
           where greatest(0,(x->>'qty')::int) > 0) where id = fl.id;
      end if;
      perform public._doom_news(
        '🔥 ВСПЫШКА В ПУСТОТЕ: ФЛОТ ПОД УДАРОМ Х77',
        'Зенитный огонь флота «'||coalesce(fl.name,'???')||'» ('||to_char(round(fp*100),'FM990')||
        '%) не достал боеголовку. «Сполох» подорвался в ордере: потеряно '||dead_ships||
        ' кораблей из '||nships||'. '||
        case when left_ships <= 0 then 'Флота больше нет — на радарах чисто.'
             else 'В строю осталось '||left_ships||'. Уцелевшие идут дальше, но идут не все.' end);
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ⛨ ПЕРЕХВАТ: Ожерелье Немезиды (вся система) → планетарная ПРО
    v_icept := public._doom_intercept(s.target_system_id, s.target_pid, coalesce(s.kind,'doom'));
    if v_icept is not null then
      update public.doom_salvos set status='intercepted', resolved_at=now() where id = s.id;
      perform public._doom_news('⛨ ЗАЛП ПЕРЕХВАЧЕН',
        case when v_icept = 'nemesis'
          then 'Ожерелье Немезиды вспыхнуло над системой: залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит кольцом перехватчиков ещё на подходе. Пока Ожерелье стоит, система неуязвима — сбивать залпы оно будет вечно.'
          else 'Залп по планете «'||coalesce(s.target_planet,'???')||
               '» сбит планетарной ПРО. Планета уцелела — снаряд противоракеты израсходован.' end);
      continue;
    end if;

    bp := public._ball_params(coalesce(s.kind,'doom'));
    if bp is not null then
      -- 💥 БАЛЛИСТИКА: планета живёт; урон по паспорту тира
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        pop0 := coalesce(col.pop, coalesce(col.cells,6)*50);
        frac := (bp->>'pmin')::numeric + random() * ((bp->>'pmax')::numeric - (bp->>'pmin')::numeric);
        dead_pop := round(pop0 * frac);
        update public.colonies set pop = greatest(1, pop0 - dead_pop) where id = col.id;
        -- постройки: равновероятный дайс bmin..bmax (у тяжёлой bmin=bmax=5 — гарантия)
        dice := (bp->>'bmin')::int + floor(random() * ((bp->>'bmax')::int - (bp->>'bmin')::int + 1))::int;
        killed := 0; bnames := null;
        if dice > 0 then
          with victims as (
            select id, btype from public.colony_buildings
              where colony_id = col.id order by random() limit dice
          ), gone as (
            delete from public.colony_buildings cb using victims v where cb.id = v.id returning v.btype
          )
          select string_agg(coalesce(nullif(btype,''),'постройка'), ', '), count(*)
            into bnames, killed from gone;
        end if;
        select name into victim_name from public.faction_applications
          where faction_id = col.faction_id and status='approved' order by updated_at desc limit 1;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР ПО «'||upper(coalesce(s.target_planet,'???'))||'»',
          'Баллистический снаряд достиг планеты «'||coalesce(s.target_planet,'???')||'»'||
          case when victim_name is not null then ' державы «'||victim_name||'»' else '' end||
          '. Погибло ~'||to_char(dead_pop,'FM999999990')||' жителей ('||to_char(round(frac*100),'FM990')||'% населения). '||
          case when coalesce(killed,0) > 0
               then 'Разрушено построек: '||killed||' ('||coalesce(bnames,'')||').'
               else 'Постройки чудом уцелели.' end);
      else
        perform public._doom_news(
          '💥 БАЛЛИСТИЧЕСКИЙ УДАР В ПУСТОТУ',
          'Баллистический снаряд лёг на «'||coalesce(s.target_planet,'???')||'», но смерть не вышла на работу. '||
          'Кратер станет памятником расточительности.');
      end if;
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ☠ СНАРЯД ДЛАНИ: планета → мёртвый камень (как раньше)
    select * into tgt from public.map_systems where id = s.target_system_id;
    if found then
      arr := coalesce(tgt.planets, '[]'::jsonb);
      newpl := '[]'::jsonb;
      for i in 0 .. jsonb_array_length(arr)-1 loop
        el := arr->i;
        if (el->>'pid')::int = s.target_pid then
          el := el
            || jsonb_build_object(
                 'g','lava', 'kind','planet', 'type','Мёртвая планета',
                 'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                 'resources','[]'::jsonb, 'dead', true, 'doomed', true,
                 'doomed_by', p_fid, 'doomed_at', to_jsonb(now()));
        end if;
        newpl := newpl || jsonb_build_array(el);
      end loop;
      update public.map_systems set planets = newpl where id = tgt.id;

      if to_regclass('public.system_minefields') is not null then
        delete from public.system_minefields
          where system_id = s.target_system_id
            and ((s.target_pid is not null and planet_pid = s.target_pid)
                 or (s.target_pid is null and planet_pid is null));
      end if;

      victim_fid := null; victim_name := null;
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        victim_fid := col.faction_id;
        select name into victim_name from public.faction_applications
          where faction_id = victim_fid and status='approved' order by updated_at desc limit 1;
        delete from public.colonies where id = col.id;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
      end if;

      perform public._doom_news(
        '☠ ГИБЕЛЬ МИРА',
        'Планета «'||coalesce(s.target_planet,'???')||'» в системе «'||coalesce(tgt.name,'???')||
        '» перестала существовать. И ты, как все, пойдешь во мрак, где нет ни Бога, ни людей. И будешь ты, как падший злак, в пустыне тлеть, один, как враг самих теней!'||
        case when victim_name is not null then ' Колония державы «'||victim_name||'» стёрта вместе с миром.' else '' end||
        ' Молчите. Здесь больше нечего сказать.');
    end if;

    update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
  end loop;
end$function$;

notify pgrst, 'reload schema';
