-- 18.08 Театр Легиона: отдаём клиенту границу крысиных троп (road_from).
-- Тело функции взято из базы и дополнено одним полем — см. tools/_theatre_patch.js.
-- ЦЕПОЧКА: после _legion_theatre.sql и _legion_intercept.sql. Идемпотентно.

create or replace function public.legion_theatre()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare fid text; hull text; res jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'reason', 'no_faction'); end if;
  hull := public._legion_meta()->>'hull_fid';

  res := jsonb_build_object(
    'ok', true,
    'now', now(),

    -- ── ГНЕВ: чем держава сама навлекла на себя Легион ────────────
    -- Это своя, честно известная величина: игрок сам стрелял и грабил.
    'wrath', (
      select jsonb_build_object(
               'aggro',  round(coalesce(a.aggro,0), 1),
               'reason', a.last_reason,
               'at',     a.last_provoke,
               -- ступень для подписи: чем выше, тем скорее придёт карательный
               'band',   case when coalesce(a.aggro,0) >= 60 then 'кровная месть'
                              when coalesce(a.aggro,0) >= 25 then 'вас метят'
                              when coalesce(a.aggro,0) >= 8  then 'вас заметили'
                              else 'тихо' end)
        from public.legion_aggro a where a.faction_id = fid),

    -- ── ОБИДЫ: где именно держава наступила Легиону на хвост ──────
    -- Точки на карте, за которые он собирается мстить (свои же действия).
    'grudges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sys', g.sys, 'sys_name', coalesce(ms.name, g.sys),
               'kind', g.kind, 'reason', g.reason,
               'weight', round(g.weight, 1), 'at', g.at,
               'answered', (g.answered_at is not null)))
        from public.legion_grudges g
        left join public.map_systems ms on ms.id = g.sys
       where g.faction_id = fid and g.sys is not null
         and g.at > now() - interval '14 days'), '[]'::jsonb),

    -- ── НАПРЯЖЁННОСТЬ СЕКТОРОВ ───────────────────────────────────
    -- Копилка сектора в долях от цены удара: 1.0 = вот-вот выйдет ватага.
    -- Только там, где у державы есть глаза и уши (та же планка, что у ghost),
    -- иначе игрок читал бы внутреннюю кухню бота по всей галактике.
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sec.id, 'name', sec.name,
               'heat', least(1.0, round(lp.pressure
                        / nullif(public._legion_const('cost_strike'),0), 2)),
               'systems', sec.system_ids))
        from public.legion_pressure lp
        join public.map_sectors sec on sec.id = lp.sector_id
       where exists (select 1 from public.colonies c
                      where c.faction_id = fid and c.system_id = any(sec.system_ids))
          or exists (select 1 from public.outposts o
                      where o.faction_id = fid and o.system_id = any(sec.system_ids))),
      '[]'::jsonb),

    -- ── ИДУЩИЕ ВАТАГИ: ход и манёвр ──────────────────────────────
    -- route отдаём ТОЛЬКО по resolved: это и есть награда за разведзаставу.
    'moves', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', g.contact_id, 'grade', g.grade,
               'sector', sec.name, 'sector_id', g.last_sector,
               'sys',      case when public._legion_grade_rank(g.grade) >= 2 then g.last_sys end,
               'sys_name', case when public._legion_grade_rank(g.grade) >= 2
                                then coalesce(ml.name, g.last_sys) end,
               'eta',      case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
               'band',     case when public._legion_grade_rank(g.grade) >= 2 then
                             case when k.strength >= 45 then 'крупная'
                                  when k.strength >= 20 then 'заметная'
                                  else 'слабая' end end,
               'kind',        case when g.grade = 'resolved' then k.kind end,
               'reprisal',    case when g.grade = 'resolved' and k.reprisal then true end,
               'ships',       case when g.grade = 'resolved'
                                   then greatest(1, round(k.strength / 8.0))::int end,
               'mine',        case when g.grade = 'resolved' then (k.target_fid = fid) end,
               'target_sys',  case when g.grade = 'resolved' then k.target_sys end,
               'target_name', case when g.grade = 'resolved' then coalesce(mt.name, k.target_sys) end,
               'from_sys',    case when g.grade = 'resolved' then k.origin_sys end,
               -- весь путь по трассам + расписание узлов: клиент сам поставит
               -- метку на нужный отрезок и покажет, где ватага будет через час
               'route',       case when g.grade = 'resolved' then k.route end,
               'route_at',    case when g.grade = 'resolved' then k.route_at end,
               -- ── КРЫСИНЫЕ ТРОПЫ (_legion_intercept.sql) ──
               -- Индекс первого узла, на котором ватагу вообще можно встретить.
               -- Всё, что до него, — тропа: карта обязана рисовать её иначе,
               -- иначе игрок будет караулить участки, где ловить некого.
               'road_from',   case when g.grade = 'resolved' and k.route is not null
                                        and jsonb_array_length(k.route) >= 3
                                   then public._legion_road_lo(jsonb_array_length(k.route)) end,
               -- по signature известен только текущий отрезок: узел и следующий
               'leg',         case when g.grade = 'signature'
                                   then public.legion_contact_position(k.id) end,
               'stood',       (k.state = 'engaged'))))
        from public.legion_sightings g
        join public.legion_contacts k on k.id = g.contact_id
        left join public.map_sectors sec on sec.id = g.last_sector
        left join public.map_systems ml on ml.id = g.last_sys
        left join public.map_systems mt on mt.id = k.target_sys
       where g.faction_id = fid and k.state in ('inbound','landed','engaged')), '[]'::jsonb),

    -- ── ВСТАВШИЕ ВАТАГИ: то, что уже висит над системой ───────────
    -- Флот Легиона виден по обычным сенсорам державы, как любой чужой флот.
    'bands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'sys', f.system_id,
               'sys_name', coalesce(ms.name, f.system_id),
               'name', f.name,
               'ships', (select coalesce(sum((c->>'qty')::int),0)
                           from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)))
        from public.fleets f
        left join public.map_systems ms on ms.id = f.system_id
       where f.faction_id = public._legion_fid()
         and f.system_id is not null
         and f.system_id in (select sid from public._fleet_coverage(fid))), '[]'::jsonb),

    -- ── ЛОГОВА ───────────────────────────────────────────────────
    -- Гнёзда Легиона — не секрет: это его колонии, они и так на карте.
    'lairs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sys', c.system_id, 'sys_name', coalesce(ms.name, c.system_id),
               'name', c.planet_name))
        from public.colonies c
        left join public.map_systems ms on ms.id = c.system_id
       where hull is not null and c.faction_id = hull), '[]'::jsonb)
  );

  return res;
end $function$
;
