-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ГОЛОС ПОДКЛЮЧЁН К СОБЫТИЯМ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_lines.sql, _angel_cause.sql, _angel_voice.sql.
-- Надмножество `_angel_declare`, `_angel_anchor_sweep`, `_angel_clock_tick`,
-- `_angel_ascend`, `_angel_teardown`. Идемпотентно.
--
-- ЧТО МЕНЯЕТСЯ. Везде, где ангел раньше выдавал глитченый канцелярит, он
-- теперь ГОВОРИТ. Механические факты никуда не деваются — они остаются
-- отдельными строками ленты (кто снял якорь, на сколько сошлись печати), но
-- пишутся человеческим языком и БЕЗ помех: их группирует часовая сводка.
--
-- ⚠️ РАЗДЕЛЕНИЕ, КОТОРОЕ НАДО ДЕРЖАТЬ ВПРЕДЬ:
--   • ФАКТ — сухо, стабильным заголовком, без единого случайного символа.
--     По нему игрок принимает решения, и его схлопывает сводка.
--   • РЕПЛИКА — голос босса, отдельной строкой, с отбоем.
-- Мешать одно с другим и было исходной ошибкой.
-- ════════════════════════════════════════════════════════════

-- ── 1. ПРИХОД ───────────────────────────────────────────────
-- Надмножество `_angel_declare` (_angel_cause.sql): заслонка реестра и
-- шумовой повод на месте, сводка о войне переписана на голос.
create or replace function public._angel_declare(p_target text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; w uuid; nfoes int;
begin
  af := public._angel_fid();
  if af is null or p_target is null or p_target = af then
    return jsonb_build_object('ok', false);
  end if;
  if not exists (select 1 from public.faction_applications
                  where faction_id = p_target and status = 'approved') then
    return jsonb_build_object('ok', false, 'why', 'нет такой державы');
  end if;
  if public.at_war(af, p_target) then return jsonb_build_object('ok', true, 'already', true); end if;

  select count(*) into nfoes from public._angel_foes(af);
  if nfoes > 0 and not exists (select 1 from public._angel_foes(af) f where f.fid = p_target) then
    return jsonb_build_object('ok', true, 'skipped', 'не в реестре', 'fid', p_target);
  end if;

  insert into public.wars(attacker_fid, defender_fid, cause)
    values (af, p_target, public._angel_cause()) returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, af, 'attacker'), (w, p_target, 'defender');

  -- ФАКТ: сухо и стабильно. Державе надо знать, что она в войне.
  perform public._war_news(
    '◈ Престол объявил войну: ' || public._war_nm(p_target),
    'Отметка вышла из прыжка над их мирами. Переговоров не было — их не с кем вести.',
    jsonb_build_array(af, p_target));
  -- РЕПЛИКА: отдельной строкой, редко.
  perform public._angel_speak('arrive', 180);

  return jsonb_build_object('ok', true, 'war_id', w);
end$$;
revoke all on function public._angel_declare(text) from public;

-- ── 2. ЯКОРЬ СНЯТ ───────────────────────────────────────────
-- Надмножество `_angel_anchor_sweep` (_angel_anchors.sql). Правка одна:
-- после факта о снятии он отвечает. Последний снятый якорь — своя реплика:
-- это перелом партии, и молчать тут нельзя.
create or replace function public._angel_anchor_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; r record; taker text; broke int := 0; lost numeric := 0;
        sysname text; left_n int;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  perform public._angel_anchor_sync();

  for r in select * from public.angel_anchor
            where faction_id = af and broken_at is null
  loop
    if exists (select 1 from public.fleets f
                where f.faction_id = af and f.system_id = r.system_id) then
      continue;
    end if;

    select f.faction_id into taker
      from public.fleets f
     where f.system_id = r.system_id and f.status = 'idle'
       and f.faction_id is distinct from af
       and f.faction_id in (select public.war_enemies_of(af))
     order by (select count(*) from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb))) desc
     limit 1;
    if taker is null then continue; end if;

    update public.angel_anchor
       set broken_at = now(), broken_by = taker
     where system_id = r.system_id;

    update public.angel_state
       set seals = greatest(0, seals - public._angel_anchor_const('break_seal')),
           last_hit = now()
     where faction_id = af;
    lost  := lost + public._angel_anchor_const('break_seal');
    broke := broke + 1;

    select count(*) into left_n from public.angel_anchor
     where faction_id = af and broken_at is null;
    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = r.system_id;

    perform public._war_news(
      '◈ Якорь снят: ' || coalesce(sysname, r.system_id),
      format('Флоты %s заняли переплавленную систему «%s» и удерживают её. '
          || 'Печати Престола сошлись на %s меньше, и эта система больше его не залечивает. '
          || 'Якорей осталось: %s.',
          public._war_nm(taker), coalesce(sysname, r.system_id),
          public._angel_anchor_const('break_seal')::int, left_n),
      jsonb_build_array(taker, af));

    -- Реплика. Последний якорь — без отбоя: такое говорится один раз за партию.
    if left_n = 0 then perform public._angel_speak('anchor_last', 0);
    else                perform public._angel_speak('anchor_lost', 120);
    end if;

    if (select seals from public.angel_state where faction_id = af) <= 0 then
      begin perform public._angel_fall(af, taker); exception when others then null; end;
      exit;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'broken', broke, 'seals_lost', lost,
    'live', (select count(*) from public.angel_anchor where faction_id = af and broken_at is null));
end$$;
revoke all on function public._angel_anchor_sweep() from public;

-- ── 3. ЧАСЫ ─────────────────────────────────────────────────
-- Надмножество `_angel_clock_tick` (_angel_voice.sql). Ступени теперь —
-- одна сухая строка счёта плюс одна реплика. Глитч убран весь.
create or replace function public._angel_clock_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; pct numeric; rung int; want int; c jsonb;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  c    := public.angel_clock();
  pct  := (c->>'pct')::numeric;
  select coalesce(a.rung, 0) into rung from public.angel_state a where a.faction_id = af;
  want := case when pct >= 100 then 5 when pct >= 90 then 4
               when pct >= 75  then 3 when pct >= 50 then 2
               when pct >= 25  then 1 else 0 end;
  if want <= rung then return jsonb_build_object('ok', true, 'pct', pct, 'rung', rung); end if;

  update public.angel_state set rung = want where faction_id = af;

  perform public._war_news(
    '◈ Вознесение: ' || round(pct)::text || '%',
    format('Сводный учёт населения по галактике сходится с недостачей: %s из %s. '
        || 'Миров переплавлено: %s. Якорей за отметкой: %s.',
      round((c->>'taken')::numeric)::text, round((c->>'goal')::numeric)::text,
      c->>'worlds', c->>'anchors'),
    null);

  -- Реплика ступени. Без отбоя: каждая звучит ровно один раз за партию.
  perform public._angel_speak(
    case want when 1 then 'rung25' when 2 then 'rung50'
              when 3 then 'rung75' when 4 then 'rung90' else 'ascend' end, 0);

  if want = 5 then
    begin perform public._angel_ascend(af); exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'pct', pct, 'rung', want, 'rang', true);
end$$;
revoke all on function public._angel_clock_tick() from public;

notify pgrst, 'reload schema';

-- ── 4. ПРОБА ГОЛОСА ─────────────────────────────────────────
-- Показываем по одной реплике каждой ситуации, не трогая ленту и отбои.
do $$
declare r record;
begin
  raise notice '── ГОЛОС ПРЕСТОЛА ──';
  for r in select sit, count(*) n from public.angel_line group by sit order by sit loop
    raise notice '  [%] реплик %: «%»', r.sit, r.n, public._angel_say(r.sit);
  end loop;
end$$;
