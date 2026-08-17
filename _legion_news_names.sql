-- 17.08 продолжение «че за сис нахуй?!»: сырой id системы лез не только в
-- карточку угрозы, но и в САМИ СВОДКИ Легиона — «вошли в систему sys_mrc2446b».
-- Имя системы считаем один раз на контакт и подставляем всюду.
-- ЦЕПОЧКА: после _legion_teeth.sql. Идемпотентно, логика не тронута.

create or replace function public.legion_engage_tick()
returns jsonb language plpgsql security definer as $$
declare k record; def int; comp jsonb; col public.colonies; op public.outposts;
        abduct numeric; v_pop numeric; cut int; fid_new uuid; frac numeric;
        hits int; nm text;
        n_fight int := 0; n_plunder int := 0; n_blind int := 0; n_dud int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'landed' and fleet_id is null and kind <> 'levy'
            order by arrive_at loop

    -- ⚠ в сводки идёт ИМЯ системы, не её id: игрок нигде не видит sys_*
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

      update public.legion_contacts set state = 'spent' where id = k.id;
      n_blind := n_blind + 1;
      continue;
    end if;

    def := public._legion_defenders(k.target_sys);
    if def > 0 or k.reprisal
       or coalesce(k.strength,0) >= public._legion_const('stand_from') then
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
        format('%s Железного Легиона вышел из пустоты в системе «%s» и встал там: %s корпусов. Ватага не уйдёт сама — её придётся выбивать, иначе через несколько часов она возьмёт своё%s',
          case when k.reprisal then 'Карательный отряд' else 'Отряд' end,
          nm,
          (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(comp) c),
          case when def > 0 then ', а ваши корабли уже под её орудиями.' else '.' end));
      n_fight := n_fight + 1;
      continue;
    end if;

    frac := least(0.10, 0.02 + coalesce(k.strength,0) / 800.0);
    hits := least(3, 1 + floor(coalesce(k.strength,0) / 40.0)::int);

    select * into col from public.colonies
      where system_id = k.target_sys and faction_id = k.target_fid
      order by coalesce(pop,0) desc limit 1;

    if col.id is not null then
      v_pop := coalesce(col.pop, coalesce(col.cells,0) * 50);
      abduct := least(400, floor(v_pop * frac));
      abduct := least(abduct, greatest(0, v_pop - 1));
      if abduct > 0 then
        update public.colonies
           set pop = greatest(1, v_pop - abduct) where id = col.id;
      end if;
      perform public._legion_news(k.target_fid, 'Угон населения',
        format('Пираты Железного Легиона беспрепятственно вошли в систему «%s»: в колонии «%s» не оказалось ни одного корабля прикрытия. Угнано около %s жителей.',
               nm, coalesce(col.planet_name,'колония'), abduct));
      n_plunder := n_plunder + 1;
    else
      update public.trade_routes
         set volume = greatest(0, coalesce(volume,0) * 0.75)
       where status = 'active'
         and (origin_sys = k.target_sys or dest_sys = k.target_sys)
         and (a_fid = k.target_fid or b_fid = k.target_fid);
      perform public._legion_news(k.target_fid, 'Караван разграблен',
        format('Ватага Легиона перехватила конвой у системы «%s». Часть груза потеряна.', nm));
      n_plunder := n_plunder + 1;
    end if;

    update public.legion_contacts set state = 'spent' where id = k.id;
  end loop;

  return jsonb_build_object('ok', true, 'fights', n_fight,
                            'plunder', n_plunder, 'blinded', n_blind, 'duds', n_dud);
end $$;
