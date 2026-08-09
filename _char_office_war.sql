-- ============================================================
-- АДМИРАЛ И МАРШАЛ: должность работает в БОЮ, а не в бухгалтерии
-- Применять: node tools/db_run.js _char_office_war.sql
-- Порядок: ПОСЛЕ _char_office.sql
--
-- Было: у совета есть только экономические ручки (_faction_mods), поэтому
-- Адмирал и Маршал висели на чужих ключах — «цена колоний» и «откат
-- притязаний». Ерунда: военный пост должен чувствоваться в бою.
--
-- Стало: у поста может быть второй набор — боевой (def->'war'), который
-- врезается в паспорт борта при постановке на доску (триггер _bt_tp_fill):
--   Адмирал (Ловкость) — секунды хода эскадре: манёвр держат штабом.
--   Маршал  (Сила)     — броня: строй держит удар.
-- Экономических модификаторов у обоих больше нет вовсе.
--
-- Зона ответственности тут не при чём: бой идёт там, где идёт, а флоты
-- закрепляются отдельно списком. Поэтому оба поста стали terr=false.
-- ============================================================

create or replace function public._fm_post_def(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'governor'      then '{"stat":"wis","terr":true, "title":"Наместник",      "mods":{"gc":0.02,"build":-0.015}}'
    when 'treasurer'     then '{"stat":"cha","terr":false,"title":"Казначей",       "mods":{"gc":0.03,"claim_cost":-0.01}}'
    when 'industrialist' then '{"stat":"int","terr":true, "title":"Промышленник",   "mods":{"mine":0.02,"build":-0.02}}'
    when 'scientist'     then '{"stat":"int","terr":false,"title":"Учёный совет",   "mods":{"research":-0.025,"sci_flat":0.5}}'
    when 'spymaster'     then '{"stat":"wis","terr":false,"title":"Глава разведки", "mods":{"agents_flat":0.5}}'
    when 'diplomat'      then '{"stat":"cha","terr":false,"title":"Дипломат",       "mods":{"claim_cost":-0.02,"claim_cd":-0.02}}'
    when 'admiral'       then '{"stat":"dex","terr":false,"title":"Адмирал","mods":{},"war":{"tp":0.02}}'
    when 'marshal'       then '{"stat":"str","terr":false,"title":"Маршал", "mods":{},"war":{"armor":0.03}}'
    when 'coruler'       then '{"stat":"cha","terr":false,"title":"Соправитель",    "mods":{"gc":0.02,"research":-0.01}}'
    else null end::jsonb
$$;

-- ── Совет: теперь считает и боевой набор ────────────────────
-- Тело то же, что в _char_office.sql, добавлены wacc/war: вклад военных
-- постов идёт отдельным ведром, чтобы не мешаться с экономикой.
create or replace function public._fm_council(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; ch public.characters; def jsonb; st int; md numeric; cov numeric; w numeric;
  posts jsonb := '[]'::jsonb; acc jsonb := '{}'::jsonb; wacc jsonb := '{}'::jsonb;
  kk text; vv numeric; k text;
  taken text[] := '{}'; own_uid uuid; head public.characters;
  roles text[] := array['governor','treasurer','industrialist','scientist',
                        'spymaster','diplomat','admiral','marshal'];
begin
  -- 1. Действующие служащие: один пост в одни руки, при дубле — старший по опыту.
  for r in
    select m.id, m.user_id, m.role, m.char_slug, m.scope_all, m.scope
      from public.faction_members m
      left join public.characters c on c.slug = m.char_slug
     where m.faction_id = p_fid and m.status = 'active'
     order by m.role, coalesce(c.xp, 0) desc, m.created_at asc
  loop
    def := public._fm_post_def(r.role);
    if def is null or r.role = any(taken) then continue; end if;
    ch := public._ch_of_user(r.user_id, r.char_slug);
    if ch.slug is null then continue; end if;
    taken := taken || r.role;

    st  := public._ch_stat(ch, def->>'stat');
    md  := public._ch_mod(st);
    cov := case when (def->>'terr')::boolean
                then public._fm_coverage(p_fid, r.scope_all, r.scope) else 1 end;
    w   := md * cov;

    for kk, vv in select key, value::numeric from jsonb_each_text(coalesce(def->'mods','{}'::jsonb)) loop
      acc := jsonb_set(acc, array[kk], to_jsonb(coalesce((acc->>kk)::numeric,0) + vv * w), true);
    end loop;
    for kk, vv in select key, value::numeric from jsonb_each_text(coalesce(def->'war','{}'::jsonb)) loop
      wacc := jsonb_set(wacc, array[kk], to_jsonb(coalesce((wacc->>kk)::numeric,0) + vv * w), true);
    end loop;

    posts := posts || jsonb_build_object(
      'role', r.role, 'title', def->>'title', 'head', false,
      'char_slug', ch.slug, 'char_name', ch.name, 'char_class', ch.class,
      'stat', def->>'stat', 'stat_val', st, 'mod', md,
      'lvl', public._ch_lvl(ch.xp), 'xp', ch.xp,
      'coverage', round(cov, 2),
      'mods', (select coalesce(jsonb_object_agg(key, round((value::numeric) * w, 4)), '{}'::jsonb)
                 from jsonb_each_text(coalesce(def->'mods','{}'::jsonb))),
      'war',  (select coalesce(jsonb_object_agg(key, round((value::numeric) * w, 4)), '{}'::jsonb)
                 from jsonb_each_text(coalesce(def->'war','{}'::jsonb))));
  end loop;

  -- 2. Глава государства закрывает вакансии вполсилы.
  select a.owner_id into own_uid from public.faction_applications a
   where a.faction_id = p_fid and a.status = 'approved' order by a.updated_at desc limit 1;
  if own_uid is not null then
    head := public._ch_of_user(own_uid);
    if head.slug is not null then
      foreach k in array roles loop
        if k = any(taken) then continue; end if;
        def := public._fm_post_def(k);
        st  := public._ch_stat(head, def->>'stat');
        md  := public._ch_mod(st);
        w   := md * 0.5;
        posts := posts || jsonb_build_object(
          'role', k, 'title', def->>'title', 'head', true,
          'char_slug', head.slug, 'char_name', head.name, 'char_class', head.class,
          'stat', def->>'stat', 'stat_val', st, 'mod', md,
          'lvl', public._ch_lvl(head.xp), 'xp', head.xp, 'coverage', 1,
          'mods', (select coalesce(jsonb_object_agg(key, round((value::numeric) * w, 4)), '{}'::jsonb)
                     from jsonb_each_text(coalesce(def->'mods','{}'::jsonb))),
          'war',  (select coalesce(jsonb_object_agg(key, round((value::numeric) * w, 4)), '{}'::jsonb)
                     from jsonb_each_text(coalesce(def->'war','{}'::jsonb))));
        for kk, vv in select key, value::numeric from jsonb_each_text(coalesce(def->'mods','{}'::jsonb)) loop
          acc := jsonb_set(acc, array[kk], to_jsonb(coalesce((acc->>kk)::numeric,0) + vv * w), true);
        end loop;
        for kk, vv in select key, value::numeric from jsonb_each_text(coalesce(def->'war','{}'::jsonb)) loop
          wacc := jsonb_set(wacc, array[kk], to_jsonb(coalesce((wacc->>kk)::numeric,0) + vv * w), true);
        end loop;
      end loop;
    end if;
  end if;

  -- 3. Потолки: совет — приправа, а не вторая доктрина.
  return jsonb_build_object('posts', posts,
    'mods', jsonb_build_object(
      'gc',          greatest(-0.30, least(0.30, coalesce((acc->>'gc')::numeric, 0))),
      'mine',        greatest(-0.30, least(0.30, coalesce((acc->>'mine')::numeric, 0))),
      'build',       greatest(-0.25, least(0.25, coalesce((acc->>'build')::numeric, 0))),
      'research',    greatest(-0.25, least(0.25, coalesce((acc->>'research')::numeric, 0))),
      'colonize',    greatest(-0.25, least(0.25, coalesce((acc->>'colonize')::numeric, 0))),
      'claim_cost',  greatest(-0.25, least(0.25, coalesce((acc->>'claim_cost')::numeric, 0))),
      'claim_cd',    greatest(-0.25, least(0.25, coalesce((acc->>'claim_cd')::numeric, 0))),
      'sci_flat',    greatest(-4, least(4, round(coalesce((acc->>'sci_flat')::numeric, 0))))::int,
      -- Разведка: ключ множится на 5 в _spy_power, поэтому потолок вдвое ниже
      -- прочих плоских — иначе один совет даёт ±20 п.п. к успеху операций.
      'agents_flat', greatest(-2, least(2, round(coalesce((acc->>'agents_flat')::numeric, 0))))::int),
    'war', jsonb_build_object(
      'tp',    greatest(-0.15, least(0.15, coalesce((wacc->>'tp')::numeric, 0))),
      'armor', greatest(-0.20, least(0.20, coalesce((wacc->>'armor')::numeric, 0)))));
end$$;

-- ── Боевой вклад совета одной строкой ───────────────────────
-- Считается на КАЖДЫЙ борт при постановке на доску, поэтому идёт мимо
-- сборки полного совета: только два числа, одним проходом по составу.
create or replace function public._fm_war_mods(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare tp numeric := 0; ar numeric := 0; r record; ch public.characters;
        def jsonb; w numeric; taken text[] := '{}'; own_uid uuid; head public.characters;
begin
  if p_fid is null or p_fid = 'bot' then return jsonb_build_object('tp',0,'armor',0); end if;

  for r in
    select m.user_id, m.role, m.char_slug
      from public.faction_members m
      left join public.characters c on c.slug = m.char_slug
     where m.faction_id = p_fid and m.status = 'active' and m.role in ('admiral','marshal')
     order by m.role, coalesce(c.xp, 0) desc, m.created_at asc
  loop
    if r.role = any(taken) then continue; end if;
    ch := public._ch_of_user(r.user_id, r.char_slug);
    if ch.slug is null then continue; end if;
    taken := taken || r.role;
    def := public._fm_post_def(r.role);
    w   := public._ch_mod(public._ch_stat(ch, def->>'stat'));
    tp  := tp + coalesce((def->'war'->>'tp')::numeric, 0)    * w;
    ar  := ar + coalesce((def->'war'->>'armor')::numeric, 0) * w;
  end loop;

  -- Вакантный военный пост держит сам правитель — вполсилы.
  if array_length(taken, 1) is null or not ('admiral' = any(taken) and 'marshal' = any(taken)) then
    select a.owner_id into own_uid from public.faction_applications a
     where a.faction_id = p_fid and a.status = 'approved' order by a.updated_at desc limit 1;
    if own_uid is not null then
      head := public._ch_of_user(own_uid);
      if head.slug is not null then
        if not ('admiral' = any(taken)) then
          tp := tp + 0.02 * public._ch_mod(public._ch_stat(head, 'dex')) * 0.5;
        end if;
        if not ('marshal' = any(taken)) then
          ar := ar + 0.03 * public._ch_mod(public._ch_stat(head, 'str')) * 0.5;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'tp',    greatest(-0.15, least(0.15, tp)),
    'armor', greatest(-0.20, least(0.20, ar)));
end$$;

-- ── Паспорт борта: секунды хода и броня от штаба ─────────────
-- Тело взято ЖИВЫМ дампом (_reactor_battle_link.sql), добавлен только
-- хвост со штабным множителем. Реакторный коэффициент считается первым:
-- совет правит уже итог, а не полуфабрикат.
create or replace function public._bt_tp_fill()
returns trigger language plpgsql as $$
declare sp jsonb; rg jsonb; k numeric; wm jsonb;
begin
  sp := public._bt_shield_spec(new.cls);
  new.tp_max     := public._bt_tp_max();
  new.tp         := new.tp_max;
  new.mitig      := (sp->>'m')::numeric;
  new.reduc      := (sp->>'r')::numeric;
  new.shield     := 0;            -- секунд щита поднято: на своём ходу ещё не решали
  new.max_shield := 0;            -- легаси-ёмкость больше не участвует в расчёте

  -- Своя энергоустановка правит пул и заметность. Боты и каталожные реакторы
  -- сюда не попадают — у них нет ни проекта, ни reactorId.
  rg := public._rg_unit_reactor(new.unit_id);
  if rg ? 'stab' then
    k := public._rg_tp_coef((rg->>'stab')::numeric);
    new.tp_max := round(new.tp_max * k, 2);
    new.tp     := new.tp_max;
    -- Тепловая сигнатура срезает скрытность борта. В ноль уводить нельзя:
    -- нулевая скрытность = радар врага на полную дальность, а это уже не
    -- «горячий борт», а слепой борт.
    new.stealth := greatest(1, new.stealth - round(coalesce((rg->>'sig')::numeric, 0))::int);
  end if;

  -- ШТАБ ДЕРЖАВЫ (_char_office_war.sql): Адмирал держит манёвр, Маршал — строй.
  -- Ошибка здесь не должна мешать постановке борта на доску.
  begin
    wm := public._fm_war_mods(new.fid);
    if coalesce((wm->>'tp')::numeric, 0) <> 0 then
      new.tp_max := greatest(1, round(new.tp_max * (1 + (wm->>'tp')::numeric), 2));
      new.tp     := new.tp_max;
    end if;
    if coalesce((wm->>'armor')::numeric, 0) <> 0 and coalesce(new.armor, 0) > 0 then
      new.armor := round(new.armor * (1 + (wm->>'armor')::numeric), 2);
    end if;
  exception when others then null;
  end;

  return new;
end$$;
