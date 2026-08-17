-- ════════════════════════════════════════════════════════════
-- 17.08 «ну он победил, че дальше то? у них разве не цель разграбить?»
--
-- Ватага смела флот прикрытия, поле осталось за ней — и она стояла. Добычу
-- забирал только legion_press_tick через patience_h=3 часа от прилёта, причём
-- эта ветка задумана для ДРУГОГО случая: «боя не дали, ватага взяла сама».
-- Победа в бою нигде не превращалась в добычу — пираты выигрывали сражение
-- и продолжали висеть над планетой без последствий.
--
-- Здесь: как только в системе не осталось чужих боевых флотов и активного боя,
-- ватага берёт добычу СРАЗУ — и потом доит систему раз в час, пока стоит.
-- Порция после боя крупнее обычной: прикрытия больше нет, брать некому мешать.
--
-- ЦЕПОЧКА: после _legion_battle_ai.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

create or replace function public.legion_spoils_tick()
returns jsonb language plpgsql security definer as $$
declare k record; col public.colonies; op public.outposts;
        v_pop numeric; abduct numeric; frac numeric; nm text; cut int;
        won boolean; n int := 0;
begin
  for k in select c.* from public.legion_contacts c
            join public.fleets f on f.id = c.fleet_id
           where c.state = 'engaged' and c.fleet_id is not null and c.kind <> 'levy'
             -- берём не чаще раза в час, чтобы стоянка не превращалась в мясорубку
             and (c.pressed_at is null or c.pressed_at < now() - interval '1 hour')
             -- поле за пиратами: ни одного чужого боевого флота в системе
             and not exists (select 1 from public.fleets f2
                              where f2.system_id = c.target_sys
                                and f2.faction_id is distinct from public._legion_fid()
                                and coalesce(jsonb_array_length(f2.composition),0) > 0)
             -- и никакого идущего боя
             and not exists (select 1 from public.battles b
                              where b.system_id = c.target_sys
                                and b.status not in ('done','finished','ended','cancelled'))
  loop
    nm := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                   k.target_sys);
    -- был ли только что выигранный бой в этой системе (для голоса сводки)
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
      end if;
      perform public._legion_news(k.target_fid,
        case when won then '☠ Ватага собирает добычу' else '☠ Ватага взяла своё' end,
        format('%s Из колонии «%s» в системе «%s» угнано около %s жителей. Пока ватага стоит над планетой, она будет возвращаться за добычей — уйдёт только выбитая.',
          case when won then 'Прикрытия у системы не осталось: флот разбит, и пираты сошли к планете.'
               else 'Боя ватаге так и не дали, и она высадилась сама.' end,
          coalesce(col.planet_name,'колония'), nm, abduct));
      n := n + 1;
    else
      -- колонии нет: бьют по заставе, а если и её нет — режут трассы
      select * into op from public.outposts
        where system_id = k.target_sys and faction_id = k.target_fid
        order by public._outpost_crew_k(crew, mode) desc limit 1;
      if op.id is not null then
        cut := greatest(1, round(coalesce(op.crew,0) * 0.5)::int);
        update public.outposts set crew = greatest(0, coalesce(crew,0) - cut) where id = op.id;
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

grant execute on function public.legion_spoils_tick() to authenticated;

-- Добыча снимается в том же ходе, что и бои: ватага не должна простаивать.
create or replace function public.legion_ai_tick()
returns jsonb language plpgsql security definer as $$
declare b record; n int := 0; d int := 0; sp jsonb;
begin
  for b in select id from public.battles
            where status = 'forming'
              and (attacker_fid = public._legion_fid() or defender_fid = public._legion_fid())
  loop
    begin
      if (public.legion_battle_deploy(b.id)->>'ok')::boolean then d := d + 1; end if;
    exception when others then null; end;
  end loop;

  for b in select id from public.battles
            where status = 'active'
              and public._bt_is_machine(case when side_to_move = 'attacker'
                                             then attacker_fid else defender_fid end)
            order by created_at
            limit 12
  loop
    begin
      perform public._bt_bot_turn(b.id);
      n := n + 1;
    exception when others then null; end;
  end loop;

  begin sp := public.legion_spoils_tick(); exception when others then sp := null; end;

  return jsonb_build_object('ok', true, 'turns', n, 'deployed', d,
                            'spoils', coalesce(sp->'spoils', '0'::jsonb));
end $$;
