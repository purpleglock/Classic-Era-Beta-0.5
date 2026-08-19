-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 7: ОДНО ТЕЛО. НИКАКИХ ФЛОТОВ, КРОМЕ КОВЧЕГА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_core.sql, перед _angel_lock.sql (замок катать
-- последним — он закрывает права, которые `create or replace` тут вернёт).
--
-- ЧТО ПРОГЛЯДЕЛИ. Вознесение сносило колонии, постройки, аванпосты, армии и
-- отпускало системы — а ФЛОТЫ не трогало. У «Последнего Оплота» так и остался
-- «Щит человечества»: 40 бортов, обычная карточка, кнопка «Распустить флот».
-- Это ломает замысел в трёх местах сразу:
--   • «одно тело» перестаёт быть правдой — рядом с ангелом ходит нормальный
--     флот, который убивается нормальным боем; галактика видит у кризиса
--     обычную армию и перестаёт бояться;
--   • ковчег на карте — не единственная отметка державы, значит «убей ковчег,
--     и державы нет» больше не работает;
--   • эскорт делает то, чего ангел делать не должен: занимает системы,
--     конвоирует, воюет по правилам.
--
-- ⚠️ И ОТДЕЛЬНО — ДЫРА: «Распустить флот» на самом КОВЧЕГЕ удаляла бы ангела
-- целиком, мимо печатей, мимо Длани, мимо всего. Одна кнопка вместо сорока
-- залпов. Закрываем здесь же.
-- ════════════════════════════════════════════════════════════

-- ── 1. ВОЗНЕСЕНИЕ ПОГЛОЩАЕТ ФЛОТЫ ───────────────────────────
-- Флоты уходят в слепок (значит низвержение их вернёт) и исчезают с карты.
-- Не «переименовываем в ковчег» и не сливаем составы: ковчег — это ОДИН борт,
-- и приписать ему сорок корветов значит вернуть ту же проблему сбоку.
create or replace function public._angel_absorb_fleets(p_fid text)
returns int language plpgsql security definer set search_path=public as $$
declare keep uuid; n int := 0; add jsonb;
begin
  select fleet_id into keep from public.angel_state where faction_id = p_fid;

  -- дописываем флоты в уже снятый слепок, чтобы angel_descend их поднял
  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into add
    from public.fleets f
   where f.faction_id = p_fid and (keep is null or f.id <> keep);

  update public.angel_relic
     set snap = snap || jsonb_build_object('fleets', add)
   where faction_id = p_fid;

  with gone as (
    delete from public.fleets
     where faction_id = p_fid and (keep is null or id <> keep)
    returning 1)
  select count(*) into n from gone;
  return n;
end$$;

-- Само вознесение: тот же текст, что в _angel_core.sql, плюс поглощение флотов
-- перед созданием ковчега. ⚠️ Правки вести ОТСЮДА — этот файл теперь последний.
create or replace function public.angel_ascend(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app record; snap jsonb; home text; uid uuid; ecoown uuid;
        cid uuid; flid uuid; ncol int; nbld int; nsys int; nout int; nflt int;
begin
  perform public._angel_staff_only();

  select * into app from public.faction_applications
   where faction_id = p_fid and status = 'approved'
   order by updated_at desc limit 1;
  if app.faction_id is null then
    return jsonb_build_object('ok', false, 'why', 'держава не найдена или не одобрена');
  end if;
  if exists(select 1 from public.angel_state where faction_id = p_fid) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select owner_id into ecoown from public.faction_economy where faction_id = p_fid;

  select jsonb_build_object(
    'at', now(),
    'colonies', coalesce((select jsonb_agg(to_jsonb(c)) from public.colonies c
                           where c.faction_id = p_fid), '[]'::jsonb),
    'buildings', coalesce((select jsonb_agg(to_jsonb(b)) from public.colony_buildings b
                            where b.faction_id = p_fid), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(to_jsonb(pr)) from public.colony_projects pr
                            where pr.faction_id = p_fid), '[]'::jsonb),
    'outposts', coalesce((select jsonb_agg(to_jsonb(o)) from public.outposts o
                           where o.faction_id = p_fid), '[]'::jsonb),
    'fleets', coalesce((select jsonb_agg(to_jsonb(f)) from public.fleets f
                         where f.faction_id = p_fid), '[]'::jsonb),
    'systems', coalesce((select jsonb_agg(s.id) from public.map_systems s
                          where s.faction = p_fid), '[]'::jsonb),
    'armies', coalesce((select jsonb_agg(to_jsonb(a)) from public.armies a
                         where a.faction_id = p_fid), '[]'::jsonb))
    into snap;

  insert into public.angel_relic(faction_id, snap) values (p_fid, snap)
    on conflict (faction_id) do update set snap = excluded.snap, taken_at = now();

  select c.system_id into home from public.colonies c
   where c.faction_id = p_fid order by c.is_capital desc nulls last, c.created_at limit 1;
  home := coalesce(home, app.system_id);

  select count(*) into ncol from public.colonies where faction_id = p_fid;
  select count(*) into nbld from public.colony_buildings where faction_id = p_fid;
  select count(*) into nout from public.outposts where faction_id = p_fid;
  select count(*) into nsys from public.map_systems where faction = p_fid;
  select count(*) into nflt from public.fleets where faction_id = p_fid;

  delete from public.colony_projects  where faction_id = p_fid;
  delete from public.colony_buildings where faction_id = p_fid;
  delete from public.colonies         where faction_id = p_fid;
  delete from public.outposts         where faction_id = p_fid;
  delete from public.armies           where faction_id = p_fid;
  delete from public.fleets           where faction_id = p_fid;   -- ← всё в одно тело
  update public.map_systems set faction = null where faction = p_fid;

  insert into public.colonies(faction_id, owner_id, system_id, planet_name, planet_type,
                              cells, planet_pid, is_capital, pop, resources)
    values (p_fid, ecoown, home, 'Оплот', 'Структура',
            public._angel_const('ark_cells')::int, null, true,
            public._angel_const('ark_pop'), '[]'::jsonb)
    returning id into cid;

  uid := public._angel_unit_id(p_fid);
  insert into public.faction_units(id, category, name, faction_id, faction_name,
                                   faction_color, owner_id, summary, data, card_text)
    values (uid, 'ship', 'Престол', p_fid, app.name, app.color, ecoown,
            public._angel_summary(),
            jsonb_build_object('class', 'angel', 'angel', true,
                               'layout', jsonb_build_object('mounts', '[]'::jsonb),
                               'weapons', '[]'::jsonb, 'modules', '[]'::jsonb),
            'Шесть крыл, и под каждым — глаза. Оно не отвечает на вопросы.')
    on conflict (id) do update
      set summary = excluded.summary, data = excluded.data,
          faction_id = excluded.faction_id, name = excluded.name;

  insert into public.fleets(faction_id, owner_id, name, status, system_id, home_sys,
                            composition, is_station, fuel, fuel_cap)
    values (p_fid, ecoown, 'ОПЛОТ', 'idle', home, home,
            jsonb_build_array(jsonb_build_object('unit_id', uid, 'qty', 1)),
            false, 99, 99)
    returning id into flid;

  insert into public.angel_state(faction_id, unit_id, fleet_id, colony_id,
                                 seals, home_sys, target_sys, stance)
    values (p_fid, uid, flid, cid,
            public._angel_const('seals_max'), home, home, 'roost');

  perform public._angel_news(public._angel_glitch('◈ ОНО ВСТАЛО', 0.22),
    public._angel_glitch(
      'Связь с державой «' || app.name || '» оборвалась в 04:11 и больше не восстанавливалась. ' ||
      'Первыми отказали дальние посты, потом орбита, потом сама столица. ' ||
      'Последняя телеметрия шла ещё двенадцать минут и не содержала слов.', 0.18) ||
    ' ' || public._angel_scream(9) || ' ' ||
    public._angel_glitch('Приборы ведут одну отметку. Классификатор не выдал класса.', 0.34) ||
    ' ' || public._angel_scream(14));

  return jsonb_build_object('ok', true, 'fid', p_fid, 'colony', cid, 'fleet', flid,
    'unit', uid, 'home', home,
    'razed', jsonb_build_object('colonies', ncol, 'buildings', nbld,
                                'outposts', nout, 'systems', nsys, 'fleets', nflt));
end$$;

-- ── 2. КОВЧЕГ НЕ РАСПУСКАЕТСЯ И НЕ ПЕРЕСОБИРАЕТСЯ ───────────
-- Надмножество _army_fleet.sql. «Распустить флот» на ковчеге = удалить державу
-- одной кнопкой; «Изменить состав» = подсадить к ангелу корветы или, наоборот,
-- вынуть из него единственный борт. Обе двери закрываем по признаку ковчега,
-- а не по имени флота: имя игрок меняет, признак — нет.
create or replace function public.fleet_disband__raw(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl public.fleets; elem jsonb; total int := 0;
begin
  -- ◈ КОВЧЕГ. Проверка ПЕРВОЙ строкой, до всего остального: дальше идёт
  -- возврат бортов в производство, а у ангела возвращать нечего и некуда.
  if exists(select 1 from public.angel_state a where a.fleet_id = p_id and a.fell_at is null) then
    raise exception '%', public._angel_glitch('Роспуску не подлежит. Приказ не принят ', 0.34)
      || public._angel_scream(10);
  end if;

  fid := public._ec_my_fid();
  perform public._fleet_settle(fid);
  select * into fl from public.fleets where id=p_id;
  if not found then raise exception 'fleet not found'; end if;
  if fl.faction_id is distinct from fid then raise exception 'not your fleet'; end if;
  if fl.status <> 'idle' then raise exception 'дождитесь прибытия флота, прежде чем распускать'; end if;

  for elem in select value from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) loop
    insert into public.unit_production(faction_id, owner_id, unit_id, unit_name, category, line, qty, status, ready_at)
      values(fid, auth.uid(), nullif(elem->>'unit_id','')::uuid, elem->>'unit_name',
             'ship', 'shipyard', greatest(0, coalesce((elem->>'qty')::int,0)), 'done', now());
    total := total + greatest(0, coalesce((elem->>'qty')::int,0));
  end loop;

  delete from public.fleets where id=p_id;
  return jsonb_build_object('ok', true, 'returned', total);
end$$;

-- Пересборка состава — той же дверью: подсадить к ангелу корветы или вынуть из
-- него единственный борт одинаково ломает «одно тело».
create or replace function public._angel_fleet_guard()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.angel_state a
             where a.fleet_id = NEW.id and a.fell_at is null)
     and NEW.composition is distinct from OLD.composition then
    raise exception '%', public._angel_glitch('Состав не подлежит правке ', 0.34)
      || public._angel_scream(9);
  end if;
  return NEW;
end$$;
drop trigger if exists trg_angel_fleet_guard on public.fleets;
create trigger trg_angel_fleet_guard before update on public.fleets
  for each row execute function public._angel_fleet_guard();

-- ── 3. ЛАТАЕМ УЖЕ ВОЗНЕСЁННОГО ──────────────────────────────
-- Оплот вознёсся ДО этой правки, и «Щит человечества» остался у него на руках.
-- Разовое поглощение — идемпотентное: если флотов кроме ковчега нет, тихо ничего.
do $$
declare af text; n int;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  n := public._angel_absorb_fleets(af);
  if n > 0 then
    raise notice 'Престол: поглощено флотов — %', n;
    perform public._angel_news(public._angel_glitch('◈ СТРОЙ РАСПАЛСЯ', 0.24),
      public._angel_glitch(
        'Соединение, шедшее рядом с отметкой, перестало отвечать по одному борту за раз. '
        || 'Радиообмен оборвался не сразу: сначала пропали ведомые, потом ведущий.', 0.18)
      || ' ' || public._angel_scream(13));
  end if;
end$$;

notify pgrst, 'reload schema';
