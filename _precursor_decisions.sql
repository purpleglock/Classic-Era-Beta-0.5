-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ ЦИВИЛИЗАЦИИ · ЭТАП 3 — решения игрока
-- (лор: lore/precursor_civs.md; таблица: _precursor_civs.sql)
--
-- Пять решений, все РАЗНЫЕ по вкусу и почти все НЕОБРАТИМЫЕ:
--   study       🔬 Изучать        — наука, единственный «чистый» путь, +репутация
--   uplift      🜂 Возвысить      — толчок на эпоху вперёд, они становятся вашими навсегда
--   harvest     ⛏ Выкачивать     — деньги и сырьё в обмен на их благополучие
--   protect     ⚑ Протекторат    — забрать державу под себя (может не выйти)
--   purge       ☠ Истребить      — планета освобождается, Фонд этого не прощает
--
-- Над всем этим — ФОНД ПО ЗАЩИТЕ ОТ НЕВМЕШАТЕЛЬСТВА (мораторий 2986 года).
-- Каждое вмешательство роняет репутацию; на −100 Фонд взыскивает штраф.
--
-- Видимость: цивилизацию видит держава, у которой есть колония в этой системе.
-- Зеркало клиента — precursor_ui.js (вкладка «🜃 Дозвёздные» в новелле).
-- ════════════════════════════════════════════════════════════

-- ── состояние цивилизации под игроком ─────────────────────
alter table public.primitive_civs
  add column if not exists status       text not null default 'wild',  -- wild|uplifted|protectorate|drained|dead
  add column if not exists patron_fid   text,
  add column if not exists last_act_at  timestamptz,
  add column if not exists last_study_at timestamptz,
  add column if not exists acts         int not null default 0,
  add column if not exists drained      int not null default 0;        -- сколько раз выкачивали

-- ── журнал вмешательств (он же улика для Фонда) ───────────
create table if not exists public.primitive_acts (
  id         bigserial primary key,
  system_id  text not null,
  pid        int  not null,
  faction_id text not null,
  action     text not null,
  payload    jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
create index if not exists idx_prim_acts_civ on public.primitive_acts(system_id, pid, at desc);
alter table public.primitive_acts enable row level security;
revoke insert, update, delete on public.primitive_acts from public, anon, authenticated;
drop policy if exists "read" on public.primitive_acts;
create policy "read" on public.primitive_acts for select to public using (true);

-- ── репутация перед Фондом ────────────────────────────────
create table if not exists public.faction_foundation (
  faction_id      text primary key,
  rep             int not null default 0,      -- 0 = чист, ниже нуля = послужной список
  breaches        int not null default 0,
  last_sanction_at timestamptz
);
alter table public.faction_foundation enable row level security;
revoke insert, update, delete on public.faction_foundation from public, anon, authenticated;
drop policy if exists "read" on public.faction_foundation;
create policy "read" on public.faction_foundation for select to public using (true);

-- Изменить репутацию и, если добрались до −100, взыскать штраф.
-- Штраф: четверть казны, репутация откатывается к −50 (не к нулю — Фонд помнит).
create or replace function public._pc_rep(p_fid text, p_delta int)
returns int language plpgsql security definer set search_path=public as $$
declare v_rep int; v_gc numeric; v_fine numeric;
begin
  insert into public.faction_foundation(faction_id, rep) values (p_fid, 0)
    on conflict (faction_id) do nothing;
  update public.faction_foundation
     set rep = greatest(-300, least(50, rep + p_delta)),
         breaches = breaches + (case when p_delta < 0 then 1 else 0 end)
   where faction_id = p_fid
   returning rep into v_rep;
  if v_rep <= -100 then
    select gc into v_gc from public.faction_economy where faction_id = p_fid;
    v_fine := floor(coalesce(v_gc, 0) * 0.25);
    update public.faction_economy set gc = greatest(0, gc - v_fine) where faction_id = p_fid;
    update public.faction_foundation
       set rep = -50, last_sanction_at = now() where faction_id = p_fid;
    perform public._luck_post('geo', p_fid,
      'Фонд по защите от невмешательства взыскал ' || v_fine::bigint || ' ГС: мораторий 2986 года нарушен слишком громко.');
    v_rep := -50;
  end if;
  return v_rep;
end$$;

-- ── ВИДИМОСТЬ + СПИСОК ────────────────────────────────────
-- Видно то, что рядом: система с вашей колонией, либо уже вступали в контакт.
create or replace function public.precursor_get()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; v jsonb; rep int;
begin
  fid := public._ec_my_fid();
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.tier desc, c.self_name), '[]'::jsonb) into v
    from public.primitive_civs c
   where exists (select 1 from public.colonies col
                  where col.system_id = c.system_id and col.faction_id = fid)
      or c.contacted_by = fid or c.patron_fid = fid;
  return jsonb_build_object(
    'fid', fid,
    'rep', coalesce(rep, 0),
    'gc', (select gc from public.faction_economy where faction_id = fid),
    'civs', v);
end$$;
revoke all on function public.precursor_get() from public, anon;
grant execute on function public.precursor_get() to authenticated;

-- ── ЦЕНА РЕШЕНИЯ (зеркало клиента pcCost) ─────────────────
create or replace function public._pc_cost(p_action text, p_tier int)
returns numeric language sql immutable set search_path=public as $$
  select case p_action
    when 'study'   then 0
    when 'uplift'  then 12000 + 9000 * p_tier
    when 'harvest' then 0
    when 'protect' then 20000 + 14000 * p_tier
    when 'purge'   then 8000 + 4000 * p_tier
    else 0 end::numeric;
$$;

-- ── ГЛАВНАЯ RPC: применить решение ────────────────────────
create or replace function public.precursor_act(p_system_id text, p_pid int, p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid text; c public.primitive_civs%rowtype; cost numeric; v_gc numeric;
  v_sci numeric := 0; v_gain numeric := 0; v_rep int; v_txt text; ok boolean;
  v_roll numeric; v_pop bigint;
begin
  fid := public._ec_my_fid();
  if p_action not in ('study','uplift','harvest','protect','purge') then
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
  -- чужой протекторат не трогаем без войны
  if c.patron_fid is not null and c.patron_fid <> fid then
    raise exception 'civ belongs to another patron';
  end if;

  cost := public._pc_cost(p_action, c.tier);
  select e.gc into v_gc from public.faction_economy e where e.faction_id = fid;
  if coalesce(v_gc, 0) < cost then raise exception 'not enough gc'; end if;

  -- ── общий кулдаун на грубые вмешательства: 1 сутки ──
  if p_action in ('uplift','harvest','protect','purge')
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

  -- ══ 🔬 ИЗУЧАТЬ — единственный путь, за который Фонд не наказывает ══
  if p_action = 'study' then
    v_sci := 40 + 55 * c.tier
           + (case when c.flags ? 'loreReward' then 220 else 0 end)   -- шаманы помнят Даллерианцев
           + (case when c.ruins = 'Даллерианцы' then 160 else 0 end);
    update public.faction_economy set science = science + v_sci where faction_id = fid;
    v_rep := public._pc_rep(fid, 5);
    update public.primitive_civs
       set last_study_at = now(), acts = acts + 1,
           contacted_by = coalesce(contacted_by, fid), contacted_at = coalesce(contacted_at, now())
     where system_id = c.system_id and pid = c.pid;
    v_txt := 'Наблюдение с орбиты: ' || c.self_name || ' не заметили ничего. Науки +' || v_sci::bigint || '.';

  -- ══ 🜂 ВОЗВЫСИТЬ — эпоха вперёд, и они запомнят, кто это сделал ══
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
    v_txt := c.self_name || ' поднялись на эпоху вперёд. Фонд это заметил.';

  -- ══ ⛏ ВЫКАЧИВАТЬ — деньги в обмен на их будущее ══
  elsif p_action = 'harvest' then
    if c.status = 'drained' then raise exception 'nothing left to take'; end if;
    -- Доход намеренно скромный: это не станок для печати денег, а сделка
    -- «их благополучие в обмен на ваши ГС» с растущим счётом у Фонда.
    v_gain := floor((c.pop / 20000.0) * (1 + c.tier) * (case when c.status = 'protectorate' then 1.6 else 1.0 end));
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

  -- ══ ⚑ ПРОТЕКТОРАТ — может не выйти: у них бывает своё мнение ══
  elsif p_action = 'protect' then
    if c.status = 'protectorate' then raise exception 'already a protectorate'; end if;
    -- шанс: чем ниже тир и чем лучше к вам относятся, тем проще
    v_roll := 0.35 + (5 - c.tier) * 0.09 + c.attitude / 400.0
            + (case when c.flags ? 'prophecy' then 0.35 else 0 end)     -- пророчество исполнилось
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

  -- ══ ☠ ИСТРЕБИТЬ — необратимо, дорого по репутации, иногда больно ══
  else
    v_gain := floor(c.pop / 4000.0) + (case when c.ruins = 'Даллерианцы' then 60000 else 0 end);
    -- «Тайное оружие»: у них было то, что они прятали даже от себя
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
revoke all on function public.precursor_act(text, int, text) from public, anon;
grant execute on function public.precursor_act(text, int, text) to authenticated;
