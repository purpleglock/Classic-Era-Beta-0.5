-- 17.08 «че за сис нахуй?!» — карточка угрозы печатала СЫРОЙ id системы
-- (SYS_MRC2446B), потому что legion_contacts_visible отдавала g.last_sys
-- как есть. Игрок такого имени не видел нигде: на карте система подписана
-- по-человечески. Отдаём и имя (sys_name), id остаётся для наведения.
-- ЦЕПОЧКА: после _legion_contacts.sql. Идемпотентно.

create or replace function public.legion_contacts_visible()
returns jsonb language plpgsql security definer as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row order by row->>'eta' nulls last)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id',     g.contact_id,
        'grade',  g.grade,
        'sector', sec.name,
        'since',  g.first_seen,
        'seen',   g.last_seen,
        'sys',    case when public._legion_grade_rank(g.grade) >= 2 then g.last_sys end,
        -- ⚠ человеческое имя системы: в интерфейс идёт ОНО, id — только для наведения
        'sys_name', case when public._legion_grade_rank(g.grade) >= 2
                         then coalesce(ms.name, g.last_sys) end,
        'eta',    case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
        'band',   case when public._legion_grade_rank(g.grade) >= 2 then
                    case when k.strength >= 45 then 'крупная'
                         when k.strength >= 20 then 'заметная'
                         else 'слабая' end end,
        'target_sys', case when g.grade = 'resolved' then k.target_sys end,
        'target_name',case when g.grade = 'resolved' then coalesce(mt.name, k.target_sys) end,
        'mine',       case when g.grade = 'resolved' then (k.target_fid = fid) end,
        'kind',       case when g.grade = 'resolved' then k.kind end,
        'reprisal',   case when g.grade = 'resolved' and k.reprisal then true end,
        'ships',      case when g.grade = 'resolved'
                           then greatest(1, round(k.strength / 8.0))::int end
      )) as row
      from public.legion_sightings g
      join public.legion_contacts k on k.id = g.contact_id
      left join public.map_sectors  sec on sec.id = g.last_sector
      left join public.map_systems  ms  on ms.id  = g.last_sys
      left join public.map_systems  mt  on mt.id  = k.target_sys
      where g.faction_id = fid and k.state = 'inbound'
    ) q
  ), '[]'::jsonb);
end $$;
