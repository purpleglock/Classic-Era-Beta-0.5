-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 4: ИИ. ХОЗЯЙСТВО, ВОЙНА, ПОХОД
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_core.sql → _angel_battle.sql → _angel_shells.sql.
-- Идемпотентно, катится повторно.
--
-- ЗАМЫСЕЛ. У ангела нет игрока, значит всё, что делает держава, должен делать
-- сервер: считать деньги, строить, чинить печати, выбирать цель, стрелять,
-- отступать. Разложено на два тика с РАЗНЫМ ритмом, и это принципиально:
--
--   • ХОЗЯЙСТВО (раз в час). Стройка идёт сутки, десятина капает часами —
--     чаще незачем, а лишний проход по 20 ячейкам это лишний диск.
--   • ВОЙНА (раз в 5 минут). Здесь решения быстрые: подлетает залп — уходить
--     или терпеть; сел флот врага рядом — брать или пропускать.
--
-- ЦЕЛЬ ИИ, по порядку важности:
--   1) НЕ СДОХНУТЬ. Печати ниже 28% — разворот в гнездо и лежать, пока не
--      зарастёт до 72%. Никакая добыча не стоит последней печати.
--   2) НЕ ОСТАНОВИТЬСЯ. Кризис, который стоит на месте, перестаёт быть
--      кризисом и становится достопримечательностью. Ангел всегда идёт.
--   3) ЖРАТЬ ВРАГОВ. Сначала те, с кем война; потом просто те, кто рядом и жирнее.
--
-- ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Это не «бот-держава»: ангел не колонизирует, не торгует,
-- не воспитывает население и не собирает флот. Он ест системы и жжёт планеты.
-- Поэтому и хозяйство у него короткое — двадцать ячеек арсенала, а не империя.
-- ════════════════════════════════════════════════════════════

-- ── 0. ПАМЯТЬ ПОХОДА ────────────────────────────────────────
-- Куда уже заходили. Без этого ангел ходит челноком между двумя системами:
-- ближайшая цель после ухода снова оказывается ближайшей.
alter table public.angel_state add column if not exists path_log jsonb not null default '[]'::jsonb;
alter table public.angel_state add column if not exists last_econ timestamptz;
alter table public.angel_state add column if not exists last_forge timestamptz;

-- ── 1. ЧЕГО ОНО НЕ ИЗОБРЕТАЛО ───────────────────────────────
-- Технологии судного дня выдаём ангелу сразу и навсегда. Причина не в лени:
-- древо исследований — это машина ПРОГРЕССА державы, у которой есть институты,
-- поколения учёных и очередь приоритетов. У ангела нет ни того, ни другого;
-- он старше галактики и уже всё умеет. Ожерелье в списке стоит только как
-- пререквизит Гиперпейсера — САМУ постройку ему запрещает триггер из шага 1.
create or replace function public._angel_seed_tech()
returns void language plpgsql security definer set search_path=public as $$
declare af text;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  update public.faction_economy
     set research = (
       select jsonb_agg(distinct v) from (
         select jsonb_array_elements(coalesce(research, '[]'::jsonb)) v
         union select to_jsonb(t) from unnest(array[
           'pol.inevitability', 'pol.ballistics', 'pol.nemesis', 'pol.hyperpacer'
         ]) t) q)
   where faction_id = af;
end$$;
revoke all on function public._angel_seed_tech() from public;

-- ── 2. ДЕСЯТИНА: ХОЗЯЙСТВО, КОТОРОЕ НЕ КОПАЕТ ───────────────
-- У ковчега нет залежей: planet_pid = null, resources = []. Добывающий завод
-- на нём простаивал бы вечно, а без Программируемой материи и Гравиядра ангел
-- не собрал бы ни одного снаряда — то есть был бы кризисом без зубов.
--
-- Поэтому его экономика — не добыча, а ДЕСЯТИНА: он берёт с системы, над
-- которой висит. Тем больше, чем система богаче и чем больше в ней чужих
-- колоний. Забирает не из кошелька игрока (это было бы воровство, которое
-- невозможно ни увидеть, ни отбить), а из ДОСТАТКА системы: prosperity падает,
-- жители беднеют, и это видно в панели системы у всех.
--
-- Отсюда естественная петля: чтобы стрелять, ангел должен идти к жирным
-- системам; чем дольше он висит над твоей — тем беднее ты становишься; и
-- прогнать его нельзя ничем, кроме печатей.
create or replace function public._angel_tithe()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; sys text; ncol int; prosp numeric; gc_take numeric;
        hrs numeric; sysname text; matter numeric; grav numeric; res jsonb;
        victims text[];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id;
  sys := f.system_id;                       -- в прыжке десятину не берут
  if sys is null then return jsonb_build_object('ok', true, 'idle', true); end if;

  hrs := greatest(0, least(6, extract(epoch from (now() - coalesce(a.last_econ, now() - interval '1 hour'))) / 3600.0));
  if hrs < 0.5 then return jsonb_build_object('ok', true, 'early', true); end if;

  select count(*) into ncol from public.colonies c
   where c.system_id = sys and c.faction_id is distinct from a.faction_id;
  select coalesce(prosperity, 100) into prosp from public.system_econ where system_id = sys;
  prosp := coalesce(prosp, 100);

  -- Тариф: 900 ГС/час за саму стоянку + 2600 за каждую чужую колонию, всё это
  -- масштабируется достатком системы. Нищая система почти ничего не даёт —
  -- ангелу приходится идти дальше, а не сидеть на одном месте вечно.
  gc_take := (900 + 2600 * ncol) * hrs * (0.4 + prosp / 100.0 * 0.9);

  -- Снаряды не покупаются: два ключевых военных ресурса ангел вытягивает из
  -- вещества самой системы. Ровно поэтому его арсенал работает без шахт.
  matter := 0.35 * hrs * (1 + ncol * 0.5);
  grav   := 0.55 * hrs * (1 + ncol * 0.5);

  update public.faction_economy
     set gc = gc + gc_take,
         resources = coalesce(resources, '{}'::jsonb)
           || jsonb_build_object(
                'Программируемая материя',
                round(coalesce((resources->>'Программируемая материя')::numeric, 0) + matter, 2),
                'Гравиядро',
                round(coalesce((resources->>'Гравиядро')::numeric, 0) + grav, 2))
   where faction_id = a.faction_id;

  -- достаток системы падает: ангел висит над головой, и это ощущается
  if ncol > 0 then
    update public.system_econ
       set prosperity = greatest(5, prosperity - 2.5 * hrs), updated_at = now()
     where system_id = sys;
  end if;

  update public.angel_state set last_econ = now() where faction_id = a.faction_id;

  -- Раз в проход говорим жертвам, что происходит: молчаливое обеднение
  -- читается как баг, а не как осада.
  if ncol > 0 then
    select array_agg(distinct c.faction_id) into victims from public.colonies c
     where c.system_id = sys and c.faction_id is distinct from a.faction_id
       and c.faction_id is not null;
    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = sys;
    if victims is not null then
      -- ⚠️ ЗДЕСЬ СТОЯЛА ПРЯМАЯ ИНСТРУКЦИЯ: «флот его не тронет — только Длань
      -- и Гиперпейсер». Одна строка отменяла весь кризис: игроку не надо было
      -- ничего понимать, ему выдали ответ. Снято. Осталось то, что человек
      -- действительно может заметить, — что жить стало хуже.
      perform public._angel_tell(v, public._angel_glitch('◈ Над системой', 0.20),
        public._angel_glitch(
          'Над «' || coalesce(sysname,'???') || '» стоит отметка. Она ничего не требует и ни с чем не выходит на связь.', 0.18) ||
        ' ' || public._angel_scream(9) || ' ' ||
        public._angel_glitch(
          'Заводы работают вполсилы. Склады пустеют. Люди не выходят на смену. ' ||
          'Наблюдение с орбиты сворачивается: расчёты отказываются смотреть вверх.', 0.16) ||
        ' ' || public._angel_scream(13))
        from unnest(victims) v;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'sys', sys, 'colonies', ncol,
                            'gc', round(gc_take), 'hours', round(hrs, 2));
end$$;
revoke all on function public._angel_tithe() from public;

-- ── 3. АРСЕНАЛ: СНАРЯДЫ ─────────────────────────────────────
-- Своя дорога вместо shell_order: у ангела нет ни очереди заказов, ни игрока,
-- который её нажимает. Условия те же по СУТИ (нужна фабрика, нужны ресурсы,
-- один снаряд не быстрее суток на фабрику), только считаются в тике.
create or replace function public._angel_forge()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; nforge int; nfab int; made int := 0;
        matter numeric; grav numeric; res jsonb; kind text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  hrs := greatest(0, least(72, extract(epoch from (now() - coalesce(a.last_forge, now() - interval '1 hour'))) / 3600.0));
  if hrs < public._shell_const('shell_h') then
    return jsonb_build_object('ok', true, 'early', true, 'hours', round(hrs,1));
  end if;

  select count(*) into nforge from public.colony_buildings
   where colony_id = a.colony_id and btype = 'shellforge';
  select count(*) into nfab from public.colony_buildings
   where colony_id = a.colony_id and btype = 'ballfab';
  if nforge + nfab = 0 then return jsonb_build_object('ok', true, 'why', 'арсенала нет'); end if;

  select coalesce(resources, '{}'::jsonb) into res from public.faction_economy
   where faction_id = a.faction_id;
  matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  grav   := coalesce((res->>'Гравиядро')::numeric, 0);

  -- Снаряд Длани дороже и важнее: сначала он, баллистика из остатка.
  -- Больше одного снаряда за проход не делаем даже при избытке фабрик —
  -- иначе сутки простоя превращались бы в залповый вал.
  if nforge > 0 and matter >= 8 and grav >= 20 then
    kind := 'doom';
    matter := matter - 8; grav := grav - 20;
    perform public._shell_add(a.faction_id, 'doom', 1);
    made := 1;
  elsif nfab > 0 and grav >= 3 then
    kind := 'ball_hunter';        -- «Сполох»: он охотится на флоты, а не на камни
    grav := grav - 3;
    perform public._shell_add(a.faction_id, 'ball_hunter', 1);
    made := 1;
  end if;

  if made > 0 then
    update public.faction_economy
       set resources = coalesce(resources, '{}'::jsonb)
         || jsonb_build_object('Программируемая материя', round(matter, 2),
                               'Гравиядро', round(grav, 2))
     where faction_id = a.faction_id;
    update public.angel_state set last_forge = now() where faction_id = a.faction_id;
  end if;

  return jsonb_build_object('ok', true, 'made', made, 'kind', kind);
end$$;
revoke all on function public._angel_forge() from public;

-- ── 4. ЧТО СТРОИТЬ НА ДВАДЦАТИ ЯЧЕЙКАХ ──────────────────────
-- Лестница приоритетов, а не «случайная постройка по деньгам»: у ангела всего
-- 20 ячеек, и порядок решает всё.
--   1) factory ×5   — без денег не работает ничего;
--   2) science ×2   — ОН нужны не ему, а его же будущим постройкам через тик;
--   3) warehouse ×2 — снарядам и материи надо где-то лежать;
--   4) shellforge   — снаряды Длани;
--   5) ballfab ×2   — «Сполох» на чужие флоты;
--   6) doomgun ×2   — сама Длань: два ствола, чтобы залп не ждал перезарядки;
--   7) flak         — авиацию с планет он не любит;
--   8) factory      — остаток ячеек в деньги.
-- ⚠️ nemesis в лестнице НЕТ и быть не может: см. запрет в _angel_core.sql.
create or replace function public._angel_ladder()
returns jsonb language sql immutable as $$
  select jsonb_build_array(
    jsonb_build_object('b','factory',    'n',5),
    jsonb_build_object('b','science',    'n',2),
    jsonb_build_object('b','warehouse',  'n',2),
    jsonb_build_object('b','shellforge', 'n',1),
    jsonb_build_object('b','ballfab',    'n',2),
    jsonb_build_object('b','doomgun',    'n',2),
    jsonb_build_object('b','flak',       'n',1),
    jsonb_build_object('b','factory',    'n',10))
$$;

-- Цена постройки для ангела. Для обычных ячеек — каталожная (_ec_bld_base),
-- для арсенала и Длани — их собственные тарифы: они не проходят через
-- economy_build и в каталоге ячеек стоят нулями.
create or replace function public._angel_bld_gc(p_btype text)
returns numeric language sql stable as $$
  select case p_btype
    when 'doomgun'    then public._doom_const('build_gc')
    when 'shellforge' then public._shell_const('forge_gc')
    when 'ballfab'    then public._shell_const('ballfab_gc')
    else coalesce(public._ec_bld_base(p_btype), 0) end
$$;

-- Стройка: одна ячейка за проход. Медленно — намеренно: двадцать ячеек за
-- двадцать часов, а не арсенал из воздуха за один тик.
create or replace function public._angel_build()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; step jsonb; want text; cnt int; used int; pend int; ncells int;
        cost numeric; have_gc numeric; bid uuid; opened int;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;

  select c.cells into ncells from public.colonies c where c.id = a.colony_id;
  ncells := coalesce(ncells, public._angel_const('ark_cells')::int);
  select count(*) into used from public.colony_buildings where colony_id = a.colony_id;
  select count(*) into pend from public.colony_projects
   where colony_id = a.colony_id and kind = 'build';
  select e.gc into have_gc from public.faction_economy e where e.faction_id = a.faction_id;

  -- 4.1 СНАЧАЛА ОТКРЫТЬ СЛОТЫ. Слот дешевле новой постройки и даёт прибавку
  -- сразу; строить шестую фабрику, когда у первой открыт один слот из шести, —
  -- это выкидывать деньги.
  select cb.id, cb.slots_open into bid, opened from public.colony_buildings cb
   where cb.colony_id = a.colony_id and coalesce(cb.slots_open,0) < 6
     and not exists(select 1 from public.colony_projects pr
                     where pr.kind = 'slot' and pr.building_id = cb.id)
     and cb.btype in ('factory','science','warehouse','ballfab','shellforge','flak')
   order by coalesce(cb.slots_open,0) asc,
            case cb.btype when 'factory' then 0 when 'science' then 1
                          when 'warehouse' then 2 else 3 end
   limit 1;
  if bid is not null then
    cost := public._ec_build_cost(a.faction_id,
              public._ec_bld_ladder((select btype from public.colony_buildings where id = bid),
                                    coalesce(opened, 0)));
    if coalesce(cost,0) <= 0 then cost := 1; end if;
    if coalesce(have_gc,0) >= cost then
      update public.faction_economy set gc = gc - cost where faction_id = a.faction_id;
      insert into public.colony_projects
        (faction_id, owner_id, kind, colony_id, building_id, payload, label, ready_at)
      values (a.faction_id, (select owner_id from public.faction_economy where faction_id = a.faction_id),
              'slot', a.colony_id, bid,
              jsonb_build_object('spent_gc', cost, 'spent_science', 0), 'Слот',
              now() + interval '1 day');
      return jsonb_build_object('ok', true, 'act', 'slot', 'gc', cost);
    end if;
  end if;

  -- 4.2 ИНАЧЕ — НОВАЯ ЯЧЕЙКА ПО ЛЕСТНИЦЕ
  if used + pend >= ncells then
    return jsonb_build_object('ok', true, 'full', true, 'cells', ncells);
  end if;

  for step in select value from jsonb_array_elements(public._angel_ladder()) loop
    want := step->>'b';
    select count(*) into cnt from (
      select 1 from public.colony_buildings
        where colony_id = a.colony_id and btype = want
      union all
      select 1 from public.colony_projects
        where colony_id = a.colony_id and kind = 'build' and btype = want) q;
    if cnt >= (step->>'n')::int then continue; end if;

    cost := public._ec_build_cost(a.faction_id, public._angel_bld_gc(want));
    if coalesce(have_gc,0) < cost then
      return jsonb_build_object('ok', true, 'saving_for', want, 'need', cost, 'gc', round(coalesce(have_gc,0)));
    end if;
    update public.faction_economy set gc = gc - cost where faction_id = a.faction_id;
    insert into public.colony_projects
      (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
    values (a.faction_id, (select owner_id from public.faction_economy where faction_id = a.faction_id),
            'build', want, a.colony_id,
            jsonb_build_object('spent_gc', cost, 'spent_science', 0, 'btype', want,
                               'free_slots', public._ec_bld_free(want)),
            'Постройка', now() + interval '1 day');
    return jsonb_build_object('ok', true, 'act', 'build', 'btype', want, 'gc', cost);
  end loop;

  return jsonb_build_object('ok', true, 'act', 'nothing');
end$$;
revoke all on function public._angel_build() from public;

-- ── 5. ГИПЕРПЕЙСЕР ──────────────────────────────────────────
-- Носитель баллистики ангел не строит на верфи (верфи у него нет) — он его
-- ОТДЕЛЯЕТ от себя, когда есть баллистический завод и деньги. Носитель всегда
-- висит там же, где ковчег: это не самостоятельный флот, а его орудийная рука.
create or replace function public._angel_pacer()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; have int; have_gc numeric; cost numeric; nid uuid;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id;
  if f.system_id is null then return jsonb_build_object('ok', true, 'moving', true); end if;

  select count(*) into have from public.mza_ships where faction_id = a.faction_id;
  -- Больше двух рук незачем: залп у каждой раз в несколько часов, а износ
  -- корпуса всё равно съедает носитель за четыре выстрела.
  if have >= 2 then
    -- рука ходит следом за телом
    update public.mza_ships set system_id = f.system_id, status = 'idle'
     where faction_id = a.faction_id and coalesce(system_id,'') <> f.system_id;
    return jsonb_build_object('ok', true, 'have', have, 'follow', true);
  end if;
  if not exists(select 1 from public.colony_buildings
                 where colony_id = a.colony_id and btype = 'ballfab') then
    return jsonb_build_object('ok', true, 'why', 'нет баллистического завода');
  end if;

  cost := public._mza_const('build_gc') * 0.5;   -- половина: корпус уже есть, это его часть
  select e.gc into have_gc from public.faction_economy e where e.faction_id = a.faction_id;
  if coalesce(have_gc,0) < cost then
    return jsonb_build_object('ok', true, 'saving_for', 'pacer', 'need', cost);
  end if;
  update public.faction_economy set gc = gc - cost where faction_id = a.faction_id;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id, integrity)
    values (a.faction_id,
            (select owner_id from public.faction_economy where faction_id = a.faction_id),
            case when have = 0 then 'Рука первая' else 'Рука вторая' end,
            'idle', f.system_id, 100)
    returning id into nid;
  return jsonb_build_object('ok', true, 'act', 'pacer', 'id', nid, 'gc', cost);
end$$;
revoke all on function public._angel_pacer() from public;

-- ── 6. КОГО ЖЕЧЬ: ЗАЛП ПО ЧУЖОМУ ФЛОТУ ──────────────────────
-- «Сполох» ведёт сигнатуру: флот от него не уходит. Это главный инструмент
-- ангела против того, что он не может достать на доске, — против тех, кто
-- разумно от него бегает.
create or replace function public._angel_hunter()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; sh record; tgt record; hops int; maxh int; fly numeric; rdy timestamptz;
        lock_sys text; have_q int;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select coalesce(d.qty,0) into have_q from public.doom_shells d
   where d.faction_id = a.faction_id and d.kind = 'ball_hunter';
  if coalesce(have_q,0) < 1 then return jsonb_build_object('ok', true, 'why', 'нет «Сполоха»'); end if;

  select * into sh from public.mza_ships
   where faction_id = a.faction_id and status = 'idle' and system_id is not null
     and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.mza_id = mza_ships.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if sh.id is null then return jsonb_build_object('ok', true, 'why', 'рука занята'); end if;

  maxh := public._shell_const('mza_range_hops')::int;

  -- Цель: САМЫЙ КРУПНЫЙ чужой флот в радиусе захвата. Крупный, а не близкий:
  -- снаряд один, и тратить его на курьера, когда рядом ордер, — расточительство.
  select f.id, f.name, f.faction_id, f.system_id, f.from_sys,
         (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
            from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c) ships
    into tgt
    from public.fleets f
   where f.faction_id is distinct from a.faction_id
     and coalesce(f.system_id, f.from_sys) is not null
     and coalesce(jsonb_array_length(f.composition), 0) > 0
     and public._mza_hops(sh.system_id, coalesce(f.system_id, f.from_sys), maxh) is not null
     and not exists(select 1 from public.doom_salvos s
                     where s.target_fleet_id = f.id and s.status = 'in_flight')
   order by ships desc limit 1;
  if tgt.id is null then return jsonb_build_object('ok', true, 'why', 'целей в радиусе нет'); end if;

  lock_sys := coalesce(tgt.system_id, tgt.from_sys);
  perform public._shell_take(a.faction_id, 'ball_hunter');
  update public.mza_ships
     set integrity = greatest(0, integrity - public._mza_const('shot_wear')),
         total_shots = total_shots + 1
   where id = sh.id;

  fly := coalesce(public._mza_dist_hours(sh.system_id, lock_sys,
                    public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                  public._mza_const('salvo_h_min')) * 0.8;
  rdy := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, target_fleet_id, flak_p, ready_at, kind, victim_fid)
  values
    (sh.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     sh.system_id, lock_sys, null, coalesce(tgt.name,'флот'), tgt.id,
     public._fleet_flak_p(public._fleet_flak(tgt.id)), rdy, 'ball_hunter', tgt.faction_id);

  -- ⚠️ Убрано «ведёт сигнатуру, уходить бесполезно, остаётся зенитный огонь» —
  -- это инструкция по обороне. Пусть узнают, попробовав уйти.
  perform public._angel_tell(tgt.faction_id, public._angel_glitch('◈ Оно посмотрело на ваш флот', 0.22),
    public._angel_glitch(
      'С отметки ушёл снаряд по флоту «' || coalesce(tgt.name,'???') || '». Подлёт ~' ||
      to_char(fly,'FM990.0') || ' ч.', 0.16) ||
    ' ' || public._angel_scream(12));

  return jsonb_build_object('ok', true, 'act', 'hunter', 'target', tgt.name,
                            'ships', tgt.ships, 'ready_at', rdy);
end$$;
revoke all on function public._angel_hunter() from public;

-- ── 7. ЧТО ЖЕЧЬ: ЗАЛП ДЛАНИ ПО МИРУ ─────────────────────────
-- Ангел стирает планеты. Не «наносит урон» — стирает. Цель выбирает по
-- принципу «самое жирное из достижимого», и только среди тех, с кем война:
-- жечь всех подряд превратило бы галактику в пустыню за неделю, а кризис
-- должен оставлять живых, чтобы им было страшно.
create or replace function public._angel_doom()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; g record; f record; tgt record; have_q int;
        org public.map_systems; tsys public.map_systems; dist numeric; diag numeric;
        frac numeric; fly numeric; rdy timestamptz;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select coalesce(d.qty,0) into have_q from public.doom_shells d
   where d.faction_id = a.faction_id and d.kind = 'doom';
  if coalesce(have_q,0) < 1 then return jsonb_build_object('ok', true, 'why', 'нет снаряда Длани'); end if;

  select * into f from public.fleets where id = a.fleet_id;
  select * into g from public.doom_guns
   where faction_id = a.faction_id and integrity > 0
     and not exists(select 1 from public.doom_salvos s
                     where s.gun_id = doom_guns.id and s.status = 'in_flight')
   order by integrity desc limit 1;
  if g.id is null then return jsonb_build_object('ok', true, 'why', 'ствол занят или разрушен'); end if;

  -- ствол стоит на ковчеге — значит стреляет оттуда, где ковчег сейчас
  update public.doom_guns set system_id = coalesce(f.system_id, f.from_sys, g.system_id)
   where id = g.id;
  select * into g from public.doom_guns where id = g.id;
  if g.system_id is null then return jsonb_build_object('ok', true, 'why', 'ствол вне карты'); end if;

  select c.system_id, c.planet_pid, c.planet_name, c.faction_id, c.pop
    into tgt
    from public.colonies c
    join public.map_systems ms on ms.id = c.system_id
   where c.planet_pid is not null
     and c.faction_id is distinct from a.faction_id
     and c.faction_id in (select public.war_enemies_of(a.faction_id))
     and not exists(select 1 from public.doom_salvos s
                     where s.status = 'in_flight' and s.target_system_id = c.system_id
                       and s.target_pid = c.planet_pid)
     -- Ожерелье над системой снимет залп гарантированно: не тратим снаряд
     and not exists(select 1 from public.colony_buildings cb
                      join public.colonies c2 on c2.id = cb.colony_id
                     where cb.btype = 'nemesis' and c2.system_id = c.system_id)
   order by coalesce(c.pop, 0) desc
   limit 1;
  if tgt.system_id is null then return jsonb_build_object('ok', true, 'why', 'нет цели среди врагов'); end if;

  perform public._shell_take(a.faction_id, 'doom');
  update public.doom_guns
     set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
         total_shots = total_shots + 1
   where id = g.id;

  select * into org  from public.map_systems where id = g.system_id;
  select * into tsys from public.map_systems where id = tgt.system_id;
  dist := sqrt(power(coalesce(tsys.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tsys.y,0)-coalesce(org.y,0),2));
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2)) into diag from public.map_systems;
  frac := least(1.0, greatest(0.0, dist / nullif(diag,0)));
  fly  := public._doom_const('flight_h_min')
        + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy  := now() + (round(fly*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid,
     target_planet, ready_at, kind, victim_fid)
  values
    (g.id, a.faction_id,
     (select owner_id from public.faction_economy where faction_id = a.faction_id),
     g.system_id, tgt.system_id, tgt.planet_pid, tgt.planet_name, rdy, 'doom', tgt.faction_id);

  perform public._angel_tell(tgt.faction_id, public._angel_glitch('◈ Оно выбрало планету', 0.22),
    public._angel_glitch(
      'С отметки ушёл снаряд судного дня по планете «' || coalesce(tgt.planet_name,'???') ||
      '». Подлёт ~' || to_char(fly,'FM990.0') || ' ч.', 0.16) ||
    ' ' || public._angel_scream(14));

  return jsonb_build_object('ok', true, 'act', 'doom', 'planet', tgt.planet_name, 'ready_at', rdy);
end$$;
revoke all on function public._angel_doom() from public;

-- ── 8. КУДА ИДТИ ────────────────────────────────────────────
-- Порядок предпочтений и почему именно такой:
--   1) системы врагов, с кем война, — по ним и идёт кризис;
--   2) если врагов рядом нет — просто чужая жирная система (война начнётся
--      сама, когда он придёт: ангел не объявляет войн, он приходит);
--   3) в крайнем случае — соседняя система вообще любая, лишь бы ДВИГАТЬСЯ.
-- Радиус 5 прыжков намеренно мал: кризис должен ползти по карте, а не
-- перепрыгивать с края на край, иначе от него невозможно ни убежать, ни
-- подготовиться, и это перестаёт быть игрой.
create or replace function public._angel_pick_target()
returns text language plpgsql security definer set search_path=public as $$
declare a record; f record; here text; res text; log jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return null; end if;
  select * into f from public.fleets where id = a.fleet_id;
  here := coalesce(f.system_id, f.from_sys);
  if here is null then return null; end if;
  log := coalesce(a.path_log, '[]'::jsonb);

  -- 1) враг
  select ms.id into res
    from public.map_systems ms
   where ms.id <> here
     and exists(select 1 from public.colonies c
                 where c.system_id = ms.id
                   and c.faction_id in (select public.war_enemies_of(a.faction_id)))
     and public._mza_hops(here, ms.id, 5) is not null
   order by (log ? ms.id) asc,
            (select count(*) from public.colonies c where c.system_id = ms.id) desc,
            public._mza_hops(here, ms.id, 5) asc
   limit 1;
  if res is not null then return res; end if;

  -- 2) чужая жирная
  select ms.id into res
    from public.map_systems ms
   where ms.id <> here
     and exists(select 1 from public.colonies c
                 where c.system_id = ms.id and c.faction_id is distinct from a.faction_id)
     and public._mza_hops(here, ms.id, 5) is not null
   order by (log ? ms.id) asc,
            (select coalesce(sum(coalesce(c.pop,0)),0) from public.colonies c
              where c.system_id = ms.id) desc,
            public._mza_hops(here, ms.id, 5) asc
   limit 1;
  if res is not null then return res; end if;

  -- 3) хоть куда, лишь бы не стоять
  select case when l.a_id = here then l.b_id else l.a_id end into res
    from public.map_hyperlanes l
   where l.a_id = here or l.b_id = here
   order by (log ? case when l.a_id = here then l.b_id else l.a_id end) asc, random()
   limit 1;
  return res;
end$$;
revoke all on function public._angel_pick_target() from public;

-- Отправка. Своя, а не fleet_send: у ангела нет сессии, а бак ему не нужен —
-- он не заправляется у застав, он вообще не машина. Поля бака держим полными,
-- чтобы вся остальная логистика читала их как «всё в порядке».
create or replace function public._angel_send(p_dest text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; pth jsonb; sched jsonb; fly numeric; dep timestamptz := now();
        log jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', false); end if;
  select * into f from public.fleets where id = a.fleet_id for update;
  if f.id is null then return jsonb_build_object('ok', false, 'why', 'ковчега нет'); end if;
  if f.status <> 'idle' then return jsonb_build_object('ok', true, 'moving', true); end if;
  if p_dest is null or p_dest = f.system_id then return jsonb_build_object('ok', true, 'stay', true); end if;
  if not exists(select 1 from public.map_systems where id = p_dest) then
    return jsonb_build_object('ok', false, 'why', 'нет такой системы');
  end if;

  pth   := public._fleet_path(f.system_id, p_dest);
  fly   := coalesce(public._fleet_fly_hours(f.system_id, p_dest), 2.0);
  sched := case when pth is null then null else public._fleet_schedule(pth, dep) end;

  update public.fleets
     set status='transit', from_sys=system_id, dest_sys=p_dest, system_id=null,
         depart_at=dep, arrive_at=dep + (fly || ' hours')::interval,
         route=pth, route_at=sched, fuel=fuel_cap
   where id = f.id;

  -- память похода: последние 12 систем, чтобы не ходить челноком
  log := coalesce(a.path_log, '[]'::jsonb) || jsonb_build_array(p_dest);
  if jsonb_array_length(log) > 12 then
    log := (select coalesce(jsonb_agg(v), '[]'::jsonb) from (
              select value v, row_number() over () rn
                from jsonb_array_elements(log)) q
             where rn > jsonb_array_length(log) - 12);
  end if;
  update public.angel_state set target_sys = p_dest, path_log = log
   where faction_id = a.faction_id;

  return jsonb_build_object('ok', true, 'act', 'march', 'dest', p_dest, 'fly_h', round(fly,1));
end$$;
revoke all on function public._angel_send(text) from public;

-- ── 8.5 ВОЙНА НЕ ОБЪЯВЛЯЕТСЯ, ОНА ПРИХОДИТ ──────────
-- Своя дверь вместо war_declare: у ангела нет сессии, а проверки той двери ему
-- не подходят вовсе (союзы, баны, casus belli). Смысл здесь другой: ангел не
-- ведёт дипломатию и не выбирает врагов заранее — он встал над твоей системой,
-- и с этого мгновения вы в состоянии войны. Отказаться нельзя, потому что
-- отказываться не у кого: с той стороны не разговаривают.
create or replace function public._angel_declare(p_target text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; w uuid;
begin
  af := public._angel_fid();
  if af is null or p_target is null or p_target = af then
    return jsonb_build_object('ok', false);
  end if;
  if not exists(select 1 from public.faction_applications
                 where faction_id = p_target and status = 'approved') then
    return jsonb_build_object('ok', false, 'why', 'нет такой державы');
  end if;
  if public.at_war(af, p_target) then return jsonb_build_object('ok', true, 'already', true); end if;

  insert into public.wars(attacker_fid, defender_fid, cause)
    values (af, p_target, 'Присутствие') returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, af, 'attacker'), (w, p_target, 'defender');

  perform public._war_news(
    public._angel_glitch('◈ Оно пришло: ' || public._war_nm(af) || ' → ' || public._war_nm(p_target), 0.18),
    public._angel_glitch(
      'Ноты не поступало. Требований не выдвинуто. Штаб считает это объявлением войны, ' ||
      'потому что иначе это назвать нечем.', 0.16) ||
    ' ' || public._angel_scream(10) || ' ' ||
    public._angel_glitch('Переговорщиков не отправляли: предыдущие вернулись без вопросов и без ответов.', 0.20),
    jsonb_build_array(af, p_target));
  return jsonb_build_object('ok', true, 'war_id', w);
end$$;
revoke all on function public._angel_declare(text) from public;

-- ── 9. ТИК ВОЙНЫ ────────────────────────────────────────────
-- Раз в 5 минут. Порядок шагов — это и есть приоритеты ИИ: сначала выжить,
-- потом стрелять, потом идти дальше.
create or replace function public.angel_war_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; f record; out jsonb := '{}'::jsonb; mx numeric; frac numeric;
        inc int; dest text; st text; af text; foes text[];
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  af := a.faction_id;

  -- 9.1 своё хозяйство времени: печати, тело, прилёты, свои залпы
  perform public._angel_regen();
  perform public._angel_sync_body();
  begin perform public._fleet_settle(af); exception when others then null; end;
  begin perform public._doom_resolve(af); exception when others then null; end;

  select * into a from public.angel_state where faction_id = af;
  if a.fell_at is not null then return jsonb_build_object('ok', true, 'fell', true); end if;
  select * into f from public.fleets where id = a.fleet_id;
  if f.id is null then return jsonb_build_object('ok', true, 'why', 'ковчега нет'); end if;

  mx   := public._angel_const('seals_max');
  frac := a.seals / nullif(mx, 0);
  select count(*) into inc from public.doom_salvos s
   where s.status = 'in_flight' and s.target_fleet_id = a.fleet_id;

  -- 9.2 РЕШЕНИЕ О ЖИЗНИ. Печати ниже порога — разворот в гнездо, и никакие
  -- цели больше не важны. Ангел, который погиб от жадности, — плохой кризис.
  st := a.stance;
  if frac <= public._angel_const('flee_frac') then st := 'roost';
  elsif st = 'roost' and frac >= public._angel_const('back_frac') then st := 'march';
  end if;
  if st is distinct from a.stance then
    update public.angel_state set stance = st where faction_id = af;
    -- ⚠️ Причину смены курса не называем ни в одну, ни в другую сторону:
    -- «оно ранено» и «оно залечилось» — это и есть шкала здоровья словами.
    if st = 'roost' then
      perform public._angel_news(public._angel_glitch('◈ ОНО СМЕНИЛО КУРС', 0.24),
        public._angel_glitch('Отметка развернулась и уходит. Причина манёвра', 0.18)
        || ' ' || public._angel_scream(16));
    else
      perform public._angel_news(public._angel_glitch('◈ ОНО СНОВА ДВИЖЕТСЯ', 0.24),
        public._angel_glitch('Отметка снялась с места. Пауза длилась', 0.18)
        || ' ' || public._angel_scream(11));
    end if;
  end if;

  -- 9.25 ВОЙНА ПО ФАКТУ. Ковчег сел над чужой системой — значит война уже
  -- идёт, и её надо оформить: без строки в wars флоты друг друга «не видят»
  -- и вся боевая часть игры просто не запускается.
  if f.system_id is not null then
    select array_agg(distinct c.faction_id) into foes from public.colonies c
     where c.system_id = f.system_id and c.faction_id is not null
       and c.faction_id is distinct from af
       and not public.at_war(af, c.faction_id);
    if foes is not null then
      begin
        perform public._angel_declare(v) from unnest(foes) v;
      exception when others then null; end;
    end if;
  end if;

  -- 9.3 ОГОНЬ. В гнезде тоже стреляет: лежать и молчать — не его манера,
  -- а залпы печатей не тратят.
  begin out := out || jsonb_build_object('hunter', public._angel_hunter()); exception when others then null; end;
  begin out := out || jsonb_build_object('doom',   public._angel_doom());   exception when others then null; end;

  -- 9.4 ХОД. В гнезде — домой; иначе к следующей цели. Стоящий на месте
  -- кризис перестаёт быть кризисом, поэтому цель ищется КАЖДЫЙ раз, как только
  -- ковчег сел.
  if f.status = 'idle' then
    if st = 'roost' then
      dest := case when coalesce(f.system_id,'') = coalesce(a.home_sys,'') then null else a.home_sys end;
    else
      dest := public._angel_pick_target();
    end if;
    if dest is not null then
      begin out := out || jsonb_build_object('march', public._angel_send(dest));
      exception when others then null; end;
    end if;
  end if;

  return out || jsonb_build_object('ok', true, 'stance', st,
    'seals', round(a.seals,1), 'frac', round(frac,3), 'incoming', inc,
    'sys', coalesce(f.system_id, f.from_sys));
end$$;
revoke all on function public.angel_war_tick() from public;

-- ── 10. ТИК ХОЗЯЙСТВА ───────────────────────────────────────
create or replace function public.angel_econ_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; out jsonb := '{}'::jsonb;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  perform public._angel_seed_tech();
  -- достройка: тем же движком, что у живых держав, — иначе постройки ангела
  -- жили бы по своим правилам и разъезжались с каталогом
  begin perform public._apply_colony_projects(a.faction_id); exception when others then null; end;

  begin out := out || jsonb_build_object('tithe',  public._angel_tithe()); exception when others then null; end;
  begin out := out || jsonb_build_object('forge',  public._angel_forge()); exception when others then null; end;
  begin out := out || jsonb_build_object('build',  public._angel_build()); exception when others then null; end;
  begin out := out || jsonb_build_object('pacer',  public._angel_pacer()); exception when others then null; end;

  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_econ_tick() from public;

-- ── 11. ОБЩИЙ ТИК И КРОН ────────────────────────────────────
-- Быстрый тик: доска + война. Ходы машинной стороны на доске уже гоняет
-- legion-ai-tick (ангел добавлен в _bt_is_machine на шаге 2) — здесь только
-- расстановка и стратегия.
create or replace function public.angel_ai_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out jsonb := '{}'::jsonb;
begin
  begin out := out || jsonb_build_object('board', public.angel_battle_tick()); exception when others then null; end;
  begin out := out || jsonb_build_object('war',   public.angel_war_tick());    exception when others then null; end;
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('angel-ai-tick')
      where exists (select 1 from cron.job where jobname = 'angel-ai-tick');
    perform cron.schedule('angel-ai-tick', '1-59/5 * * * *',
                          'select public.angel_ai_tick();');
    perform cron.unschedule('angel-econ-tick')
      where exists (select 1 from cron.job where jobname = 'angel-econ-tick');
    perform cron.schedule('angel-econ-tick', '21 * * * *',
                          'select public.angel_econ_tick();');
  end if;
end$$;

-- ── 12. РУЧНЫЕ ДВЕРИ (админ) ────────────────────────────────
create or replace function public.admin_angel_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
  return jsonb_build_object('econ', public.angel_econ_tick(),
                            'ai',   public.angel_ai_tick());
end$$;
revoke all on function public.admin_angel_tick() from public;
grant execute on function public.admin_angel_tick() to authenticated;

notify pgrst, 'reload schema';
