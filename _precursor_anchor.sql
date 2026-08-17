-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 2: ЯКОРЬ + ЖУРНАЛ   (lore/precursor_memory.md §19–§20)
--
-- Было: состояние державы жило в горячей строке, а двигали его два тика —
--   • крон `precursor-weekly-step` → precursor_tick_all(500);
--   • `_pc_clock()` ВНУТРИ precursor_get(): каждое открытие вкладки раз в час
--     запускало обход 300 миров. Тик под видом чтения.
-- Из-за этого модель и не могла быть сложнее четырёх цифр.
--
-- Стало (§19):
--   БД хранит   : якорь (seed, время спавна, надломы, седмицы — НЕИЗМЕННОЕ)
--                 + журнал действий игрока (primitive_acts, он уже есть)
--   Клиент      : state(t) = f(seed, spawn_at, now, журнал)   ← precursor_sim.js
--   БД проверяет: только недоверяемое (деньги, флот, ступень) — этап 3
--
-- Накат идемпотентный: катается повторно без вреда.
-- ════════════════════════════════════════════════════════════

-- ── 1. ЯКОРЬ ───────────────────────────────────────────────
-- Надломы, чёрные седмицы и начальное русло считаются ОДИН раз при спавне
-- и больше не меняются никогда: всё остальное — вычисление от них и журнала.
alter table public.primitive_civs
  add column if not exists anchor    jsonb,
  add column if not exists anchor_at timestamptz;

comment on column public.primitive_civs.anchor is
  'Якорь §19: {wounds[],weeks[],base{alarm,stead,grit}}. Пишется один раз, immutable.';

-- Якорь неизменен. Не «не рекомендуется менять» — нельзя: на нём стоит вся
-- вычисляемая история, и правка задним числом переписала бы прошлое державы.
create or replace function public._pc_anchor_guard()
returns trigger language plpgsql as $$
begin
  if old.anchor is not null and new.anchor is distinct from old.anchor then
    raise exception 'anchor immutable (§19): % / %', old.system_id, old.pid;
  end if;
  return new;
end$$;

drop trigger if exists trg_pc_anchor_guard on public.primitive_civs;
create trigger trg_pc_anchor_guard
  before update on public.primitive_civs
  for each row execute function public._pc_anchor_guard();

-- Запись якоря: только пока его нет. Считает генератор (precursor_sim.anchor),
-- но подменить существующий не может ни клиент, ни админ — только пересев мира.
create or replace function public.precursor_anchor_set(
  p_system_id text, p_pid integer, p_anchor jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if p_anchor is null or jsonb_typeof(p_anchor->'wounds') <> 'array' then
    return jsonb_build_object('ok', false, 'err', 'нет надломов');
  end if;
  update public.primitive_civs
     set anchor = p_anchor, anchor_at = now()
   where system_id = p_system_id and pid = p_pid and anchor is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'err', case when n = 0 then 'якорь уже стоит' end);
end$$;

revoke all on function public.precursor_anchor_set(text, integer, jsonb) from public;
grant execute on function public.precursor_anchor_set(text, integer, jsonb) to authenticated;

-- ── 2. ЖУРНАЛ ──────────────────────────────────────────────
-- primitive_acts уже хранит все действия — ему не хватало двух полей модели:
--   reg   — образ появления (§7.1): знамение / их словом / тихо;
--   wound — адресный надлом (§11): к чему именно суд памяти, вира, запись.
alter table public.primitive_acts
  add column if not exists reg   text,
  add column if not exists wound text;

comment on column public.primitive_acts.reg   is '§7.1 образ появления: знамение | их словом | тихо';
comment on column public.primitive_acts.wound is '§11 адресный надлом (src), для суда памяти / виры / записи';

-- Журнал читается целиком по одному миру и по порядку — под это и индекс.
create index if not exists idx_primitive_acts_world on public.primitive_acts (system_id, pid, at);

-- ── 3. СНЯТЬ ТИК ───────────────────────────────────────────
-- 3.1 Крон дозвёздных.
do $$
begin
  perform cron.unschedule('precursor-weekly-step');
exception when others then null;
end$$;

-- 3.2 Тик, спрятанный внутри чтения. `_pc_clock` остаётся заглушкой, чтобы
-- не ронять прочие вызовы, но больше ничего не делает.
create or replace function public._pc_clock()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  -- §19: посуточный шаг уехал в клиент (precursor_sim.js). Чтение больше не тикает.
  return;
end$$;

-- 3.3 Первый контакт и узы — это не шаг державы, а обзор галактики. Им
-- расписание нужно, но раз в час и отдельно от чтения вкладки.
do $$
begin
  perform cron.unschedule('precursor-contacts-bonds');
exception when others then null;
end$$;
select cron.schedule('precursor-contacts-bonds', '25 * * * *',
  $$select public.precursor_scan_contacts(200); select public._pc_bonds_tick();$$);

-- ── 4. ЧТЕНИЕ: якорь + журнал вместо тика ──────────────────
-- Журнал одного мира. Отдаём ВЕСЬ: без него клиент не восстановит state(t),
-- а он маленький — это десятки строк за всю жизнь мира, не тысячи.
create or replace function public._pc_journal(p_system_id text, p_pid integer, p_fid text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'd',     greatest(0, (extract(epoch from (a.at - c.created_at)) / 86400)::int),
           'act',   a.action,
           'reg',   a.reg,
           'wound', a.wound,
           'fid',   a.faction_id,
           'mine',  (a.faction_id = p_fid),
           'at',    a.at
         ) order by a.at), '[]'::jsonb)
    from public.primitive_acts a
    join public.primitive_civs c on c.system_id = a.system_id and c.pid = a.pid
   where a.system_id = p_system_id and a.pid = p_pid;
$$;

create or replace function public.precursor_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; v jsonb; rep int; v_faith uuid; v_faith_nm text; v_stigma int;
begin
  fid := public._ec_my_fid();
  -- ни _pc_clock(), ни scan_contacts, ни _pc_bonds_tick: чтение больше не пишет.
  select coalesce(f.rep, 0) into rep from public.faction_foundation f where f.faction_id = fid;
  -- Клеймо витрина показывает только по СВОЕЙ вере — основанной этой державой.
  -- Чужая вера, в которой держава лишь состоит, к обряду отношения не имеет.
  select m.faith_id into v_faith from public.faith_membership m
    where m.faction_id = fid and m.role = 'founder' limit 1;
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
                                   -- §19: журнал — второй вход симуляции наравне с якорем
                                   'journal', public._pc_journal(c.system_id, c.pid, fid),
                                   'spawn_at', c.created_at,
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

-- ── 5. ПРОВЕРКА ────────────────────────────────────────────
-- Крон дозвёздных снят, чтение не пишет, журнал на месте.
select jsonb_pretty(jsonb_build_object(
  'кроны',    (select coalesce(jsonb_agg(jobname), '[]'::jsonb) from cron.job where jobname like 'precursor%'),
  'миров',    (select count(*) from public.primitive_civs),
  'с якорем', (select count(*) from public.primitive_civs where anchor is not null),
  'журнал',   (select count(*) from public.primitive_acts)
)) as итог;
