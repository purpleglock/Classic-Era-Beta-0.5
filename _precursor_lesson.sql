-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · «УРОК БУДЕТ УСВОЕН» (карательный удар с орбиты)
--
-- Всё, что можно было сделать с дозвёздным миром до сих пор, делалось тихо:
-- наблюдение, дар, проповедь, трюмы. Это — не тихо. Флот встаёт над планетой и
-- бьёт по всему, что они успели построить: города, верфи, библиотеки, реакторы.
-- Мир не исчезает — он ОТКАТЫВАЕТСЯ НА ЭПОХУ НАЗАД и начинает подниматься
-- заново, помня, чьи корабли висели в небе.
--
--   • нужен ФЛОТ в системе (не колония): idle, не станция;
--   • phase −1 (тир и видимый тир пересчитываются), население −25%,
--     благополучие −35, отношение −45;
--   • ГС не стоит ничего: платит флот, который уже есть;
--   • в roadmap возвращается запись прожитой эпохи — им её жить заново,
--     «до звёздного полёта шагов» растёт;
--   • ЕСЛИ ОТКАТЫВАТЬ НЕКУДА (phase = 0) — цивилизация истреблена: пепел,
--     status='dead', как при зачистке, но без трофеев;
--   • об этом узнаёт ВСЯ ГАЛАКТИКА: сводка в общую хронику без адресата,
--     а не личное оповещение (в отличие от рабства и проповеди).
--
-- Досье Фонда: −50 за откат, −75 за истребление. Просвещённым закрыто.
--
-- ⚠ Обёртка precursor_act переименована в _precursor_act_v3 (после v1 из
--   _precursor_ethics.sql и v2 из _precursor_goodwill.sql). Порядок катки:
--   ethics → growth → goodwill → ЭТОТ ФАЙЛ. Перекат любого предыдущего после
--   него вернёт старую обёртку и «Урок» отвалится.
-- ════════════════════════════════════════════════════════════

alter table public.primitive_civs
  add column if not exists lessons int not null default 0;

-- ── 1. Цена ───────────────────────────────────────────────
-- Её нет. Флот уже построен, содержится и висит над их небом — платить сверху
-- за то, чтобы он открыл огонь по каменному веку, не за что. Урок стоит не ГС,
-- а досье Фонда и того, что о вас после этого будут думать соседи.
drop function if exists public._pc_lesson_cost(int);

-- ── 2. Есть ли у державы флот НАД этим миром ──────────────
-- Колония в системе — это присутствие. Урок требует силы: боевой флот,
-- стоящий в системе (не в перелёте, не станция).
create or replace function public._pc_has_fleet(p_fid text, p_system_id text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.fleets f
                  where f.faction_id = p_fid
                    and f.system_id = p_system_id
                    and f.status = 'idle'
                    and coalesce(f.is_station, false) = false);
$$;
revoke all on function public._pc_has_fleet(text, text) from public;
grant execute on function public._pc_has_fleet(text, text) to authenticated;

-- ── 3. Запреты уклада (+ lesson) ──────────────────────────
-- Зеркало _precursor_ethics.sql §4 с одним новым пунктом: бомбардировка
-- дозвёздного мира — ровно то, чего просвещённая держава себе не позволит.
create or replace function public._pc_forbidden(p_fid text)
returns text[] language sql stable security definer set search_path=public as $$
  select case when public._faction_enlightened(p_fid)
    then array['purge','enslave','harvest','protect','lesson']::text[]
    else array[]::text[] end
$$;
revoke all on function public._pc_forbidden(text) from public;
grant execute on function public._pc_forbidden(text) to authenticated;

-- ── 4. Список миров: + флаг «флот на месте» ───────────────
-- Зеркало _precursor_ethics.sql §5, добавлено ровно одно поле: fleet.
create or replace function public.precursor_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v jsonb; rep int; v_faith uuid; v_faith_nm text;
begin
  fid := public._ec_my_fid();
  perform public._pc_clock();
  begin perform public.precursor_scan_contacts(50); exception when others then null; end;
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  select m.faith_id into v_faith from public.faith_membership m
    where m.faction_id = fid order by (m.role = 'founder') desc limit 1;
  select f.name into v_faith_nm from public.faiths f where f.id = v_faith;
  select coalesce(jsonb_agg(x order by x_tier desc, x_name), '[]'::jsonb) into v
    from (
      select (to_jsonb(c) - 'roadmap')
             || jsonb_build_object('steps_left', jsonb_array_length(c.roadmap),
                                   'fleet', public._pc_has_fleet(fid, c.system_id),
                                   'phase_name', case when c.phase between 0 and 11 then
                                     (array['Собиратели','Оседлость','Металл','Письмо','Бронзовые царства','Железо',
                                            'Классика','Тёмный провал','Порох и паруса','Пар и фабрика','Атом и код','Порог'])[c.phase + 1]
                                     else '?' end) as x,
             c.tier as x_tier, c.self_name as x_name
        from public.primitive_civs c
       where exists (select 1 from public.colonies col
                      where col.system_id = c.system_id and col.faction_id = fid)
          or c.contacted_by = fid or c.patron_fid = fid
    ) t;
  return jsonb_build_object(
    'fid', fid,
    'rep', coalesce(rep, 0),
    'now', now(),
    'gc', (select gc from public.faction_economy where faction_id = fid),
    'enlightened', public._faction_enlightened(fid),
    'forbidden', to_jsonb(public._pc_forbidden(fid)),
    'faith', v_faith_nm,
    'faith_boost', public._pc_faith_boost(fid),
    'civs', v);
end$$;
revoke all on function public.precursor_get() from public, anon;
grant execute on function public.precursor_get() to authenticated;

-- ── 5. Обёртка решений: перехватываем 'lesson' ────────────
do $$
begin
  if to_regprocedure('public._precursor_act_v3(text,int,text)') is null then
    execute 'alter function public.precursor_act(text,int,text) rename to _precursor_act_v3';
    execute 'revoke all on function public._precursor_act_v3(text,int,text) from public, anon, authenticated';
  end if;
end$$;

create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype; fid text; v_who text; v_rep int; v_ph int; v_new int; v_tier int; v_pop bigint; v_wiped boolean;
  v_txt text; v_line text; v_lead text; v_ph_nm text; v_new_nm text; v_left int;
  PH constant text[] := array['Собиратели','Оседлость','Металл','Письмо','Бронзовые царства','Железо',
                              'Классика','Тёмный провал','Порох и паруса','Пар и фабрика','Атом и код','Порог'];
begin
  if p_action <> 'lesson' then
    return public._precursor_act_v3(p_system_id, p_pid, p_action);
  end if;

  fid := public._ec_my_fid();
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found then raise exception 'no civ'; end if;
  if c.status = 'dead' then raise exception 'civ is gone'; end if;
  if c.status = 'spacefaring' then raise exception 'civ is sovereign'; end if;
  if c.patron_fid is not null and c.patron_fid <> fid then
    raise exception 'civ belongs to another patron';
  end if;
  if p_action = any (public._pc_forbidden(fid)) then
    raise exception 'forbidden by creed';
  end if;
  -- ГЛАВНОЕ УСЛОВИЕ: не колония, а флот на месте
  if not public._pc_has_fleet(fid, c.system_id) then
    raise exception 'no fleet in system';
  end if;
  if c.last_act_at is not null and now() - c.last_act_at < interval '20 hours' then
    raise exception 'too soon';
  end if;

  begin v_who := nullif(public._fac_name(fid), ''); exception when others then v_who := null; end;
  v_ph     := greatest(0, least(11, coalesce(c.phase, 0)));
  v_wiped  := (v_ph <= 0);
  v_new    := greatest(0, v_ph - 1);
  v_ph_nm  := PH[v_ph + 1];
  v_new_nm := PH[v_new + 1];

  if v_wiped then
    -- ── Откатывать некуда: под ними уже нет эпохи, только пепел ──
    v_rep := public._pc_rep(fid, -75);
    update public.primitive_civs
       set status = 'dead', pop = 0, wellbeing = 0, attitude = -100,
           roadmap = '[]'::jsonb, next_step_at = null,
           lessons = lessons + 1, last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'конец',
             'text', 'Урок повторили, а учить стало некого. ' || c.self_name ||
                     ' не оставили после себя даже эпохи, в которую можно было бы вернуться.'))
     where system_id = c.system_id and pid = c.pid;
    v_txt := c.self_name || ' откатывать больше некуда: мир стёрт. Это видела вся галактика.';
    v_line := '☠ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || '): урок стал последним.';
  else
    -- ── Откат на эпоху: им жить её заново ──
    v_rep  := public._pc_rep(fid, -50);
    v_tier := case when v_new <= 1 then 0 when v_new <= 4 then 1
                   when v_new <= 7 then 2 when v_new <= 9 then 3
                   when v_new = 10 then 4 else 5 end;
    v_pop  := greatest(0, (c.pop * 0.75)::bigint);
    update public.primitive_civs
       set phase = v_new, tier = v_tier, visible_tier = v_tier,
           pop = v_pop,
           wellbeing = greatest(0, wellbeing - 35),
           attitude  = greatest(-100, attitude - 45),
           status = case when wellbeing - 35 <= 5 then 'drained' else status end,
           -- прожитую эпоху возвращаем в будущее: подниматься по ней заново
           roadmap = jsonb_build_array(jsonb_build_object(
                       'i', v_ph, 'ph', 'E' || v_ph::text,
                       'text', 'Заново: то, что у ' || c.self_name ||
                               ' уже было однажды, отстроено во второй раз — и на этот раз с оглядкой на небо.',
                       'd', jsonb_build_object('att', -5))) || roadmap,
           lessons = lessons + 1, last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'вмешательство',
             'text', 'Небо горело сутки. Когда оно погасло, у ' || c.self_name ||
                     ' не осталось ни городов, ни книг, ни тех, кто умел их писать: '
                     || 'целая эпоха вычеркнута одним решением постороннего.'))
     where system_id = c.system_id and pid = c.pid;
    select jsonb_array_length(roadmap) into v_left from public.primitive_civs
      where system_id = c.system_id and pid = c.pid;
    v_txt := c.self_name || ' отброшены в эпоху E' || v_new::text || ' («' || v_new_nm ||
             '»). До звёздного полёта шагов: ' || coalesce(v_left, 0)::text ||
             '. Это видела вся галактика.';
    v_line := '⌖ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || '): мир отброшен на эпоху назад.';
  end if;

  perform public._luck_post('geo', fid, v_line);

  -- досье в сводке должно описывать мир ПОСЛЕ удара, а не до него
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;

  -- ── ОБ ЭТОМ УЗНАЮТ ВСЕ ──
  -- Пустой список упоминаний = сводка без адресата: её видит вся галактика,
  -- а не только патрон и нашедший (в отличие от рабства и проповеди).
  v_lead := 'Над планетой ' || coalesce(c.planet_name, '?') || ' в системе ' ||
            coalesce(c.system_name, c.system_id) || ' сутки стоял чужой флот' ||
            coalesce(' державы «' || v_who || '»', '') || '. ' ||
            case when v_wiped
              then 'Когда он ушёл, народа «' || c.self_name || '» больше не было. Их не завоевали и не увели — их отучили существовать.'
              else 'Когда он ушёл, «' || c.self_name || '» отбросило из эпохи «' || v_ph_nm ||
                   '» обратно в «' || v_new_nm || '»: города, верфи и книги сгорели вместе с теми, кто умел их делать.'
            end;
  perform public._pc_news(
    case when v_wiped then '☠ Урок усвоен: ' || c.self_name || ' стёрты'
         else '⌖ Урок усвоен: ' || c.self_name || ' отброшены на эпоху назад' end,
    v_lead,
    'Дозвёздный мир, находившийся под мораторием Фонда по защите от невмешательства. ' ||
    'Ответственность за удар никто не скрывал' ||
    coalesce(': держава «' || v_who || '».', '.') || ' ' ||
    public._pc_dossier(c),
    'rgba(210,90,80,0.55)',
    '[]'::jsonb);

  insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
    values (c.system_id, c.pid, fid, 'lesson',
            jsonb_build_object('cost', 0, 'rep', v_rep, 'from', v_ph, 'to', v_new, 'wiped', v_wiped));

  return jsonb_build_object('ok', true, 'txt', v_txt, 'cost', 0, 'rep', v_rep,
                            'phase', v_new, 'wiped', v_wiped);
end$$;
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;
