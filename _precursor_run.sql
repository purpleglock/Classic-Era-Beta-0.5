-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ПАРТИЯ  (правила — lore/precursor_run.md)
--
-- Партия — это игра на мире: двенадцать веков, влияние как время века, две
-- шкалы (развитие и ущерб) и три исхода. До этого наката она считалась
-- ТОЛЬКО в браузере: деньги списывались понарошку и возвращались по F5.
--
-- Здесь партия становится серверной. Правило прежнее и общее для всей фичи:
-- считает клиент, ДЕНЬГИ И РЕПУТАЦИЮ СЧИТАЕТ БАЗА. Ни один рубль и ни одно
-- очко Фонда не берутся с клиентского слова — цены сидят в `_pcr_act`, и
-- совпадать они обязаны с precursor_run.js.
--
-- Второй кассы не заводим: ГС уходят из `faction_economy`, досье двигает
-- `_pc_rep` (_precursor_decisions.sql) — тот же, что у остальных решений,
-- со штрафом в четверть казны на −100.
--
-- Накат идемпотентный. Порядок: после `_precursor_decisions.sql`
-- (нужен `_pc_rep`) и `_precursor_commit.sql`.
-- ════════════════════════════════════════════════════════════

create table if not exists public.precursor_run (
  faction_id  text        not null,
  system_id   text        not null,
  pid         integer     not null,
  turn        integer     not null default 1,     -- век 1..12
  att         integer     not null default 3,     -- влияние: время века
  flow        integer     not null default 20,    -- РАЗВИТИЕ (в лоре — русло)
  wound       integer     not null default 10,    -- УЩЕРБ (в лоре — надлом)
  ache        integer     not null default 0,     -- сколько раз открыли правду
  mark        text,                               -- хвост прошлого века
  node        text,                               -- где стоит хроника
  flags       jsonb       not null default '{}'::jsonb,
  decided     boolean     not null default false, -- событие века закрыто?
  tier        integer     not null default 0,     -- уровень мира: от него цена
  spent       numeric     not null default 0,     -- ГС за партию
  fined       numeric     not null default 0,     -- сколько взыскал Фонд
  trail       jsonb       not null default '[]'::jsonb,  -- что игрок делал
  ending      text,                               -- держава | кризис | собой
  why         text,                               -- срок | срыв
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (faction_id, system_id, pid)
);

comment on table public.precursor_run is
  'Партия на дозвёздном мире: срок, влияние, развитие/ущерб, исход. Деньги и Фонд списываются здесь же.';

alter table public.precursor_run enable row level security;

-- Читать — только своё. Писать напрямую нельзя вовсе: единственные двери —
-- функции ниже, иначе исход и казна ставятся из консоли.
revoke insert, update, delete on public.precursor_run from public, anon, authenticated;
drop policy if exists pcrun_read_own on public.precursor_run;
create policy pcrun_read_own on public.precursor_run
  for select using (faction_id = public._ec_my_fid());

-- ── ПОСТОЯННЫЕ ПАРТИИ ──────────────────────────────────────
-- Совпадают с precursor_run.js. Расходятся — расходится и игра.
create or replace function public._pcr_const()
returns jsonb language sql immutable as $$
  select jsonb_build_object('срок', 12, 'приход', 3, 'потолок', 5,
                            'предел', 100, 'дрейф', 3)
$$;

-- ── ЦЕНА И СДВИГ ДЕЙСТВИЯ ──────────────────────────────────
-- `гс` считается от уровня мира — та же шкала, что у решений
-- (_precursor_commit.sql), `фонд` — та же, что в _precursor_decisions.sql.
create or replace function public._pcr_act(p_act text, p_tier int)
returns jsonb language sql immutable as $$
  select case p_act
    when 'покой'  then jsonb_build_object('att',1,'gc',0,
                        'rep', 5,'flow', 0,'wound', -7,'tail','глухо')
    when 'ритм'   then jsonb_build_object('att',2,'gc', 60000 + 20000*greatest(p_tier,0),
                        'rep',-3,'flow', 8,'wound', -5,'tail','беда')
    when 'слово'  then jsonb_build_object('att',2,'gc', 90000 + 30000*greatest(p_tier,0),
                        'rep',-15,'flow',12,'wound',  5,'tail','ноет')
    when 'тёмное' then jsonb_build_object('att',1,'gc',0,
                        'rep',-35,'flow',18,'wound', 14,'tail','злоба')
    else null end
$$;

-- ── ЧТЕНИЕ ─────────────────────────────────────────────────
-- Отдаёт партию (или заготовку, если её ещё нет) вместе с казной и досье:
-- экран рисует цену действия и должен знать, тянет ли её держава.
create or replace function public.precursor_run_get(p_system_id text, p_pid integer)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; c public.primitive_civs%rowtype;
        v_gc numeric; v_rep int; v_wounds int;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  select gc into v_gc from public.faction_economy where faction_id = fid;
  select coalesce(rep, 0) into v_rep from public.faction_foundation where faction_id = fid;

  select * into r from public.precursor_run
   where faction_id = fid and system_id = p_system_id and pid = p_pid;
  if found then
    return jsonb_build_object('ok', true, 'fresh', false,
      'run', to_jsonb(r), 'gc', coalesce(v_gc,0), 'rep', coalesce(v_rep,0));
  end if;

  -- Заготовка: мир не начинается здоровым. Стартовый ущерб — по незакрытым
  -- надломам якоря, ровно как в precursor_run.js.
  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  select count(*) into v_wounds from jsonb_array_elements(coalesce(c.anchor->'wounds','[]'::jsonb)) w
   where coalesce(w->>'state','') <> 'изжитый';
  return jsonb_build_object('ok', true, 'fresh', true,
    'run', jsonb_build_object('turn',1,'att',3,'flow',20,
             'wound', least(60, 10 + coalesce(v_wounds,0)*12),
             'ache',0,'decided',false,'tier',coalesce(c.tier,0),
             'spent',0,'fined',0,'flags','{}'::jsonb,'trail','[]'::jsonb),
    'gc', coalesce(v_gc,0), 'rep', coalesce(v_rep,0));
end$$;

-- Завести строку, если её ещё нет. Отдельно — зовётся из обеих дверей.
create or replace function public._pcr_open(p_fid text, p_system_id text, p_pid integer)
returns public.precursor_run
language plpgsql volatile security definer set search_path to 'public' as $$
declare r public.precursor_run%rowtype; c public.primitive_civs%rowtype; v_wounds int;
begin
  select * into r from public.precursor_run
   where faction_id = p_fid and system_id = p_system_id and pid = p_pid;
  if found then return r; end if;

  select * into c from public.primitive_civs where system_id = p_system_id and pid = p_pid;
  if not found then return null; end if;
  select count(*) into v_wounds from jsonb_array_elements(coalesce(c.anchor->'wounds','[]'::jsonb)) w
   where coalesce(w->>'state','') <> 'изжитый';

  insert into public.precursor_run(faction_id, system_id, pid, wound, tier, node)
  values (p_fid, p_system_id, p_pid,
          least(60, 10 + coalesce(v_wounds,0)*12), coalesce(c.tier,0), null)
  on conflict (faction_id, system_id, pid) do nothing;

  select * into r from public.precursor_run
   where faction_id = p_fid and system_id = p_system_id and pid = p_pid;
  return r;
end$$;

-- ── ДВЕРЬ 1 · СТУПЕНЬ РУКИ ─────────────────────────────────
-- Здесь и только здесь уходят деньги и двигается досье Фонда.
create or replace function public.precursor_run_act(
  p_system_id text, p_pid integer, p_act text)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; a jsonb; K jsonb;
        v_gc numeric; v_cost numeric; v_rep int; v_fine numeric := 0; v_before int;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  r := public._pcr_open(fid, p_system_id, p_pid);
  if r.faction_id is null then return jsonb_build_object('ok', false, 'why', 'мира нет'); end if;
  if r.ending is not null then return jsonb_build_object('ok', false, 'why', 'партия окончена'); end if;

  a := public._pcr_act(p_act, r.tier);
  if a is null then return jsonb_build_object('ok', false, 'why', 'нет такого действия'); end if;
  if r.att < (a->>'att')::int then
    return jsonb_build_object('ok', false, 'why', 'в этом веке уже некогда');
  end if;

  v_cost := (a->>'gc')::numeric;
  select gc into v_gc from public.faction_economy where faction_id = fid for update;
  if v_cost > 0 and coalesce(v_gc, 0) < v_cost then
    return jsonb_build_object('ok', false,
      'why', 'казна не тянет: нужно ' || v_cost::bigint || ' ГС');
  end if;
  if v_cost > 0 then
    update public.faction_economy set gc = gc - v_cost where faction_id = fid;
  end if;

  -- Досье Фонда: тем же счётом, что у прочих решений. Штраф в четверть казны
  -- на −100 берёт сам `_pc_rep`, поэтому казну читаем ПОСЛЕ него.
  select coalesce(rep, 0) into v_before from public.faction_foundation where faction_id = fid;
  v_rep := public._pc_rep(fid, (a->>'rep')::int);
  if v_before > -100 and v_rep = -50 then
    select coalesce(v_gc,0) - v_cost - coalesce(gc,0) into v_fine
      from public.faction_economy where faction_id = fid;
    v_fine := greatest(0, v_fine);
  end if;

  K := public._pcr_const();
  update public.precursor_run set
    att   = att - (a->>'att')::int,
    flow  = least(100, greatest(0, flow  + (a->>'flow')::int)),
    wound = least((K->>'предел')::int, greatest(0, wound + (a->>'wound')::int)),
    ache  = ache + (case when a->>'tail' = 'ноет' then 1 else 0 end),
    mark  = (case when a->>'tail' in ('беда','злоба') then a->>'tail' else mark end),
    spent = spent + v_cost,
    fined = fined + v_fine,
    trail = trail || jsonb_build_object('век', turn, 'что', p_act),
    updated_at = now()
  where faction_id = fid and system_id = p_system_id and pid = p_pid
  returning * into r;

  -- Срыв мог случиться прямо здесь: ущерб добрался до предела раньше срока.
  if r.wound >= (K->>'предел')::int then
    update public.precursor_run set ending = 'кризис', why = 'срыв', updated_at = now()
     where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  end if;

  select gc into v_gc from public.faction_economy where faction_id = fid;
  return jsonb_build_object('ok', true, 'run', to_jsonb(r),
    'gc', coalesce(v_gc,0), 'rep', v_rep, 'fine', v_fine, 'cost', v_cost);
end$$;

-- ── ДВЕРЬ 2 · РЕШЕНИЕ ВЕКА ─────────────────────────────────
-- Вариант приходит из хроники (клиент), но ВЕС его сервер приводит к своим
-- рамкам: −2..+2, как в пластах. Денег решение века не стоит — оно стоит
-- влияния, то есть времени.
create or replace function public.precursor_run_pick(
  p_system_id text, p_pid integer, p_node text, p_weight integer,
  p_att integer, p_flags jsonb, p_name text)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; K jsonb; w int; v_att int;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  r := public._pcr_open(fid, p_system_id, p_pid);
  if r.faction_id is null then return jsonb_build_object('ok', false, 'why', 'мира нет'); end if;
  if r.ending is not null then return jsonb_build_object('ok', false, 'why', 'партия окончена'); end if;
  if r.decided then return jsonb_build_object('ok', false, 'why', 'в этом веке уже решено'); end if;

  w := greatest(-2, least(2, coalesce(p_weight, 0)));
  v_att := greatest(0, least(2, coalesce(p_att, 0)));
  if r.att < v_att then return jsonb_build_object('ok', false, 'why', 'в этом веке уже некогда'); end if;

  K := public._pcr_const();
  update public.precursor_run set
    att     = att - v_att,
    flow    = least(100, greatest(0, flow + w * 6)),
    wound   = least((K->>'предел')::int, greatest(0, wound - w * 3)),
    node    = coalesce(nullif(p_node, ''), node),
    flags   = flags || coalesce(p_flags, '{}'::jsonb),
    decided = true,
    trail   = trail || jsonb_build_object('век', turn, 'что', coalesce(p_name, 'решение')),
    updated_at = now()
  where faction_id = fid and system_id = p_system_id and pid = p_pid
  returning * into r;

  if r.wound >= (K->>'предел')::int then
    update public.precursor_run set ending = 'кризис', why = 'срыв', updated_at = now()
     where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'run', to_jsonb(r));
end$$;

-- ── ДВЕРЬ 3 · ЗАКРЫТЬ ВЕК ──────────────────────────────────
-- Часы идут только здесь. Мир ходит сам: непрожитая беда не рассасывается.
create or replace function public.precursor_run_turn(p_system_id text, p_pid integer)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; K jsonb; v_d int; v_end text;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  select * into r from public.precursor_run
   where faction_id = fid and system_id = p_system_id and pid = p_pid;
  if not found then return jsonb_build_object('ok', false, 'why', 'партия не начата'); end if;
  if r.ending is not null then return jsonb_build_object('ok', false, 'why', 'партия окончена'); end if;
  if not r.decided then return jsonb_build_object('ok', false, 'why', 'век не решён'); end if;

  K := public._pcr_const();
  update public.precursor_run set
    wound = least((K->>'предел')::int,
             wound + (K->>'дрейф')::int + ache * 2 + (case when mark = 'беда' then 3 else 0 end)),
    mark  = null,
    updated_at = now()
  where faction_id = fid and system_id = p_system_id and pid = p_pid
  returning * into r;

  if r.turn >= (K->>'срок')::int then
    v_d := r.flow - r.wound;
    v_end := case when v_d > 15 then 'держава' when v_d < -15 then 'кризис' else 'собой' end;
    update public.precursor_run set ending = v_end, why = 'срок', updated_at = now()
     where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  elsif r.wound >= (K->>'предел')::int then
    update public.precursor_run set ending = 'кризис', why = 'срыв', updated_at = now()
     where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  else
    update public.precursor_run set
      turn = turn + 1,
      att = least((K->>'потолок')::int, att + (K->>'приход')::int),
      decided = false,
      updated_at = now()
    where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  end if;

  return jsonb_build_object('ok', true, 'run', to_jsonb(r));
end$$;

grant execute on function public.precursor_run_get(text, integer)                              to authenticated;
grant execute on function public.precursor_run_act(text, integer, text)                        to authenticated;
grant execute on function public.precursor_run_pick(text, integer, text, integer, integer, jsonb, text) to authenticated;
grant execute on function public.precursor_run_turn(text, integer)                             to authenticated;
