-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 9: ЕГО ВИДНО ВСЕГДА
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_core.sql, перед _angel_lock.sql.
--
-- ЗАЧЕМ. fleets_visible показывает чужой флот только при разведке на
-- владельца или в зоне сенсорного покрытия. Ковчег под это правило
-- попадал наравне с курьером — и это тихо ломало сразу две вещи:
--   • на карте он «виден всегда» только на словах: карта рисует из этой
--     же RPC, а вне покрытия данных просто нет;
--   • в панели наведения МЗА его нельзя было ВЫБРАТЬ целью «Сполоха»
--     (список берётся оттуда же). То есть единственная дорога к его смерти
--     была закрыта не балансом, а технически.
--
-- Скрываться он всё равно не умеет: stealth = 0, войну объявляет фактом
-- прибытия, висит над чужой системой открыто. Состав его при этом
-- ОСТАЁТСЯ закрыт без разведки (intel/ships/composition идут по старому
-- правилу) — видно ЧТО оно есть и где, но не видно, что внутри.
--
-- Тело функции взято ИЗ БАЗЫ и изменено РОВНО ОДНОЙ строкой в предикате
-- seen — чтобы надмножество гарантированно совпадало с живой функцией во всём
-- остальном.
-- ════════════════════════════════════════════════════════════

create or replace function public.fleets_visible()
returns jsonb language plpgsql security definer set search_path=public as $FV$
declare viewer text;
begin
  viewer := public._ec_my_fid();
  perform public._fleet_settle(fl.faction_id) from (select distinct faction_id from public.fleets) fl;
  return (
    with cov as (select sid from public._fleet_coverage(viewer))
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',          f.id,
        'faction_id',  f.faction_id,
        'faction_name',public._fac_name(f.faction_id),
        'name',        case when f.faction_id = viewer then f.name else null end,
        'status',      f.status,
        'system_id',   f.system_id,
        'from_sys',    f.from_sys,
        'dest_sys',    f.dest_sys,
        'depart_at',   f.depart_at,
        'arrive_at',   f.arrive_at,
        'mine',        (f.faction_id = viewer),
        'stalled',     (f.stalled_until is not null and f.stalled_until > now()),
        'intel',       k.known,
        'ships',       case when k.known then (
                          select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                          from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)
                        else null end,
        'composition', case when k.known then f.composition else null end,
        -- ── своё: станция, база, бак, маршрут ──
        'is_station',  case when f.faction_id = viewer then coalesce(f.is_station,false) else null end,
        'home_sys',    case when f.faction_id = viewer then f.home_sys else null end,
        'can_recall',  case when f.faction_id = viewer then
                         (f.status='idle' and f.home_sys is not null
                          and f.system_id is distinct from f.home_sys
                          and not coalesce(f.is_station,false))
                       else null end,
        'fuel',        case when f.faction_id = viewer then f.fuel else null end,
        'fuel_cap',    case when f.faction_id = viewer then f.fuel_cap else null end,
        'can_refuel',  case when f.faction_id = viewer and f.system_id is not null
                         then public._fleet_can_refuel(f.faction_id, f.system_id) else null end,
        'route',       case when f.faction_id = viewer then f.route    else null end,
        'route_at',    case when f.faction_id = viewer then f.route_at else null end
      ) order by f.faction_id, f.id), '[]'::jsonb)
    from public.fleets f
    cross join lateral (select public._fleet_intel_known(viewer, f.faction_id) as known) k
    cross join lateral (select (
        f.faction_id = viewer
        -- ◈ КОВЧЕГ ВИДЕН ВСЕГДА И ВСЕМ. Он не прячется: stealth = 0,
        -- сам объявляет войну фактом прибытия и висит над чужой системой
        -- открыто. Гейт по разведке/покрытию ломал весь замысел сразу в двух
        -- местах: его не было видно на карте (карта рисует из этих же
        -- данных) и его нельзя было выбрать целью для «Сполоха» — то есть
        -- единственная дорога к его смерти была закрыта технически.
        or public._angel_is(f.faction_id)
        or k.known
        or (f.status = 'idle'  and f.system_id::text in (select sid from cov))
        or (f.status <> 'idle' and (f.from_sys::text in (select sid from cov)
                                 or f.dest_sys::text in (select sid from cov)))
      ) as seen) d
    where d.seen
  );
end$FV$;
revoke all on function public.fleets_visible() from public, anon;
grant execute on function public.fleets_visible() to authenticated;

-- ── РАЗОВАЯ ВЫДАЧА: РУКА АНГЕЛА ─────────────────
-- У ковчега сейчас НОЛЬ носителей, а без них половина его зубов мёртва:
-- _angel_hunter каждый тик упирается в «рука занята», то есть он не может
-- глушить чужие флоты вовсе. Сам он её отстроит (_angel_pacer), но только
-- накопив на баллистический завод и полцены носителя — это сутки простоя.
-- Даём одну руку и два «Сполоха», чтобы механика заработала сейчас.
-- Идемпотентно: если носитель уже есть — ничего не делаем.
do $$
declare af text; a record; f record; sys text; n int;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  select * into a from public.angel_state where faction_id = af;
  select * into f from public.fleets where id = a.fleet_id;
  sys := coalesce(f.system_id, f.dest_sys, f.from_sys, a.home_sys);
  if sys is null then return; end if;

  select count(*) into n from public.mza_ships where faction_id = af;
  if n = 0 then
    insert into public.mza_ships(faction_id, owner_id, name, status, system_id, integrity)
      values (af, (select owner_id from public.faction_economy where faction_id = af),
              'Рука первая', 'idle', sys, 100);
    raise notice 'Престол: выдан носитель в %', sys;
  end if;

  -- два «Сполоха» на склад, если пусто
  if coalesce((select qty from public.doom_shells
                where faction_id = af and kind = 'ball_hunter'), 0) < 1 then
    perform public._shell_add(af, 'ball_hunter', 2);
    raise notice 'Престол: выдано 2 «Сполоха»';
  end if;
end$$;

notify pgrst, 'reload schema';
