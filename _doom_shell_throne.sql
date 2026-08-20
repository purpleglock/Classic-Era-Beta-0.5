-- ════════════════════════════════════════════════════════════
-- ДЛАНЬ СТРЕЛЯЕТ СНАРЯДАМИ + ПРЕСТОЛ ЗАКРЕПЛЁН В ШТАБЕ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _doom_shells.sql и _angel_shells.sql. Идемпотентно.
--
-- 1) «ПУСК → недостаточно средств». Штаб артиллерии сводит готовность залпа
--    по СНАРЯДАМ («снаряд Х67 · 3/1»), а doom_fire на сервере до сих пор
--    списывал 20 Гравиядра и склад снарядов не трогал вовсе. Как только
--    гравиядра кончались, взведённая цепь пуска валилась с «not enough
--    gravity cores», а клиент переводил это в «Недостаточно средств».
--    Гравиядро уже входит в цену снаряда (20 за штуку в Арсенале) — значит
--    платить дважды не за что: стационарная Длань берёт снаряд со склада,
--    ровно как Гиперпейсер (mza_fire) и залп по Престолу (doom_fire_angel).
--
-- 2) Престол закрепляется в штабе как ЦЕЛЬ. У ковчега нет planet_pid, поэтому
--    в реестр систем он не попадал: залп по нему был только у Длани
--    (doom_fire_angel, без интерфейса) и у Гиперпейсера одним-единственным
--    Х77 через mza_fire_fleet. Здесь: angel_target() — карточка отметки для
--    пульта, и mza_fire_angel() — залп Гиперпейсера по ковчегу ЛЮБЫМ снарядом
--    (баллистика давит парирование, Длань рвёт печати — см. _angel_shells).
-- ════════════════════════════════════════════════════════════

-- ── 1) ДЛАНЬ: ЗАЛП ТРАТИТ ПОСТРОЕННЫЙ СНАРЯД ────────────────
create or replace function public.doom_fire__raw(p_gun_id uuid, p_target_system_id text, p_target_pid integer)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare fid text; g public.doom_guns; tgt public.map_systems; pl jsonb; rdy timestamptz; fname text; ptname text;
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

  -- боекомплект: 1 построенный снаряд Длани со склада (Арсенал Судного Дня).
  -- Гравиядра тут больше не списываются — они уже уплачены за сам снаряд.
  perform public._shell_take(fid, 'doom');

  -- износ орудия от выстрела
  update public.doom_guns set integrity = greatest(0, integrity - public._doom_const('shot_wear')),
                              total_shots = total_shots + 1
    where id = g.id;

  -- время полёта = функция РАССТОЯНИЯ от орудия до цели.
  select * into org from public.map_systems where id = g.system_id;
  dist := sqrt(power(coalesce(tgt.x,0)-coalesce(org.x,0),2)
             + power(coalesce(tgt.y,0)-coalesce(org.y,0),2));
  select sqrt(power(max(x)-min(x),2) + power(max(y)-min(y),2))
    into map_diag from public.map_systems;
  frac := least(1.0, greatest(0.0, dist / nullif(map_diag,0)));
  fly_h := public._doom_const('flight_h_min')
         + frac * (public._doom_const('flight_h_max') - public._doom_const('flight_h_min'));
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;
  insert into public.doom_salvos
    (gun_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at, kind)
  values
    (g.id, fid, auth.uid(), g.system_id, p_target_system_id, p_target_pid, ptname, rdy, 'doom');

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  perform public._doom_news(
    '🜨 ЗАЛП ВЫПУЩЕН — ОТСЧЁТ ПОШЁЛ',
    'Длань Неотвратимости ('||coalesce(fname,'???')||') дала залп по системе «'||coalesce(tgt.name,'???')||
    '». Снаряд уже в пути к планете «'||ptname||'» — расчётное время полёта ~'||
    to_char(fly_h,'FM990.0')||' ч. Эвакуация бессмысленна — он придёт. И никто его не остановит.');

  return jsonb_build_object('ok', true, 'kind', 'doom', 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'dist', round(dist));
end$fn$;

-- ── 2) ОТМЕТКА ПРЕСТОЛА ДЛЯ ШТАБА ───────────────────────────
-- Только то, что нужно пульту, чтобы поставить ковчег в перекрестье: где он
-- сейчас (сигнатура читается всеми — прятаться державе-ангелу негде) и чей он.
-- Состояние печатей отсюда НЕ отдаём: это дело angel_status с его цензурой.
create or replace function public.angel_target()
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare a record; f record; me text; sysid text; sysname text;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return jsonb_build_object('ok', true, 'exists', false); end if;
  begin me := public._ec_my_fid_opt(); exception when others then me := null; end;
  select * into f from public.fleets where id = a.fleet_id;
  sysid := coalesce(f.system_id, f.from_sys, f.dest_sys, a.home_sys);
  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = sysid;
  return jsonb_build_object(
    'ok', true, 'exists', true,
    'fid', a.faction_id, 'name', public._fac_name(a.faction_id),
    'mine', (me is not null and me = a.faction_id),
    'fleet_id', a.fleet_id, 'system_id', sysid, 'system', sysname,
    'moving', (f.status = 'transit'), 'arrive_at', f.arrive_at,
    'stance', a.stance);
end$fn$;
revoke all on function public.angel_target() from public;
grant execute on function public.angel_target() to authenticated, anon;

-- ── 3) ГИПЕРПЕЙСЕР: ЗАЛП ПО ПРЕСТОЛУ ЛЮБЫМ СНАРЯДОМ ─────────
-- mza_fire_fleet берёт только Х77 (anti_fleet), а по ковчегу надо лить всё:
-- баллистика копит давление и гасит парирование, Х67 рвёт печати.
-- Наводка — по сигнатуре: система цели берётся на момент пуска, уйти нельзя.
create or replace function public.mza_fire_angel(p_id uuid, p_kind text default 'doom')
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare fid text; sh public.mza_ships; a record; f public.fleets; lock_sys text;
  bp jsonb; hops int; max_hops int; fly_h numeric; rdy timestamptz; newint numeric; fname text;
begin
  fid := public._ec_my_fid();
  perform public._fm_gate('strike', null, null);
  perform public._mza_settle(fid);
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  bp := public._ball_params(p_kind);   -- null для 'doom'

  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then raise exception 'Престола нет — стрелять не по чему'; end if;
  if a.faction_id = fid then raise exception 'это ваш собственный Престол'; end if;

  select * into sh from public.mza_ships where id = p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'MZA must be idle in a system to fire'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where mza_id = sh.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into f from public.fleets where id = a.fleet_id;
  if not found then raise exception 'сигнатура не читается: ковчега нет на карте'; end if;
  lock_sys := coalesce(f.system_id, f.from_sys, f.dest_sys);
  if lock_sys is null then raise exception 'сигнатура не читается: ковчег вне карты'; end if;

  max_hops := public._shell_const('mza_range_hops')::int
            * case when coalesce((bp->>'long_range')::boolean, false)
                   then public._shell_const('heavy_range_mul')::int else 1 end;
  if lock_sys <> sh.system_id then
    hops := public._mza_hops(sh.system_id, lock_sys, max_hops);
    if hops is null then
      raise exception 'target out of range: дальность залпа — % прыжков по гиперпутям', max_hops;
    end if;
  end if;

  perform public._shell_take(fid, p_kind);
  newint := greatest(0, sh.integrity - public._mza_const('shot_wear'));
  update public.mza_ships set integrity = newint, total_shots = total_shots + 1 where id = sh.id;

  fly_h := coalesce(public._mza_dist_hours(sh.system_id, lock_sys,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'))
         * coalesce((bp->>'fly_mul')::numeric, 1.0);
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;

  select name into fname from public.faction_applications
   where faction_id = fid and status='approved' order by updated_at desc limit 1;
  -- ⚠ СВОДКА ДО INSERT: на вставке залпа висит триггер Легиона со своей строкой.
  perform public._doom_news(public._angel_glitch('🜨 ЗАЛП ПО ОТМЕТКЕ', 0.20),
    public._angel_glitch(
      'Гиперпейсер ('||coalesce(fname,'???')||') дал залп. Подлёт ~'||
      to_char(fly_h,'FM990.0')||' ч.', 0.14)
    ||' '||public._angel_scream(11));

  insert into public.doom_salvos
    (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, target_fleet_id, ready_at, kind, victim_fid)
  values
    (null, sh.id, fid, auth.uid(), sh.system_id, lock_sys,
     null, 'Престол', f.id, rdy, p_kind, a.faction_id);

  return jsonb_build_object('ok', true, 'kind', p_kind, 'ready_at', rdy, 'target', 'Престол',
                            'flight_h', round(fly_h,1), 'lock_sys', lock_sys, 'integrity', newint);
end$fn$;
revoke all on function public.mza_fire_angel(uuid,text) from public;
grant execute on function public.mza_fire_angel(uuid,text) to authenticated;

notify pgrst, 'reload schema';
