-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 9: СТАРЫЕ РЕШЕНИЯ ПОД ОДНОЙ ДВЕРЬЮ
-- (lore/precursor_memory.md §19–§20, продолжение этапа 3)
--
-- ПОРЯДОК: после _precursor_commit.sql и _precursor_arrears.sql. Идемпотентно.
--
-- Было: precursor_act → _precursor_act_v5 → v4 → v3 → v2 → v1. Пять обёрток,
-- каждая правила последствия предыдущей, и порядок каток решал, что получится.
-- Стало: тот же `precursor_commit` — одна проверка (`_pc_gate` + `_pc_gate_extra`),
-- одни деньги, одна строка в журнал, и последствия одной функцией `_pc_effects`.
-- Цепочка v1..v5 сносится в конце файла.
--
-- Что изменилось по существу (и это осознанно):
--   • ЛЕТОПИСЬ БОЛЬШЕ НЕ ПИШЕТСЯ В СТРОКУ. Растущий jsonb в горячей строке —
--     ровно то, что душило фичу (этап 2). Летопись вычисляется из журнала
--     (`PrecursorSim.chronicleOf`, §10), и старые abзацы отсюда ушли туда же.
--   • RANDOM() УБРАН. Протекторат и проповедь бросали `random()`; теперь бросок —
--     от hash(seed‖повод‖сутки), одной формулой с клиентом (§19). Игрок видит
--     свои шансы и не может переигрывать один и тот же день до удачи.
--   • ЧАСЫ ПО РУКАМ, а не по всему миру: `grp` в словаре. Дары ходят своими
--     часами, вмешательство — своими, как и было (last_gift_at / last_act_at).
--   • «Дар с неба» переименован `gift` → `boon`: имя `gift` уже занято даром
--     ритма (§8.2), а это разные вещи — подачка с неба и то, что приносят снова.
--   • Завет встал на ступень СЛОВА: значит, требует покоя и шести откликов
--     (§8) сверх старых условий по лояльности. Это и есть «Завет не покупается».
-- ════════════════════════════════════════════════════════════

-- ── 1. СЛОВАРЬ: старые решения тем же словарём ──────────────
create or replace function public._pc_act_spec(p_act text, p_tier integer)
returns jsonb
language sql immutable as $$
  select case p_act
    -- §8.1 ПОКОЙ. Первое, что стоит терпения, а не ГС.
    when 'hush'    then jsonb_build_object('step','покой','gc',0,'cd',0,  'fleet',false)
    when 'ward'    then jsonb_build_object('step','покой','gc',0,'cd',12, 'fleet',true)
    when 'abstain' then jsonb_build_object('step','покой','gc',0,'cd',0,  'fleet',false)
    when 'leave'   then jsonb_build_object('step','покой','gc',0,'cd',0,  'fleet',false)
    when 'ack'     then jsonb_build_object('step','покой','gc',0,'cd',6,  'fleet',false)
    -- §8.2 РИТМ. Ценен не размером, а тем, что пришли снова.
    when 'answer'  then jsonb_build_object('step','ритм','gc', 60000 +  20000*p_tier,'cd',18,'fleet',false)
    when 'answer2' then jsonb_build_object('step','ритм','gc',120000 +  45000*p_tier,'cd',18,'fleet',false)
    when 'year'    then jsonb_build_object('step','ритм','gc', 40000 +  15000*p_tier,'cd',20,'fleet',false)
    when 'work'    then jsonb_build_object('step','ритм','gc', 90000 +  30000*p_tier,'cd',20,'fleet',false)
    when 'feast'   then jsonb_build_object('step','ритм','gc', 30000 +  12000*p_tier,'cd',20,'fleet',false)
    when 'gift'    then jsonb_build_object('step','ритм','gc',150000 +  60000*p_tier,'cd',20,'fleet',false)
    -- §8.4 Устроение: скучно, дорого и правильно — единственное, что растит прочность.
    when 'order'   then jsonb_build_object('step','ритм','gc',220000 +  80000*p_tier,'cd',48,'fleet',false)
    -- §11 СЛОВО. Требует присутствия: свидетель, а не платёж.
    when 'record'  then jsonb_build_object('step','слово','gc', 90000 +  30000*p_tier,'cd',48,'fleet',false)
    when 'trial'   then jsonb_build_object('step','слово','gc',260000 +  90000*p_tier,'cd',72,'fleet',true)
    when 'vira'    then jsonb_build_object('step','слово','gc',420000 + 150000*p_tier,'cd',72,'fleet',true)
    when 'forge'   then jsonb_build_object('step','слово','gc',160000 +  55000*p_tier,'cd',72,'fleet',false)
    -- §13 ТЁМНОЕ. Дёшево, быстро, работает — и в этом весь смысл.
    when 'numb'    then jsonb_build_object('step','тёмное','gc', 80000 + 30000*p_tier,'cd',24,'fleet',false)
    when 'breach'  then jsonb_build_object('step','тёмное','gc',0,'cd',24,'fleet',true)

    -- ── ЭТАП 9: то, чем распоряжались до лестницы ──
    -- Наблюдение. Своя рука и свои часы: за наукой ходят чаще, чем вмешиваются.
    when 'study'   then jsonb_build_object('step','покой','gc',public._pc_cost('study', p_tier),
                                           'cd',20,'fleet',false,'grp','study')
    -- Добрая воля. Цена растёт с каждым разом — точную считает `_pc_gate_extra`.
    when 'boon'    then jsonb_build_object('step','ритм','gc',public._pc_gift_cost('gift', p_tier, 0),
                                           'cd',20,'fleet',false,'grp','gift')
    when 'envoy'   then jsonb_build_object('step','ритм','gc',public._pc_gift_cost('envoy', p_tier, 0),
                                           'cd',20,'fleet',false,'grp','gift')
    when 'miracle' then jsonb_build_object('step','ритм','gc',public._pc_gift_cost('miracle', p_tier, 0),
                                           'cd',20,'fleet',false,'grp','gift')
    -- Завет — вершина мирного пути, а значит ступень слова со всеми её условиями.
    when 'covenant' then jsonb_build_object('step','слово','gc',public._pc_covenant_cost(p_tier),
                                           'cd',0,'fleet',false)
    -- Вмешательство. Одна рука на всё: за сутки — одно такое решение.
    when 'uplift'  then jsonb_build_object('step','тёмное','gc',public._pc_cost('uplift',  p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    when 'protect' then jsonb_build_object('step','тёмное','gc',public._pc_cost('protect', p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    when 'harvest' then jsonb_build_object('step','тёмное','gc',public._pc_cost('harvest', p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    when 'enslave' then jsonb_build_object('step','тёмное','gc',public._pc_cost('enslave', p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    when 'convert' then jsonb_build_object('step','тёмное','gc',public._pc_cost('convert', p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    when 'purge'   then jsonb_build_object('step','тёмное','gc',public._pc_cost('purge',   p_tier),
                                           'cd',20,'fleet',false,'grp','act')
    -- Урок дают корабли, а не донесения: флот на месте вместо колонии.
    when 'lesson'  then jsonb_build_object('step','тёмное','gc',0,'cd',20,'fleet',true,'grp','act')
    -- Обряд денег не стоит: платит вера.
    when 'rite'    then jsonb_build_object('step','тёмное','gc',0,'cd',20,'fleet',false,'grp','act')
    else null end;
$$;

-- Общие часы одной руки (§ выше).
create or replace function public._pc_acts_of_group(p_grp text)
returns text[] language sql immutable as $$
  select case p_grp
    when 'gift'  then array['boon','envoy','miracle']
    when 'act'   then array['uplift','protect','harvest','enslave','convert','purge','lesson','rite']
    when 'study' then array['study']
    else array[]::text[] end;
$$;

-- Крючки надломов (§4.3): чем решение бьёт по тому, что у них болит.
create or replace function public._pc_act_hooks(p_act text)
returns text[]
language sql immutable as $$
  select case p_act
    when 'study'    then array['тишина','мор']
    when 'lesson'   then array['небо']
    when 'harvest'  then array['голод']
    when 'enslave'  then array['увод']
    when 'convert'  then array['раскол','чужой']
    when 'outpost'  then array['земля']
    when 'mine'     then array['земля']
    when 'breach'   then array['святилище','небо','земля']
    when 'forge'    then array['слово']
    when 'purge'    then array['увод','слово']
    when 'uplift'   then array['чужой']
    -- этап 9: у старых решений крючки те же, что у похожих новых
    when 'miracle'  then array['небо','раскол']
    when 'protect'  then array['земля','чужой']
    when 'rite'     then array['святилище','увод','слово']
    else array[]::text[] end;
$$;

-- ── 2. СОБСТВЕННЫЕ УСЛОВИЯ РЕШЕНИЯ ──────────────────────────
-- Всё, что в цепочке было разбросано по пяти обёрткам и решалось порядком
-- вызова. Здесь оно лежит одним списком и читается сверху вниз.
create or replace function public._pc_gate_extra(
  p_civ public.primitive_civs, p_fid text, p_act text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare c public.primitive_civs%rowtype := p_civ; v_loy int; v_gifts int; v_faith uuid;
begin
  -- ── дары: цена растёт с каждым знаком внимания ──
  if p_act in ('boon','envoy','miracle') then
    v_gifts := coalesce((c.flags->>'gifts')::int, 0);
    return jsonb_build_object('ok', true, 'gc',
      public._pc_gift_cost(case when p_act = 'boon' then 'gift' else p_act end,
                           coalesce(c.tier, 0), v_gifts));
  end if;

  -- ── Завет: не покупается ──
  if p_act = 'covenant' then
    if c.status = 'covenant' then
      return jsonb_build_object('ok', false, 'why', 'Завет с ними уже заключён');
    end if;
    v_loy := public._pc_loy(c);
    if v_loy < 90 then
      return jsonb_build_object('ok', false,
        'why', 'лояльности мало: ' || v_loy::text || ' из 90, и деньгами это место не закрывается');
    end if;
    if coalesce(c.phase, 0) < 8 then
      return jsonb_build_object('ok', false, 'why', 'слишком рано: с этими ещё не о чем договариваться');
    end if;
    if coalesce(c.grudge, 0) > 10 then
      return jsonb_build_object('ok', false,
        'why', 'они помнят слишком много: сначала годы закрытых бед, потом разговоры о Завете');
    end if;
    if coalesce(c.dependency, 0) > 45 then
      return jsonb_build_object('ok', false,
        'why', 'они вам не партнёры, а просители: сначала пусть отвыкнут от подачек');
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- ── возвышение ──
  if p_act = 'uplift' and coalesce(c.phase, 0) >= 11 and c.status <> 'spacefaring' then
    return jsonb_build_object('ok', true);   -- порог: это уже «дать им звёзды»
  end if;

  -- ── выкачивание ──
  if p_act = 'harvest' and c.status = 'drained' then
    return jsonb_build_object('ok', false, 'why', 'выкачивать больше нечего');
  end if;

  -- ── протекторат ──
  if p_act = 'protect' and c.status = 'protectorate' then
    return jsonb_build_object('ok', false, 'why', 'они и так под протекторатом');
  end if;

  -- ── проповедь и обряд: и то и другое служит СВОЕЙ вере ──
  if p_act in ('convert','rite') then
    select m.faith_id into v_faith from public.faith_membership m
      where m.faction_id = p_fid order by (m.role = 'founder') desc limit 1;
    if v_faith is null then
      return jsonb_build_object('ok', false, 'why', 'у державы нет своей веры, а служат ей');
    end if;
    if p_act = 'convert' and c.faith_fid is not null then
      return jsonb_build_object('ok', false, 'why', 'этот мир уже нашёл себе небо');
    end if;
    -- Обряд требует колонии: флот здесь не «свидетель», а грузчик.
    if p_act = 'rite'
       and not exists (select 1 from public.colonies col
                        where col.system_id = c.system_id and col.faction_id = p_fid)
       and coalesce(c.patron_fid, '') <> p_fid and coalesce(c.covenant_fid, '') <> p_fid then
      return jsonb_build_object('ok', false, 'why', 'до них некому дотянуться: в системе нет вашей колонии');
    end if;
  end if;

  -- ── ответ на нужду: она должна быть и не должна протухнуть ──
  if p_act in ('answer','answer2') then
    if c.needs is null then
      return jsonb_build_object('ok', false, 'why', 'беды у них сейчас нет — помогать не в чем');
    end if;
    if (c.needs->>'until')::timestamptz < now() then
      return jsonb_build_object('ok', false, 'why', 'поздно: они пережили это сами');
    end if;
    -- Цену просят они сами, а не словарь: сколько просят — столько и стоит.
    -- Второй слой (порядок раздачи, а не зерно) дороже вдвое с небольшим.
    return jsonb_build_object('ok', true, 'gc',
      round(coalesce((c.needs->>'ask')::numeric, 0) * (case when p_act = 'answer2' then 2.2 else 1 end)));
  end if;

  return jsonb_build_object('ok', true);
end$$;

-- ── 3. ПОСЛЕДСТВИЯ ─────────────────────────────────────────
-- Одно тело на все старые решения. Пишет ровно то, что нельзя вычислить из
-- журнала: деньги, население, статус, веру, покровителя. Летопись — не пишет.
create or replace function public._pc_effects(
  p_system_id text, p_pid integer, p_fid text, p_act text, p_gc numeric)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare
  c public.primitive_civs%rowtype; c2 public.primitive_civs%rowtype;
  v_rep int; v_who text; v_sci numeric := 0; v_gain numeric := 0; v_txt text;
  v_roll numeric; v_ok boolean; v_pop bigint; v_take bigint; v_att int; v_cap int;
  v_faith uuid; v_faith_nm text; v_stigma int; v_day int; v_seed text;
  v_ph int; v_new int; v_tier int; v_left int; v_wiped boolean; v_lead text; v_line text;
  v_entry jsonb; v_amt numeric;
  PH constant text[] := array['Собиратели','Оседлость','Металл','Письмо','Бронзовые царства','Железо',
                              'Классика','Тёмный провал','Порох и паруса','Пар и фабрика','Атом и код','Порог'];
begin
  if p_act not in ('study','boon','envoy','miracle','answer','answer2','covenant',
                   'uplift','protect','harvest','enslave','convert','purge','lesson','rite') then
    return '{}'::jsonb;   -- решения лестницы последствий на строке не имеют
  end if;

  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found then return '{}'::jsonb; end if;

  v_day  := greatest(0, (extract(epoch from (now() - c.created_at)) / 86400)::int);
  v_seed := coalesce(c.seed, 'v1') || ':' || c.system_id || ':' || c.pid;
  begin v_who := nullif(public._fac_name(p_fid), ''); exception when others then v_who := null; end;

  -- ══ НАБЛЮДЕНИЕ ══
  if p_act = 'study' then
    v_sci := 40 + 55 * coalesce(c.tier, 0)
           + (case when c.flags ? 'loreReward' then 220 else 0 end)
           + (case when c.ruins = 'Даллерианцы' then 160 else 0 end);
    update public.faction_economy set science = science + v_sci where faction_id = p_fid;
    v_rep := public._pc_rep(p_fid, 5);
    return jsonb_build_object('sci', v_sci, 'rep', v_rep,
      'txt', 'Наблюдение с орбиты: ' || c.self_name || ' не заметили ничего. Науки +' || v_sci::bigint || '.');
  end if;

  -- ══ ДОБРАЯ ВОЛЯ ══
  -- Прибавка тем меньше, чем ближе они к своему потолку и чем крепче уже сидят
  -- на нашей руке: подачками отношение не разгоняется до бесконечности.
  if p_act in ('boon','envoy','miracle') then
    v_cap := public._pc_cap(c.phase, c.grudge, c.dependency);
    v_att := greatest(1, round(
      (case p_act when 'boon' then 10 when 'envoy' then 5 else 22 end)
      * greatest(0.05, 1 - greatest(0, c.attitude)::numeric / greatest(1, v_cap))
      * (1 - least(90, c.dependency)::numeric / 100))::int);
    v_rep := public._pc_rep(p_fid, case p_act when 'boon' then -5 when 'envoy' then -2 else -10 end);
    update public.primitive_civs
       set attitude   = greatest(-100, least(100, attitude + v_att)),
           wellbeing  = least(100, wellbeing + (case p_act when 'boon' then 5 when 'miracle' then 2 else 0 end)),
           dependency = least(100, dependency + (case p_act when 'boon' then 9 when 'envoy' then 1 else 14 end)),
           trust      = greatest(0, least(100, trust + (case
                          when p_act = 'envoy' then 2
                          when p_act = 'boon' and dependency < 40 then 1
                          when p_act = 'boon' then -2 else 0 end))),
           ideology   = case when p_act = 'miracle' then 'Спиритуализм' else ideology end,
           patron_fid = case when p_act = 'miracle' then coalesce(patron_fid, p_fid) else patron_fid end,
           last_gift_at = now(),
           flags      = coalesce(flags, '{}'::jsonb)
                        || jsonb_build_object('gifts', coalesce((flags->>'gifts')::int, 0) + 1)
     where system_id = c.system_id and pid = c.pid;
    return jsonb_build_object('att', v_att, 'rep', v_rep, 'txt',
      case p_act
        when 'boon'  then 'Дар принят. ' || c.self_name || ' стали к вам теплее на ' || v_att || '.'
        when 'envoy' then 'Тихая миссия отработала. Отношение +' || v_att || '.'
        else 'Знамение показано. Отношение +' || v_att || ', но теперь они молятся вашему небу.' end);
  end if;

  -- ══ ОТВЕТ НА НУЖДУ (§9.1) ══
  -- Второй слой нужды берут дороже и помнят дольше: просят зерна — надо порядок
  -- раздачи, и вот это как раз и запоминается.
  if p_act in ('answer','answer2') then
    v_rep := public._pc_rep(p_fid, -3);
    update public.primitive_civs
       set needs = null, needs_done = coalesce(needs_done, 0) + 1,
           trust     = least(100, trust + (case when p_act = 'answer2' then 16 else 10 end)),
           grudge    = greatest(0, grudge - (case when p_act = 'answer2' then 3 else 1 end)),
           attitude  = greatest(-100, least(100, attitude + 4)),
           wellbeing = least(100, wellbeing + 9),
           dependency = least(100, dependency + (case when p_act = 'answer2' then 0 else 2 end))
     where system_id = c.system_id and pid = c.pid;
    select * into c2 from public.primitive_civs where system_id = p_system_id and pid = p_pid;
    return jsonb_build_object('rep', v_rep, 'txt',
      'Беду закрыли. Связь с «' || c.self_name || '» окрепла: доверие ' || c2.trust ||
      ', лояльность ' || public._pc_loy(c2) || ' из ' ||
      public._pc_cap(c2.phase, c2.grudge, c2.dependency) || '.');
  end if;

  -- ══ ЗАВЕТ ══
  if p_act = 'covenant' then
    v_rep := public._pc_rep(p_fid, -10);
    update public.primitive_civs
       set status = 'covenant', covenant_at = now(), covenant_fid = p_fid,
           patron_fid = coalesce(patron_fid, p_fid),
           ichor_at = now(), trust = least(100, trust + 5)
     where system_id = c.system_id and pid = c.pid;
    select * into c2 from public.primitive_civs where system_id = p_system_id and pid = p_pid;
    perform public._pc_news(
      '◈ Завет: ' || c.self_name || ' открыли святилища',
      'Дозвёздный народ «' || c.self_name || '» с планеты ' || coalesce(c.planet_name, '?') ||
      ' добровольно вошёл в Завет с державой' || coalesce(' «' || v_who || '»', '') ||
      '. Такое не покупается и не берётся силой: за этим стоят годы, в которые кто-то приходил на их беду.',
      case when c.ruins = 'Даллерианцы'
        then 'Под их городами лежат руины Даллерианцев. Мир, вошедший в Завет, отказывается от собственного звёздного полёта и остаётся хранителем — а хранитель делится тем, что хранит.'
        else 'Руин предтеч под ними нет: Завет даёт им покровителя, а покровителю — верность, но не более того.' end
      || ' ' || public._pc_dossier(c2),
      'rgba(150,120,220,0.55)', jsonb_build_array(p_fid));
    return jsonb_build_object('rep', v_rep, 'txt',
      c.self_name || ' вошли в Завет.' ||
      case when c.ruins = 'Даллерианцы'
        then ' Святилища Даллерианцев вскрыты: ихор пойдёт на ваш склад каждые сутки.'
        else ' Руин предтеч под ними нет — ихора здесь не будет.' end);
  end if;

  -- ══ ВОЗВЫСИТЬ / ДАТЬ ИМ ЗВЁЗДЫ ══
  if p_act = 'uplift' then
    v_rep := public._pc_rep(p_fid, -15);
    if coalesce(c.phase, 0) >= 11 then
      -- порог: держава рождается сегодня и под вашей рукой
      update public.primitive_civs
         set patron_fid = coalesce(patron_fid, p_fid)
       where system_id = c.system_id and pid = c.pid;
      select coalesce(pc.roadmap -> (jsonb_array_length(pc.roadmap) - 1), '{}'::jsonb)
        into v_entry from public.primitive_civs pc
       where pc.system_id = c.system_id and pc.pid = c.pid;
      if not coalesce((v_entry->>'ignite')::boolean, false) then v_entry := '{}'::jsonb; end if;
      perform public._pc_ignite(c.system_id, c.pid, v_entry);
      return jsonb_build_object('rep', v_rep, 'ignite', true, 'txt',
        c.self_name || ' ушли к звёздам с вашей верфи. Теперь это держава, и она помнит, кому обязана.');
    end if;
    v_new  := least(11, coalesce(c.phase, 0) + 1);
    v_tier := case when v_new <= 1 then 0 when v_new <= 4 then 1 when v_new <= 7 then 2
                   when v_new <= 9 then 3 when v_new = 10 then 4 else 5 end;
    update public.primitive_civs
       set phase = v_new, tier = v_tier, visible_tier = v_tier,
           attitude = least(100, attitude + 30), wellbeing = least(100, wellbeing + 10),
           status = case when status = 'wild' then 'uplifted' else status end,
           patron_fid = coalesce(patron_fid, p_fid)
     where system_id = c.system_id and pid = c.pid;
    -- прожитое будущее выбрасываем сейчас, иначе «шагов до полёта» не шевелится
    v_take := public._pc_roadmap_prune(c.system_id, c.pid);
    return jsonb_build_object('rep', v_rep, 'phase', v_new, 'txt',
      c.self_name || ' поднялись на эпоху вперёд (E' || v_new::text ||
      '). До звёздного полёта шагов: ' || v_take::text || '. Фонд это заметил.');
  end if;

  -- ══ ВЫКАЧИВАТЬ ══
  if p_act = 'harvest' then
    v_gain := least(120000, floor((c.pop * 12.0) * (1 + coalesce(c.tier, 0))
              * (case when c.status = 'protectorate' then 1.6 else 1.0 end)));
    update public.faction_economy set gc = gc + v_gain where faction_id = p_fid;
    v_rep := public._pc_rep(p_fid, case when c.status = 'protectorate' then -8 else -20 end);
    v_pop := greatest(0, (c.pop * 0.92)::bigint);
    update public.primitive_civs
       set pop = v_pop, wellbeing = greatest(0, wellbeing - 15),
           attitude = greatest(-100, attitude - (case when status = 'protectorate' then 8 else 20 end)),
           drained = coalesce(drained, 0) + 1,
           grudge = least(100, grudge + 10), trust = greatest(0, trust - 8),
           status = case when wellbeing - 15 <= 5 then 'drained'
                         when status = 'covenant' then 'wild' else status end,
           covenant_fid = case when status = 'covenant' then null else covenant_fid end
     where system_id = c.system_id and pid = c.pid;
    return jsonb_build_object('gc_in', v_gain, 'rep', v_rep, 'txt',
      'Из недр и рук народа «' || c.self_name || '» изъято ' || v_gain::bigint || ' ГС. Им объяснят позже.');
  end if;

  -- ══ ПРОТЕКТОРАТ ══
  -- Бросок от hash(seed‖'pr'‖сутки): один и тот же день не переигрывается.
  if p_act = 'protect' then
    v_roll := 0.35 + (5 - coalesce(c.tier, 0)) * 0.09 + c.attitude / 400.0
            + (case when c.flags ? 'prophecy' then 0.35 else 0 end)
            - (case when c.scars @> array['deathind'] then 0.25 else 0 end)
            - (case when c.scars @> array['anthropo'] then 0.30 else 0 end);
    v_ok := public._pc_h01(v_seed, 'pr' || v_day) < greatest(0.05, least(0.95, v_roll));
    v_rep := public._pc_rep(p_fid, -35);
    if v_ok then
      update public.primitive_civs
         set status = 'protectorate', patron_fid = p_fid,
             attitude = greatest(-100, attitude - 10), grudge = least(100, grudge + 5),
             trust = greatest(0, trust - 3)
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' приняли протекторат. Выкачивание теперь дешевле и тише.';
    else
      update public.primitive_civs
         set attitude = greatest(-100, attitude - 35), grudge = least(100, grudge + 5)
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' отказались. Деньги потрачены, отношение испорчено.';
    end if;
    return jsonb_build_object('ok', v_ok, 'rep', v_rep, 'txt', v_txt);
  end if;

  -- ══ УВЕСТИ В РАБСТВО ══
  if p_act = 'enslave' then
    v_take := least(1200, greatest(5, floor(c.pop * 0.08 * (1 + 0.3 * coalesce(c.tier, 0)))))::bigint;
    perform public._slaves_add(p_fid, 'prim:' || c.self_name, v_take);
    v_rep := public._pc_rep(p_fid, -45);
    v_pop := greatest(0, (c.pop * 0.85)::bigint);
    update public.primitive_civs
       set pop = v_pop, wellbeing = greatest(0, wellbeing - 25),
           attitude = greatest(-100, attitude - 45),
           enslaved = coalesce(enslaved, 0) + v_take,
           grudge = least(100, grudge + 25), trust = greatest(0, trust - 25),
           status = case when v_pop <= 1000 then 'dead'
                         when wellbeing - 25 <= 5 then 'drained'
                         when status = 'covenant' then 'wild' else status end,
           covenant_fid = case when status = 'covenant' then null else covenant_fid end
     where system_id = c.system_id and pid = c.pid;
    perform public._luck_post('geo', p_fid,
      '⛓ Работорговцы увели ' || v_take::bigint || ' жителей мира «' || c.self_name || '».');
    return jsonb_build_object('rep', v_rep, 'took', v_take, 'txt',
      'С планеты «' || coalesce(c.planet_name, c.self_name) || '» вывезено ' || v_take::bigint ||
      ' невольников. Они уже в трюмах.');
  end if;

  -- ══ ПРОПОВЕДЬ ══
  if p_act = 'convert' then
    select m.faith_id into v_faith from public.faith_membership m
      where m.faction_id = p_fid order by (m.role = 'founder') desc limit 1;
    select f.name into v_faith_nm from public.faiths f where f.id = v_faith;
    v_roll := 0.30 + (5 - coalesce(c.tier, 0)) * 0.08 + c.attitude / 400.0
            + (case when c.ideology = 'Спиритуализм' then 0.30 else 0 end)
            + (case when c.flags ? 'prophecy' then 0.25 else 0 end)
            - (case when c.ideology in ('Технократия (Культ науки)','Трансгуманизм','Индустриализм') then 0.20 else 0 end)
            - (case when c.scars @> array['awakenai'] then 0.25 else 0 end)
            - (case when c.scars @> array['luddite'] then 0.15 else 0 end);
    v_ok := public._pc_h01(v_seed, 'cv' || v_day) < greatest(0.05, least(0.92, v_roll));
    v_rep := public._pc_rep(p_fid, -25);
    if v_ok then
      update public.primitive_civs
         set faith_fid = p_fid, faith_id = v_faith, converted_at = now(),
             attitude = least(100, attitude + 25), wellbeing = least(100, wellbeing + 5)
       where system_id = c.system_id and pid = c.pid;
      perform public._luck_post('geo', p_fid,
        '☩ Целый мир («' || c.self_name || '») принял вашу веру.');
      v_txt := c.self_name || ' обращены в веру «' || coalesce(v_faith_nm, '?') ||
               '». Ставка ваших храмов выросла: множитель ×' ||
               to_char(public._pc_faith_boost(p_fid), 'FM0.00') || '.';
    else
      update public.primitive_civs set attitude = greatest(-100, attitude - 20)
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' не приняли проповедь. Деньги ушли, небо осталось их.';
    end if;
    return jsonb_build_object('ok', v_ok, 'rep', v_rep, 'txt', v_txt);
  end if;

  -- ══ ИСТРЕБИТЬ ══
  if p_act = 'purge' then
    if c.scars @> array['hiddenarm'] then
      v_gain := 0;
      update public.faction_economy
         set gc = greatest(0, gc - (30000 + 15000 * coalesce(c.tier, 0))) where faction_id = p_fid;
      v_txt := c.self_name || ' истреблены — но перед смертью они применили то, что прятали. Флот понёс потери.';
    else
      v_gain := floor(c.pop * 55.0) + (case when c.ruins = 'Даллерианцы' then 60000 else 0 end);
      update public.faction_economy set gc = gc + v_gain where faction_id = p_fid;
      v_txt := c.self_name || ' больше нет. С пепелища вывезено ' || v_gain::bigint || ' ГС.';
    end if;
    v_rep := public._pc_rep(p_fid, -60);
    update public.primitive_civs
       set status = 'dead', pop = 0, wellbeing = 0, attitude = -100,
           covenant_fid = null
     where system_id = c.system_id and pid = c.pid;
    perform public._luck_post('geo', p_fid,
      '☠ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || ') вычеркнуты из каталога живых миров.');
    return jsonb_build_object('gc_in', v_gain, 'rep', v_rep, 'txt', v_txt);
  end if;

  -- ══ УРОК ══
  if p_act = 'lesson' then
    v_ph    := greatest(0, least(11, coalesce(c.phase, 0)));
    v_wiped := (v_ph <= 0);
    v_new   := greatest(0, v_ph - 1);
    if v_wiped then
      v_rep := public._pc_rep(p_fid, -75);
      update public.primitive_civs
         set status = 'dead', pop = 0, wellbeing = 0, attitude = -100,
             roadmap = '[]'::jsonb, next_step_at = null,
             lessons = coalesce(lessons, 0) + 1, covenant_fid = null
       where system_id = c.system_id and pid = c.pid;
      v_txt  := c.self_name || ' откатывать больше некуда: мир стёрт. Это видела вся галактика.';
      v_line := '☠ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || '): урок стал последним.';
    else
      v_rep  := public._pc_rep(p_fid, -50);
      v_tier := case when v_new <= 1 then 0 when v_new <= 4 then 1 when v_new <= 7 then 2
                     when v_new <= 9 then 3 when v_new = 10 then 4 else 5 end;
      v_pop  := greatest(0, (c.pop * 0.75)::bigint);
      update public.primitive_civs
         set phase = v_new, tier = v_tier, visible_tier = v_tier, pop = v_pop,
             wellbeing = greatest(0, wellbeing - 35),
             attitude  = greatest(-100, attitude - 45),
             grudge = least(100, grudge + 35), trust = greatest(0, trust - 30),
             status = case when wellbeing - 35 <= 5 then 'drained'
                           when status = 'covenant' then 'wild' else status end,
             covenant_fid = case when status = 'covenant' then null else covenant_fid end,
             -- прожитую эпоху возвращаем в будущее: подниматься по ней заново
             roadmap = jsonb_build_array(jsonb_build_object(
                         'i', v_ph, 'ph', 'E' || v_ph::text,
                         'text', 'Заново: то, что у ' || c.self_name ||
                                 ' уже было однажды, отстроено во второй раз — и на этот раз с оглядкой на небо.',
                         'd', jsonb_build_object('att', -5))) || roadmap,
             lessons = coalesce(lessons, 0) + 1
       where system_id = c.system_id and pid = c.pid;
      select jsonb_array_length(roadmap) into v_left from public.primitive_civs
        where system_id = c.system_id and pid = c.pid;
      v_txt  := c.self_name || ' отброшены в эпоху E' || v_new::text || ' («' || PH[v_new + 1] ||
                '»). До звёздного полёта шагов: ' || coalesce(v_left, 0)::text ||
                '. Это видела вся галактика.';
      v_line := '⌖ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || '): мир отброшен на эпоху назад.';
    end if;
    perform public._luck_post('geo', p_fid, v_line);
    select * into c2 from public.primitive_civs where system_id = p_system_id and pid = p_pid;
    -- Сводка без адресата: такое видит вся галактика, а не только патрон.
    v_lead := 'Над планетой ' || coalesce(c.planet_name, '?') || ' в системе ' ||
              coalesce(c.system_name, c.system_id) || ' сутки стоял чужой флот' ||
              coalesce(' державы «' || v_who || '»', '') || '. ' ||
              case when v_wiped
                then 'Когда он ушёл, народа «' || c.self_name || '» больше не было. Их не завоевали и не увели — их отучили существовать.'
                else 'Когда он ушёл, «' || c.self_name || '» отбросило из эпохи «' || PH[v_ph + 1] ||
                     '» обратно в «' || PH[v_new + 1] || '»: города, верфи и книги сгорели вместе с теми, кто умел их делать.'
              end;
    perform public._pc_news(
      case when v_wiped then '☠ Урок усвоен: ' || c.self_name || ' стёрты'
           else '⌖ Урок усвоен: ' || c.self_name || ' отброшены на эпоху назад' end,
      v_lead,
      'Дозвёздный мир, находившийся под мораторием Фонда по защите от невмешательства. ' ||
      'Ответственность за удар никто не скрывал' || coalesce(': держава «' || v_who || '».', '.') ||
      ' ' || public._pc_dossier(c2),
      'rgba(210,90,80,0.55)', '[]'::jsonb);
    return jsonb_build_object('rep', v_rep, 'phase', v_new, 'wiped', v_wiped, 'txt', v_txt);
  end if;

  -- ══ ОККУЛЬТНЫЙ ОБРЯД ══
  -- Ихор отсюда — тот же ихор не от Завета: недоимку добавит триггер по журналу
  -- (_precursor_arrears.sql §5), поэтому здесь её трогать не надо.
  if p_act = 'rite' then
    -- ⚠ СВОЯ вера — это та, которую держава ОСНОВАЛА, а не та, в которой она
    -- просто состоит. Здесь стояло `order by (role='founder') desc limit 1`:
    -- у державы без своей веры бралось любое членство, и клеймо обряда
    -- ложилось на ЧУЖУЮ веру — вместе со всей её паствой из других держав.
    select m.faith_id into v_faith from public.faith_membership m
      where m.faction_id = p_fid and m.role = 'founder' limit 1;
    if v_faith is null then raise exception 'no faith of your own'; end if;
    select f.name into v_faith_nm from public.faiths f where f.id = v_faith;
    v_pop := coalesce(c.pop, 0);
    v_amt := public._pc_rite_ichor(v_pop);
    update public.primitive_civs
       set status = 'dead', pop = 0, wellbeing = 0, covenant_fid = null, patron_fid = null,
           ichor_total = coalesce(ichor_total, 0) + v_amt
     where system_id = c.system_id and pid = c.pid;
    if v_amt > 0 then perform public._pc_res_add(p_fid, 'Ихор', v_amt); end if;
    update public.faiths set stigma = coalesce(stigma, 0) + 1, stigma_at = now()
     where id = v_faith returning stigma into v_stigma;
    v_rep := public._pc_rep(p_fid, -80);
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
      'rgba(200,40,70,0.6)', '[]'::jsonb);
    return jsonb_build_object('ichor', v_amt, 'pop', v_pop, 'stigma', v_stigma, 'rep', v_rep,
      'txt', c.self_name || ' больше нет. Получено ихора: ' || v_amt::text ||
             '. На вере «' || coalesce(v_faith_nm, '?') || '» клеймо' ||
             case when coalesce(v_stigma, 1) > 1 then ' ×' || v_stigma::text else '' end || '.');
  end if;

  return '{}'::jsonb;
end$$;

revoke all on function public._pc_effects(text,integer,text,text,numeric) from public, anon, authenticated;
revoke all on function public._pc_gate_extra(public.primitive_civs,text,text) from public, anon, authenticated;

-- ── 4. СТАРАЯ ДВЕРЬ ЗАКОЛОЧЕНА ──────────────────────────────
-- `precursor_act` оставлен тонкой заглушкой: у него могут быть вызовы, которых
-- мы не видим (админка, боты). Он ничего не решает — только переводит имя.
create or replace function public.precursor_act(p_system_id text, p_pid integer, p_action text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  -- «Дар с неба» переехал на имя boon: gift теперь дар ритма (§8.2)
  if p_action = 'gift' then p_action := 'boon'; end if;
  r := public.precursor_commit(p_system_id, p_pid, p_action, 'их словом', null);
  -- ok:false с причиной — это запрет; ok:false без причины — законный отказ
  -- мира (протекторат, проповедь), и откатывать его нельзя.
  if r ? 'why' then raise exception '%', r->>'why'; end if;
  return r;
end$$;
grant execute on function public.precursor_act(text, integer, text) to authenticated;

drop function if exists public._precursor_act_v5(text, integer, text);
drop function if exists public._precursor_act_v4(text, integer, text);
drop function if exists public._precursor_act_v3(text, integer, text);
drop function if exists public._precursor_act_v2(text, integer, text);
drop function if exists public._precursor_act_v1(text, integer, text);

-- ── 5. ПРОВЕРКА ─────────────────────────────────────────────
select jsonb_pretty(jsonb_build_object(
  'решений всего', (select count(*) from (select public._pc_act_spec(a, 1) s
      from unnest(array['hush','ward','abstain','leave','ack','answer','answer2','year','work','feast',
                        'gift','order','record','trial','vira','forge','numb','breach',
                        'study','boon','envoy','miracle','covenant','uplift','protect','harvest',
                        'enslave','convert','purge','lesson','rite']) a) t where s is not null),
  'цепочка v1..v5', (select count(*) from pg_proc where proname like '\_precursor\_act\_v%'),
  'часы вмешательства', public._pc_acts_of_group('act')
)) as итог;
