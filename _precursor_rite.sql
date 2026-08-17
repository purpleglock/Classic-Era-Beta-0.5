-- ============================================================
--  ОККУЛЬТНЫЙ ОБРЯД  ·  «жертва» — дозвёздный мир в обмен на ихор
-- ------------------------------------------------------------
--  Катить ПОСЛЕ: ethics → growth → goodwill → lesson → bonds.
--  Перекат любого из них вернёт старую обёртку precursor_act и снимет обряд.
--
--  Что это. У державы уже есть «Обратить в веру» — мирный путь, где мир
--  становится адептом и разгоняет храмы. Обряд — его изнанка: та же вера,
--  но вместо паствы из мира делают сырьё. Планета вычищается целиком,
--  держава получает ихор по счёту «500 их жизней = 1 ихор», а на самой
--  вере навсегда остаётся клеймо, которое видит вся галактика.
--
--  Цена не в ГС: обряд БЕСПЛАТЕН. Платят верой и репутацией — иначе это
--  был бы просто «истребить, но выгоднее».
--
--  Ихор до сих пор шёл ТОЛЬКО из Завета (мирный путь, ~0.6–1.6/сут с мира
--  и только там, где под ногами Даллерианцы). Обряд — второй источник:
--  разовый, мгновенный и невозобновимый. Мир, отданный обряду, не отдаст
--  больше ничего и никогда.
-- ============================================================

-- ── 1. КЛЕЙМО НА ВЕРЕ ─────────────────────────────────────
-- Считаем не «да/нет», а ЧИСЛО обрядов: одна жертва и одиннадцать — разный
-- разговор, и в интерфейсе это разные подписи.
alter table public.faiths
  add column if not exists stigma     int not null default 0,
  add column if not exists stigma_at  timestamptz;

-- ── 2. СЧЁТ ЖЕРТВЫ ────────────────────────────────────────
-- 100 их жизней = 1 ихор. Курс выведен из живых данных, а не из головы:
-- население дозвёздных живёт в шкале колоний (6..6500 по фазам, см.
-- _precursor_pop_scale.sql), в галактике 26 миров и 21 000 душ на всех.
--   при 500:1 — средний мир давал 1.6 ихора, ВСЯ галактика разом 42, при
--     цене мегасооружений 30 и 50. Обряд был строго хуже Завета: тот же
--     ихор набегал с одного живого мира за полтора месяца.
--   при 100:1 — средний мир 8, лучший 36, вся галактика 210. Один хороший
--     мир ≈ одно мегасооружение: обряд стал быстрым путём, но не бесплатным
--     (репутация −80 за раз упирается в штраф Фонда после четвёртого).
-- Дробь вниз: мелкое племя должно давать мало, иначе выгодно резать мелочь
-- пачками вместо того, чтобы растить Завет.
create or replace function public._pc_rite_ichor(p_pop numeric)
returns numeric language sql immutable set search_path=public as $$
  select round(greatest(0, coalesce(p_pop, 0))::numeric / 100.0, 1);
$$;

-- ── 3. ЗАПРЕТ ПО УКЛАДУ ───────────────────────────────────
-- Просвещённым закрыто вместе с геноцидом: обряд — тот же геноцид, только
-- с алтарём. Зеркало _precursor_ethics.sql §4 + 'lesson' из _precursor_lesson.sql.
create or replace function public._pc_forbidden(p_fid text)
returns text[] language sql stable security definer set search_path=public as $$
  select case when public._faction_enlightened(p_fid)
    then array['purge','enslave','harvest','protect','lesson','rite']::text[]
    else array[]::text[] end
$$;
revoke all on function public._pc_forbidden(text) from public;
grant execute on function public._pc_forbidden(text) to authenticated;

-- ── 4. ВИТРИНА: отдать клеймо клиенту ─────────────────────
-- Зеркало _precursor_bonds.sql §8 плюс два поля о вере. Правится целиком,
-- потому что переопределить одно поле в jsonb_build_object нельзя.
create or replace function public.precursor_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v jsonb; rep int; v_faith uuid; v_faith_nm text; v_stigma int;
begin
  fid := public._ec_my_fid();
  perform public._pc_clock();
  begin perform public.precursor_scan_contacts(50); exception when others then null; end;
  begin perform public._pc_bonds_tick(); exception when others then null; end;
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  select m.faith_id into v_faith from public.faith_membership m
    where m.faction_id = fid and m.role = 'founder' limit 1;   -- своя = основанная
  select f.name, coalesce(f.stigma, 0) into v_faith_nm, v_stigma
    from public.faiths f where f.id = v_faith;
  select coalesce(jsonb_agg(x order by x_tier desc, x_name), '[]'::jsonb) into v
    from (
      select (to_jsonb(c) - 'roadmap')
             || jsonb_build_object('steps_left', jsonb_array_length(c.roadmap),
                                   'fleet', public._pc_has_fleet(fid, c.system_id),
                                   'cap', public._pc_cap(c.phase, c.grudge, c.dependency),
                                   'loyalty', public._pc_loy(c),
                                   'mine_cov', (c.covenant_fid = fid),
                                   'rite_ichor', public._pc_rite_ichor(c.pop),
                                   'phase_name', case when c.phase between 0 and 11 then
                                     (array['Собиратели','Оседлость','Металл','Письмо','Бронзовые царства','Железо',
                                            'Классика','Тёмный провал','Порох и паруса','Пар и фабрика','Атом и код','Порог'])[c.phase + 1]
                                     else '?' end) as x,
             c.tier as x_tier, c.self_name as x_name
        from public.primitive_civs c
       where exists (select 1 from public.colonies col
                      where col.system_id = c.system_id and col.faction_id = fid)
          or c.contacted_by = fid or c.patron_fid = fid or c.covenant_fid = fid
    ) t;
  return jsonb_build_object(
    'fid', fid,
    'rep', coalesce(rep, 0),
    'now', now(),
    'gc', (select gc from public.faction_economy where faction_id = fid),
    'ichor', (select coalesce((resources->>'Ихор')::numeric, 0)
                from public.faction_economy where faction_id = fid),
    'enlightened', public._faction_enlightened(fid),
    'forbidden', to_jsonb(public._pc_forbidden(fid)),
    'faith', v_faith_nm,
    'faith_stigma', coalesce(v_stigma, 0),
    'faith_boost', public._pc_faith_boost(fid),
    'civs', v);
end$$;
revoke all on function public.precursor_get() from public, anon;
grant execute on function public.precursor_get() to authenticated;

-- ── 5. ОБЁРТКА: обряд + делегирование остального ──────────
do $$
begin
  if to_regprocedure('public._precursor_act_v5(text,int,text)') is null then
    execute 'alter function public.precursor_act(text,int,text) rename to _precursor_act_v5';
    execute 'revoke all on function public._precursor_act_v5(text,int,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype;
  fid text; v_faith uuid; v_faith_nm text; v_stigma int;
  v_amt numeric; v_rep int; v_who text; v_pop numeric;
begin
  if p_action <> 'rite' then
    return public._precursor_act_v5(p_system_id, p_pid, p_action);
  end if;

  fid := public._ec_my_fid();
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid;
  if not found then raise exception 'no civ'; end if;
  if c.status in ('dead','spacefaring') then raise exception 'civ is gone'; end if;
  if 'rite' = any(public._pc_forbidden(fid)) then raise exception 'forbidden by creed'; end if;

  -- Своя вера обязательна: обряд служат ЕЙ, клеймо ложится на неё.
  select m.faith_id into v_faith from public.faith_membership m
    where m.faction_id = fid and m.role = 'founder' limit 1;   -- своя = основанная
  if v_faith is null then raise exception 'no faith of your own'; end if;
  select f.name into v_faith_nm from public.faiths f where f.id = v_faith;

  -- Дотянуться можно только туда, где стоит своя колония (как у истребления).
  if not exists (select 1 from public.colonies col
                  where col.system_id = c.system_id and col.faction_id = fid)
     and coalesce(c.patron_fid, '') <> fid and coalesce(c.covenant_fid, '') <> fid then
    raise exception 'no presence in system';
  end if;
  if c.patron_fid is not null and c.patron_fid <> fid then
    raise exception 'civ belongs to another patron';
  end if;

  v_pop := coalesce(c.pop, 0);
  v_amt := public._pc_rite_ichor(v_pop);
  begin v_who := nullif(public._fac_name(fid), ''); exception when others then v_who := null; end;

  -- Мир вычищается целиком. Строка остаётся мёртвой — как после истребления,
  -- чтобы в летописи было видно, чем всё кончилось.
  update public.primitive_civs
     set status = 'dead', pop = 0, wellbeing = 0,
         covenant_fid = null, patron_fid = null,
         last_act_at = now(), last_touch_at = now(), acts = acts + 1,
         contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
         chronicle = chronicle || jsonb_build_array(jsonb_build_object(
           'ph', 'обряд',
           'text', 'Небо раскрылось не для дара. То, что пришло за ними, не воевало и не требовало сдачи — '
                || 'оно просто собрало ' || c.self_name || ' всех до последнего, и планета замолчала за одну ночь. '
                || 'Под опустевшими городами что-то отозвалось и потекло вверх.'))
   where system_id = c.system_id and pid = c.pid;

  if v_amt > 0 then perform public._pc_res_add(fid, 'Ихор', v_amt); end if;

  -- Клеймо на вере. Оно не снимается ничем: это и есть цена обряда.
  update public.faiths
     set stigma = coalesce(stigma, 0) + 1, stigma_at = now()
   where id = v_faith
   returning stigma into v_stigma;

  v_rep := public._pc_rep(fid, -80);

  insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
    values (c.system_id, c.pid, fid, 'rite',
            jsonb_build_object('pop', v_pop, 'ichor', v_amt, 'faith', v_faith_nm,
                               'stigma', v_stigma, 'rep', v_rep));

  -- ОГЛАСКА без адресата: такое не прячут, как рабство. Видит вся галактика.
  perform public._pc_news(
    '⛧ Обряд: мир «' || c.self_name || '» принесён в жертву',
    'Дозвёздный народ «' || c.self_name || '» с планеты ' || coalesce(c.planet_name, '?') ||
    ' перестал существовать за одну ночь. Это была не война: их не побеждали, их израсходовали.',
    'Обряд служили во имя веры «' || coalesce(v_faith_nm, '?') || '»' ||
    coalesce(' державы «' || v_who || '»', '') || '. ' ||
    'Погибших: ' || round(v_pop)::text || '. Получено ихора: ' || v_amt::text || '. ' ||
    'На этой вере теперь стоит клеймо, и оно видно всем, кто спросит: ' ||
    case when coalesce(v_stigma, 1) = 1 then 'первый обряд.'
         else 'обрядов на её счету — ' || v_stigma::text || '.' end,
    'rgba(200,40,70,0.6)',
    '[]'::jsonb);

  return jsonb_build_object('ok', true, 'ichor', v_amt, 'pop', v_pop,
    'stigma', v_stigma, 'rep', v_rep,
    'txt', c.self_name || ' больше нет. Получено ихора: ' || v_amt::text ||
           '. На вере «' || coalesce(v_faith_nm, '?') || '» клеймо' ||
           case when coalesce(v_stigma, 1) > 1 then ' ×' || v_stigma::text else '' end || '.');
end$$;
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;
