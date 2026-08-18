-- ============================================================
-- Х77 «СПОЛОХ» — БАЛЛИСТИКА ПО ФЛОТУ
-- Применять ПОСЛЕ _doom_shells.sql, _fleet_intel.sql/_fleet_visible_tank.sql.
-- Идемпотентно, катится повторно.
--
-- ЗАЧЕМ. Вся баллистика била по планетам: флот в пустоте был неуязвим для
-- стратегического оружия и трогался только боем. «Сполох» ведёт ТЕПЛОВУЮ
-- СИГНАТУРУ конкретного флота — уйти из системы нельзя, снаряд догоняет.
--
-- КАК ЭТО ЧИТАЕТСЯ ИГРОКОМ:
--   1) пуск — жертва сразу видит отметку и обратный отсчёт (сигнатура взята);
--   2) увести флот НЕЛЬЗЯ — цель ведётся, не координата;
--   3) единственный ответ — зенитный огонь самого флота: лёгкие скорострелки,
--      зенитные ракеты и свои орудия малого калибра с высоким темпом;
--   4) не сбили — вспышка, и часть кораблей просто перестаёт быть.
--
-- ПЕРЕХВАТ. Планетарная ПРО прикрывает планету, а не пустоту вокруг — снаряд
-- идёт с no_abm. Ожерелье Немезиды закрывает СИСТЕМУ целиком: если в момент
-- подлёта флот стоит под Ожерельем — залп снимут без единого выстрела.
-- ============================================================

-- ── 1) Паспорт тира: добавляем ball_hunter к _ball_params ──
create or replace function public._ball_params(p_kind text)
returns jsonb language sql immutable as $$
  select case p_kind
    when 'ball_light'   then jsonb_build_object('gc',20000,'grav',0,'fly_mul',0.5,
      'pmin',0.02,'pmax',0.06,'bmin',0,'bmax',1,'no_abm',false,'long_range',false)
    when 'ball_emp'     then jsonb_build_object('gc',60000,'grav',2,'fly_mul',1.0,
      'pmin',0.02,'pmax',0.05,'bmin',1,'bmax',1,'no_abm',true,'long_range',false)
    when 'ball_cluster' then jsonb_build_object('gc',90000,'grav',4,'fly_mul',1.0,
      'pmin',0.08,'pmax',0.16,'bmin',2,'bmax',4,'no_abm',false,'long_range',false)
    when 'ball_heavy'   then jsonb_build_object('gc',250000,'grav',1,'fly_mul',1.4,
      'pmin',0.12,'pmax',0.22,'bmin',5,'bmax',5,'no_abm',false,'long_range',true)
    -- Х77 «Сполох»: цель — флот. По планете не наводится вовсе, поэтому доли
    -- населения и построек нулевые: резолв уходит в свою ветку до них.
    when 'ball_hunter'  then jsonb_build_object('gc',120000,'grav',3,'fly_mul',0.8,
      'pmin',0,'pmax',0,'bmin',0,'bmax',0,'no_abm',true,'long_range',false,
      'anti_fleet',true,'kmin',0.15,'kmax',0.35)
    else null end
$$;

create or replace function public._shell_kind_ok(p_kind text)
returns boolean language sql immutable as $$
  select p_kind in ('doom','ball_light','ball_emp','ball_cluster','ball_heavy','ball_hunter')
$$;

alter table public.doom_shells drop constraint if exists doom_shells_kind_check;
alter table public.doom_shells add constraint doom_shells_kind_check
  check (kind in ('doom','ball_light','ball_emp','ball_cluster','ball_heavy','ball_hunter'));

-- цель-флот на залпе (у планетарных залпов остаётся null)
alter table public.doom_salvos add column if not exists target_fleet_id uuid;
alter table public.doom_salvos add column if not exists flak_p numeric;   -- шанс зениток на момент пуска

-- ── 2) Зенитный расчёт флота ──
-- Считаем СТВОЛЫ, а не корабли: зенитка — это лёгкая скорострелка, зенитная
-- ракета или своё орудие малого калибра с высоким темпом (Оружейная верфь).
-- Тяжёлый линкор без мелочи на борту прикрыться не может — и это правильно.
create or replace function public._unit_flak(p_unit uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(
    case
      when m->'w'->>'g' = 'Легкие'   then 1.0
      when m->'w'->>'g' = 'Ракетное' then 0.5
      when m->'w'->>'turretId' is not null then (
        select case when coalesce((t.stats->>'rof')::numeric,0) >= 6
                     and coalesce((t.stats->>'caliber')::numeric,9999) <= 100
                    then 1.0 else 0 end
          from public.faction_turrets t
         where t.id = (m->'w'->>'turretId')::uuid)
      else 0 end), 0)
  from public.faction_units u,
       lateral jsonb_array_elements(coalesce(u.data->'layout'->'mounts','[]'::jsonb)) m
  where u.id = p_unit
$$;

-- Зенитный расчёт флота = стволы по составу + 0.2 за каждый корабль: штатные
-- установки самообороны есть на любом корпусе, иначе флот без единой лёгкой
-- пушки ловил бы «Сполох» с гарантией и отвечать было бы нечем вообще.
create or replace function public._fleet_flak(p_fleet uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((
    select sum(greatest(0,(c->>'qty')::int) * (0.2 + public._unit_flak((c->>'unit_id')::uuid)))
      from public.fleets f, lateral jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c
     where f.id = p_fleet and (c->>'unit_id') ~ '^[0-9a-fA-F-]{36}$'), 0)
$$;

-- Шанс сбить: пологая кривая, чтобы 300 стволов не давали абсолютную защиту.
create or replace function public._fleet_flak_p(p_flak numeric)
returns numeric language sql immutable as $$
  select round(least(0.85, 1 - exp(-coalesce(p_flak,0) / 60.0))::numeric, 3)
$$;

-- Публичная справка для пульта: свой флот видит свой зенитный расчёт.
create or replace function public.fleet_flak(p_fleet uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; own text; fl numeric;
begin
  fid := public._ec_my_fid();
  select faction_id into own from public.fleets where id = p_fleet;
  if own is null then raise exception 'флот не найден'; end if;
  if own is distinct from fid then raise exception 'чужой флот'; end if;
  fl := public._fleet_flak(p_fleet);
  return jsonb_build_object('flak', fl, 'p', public._fleet_flak_p(fl));
end$$;
revoke all on function public.fleet_flak(uuid) from public;
grant execute on function public.fleet_flak(uuid) to authenticated;

-- ── 3) ПУСК ПО ФЛОТУ: mza_fire_fleet ──
-- Цель — не координата, а флот. Дальность меряем до системы, где сигнатуру
-- взяли (для флота в прыжке — до системы вылета): это точка захвата, дальше
-- снаряд ведёт цель сам.
create or replace function public.mza_fire_fleet(p_id uuid, p_fleet_id uuid,
                                                 p_kind text default 'ball_hunter')
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; f public.fleets; rdy timestamptz;
  fly_h numeric; fname text; vname text; newint numeric; hops int; max_hops int;
  bp jsonb; lock_sys text; flak numeric; fp numeric; nships int;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  bp := public._ball_params(p_kind);
  if not coalesce((bp->>'anti_fleet')::boolean,false) then
    raise exception 'этот снаряд по флоту не наводится';
  end if;

  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'MZA must be idle in a system to fire'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where mza_id = sh.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into f from public.fleets where id = p_fleet_id;
  if not found then raise exception 'флот не найден'; end if;
  if f.faction_id = fid then raise exception 'это ваш собственный флот'; end if;
  select coalesce(sum(greatest(0,(c->>'qty')::int)),0) into nships
    from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c;
  if nships <= 0 then raise exception 'флот пуст — стрелять не по чему'; end if;

  lock_sys := coalesce(f.system_id, f.from_sys, f.dest_sys);
  if lock_sys is null then raise exception 'сигнатура не читается: флот вне карты'; end if;

  max_hops := public._shell_const('mza_range_hops')::int;
  if lock_sys <> sh.system_id then
    hops := public._mza_hops(sh.system_id, lock_sys, max_hops);
    if hops is null then
      raise exception 'цель вне дальности: захват сигнатуры — % прыжков по гиперпутям', max_hops;
    end if;
  end if;

  perform public._shell_take(fid, p_kind);
  newint := greatest(0, sh.integrity - public._mza_const('shot_wear'));
  update public.mza_ships set integrity = newint, total_shots = total_shots + 1 where id = sh.id;

  flak := public._fleet_flak(f.id);
  fp   := public._fleet_flak_p(flak);
  fly_h := coalesce(public._mza_dist_hours(sh.system_id, lock_sys,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'))
         * coalesce((bp->>'fly_mul')::numeric, 1.0);
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;

  insert into public.doom_salvos
    (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id,
     target_pid, target_planet, target_fleet_id, flak_p, ready_at, kind)
  values
    (null, sh.id, fid, auth.uid(), sh.system_id, lock_sys,
     null, coalesce(f.name,'флот'), f.id, fp, rdy, p_kind);

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  vname := public._fac_name(f.faction_id);
  perform public._doom_news(
    '🔥 ТЕПЛОВАЯ СИГНАТУРА ВЗЯТА — ПУСК Х77 «СПОЛОХ»',
    'Гиперпейсер ('||coalesce(fname,'???')||') выпустил «Сполох» по флоту державы «'||
    coalesce(vname,'???')||'». Снаряд ведёт тепловую сигнатуру: уйти из системы бесполезно, '||
    'он идёт за целью. Подлёт ~'||to_char(fly_h,'FM990.0')||' ч. Остаётся зенитный огонь — или ничего.');

  return jsonb_build_object('ok', true, 'kind', p_kind, 'ready_at', rdy,
                            'target', coalesce(f.name,'флот'), 'flight_h', round(fly_h,1),
                            'flak_p', fp, 'integrity', newint);
end$$;
revoke all on function public.mza_fire_fleet(uuid,uuid,text) from public;
grant execute on function public.mza_fire_fleet(uuid,uuid,text) to authenticated;

-- ── 5) ЖЕРТВА: входящие «Сполохи» по моим флотам ──
-- Отдельная дверь: abm_incoming джойнит колонии по target_pid, а у залпа по
-- флоту цели-планеты нет вовсе. Уклониться нельзя — поэтому здесь не пульт
-- решений, а честное табло: сколько стволов, какой шанс, сколько осталось.
create or replace function public.fleet_incoming()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'salvo_id',  s.id,
      'kind',      s.kind,
      'fleet_id',  f.id,
      'fleet',     f.name,
      'system_id', f.system_id,
      'ready_at',  s.ready_at,
      'ships',     (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                      from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c),
      'flak',      public._fleet_flak(f.id),
      'flak_p',    public._fleet_flak_p(public._fleet_flak(f.id)),
      -- Ожерелье над системой, где флот стоит СЕЙЧАС, снимет залп само
      'nemesis',   (f.system_id is not null and exists(
                      select 1 from public.colony_buildings cb
                        join public.colonies c2 on c2.id = cb.colony_id
                       where cb.btype='nemesis' and c2.system_id = f.system_id))
    ) order by s.ready_at)
    from public.doom_salvos s
    join public.fleets f on f.id = s.target_fleet_id
   where s.status = 'in_flight' and f.faction_id = fid
  ), '[]'::jsonb);
end$$;
revoke all on function public.fleet_incoming() from public;
grant execute on function public.fleet_incoming() to authenticated;

notify pgrst, 'reload schema';
