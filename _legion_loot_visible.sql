-- ════════════════════════════════════════════════════════════
-- 17.08 «да чет нихуя». Добыча снялась (Терра: 1251 → 1147, сводка написана),
-- но на странице «Горячие точки» карточка выглядела ровно так же, как минуту
-- назад: «ВАТАГА В СИСТЕМЕ · СТОИТ». Игрок смотрит СЮДА — значит и результат
-- стоянки должен быть здесь, а не только в ленте сводок.
--
-- Копим на контакте счёт награбленного и отдаём его карточке вместе со сроком
-- следующего сбора: стоянка ватаги превращается в тикающий счётчик потерь.
-- ЦЕПОЧКА: после _legion_spoils.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

alter table public.legion_contacts add column if not exists looted numeric not null default 0;

-- ── добычу считаем там же, где берём ──
create or replace function public.legion_spoils_tick()
returns jsonb language plpgsql security definer as $$
declare k record; col public.colonies; op public.outposts;
        v_pop numeric; abduct numeric; frac numeric; nm text; cut int;
        won boolean; n int := 0;
begin
  for k in select c.* from public.legion_contacts c
            join public.fleets f on f.id = c.fleet_id
           where c.state = 'engaged' and c.fleet_id is not null and c.kind <> 'levy'
             and (c.pressed_at is null or c.pressed_at < now() - interval '1 hour')
             and not exists (select 1 from public.fleets f2
                              where f2.system_id = c.target_sys
                                and f2.faction_id is distinct from public._legion_fid()
                                and coalesce(jsonb_array_length(f2.composition),0) > 0)
             and not exists (select 1 from public.battles b
                              where b.system_id = c.target_sys
                                and b.status not in ('done','finished','ended','cancelled'))
  loop
    nm := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                   k.target_sys);
    won := exists (select 1 from public.battles b
                    where b.system_id = k.target_sys
                      and b.attacker_fid = public._legion_fid()
                      and b.status in ('done','finished','ended'));

    frac := least(0.20, (case when k.reprisal then 0.06 else 0.03 end)
                        + coalesce(k.strength,0) / 900.0);

    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop  := coalesce(col.pop, coalesce(col.cells,0) * 50);
      abduct := least(1500, floor(v_pop * frac));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies set pop = greatest(1, v_pop - abduct) where id = col.id;
        update public.legion_contacts set looted = coalesce(looted,0) + abduct where id = k.id;
      end if;
      perform public._legion_news(k.target_fid,
        case when won then '☠ Ватага собирает добычу' else '☠ Ватага взяла своё' end,
        format('%s Из колонии «%s» в системе «%s» угнано около %s жителей. Пока ватага стоит над планетой, она будет возвращаться за добычей — уйдёт только выбитая.',
          case when won then 'Прикрытия у системы не осталось: флот разбит, и пираты сошли к планете.'
               else 'Боя ватаге так и не дали, и она высадилась сама.' end,
          coalesce(col.planet_name,'колония'), nm, abduct));
      n := n + 1;
    else
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
        order by public._outpost_crew_k(crew, mode) desc limit 1;
      if op.id is not null then
        cut := greatest(1, round(coalesce(op.crew,0) * 0.5)::int);
        update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;
        update public.legion_contacts set looted = coalesce(looted,0) + cut where id = k.id;
        perform public._legion_news(k.target_fid, '☠ Заставу обирают',
          format('Ватага Легиона хозяйничает в системе «%s»: с аванпоста уведено %s человек экипажа.', nm, cut));
      else
        update public.trade_routes
           set volume = greatest(0, coalesce(volume,0) * 0.8)
         where status = 'active'
           and (origin_sys = k.target_sys or dest_sys = k.target_sys)
           and (a_fid = k.target_fid or b_fid = k.target_fid);
        perform public._legion_news(k.target_fid, '☠ Трассы под ножом',
          format('Ватага Легиона держит систему «%s» и обирает всё, что идёт мимо.', nm));
      end if;
      n := n + 1;
    end if;

    update public.legion_contacts set pressed_at = now() where id = k.id;
  end loop;
  return jsonb_build_object('ok', true, 'spoils', n);
end $$;

-- ── карточка угрозы показывает счёт стоянки ──
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
        'stood',  (k.state = 'engaged'),
        -- сколько эта ватага уже увела и когда придёт за следующей порцией:
        -- стоянка должна ЧИТАТЬСЯ как растущий счёт, а не как статичная плашка
        'looted',  case when k.state = 'engaged' and coalesce(k.looted,0) > 0
                        then round(k.looted)::bigint end,
        'next_at', case when k.state = 'engaged' and k.pressed_at is not null
                        then k.pressed_at + interval '1 hour' end,
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
             or (k.state = 'engaged' and k.target_fid = fid))
    ) q
  ), '[]'::jsonb);
end $$;

-- добычу, взятую этой ватагой до появления счётчика, не теряем
update public.legion_contacts set looted = 104
 where state = 'engaged' and coalesce(looted,0) = 0 and pressed_at is not null;
