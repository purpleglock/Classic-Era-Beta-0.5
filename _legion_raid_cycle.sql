-- ════════════════════════════════════════════════════════════
-- 17.08 «они должны залутать 1 раз и уйти» + «в события сектора разве не надо
-- автооповещение?».
--
-- Было: ватага, взяв добычу, оставалась висеть над планетой и доила систему
-- раз в час — бесконечная осада без конца и края. И всё это шло ТОЛЬКО в
-- личную ленту державы: соседи по сектору о пиратском налёте не узнавали,
-- хотя такое не спрячешь.
--
-- Стало — цикл налёта с концом:
--   • прикрытия нет  → берут добычу с ходу и уходят в пустоту (флота на карте
--     не появляется: некому давать бой, нечего осаждать);
--   • прикрытие есть → встают флотом, дерутся; ПОБЕДИЛИ — забрали добычу и
--     ушли; проиграли — их выбили;
--   • каждое событие уходит и в сводки державы, и в ЛЕНТУ СЕКТОРА
--     (_legion_feed → _post_sector_news): налёт пиратов — новость для всех.
--
-- ЦЕПОЧКА: после _legion_loot_visible.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── 1) Уход ватаги: распускаем флот и закрываем контакт ───────────────
create or replace function public._legion_disband(p_contact uuid, p_why text)
returns void language plpgsql as $$
declare k public.legion_contacts;
begin
  select * into k from public.legion_contacts where id = p_contact;
  if k.id is null then return; end if;
  if k.fleet_id is not null then
    delete from public.battle_fleets where fleet_id = k.fleet_id;
    delete from public.fleets where id = k.fleet_id;
  end if;
  update public.legion_contacts
     set state = 'spent', fleet_id = null
   where id = p_contact;
end $$;

-- ── 2) Добыча = финал налёта, а не начало осады ───────────────────────
create or replace function public.legion_spoils_tick()
returns jsonb language plpgsql security definer as $$
declare k record; col public.colonies; op public.outposts;
        v_pop numeric; abduct numeric; frac numeric; nm text; cut int;
        won boolean; what text; n int := 0;
begin
  for k in select c.* from public.legion_contacts c
            join public.fleets f on f.id = c.fleet_id
           where c.state = 'engaged' and c.fleet_id is not null and c.kind <> 'levy'
             -- ватага даёт полчаса на то, чтобы ей помешали: успел привести флот —
             -- будет бой, не успел — забирают и уходят
             and c.arrive_at < now() - interval '30 minutes'
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

    frac := least(0.22, (case when k.reprisal then 0.07 else 0.04 end)
                        + coalesce(k.strength,0) / 800.0);
    what := null;

    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop  := coalesce(col.pop, coalesce(col.cells,0) * 50);
      abduct := least(1800, floor(v_pop * frac));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies set pop = greatest(1, v_pop - abduct) where id = col.id;
        update public.legion_contacts set looted = coalesce(looted,0) + abduct where id = k.id;
      end if;
      what := format('угнано около %s жителей колонии «%s»', abduct, coalesce(col.planet_name,'колония'));
    else
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
        order by public._outpost_crew_k(crew, mode) desc limit 1;
      if op.id is not null then
        cut := greatest(1, round(coalesce(op.crew,0) * 0.5)::int);
        update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;
        update public.legion_contacts set looted = coalesce(looted,0) + cut where id = k.id;
        what := format('с аванпоста уведено %s человек экипажа', cut);
      else
        update public.trade_routes
           set volume = greatest(0, coalesce(volume,0) * 0.8)
         where status = 'active'
           and (origin_sys = k.target_sys or dest_sys = k.target_sys)
           and (a_fid = k.target_fid or b_fid = k.target_fid);
        what := 'взято всё, что шло по трассам';
      end if;
    end if;

    perform public._legion_news(k.target_fid, '☠ Ватага ушла с добычей',
      format('%s В системе «%s» %s. Пираты снялись и растворились в пустоте — гнаться не за кем.',
        case when won then 'Флот прикрытия был разбит, и пираты хозяйничали без помех.'
             else 'Помешать ватаге было некому.' end, nm, what));
    -- ⚠ В ЛЕНТУ СЕКТОРА: налёт видят все соседи, а не только пострадавший
    perform public._legion_feed('☠ Налёт Железного Легиона',
      format('Ватага Легиона обчистила систему «%s»: %s. Пираты ушли в пустоту.', nm, what));

    perform public._legion_disband(k.id, 'spoils');
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'spoils', n);
end $$;

-- ── 3) Высадка: без прикрытия — налёт и сразу в пустоту ───────────────
create or replace function public.legion_engage_tick()
returns jsonb language plpgsql security definer as $$
declare k record; def int; comp jsonb; col public.colonies; op public.outposts;
        abduct numeric; v_pop numeric; cut int; fid_new uuid; frac numeric;
        nm text; what text;
        n_fight int := 0; n_plunder int := 0; n_blind int := 0; n_dud int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'landed' and fleet_id is null and kind <> 'levy'
            order by arrive_at loop

    nm := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                   k.target_sys);

    if k.kind = 'blind' then
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
          and mode in ('recon','depot')
        order by public._outpost_crew_k(crew, mode) desc limit 1;
      if op.id is null then
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;
      cut := greatest(1, round(coalesce(op.crew,0) * 0.6
                               / greatest(1, public._legion_sys_guard(k.target_sys)))::int);
      update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;
      perform public._legion_news(k.target_fid,
        case when coalesce(op.crew,0) - cut <= 0
             then 'Застава потеряна' else 'Налёт на заставу' end,
        format('Отряд Железного Легиона ударил по %s-аванпосту в системе «%s». Экипаж потерял %s человек%s',
          case op.mode when 'recon' then 'разведывательному' else 'заправочному' end,
          nm, cut,
          case when coalesce(op.crew,0) - cut <= 0
               then '. Станция брошена и будет свёрнута — сектор остался без глаз.'
               else '. Станция держится, но работает вполсилы.' end));
      perform public._legion_feed('☠ Налёт на аванпост',
        format('Пираты Легиона разорили заставу в системе «%s».', nm));
      update public.legion_contacts set state = 'spent' where id = k.id;
      n_blind := n_blind + 1;
      continue;
    end if;

    def := public._legion_defenders(k.target_sys);

    -- ── ЕСТЬ КОМУ ДАТЬ БОЙ: ватага встаёт флотом ──
    if def > 0 or k.reprisal then
      comp := public._legion_compose(k.strength);
      if jsonb_array_length(comp) = 0 then
        update public.legion_contacts set state = 'spent' where id = k.id;
        n_dud := n_dud + 1;
        continue;
      end if;
      insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
        values (public._legion_fid(),
                case when k.reprisal then 'Карательный отряд Легиона'
                     else 'Ватага Легиона' end,
                'idle', k.target_sys, k.target_sys, comp)
        returning id into fid_new;
      update public.legion_contacts
         set state = 'engaged', fleet_id = fid_new where id = k.id;

      perform public._legion_news(k.target_fid,
        case when k.reprisal then '☠ Карательный отряд встал в системе'
             else 'Пираты в системе' end,
        format('%s Железного Легиона вышел из пустоты в системе «%s» и встал там: %s корпусов%s Разбейте их — иначе заберут своё и уйдут.',
          case when k.reprisal then 'Карательный отряд' else 'Отряд' end, nm,
          (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(comp) c),
          case when def > 0 then ', ваши корабли уже под её орудиями.' else '.' end));
      perform public._legion_feed('☠ Пираты в системе',
        format('Ватага Железного Легиона встала в системе «%s». Завязывается бой.', nm));
      n_fight := n_fight + 1;
      continue;
    end if;

    -- ── ПРИКРЫТИЯ НЕТ: налёт и сразу в пустоту, без осады ──
    -- ⚠ Ватага НЕ встаёт флотом там, где ей никто не может помешать: стоять
    -- над беззащитной планетой месяцами — не пиратство, а оккупация.
    frac := least(0.14, (case when k.reprisal then 0.04 else 0.02 end)
                        + coalesce(k.strength,0) / 900.0);
    what := null;

    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop  := coalesce(col.pop, coalesce(col.cells,0) * 50);
      abduct := least(900, floor(v_pop * frac));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies set pop = greatest(1, v_pop - abduct) where id = col.id;
        update public.legion_contacts set looted = coalesce(looted,0) + abduct where id = k.id;
      end if;
      what := format('угнано около %s жителей колонии «%s»', abduct, coalesce(col.planet_name,'колония'));
      perform public._legion_news(k.target_fid, '☠ Налёт: угон населения',
        format('Пираты Железного Легиона вошли в систему «%s» — ни одного корабля прикрытия. %s. Взяв своё, ватага ушла в пустоту.',
               nm, initcap(what)));
    else
      update public.trade_routes
         set volume = greatest(0, coalesce(volume,0) * 0.75)
       where status = 'active'
         and (origin_sys = k.target_sys or dest_sys = k.target_sys)
         and (a_fid = k.target_fid or b_fid = k.target_fid);
      what := 'разграблены караваны';
      perform public._legion_news(k.target_fid, '☠ Караван разграблен',
        format('Ватага Легиона перехватила конвой у системы «%s» и ушла с грузом.', nm));
    end if;

    perform public._legion_feed('☠ Налёт Железного Легиона',
      format('Пираты обчистили систему «%s»: %s. Прикрытия у системы не было.', nm, what));

    update public.legion_contacts set state = 'spent' where id = k.id;
    n_plunder := n_plunder + 1;
  end loop;

  return jsonb_build_object('ok', true, 'fights', n_fight,
                            'plunder', n_plunder, 'blinded', n_blind, 'duds', n_dud);
end $$;

-- ── 4) Оповещение о вскрытом контакте — с ИМЕНЕМ системы ─────────────
create or replace function public.legion_contacts_notify()
returns jsonb language plpgsql security definer as $$
declare g record; n int := 0;
begin
  for g in select s.contact_id, s.faction_id, k.target_sys, k.kind, k.arrive_at,
                  (k.target_fid = s.faction_id) mine,
                  coalesce(ms.name, k.target_sys) nm
             from public.legion_sightings s
             join public.legion_contacts k on k.id = s.contact_id
             left join public.map_systems ms on ms.id = k.target_sys
            where s.grade = 'resolved' and not s.notified and k.state = 'inbound' loop
    perform public._legion_news(g.faction_id, 'Разведка: контакт вскрыт',
      format('Станция слежения вскрыла отряд Железного Легиона. Замысел — %s, цель — система «%s»%s. Подход около %s.',
        case g.kind when 'strike' then 'удар по колонии'
                    when 'blind'  then 'налёт на аванпост'
                    else 'разбой на трассе' end,
        g.nm,
        case when g.mine then ' (ваша)' else '' end,
        to_char(g.arrive_at, 'DD.MM HH24:MI')));
    update public.legion_sightings set notified = true
     where contact_id = g.contact_id and faction_id = g.faction_id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'notified', n);
end $$;
