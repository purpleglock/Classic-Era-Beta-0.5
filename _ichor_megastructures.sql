-- ════════════════════════════════════════════════════════════
-- ИХОР · ДВА МЕГАСООРУЖЕНИЯ НАСЛЕДИЯ ДАЛЛЕРИАНЦЕВ
--
-- Ихор не добывается. Его нельзя купить на бирже, выкопать экзотическим
-- экстрактором или отнять силой: он течёт только из вскрытых святилищ мира,
-- вошедшего в ЗАВЕТ (см. _precursor_bonds.sql). Поэтому всё, что из него
-- строится, — это не «постройка за деньги», а срок и репутация.
--
--   ⟁ ПОСТ ДРЕВНИХ СТРАЖЕЙ (guardian_posts)
--     Даллерианские дроны, поднятые из-под земли и посаженные на орбиту
--     системы. Работают не в бою, как обычные крылья, а НА ПРОЛЁТЕ: любой
--     чужой флот, чья трасса проходит через систему, встречает их — и почти
--     ничего от него не остаётся. Заряд тратится на каждый флот и копится
--     сутки; полный пост держит три.
--       2 500 000 ГС + 30 Ихор + 40 Стелларит. Один пост на систему.
--
--   ◈ ПОДПРОСТРАНСТВЕННАЯ БАТАРЕЯ (mza_ships.kind='subspace')
--     Разновидность Гиперпейсера на даллерианском приводе. Ходит по карте
--     втрое быстрее, снаряды идут вдвое быстрее, за один приказ выпускает
--     ДО 20 снарядов (обычному носителю нельзя больше одного в полёте), а
--     баллистика с неё идёт с подпространственным разгоном: ×1.75 к урону
--     и вдвое реже ловится планетарной ПРО.
--       4 000 000 ГС + 50 Ихор + 25 Гравиядро + 40 Программируемой материи.
--       Требует ту же технологию, что и Гиперпейсер: pol.hyperpacer.
--
-- Зависимости: _interstellar_artillery.sql, _mza.sql, _army_fleet.sql,
-- _precursor_bonds.sql (ихор). Идемпотентно.
-- ⚠ fleet_send переименован в _fleet_send_v1 — перекат _army_fleet.sql /
--   _fleet_ops.sql после этого файла снимет стражей с трассы.
-- ?v=20260728ichor1
-- ════════════════════════════════════════════════════════════

-- ── 0. КОНСТАНТЫ ──────────────────────────────────────────
create or replace function public._ichor_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'guard_gc'        then 2500000  -- ГС за пост стражей
    when 'guard_ichor'     then 30       -- ихора за пост
    when 'guard_stell'     then 40       -- Стелларита за пост
    when 'guard_charges'   then 3        -- зарядов в полном посту
    when 'guard_recharge_h' then 24      -- часов на восстановление одного заряда
    when 'guard_wipe_cap'  then 80       -- флот до стольки кораблей выносится целиком
    when 'guard_kill_frac' then 0.70     -- у больших флотов срезается эта доля
    when 'bat_gc'          then 4000000  -- ГС за подпространственную батарею
    when 'bat_ichor'       then 50       -- ихора за батарею
    when 'bat_grav'        then 25       -- Гравиядра за батарею
    when 'bat_matter'      then 40       -- Программируемой материи за батарею
    when 'bat_build_h'     then 30       -- постройка, часов
    when 'bat_volley'      then 20       -- снарядов за один приказ
    when 'bat_wear'        then 3        -- износ за снаряд (20 залпов ≈ полтора корпуса)
    when 'bat_fly_mul'     then 0.35     -- перелёт носителя: втрое быстрее
    when 'bat_salvo_mul'   then 0.50     -- подлёт снаряда: вдвое быстрее
    when 'bat_boost'       then 1.75     -- множитель урона баллистики
    else 0 end
$$;

-- Общий кассир: снять ГС и список ресурсов одной транзакцией.
create or replace function public._ichor_charge(p_fid text, p_gc numeric, p_res jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare eco public.faction_economy; res jsonb; k text; need numeric; have numeric;
begin
  select * into eco from public.faction_economy where faction_id = p_fid for update;
  if not found then raise exception 'no economy'; end if;
  res := coalesce(eco.resources, '{}'::jsonb);
  for k in select jsonb_object_keys(p_res) loop
    need := (p_res->>k)::numeric;
    have := coalesce((res->>k)::numeric, 0);
    if have < need then
      raise exception 'not enough %: нужно %, есть %', k, need, round(have, 2);
    end if;
    res := jsonb_set(res, array[k], to_jsonb(round(have - need, 3)), true);
  end loop;
  if coalesce(eco.gc, 0) < p_gc then raise exception 'not enough GC'; end if;
  update public.faction_economy set gc = gc - p_gc, resources = res
    where faction_id = p_fid and gc >= p_gc;
  if not found then raise exception 'not enough GC'; end if;
end$$;
revoke all on function public._ichor_charge(text, numeric, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════
--  ЧАСТЬ I · ПОСТ ДРЕВНИХ СТРАЖЕЙ
-- ════════════════════════════════════════════════════════════
create table if not exists public.guardian_posts (
  id           uuid primary key default gen_random_uuid(),
  system_id    text not null unique references public.map_systems(id) on delete cascade,
  faction_id   text not null,
  owner_id     uuid,
  charges      numeric not null default 3,
  last_charge  timestamptz not null default now(),
  kills        int not null default 0,
  strikes      int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists guardian_posts_fid_idx on public.guardian_posts(faction_id);
alter table public.guardian_posts enable row level security;
-- Пост виден всем: угроза, о которой не знают, не работает как угроза.
drop policy if exists "guard_sel" on public.guardian_posts;
create policy "guard_sel" on public.guardian_posts for select to public using (true);
revoke insert, update, delete on public.guardian_posts from public, anon, authenticated;

-- Заряды копятся сами: по одному в сутки до полного поста.
create or replace function public._guardian_recharge(p_id uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare g public.guardian_posts; v_h numeric; v_add numeric; v_max numeric;
begin
  select * into g from public.guardian_posts where id = p_id for update;
  if not found then return 0; end if;
  v_max := public._ichor_const('guard_charges');
  v_h   := extract(epoch from (now() - g.last_charge)) / 3600.0;
  v_add := floor(v_h / public._ichor_const('guard_recharge_h'));
  if v_add >= 1 and g.charges < v_max then
    update public.guardian_posts
       set charges = least(v_max, charges + v_add),
           last_charge = last_charge + (v_add * public._ichor_const('guard_recharge_h') || ' hours')::interval
     where id = g.id
     returning charges into v_max;
    return v_max;
  end if;
  return g.charges;
end$$;
revoke all on function public._guardian_recharge(uuid) from public, anon, authenticated;

create or replace function public.guardian_build(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_id uuid; v_sys text; v_nm text;
begin
  fid := public._ec_my_fid();
  if not exists (select 1 from public.colonies where faction_id = fid and system_id = p_system_id) then
    raise exception 'нужна своя колония в системе: стражей поднимают с земли, а не с орбиты';
  end if;
  if exists (select 1 from public.guardian_posts where system_id = p_system_id) then
    raise exception 'в этой системе уже стоит пост стражей';
  end if;
  perform public._ichor_charge(fid,
    public._ichor_const('guard_gc'),
    jsonb_build_object('Ихор',        public._ichor_const('guard_ichor'),
                       'Стелларит',   public._ichor_const('guard_stell')));

  insert into public.guardian_posts(system_id, faction_id, owner_id, charges, last_charge)
    values (p_system_id, fid, auth.uid(), public._ichor_const('guard_charges'), now())
    returning id into v_id;

  select name into v_sys from public.map_systems where id = p_system_id;
  select name into v_nm from public.faction_applications
    where faction_id = fid and status = 'approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '⟁ ПОДНЯТ ПОСТ ДРЕВНИХ СТРАЖЕЙ',
    coalesce(v_nm, 'Неизвестная держава') || ' подняла со дна системы «' || coalesce(v_sys, '???') ||
    '» то, что лежало там до всех нас. Даллерианские стражи снова на орбите и снова считают чужими всех, ' ||
    'кто проходит мимо. Прокладывайте трассы в обход.');
  return jsonb_build_object('ok', true, 'id', v_id,
    'gc', public._ichor_const('guard_gc'), 'ichor', public._ichor_const('guard_ichor'));
end$$;
revoke all on function public.guardian_build(text) from public, anon;
grant execute on function public.guardian_build(text) to authenticated;

-- Снос: половина ГС назад, ихор не возвращается (он ушёл в сплав).
create or replace function public.guardian_scrap(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g public.guardian_posts; back numeric;
begin
  fid := public._ec_my_fid();
  select * into g from public.guardian_posts where id = p_id;
  if not found then raise exception 'post not found'; end if;
  if g.faction_id is distinct from fid then raise exception 'not your post'; end if;
  back := round(public._ichor_const('guard_gc') * 0.5);
  update public.faction_economy set gc = gc + back where faction_id = fid;
  delete from public.guardian_posts where id = g.id;
  return jsonb_build_object('ok', true, 'refund', back);
end$$;
revoke all on function public.guardian_scrap(uuid) from public, anon;
grant execute on function public.guardian_scrap(uuid) to authenticated;

create or replace function public.guardian_posts_visible()
returns setof public.guardian_posts language sql stable security definer set search_path=public as $$
  select * from public.guardian_posts;
$$;
revoke all on function public.guardian_posts_visible() from public, anon;
grant execute on function public.guardian_posts_visible() to authenticated;

-- ── УДАР НА ПРОЛЁТЕ ───────────────────────────────────────
-- Стражи не участвуют в бою и не ждут объявления войны: для них чужой —
-- это чужой. Одна трасса — один заряд с поста.
create or replace function public._guardian_gauntlet(p_fleet uuid, p_path text[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare fl public.fleets; g record; total int; killed int; sum_k int := 0; hit int := 0;
        v_sys text; v_own text; v_vic text; wiped boolean := false;
begin
  select * into fl from public.fleets where id = p_fleet;
  if not found or p_path is null then return '{}'::jsonb; end if;

  for g in select * from public.guardian_posts
            where system_id = any(p_path)
              and faction_id is distinct from fl.faction_id
  loop
    perform public._guardian_recharge(g.id);
    select * into g from public.guardian_posts where id = g.id for update;
    if g.charges < 1 then continue; end if;

    select coalesce(sum(greatest(0, (c->>'qty')::int)), 0) into total
      from jsonb_array_elements(coalesce(fl.composition, '[]'::jsonb)) c;
    exit when total <= 0;

    if total <= public._ichor_const('guard_wipe_cap') then
      killed := public._fleet_kill_ships(fl.id, total);
      wiped  := true;
    else
      killed := public._fleet_kill_ships(fl.id,
                  ceil(total * public._ichor_const('guard_kill_frac'))::int);
    end if;
    sum_k := sum_k + killed; hit := hit + 1;

    update public.guardian_posts
       set charges = charges - 1, kills = kills + killed, strikes = strikes + 1,
           last_charge = case when charges >= public._ichor_const('guard_charges')
                              then now() else last_charge end
     where id = g.id;

    select name into v_sys from public.map_systems where id = g.system_id;
    select name into v_own from public.faction_applications
      where faction_id = g.faction_id and status = 'approved' order by updated_at desc limit 1;
    select name into v_vic from public.faction_applications
      where faction_id = fl.faction_id and status = 'approved' order by updated_at desc limit 1;
    perform public._doom_news(
      '⟁ СТРАЖИ ОТКРЫЛИ ОГОНЬ',
      'Флот державы «' || coalesce(v_vic, '???') || '» вошёл в систему «' || coalesce(v_sys, '???') ||
      '», где стоит пост древних стражей' || coalesce(' («' || v_own || '»)', '') || '. ' ||
      case when wiped
        then 'Из системы не вышло ничего: ' || killed || ' кораблей осталось там же, где их встретили.'
        else 'Уцелевшие ушли: ' || killed || ' кораблей сгорело за несколько минут.' end ||
      ' Даллерианцев не спрашивают, с кем они воюют.');

    exit when wiped;
    select * into fl from public.fleets where id = p_fleet;
    exit when not found;
  end loop;

  return jsonb_build_object('guardians', hit, 'lost', sum_k, 'wiped', wiped);
end$$;
revoke all on function public._guardian_gauntlet(uuid, text[]) from public, anon, authenticated;

-- Обёртка отправки флота: считаем трассу и проводим её через посты.
do $$
begin
  if to_regprocedure('public._fleet_send_v1(uuid,text)') is null then
    execute 'alter function public.fleet_send(uuid,text) rename to _fleet_send_v1';
    execute 'revoke all on function public._fleet_send_v1(uuid,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.fleet_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; fl public.fleets; res jsonb; v_from text; v_path text[]; g jsonb;
begin
  fid := public._ec_my_fid();
  select * into fl from public.fleets where id = p_id;
  v_from := fl.system_id;
  res := public._fleet_send_v1(p_id, p_dest_sys);

  -- Трасса считается ПОСЛЕ успешной отправки: если приказ отклонён, стражей нет.
  begin
    v_path := public._fleet_path(v_from, p_dest_sys, fid, true);
    if v_path is not null and array_length(v_path, 1) > 1 then
      -- система вылета своя, её не считаем
      v_path := v_path[2:array_length(v_path, 1)];
      g := public._guardian_gauntlet(p_id, v_path);
      if coalesce((g->>'lost')::int, 0) > 0 then res := res || g; end if;
    end if;
  exception when others then null;   -- сломанные стражи не должны запирать флот
  end;
  return res;
end$$;
revoke all on function public.fleet_send(uuid, text) from public, anon;
grant execute on function public.fleet_send(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════
--  ЧАСТЬ II · ПОДПРОСТРАНСТВЕННАЯ БАТАРЕЯ
-- ════════════════════════════════════════════════════════════
alter table public.mza_ships  add column if not exists kind text not null default 'mza';
alter table public.doom_salvos add column if not exists boost numeric not null default 1.0;

-- Разгон снаряда, выпущенного батареей: множитель урона для баллистического
-- резолвера и половинная эффективность планетарной ПРО против него.
create or replace function public._ball_boost(p_salvo uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select boost from public.doom_salvos where id = p_salvo), 1.0);
$$;

create or replace function public.subspace_build(p_system_id text, p_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; v_id uuid; ready timestamptz; v_sys text; v_nm text;
begin
  fid := public._ec_my_fid();
  select * into eco from public.faction_economy where faction_id = fid;
  if not found then raise exception 'no economy'; end if;
  if not (coalesce(eco.research, '[]'::jsonb) ? 'pol.hyperpacer') then
    raise exception 'research required: pol.hyperpacer';
  end if;
  if not exists (select 1 from public.colonies where faction_id = fid and system_id = p_system_id) then
    raise exception 'батарею закладывают только в системе своей колонии';
  end if;

  perform public._ichor_charge(fid, public._ichor_const('bat_gc'),
    jsonb_build_object('Ихор',                      public._ichor_const('bat_ichor'),
                       'Гравиядро',                 public._ichor_const('bat_grav'),
                       'Программируемая материя',   public._ichor_const('bat_matter')));

  ready := now() + (public._ichor_const('bat_build_h') || ' hours')::interval;
  insert into public.mza_ships(faction_id, owner_id, name, status, system_id, depart_at, arrive_at, kind)
    values (fid, auth.uid(), nullif(trim(coalesce(p_name, '')), ''), 'building', p_system_id, now(), ready, 'subspace')
    returning id into v_id;

  select name into v_sys from public.map_systems where id = p_system_id;
  select name into v_nm from public.faction_applications
    where faction_id = fid and status = 'approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '◈ ЗАЛОЖЕНА ПОДПРОСТРАНСТВЕННАЯ БАТАРЕЯ',
    coalesce(v_nm, 'Неизвестная держава') || ' строит в системе «' || coalesce(v_sys, '???') ||
    '» носитель на даллерианском приводе. Он ходит там, где нет трасс, и выпускает двадцать снарядов там, ' ||
    'где остальные успевают выпустить один. Считайте, что расстояний больше нет.');
  return jsonb_build_object('ok', true, 'id', v_id, 'ready_at', ready);
end$$;
revoke all on function public.subspace_build(text, text) from public, anon;
grant execute on function public.subspace_build(text, text) to authenticated;

-- Перелёт носителя: батарея ходит втрое быстрее обычного Гиперпейсера.
do $$
begin
  if to_regprocedure('public._mza_send_v1(uuid,text)') is null
     and to_regprocedure('public.mza_send(uuid,text)') is not null then
    execute 'alter function public.mza_send(uuid,text) rename to _mza_send_v1';
    execute 'revoke all on function public._mza_send_v1(uuid,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.mza_send(p_id uuid, p_dest_sys text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb; v_kind text; v_dep timestamptz; v_arr timestamptz; v_h numeric;
begin
  res := public._mza_send_v1(p_id, p_dest_sys);
  select kind, depart_at, arrive_at into v_kind, v_dep, v_arr from public.mza_ships where id = p_id;
  if v_kind = 'subspace' and v_dep is not null and v_arr is not null then
    v_h := extract(epoch from (v_arr - v_dep)) / 3600.0 * public._ichor_const('bat_fly_mul');
    v_arr := v_dep + (round(v_h * 60)::int || ' minutes')::interval;
    update public.mza_ships set arrive_at = v_arr where id = p_id;
    res := res || jsonb_build_object('fly_h', round(v_h, 1), 'arrive_at', v_arr, 'subspace', true);
  end if;
  return res;
end$$;
revoke all on function public.mza_send(uuid, text) from public, anon;
grant execute on function public.mza_send(uuid, text) to authenticated;

-- ЗАЛП БАТАРЕИ: до 20 снарядов одним приказом.
-- Обычному носителю нельзя иметь больше одного снаряда в полёте — mza_fire
-- это проверяет. Батарея снимает ограничение тем, что каждый снаряд ставится
-- в doom_salvos напрямую, минуя проверку, но по тем же правилам: боекомплект
-- тратится, износ капает, дальность считается прыжками.
create or replace function public.subspace_volley(
  p_id uuid, p_target_system_id text, p_target_pid int,
  p_kind text default 'ball_cluster', p_count int default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; tgt public.map_systems; pl jsonb; bp jsonb;
        n int; i int; fly_h numeric; rdy timestamptz; ptname text; hops int; max_hops int;
        v_wear numeric; v_nm text; fired int := 0;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  bp := public._ball_params(p_kind);

  select * into sh from public.mza_ships where id = p_id;
  if not found then raise exception 'battery not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your battery'; end if;
  if sh.kind is distinct from 'subspace' then raise exception 'это обычный Гиперпейсер: залп по одному'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'battery must be idle in a system'; end if;
  if sh.integrity <= 0 then raise exception 'battery is wrecked'; end if;

  n := greatest(1, least(public._ichor_const('bat_volley')::int, coalesce(p_count, 20)));

  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;

  max_hops := public._shell_const('mza_range_hops')::int
            * case when coalesce((bp->>'long_range')::boolean, false)
                   then public._shell_const('heavy_range_mul')::int else 1 end;
  if p_target_system_id <> sh.system_id then
    hops := public._mza_hops(sh.system_id, p_target_system_id, max_hops);
    if hops is null then
      raise exception 'target out of range: дальность залпа — % прыжков', max_hops;
    end if;
  end if;

  if p_target_pid is not null then
    select value into pl from jsonb_array_elements(coalesce(tgt.planets, '[]'::jsonb))
      where (value->>'pid')::int = p_target_pid limit 1;
  end if;
  if pl is null then raise exception 'target planet not found'; end if;
  if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
  ptname := coalesce(pl->>'name', 'планета');

  fly_h := coalesce(public._mza_dist_hours(sh.system_id, p_target_system_id,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'))
         * coalesce((bp->>'fly_mul')::numeric, 1.0)
         * public._ichor_const('bat_salvo_mul');
  rdy := now() + (round(fly_h * 60)::int || ' minutes')::interval;

  for i in 1 .. n loop
    begin
      perform public._shell_take(fid, p_kind);   -- нет снаряда на складе — залп короче
    exception when others then exit;
    end;
    insert into public.doom_salvos
      (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id,
       target_pid, target_planet, ready_at, kind, boost)
    values
      (null, sh.id, fid, auth.uid(), sh.system_id, p_target_system_id,
       p_target_pid, ptname, rdy + (i || ' seconds')::interval, p_kind,
       public._ichor_const('bat_boost'));
    fired := fired + 1;
  end loop;

  if fired = 0 then raise exception 'нет снарядов «%» на складе', p_kind; end if;

  v_wear := public._ichor_const('bat_wear') * fired;
  update public.mza_ships
     set integrity = greatest(0, integrity - v_wear), total_shots = total_shots + fired
   where id = sh.id;

  select name into v_nm from public.faction_applications
    where faction_id = fid and status = 'approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '◈ ПОДПРОСТРАНСТВЕННЫЙ ЗАЛП: ' || fired || ' СНАРЯДОВ',
    'Батарея державы «' || coalesce(v_nm, '???') || '» выпустила ' || fired ||
    ' снарядов подряд по планете «' || ptname || '» в системе «' || coalesce(tgt.name, '???') ||
    '». Подлёт ~' || to_char(fly_h, 'FM990.0') || ' ч. Они вышли из подпространства уже над целью — ' ||
    'заметить их можно было только по тому, что стало тихо.');

  return jsonb_build_object('ok', true, 'fired', fired, 'kind', p_kind,
    'ready_at', rdy, 'target', ptname, 'flight_h', round(fly_h, 1),
    'integrity', greatest(0, sh.integrity - v_wear), 'boost', public._ichor_const('bat_boost'));
end$$;
revoke all on function public.subspace_volley(uuid, text, int, text, int) from public, anon;
grant execute on function public.subspace_volley(uuid, text, int, text, int) to authenticated;

-- ── Витрина носителей: + kind, и для батареи «залп в полёте» не запирает пульт ──
-- Зеркало _mza.sql; добавлено поле kind и снято условие «один снаряд в полёте»
-- для батарей: двадцать одновременных снарядов — их единственный смысл.
create or replace function public.mza_ships_mine()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sh.id, 'name', sh.name, 'status', sh.status, 'kind', coalesce(sh.kind, 'mza'),
      'system_id', sh.system_id, 'from_sys', sh.from_sys, 'dest_sys', sh.dest_sys,
      'depart_at', sh.depart_at, 'arrive_at', sh.arrive_at,
      'integrity', sh.integrity, 'total_shots', sh.total_shots,
      'in_flight', exists(select 1 from public.doom_salvos s where s.mza_id = sh.id and s.status = 'in_flight'),
      'can_fire', (sh.status = 'idle' and sh.system_id is not null and sh.integrity > 0
        and (coalesce(sh.kind, 'mza') = 'subspace'
             or not exists(select 1 from public.doom_salvos s where s.mza_id = sh.id and s.status = 'in_flight')))
    ) order by sh.created_at asc)
    from public.mza_ships sh where sh.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.mza_ships_mine() from public, anon;
grant execute on function public.mza_ships_mine() to authenticated;
