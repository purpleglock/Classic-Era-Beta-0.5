-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ЯКОРЯ: ЗДОРОВЬЕ КРИЗИСА ЛЕЖИТ НА КАРТЕ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_phase2.sql и _angel_registry.sql. Надмножество
-- `_angel_regen` и `angel_status`. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Ответ на кризис был один: построить Длань и нажать ПУСК
-- сорок раз. В одиночку, не глядя на карту. Фаза 2 это только удорожила —
-- разворот снаряда сделал ПУСК опаснее, но ответ остался тем же самым.
--
-- ⚠️ ЗАБРАКОВАНО: «печать ломается только залпами трёх РАЗНЫХ держав».
-- Это не механика, а налог на созвон: тот же ПУСК, только теперь жди, пока
-- другие зайдут в игру. Игрок не решает ничего сам.
-- ⚠️ ЗАБРАКОВАНО: «Длань не убивает, а показывает, куда бить». Понижать
-- главное оружие игры до целеуказателя — значит отнимать у игрока то, во что
-- он вложился больше всего.
--
-- ПРАВИЛО. Длань убивает как убивала — урон настоящий, ПУСК есть ПУСК.
-- Якоря мешают не убить, а ДОБИТЬ:
--
--   • каждый переплавленный мир оставляет за ним систему — это ЯКОРЬ;
--   • печати зарастают ТОЛЬКО с якорей: нет якорей — нет зарастания вовсе;
--   • пока якорей много, они зарастают быстрее, чем их успевают отстреливать,
--     и сорок залпов уходят в песок;
--   • якорь снимается боем в космосе: выбить крыло из системы и остаться в
--     ней. Снятый якорь СРАЗУ рвёт печати и навсегда убирает своё зарастание.
--
-- Две работы, обе нужны: флот сбивает зарастание, Длань добивает тело.
-- Ни одна не отменяет другую.
--
-- ⚠️ НИКАКОЙ НАЗЕМКИ. Армии в заморозке (см. army-frozen-kill-or-save):
-- якорь снимается ровно тем, что в игре работает, — флотом и доской.
--
-- ЧИСЛА, ПО КОТОРЫМ СЧИТАНО (живая база, 24.08):
--   • печатей 100, снаряд Длани снимает 2.2–3.4, полный слом — 30–45 попаданий;
--   • старое зарастание 1.6/час (в гнезде 3.2) — это ~3 отменённых снаряда
--     за пять часов покоя, и оно шло ВСЕГДА, даже у голодного;
--   • теперь 1.6/час ЗА ЯКОРЬ, потолок вклада — 8 якорей. При десяти якорях
--     это 12.8/час: стрелять бесполезно, пока не снял их. При нуле — 0, и
--     кампания Длани доводится до конца без единой отмены.
--   • снятый якорь рвёт 5 печатей сразу. Десять снятых = −50 и тишина.
-- ════════════════════════════════════════════════════════════

-- ── 0. СХЕМА ────────────────────────────────────────────────
create table if not exists public.angel_anchor (
  system_id   text primary key,
  faction_id  text not null,
  worlds      int  not null default 1,     -- сколько миров он тут переплавил
  born_at     timestamptz not null default now(),
  broken_at   timestamptz,
  broken_by   text
);
create index if not exists angel_anchor_live_idx
  on public.angel_anchor (faction_id) where broken_at is null;

alter table public.angel_anchor enable row level security;
drop policy if exists angel_anchor_read on public.angel_anchor;
create policy angel_anchor_read on public.angel_anchor
  for select to authenticated using (true);
revoke insert, update, delete on public.angel_anchor from anon, authenticated;

create or replace function public._angel_anchor_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'regen_each' then 1.6   -- печатей в час ЗА ЯКОРЬ (было 1.6 всего)
    when 'regen_cap'  then 8     -- потолок числа якорей, кормящих зарастание
    when 'break_seal' then 5     -- печатей рвётся при снятии одного якоря
    else 0 end
$$;

-- ── 1. ЗАВЕСТИ ЯКОРЯ ПО ПЕРЕПЛАВЛЕННОМУ ─────────────────────
-- ⚠️ Отдельным проходом, а НЕ правкой `_angel_transmute`: та функция большая
-- и занята переплавкой. Здесь сверяем реестр переплавленного с реестром
-- якорей — заодно подхватывается всё, что съедено ДО этого наката.
create or replace function public._angel_anchor_sync()
returns jsonb language plpgsql security definer set search_path=public as $$
declare n int := 0;
begin
  insert into public.angel_anchor(system_id, faction_id, worlds, born_at)
    select t.system_id, t.faction_id, count(*), min(t.done_at)
      from public.angel_transmute t
     where t.done_at is not null and t.system_id is not null
     group by t.system_id, t.faction_id
  on conflict (system_id) do update
     set worlds = excluded.worlds;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'synced', n);
end$$;
revoke all on function public._angel_anchor_sync() from public;

-- ── 2. СНЯТИЕ ЯКОРЯ ─────────────────────────────────────────
-- Якорь держится присутствием. Он снят, когда в системе стоит флот врага, а
-- своего крыла (и тела) там больше нет. То есть ровно то, что игрок и так
-- умеет: прийти, выбить крыло с доски и остаться.
--
-- ⚠️ СЧИТАЕМ ТОЛЬКО `idle`. Флот в прыжке систему не держит — иначе якорь
-- сняло бы пролётом, и «остаться» перестало бы что-либо значить.
create or replace function public._angel_anchor_sweep()
returns jsonb language plpgsql security definer set search_path=public as $$
declare af text; r record; taker text; broke int := 0; lost numeric := 0;
        sysname text; mx numeric; cur numeric;
begin
  af := public._angel_fid();
  if af is null then return jsonb_build_object('ok', true, 'why', 'ангела нет'); end if;
  perform public._angel_anchor_sync();
  mx := public._angel_const('seals_max');

  for r in select * from public.angel_anchor
            where faction_id = af and broken_at is null
  loop
    -- Своё присутствие: крыло, страж или тело в этой системе.
    if exists (select 1 from public.fleets f
                where f.faction_id = af and f.system_id = r.system_id) then
      continue;
    end if;

    -- Чужое присутствие: флот того, кто с ним воюет, стоящий на месте.
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

    -- Печати рвутся СРАЗУ. Это и есть награда за взятие системы: не «очки»,
    -- а прямой урон по тому, чем кризис держится.
    select seals into cur from public.angel_state where faction_id = af;
    update public.angel_state
       set seals = greatest(0, seals - public._angel_anchor_const('break_seal')),
           last_hit = now()
     where faction_id = af;
    lost  := lost + public._angel_anchor_const('break_seal');
    broke := broke + 1;

    select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = r.system_id;
    perform public._war_news(
      '◈ ЯКОРЬ СНЯТ: ' || coalesce(sysname, r.system_id),
      format('Флоты %s заняли переплавленную систему «%s» и удерживают её. '
          || 'Печати Престола сошлись на %s меньше, и эта система больше не залечивает его. '
          || 'Якорей у кризиса осталось: %s.',
          public._war_nm(taker), coalesce(sysname, r.system_id),
          public._angel_anchor_const('break_seal')::int,
          (select count(*) from public.angel_anchor where faction_id = af and broken_at is null)),
      jsonb_build_array(taker, af));

    -- Печати кончились от снятия якорей — это законная смерть кризиса.
    if (select seals from public.angel_state where faction_id = af) <= 0 then
      begin perform public._angel_fall(af, taker); exception when others then null; end;
      exit;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'broken', broke, 'seals_lost', lost,
    'live', (select count(*) from public.angel_anchor where faction_id = af and broken_at is null));
end$$;
revoke all on function public._angel_anchor_sweep() from public;

-- ── 3. ЗАРАСТАНИЕ — ТОЛЬКО С ЯКОРЕЙ ─────────────────────────
-- Надмножество `_angel_regen` (_angel_core.sql, шаг 11). Единственная правка —
-- множитель по числу живых якорей. Покой и гнездо считаются как считались.
create or replace function public._angel_regen()
returns void language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; calm boolean; gain numeric; mul numeric; mx numeric;
        f record; anch int;
begin
  mx := public._angel_const('seals_max');
  for a in select * from public.angel_state where fell_at is null loop
    calm := a.last_hit is null
         or now() - a.last_hit > (public._angel_const('calm_h') || ' hours')::interval;
    if not calm then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;
    hrs := greatest(0, least(24, extract(epoch from (now() - a.last_regen)) / 3600.0));
    if hrs < 0.05 then continue; end if;

    -- ЯКОРЯ. Ноль якорей — ноль зарастания: голодному кризису нечем лечиться,
    -- и кампания Длани доводится до конца без единой отмены.
    select count(*)::int into anch from public.angel_anchor
     where faction_id = a.faction_id and broken_at is null;
    if anch <= 0 then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;

    select * into f from public.fleets where id = a.fleet_id;
    mul := case when a.stance = 'roost' and coalesce(f.system_id,'') = coalesce(a.home_sys,'')
                then public._angel_const('roost_mul') else 1 end;
    gain := public._angel_anchor_const('regen_each') * hrs * mul
            * least(anch, public._angel_anchor_const('regen_cap')::int);
    update public.angel_state
       set seals = least(mx, seals + gain), last_regen = now()
     where faction_id = a.faction_id;
  end loop;
end$$;
revoke all on function public._angel_regen() from public;

-- ── 4. ЯКОРЯ ВИДНЫ ВСЕМ ─────────────────────────────────────
-- Читают все и всегда: пятно на карте — это и есть полоса здоровья кризиса,
-- прятать её не от кого. Разведка тут ничего не решает.
create or replace function public.angel_anchors()
returns table(system_id text, name text, worlds int, born_at timestamptz)
language sql stable security definer set search_path=public as $$
  select a.system_id,
         coalesce(nullif(ms.name,''), a.system_id),
         a.worlds, a.born_at
    from public.angel_anchor a
    left join public.map_systems ms on ms.id = a.system_id
   where a.broken_at is null
   order by a.born_at
$$;
revoke all on function public.angel_anchors() from public;
grant execute on function public.angel_anchors() to authenticated;

-- ── 5. СВЕДЕНИЕ В ТИК ───────────────────────────────────────
-- Надмножество `angel_ai_tick`: добавлен проход по якорям. Он должен идти
-- ПОСЛЕ переплавки (появились новые) и ДО зарастания в `angel_war_tick`,
-- иначе снятый якорь успел бы покормить печати последний раз.
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
  return out || jsonb_build_object('ok', true);
end$$;
revoke all on function public.angel_ai_tick() from public;
grant execute on function public.angel_ai_tick() to authenticated;

notify pgrst, 'reload schema';

-- ── 6. ЗАВЕСТИ ЯКОРЯ ПО УЖЕ СЪЕДЕННОМУ ──────────────────────
do $$
declare r jsonb; n int; s numeric;
begin
  r := public._angel_anchor_sync();
  select count(*) into n from public.angel_anchor where broken_at is null;
  select seals into s from public.angel_state where fell_at is null limit 1;
  raise notice 'якорей заведено: % (%)', n, r;
  raise notice 'печатей сейчас: %, зарастание: %/час',
    round(coalesce(s,0),1),
    round(public._angel_anchor_const('regen_each')
          * least(n, public._angel_anchor_const('regen_cap')::int), 1);
end$$;
