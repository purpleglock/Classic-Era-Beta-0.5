-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 2: БОРТ НА ДОСКЕ. ВСТРЕЧА = СМЕРТЬ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_core.sql и после ВСЕХ слоёв, которые переопределяют
-- _bt_hit / _bt_arm / _bt_is_machine (последними были _bt_ram_nuke_aegis.sql,
-- _legion_battle_ai.sql). Дальше: _angel_shells.sql → _angel_ai.sql.
-- Идемпотентно.
--
-- ЗАМЫСЕЛ. На доске ангел — не «очень сильный корабль». Очень сильный корабль
-- всё равно проигрывает арифметике: тридцать корветов забьют что угодно, если
-- у них хватит залпов. Поэтому ангел выведен ИЗ арифметики целиком: урон по
-- нему на доске не считается вовсе. Он не тонет, не горит, не глохнет, у него
-- нет перезарядок. Бой с ним — это не бой, а протокол уничтожения того, кто
-- пришёл. Отсюда и правило игры: с ангелом не сражаются. От него бегут.
--
-- ГДЕ ТОГДА СЛАБОСТЬ. Она есть, но не здесь: печати рвутся только залпами
-- Длани и Гиперпейсера (см. _angel_shells.sql). Флот против ангела бесполезен
-- ПО ЗАМЫСЛУ — иначе «ангел» был бы просто дредноутом с большими числами.
-- Неуязвимость на доске держится ровно до тех пор, пока цела последняя печать:
-- как только они кончились, _angel_fall снимает борт с доски мёртвым.
--
-- ПОЧЕМУ НЕ ЧЕРЕЗ hp = 10^9. Пробовать нечего: таран (_bt_hit с p_pierce),
-- ядерка, «Тартар» и перехват контура считают долю от максимума или пробивают
-- насквозь, и рано или поздно любое конечное число доедается. Ноль урона —
-- единственная честная формулировка «он не замечает удара».
-- ════════════════════════════════════════════════════════════

-- ── 1. АНГЕЛ — МАШИННАЯ СТОРОНА ─────────────────────────────
-- Надмножество _legion_battle_ai.sql: у ангела нет живого штаба, его ход —
-- дело сервера. Заодно это включает ему уже готовый крон legion-ai-tick,
-- который раз в минуту гоняет ходы ВСЕХ машинных сторон.
create or replace function public._bt_is_machine(p_fid text)
returns boolean language sql stable as $$
  select p_fid is not null
     and (p_fid = public._bt_bot_fid()
       or p_fid = public._legion_fid()
       or public._angel_is(p_fid))
$$;

-- ── 2. ВЕДОМОСТЬ БОРТА ──────────────────────────────────────
-- Своя, а не _bt_stats: у «Престола» нет ни одного отсека и ни одной турели,
-- так что каталожный счёт дал бы ему ноль урона и единицу дальности.
--
-- ЧТО ЗНАЧИТ «УМЕЕТ ВСЁ»: три канала урона сразу (кинетика, энергия, ракеты)
-- по шесть выстрелов в группе — максимальный тир темпа. Любая стойкость цели
-- прикрывает от одного канала из трёх, поэтому «набрать резист» против ангела
-- нельзя в принципе.
--   rng 30      — он открывает огонь раньше, чем его видят;
--   speed 12    — от него нельзя оторваться по доске;
--   interdict   — и нельзя уйти в прыжок;
--   sensor 30   — маскировка не работает, «Завеса» его не слепит;
--   tp 60       — за ход успевает всё, что позволит бюджет действий стороны.
create or replace function public._angel_bt_stats()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'name', 'Престол', 'cls', 'angel',
    'hp', 900000, 'armor', 4000, 'shield', 0,
    'dmg', 90000, 'speed', 12, 'rng', 30,
    'sensor', 30, 'stealth', 0, 'pd', 0.6,
    'jam', 8, 'dejam', 12, 'eccm', 12,
    'interdict', true, 'stabil', true, 'ftl', true, 'wings', 0,
    'resist', jsonb_build_object('kinetic', 0.9, 'energy', 0.9, 'missile', 0.9),
    'wpn', jsonb_build_array(
      jsonb_build_object('rng', 30, 'dmg', 42000, 'k', 'energy',  'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1),
      jsonb_build_object('rng', 26, 'dmg', 36000, 'k', 'kinetic', 'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1),
      jsonb_build_object('rng', 30, 'dmg', 30000, 'k', 'missile', 'shots', 6,
                         'opt', 1.0, 'far', 1.0, 'dmin', 1)))
$$;

-- Все действия каталога — с нулевой перезарядкой. Список берём ИЗ _bt_act_cost,
-- а не переписываем руками: добавят в игру новый модуль — ангел получит его
-- в тот же накат, без правки этого файла.
create or replace function public._angel_acts()
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'cd', 0)), '[]'::jsonb)
    from (select jsonb_object_keys(jsonb_build_object(
      'siege',1,'salvo',1,'broadside',1,'blink',1,'cloak',1,'amp',1,'drones',1,
      'torpedo',1,'storm',1,'ram',1,'rupture',1,'drain',1,'wbreak',1,'disrupt',1,
      'wboost',1,'pboost',1,'hell',1,'blind',1,'pdup',1,'stasis',1,'aboost',1,
      'tractor',1,'nuke',1,'tartarus',1,'sammo',1,'hard',1,'reboot',1,'rapid',1,
      'hijack',1,'energy',1)) k) q
$$;

-- ── 3. ВЫХОД НА ДОСКУ ───────────────────────────────────────
-- Ровно один борт: ковчег один, «сколько кораблей в составе» тут не при чём.
create or replace function public.angel_battle_deploy(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; sd text; fc int; xy int[]; st jsonb; tpm numeric;
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

  if exists (select 1 from public.battle_units u
              where u.battle_id = p_battle and u.fid = af) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  perform public._bt_ensure_field(p_battle);
  fc  := public._bt_spawn_facing(b.spawn, sd);
  xy  := public._bt_bot_slot_side(p_battle, 'brawler', sd);
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

  -- Ангел готов сразу: совещаться ему не с кем.
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

-- ── 4. УРОН ПО АНГЕЛУ: НЕ СЧИТАЕТСЯ ─────────────────────────
-- Надмножество _bt_ram_nuke_aegis.sql. Единственная вставка — ранний выход по
-- цели-ангелу; вся остальная математика урона не тронута ни строкой.
-- ⚠️ Правки урона в бою вести ОТСЮДА: этот файл теперь последний в цепочке.
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text,
                                         p_terr jsonb, p_pierce boolean default false,
                                         p_src uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
        gid uuid; redirected boolean := false; nseen int;
begin
  -- ◈ ПРЕСТОЛ. Урон по ангелу не проходит вовсе: ни через щит, ни через броню,
  -- ни тараном в упор. Записываем в pk счётчик «отражено» — по нему доска
  -- рисует вспышку нимба, а игрок видит, что попадание БЫЛО и не значило ничего.
  -- Проверяем ДО «Эгиды» и до блокировки строки: если по ангелу нельзя попасть,
  -- то и переадресовывать удар гвардейцу незачем.
  if exists(select 1 from public.battle_units z
             where z.id = p_target and public._angel_is(z.fid)) then
    select * into t from public.battle_units where id = p_target;
    nseen := coalesce((t.pk->>'ang')::int, 0) + 1;
    update public.battle_units
       set hp = max_hp, alive = true, deb = '{}'::jsonb, blind = 0,
           pk = coalesce(pk, '{}'::jsonb) || jsonb_build_object('ang', nseen)
     where id = p_target;
    -- Раз в пять попаданий пишем строку в журнал: каждое сообщение — это спам,
    -- а полное молчание читается как «доска сломалась».
    -- ⚠️ НЕ ПИШЕМ «урона нет»: это готовая инструкция «флотом не пытайся».
    -- Пишем сбой телеметрии — пусть штаб сам сообразит, что происходит.
    if nseen % 5 = 1 then
      perform public._bt_log(t.battle_id, public._angel_glitch(
        '◈ Попадание подтверждено оптикой. Оценка ущерба ', 0.22)
        || public._angel_scream(13));
    end if;
    return jsonb_build_object('hull', 0, 'shield_absorbed', 0, 'killed', false,
                              'angel', true);
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
  -- «Эгида» / импульс брони
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  -- «Разрывной таран» вспорол обшивку — стойкости работают хуже
  if public._bt_deb_has(t.deb, 'soft') then rk := rk * 0.7; end if;
  if coalesce(p_k,'kinetic') = 'missile' then
    rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
  end if;
  -- ТАРАН: пробойка бьёт в обшивку в упор — стойкости успевают рассеять треть
  if p_pierce then rk := greatest(0, rk) * 0.35; end if;
  gdmg := p_dmg * (1 - rk) * dmgfac;

  if rsh > 0 and gdmg > 0 then
    use_sec := least(rsh, gdmg / greatest(1, t.mitig));
    absb    := use_sec * t.mitig * t.reduc;
    rsh     := rsh - use_sec;
  end if;

  -- плоская броня таран тоже не держит: удар приходится не в плиту, а сквозь неё
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

  -- «Путь мученика»: пастырь рядом забрал половину боли — цель могла ожить
  if public._bt_perk_martyr(p_target, hull) then
    select bu.alive into killed from public.battle_units bu where bu.id = p_target;
    killed := not killed;
  end if;

  -- ── ПЕРКИ ЦЕЛИ ───────────────────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;              -- «Пульс покойника»
    else perform public._bt_grave_add(t.battle_id, t.x, t.y); end if;    -- обломки для «Некрофилии»
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absb);                       -- «Альтаанская стойкость»
    perform public._bt_perk_side(p_target, absb + hull, p_src);          -- «Наклонности»
    perform public._bt_perk_despair(p_target);                           -- «Отчаяние»
  end if;

  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb),
                            'killed', killed, 'guard', redirected);
end$$;

-- ── 5. НУЛЕВЫЕ ПЕРЕЗАРЯДКИ ──────────────────────────────────
-- Надмножество _battle_arena_size.sql: _bt_arm зовут ВСЕ боевые двери, и это
-- единственная точка, куда можно повесить «ангел всегда как новый», не
-- переписывая ход, конец хода и каждое действие по отдельности.
-- Что снимаем каждый раз: перезарядки модулей, дебаффы, ослепление, потраченное
-- время хода. Что НЕ снимаем: флаг acted — иначе ангел ходил бы вечно, а бюджет
-- действий стороны существует именно для того, чтобы ход когда-то кончался.
create or replace function public._bt_arm(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare vw int; vh int;
begin
  select b.bw, b.bh into vw, vh from public.battles b where b.id = p_battle;
  perform set_config('bt.w', coalesce(vw, public._bt_wbig())::text, true);
  perform set_config('bt.h', coalesce(vh, public._bt_hbig())::text, true);

  update public.battle_units u
     set hp = u.max_hp, alive = true,
         tp = u.tp_max, mcd = '{}'::jsonb, deb = '{}'::jsonb,
         blind = 0, jam = 8, moved = false, fired = false
   where u.battle_id = p_battle
     and public._angel_is(u.fid)
     and (u.hp < u.max_hp or u.tp < u.tp_max
          or coalesce(u.mcd,'{}'::jsonb) <> '{}'::jsonb
          or coalesce(u.deb,'{}'::jsonb) <> '{}'::jsonb);
end$$;

-- ── 6. ТИК ДОСКИ ────────────────────────────────────────────
-- Расстановка ангела в завязавшихся боях. Ходы машинных сторон уже гоняет
-- крон legion-ai-tick (он смотрит _bt_is_machine, куда ангел добавлен выше) —
-- второй такой цикл заводить незачем, он бы только дублировал работу.
create or replace function public.angel_battle_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; d int := 0; af text;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  for b in select id from public.battles
            where status = 'forming' and (attacker_fid = af or defender_fid = af)
  loop
    begin
      if (public.angel_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null;   -- один битый бой не должен рушить тик
    end;
  end loop;

  return jsonb_build_object('ok', true, 'deployed', d);
end$$;
revoke all on function public.angel_battle_tick() from public;
