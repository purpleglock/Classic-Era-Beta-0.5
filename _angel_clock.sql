-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ЧАСЫ: У КРИЗИСА ПОЯВЛЯЕТСЯ КОНЕЦ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_anchors.sql. Надмножество `angel_ai_tick`.
-- Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. У кризиса не было дедлайна. Совсем. Он ходил по карте,
-- ел соседей и мог делать это бесконечно — а значит его можно было просто
-- не замечать: ничем не грозило. Кризис без часов — это фон, а не кризис.
--
-- ПРАВИЛО. Один счётчик на всю галактику, видный ВСЕМ державам:
--
--     ВОЗНЕСЕНИЕ = съеденное население / порог
--
-- Съеденное считается из `angel_transmute.taken` — того же поля, по которому
-- идёт переплавка. Отдельного состояния не заводим: два счётчика одного и
-- того же неизбежно разъезжаются (так уже было с доходом ГС, gc-income-mirror-drift).
--
-- ПОРОГ. Население галактики на 24.08 — 706 198 в 1746 колониях. Порог 150 000
-- это чуть больше пятой части: столько нельзя съесть незаметно, но и не
-- «полгалактики», до которых партия не доживёт. Съедено на сейчас 7 412 —
-- то есть 4.9%, и это за неделю С ОШИБКОЙ, из-за которой крылья не ели вовсе
-- (см. _angel_floor.sql: сковано боем — не ест).
--
-- ⚠️ ЧАСЫ НЕ ИДУТ САМИ. Они двигаются ТОЛЬКО когда оно ест. Замерло, сидит
-- в гнезде, выбито из систем — стрелка стоит. Это не таймер до поражения,
-- это счёт того, сколько у него отняли или не отняли миров.
-- ════════════════════════════════════════════════════════════

-- ── 0. СХЕМА ────────────────────────────────────────────────
-- `rung` — последняя объявленная ступень. Без неё сводка о вознесении шла бы
-- на каждый тик (ровно так уже было с беседой ВК, news-vk-hourly-digest).
alter table public.angel_state add column if not exists rung int not null default 0;

create or replace function public._angel_clock_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'goal' then 150000   -- население, после которого партия кончается
    else 0 end
$$;

-- ── 1. ЧАСЫ ─────────────────────────────────────────────────
create or replace function public.angel_clock()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'ok',      true,
    'exists',  (select count(*) > 0 from public.angel_state where fell_at is null),
    'taken',   round(coalesce((select sum(taken) from public.angel_transmute), 0), 1),
    'goal',    public._angel_clock_const('goal'),
    'pct',     round(least(100, 100 * coalesce((select sum(taken) from public.angel_transmute), 0)
                            / nullif(public._angel_clock_const('goal'), 0)), 1),
    'worlds',  (select count(*)::int from public.angel_transmute where done_at is not null),
    'eating',  (select count(*)::int from public.angel_transmute where done_at is null),
    'anchors', (select count(*)::int from public.angel_anchor where broken_at is null),
    'broken',  (select count(*)::int from public.angel_anchor where broken_at is not null))
$$;
revoke all on function public.angel_clock() from public, anon;
grant execute on function public.angel_clock() to authenticated, anon;

-- ── 2. СТУПЕНИ И СВОДКИ ─────────────────────────────────────
-- Ступени редкие и крупные: четверть, половина, три четверти, девять десятых,
-- конец. Между ними кризис молчит — иначе счётчик превращается в спам.
create or replace function public._angel_clock_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; pct numeric; rung int; want int; nm text;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;

  pct  := (public.angel_clock()->>'pct')::numeric;
  select coalesce(a.rung, 0) into rung from public.angel_state a where a.faction_id = af;
  want := case when pct >= 100 then 5 when pct >= 90 then 4
               when pct >= 75  then 3 when pct >= 50 then 2
               when pct >= 25  then 1 else 0 end;
  if want <= rung then return jsonb_build_object('ok', true, 'pct', pct, 'rung', rung); end if;

  update public.angel_state set rung = want where faction_id = af;
  nm := public._war_nm(af);

  if want = 5 then
    perform public._war_news(
      public._angel_glitch('◈ ВОЗНЕСЕНИЕ', 0.30),
      public._angel_glitch(
        'Счёт закрыт. Того населения, которое числилось в реестрах галактики, '
        || 'больше нет в реестрах галактики. Отметка не двинулась с места и не '
        || 'подала сигнала. Наблюдение продолжается', 0.24) || ' ' || public._angel_scream(20),
      null);
  else
    perform public._war_news(
      public._angel_glitch('◈ ВОЗНЕСЕНИЕ: ' || round(pct)::text || '%', 0.22),
      public._angel_glitch(
        format('Сводный учёт населения по галактике сходится с недостачей. '
            || 'Недостача составляет %s из %s. Отметку последний раз видели у своих якорей; '
            || 'якорей за ней числится %s. Ниже приложен список систем, которые перестали отвечать',
          round((public.angel_clock()->>'taken')::numeric)::text,
          round(public._angel_clock_const('goal'))::text,
          (public.angel_clock()->>'anchors')), 0.18) || ' ' || public._angel_scream(12),
      null);
  end if;

  return jsonb_build_object('ok', true, 'pct', pct, 'rung', want, 'rang', true);
end$$;
revoke all on function public._angel_clock_tick() from public;

-- ── 3. ЧАСЫ ЧИТАЮТСЯ СВОЕЙ ДВЕРЬЮ ───────────────────────────
-- ⚠️ ЗАБРАКОВАНО: доклеивать часы к `angel_status` через pg_get_functiondef.
-- Пробовал — код собирается строкой, а тело `angel_status` само в долларовых
-- кавычках, и пересборка рвётся на первой же вложенной. Такой генератор ещё
-- и молча отвалится при любой правке `angel_status` в другом файле.
-- Часы отдаёт `angel_clock()`: отдельный вызов, ничего не ломает, читают все.

-- ── 4. В ТИК ────────────────────────────────────────────────
create or replace function public.angel_ai_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out jsonb := '{}'::jsonb;
begin
  begin out := out || jsonb_build_object('host',   public.angel_host_muster());  exception when others then null; end;
  begin out := out || jsonb_build_object('guard',  public.angel_guard_muster()); exception when others then null; end;
  begin out := out || jsonb_build_object('follow', public._angel_host_follow()); exception when others then null; end;
  begin out := out || jsonb_build_object('melt',   public._angel_transmute());   exception when others then null; end;
  begin out := out || jsonb_build_object('anchor', public._angel_anchor_sweep()); exception when others then null; end;
  begin out := out || jsonb_build_object('board',  public.angel_battle_tick());  exception when others then null; end;
  begin out := out || jsonb_build_object('war',    public.angel_war_tick());     exception when others then null; end;
  begin out := out || jsonb_build_object('clock',  public._angel_clock_tick());  exception when others then null; end;
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;
grant execute on function public.angel_ai_tick() to authenticated;

notify pgrst, 'reload schema';

do $$
declare c jsonb;
begin
  c := public.angel_clock();
  raise notice 'ЧАСЫ: % %% (% из %), миров съедено %, в переплавке %, якорей %',
    c->>'pct', c->>'taken', c->>'goal', c->>'worlds', c->>'eating', c->>'anchors';
end$$;
