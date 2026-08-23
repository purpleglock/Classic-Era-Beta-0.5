-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 27: ПОСЛЕ ПАДЕНИЯ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_ghost_board.sql. Надмножество `_angel_fall`.
-- ⚠️ Всё, что происходит со ВСЕМ кризисом после гибели тела, вести отсюда.
--
-- ЧТО СЛУЧИЛОСЬ 22.08 в 18:44:49. Ангела ЗАБИЛИ, и по правилам: 54 залпа
-- пришло, 9 парировано, 45 попало, печатей было 100 при цене залпа 2.2–3.4 —
-- ровно тот размен, который и замерялся (38–41 залп «Длани»). Стена стражи
-- при этом цела: все три Херувима живы, они к смерти тела отношения не имеют
-- и иметь не могут — печати грызут только залпы.
--
-- ЧТО ПОСЛЕ ЭТОГО ОСТАЛОСЬ НА КАРТЕ (и выглядит поломкой):
--   • ВОИНСТВО ПЕРЕЖИЛО ТЕЛО. `_angel_fall` удаляет ровно один флот — ковчег
--     (`a.fleet_id`). Четыре крыла и СТРАЖА, 14 бортов, остались стоять. Ходить
--     они больше не могут: `_angel_host_orders` первым делом ищет живого
--     ангела и выходит с «ангела нет». То есть на карте висит чужое войско,
--     которое не двигается, не воюет и не убирается;
--   • ДВА БОЯ, КОТОРЫЕ НЕ КОНЧАТСЯ НИКОГДА. `_bt_is_machine` считает сторону
--     машинной через `_angel_is`, а тот требует `fell_at is null`. В момент
--     гибели сторона ангела перестала быть машинной — и `legion-ai-tick` мимо
--     неё проходит. Ход стоит за мёртвым: доска в «Спящих фронтирах» замерла
--     на `side_to_move='defender'`, а с ней заперт и флот игрока. Второй бой
--     («Железный легион», перехват) вообще завёлся В 20:22 — через полтора
--     часа ПОСЛЕ смерти, и висит в 'forming';
--   • `_bt_check_end` их тоже не закроет: борт защитника мёртв, но резерв
--     (`battle_pool`) показывает три борта, а правило требует «ни живых, ни
--     резерва». Выставить резерв некому — выставлял его ангел.
--
-- ЛЕЧЕНИЕ. Смерть кризиса должна быть КОНЦОМ КРИЗИСА, а не только тела:
--   1) ВОИНСТВО СКЛАДЫВАЕТСЯ ВМЕСТЕ С ТЕЛОМ. Это не союзники и не наёмники —
--      это его подобия («Оно сделало их по своему подобию»), и в самой сводке
--      о гибели уже написано «крылья сложились не по порядку». Реестр гасим,
--      флоты распускаем.
--   2) ВСЕ ЕГО ДОСКИ РАЗВОДЯТСЯ. Без победителя: победы над тем, кого убили
--      не здесь, не было. Потери по доске записываются честно, флоты сторон
--      расковываются самим фактом status='done'.
--   3) ПОРЯДОК: сначала бои, потом флоты. `battle_fleets` висит на флоте с
--      cascade — снеси флот раньше, и списывать потери будет не на что.
--
-- ⚠️ ЗАБРАКОВАНО: объявлять победителем того, на чьей доске тело стояло.
-- `_bt_finish` поднимает флаг и оккупацию, а «мы стояли рядом, когда его
-- добили с другого конца галактики» — не захват системы.
-- ⚠️ ДЕРЖАВУ НЕ ТРОГАЕМ. `fac_0fd51aa92b` остаётся в списках пустой (колонию
-- снёс сам `_angel_fall`). Снос державы — отдельная дверь с покаянием
-- (_delete_faction.sql), и делать это молча, за игрока, нельзя.
-- ════════════════════════════════════════════════════════════

-- ── 1. РАЗБОР КРИЗИСА ───────────────────────────────────────
-- Берёт fid явно и НЕ спрашивает `_angel_is`: к моменту вызова ангел уже
-- мёртв, и все проверки «жив ли он» отвечают «нет».
create or replace function public._angel_teardown(p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; r record; f record; comp jsonb; e jsonb; newc jsonb;
        q int; loss int; sysname text; foe text;
        n_bt int := 0; n_dead int := 0; n_fleet int := 0; n_occ int := 0; n_war int := 0;
begin
  if p_fid is null then return jsonb_build_object('ok', false, 'why', 'нет fid'); end if;

  -- 1.1 Бортов кризиса на досках больше нет.
  update public.battle_units set alive = false, hp = 0
   where fid = p_fid and alive;

  -- 1.2 Каждую незакрытую доску разводим без победителя.
  for b in select * from public.battles
            where status <> 'done' and (attacker_fid = p_fid or defender_fid = p_fid)
  loop
    foe := case when b.attacker_fid = p_fid then b.defender_fid else b.attacker_fid end;

    -- Потери ЧУЖОЙ стороны — по доске, как в любом бою.
    for r in select fid, unit_id, count(*) as n
               from public.battle_units
              where battle_id = b.id and not alive and unit_id is not null
                and fid is distinct from p_fid
              group by 1,2
    loop
      n_dead := n_dead + r.n;
      loss := r.n;
      for f in select bf.fleet_id from public.battle_fleets bf
                where bf.battle_id = b.id and bf.fid = r.fid
      loop
        exit when loss <= 0;
        select composition into comp from public.fleets where id = f.fleet_id for update;
        newc := '[]'::jsonb;
        for e in select value from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) loop
          if (e->>'unit_id')::uuid = r.unit_id and loss > 0 then
            q := greatest(0, coalesce((e->>'qty')::int,0));
            if q <= loss then loss := loss - q; q := 0;
            else q := q - loss; loss := 0; end if;
            if q > 0 then newc := newc || jsonb_build_array(jsonb_set(e, array['qty'], to_jsonb(q), true)); end if;
          else
            newc := newc || jsonb_build_array(e);
          end if;
        end loop;
        update public.fleets set composition = newc where id = f.fleet_id;
      end loop;
    end loop;

    -- Флот, у которого не осталось ни одного корабля, распускаем.
    delete from public.fleets fl
     where fl.id in (select fleet_id from public.battle_fleets
                      where battle_id = b.id and fid is distinct from p_fid)
       and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                     from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

    update public.battles
       set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
     where id = b.id;
    n_bt := n_bt + 1;

    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
    begin
      perform public._angel_tell(foe,
        public._angel_glitch('◈ ' || coalesce(sysname,'?') || ': отметки погасли', 0.22),
        public._angel_glitch(
          'Оно перестало отвечать на манёвры разом, все сразу, посреди хода. '
          || 'Стрельбы больше нет. Уцелевшие возвращаются', 0.16)
        || ' ' || public._angel_scream(12));
    exception when others then null; end;
  end loop;

  -- 1.3 Реестр воинства гасим и флоты распускаем — крылья сложились.
  update public.angel_guard set dead_at = now()
   where faction_id = p_fid and dead_at is null;

  select count(*) into n_fleet from public.fleets where faction_id = p_fid;
  delete from public.fleets where faction_id = p_fid;

  -- 1.4 ФЛАГИ СНИМАЮТСЯ, ВОЙНЫ ЗАКРЫВАЮТСЯ.
  -- Оккупацию держит присутствие, а держать её больше нечем: ни борта, ни
  -- флота. И воевать с трупом нельзя — `war_enemies_of` смотрит на
  -- `status='active'`, поэтому пока война «идёт», у трёх держав закрыты
  -- границы и включён военный слой ради противника, которого нет.
  select count(*) into n_occ from public.system_occupation where occupier_fid = p_fid;
  delete from public.system_occupation where occupier_fid = p_fid;

  select count(*) into n_war from public.wars
   where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);
  -- ⚠️ ИСХОД — 'status_quo', а не 'defender_won'. Во-первых, `wars_status_ck`
  -- других значений не знает ('done' туда не лезет — на этом спотыкается и
  -- `_faction_purge_tails`). Во-вторых, победу засчитывать некому: добил
  -- кризис ОДИН, залпами, а в войнах с ним числятся три державы, и двое из
  -- них по нему не стреляли ни разу.
  update public.wars
     set status = 'status_quo', ended_at = coalesce(ended_at, now()),
         outcome_note = coalesce(outcome_note, 'Противник перестал существовать.')
   where status = 'active' and (attacker_fid = p_fid or defender_fid = p_fid);

  return jsonb_build_object('ok', true, 'fid', p_fid, 'battles', n_bt,
                            'losses', n_dead, 'fleets', n_fleet,
                            'occupations', n_occ, 'wars', n_war);
end$$;
revoke all on function public._angel_teardown(text) from public;

-- ── 2. ГИБЕЛЬ ТЕЛА — НАДМНОЖЕСТВО ───────────────────────────
-- Слово в слово живой `_angel_fall` (_angel_core.sql, шаг «падение»), плюс
-- разбор кризиса в конце. Сводку оставляем прежнюю: она уже говорит и про
-- крылья, и про то, что считать это победой каждый будет сам.
create or replace function public._angel_fall(p_fid text, p_killer text default null)
returns void language plpgsql security definer set search_path=public as $$
declare a record; nm text; kn text;
begin
  select * into a from public.angel_state where faction_id = p_fid and fell_at is null;
  if a.faction_id is null then return; end if;

  select name into nm from public.faction_applications
   where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;
  select name into kn from public.faction_applications
   where faction_id = p_killer and status = 'approved' order by updated_at desc limit 1;

  -- борта нет: снимаем с доски всё, что от него осталось
  update public.battle_units set alive = false, hp = 0
   where fid = p_fid and alive;
  delete from public.fleets   where id = a.fleet_id;
  delete from public.colony_buildings where colony_id = a.colony_id;
  delete from public.colonies where id = a.colony_id;

  update public.angel_state
     set fell_at = now(), seals = 0, awake = false, stance = 'roost'
   where faction_id = p_fid;

  perform public._angel_news(public._angel_glitch('◈ ОНО ОСТАНОВИЛОСЬ', 0.20),
    public._angel_glitch(
      'Отметка перестала двигаться в 19:40 и погасла не сразу. ' ||
      'Крылья сложились не по порядку. Глаза закрылись не одновременно.', 0.16) ||
    ' ' || public._angel_scream(11) || ' ' ||
    case when kn is not null
         then public._angel_glitch('Последний импульс пришёл со стороны «' || kn || '».', 0.24) || ' '
         else '' end ||
    public._angel_glitch('Осталась пыль, которую нечем взвесить. Считать это победой каждый будет сам.', 0.14));

  -- ⚠️ ВСТАВКА ШАГА 27: кризис кончается целиком, а не только телом.
  begin perform public._angel_teardown(p_fid); exception when others then null; end;
end$$;
revoke all on function public._angel_fall(text,text) from public;

notify pgrst, 'reload schema';

-- ── 3. РАЗБОР ТОГО, ЧТО УЖЕ ВИСИТ ───────────────────────────
do $$
declare r jsonb; fid text;
begin
  for fid in select faction_id from public.angel_state where fell_at is not null loop
    begin
      r := public._angel_teardown(fid);
      raise notice 'разбор %: %', fid, r;
    exception when others then raise notice 'разбор % не прошёл: %', fid, sqlerrm;
    end;
  end loop;
end$$;

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) `select count(*) from battles where status<>'done' and (attacker_fid='fac_0fd51aa92b'
--    or defender_fid='fac_0fd51aa92b')` → 0.
-- 2) Флот игрока в «Спящих фронтирах» расскован: `_fleet_in_battle` → null,
--    им снова можно ходить.
-- 3) `select count(*) from fleets where faction_id='fac_0fd51aa92b'` → 0:
--    воинства на карте нет.
-- 4) Держава осталась в списках пустой — это НЕ поломка, а решение (см. шапку).
