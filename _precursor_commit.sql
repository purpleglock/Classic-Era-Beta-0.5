-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 3: precursor_commit()   (lore/precursor_memory.md §19–§20)
--
-- Было: precursor_act → _precursor_act_v5 → v4 → v3 → v2 → v1, пять обёрток,
-- каждая правит последствия предыдущей, и порядок каток решал всё.
-- Стало: ОДНА проверка. Действие не «применяется» — оно ЗАПИСЫВАЕТСЯ В ЖУРНАЛ,
-- а состояние державы из журнала вычисляется (precursor_sim.js).
--
-- Что проверяет сервер (и только это, §19):
--   • деньги, часы (кулдаун), запреты уклада своей веры;
--   • присутствие: колония в системе / патронаж / Завет, флот там, где нужен
--     свидетель, а не платёж (§8.3);
--   • ступень лестницы (§8): слово недоступно, пока нет покоя;
--   • ихор — деньги, значит считает сервер, а не заявка клиента.
--
-- Чего сервер НЕ делает: не пересчитывает всю модель. Полная симуляция —
-- посуточный шаг по одиннадцати крючкам — в plpgsql была бы вторым, неизбежно
-- разъезжающимся её изложением. Вместо этого сервер считает ту же формулу
-- ровно там, где на кону деньги и необратимость: покой, седмица, ихор.
-- Всё случайное — от hash(seed‖повод‖сутки), одной функцией на обеих сторонах.
-- ════════════════════════════════════════════════════════════

-- ── 1. ОБЩИЙ ГПСЧ: зеркало hash32 из precursor_gen.js / precursor_sim.js ──
-- FNV-1a, 32 бита. Без него «одна формула на обеих сторонах» — слова.
create or replace function public._pc_hash32(p_s text)
returns bigint
language plpgsql immutable strict as $$
declare h bigint := 2166136261; i int; b int;
begin
  for i in 1 .. length(p_s) loop
    b := ascii(substr(p_s, i, 1));
    h := (h # b) & 4294967295;                       -- xor
    h := (h * 16777619) & 4294967295;                -- умножение по модулю 2^32
  end loop;
  return h;
end$$;

-- [0,1) от повода — тот же h01(seed, tag), что в клиенте
create or replace function public._pc_h01(p_seed text, p_tag text)
returns numeric
language sql immutable strict as $$
  select public._pc_hash32(p_seed || '|' || p_tag)::numeric / 4294967296.0;
$$;

-- ── 2. СЛОВАРЬ ДЕЙСТВИЙ ────────────────────────────────────
-- step: покой | ритм | слово | тёмное. cd — часы. fleet — нужно быть там лично.
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
    else null end;
$$;

-- Крючки действия — зеркало ACT_HOOKS из precursor_sim.js (§4.3).
create or replace function public._pc_act_hooks(p_act text)
returns text[]
language sql immutable as $$
  select case p_act
    when 'study'   then array['тишина','мор']
    when 'lesson'  then array['небо']
    when 'harvest' then array['голод']
    when 'enslave' then array['увод']
    when 'convert' then array['раскол','чужой']
    when 'outpost' then array['земля']
    when 'mine'    then array['земля']
    when 'breach'  then array['святилище','небо','земля']
    when 'forge'   then array['слово']
    when 'purge'   then array['увод','слово']
    when 'uplift'  then array['чужой']
    else array[]::text[] end;
$$;

-- ── 2.1 ТОЧКИ РАСШИРЕНИЯ ───────────────────────────────────
-- Заглушки. Настоящие тела — в `_precursor_legacy.sql` (этап 9), где под ту же
-- дверь заводятся старые решения: Завет, Возвысить, Обряд, Урок и прочие.
-- Так у проверки и у последствий остаётся ровно по одному телу на всю игру:
-- второй копии `_pc_gate`, как это вышло у Легиона с `legion_engage_tick`, нет.
create or replace function public._pc_acts_of_group(p_grp text)
returns text[] language sql immutable as $$ select array[]::text[] $$;

-- Дополнительные условия конкретного решения: {ok, why} и, если нужно,
-- пересчитанная цена `gc` (у даров она растёт с каждым разом).
create or replace function public._pc_gate_extra(
  p_civ public.primitive_civs, p_fid text, p_act text)
returns jsonb language sql stable as $$ select jsonb_build_object('ok', true) $$;

-- Последствия решения на горячей строке. Возвращает то, что уйдёт в payload
-- журнала и в ответ игроку. Летопись НЕ пишет: она вычисляется (§10).
create or replace function public._pc_effects(
  p_system_id text, p_pid integer, p_fid text, p_act text, p_gc numeric)
returns jsonb language sql volatile as $$ select '{}'::jsonb $$;

-- ── 3. ПОКОЙ (§8.1): вычисляется, а не хранится ────────────
-- Держава в покое, если за последние 45 суток ничьё действие не жало крючок
-- её незакрытого надлома и сейчас не идёт чёрная седмица (§4.4).
-- Та же формула, что в клиенте, — просто суженная до того, что охраняет деньги.
create or replace function public._pc_calm(p_system_id text, p_pid integer)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare c record; v_week int; v_hooks text[]; v_hit text;
begin
  select system_id, pid, anchor, anchor_at, created_at into c
    from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return jsonb_build_object('calm', false, 'why', 'мира нет'); end if;
  if c.anchor is null then return jsonb_build_object('calm', true, 'why', null); end if;

  -- чёрная седмица: их календарь, а не наш
  v_week := (floor(extract(epoch from (now() - c.created_at)) / 604800)::int) % 52;
  if (c.anchor->'weeks') @> to_jsonb(v_week) then
    return jsonb_build_object('calm', false, 'why', 'идёт чёрная седмица — в эту неделю их года говорить не с кем');
  end if;

  -- крючки незакрытых надломов
  select array_agg(distinct w->>'hook') into v_hooks
    from jsonb_array_elements(c.anchor->'wounds') w
   where coalesce(w->>'state','') <> 'изжитый';
  if v_hooks is null then return jsonb_build_object('calm', true, 'why', null); end if;

  -- Считаем крючки только с того дня, как встал якорь: до него мир жил по старым
  -- правилам, где наблюдение было бесплатным. Задним числом не наказывают.
  select a.action into v_hit
    from public.primitive_acts a
   where a.system_id = p_system_id and a.pid = p_pid
     and a.at > greatest(now() - interval '45 days', coalesce(c.anchor_at, '-infinity'::timestamptz))
     and public._pc_act_hooks(a.action) && v_hooks
   order by a.at desc limit 1;

  if v_hit is not null then
    return jsonb_build_object('calm', false,
      'why', 'надлом вскрыт: «' || v_hit || '» задело то, что у них болит. Нужно 45 суток без крючков');
  end if;
  return jsonb_build_object('calm', true, 'why', null);
end$$;

-- ── 4. ЕДИНСТВЕННАЯ ПРОВЕРКА ───────────────────────────────
-- Возвращает {ok, why}. `why` — не код ошибки, а причина для серой кнопки:
-- §8 требует, чтобы в подсказке было написано, почему именно нельзя.
create or replace function public._pc_gate(
  p_system_id text, p_pid integer, p_fid text, p_act text, p_wound text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  c public.primitive_civs%rowtype; sp jsonb; v_bank numeric; v_last timestamptz;
  v_calm jsonb; v_care int; w jsonb; v_kind text; v_grp text[]; v_ext jsonb;
begin
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return jsonb_build_object('ok', false, 'why', 'мира нет'); end if;
  -- Наблюдать можно и за равными: наука с чужой истории Фонду не противна.
  if c.status = 'dead' or (c.status = 'spacefaring' and p_act <> 'study') then
    return jsonb_build_object('ok', false, 'why', 'с ними уже не поговорить');
  end if;

  sp := public._pc_act_spec(p_act, coalesce(c.tier, 0));
  if sp is null then return jsonb_build_object('ok', false, 'why', 'такого решения нет'); end if;

  -- запреты уклада собственной веры
  if p_act = any(public._pc_forbidden(p_fid)) then
    return jsonb_build_object('ok', false, 'why', 'ваш собственный устав это запрещает');
  end if;

  -- чужой патрон
  if c.patron_fid is not null and c.patron_fid <> p_fid then
    return jsonb_build_object('ok', false, 'why', 'у этого мира уже есть покровитель');
  end if;

  -- Присутствие: колония в системе, патронаж или Завет. Решение, которое и так
  -- делается флотом (§8.3), дотягивается флотом же — колония ему не нужна.
  if not (sp->>'fleet')::boolean
     and not exists (select 1 from public.colonies col
                  where col.system_id = c.system_id and col.faction_id = p_fid)
     and coalesce(c.patron_fid, '') <> p_fid and coalesce(c.covenant_fid, '') <> p_fid then
    return jsonb_build_object('ok', false, 'why', 'до них некому дотянуться: в системе нет вашей колонии');
  end if;

  -- свидетель, а не платёж (§8.3, §11.1)
  if (sp->>'fleet')::boolean and not public._pc_has_fleet(p_fid, c.system_id) then
    return jsonb_build_object('ok', false, 'why', 'это делается при них: нужен ваш флот в системе');
  end if;

  -- собственные условия решения (этап 9): лояльность для Завета, своя вера для
  -- проповеди, порог для «дать им звёзды», растущая цена даров
  v_ext := public._pc_gate_extra(c, p_fid, p_act);
  if not coalesce((v_ext->>'ok')::boolean, true) then return v_ext; end if;
  if v_ext ? 'gc' then sp := sp || jsonb_build_object('gc', (v_ext->>'gc')::numeric); end if;

  -- часы. У решений одной руки часы общие: `grp` в словаре — это и есть
  -- та самая «одна рука» (дары в одну сторону, вмешательство в другую).
  if (sp->>'cd')::int > 0 then
    v_grp := coalesce(public._pc_acts_of_group(sp->>'grp'), array[]::text[]);
    if not (p_act = any(v_grp)) then v_grp := v_grp || p_act; end if;
    select max(a.at) into v_last from public.primitive_acts a
      where a.system_id = c.system_id and a.pid = c.pid
        and a.faction_id = p_fid and a.action = any(v_grp);
    if v_last is not null and v_last > now() - ((sp->>'cd')::int || ' hours')::interval then
      return jsonb_build_object('ok', false,
        'why', 'слишком скоро: ещё ' ||
               ceil(extract(epoch from (v_last + ((sp->>'cd')::int || ' hours')::interval - now())) / 3600)::text || ' ч');
    end if;
  end if;

  -- деньги
  select e.gc into v_bank from public.faction_economy e where e.faction_id = p_fid;
  if coalesce(v_bank, 0) < (sp->>'gc')::numeric then
    return jsonb_build_object('ok', false,
      'why', 'не хватает ГС: нужно ' || round((sp->>'gc')::numeric)::bigint::text);
  end if;

  -- ── ступень лестницы: верхняя недоступна, пока не закрыта нижняя (§8) ──
  if sp->>'step' = 'слово' then
    v_calm := public._pc_calm(c.system_id, c.pid);
    if not (v_calm->>'calm')::boolean then
      return jsonb_build_object('ok', false, 'why', 'слово требует покоя. ' || (v_calm->>'why'));
    end if;
    -- ритм: слово берёт только там, где до него приходили снова и снова
    select count(*) into v_care from public.primitive_acts a
      where a.system_id = c.system_id and a.pid = c.pid and a.faction_id = p_fid
        and a.action in ('answer','answer2','year','work','feast','gift','order','ward','ack');
    if v_care < 6 then
      return jsonb_build_object('ok', false,
        'why', 'их слово не для случайных: нужно ' || (6 - v_care)::text || ' отклик(ов) прежде');
    end if;

    -- адресность: суд памяти, вира и запись бьют в конкретный надлом
    if p_act in ('trial','vira','record') then
      if p_wound is null then
        return jsonb_build_object('ok', false, 'why', 'не сказано, о чём именно');
      end if;
      -- Надлом «святилище» в якоре не лежит: его не было при спавне, его сделали вы.
      -- Он есть ровно тогда, когда святилища вскрыты (§15.1).
      if p_wound = 'святилище' then
        if not coalesce((c.flags->>'covenant_locked')::boolean, false) then
          return jsonb_build_object('ok', false, 'why', 'их святилища целы');
        end if;
        w := jsonb_build_object('src','святилище','kind','обида','hook','святилище','state','вскрытый');
      else
        select x into w from jsonb_array_elements(coalesce(c.anchor->'wounds','[]'::jsonb)) x
          where x->>'src' = p_wound;
      end if;
      if w is null then
        return jsonb_build_object('ok', false, 'why', 'такого надлома у них нет');
      end if;
      if coalesce(w->>'state','') = 'изжитый' then
        return jsonb_build_object('ok', false, 'why', 'это уже изжито');
      end if;
      v_kind := w->>'kind';
      -- §12: долг не берётся ни покоем, ни ритмом, ни судом памяти — только вирой
      if p_act = 'trial' and (v_kind = 'долг' or w->>'hook' = 'святилище') then
        return jsonb_build_object('ok', false,
          'why', 'этого судом памяти не взять: они сделали это сами. Только вира');
      end if;
      if p_act = 'vira' and v_kind <> 'долг' and w->>'hook' <> 'святилище' then
        return jsonb_build_object('ok', false, 'why', 'вира — за долг, а это не долг');
      end if;
    end if;
  end if;

  -- §15.1: короткая дорога закрывает долгую навсегда
  if p_act = 'breach' and coalesce(c.ruins, 'нет') = 'нет' then
    return jsonb_build_object('ok', false, 'why', 'под ними нет святилищ — вскрывать нечего');
  end if;

  return jsonb_build_object('ok', true, 'gc', (sp->>'gc')::numeric, 'step', sp->>'step');
end$$;

-- Открытая проверка для интерфейса: кнопка серая, и в подсказке написано, почему.
-- Цену отдаём и при отказе: серая кнопка обязана показывать, СКОЛЬКО это стоит,
-- иначе игрок не понимает, к чему копить. `_pc_gate` цену возвращает только при
-- «можно» — здесь она добирается из словаря и надбавок решения.
create or replace function public.precursor_can(
  p_system_id text, p_pid integer, p_act text, p_wound text default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare g jsonb; c public.primitive_civs%rowtype; sp jsonb; ex jsonb; fid text;
begin
  fid := public._ec_my_fid();
  g := public._pc_gate(p_system_id, p_pid, fid, p_act, p_wound);
  if g ? 'gc' then return g; end if;
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return g; end if;
  sp := public._pc_act_spec(p_act, coalesce(c.tier, 0));
  if sp is null then return g; end if;
  ex := public._pc_gate_extra(c, fid, p_act);
  return g || jsonb_build_object('gc', coalesce((ex->>'gc')::numeric, (sp->>'gc')::numeric),
                                 'step', sp->>'step');
end$$;

-- ── 5. ЗАПИСЬ РЕШЕНИЯ ──────────────────────────────────────
-- Единственное, что происходит: проверка, деньги, СТРОКА В ЖУРНАЛ.
-- Горячая строка почти не трогается — состояние из неё больше не читают.
create or replace function public.precursor_commit(
  p_system_id text, p_pid integer, p_act text,
  p_reg text default 'их словом', p_wound text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  c public.primitive_civs%rowtype; fid text; g jsonb; v_gc numeric;
  v_day int; v_ichor numeric := 0; v_seed text; v_eff jsonb := '{}'::jsonb;
begin
  fid := public._ec_my_fid();
  g := public._pc_gate(p_system_id, p_pid, fid, p_act, p_wound);
  if not (g->>'ok')::boolean then return g; end if;
  if coalesce(p_reg, '') not in ('знамение','их словом','тихо') then p_reg := 'их словом'; end if;

  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid for update;
  v_gc := coalesce((g->>'gc')::numeric, 0);
  if v_gc > 0 then
    update public.faction_economy set gc = gc - v_gc where faction_id = fid and gc >= v_gc;
    if not found then return jsonb_build_object('ok', false, 'why', 'не хватает ГС'); end if;
  end if;

  v_day := greatest(0, (extract(epoch from (now() - c.created_at)) / 86400)::int);
  v_seed := coalesce(c.seed, 'v1') || ':' || c.system_id || ':' || c.pid;

  -- §17 ВСКРЫТИЕ: ихор — деньги, поэтому его объём считает сервер той же формулой,
  -- что клиент показывал в оценке (hash(seed‖'br'‖сутки)).
  if p_act = 'breach' then
    v_ichor := round((40 + 44 * coalesce(c.tier, 0)) * (0.8 + public._pc_h01(v_seed, 'br' || v_day) * 0.6));
    perform public._pc_res_add(fid, 'Ихор', v_ichor);
    update public.primitive_civs
       set flags = coalesce(flags, '{}'::jsonb) || jsonb_build_object('covenant_locked', true),
           ichor_total = coalesce(ichor_total, 0) + v_ichor
     where system_id = c.system_id and pid = c.pid;
    -- §18 НЕДОИМКА: счёт ведётся здесь же, чтобы к этапу 7 его не пришлось искать
    begin
      perform public._pc_arrears_add(fid, c.system_id, c.pid, v_ichor, coalesce(c.tier, 0));
    exception when undefined_function then null; end;
  end if;

  -- §11.3 вира по вскрытым святилищам: не «оплатить стоимость вывезенного», а
  -- ВЕРНУТЬ вывезенное — ихор уходит со склада обратно в святилище.
  if p_act = 'vira' and p_wound = 'святилище' then
    v_ichor := -1 * least(coalesce(c.ichor_total, 0), round(40 + 44 * coalesce(c.tier, 0)));
    if v_ichor < 0 then
      -- вернуть можно только то, что есть на складе: пустой рукой виру не служат
      if coalesce((select (resources->>'Ихор')::numeric from public.faction_economy
                    where faction_id = fid), 0) < abs(v_ichor) then
        return jsonb_build_object('ok', false,
          'why', 'вира здесь — вернуть взятый ихор: нужно ' || abs(v_ichor)::text || ' на складе');
      end if;
      update public.faction_economy
         set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
               to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) + v_ichor, 3)), true)
       where faction_id = fid;
      -- Замок Завета НЕ снимается: вира гасит счёт и изживает надлом, но короткая
      -- дорога закрыла долгую навсегда (§15.1). Это и есть смысл слова «навсегда».
      update public.primitive_civs
         set ichor_total = greatest(0, coalesce(ichor_total, 0) + v_ichor)
       where system_id = c.system_id and pid = c.pid;
      -- §18: возврат гасит недоимку — единственное настоящее оружие против Сбора
      begin
        perform public._pc_arrears_add(fid, c.system_id, c.pid, v_ichor, coalesce(c.tier, 0));
      exception when undefined_function then null; end;
    end if;
  end if;

  -- Последствия старых решений (этап 9). Для решений лестницы тело пустое:
  -- их состояние вычисляется из журнала и на горячей строке не хранится.
  v_eff := coalesce(public._pc_effects(c.system_id, c.pid, fid, p_act, v_gc), '{}'::jsonb);
  if v_eff ? 'ichor' then v_ichor := v_ichor + (v_eff->>'ichor')::numeric; end if;

  update public.primitive_civs
     set last_act_at = now(), last_touch_at = now(), acts = coalesce(acts, 0) + 1,
         contacted_by = coalesce(contacted_by, fid),
         contacted_at = coalesce(contacted_at, now()),
         last_study_at = case when p_act = 'study' then now() else last_study_at end
   where system_id = c.system_id and pid = c.pid;

  insert into public.primitive_acts(system_id, pid, faction_id, action, reg, wound, payload)
    values (c.system_id, c.pid, fid, p_act, p_reg, p_wound,
            jsonb_build_object('gc', v_gc, 'day', v_day, 'ichor', v_ichor, 'step', g->>'step')
            || (v_eff - 'txt'));

  return jsonb_build_object('ok', true, 'gc', v_gc, 'day', v_day,
                            'ichor', v_ichor, 'step', g->>'step', 'reg', p_reg) || v_eff;
end$$;

revoke all on function public.precursor_commit(text, integer, text, text, text) from public;
grant execute on function public.precursor_commit(text, integer, text, text, text) to authenticated;
grant execute on function public.precursor_can(text, integer, text, text) to authenticated;

-- ── 6. ПРОВЕРКА ────────────────────────────────────────────
-- hash32 обязан совпасть с клиентским precursor_sim.hash32: 'abc' → 440920331.
select jsonb_pretty(jsonb_build_object(
  'hash32(abc)', public._pc_hash32('abc'),
  'решений',     (select count(*) from (select public._pc_act_spec(a, 1) s
                    from unnest(array['hush','ward','abstain','leave','ack','answer','answer2','year',
                                      'work','feast','gift','order','record','trial','vira','forge',
                                      'numb','breach']) a) t where s is not null),
  'покой',       (select public._pc_calm(system_id, pid) from public.primitive_civs limit 1)
)) as итог;
