-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ ЦИВИЛИЗАЦИИ · ЭТАП 5 — цена, рабство, вера, запреты
-- (после _precursor_decisions.sql и _precursor_growth.sql)
--
-- 1) ЦЕНА. Вмешательство перестало быть карманной мелочью: возвышение стоит
--    порядка 800 000 ГС, остальное — сотни тысяч. Дозвёздный мир — это проект
--    державы на квартал, а не кнопка «нажать между делом».
--
-- 2) ⛓ УВЕСТИ В РАБСТВО — альтернатива зачистке: не убить, а вывезти. Доступно
--    ТОЛЬКО тем, кому вообще доступно рабство (см. _faction_enlightened —
--    гуманный уклон закрывает его целиком). Рабы падают в общий пул
--    faction_slaves и работают как обычные рабочие (_slavery.sql).
--
-- 3) ☩ ОБРАТИТЬ В ВЕРУ — целая планета верующих. Даёт ОГРОМНЫЙ множитель к
--    ставке храмов державы (_faith_temple_rate): каждый обращённый мир — +25%,
--    потолок ×2. Требует своей религии. Может не выйти: у них своё небо.
--
-- 4) ЗАПРЕТЫ. Демократическим/эгалитарным и пацифистским/ксенофильским державам
--    закрыты геноцид, рабство, выкачивание и протекторат — то есть насилие и
--    эксплуатация. Наблюдение, возвышение и проповедь остаются: это не
--    «вмешательство силой», а то, чем такие державы и живут.
-- ════════════════════════════════════════════════════════════

-- ── 0. Зависимости из _slavery.sql (если тот слайс ещё не накачен) ──
-- Определения СЛОВО В СЛОВО как в _slavery.sql — накатывание того файла
-- позже ничего не сломает.
create table if not exists public.faction_slaves (
  id         uuid primary key default gen_random_uuid(),
  owner_fid  text not null,
  origin_fid text not null,
  count      numeric not null default 0,
  updated_at timestamptz default now(),
  unique(owner_fid, origin_fid)
);
create index if not exists faction_slaves_owner_idx on public.faction_slaves(owner_fid);
alter table public.faction_slaves enable row level security;
drop policy if exists faction_slaves_read on public.faction_slaves;
create policy faction_slaves_read on public.faction_slaves for select using (true);

-- «Просвещённая» держава: гуманный уклон закрывает рабство целиком.
create or replace function public._faction_enlightened(p_fid text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare a public.faction_applications;
begin
  select * into a from public.faction_applications
    where faction_id=p_fid and status='approved' order by updated_at desc limit 1;
  if not found then return false; end if;
  return a.regime in ('Демократический','Эгалитарный')
      or a.ideology in ('Пацифизм','Ксенофилия');
end$$;
revoke all on function public._faction_enlightened(text) from public;
grant execute on function public._faction_enlightened(text) to authenticated;

create or replace function public._slaves_add(p_owner text, p_origin text, p_n numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_n,0) <= 0 then return; end if;
  insert into public.faction_slaves(owner_fid, origin_fid, count, updated_at)
  values (p_owner, p_origin, p_n, now())
  on conflict (owner_fid, origin_fid)
    do update set count = public.faction_slaves.count + p_n, updated_at=now();
end$$;
revoke all on function public._slaves_add(text,text,numeric) from public;

-- ── 1. Новые поля цивилизации ─────────────────────────────
alter table public.primitive_civs
  add column if not exists faith_fid    text,          -- кто обратил
  add column if not exists faith_id     uuid,          -- в какую веру
  add column if not exists converted_at timestamptz,
  add column if not exists enslaved     bigint not null default 0;

-- ── 2. ЦЕНА РЕШЕНИЯ (зеркало клиента pcCost) ──────────────
-- Возвышение: 500k + 150k×тир → «бронза» 800 000, порог космоса 1 250 000.
create or replace function public._pc_cost(p_action text, p_tier int)
returns numeric language sql immutable set search_path=public as $$
  select case p_action
    when 'study'   then 0
    when 'uplift'  then 500000 + 150000 * p_tier
    when 'harvest' then 0
    when 'protect' then 300000 + 120000 * p_tier
    when 'purge'   then 220000 +  80000 * p_tier
    when 'enslave' then 260000 + 110000 * p_tier
    when 'convert' then 340000 + 130000 * p_tier
    else 0 end::numeric;
$$;

-- ── 3. Множитель веры от обращённых миров ─────────────────
-- Планета верующих — это не «ещё один храм», это целый народ, поющий ваше имя.
-- Каждый обращённый мир: +25% к ставке храмов, потолок ×2.
create or replace function public._pc_faith_boost(p_fid text)
returns numeric language sql stable security definer set search_path=public as $$
  select least(2.0, 1 + 0.25 * coalesce((
    select count(*) from public.primitive_civs c
     where c.faith_fid = p_fid and c.status <> 'dead'), 0))::numeric
$$;
revoke all on function public._pc_faith_boost(text) from public;
grant execute on function public._pc_faith_boost(text) to authenticated;

-- Ставка дохода храма — ЗЕРКАЛО _economy_accrue_consolidated.sql,
-- отличие ровно одно: множитель обращённых миров и поднятый потолок.
create or replace function public._faith_temple_rate(p_fid text)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare
  slots numeric; pop numeric; reach numeric; cov numeric;
  b public.faction_budget; fervor numeric; net numeric; monu numeric; n int;
  base numeric; zeal numeric;
begin
  slots := coalesce((select sum(slots_open) from public.colony_buildings
                     where faction_id = p_fid and btype = 'temple'),0);
  pop := greatest(1, public._fac_pop(p_fid));
  n := public._faith_monuments_n(p_fid);
  monu := least(1.25, 1 + 0.05 * n);
  reach := slots * 120 * (1 + 0.10 * least(5, n));
  cov := least(1, reach / pop);
  b := public._budget_row(p_fid);
  fervor := (array[1.20, 1.10, 1.00, 0.94, 0.88])[greatest(0,least(4,b.social)) + 1];
  net := least(1.15, 1 + 0.03 * coalesce((
    select count(distinct m.faction_id) from public.faith_membership m
    join public.faiths f on f.id = m.faith_id and f.founder_fid = p_fid
    where m.faction_id <> p_fid),0));
  base := least(240, 150 + 90 * power(cov, 0.7) * fervor * net * monu);
  zeal := public._pc_faith_boost(p_fid);
  return round(least(480, base * zeal));
end$$;
revoke all on function public._faith_temple_rate(text) from public;

-- ── 3-бис. Подрезка летописи после возвышения ─────────────
-- Возвышение перепрыгивает эпоху, но записи будущего под этой эпохой остаются
-- лежать в roadmap: precursor_step выбрасывал их только на СЛЕДУЮЩЕМ недельном
-- ходу, и игрок видел прежнее «до звёздного полёта шагов: N». Выбрасываем сразу.
create or replace function public._pc_roadmap_prune(p_system_id text, p_pid int)
returns int language plpgsql security definer set search_path=public as $$
declare c public.primitive_civs%rowtype; rm jsonb; e jsonb;
begin
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return 0; end if;
  rm := c.roadmap;
  loop
    exit when jsonb_array_length(rm) = 0;
    e := rm->0;
    exit when coalesce((e->>'ignite')::boolean, false);   -- взлёт не трогаем никогда
    exit when coalesce((e->>'i')::int, 99) > c.phase;     -- это ещё будущее
    rm := rm - 0;
  end loop;
  if rm is distinct from c.roadmap then
    update public.primitive_civs set roadmap = rm
      where system_id = p_system_id and pid = p_pid;
  end if;
  return jsonb_array_length(rm);
end$$;
revoke all on function public._pc_roadmap_prune(text, int) from public, anon, authenticated;

-- ── 4. Что доступно этой державе ──────────────────────────
-- Одна правда на сервер и клиент: список запрещённых решений.
create or replace function public._pc_forbidden(p_fid text)
returns text[] language sql stable security definer set search_path=public as $$
  select case when public._faction_enlightened(p_fid)
    then array['purge','enslave','harvest','protect']::text[]
    else array[]::text[] end
$$;
revoke all on function public._pc_forbidden(text) from public;
grant execute on function public._pc_forbidden(text) to authenticated;

-- ── 5. Список миров + флаги державы ───────────────────────
-- Зеркало _precursor_growth.sql (§9) + флаги уклада: что этой державе вообще
-- позволено и есть ли у неё своя вера.
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

-- ── 6. Решения (рев. 3): +рабство, +проповедь, +запреты ────
create or replace function public._precursor_act_v1(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; c public.primitive_civs%rowtype; cost numeric; v_gc numeric;
  v_sci numeric := 0; v_gain numeric := 0; v_rep int; v_txt text; ok boolean;
  v_roll numeric; v_pop bigint; v_take bigint; v_faith uuid; v_faith_nm text;
begin
  fid := public._ec_my_fid();
  if p_action not in ('study','uplift','harvest','protect','purge','enslave','convert') then
    raise exception 'bad action';
  end if;

  select * into c from public.primitive_civs
    where system_id = p_system_id and pid = p_pid for update;
  if not found then raise exception 'no civ'; end if;
  if c.status = 'dead' then raise exception 'civ is gone'; end if;

  -- рядом ли мы вообще
  if not exists (select 1 from public.colonies col
                  where col.system_id = c.system_id and col.faction_id = fid)
     and coalesce(c.patron_fid, '') <> fid then
    raise exception 'no presence in system';
  end if;
  if c.patron_fid is not null and c.patron_fid <> fid then
    raise exception 'civ belongs to another patron';
  end if;

  -- ЗАПРЕТ УКЛАДА: демократам/эгалитарам и пацифистам/ксенофилам закрыты
  -- геноцид, рабство, выкачивание и протекторат.
  if p_action = any (public._pc_forbidden(fid)) then
    raise exception 'forbidden by creed';
  end if;

  cost := public._pc_cost(p_action, c.tier);
  select e.gc into v_gc from public.faction_economy e where e.faction_id = fid;
  if coalesce(v_gc, 0) < cost then raise exception 'not enough gc'; end if;

  if p_action <> 'study'
     and c.last_act_at is not null and now() - c.last_act_at < interval '20 hours' then
    raise exception 'too soon';
  end if;
  if p_action = 'study'
     and c.last_study_at is not null and now() - c.last_study_at < interval '20 hours' then
    raise exception 'too soon';
  end if;

  if cost > 0 then
    update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  end if;

  -- ══ 🔬 ИЗУЧАТЬ ══
  if p_action = 'study' then
    v_sci := 40 + 55 * c.tier
           + (case when c.flags ? 'loreReward' then 220 else 0 end)
           + (case when c.ruins = 'Даллерианцы' then 160 else 0 end);
    update public.faction_economy set science = science + v_sci where faction_id = fid;
    v_rep := public._pc_rep(fid, 5);
    update public.primitive_civs
       set last_study_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now())
     where system_id = c.system_id and pid = c.pid;
    v_txt := 'Наблюдение с орбиты: ' || c.self_name || ' не заметили ничего. Науки +' || v_sci::bigint || '.';

  -- ══ 🜂 ВОЗВЫСИТЬ ══
  elsif p_action = 'uplift' then
    if c.phase >= 11 then raise exception 'already at the threshold'; end if;
    v_rep := public._pc_rep(fid, -15);
    update public.primitive_civs
       set phase = least(11, phase + 1),
           tier = case when least(11, phase + 1) <= 1 then 0 when least(11, phase + 1) <= 4 then 1
                       when least(11, phase + 1) <= 7 then 2 when least(11, phase + 1) <= 9 then 3
                       when least(11, phase + 1) = 10 then 4 else 5 end,
           visible_tier = case when least(11, phase + 1) <= 1 then 0 when least(11, phase + 1) <= 4 then 1
                       when least(11, phase + 1) <= 7 then 2 when least(11, phase + 1) <= 9 then 3
                       when least(11, phase + 1) = 10 then 4 else 5 end,
           attitude = least(100, attitude + 30),
           wellbeing = least(100, wellbeing + 10),
           status = case when status = 'wild' then 'uplifted' else status end,
           patron_fid = coalesce(patron_fid, fid),
           last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'вмешательство',
             'text', 'С неба пришли те, кто умеет больше. ' || c.self_name ||
                     ' шагнули через целую эпоху за одну ночь — и с этого дня знают, кому обязаны.'))
     where system_id = c.system_id and pid = c.pid;
    -- прожитое будущее выбрасываем сейчас, а не на следующем недельном ходу,
    -- иначе «до звёздного полёта шагов» не шевелится и решение выглядит пустым
    v_take := public._pc_roadmap_prune(c.system_id, c.pid);
    v_txt := c.self_name || ' поднялись на эпоху вперёд (E' || least(11, c.phase + 1)::text ||
             '). До звёздного полёта шагов: ' || v_take::text || '. Фонд это заметил.';

  -- ══ ⛏ ВЫКАЧИВАТЬ ══
  elsif p_action = 'harvest' then
    if c.status = 'drained' then raise exception 'nothing left to take'; end if;
    -- население теперь в игровых единицах (см. _precursor_pop_scale.sql), делители пересчитаны
    v_gain := floor((c.pop * 12.0) * (1 + c.tier) * (case when c.status = 'protectorate' then 1.6 else 1.0 end));
    v_gain := least(v_gain, 120000);
    update public.faction_economy set gc = gc + v_gain where faction_id = fid;
    v_rep := public._pc_rep(fid, case when c.status = 'protectorate' then -8 else -20 end);
    v_pop := greatest(0, (c.pop * 0.92)::bigint);
    update public.primitive_civs
       set pop = v_pop,
           wellbeing = greatest(0, wellbeing - 15),
           attitude = greatest(-100, attitude - (case when status = 'protectorate' then 8 else 20 end)),
           drained = drained + 1,
           status = case when wellbeing - 15 <= 5 then 'drained' else status end,
           last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now())
     where system_id = c.system_id and pid = c.pid;
    v_txt := 'Из недр и рук народа «' || c.self_name || '» изъято ' || v_gain::bigint || ' ГС. Им объяснят позже.';

  -- ══ ⚑ ПРОТЕКТОРАТ ══
  elsif p_action = 'protect' then
    if c.status = 'protectorate' then raise exception 'already a protectorate'; end if;
    v_roll := 0.35 + (5 - c.tier) * 0.09 + c.attitude / 400.0
            + (case when c.flags ? 'prophecy' then 0.35 else 0 end)
            - (case when c.scars @> array['deathind'] then 0.25 else 0 end)
            - (case when c.scars @> array['anthropo'] then 0.30 else 0 end);
    ok := random() < greatest(0.05, least(0.95, v_roll));
    v_rep := public._pc_rep(fid, -35);
    if ok then
      update public.primitive_civs
         set status = 'protectorate', patron_fid = fid,
             attitude = greatest(-100, attitude - 10),
             last_act_at = now(), acts = acts + 1,
             contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
             chronicle = chronicle || jsonb_build_array(jsonb_build_object(
               'ph', 'вмешательство',
               'text', 'Небо перестало быть ничьим. ' || c.self_name ||
                       ' подписали то, чего не смогли прочитать.'))
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' приняли протекторат. Выкачивание теперь дешевле и тише.';
    else
      update public.primitive_civs
         set attitude = greatest(-100, attitude - 35),
             last_act_at = now(), acts = acts + 1,
             contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
             chronicle = chronicle || jsonb_build_array(jsonb_build_object(
               'ph', 'вмешательство',
               'text', 'Им предложили покровительство. ' || c.self_name || ' ответили отказом — и запомнили лицо.'))
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' отказались. Деньги потрачены, отношение испорчено.';
    end if;

  -- ══ ⛓ УВЕСТИ В РАБСТВО — не убить, а вывезти ══
  elsif p_action = 'enslave' then
    -- Угоняем не «половину планеты», а столько, сколько увезут трюмы:
    -- ~8% населения мира с поправкой на тир (население — в игровых единицах).
    v_take := least(1200, greatest(5, floor(c.pop * 0.08 * (1 + 0.3 * c.tier))))::bigint;
    perform public._slaves_add(fid, 'prim:' || c.self_name, v_take);
    v_rep := public._pc_rep(fid, -45);
    v_pop := greatest(0, (c.pop * 0.85)::bigint);
    update public.primitive_civs
       set pop = v_pop,
           wellbeing = greatest(0, wellbeing - 25),
           attitude = greatest(-100, attitude - 45),
           enslaved = enslaved + v_take,
           status = case when v_pop <= 1000 then 'dead'
                         when wellbeing - 25 <= 5 then 'drained' else status end,
           last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'вмешательство',
             'text', 'Небо опустилось на поля и увело тех, кто был в поле. ' || c.self_name ||
                     ' с тех пор не поют по вечерам.'))
     where system_id = c.system_id and pid = c.pid;
    v_gain := v_take;
    v_txt := 'С планеты «' || coalesce(c.planet_name, c.self_name) || '» вывезено ' ||
             v_take::bigint || ' невольников. Они уже в трюмах.';
    perform public._luck_post('geo', fid,
      '⛓ Работорговцы увели ' || v_take::bigint || ' жителей мира «' || c.self_name || '».');

  -- ══ ☩ ОБРАТИТЬ В ВЕРУ — целый народ, поющий ваше имя ══
  elsif p_action = 'convert' then
    select m.faith_id into v_faith from public.faith_membership m
      where m.faction_id = fid order by (m.role = 'founder') desc limit 1;
    if v_faith is null then raise exception 'no faith of your own'; end if;
    if c.faith_fid is not null then raise exception 'already converted'; end if;
    select f.name into v_faith_nm from public.faiths f where f.id = v_faith;
    -- слушают тем охотнее, чем проще их мир и чем лучше к вам относятся;
    -- спиритуалистам небо не в новинку, неолуддитам и ИИ — наоборот
    v_roll := 0.30 + (5 - c.tier) * 0.08 + c.attitude / 400.0
            + (case when c.ideology = 'Спиритуализм' then 0.30 else 0 end)
            + (case when c.flags ? 'prophecy' then 0.25 else 0 end)
            - (case when c.ideology in ('Технократия (Культ науки)','Трансгуманизм','Индустриализм') then 0.20 else 0 end)
            - (case when c.scars @> array['awakenai'] then 0.25 else 0 end)
            - (case when c.scars @> array['luddite'] then 0.15 else 0 end);
    ok := random() < greatest(0.05, least(0.92, v_roll));
    v_rep := public._pc_rep(fid, -25);
    if ok then
      update public.primitive_civs
         set faith_fid = fid, faith_id = v_faith, converted_at = now(),
             attitude = least(100, attitude + 25),
             wellbeing = least(100, wellbeing + 5),
             last_act_at = now(), acts = acts + 1,
             contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
             chronicle = chronicle || jsonb_build_array(jsonb_build_object(
               'ph', 'вмешательство',
               'text', 'Небо заговорило, и оно назвало себя. ' || c.self_name ||
                       ' переписали все свои храмы под одно имя — «' || coalesce(v_faith_nm, 'веру пришедших') || '».'))
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' обращены в веру «' || coalesce(v_faith_nm, '?') ||
               '». Ставка ваших храмов выросла: множитель ×' ||
               to_char(public._pc_faith_boost(fid), 'FM0.00') || '.';
      perform public._luck_post('geo', fid,
        '☩ Целый мир («' || c.self_name || '») принял вашу веру.');
    else
      update public.primitive_civs
         set attitude = greatest(-100, attitude - 20),
             last_act_at = now(), acts = acts + 1,
             contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
             chronicle = chronicle || jsonb_build_array(jsonb_build_object(
               'ph', 'вмешательство',
               'text', 'Пришедшие с неба говорили о своём боге. ' || c.self_name ||
                       ' выслушали — и остались при своём.'))
       where system_id = c.system_id and pid = c.pid;
      v_txt := c.self_name || ' не приняли проповедь. Деньги ушли, небо осталось их.';
    end if;

  -- ══ ☠ ИСТРЕБИТЬ ══
  else
    v_gain := floor(c.pop * 55.0) + (case when c.ruins = 'Даллерианцы' then 60000 else 0 end);
    if c.scars @> array['hiddenarm'] then
      v_gain := 0;
      update public.faction_economy
         set gc = greatest(0, gc - (30000 + 15000 * c.tier)) where faction_id = fid;
      v_txt := c.self_name || ' истреблены — но перед смертью они применили то, что прятали. Флот понёс потери.';
    else
      update public.faction_economy set gc = gc + v_gain where faction_id = fid;
      v_txt := c.self_name || ' больше нет. С пепелища вывезено ' || v_gain::bigint || ' ГС.';
    end if;
    v_rep := public._pc_rep(fid, -60);
    update public.primitive_civs
       set status = 'dead', pop = 0, wellbeing = 0, attitude = -100,
           last_act_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now()),
           chronicle = chronicle || jsonb_build_array(jsonb_build_object(
             'ph', 'конец',
             'text', 'История ' || c.self_name || ' закончилась не эпохой, а решением постороннего.'))
     where system_id = c.system_id and pid = c.pid;
    perform public._luck_post('geo', fid, '☠ ' || c.self_name || ' (' || coalesce(c.planet_name, '?') || ') вычеркнуты из каталога живых миров.');
  end if;

  insert into public.primitive_acts(system_id, pid, faction_id, action, payload)
    values (c.system_id, c.pid, fid, p_action,
            jsonb_build_object('gc', v_gain, 'sci', v_sci, 'rep', v_rep, 'ok', coalesce(ok, true)));

  return jsonb_build_object('ok', coalesce(ok, true), 'txt', v_txt,
    'gc', v_gain, 'sci', v_sci, 'rep', v_rep, 'cost', cost);
end$$;
revoke all on function public._precursor_act_v1(text, int, text) from public, anon, authenticated;

-- ── 7. Разовая починка уже возвышённых миров ──────────────
-- У тех, кого успели толкнуть до этой правки, в летописи висят прожитые записи.
do $$
declare r record;
begin
  for r in select system_id, pid from public.primitive_civs
            where status not in ('dead','spacefaring') loop
    perform public._pc_roadmap_prune(r.system_id, r.pid);
  end loop;
end$$;
