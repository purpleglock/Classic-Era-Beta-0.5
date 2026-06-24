-- ============================================================
--  МЕЖЗВЁЗДНАЯ АРТИЛЛЕРИЯ — «Длань Неотвратимости»
--
--  Орудие судного дня: стреляет из одной системы в другую и
--  превращает планету-цель в МЁРТВУЮ ПЛАНЕТУ (класс coreplanet).
--
--  Цепочка:
--   1) Исследование «Сама неотвратимость» (pol.inevitability) —
--      запредельно дорогое (5000 ОН). Открывает постройку.
--   2) Постройка doomgun — стоит ГС + Программируемую материю.
--   3) Содержание: каждый день Программируемая материя тратится на
--      сдерживание деградации. Нет материи → орудие гниёт быстрее.
--      Каждый выстрел тоже изнашивает орудие. integrity<=0 → распад.
--   4) Залп: 20 Гравиядра со склада. Снаряд летит (ready_at), затем
--      поражает цель. И исследование, и постройка, и залп, и
--      поражение льют в ленту пугающие сводки сектора.
--
--  Зависимости (должны быть применены РАНЕЕ):
--   • _economy_setup.sql        — colonies/colony_buildings/colony_projects, _apply_colony_projects
--   • _security_money.sql       — _ec_my_fid
--   • _politics_research.sql    — tech_nodes, faction_economy.research
--   • _sector_bulletins.sql     — public._post_sector_news(title,body,color)
--   • _map_setup.sql            — map_systems(planets jsonb)
--
--  Выполнить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно.
--  ПРИМЕНЯТЬ ПОСЛЕ всех слайсов, которые переопределяют
--  _apply_colony_projects (здесь оно пересоздаётся с хуком артиллерии).
-- ============================================================

-- ── 0) Каталог исследования: узел в tech_nodes (сервер — источник цены) ──
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('pol.inevitability', 5000, '[]'::jsonb)
on conflict (node_id) do update set base_cost = excluded.base_cost;

-- ── 1) ТАБЛИЦЫ ──────────────────────────────────────────────
-- Орудие: одно на постройку doomgun. integrity 0..100.
create table if not exists public.doom_guns (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid unique references public.colony_buildings(id) on delete cascade,
  colony_id   uuid,
  faction_id  text,
  owner_id    uuid,
  system_id   text,
  integrity   numeric not null default 100,
  total_shots int not null default 0,
  last_maint  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists doom_guns_fid_idx on public.doom_guns(faction_id);

-- Залп в полёте: летит origin → target, по ready_at поражает планету.
create table if not exists public.doom_salvos (
  id                uuid primary key default gen_random_uuid(),
  gun_id            uuid references public.doom_guns(id) on delete set null,
  faction_id        text,
  owner_id          uuid,
  origin_system_id  text,
  target_system_id  text,
  target_pid        int,
  target_planet     text,
  status            text not null default 'in_flight',   -- in_flight | done
  launched_at       timestamptz not null default now(),
  ready_at          timestamptz not null,
  resolved_at       timestamptz
);
create index if not exists doom_salvos_fid_idx    on public.doom_salvos(faction_id);
create index if not exists doom_salvos_status_idx on public.doom_salvos(status);
-- держава, чья колония была стёрта этим залпом (для ачивки «Мироубийца»); null — пустой мир
alter table public.doom_salvos add column if not exists victim_fid text;

alter table public.doom_guns   enable row level security;
alter table public.doom_salvos enable row level security;
-- читать всем (видна угроза), писать — только через SECURITY DEFINER RPC
do $$
declare t text;
begin
  foreach t in array array['doom_guns','doom_salvos'] loop
    execute format('drop policy if exists "doom_sel" on public.%I', t);
    execute format('create policy "doom_sel" on public.%I for select to public using (true)', t);
  end loop;
end$$;

-- ── 2) КОНСТАНТЫ (баланс) ───────────────────────────────────
-- Ключи ресурсов — РУССКИЕ ИМЕНА (склад faction_economy.resources keyed by name).
--   Программируемая материя — постройка + содержание.
--   Гравиядро               — топливо залпа (20 шт / залп).
create or replace function public._doom_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'build_gc'      then 500000   -- ГС за постройку орудия
    when 'build_matter'  then 40       -- Программируемой материи за постройку
    when 'shot_grav'     then 20       -- Гравиядра за один залп
    when 'shot_wear'     then 20       -- износ integrity за выстрел
    when 'decay_day'     then 5        -- естественная деградация в день
    when 'decay_kept'    then 1        -- деградация в день при оплаченном содержании
    when 'maint_matter'  then 4        -- Программируемой материи в день на содержание
    when 'flight_days'   then 1        -- (устар.) сколько суток летит снаряд — заменено дистанцией
    when 'flight_h_min'  then 3        -- мин. полёт (соседняя система), часов
    when 'flight_h_max'  then 24       -- макс. полёт (край↔край карты), часов = 1 сутки
    else 0 end
$$;

-- ── 3) ТРИГГЕР: рождение/гибель орудия вслед за постройкой ──
-- При появлении colony_buildings(btype='doomgun') заводим doom_guns.
create or replace function public._doom_on_building()
returns trigger language plpgsql security definer set search_path=public as $$
declare sid text;
begin
  if NEW.btype = 'doomgun' then
    select system_id into sid from public.colonies where id = NEW.colony_id;
    insert into public.doom_guns (building_id, colony_id, faction_id, owner_id, system_id)
      values (NEW.id, NEW.colony_id, NEW.faction_id, NEW.owner_id, sid)
      on conflict (building_id) do nothing;
  end if;
  return NEW;
end$$;
drop trigger if exists trg_doom_on_building on public.colony_buildings;
create trigger trg_doom_on_building after insert on public.colony_buildings
  for each row execute function public._doom_on_building();

-- ── helper: пугающая сводка в ленту (best-effort) ───────────
create or replace function public._doom_news(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public._post_sector_news(p_title, p_body, 'rgba(220,40,40,0.55)');
  exception when others then null;  -- лента не критична для механики
  end;
end$$;

-- ── 4) RPC: ПОСТРОЙКА ОРУДИЯ ────────────────────────────────
-- Отдельный путь (а не economy_build): списывает ГС + Программируемую материю,
-- требует исследование. Завершается отложенным проектом (1 день), как обычная
-- постройка; орудие появится по тику через _apply_colony_projects + триггер.
create or replace function public.doom_build(p_colony_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; eco public.faction_economy;
  used int; pending int; gc_cost numeric; matter_need numeric; have_matter numeric; res jsonb; fname text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;
  -- ВОРОТА: исследование «Сама неотвратимость»
  if not (coalesce(eco.research,'[]'::jsonb) ? 'pol.inevitability') then
    raise exception 'research required: pol.inevitability';
  end if;

  select * into col from public.colonies where id = p_colony_id;
  if not found then raise exception 'colony not found'; end if;
  if col.faction_id is distinct from fid then raise exception 'not your colony'; end if;

  select count(*) into used    from public.colony_buildings where colony_id = p_colony_id;
  select count(*) into pending from public.colony_projects where colony_id = p_colony_id and kind='build';
  if used + pending >= coalesce(col.cells,6) then raise exception 'no free cells'; end if;

  gc_cost     := public._doom_const('build_gc');
  matter_need := public._doom_const('build_matter');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
  if have_matter < matter_need then
    raise exception 'not enough programmable matter: need %, have %', matter_need, floor(have_matter);
  end if;
  if coalesce(eco.gc,0) < gc_cost then raise exception 'not enough GC'; end if;

  -- списываем ГС + материю атомарно
  res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - matter_need), true);
  update public.faction_economy set gc = gc - gc_cost, resources = res
    where faction_id = fid and gc >= gc_cost;
  if not found then raise exception 'not enough GC'; end if;

  insert into public.colony_projects
    (faction_id, owner_id, kind, btype, colony_id, payload, label, ready_at)
  values
    (fid, auth.uid(), 'build', 'doomgun', p_colony_id,
     jsonb_build_object('spent_gc', gc_cost, 'spent_matter', matter_need, 'btype', 'doomgun', 'free_slots', 1),
     'Возведение Длани Неотвратимости', now() + interval '1 day');

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '☣ ВОЗВЕДЕНИЕ ОРУДИЯ СУДНОГО ДНЯ',
    coalesce(fname,'Неизвестная держава')||' закладывает «Длань Неотвратимости» в системе «'||
    coalesce(col.planet_name,'???')||'». По сектору ползёт холод: это не оружие войны — это приговор целым мирам. Да хранят нас звёзды.');

  return jsonb_build_object('ok', true, 'gc', gc_cost, 'matter', matter_need, 'ready_at', now() + interval '1 day');
end$$;
revoke all on function public.doom_build(uuid) from public;
grant execute on function public.doom_build(uuid) to authenticated;

-- ── 5) RPC: ЗАЛП ────────────────────────────────────────────
-- Тратит 20 Гравиядра, изнашивает орудие, запускает снаряд в полёт.
create or replace function public.doom_fire(p_gun_id uuid, p_target_system_id text, p_target_pid int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g public.doom_guns; eco public.faction_economy; res jsonb;
  grav_need numeric; have_grav numeric; tgt public.map_systems; pl jsonb; rdy timestamptz; fname text; ptname text;
  org public.map_systems; dist numeric; map_diag numeric; frac numeric; fly_h numeric;
begin
  fid := public._ec_my_fid();
  perform public._doom_settle(fid);   -- сначала догнать деградацию (integrity актуальна)
  select * into g from public.doom_guns where id = p_gun_id;
  if not found then raise exception 'gun not found'; end if;
  if g.faction_id is distinct from fid then raise exception 'not your gun'; end if;
  if g.integrity <= 0 then raise exception 'gun is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where gun_id = g.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  -- цель: планета по pid в системе
  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;
  select value into pl from jsonb_array_elements(coalesce(tgt.planets,'[]'::jsonb))
    where (value->>'pid')::int = p_target_pid limit 1;
  if pl is null then raise exception 'target planet not found'; end if;
  if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
  ptname := coalesce(pl->>'name','планета');

  -- топливо: 20 Гравиядра
  select * into eco from public.faction_economy where faction_id = fid for update;
  grav_need := public._doom_const('shot_grav');
  res := coalesce(eco.resources,'{}'::jsonb);
  have_grav := coalesce((res->>'Гравиядро')::numeric, 0);
  if have_grav < grav_need then
    raise exception 'not enough gravity cores: need %, have %', grav_need, floor(have_grav);
  end if;
  res := jsonb_set(res, array['Гравиядро'], to_jsonb(have_grav - grav_need), true);
  update public.faction_economy set resources = res where faction_id = fid;

  -- износ орудия от выстрела
  update public.doom_guns set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
                              total_shots = total_shots + 1
    where id = g.id;

  -- время полёта = функция РАССТОЯНИЯ от орудия до цели.
  -- соседняя система ≈ flight_h_min, край↔край карты ≈ flight_h_max (1 сутки).
  select * into org from public.map_systems where id = g.system_id;
  dist := sqrt(power(coalesce(tgt.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tgt.y,0)-coalesce(org.y,0),2));
  -- диагональ карты = от мин. до макс. координат всех систем (реальный «край↔край»)
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2))
    into map_diag from public.map_systems;
  frac := least(1.0, greatest(0.0, dist / nullif(map_diag,0)));
  fly_h := public._doom_const('flight_h_min')
         + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;
  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at)
  values
    (g.id, fid, auth.uid(), g.system_id, p_target_system_id, p_target_pid, ptname, rdy);

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '🜨 ЗАЛП ВЫПУЩЕН — ОТСЧЁТ ПОШЁЛ',
    'Длань Неотвратимости ('||coalesce(fname,'???')||') дала залп по системе «'||coalesce(tgt.name,'???')||
    '». Снаряд уже в пути к планете «'||ptname||'» — расчётное время полёта ~'||
    to_char(fly_h,'FM990.0')||' ч. Эвакуация бессмысленна — он придёт. И никто его не остановит.');

  return jsonb_build_object('ok', true, 'grav', grav_need, 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'dist', round(dist));
end$$;
revoke all on function public.doom_fire(uuid,text,int) from public;
grant execute on function public.doom_fire(uuid,text,int) to authenticated;

-- ── 6) РЕЗОЛВ ЗАЛПОВ: поражение системы → мёртвая планета ────
create or replace function public._doom_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_intercepted boolean;        -- ПРО планеты-цели (_defense_planetary.sql)
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
    -- ⛨ ПЛАНЕТАРНАЯ ПРО: перехват тратит снаряд и спасает планету.
    -- Вызов через to_regprocedure+EXECUTE, чтобы не зависеть от порядка применения
    -- (если _defense_planetary.sql ещё не накатан — хук просто молчит).
    v_intercepted := false;
    if to_regprocedure('public._abm_intercept(text,int)') is not null then
      execute 'select public._abm_intercept($1,$2)'
        into v_intercepted using s.target_system_id, s.target_pid;
    end if;
    if v_intercepted then
      update public.doom_salvos set status='intercepted', resolved_at=now() where id = s.id;
      perform public._doom_news('⛨ ЗАЛП ПЕРЕХВАЧЕН',
        'Залп «Длани Неотвратимости» по планете «'||coalesce(s.target_planet,'???')||
        '» сбит планетарной ПРО. Планета уцелела — снаряд противоракеты израсходован.');
      continue;
    end if;

    select * into tgt from public.map_systems where id = s.target_system_id;
    if found then
      arr := coalesce(tgt.planets, '[]'::jsonb);
      -- перебираем планеты системы, целевую (по pid) превращаем в мёртвую
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

      -- уничтожаем колонию на этой планете (если есть) + её постройки (каскад).
      -- Цель по planet_pid; для столиц-домиков без стабильного pid — по имени.
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        victim_fid := col.faction_id;
        select name into victim_name from public.faction_applications
          where faction_id = victim_fid and status='approved' order by updated_at desc limit 1;
        delete from public.colonies where id = col.id;   -- colony_buildings уходят каскадом
        -- фиксируем жертву на залпе (для ачивки «Мироубийца»); col.* живо после delete
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
      end if;

      perform public._doom_news(
        '☠ ПЛАНЕТА УНИЧТОЖЕНА',
        'Планета «'||coalesce(s.target_planet,'???')||'» в системе «'||coalesce(tgt.name,'???')||
        '» перестала существовать. Кора вскипела, океаны испарились, орбита усеяна пеплом — теперь это мёртвый камень.'||
        case when victim_name is not null then ' Колония державы «'||victim_name||'» стёрта вместе с миром.' else '' end||
        ' Молчите. Здесь больше нечего сказать.');
    end if;

    update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
  end loop;
end$$;
revoke all on function public._doom_resolve(text) from public;

-- ── 7) СОДЕРЖАНИЕ ОРУДИЯ: ленивое (по факту обращения), а не в income-тике ──
-- ВАЖНО: economy_accrue в конце ПЕРЕЗАПИСЫВАЕТ faction_economy.resources из
-- снимка, взятого ДО хука _apply_colony_projects → любое списание ресурсов
-- внутри тика затирается. Поэтому содержание считаем ЛЕНИВО, в собственной
-- транзакции RPC (doom_status / doom_fire / doom_build), от last_maint каждого
-- орудия. Деградация привязана ко времени, поэтому при любом обращении
-- «догоняет» все прошедшие сутки (тратит накопленную материю, копит распад).
create or replace function public._doom_settle(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare eco public.faction_economy; res jsonb; g record; d numeric; days int;
  maint numeric; have_matter numeric; spend numeric; decay numeric; kept boolean; changed boolean := false;
begin
  if not exists(select 1 from public.doom_guns where faction_id = p_fid) then return; end if;
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then return; end if;
  res := coalesce(eco.resources,'{}'::jsonb);

  for g in select * from public.doom_guns where faction_id = p_fid loop
    days := floor(extract(epoch from (now()-g.last_maint))/86400.0);
    if days < 1 then continue; end if;             -- целые сутки ещё не прошли
    maint       := public._doom_const('maint_matter') * days;
    have_matter := coalesce((res->>'Программируемая материя')::numeric, 0);
    if have_matter >= maint then
      spend := maint; decay := public._doom_const('decay_kept') * days; kept := true;   -- содержание оплачено
    else
      spend := have_matter; decay := public._doom_const('decay_day') * days; kept := false;  -- материи нет → гниёт
    end if;
    if spend > 0 then
      res := jsonb_set(res, array['Программируемая материя'], to_jsonb(have_matter - spend), true);
      changed := true;
    end if;
    d := greatest(0, g.integrity - decay);
    if d <= 0 then
      delete from public.colony_buildings where id = g.building_id;   -- негодно → постройка пропадает (каскадом и doom_guns)
      perform public._doom_news(
        '🜨 ОРУДИЕ РАСПАЛОСЬ',
        'Длань Неотвратимости рассыпалась в прах: программируемая материя иссякла, и сдерживать деградацию стало нечем. '||
        'То, что грозило целым мирам, теперь — груда мёртвого металла. Возможно, так даже лучше.');
    else
      -- last_maint двигаем ровно на отработанные сутки (остаток времени сохраняем)
      update public.doom_guns set integrity = d, last_maint = g.last_maint + (days||' days')::interval
        where id = g.id;
    end if;
  end loop;

  if changed then update public.faction_economy set resources = res where faction_id = p_fid; end if;
end$$;
revoke all on function public._doom_settle(text) from public;

-- ── 8) RPC: СТАТУС (для кабинета) ───────────────────────────
create or replace function public.doom_status()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare fid text; guns jsonb; salvos jsonb;
begin
  fid := public._ec_my_fid();
  perform public._doom_settle(fid);   -- догнать содержание/деградацию по факту обращения
  select coalesce(jsonb_agg(jsonb_build_object(
            'id', g.id, 'building_id', g.building_id, 'colony_id', g.colony_id,
            'system_id', g.system_id, 'integrity', g.integrity, 'total_shots', g.total_shots,
            'in_flight', exists(select 1 from public.doom_salvos s where s.gun_id=g.id and s.status='in_flight')
         )), '[]'::jsonb)
    into guns from public.doom_guns g where g.faction_id = fid;
  select coalesce(jsonb_agg(jsonb_build_object(
            'id', s.id, 'gun_id', s.gun_id, 'target_system_id', s.target_system_id,
            'target_pid', s.target_pid, 'target_planet', s.target_planet,
            'status', s.status, 'ready_at', s.ready_at
         ) order by s.launched_at desc), '[]'::jsonb)
    into salvos from public.doom_salvos s where s.faction_id = fid and s.status='in_flight';
  return jsonb_build_object('guns', guns, 'salvos', salvos,
    'const', jsonb_build_object(
      'build_gc', public._doom_const('build_gc'), 'build_matter', public._doom_const('build_matter'),
      'shot_grav', public._doom_const('shot_grav'), 'shot_wear', public._doom_const('shot_wear'),
      'decay_day', public._doom_const('decay_day'), 'decay_kept', public._doom_const('decay_kept'),
      'maint_matter', public._doom_const('maint_matter'), 'flight_days', public._doom_const('flight_days')));
end$$;
revoke all on function public.doom_status() from public;
grant execute on function public.doom_status() to authenticated;

-- ── 9) АДМИН: скип полёта снаряда (для тестов) ──────────────
create or replace function public.admin_test_speed_doom(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;
  update public.doom_salvos set ready_at = now() where faction_id = p_fid and status='in_flight';
  get diagnostics n = row_count;
  perform public._doom_resolve(p_fid);
  return jsonb_build_object('ok', true, 'landed', n);
end$$;
revoke all on function public.admin_test_speed_doom(text) from public;
grant execute on function public.admin_test_speed_doom(text) to authenticated;

-- ── 9б) АДМИН: ВЫДАТЬ ОРУДИЕ фракции (без исследования и затрат) ──
-- Ставит готовую «Длань Неотвратимости» сразу (не отложенным проектом) на
-- колонию фракции со свободной ячейкой. Триггер заведёт doom_guns (integrity 100).
-- Опционально открывает исследование pol.inevitability, чтобы UI был согласован.
create or replace function public.admin_grant_doomgun(p_fid text, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare col record; used int; bid uuid; picked record;
begin
  if public.current_user_role() not in ('superadmin','editor') then raise exception 'forbidden: staff only'; end if;

  if p_colony_id is not null then
    select * into picked from public.colonies where id = p_colony_id and faction_id = p_fid;
    if not found then raise exception 'colony not found for this faction'; end if;
  else
    -- первая колония со свободной ячейкой (по дате создания → обычно столица)
    for col in select c.* from public.colonies c where c.faction_id = p_fid order by c.created_at asc loop
      select count(*) into used from public.colony_buildings where colony_id = col.id;
      if used < coalesce(col.cells,6) then picked := col; exit; end if;
    end loop;
    if picked is null then raise exception 'no colony with a free cell for faction %', p_fid; end if;
  end if;

  insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode)
    values (picked.id, p_fid, picked.owner_id, 'doomgun', 1, false)
    returning id into bid;   -- триггер _doom_on_building создаст doom_guns

  -- чтобы кабинет видел технологию как открытую (постройка ещё и руками возможна)
  update public.faction_economy
    set research = case when coalesce(research,'[]'::jsonb) ? 'pol.inevitability'
                        then research else coalesce(research,'[]'::jsonb) || '"pol.inevitability"'::jsonb end
    where faction_id = p_fid;

  return jsonb_build_object('ok', true, 'colony', picked.planet_name, 'building_id', bid);
end$$;
revoke all on function public.admin_grant_doomgun(text,uuid) from public;
grant execute on function public.admin_grant_doomgun(text,uuid) to authenticated;

-- ── 10) ХУК В ТИК: пересоздаём _apply_colony_projects ───────
-- База — из _faith_multi.sql (АКТУАЛЬНАЯ версия: insert построек с faith_id для
-- храмов мультиверы). Добавлен ТОЛЬКО perform-вызов _doom_resolve в конце
-- (помечен «-- DOOM:»). Вызывается из economy_accrue каждый тик.
-- ⚠ Применять ПОСЛЕ _faith_multi.sql, иначе потеряете метку веры храмов.
create or replace function public._apply_colony_projects(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare pr record;
begin
  for pr in select * from public.colony_projects
            where faction_id = p_fid and ready_at <= now()
            order by ready_at asc
  loop
    if pr.kind = 'build' then
      insert into public.colony_buildings (colony_id, faction_id, owner_id, btype, slots_open, tnp_mode, faith_id)
        values (pr.colony_id, p_fid, pr.owner_id, pr.btype,
                coalesce((pr.payload->>'free_slots')::int, 1), false,
                nullif(pr.payload->>'faith_id','')::uuid);       -- МУЛЬТИ: метка веры храма
    elsif pr.kind = 'slot' then
      update public.colony_buildings set slots_open = least(6, slots_open + 1)
        where id = pr.building_id and faction_id = p_fid;
    elsif pr.kind = 'habitat' then
      update public.colonies set cells = cells + coalesce(pr.cells, 3), terraformed = true
        where id = pr.colony_id and faction_id = p_fid;
    elsif pr.kind = 'terraform' then
      if not exists (select 1 from public.colonies c
                     where c.faction_id = p_fid
                       and c.system_id is not distinct from pr.system_id
                       and (case when pr.planet_pid is not null
                                 then c.planet_pid = pr.planet_pid
                                 else c.planet_name = pr.planet_name end)) then
        insert into public.colonies (faction_id, owner_id, system_id, planet_name, planet_pid, planet_type, cells, terraformed, resources)
          values (p_fid, pr.owner_id, pr.system_id, pr.planet_name, pr.planet_pid, pr.planet_type,
                  coalesce(nullif(pr.cells, 0), 6), true, coalesce(pr.payload->'resources', '[]'::jsonb));
      end if;
    end if;
    delete from public.colony_projects where id = pr.id;
  end loop;

  -- DOOM: приземление залпов в полёте (пишет в map_systems/colonies — не в
  -- faction_economy.resources, поэтому затирание ресурсов в economy_accrue не
  -- касается). Содержание/деградация считаются лениво в _doom_settle.
  perform public._doom_resolve(p_fid);
end$$;
revoke all on function public._apply_colony_projects(text) from public;

-- ── ГОТОВО ──────────────────────────────────────────────────
-- Если ранее были постройки doomgun без записи в doom_guns (маловероятно),
-- бэкфиллим орудия для уже существующих построек.
insert into public.doom_guns (building_id, colony_id, faction_id, owner_id, system_id)
select cb.id, cb.colony_id, cb.faction_id, cb.owner_id, c.system_id
  from public.colony_buildings cb join public.colonies c on c.id = cb.colony_id
  where cb.btype = 'doomgun'
on conflict (building_id) do nothing;
