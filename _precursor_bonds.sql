-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · УЗЫ, ЗАВЕТ И ИХОР
--
-- ПОЧЕМУ. Отношение к контакту было одной цифрой, которую покупали за ГС:
-- три дара подряд — и дикарь любит тебя на сотню. Держава с большим доходом
-- получала любой мир мгновенно и без истории. Здесь это чинится.
--
-- ТЕПЕРЬ ОТНОШЕНИЕ — ЭТО ЧЕТЫРЕ ЦИФРЫ, А ЛОЯЛЬНОСТЬ — ИХ СЛЕДСТВИЕ:
--   attitude    «мнение о вас»  — быстро качается дарами (как раньше);
--   trust       «связь»         — растёт ТОЛЬКО от закрытых нужд и тихих
--                                 миссий, тает от молчания и от подачек;
--   dependency  «зависимость»   — растёт от каждого дара; выше 40 начинает
--                                 съедать потолок: карго-культ вместо народа;
--   grudge      «память обид»   — выкачивание, рабство, урок; не забывается,
--                                 снимается только годами закрытых нужд.
--
--   ЛОЯЛЬНОСТЬ = min(потолок, 0.45·attitude + 0.55·trust)
--   ПОТОЛОК    = min(100, 40 + 6·фаза) − grudge − max(0, dependency − 40)
--
-- Из этого следует главное: дикарь из каменного века физически не может быть
-- предан на 100 — он не понимает, кто вы такие (потолок фазы). Спам дарами
-- сам себе ставит крышу (dependency). Один выкачанный мир не отмывается
-- деньгами (grudge). Быстрый путь наверх ровно один — НУЖДЫ.
--
-- НУЖДЫ. Раз в недельный ход у мира с шансом появляется беда (мор, засуха,
-- война царств, раскол…) со сроком в 5 суток. Ответить — единственный крупный
-- источник trust (+10) и единственный способ снять grudge (−1). Промолчать —
-- −5 trust, +3 grudge: вас звали, вы не пришли.
--
-- ЗАВЕТ. Лояльность ≥ 90 при чистой памяти открывает ритуал «Завет».
-- Мир под Заветом НЕ УЛЕТАЕТ к звёздам (они считают своим делом хранить то,
-- что лежит у них под ногами), и если под ногами лежат ДАЛЛЕРИАНСКИЕ РУИНЫ —
-- каждые сутки отдаёт покровителю ИХОР: кровь предтеч из вскрытых святилищ.
--
-- ИХОР — легендарный ресурс, который нельзя выкопать экстрактором. Только
-- Завет. Ставка: 0.6 + 0.2·тир в сутки, ×1.25 при лояльности ≥ 95.
-- Даллерианский мир 4-го тира ≈ 1.4–1.75 в сутки: две недели на один
-- «Пост древних стражей» (30 ихора), около месяца на батарею (50).
--
-- ⚠ ПОРЯДОК КАТКИ: ethics → growth → goodwill → lesson → ЭТОТ ФАЙЛ.
--   Обёртка precursor_act переименована в _precursor_act_v4,
--   precursor_step  → _precursor_step_v1,
--   precursor_tick_all → _precursor_tick_all_v1.
--   Перекат любого предыдущего файла после этого вернёт старые обёртки.
-- ?v=20260728bonds1
-- ════════════════════════════════════════════════════════════

-- ── 1. ПОЛЯ ───────────────────────────────────────────────
alter table public.primitive_civs
  add column if not exists trust        int  not null default 0,
  add column if not exists dependency   int  not null default 0,
  add column if not exists grudge       int  not null default 0,
  add column if not exists needs        jsonb,
  add column if not exists needs_done   int  not null default 0,
  add column if not exists needs_missed int  not null default 0,
  add column if not exists covenant_at  timestamptz,
  add column if not exists covenant_fid text,
  add column if not exists ichor_at     timestamptz,
  add column if not exists ichor_total  numeric not null default 0,
  add column if not exists last_touch_at timestamptz;

-- Разовый бэкфилл: у миров, с которыми уже возились, связь не с нуля —
-- иначе весь накопленный контакт обнулится задним числом.
update public.primitive_civs
   set trust = greatest(trust, least(45, greatest(0, attitude) / 2)),
       dependency = greatest(dependency, least(60, 9 * coalesce((flags->>'gifts')::int, 0))),
       grudge = greatest(grudge, least(80, 10 * coalesce(drained, 0)
                                          + 25 * (case when coalesce(enslaved,0) > 0 then 1 else 0 end)
                                          + 35 * coalesce(lessons, 0))),
       last_touch_at = coalesce(last_touch_at, greatest(
         coalesce(last_act_at,   'epoch'::timestamptz),
         coalesce(last_gift_at,  'epoch'::timestamptz),
         coalesce(last_study_at, 'epoch'::timestamptz),
         coalesce(contacted_at,  'epoch'::timestamptz)))
 where trust = 0 and dependency = 0 and grudge = 0;

-- ── 2. ПОТОЛОК И ЛОЯЛЬНОСТЬ ───────────────────────────────
-- Потолок фазы — не балансная гайка, а утверждение о мире: народ, который
-- ещё не изобрёл письменность, не может быть вам «предан», он вас не мыслит.
create or replace function public._pc_cap(p_phase int, p_grudge int, p_dep int)
returns int language sql immutable set search_path=public as $$
  select greatest(0, least(100, 40 + 6 * greatest(0, least(11, coalesce(p_phase, 0))))
                      - greatest(0, coalesce(p_grudge, 0))
                      - greatest(0, coalesce(p_dep, 0) - 40));
$$;

create or replace function public._pc_loyalty(p_att int, p_trust int, p_phase int, p_grudge int, p_dep int)
returns int language sql immutable set search_path=public as $$
  select least(public._pc_cap(p_phase, p_grudge, p_dep),
               round(0.45 * coalesce(p_att, 0) + 0.55 * coalesce(p_trust, 0))::int);
$$;

create or replace function public._pc_loy(c public.primitive_civs)
returns int language sql stable set search_path=public as $$
  select public._pc_loyalty(c.attitude, c.trust, c.phase, c.grudge, c.dependency);
$$;

-- ── 3. СКЛАД: ихор льём прямо в ресурсы державы ───────────
create or replace function public._pc_res_add(p_fid text, p_res text, p_amt numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_fid is null or coalesce(p_amt, 0) <= 0 then return; end if;
  update public.faction_economy
     set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array[p_res],
           to_jsonb(round(coalesce((resources->>p_res)::numeric, 0) + p_amt, 3)), true)
   where faction_id = p_fid;
end$$;
revoke all on function public._pc_res_add(text, text, numeric) from public, anon, authenticated;

-- ── 4. НУЖДЫ ──────────────────────────────────────────────
-- Беда со сроком. Это единственная дверь к настоящей связи — и она открывается
-- не тогда, когда у игрока есть деньги, а тогда, когда у мира случилось горе.
create or replace function public._pc_need_roll(p_phase int, p_tier int, p_name text, p_planet text)
returns jsonb language plpgsql set search_path=public as $$
declare k text; kinds text[]; v_txt text; v_ask numeric; v_ttl interval := interval '5 days';
begin
  kinds := case
    when p_phase <= 2 then array['famine','plague','beast','drought']
    when p_phase <= 6 then array['famine','plague','war','schism','drought','flood']
    else array['plague','war','schism','flood','collapse','reactor'] end;
  k := kinds[1 + floor(random() * array_length(kinds, 1))::int];
  v_ask := round((60000 + 22000 * p_phase) * (1 + 0.30 * greatest(0, p_tier)));
  v_txt := case k
    when 'famine'   then 'Второй год подряд не всходит: у ' || p_name || ' пустеют амбары, и старики уже считают, кого кормить не станут.'
    when 'plague'   then 'По ' || coalesce(p_planet, 'планете') || ' идёт мор. Их лекари режут больных и жгут дома — больше они ничего не умеют.'
    when 'beast'    then 'Из леса пришло то, чего они не могут убить своим железом, и уводит людей от костров.'
    when 'drought'  then 'Реки ушли под землю. ' || p_name || ' идут за водой всё дальше и всё чаще не возвращаются.'
    when 'war'      then 'Их царства сцепились насмерть. Победитель получит выжженное поле и никого, кто помнил бы ремёсла.'
    when 'schism'   then 'Вера раскололась надвое, и обе половины уверены, что вторую надо вырезать.'
    when 'flood'    then 'Вода поднялась выше всего, что они строили, и не уходит. Города стоят по крышам.'
    when 'collapse' then 'Их хозяйство встало разом: биржи, склады, поезда. Никто не понимает почему, и все ищут виноватых.'
    else                 'Их первый реактор пошёл вразнос. Они не знают слова «эвакуация» — они знают только «бежать».'
  end;
  return jsonb_build_object(
    'kind', k, 'text', v_txt, 'ask', v_ask,
    'at', now(), 'until', now() + v_ttl);
end$$;
revoke all on function public._pc_need_roll(int, int, text, text) from public, anon, authenticated;

-- ── 5. ПРОСРОЧЕННЫЕ НУЖДЫ И НАЧИСЛЕНИЕ ИХОРА (суточный проход) ──
create or replace function public._pc_bonds_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_days numeric; v_rate numeric; v_amt numeric; n_ichor int := 0; n_miss int := 0; v_loy int;
begin
  -- 5.1 нужда протухла: звали — не пришли
  for r in select * from public.primitive_civs
            where needs is not null
              and (needs->>'until')::timestamptz < now()
              and status not in ('dead','spacefaring')
  loop
    update public.primitive_civs
       set needs = null,
           needs_missed = needs_missed + 1,
           trust     = greatest(0, trust - 5),
           grudge    = least(100, grudge + 3),
           attitude  = greatest(-100, attitude - 4),
           wellbeing = greatest(0, wellbeing - 6),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'беда',
             'text', 'Беду пережили сами, как переживали всё до неба: своими руками и своими мертвецами. '
                  || 'Тех, кто смотрел сверху, ' || r.self_name || ' запомнили отдельно.'))
     where system_id = r.system_id and pid = r.pid;
    n_miss := n_miss + 1;
  end loop;

  -- 5.2 ихор: только Завет и только даллерианские святилища
  for r in select * from public.primitive_civs
            where status = 'covenant' and covenant_fid is not null
              and ruins = 'Даллерианцы'
  loop
    v_days := extract(epoch from (now() - coalesce(r.ichor_at, r.covenant_at, now()))) / 86400.0;
    if v_days < 0.04 then continue; end if;          -- меньше часа — не мельчим
    v_days := least(3.0, v_days);                    -- проспавший месяц не получит месяц
    v_loy  := public._pc_loyalty(r.attitude, r.trust, r.phase, r.grudge, r.dependency);
    if v_loy < 85 then                               -- связь просела — святилища закрыли
      update public.primitive_civs set ichor_at = now()
        where system_id = r.system_id and pid = r.pid;
      continue;
    end if;
    v_rate := (0.6 + 0.2 * greatest(0, r.tier)) * (case when v_loy >= 95 then 1.25 else 1.0 end);
    v_amt  := round(v_rate * v_days, 3);
    perform public._pc_res_add(r.covenant_fid, 'Ихор', v_amt);
    update public.primitive_civs
       set ichor_at = now(), ichor_total = ichor_total + v_amt
     where system_id = r.system_id and pid = r.pid;
    n_ichor := n_ichor + 1;
  end loop;

  return jsonb_build_object('ichor', n_ichor, 'missed', n_miss);
end$$;
revoke all on function public._pc_bonds_tick() from public, anon, authenticated;

-- ── 6. НЕДЕЛЬНЫЙ ХОД: затухание, зависимость, новые нужды ──
-- precursor_step переименован; наш ход делает три вещи ДО делегата (иначе мир
-- под Заветом успеет улететь) и три ПОСЛЕ.
do $$
begin
  if to_regprocedure('public._precursor_step_v1(text,int,boolean)') is null then
    execute 'alter function public.precursor_step(text,int,boolean) rename to _precursor_step_v1';
  end if;
end$$;

create or replace function public.precursor_step(p_system_id text, p_pid int, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype; res jsonb; v_cov boolean;
begin
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid;
  if not found then return jsonb_build_object('ok', false, 'why', 'no civ'); end if;
  if c.status in ('dead','spacefaring') then return jsonb_build_object('ok', false, 'why', 'no clock'); end if;
  if not p_force and (c.next_step_at is null or c.next_step_at > now()) then
    return jsonb_build_object('ok', false, 'why', 'not due');
  end if;

  v_cov := (c.status = 'covenant');

  -- 6.1 ЗАВЕТ ДЕРЖИТ ИХ ДОМА. Порог космоса под Заветом не срабатывает: они
  -- знают, что под ними лежит, и считают своим делом это стеречь.
  if v_cov and (jsonb_array_length(coalesce(c.roadmap, '[]'::jsonb)) = 0
                or coalesce((c.roadmap->0->>'ignite')::boolean, false)
                or c.phase >= 11) then
    update public.primitive_civs
       set next_step_at = now() + interval '7 days',
           steps = steps + 1,
           pop = greatest(0, (pop * 1.04)::bigint),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'завет',
             'text', 'Корабли достроены и стоят на пусковых. ' || c.self_name ||
                     ' не летят: у них есть дело важнее неба — то, что лежит под их же городами.'))
     where system_id = c.system_id and pid = c.pid;
    perform public._pc_bonds_after(c.system_id, c.pid);
    return jsonb_build_object('ok', true, 'covenant_hold', true);
  end if;

  res := public._precursor_step_v1(p_system_id, p_pid, p_force);
  if not coalesce((res->>'ok')::boolean, false) then return res; end if;

  perform public._pc_bonds_after(p_system_id, p_pid);
  return res;
end$$;
revoke all on function public.precursor_step(text, int, boolean) from public, anon, authenticated;

-- Хвост недельного хода: то, что происходит с УЗАМИ, а не с историей.
create or replace function public._pc_bonds_after(p_system_id text, p_pid int)
returns void language plpgsql security definer set search_path=public as $$
declare c public.primitive_civs%rowtype; v_quiet boolean; v_cargo boolean;
begin
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found or c.status in ('dead','spacefaring') then return; end if;

  -- 6.2 ЗАБВЕНИЕ. Связь — не имущество: её не бывает «накоплено».
  v_quiet := coalesce(c.last_touch_at, c.contacted_at, 'epoch'::timestamptz) < now() - interval '10 days';
  -- 6.3 КАРГО-КУЛЬТ. Мир, который живёт с неба, перестаёт делать сам.
  v_cargo := (c.dependency >= 55);

  update public.primitive_civs
     set trust    = greatest(0, trust - (case when v_quiet then 2 else 0 end)
                                      - (case when v_cargo then 1 else 0 end)),
         attitude = greatest(-100, attitude - (case when v_quiet then 3 else 0 end)),
         dependency = greatest(0, dependency - 2),          -- сама по себе тает медленно
         wellbeing  = least(100, wellbeing + (case when v_cargo then 2 else 0 end)),
         chronicle  = chronicle || (case when v_cargo and random() < 0.35
           then jsonb_build_array(jsonb_build_object('ph', 'культ',
             'text', 'Ремёсла у ' || c.self_name || ' глохнут: зачем ковать, если небо и так даёт. '
                  || 'Молодые больше не идут в кузни — они идут в храмы ждать.'))
           else '[]'::jsonb end)
   where system_id = c.system_id and pid = c.pid;

  -- 6.4 НОВАЯ БЕДА. Только там, где о них хоть кто-то знает: нужда без
  -- адресата — это просто их обычная жизнь, у неё нет игровой стороны.
  if c.needs is null
     and (c.contacted_by is not null or c.patron_fid is not null or c.covenant_fid is not null)
     and random() < (case when c.wellbeing < 40 then 0.55 else 0.38 end) then
    update public.primitive_civs
       set needs = public._pc_need_roll(c.phase, c.tier, c.self_name, c.planet_name)
     where system_id = c.system_id and pid = c.pid;
  end if;
end$$;
revoke all on function public._pc_bonds_after(text, int) from public, anon, authenticated;

-- ── 7. СУТОЧНЫЙ ПРОГОН ГАЛАКТИКИ + ихор ───────────────────
do $$
begin
  if to_regprocedure('public._precursor_tick_all_v1(int)') is null then
    execute 'alter function public.precursor_tick_all(int) rename to _precursor_tick_all_v1';
  end if;
end$$;

create or replace function public.precursor_tick_all(p_limit int default 500)
returns jsonb language plpgsql security definer set search_path=public as $$
declare res jsonb; b jsonb;
begin
  res := public._precursor_tick_all_v1(p_limit);
  begin b := public._pc_bonds_tick(); exception when others then b := '{}'::jsonb; end;
  return res || coalesce(b, '{}'::jsonb);
end$$;
revoke all on function public.precursor_tick_all(int) from public, anon;

-- ── 8. ВИТРИНА ────────────────────────────────────────────
-- Зеркало _precursor_lesson.sql §4 + четыре цифры уз, нужда и запас ихора.
create or replace function public.precursor_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v jsonb; rep int; v_faith uuid; v_faith_nm text;
begin
  fid := public._ec_my_fid();
  perform public._pc_clock();
  begin perform public.precursor_scan_contacts(50); exception when others then null; end;
  begin perform public._pc_bonds_tick(); exception when others then null; end;
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  select m.faith_id into v_faith from public.faith_membership m
    where m.faction_id = fid order by (m.role = 'founder') desc limit 1;
  select f.name into v_faith_nm from public.faiths f where f.id = v_faith;
  select coalesce(jsonb_agg(x order by x_tier desc, x_name), '[]'::jsonb) into v
    from (
      select (to_jsonb(c) - 'roadmap')
             || jsonb_build_object('steps_left', jsonb_array_length(c.roadmap),
                                   'fleet', public._pc_has_fleet(fid, c.system_id),
                                   'cap', public._pc_cap(c.phase, c.grudge, c.dependency),
                                   'loyalty', public._pc_loy(c),
                                   'mine_cov', (c.covenant_fid = fid),
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
    'faith_boost', public._pc_faith_boost(fid),
    'civs', v);
end$$;
revoke all on function public.precursor_get() from public, anon;
grant execute on function public.precursor_get() to authenticated;

-- ── 9. РЕШЕНИЯ: два новых и перекрой старых ───────────────
-- Обёртка не переписывает предшественников: она зовёт делегата и правит
-- ПОСЛЕДСТВИЯ. Так цепочка ethics→growth→goodwill→lesson остаётся целой.
do $$
begin
  if to_regprocedure('public._precursor_act_v4(text,int,text)') is null then
    execute 'alter function public.precursor_act(text,int,text) rename to _precursor_act_v4';
    execute 'revoke all on function public._precursor_act_v4(text,int,text) from public, anon, authenticated';
  end if;
end$$;

-- Цена Завета (зеркало клиента): ритуал на весь мир, не подарок.
create or replace function public._pc_covenant_cost(p_tier int)
returns numeric language sql immutable set search_path=public as $$
  select (1500000 + 250000 * greatest(0, coalesce(p_tier, 0)))::numeric;
$$;

create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.primitive_civs%rowtype; c2 public.primitive_civs%rowtype;
  fid text; res jsonb; v_cost numeric; v_bank numeric; v_gain int; v_cap int;
  v_loy int; v_rep int; v_who text; v_have boolean;
begin
  fid := public._ec_my_fid();
  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid;
  v_have := found;

  -- ── 9.1 ОТВЕТИТЬ НА НУЖДУ ───────────────────────────────
  if p_action = 'answer' then
    if not v_have then raise exception 'no civ'; end if;
    if c.status in ('dead','spacefaring') then raise exception 'civ is gone'; end if;
    if c.needs is null then raise exception 'no need'; end if;
    if (c.needs->>'until')::timestamptz < now() then raise exception 'need expired'; end if;
    if c.patron_fid is not null and c.patron_fid <> fid then
      raise exception 'civ belongs to another patron';
    end if;
    if not exists (select 1 from public.colonies col
                    where col.system_id = c.system_id and col.faction_id = fid)
       and coalesce(c.patron_fid, '') <> fid and coalesce(c.covenant_fid, '') <> fid then
      raise exception 'no presence in system';
    end if;
    v_cost := coalesce((c.needs->>'ask')::numeric, 0);
    select e.gc into v_bank from public.faction_economy e where e.faction_id = fid;
    if coalesce(v_bank, 0) < v_cost then raise exception 'not enough gc'; end if;
    update public.faction_economy set gc = gc - v_cost where faction_id = fid and gc >= v_cost;

    v_rep := public._pc_rep(fid, -3);   -- Фонд всё равно считает это контактом
    update public.primitive_civs
       set needs = null,
           needs_done = needs_done + 1,
           trust     = least(100, trust + 10),
           grudge    = greatest(0, grudge - 1),
           attitude  = greatest(-100, least(100, attitude + 4)),
           wellbeing = least(100, wellbeing + 9),
           dependency = least(100, dependency + 2),
           last_touch_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'беда',
             'text', 'Помощь пришла ровно тогда, когда была нужна, и не потребовала ничего взамен. '
                  || 'У ' || c.self_name || ' это запомнят не как чудо, а как поступок — и это совсем другая память.'))
     where system_id = c.system_id and pid = c.pid;

    insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
      values (c.system_id, c.pid, fid, 'answer',
              jsonb_build_object('cost', v_cost, 'kind', c.needs->>'kind', 'rep', v_rep));

    select * into c2 from public.primitive_civs where system_id = p_system_id and pid = p_pid;
    return jsonb_build_object('ok', true, 'cost', v_cost, 'rep', v_rep,
      'txt', 'Беду закрыли. Связь с «' || c.self_name || '» окрепла: доверие ' || c2.trust
             || ', лояльность ' || public._pc_loy(c2) || ' из ' || public._pc_cap(c2.phase, c2.grudge, c2.dependency) || '.');
  end if;

  -- ── 9.2 ЗАВЕТ ───────────────────────────────────────────
  if p_action = 'covenant' then
    if not v_have then raise exception 'no civ'; end if;
    if c.status in ('dead','spacefaring') then raise exception 'civ is gone'; end if;
    if c.status = 'covenant' then raise exception 'already covenant'; end if;
    if c.patron_fid is not null and c.patron_fid <> fid then
      raise exception 'civ belongs to another patron';
    end if;
    if not exists (select 1 from public.colonies col
                    where col.system_id = c.system_id and col.faction_id = fid)
       and coalesce(c.patron_fid, '') <> fid then
      raise exception 'no presence in system';
    end if;
    v_loy := public._pc_loy(c);
    if v_loy < 90 then raise exception 'loyalty too low: % of 90', v_loy; end if;
    if c.phase < 8  then raise exception 'too primitive for covenant'; end if;
    if c.grudge > 10 then raise exception 'they remember too much'; end if;
    if c.dependency > 45 then raise exception 'they only beg'; end if;

    v_cost := public._pc_covenant_cost(c.tier);
    select e.gc into v_bank from public.faction_economy e where e.faction_id = fid;
    if coalesce(v_bank, 0) < v_cost then raise exception 'not enough gc'; end if;
    update public.faction_economy set gc = gc - v_cost where faction_id = fid and gc >= v_cost;

    v_rep := public._pc_rep(fid, -10);
    begin v_who := nullif(public._fac_name(fid), ''); exception when others then v_who := null; end;
    update public.primitive_civs
       set status = 'covenant', covenant_at = now(), covenant_fid = fid,
           patron_fid = coalesce(patron_fid, fid),
           ichor_at = now(), last_touch_at = now(), acts = acts + 1,
           trust = least(100, trust + 5),
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'завет',
             'text', 'Договор заключили не правители, а весь народ разом: ' || c.self_name ||
                     ' открыли пришедшим святилища, которых не открывали даже себе — '
                  || 'и впервые узнали, что лежит под их городами.'))
     where system_id = c.system_id and pid = c.pid;

    insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
      values (c.system_id, c.pid, fid, 'covenant',
              jsonb_build_object('cost', v_cost, 'loyalty', v_loy, 'rep', v_rep));

    perform public._pc_news(
      '◈ Завет: ' || c.self_name || ' открыли святилища',
      'Дозвёздный народ «' || c.self_name || '» с планеты ' || coalesce(c.planet_name, '?') ||
      ' добровольно вошёл в Завет с державой' || coalesce(' «' || v_who || '»', '') ||
      '. Такое не покупается и не берётся силой: за этим стоят годы, в которые кто-то приходил на их беду.',
      case when c.ruins = 'Даллерианцы'
        then 'Под их городами лежат руины Даллерианцев. Мир, вошедший в Завет, отказывается от собственного звёздного полёта и остаётся хранителем — а хранитель делится тем, что хранит.'
        else 'Руин предтеч под ними нет: Завет даёт им покровителя, а покровителю — верность, но не более того.' end
      || ' ' || public._pc_dossier(c),
      'rgba(150,120,220,0.55)',
      jsonb_build_array(fid));

    return jsonb_build_object('ok', true, 'cost', v_cost, 'rep', v_rep,
      'txt', c.self_name || ' вошли в Завет.' ||
             case when c.ruins = 'Даллерианцы'
               then ' Святилища Даллерианцев вскрыты: ихор пойдёт на ваш склад каждые сутки.'
               else ' Руин предтеч под ними нет — ихора здесь не будет.' end);
  end if;

  -- ── 9.3 ВСЁ ОСТАЛЬНОЕ: делегат + правка последствий ─────
  res := public._precursor_act_v4(p_system_id, p_pid, p_action);
  if not v_have then return res; end if;   -- мира нет — делегат уже отругался

  select * into c2 from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return res; end if;    -- истреблённый мир строку не оставил

  if p_action in ('gift','envoy','miracle') then
    -- Делегат уже начислил своё «+14». Переписываем: прибавка тем меньше, чем
    -- ближе они к своему потолку и чем сильнее уже сидят на нашей руке.
    v_cap  := public._pc_cap(c2.phase, c2.grudge, c2.dependency);
    v_gain := greatest(1, round(
      (case p_action when 'gift' then 10 when 'envoy' then 5 else 22 end)
      * greatest(0.05, 1 - greatest(0, c.attitude)::numeric / greatest(1, v_cap))
      * (1 - least(90, c.dependency)::numeric / 100))::int);
    update public.primitive_civs
       set attitude = greatest(-100, least(100, c.attitude + v_gain)),
           dependency = least(100, dependency + (case p_action
                          when 'gift' then 9 when 'envoy' then 1 else 14 end)),
           trust = greatest(0, least(100, trust + (case
                          when p_action = 'envoy' then 2
                          when p_action = 'gift' and c.dependency < 40 then 1
                          when p_action = 'gift' then -2
                          else 0 end))),
           last_touch_at = now()
     where system_id = c2.system_id and pid = c2.pid;
    res := res || jsonb_build_object('att', v_gain);

  elsif p_action in ('harvest','enslave','lesson','purge','protect') then
    -- Память об обиде. Её нельзя закрыть деньгами — только годами нужд.
    update public.primitive_civs
       set grudge = least(100, grudge + (case p_action
                      when 'harvest' then 10 when 'enslave' then 25
                      when 'lesson'  then 35 when 'purge'   then 40 else 5 end)),
           trust  = greatest(0, trust - (case p_action
                      when 'harvest' then 8 when 'enslave' then 25
                      when 'lesson'  then 30 else 3 end)),
           last_touch_at = now(),
           -- Завет обиды не переживает: святилища закрывают в тот же день
           status = case when status = 'covenant' and p_action <> 'protect' then 'wild' else status end,
           covenant_fid = case when status = 'covenant' and p_action <> 'protect' then null else covenant_fid end
     where system_id = c2.system_id and pid = c2.pid;

  elsif p_action in ('study','uplift','convert') then
    update public.primitive_civs set last_touch_at = now()
     where system_id = c2.system_id and pid = c2.pid;
  end if;

  return res;
end$$;
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;
