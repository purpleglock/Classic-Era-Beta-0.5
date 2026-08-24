-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — РЕЕСТР: ОНО ПОМНИТ ВСЕХ, КТО ПОДНЯЛ ОРУЖИЕ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_ai.sql и _angel_floor.sql. Надмножество
-- `_angel_declare` и `_angel_pick_target`. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Война велась против АЛЬЯНСА — и он записан в базе:
--
--   война «ДеМЗАфикация», 18.08 — war_sides:
--     defender  Шестнадцатая Волна           18.08 08:46
--     defender  Свободный Союз Колоний       18.08 08:52
--     defender  Ост-Фронтирское Государство  18.08 12:44
--     defender  Ааа'дукиль                   18.08 20:06
--
-- Четыре державы, собравшиеся против него за двенадцать часов. А кризис
-- всю неделю доедал Алую Унию — девятую по силе, к Альянсу отношения не
-- имеющую. Почему: `_angel_pick_target` искал ЛЮБУЮ чужую систему в пяти
-- прыжках, а `angel_war_tick` §9.25 объявлял войну всем, у кого нашлась
-- колония там, где сел ковчег. Повод так и назывался — «Присутствие».
--
-- ПРАВИЛО. У кризиса есть сторона и память. Реестр — это все, кто хоть раз
-- стоял против него в `war_sides`. Из реестра не выходят: ни миром, ни
-- гибелью тела (войны больше не гасятся, см. _angel_floor.sql). Кто вступится
-- за них сейчас — впишется туда же обычным вступлением в войну.
--
-- ⚠️ РАДИУС СНЯТ. Пять прыжков были нужны, чтобы кризис не прыгал через всю
-- карту. Теперь его держит не радиус, а цель: он идёт к своему врагу, сколько
-- бы до него ни было. Случайных держав по дороге он не трогает — им и
-- объявлять нечего.
-- ════════════════════════════════════════════════════════════

-- ── 1. РЕЕСТР ───────────────────────────────────────────────
-- Все войны ангела, любого статуса, обе стороны — берём противоположную.
-- `war_sides` держит и тех, кто вступил позже главных участников: именно
-- они и есть Альянс.
-- `since` — когда этот враг попал в реестр. По нему и идёт очередь: кризис
-- доедает то, что начал, а не то, что ближе. Иначе он так и остался бы возле
-- Алой Унии — она попала в реестр по той самой ошибке, которую чиним, и
-- просто стоит ближе всех к его гнезду.
create or replace function public._angel_foes(p_fid text)
returns table(fid text, since timestamptz)
language sql stable security definer set search_path=public as $$
  select ws.fid, min(w.started_at)
    from public.wars w
    join public.war_sides ws on ws.war_id = w.id
   where (w.attacker_fid = p_fid or w.defender_fid = p_fid)
     and ws.fid is distinct from p_fid
     and ws.side is distinct from (select side from public.war_sides
                                    where war_id = w.id and fid = p_fid limit 1)
   group by ws.fid
$$;
revoke all on function public._angel_foes(text) from public;
grant execute on function public._angel_foes(text) to authenticated;

-- ── 2. РАССТОЯНИЯ ОДНИМ ОБХОДОМ ─────────────────────────────
-- ⚠️ НЕ `_mza_hops` в ORDER BY. Та функция — рекурсивный обход НА КАЖДУЮ ПАРУ;
-- при снятом радиусе и 342 системах это 342 обхода на выбор цели, и тик встал
-- бы намертво (так уже было с `_bt_arm`, см. battle-state-timeout-angel-arm).
-- Здесь один обход от текущей системы сразу до всех.
create or replace function public._angel_dist(p_from text, p_max int default 40)
returns table(sys text, d int) language sql stable security definer set search_path=public as $$
  with recursive r(id, d) as (
    select p_from, 0
    union
    select case when l.a_id = r.id then l.b_id else l.a_id end, r.d + 1
      from r join public.map_hyperlanes l on (l.a_id = r.id or l.b_id = r.id)
     where r.d < p_max
  )
  select id, min(d)::int from r group by id
$$;
revoke all on function public._angel_dist(text,int) from public;

-- ── 3. ОБЪЯВЛЕНИЕ ВОЙНЫ — НАДМНОЖЕСТВО ──────────────────────
-- Дословный `_angel_declare` (_angel_ai.sql), плюс заслонка реестра и
-- единый повод. §9.25 тика по-прежнему зовёт эту дверь на каждого, у кого
-- нашлась колония под ковчегом, — но теперь она отвечает «нет» всем, кроме
-- своих врагов. Переписывать сам тик не нужно.
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

  -- ЗАСЛОНКА РЕЕСТРА. Пока реестр пуст — кризис только начинается, и первый
  -- враг назначается по факту встречи: это и есть завязка войны. Как только
  -- в реестре кто-то есть, случайные соседи неприкосновенны.
  select count(*) into nfoes from public._angel_foes(af);
  if nfoes > 0 and not exists (select 1 from public._angel_foes(af) f where f.fid = p_target) then
    return jsonb_build_object('ok', true, 'skipped', 'не в реестре', 'fid', p_target);
  end if;

  -- ⚠️ ПОВОД ОДИН НА ВСЮ ВОЙНУ. «Присутствие» было симптомом забывчивости:
  -- каждая новая война заводилась как самостоятельная стычка с соседом.
  insert into public.wars(attacker_fid, defender_fid, cause)
    values (af, p_target, 'ДеМЗАфикация') returning id into w;
  insert into public.war_sides(war_id, fid, side)
    values (w, af, 'attacker'), (w, p_target, 'defender');

  perform public._war_news(
    public._angel_glitch('◈ Оно пришло: ' || public._war_nm(af) || ' → ' || public._war_nm(p_target), 0.18),
    public._angel_glitch(
      'Отметка вышла из прыжка над их мирами. Переговоров не было: их не с кем вести. ', 0.16)
      || public._angel_scream(14),
    jsonb_build_array(af, p_target));
  return jsonb_build_object('ok', true, 'war_id', w);
end$$;
revoke all on function public._angel_declare(text) from public;

-- ── 4. ВЫБОР ЦЕЛИ — НАДМНОЖЕСТВО ────────────────────────────
create or replace function public._angel_pick_target()
returns text language plpgsql security definer set search_path=public as $$
declare a record; f record; here text; res text; log jsonb; nfoes int;
begin
  select * into a from public.angel_state where fell_at is null order by created_at limit 1;
  if a.faction_id is null then return null; end if;
  select * into f from public.fleets where id = a.fleet_id;
  here := coalesce(f.system_id, f.from_sys);
  if here is null then return null; end if;
  log := coalesce(a.path_log, '[]'::jsonb);

  select count(*) into nfoes from public._angel_foes(a.faction_id);

  -- 1) РЕЕСТР. Ближайший мир того, кто против него воевал. Радиуса нет:
  -- Альянс не перестаёт быть врагом оттого, что успел отойти подальше.
  if nfoes > 0 then
    -- ⚠️ ОЧЕРЁДНОСТЬ — ПО СТАРШИНСТВУ ВОЙНЫ, а не по близости. Сначала тот,
    -- с кем война началась раньше: Шестнадцатая Волна и Альянс. Только когда
    -- у старшего врага не осталось досягаемых миров, очередь идёт дальше.
    select ms.id into res
      from public.map_systems ms
      join public._angel_dist(here, 40) dd on dd.sys = ms.id
      join lateral (
        select min(fo.since) as since
          from public.colonies c
          join public._angel_foes(a.faction_id) fo on fo.fid = c.faction_id
         where c.system_id = ms.id
      ) q on q.since is not null
     where ms.id <> here
     order by q.since asc,
              (log ? ms.id) asc,
              dd.d asc,
              (select count(*) from public.colonies c where c.system_id = ms.id) desc
     limit 1;
    if res is not null then return res; end if;
    -- Реестр цел, но досягаемых миров у них нет — падаем в общий поиск ниже:
    -- стоять на месте кризису нельзя, а идти всё равно надо к людям.
  end if;

  -- 2) ЗАВЯЗКА. Реестр пуст (или враги недосягаемы) — ближайший чужой мир.
  -- Именно здесь кризис заводит себе первого врага, и дальше держится за него.
  select ms.id into res
    from public.map_systems ms
    join public._angel_dist(here, 40) dd on dd.sys = ms.id
   where ms.id <> here
     and exists (select 1 from public.colonies c
                  where c.system_id = ms.id and c.faction_id is distinct from a.faction_id)
   order by (log ? ms.id) asc,
            dd.d asc,
            (select coalesce(sum(coalesce(c.pop,0)),0) from public.colonies c
              where c.system_id = ms.id) desc
   limit 1;
  if res is not null then return res; end if;

  -- 3) Хоть куда, лишь бы не стоять.
  select case when l.a_id = here then l.b_id else l.a_id end into res
    from public.map_hyperlanes l
   where l.a_id = here or l.b_id = here
   order by (log ? case when l.a_id = here then l.b_id else l.a_id end) asc, random()
   limit 1;
  return res;
end$$;
revoke all on function public._angel_pick_target() from public;

notify pgrst, 'reload schema';

-- ── 5. ПОКАЗАТЬ РЕЕСТР И КУДА ОНО ПОЙДЁТ ────────────────────
do $$
declare af text; r record; t text;
begin
  select faction_id into af from public.angel_state where fell_at is null limit 1;
  if af is null then raise notice 'ангела нет'; return; end if;
  raise notice 'РЕЕСТР кризиса %:', public._war_nm(af);
  for r in select f.fid, f.since, public._war_nm(f.fid) nm,
                  (select count(*) from public.colonies c where c.faction_id = f.fid) col
             from public._angel_foes(af) f order by f.since asc
  loop
    raise notice '   % — % колоний, в реестре с %', r.nm, r.col, r.since::date;
  end loop;
  t := public._angel_pick_target();
  raise notice 'СЛЕДУЮЩАЯ ЦЕЛЬ: % (%)', t,
    coalesce((select string_agg(distinct public._war_nm(c.faction_id), ', ')
                from public.colonies c where c.system_id = t), 'пусто');
end$$;
