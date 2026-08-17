-- ════════════════════════════════════════════════════════════
-- 17.08 «У МЕНЯ ТАМ СТОИТ ФЛОТ, АЛЛО» — ватага Легиона встала в «Великом троне»
-- прямо над боевым флотом державы, и НИЧЕГО не произошло: боя нет, а карточка
-- угрозы вдобавок пропала с «Горячих точек».
--
-- Две дыры, обе на стыке слоёв:
--  1) legion_engage_tick материализовал флот и на этом заканчивал. Бой завязывал
--     только «press_tick» через patience_h часов — и то не бой, а высадку. То
--     есть пираты вышли из пустоты, встали борт к борту с флотом игрока и
--     мирно ждали. Для игрока это ровно «бот сломан».
--  2) legion_contacts_visible показывала только state='inbound'. Стоило ватаге
--     МАТЕРИАЛИЗОВАТЬСЯ (state='engaged') — карточка исчезала. Самый острый
--     момент угрозы пропадал с экрана именно тогда, когда он наступил.
--
-- ЦЕПОЧКА: после _legion_news_names.sql и _legion_sys_name.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── 1) Ватага, вставшая над чужим флотом, ЛЕЗЕТ В ДРАКУ ───────────────
-- Отдельным проходом, а не только в момент материализации: флот игрока может
-- прийти в систему позже — тогда бой должен завязаться в этот же тик.
create or replace function public.legion_standoff_tick()
returns jsonb language plpgsql security definer as $$
declare k record; foe record; b uuid; nm text; n int := 0;
begin
  for k in select c.*, f.id fid_fleet
             from public.legion_contacts c
             join public.fleets f on f.id = c.fleet_id
            where c.state = 'engaged' and c.fleet_id is not null loop

    -- уже дерутся в этой системе — второй бой не заводим
    if exists (select 1 from public.battles b2
                where b2.system_id = k.target_sys
                  and b2.status not in ('done','finished','ended','cancelled')) then
      continue;
    end if;

    -- боевой флот любой ДРУГОЙ державы в этой же системе: пираты не разбирают,
    -- чей он — встали над системой, значит будет бой
    select f.* into foe from public.fleets f
     where f.system_id = k.target_sys
       and f.faction_id is distinct from public._legion_fid()
       and f.status = 'idle'
       and coalesce(jsonb_array_length(f.composition),0) > 0
     order by (select coalesce(sum((c->>'qty')::int),0)
                 from jsonb_array_elements(f.composition) c) desc
     limit 1;
    if foe.id is null then continue; end if;

    b := public._war_engage(k.fleet_id, foe.id, k.target_sys, 'meeting');
    if b is null then continue; end if;

    nm := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                   k.target_sys);
    perform public._legion_news(foe.faction_id, '⚔ Бой с ватагой Легиона',
      format('Ватага Железного Легиона в системе «%s» не стала ждать: пираты навязали бой вашему флоту. Сражение началось — доска боя в разделе «Горячие точки».', nm));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'battles', n);
end $$;

grant execute on function public.legion_standoff_tick() to authenticated;

-- ── 2) Вставшая ватага остаётся В СПИСКЕ УГРОЗ ────────────────────────
-- Раньше карточка жила только пока контакт летел. Теперь состояние — часть
-- карточки: летит → на месте → СТОИТ (и вот тогда она и опаснее всего).
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
        -- вставшая ватага видна всем, у кого есть глаза в системе: её уже не
        -- надо «вскрывать» — она висит над планетой
        'stood',  (k.state = 'engaged'),
        'sys',    case when public._legion_grade_rank(g.grade) >= 2 or k.state = 'engaged'
                       then coalesce(k.target_sys, g.last_sys) end,
        'sys_name', case when public._legion_grade_rank(g.grade) >= 2 or k.state = 'engaged'
                         then coalesce(mt.name, ms.name, g.last_sys) end,
        'eta',    case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
        'band',   case when public._legion_grade_rank(g.grade) >= 2 then
                    case when k.strength >= 45 then 'крупная'
                         when k.strength >= 20 then 'заметная'
                         else 'слабая' end end,
        'target_sys', case when g.grade = 'resolved' or k.state = 'engaged' then k.target_sys end,
        'target_name',case when g.grade = 'resolved' or k.state = 'engaged'
                           then coalesce(mt.name, k.target_sys) end,
        'mine',       case when g.grade = 'resolved' or k.state = 'engaged'
                           then (k.target_fid = fid) end,
        'kind',       case when g.grade = 'resolved' or k.state = 'engaged' then k.kind end,
        'reprisal',   case when (g.grade = 'resolved' or k.state = 'engaged') and k.reprisal then true end,
        'ships',      case when g.grade = 'resolved' or k.state = 'engaged'
                           then greatest(1, round(k.strength / 8.0))::int end
      )) as row
      from public.legion_sightings g
      join public.legion_contacts k on k.id = g.contact_id
      left join public.map_sectors  sec on sec.id = g.last_sector
      left join public.map_systems  ms  on ms.id  = g.last_sys
      left join public.map_systems  mt  on mt.id  = k.target_sys
      where g.faction_id = fid
        and (k.state = 'inbound'
             -- вставшую ватагу показываем ТОЛЬКО тем, к кому она пришла:
             -- чужая драка в чужой системе в список угроз державы не лезет
             or (k.state = 'engaged' and k.target_fid = fid))
    ) q
  ), '[]'::jsonb);
end $$;
