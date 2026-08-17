-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ЭТАП 7: ИХОР ДВУМЯ ДОРОГАМИ И НЕДОИМКА
-- (lore/precursor_memory.md §15, §18)
--
-- ПОРЯДОК: после _precursor_commit.sql. Идемпотентно.
--
-- Две дороги к ихору были и раньше, но обе — без цены:
--   долгая  — Завет: 0.6 + 0.2·тир в сутки, вечно (_precursor_bonds.sql §5.2);
--   короткая — вскрытие святилищ и обряд: 40–260 разом (precursor_commit,
--              _precursor_rite.sql), и после этого мир закрыт для Завета навсегда.
-- Короткая была строго выгоднее в короткую и ничем не оплачивалась в долгую.
--
-- НЕДОИМКА — единый галактический счёт, который и есть эта цена. Растёт от
-- КАЖДОЙ единицы ихора, взятой не Заветом; не падает от времени — счёт не
-- прощают; гасится только вирой (вернуть взятое в святилище) и мирами,
-- доведёнными до Согласия. Скрыта до первого порога, дальше ПУБЛИЧНА
-- с поимённой разбивкой: галактика видит, кто именно набрал.
--
-- Считает её сервер и только сервер (§19): она общая и она деньги.
-- ════════════════════════════════════════════════════════════

-- ── 1. КНИГА ДОЛГА ──────────────────────────────────────────
create table if not exists public.pc_arrears (
  faction_id text primary key,
  amount     numeric not null default 0,   -- текущий счёт: растёт от взятого, гасится вирой
  taken      numeric not null default 0,   -- сколько набрано за всю историю — НЕ гасится
  repaid     numeric not null default 0,   -- сколько возвращено
  worlds     int     not null default 0,   -- на скольких мирах брали
  first_at   timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pc_arrears enable row level security;

-- Реестр событий: он же публичная лента недоимки после первого порога.
create table if not exists public.pc_arrears_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  faction_id text not null,
  system_id  text,
  pid        int,
  kind       text not null default 'вскрытие',  -- вскрытие | обряд | вира | зачёт
  ichor      numeric not null default 0,
  weight     numeric not null default 0,
  tier       int
);
create index if not exists pc_arrears_log_at_idx on public.pc_arrears_log(at desc);
alter table public.pc_arrears_log enable row level security;

-- Где брали — там и будут собирать (§18.2). Копилка Сбора живёт по секторам
-- и заводится здесь же, чтобы этап 8 её только тратил.
create table if not exists public.pc_levy_pressure (
  sector_id  uuid primary key references public.map_sectors(id) on delete cascade,
  taken      numeric not null default 0,   -- сколько недоимки набрано в этом секторе
  pressure   numeric not null default 0,   -- сколько из неё ещё не отработано долями
  updated_at timestamptz not null default now()
);
alter table public.pc_levy_pressure enable row level security;

-- ── 2. ПОРОГИ (§18.1) ───────────────────────────────────────
-- Калибровка от размера залпа: одно вскрытие мира тира 2 весит ≈ 40–260 × 1.8,
-- то есть 70–470. «Слухи» — примерно после второго вскрытия в галактике,
-- «Сбор» — после дюжины. Жадность одного видна всем задолго до кризиса.
create or replace function public._pc_arrears_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'rumors' then 400      -- недоимка становится видна всем
    when 'signs'  then 1200     -- ставка Завета падает по всей галактике
    when 'levy'   then 2600     -- Сбор выходит на карту
    when 'full'   then 6000     -- полный сбор
    when 'fee'    then 0.25     -- пеня: сверх взятого
    when 'credit' then 0.5      -- зачёт: сколько недоимки гасит мир в Завете за сутки
    else 0 end
$$;

create or replace function public._pc_arrears_total()
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(amount), 0) from public.pc_arrears;
$$;

create or replace function public._pc_arrears_stage()
returns text language sql stable security definer set search_path=public as $$
  select case
    when public._pc_arrears_total() >= public._pc_arrears_const('full')   then 'полный сбор'
    when public._pc_arrears_total() >= public._pc_arrears_const('levy')   then 'сбор'
    when public._pc_arrears_total() >= public._pc_arrears_const('signs')  then 'признаки'
    when public._pc_arrears_total() >= public._pc_arrears_const('rumors') then 'слухи'
    else 'нет' end
$$;

-- Что порог делает с долгой дорогой: «признаки» — миры-доноры теряют ихор,
-- и это первый общий убыток от чужой жадности (§18.1).
create or replace function public._pc_ichor_mult()
returns numeric language sql stable security definer set search_path=public as $$
  select case public._pc_arrears_stage()
    when 'полный сбор' then 0.35
    when 'сбор'        then 0.55
    when 'признаки'    then 0.75
    else 1.0 end
$$;

-- ── 3. ЗАПИСЬ В КНИГУ ───────────────────────────────────────
-- Единственная дверь: и вскрытие, и обряд, и вира, и зачёт идут через неё,
-- иначе «за что начислено» опять расползётся по файлам (грабли Легиона).
create or replace function public._pc_arrears_add(
  p_fid text, p_sys text, p_pid int, p_ichor numeric, p_tier int,
  p_kind text default null)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_w numeric; v_before text; v_after text; v_sec uuid; v_new boolean; v_kind text;
begin
  if p_fid is null or coalesce(p_ichor, 0) = 0 then return 0; end if;
  -- §18: недоимка += объём × (1 + 0.4 × тир мира). Знак идёт от объёма:
  -- вира возвращает ихор, значит и вес возвращает со своим знаком.
  v_w := round(p_ichor * (1 + 0.4 * greatest(0, coalesce(p_tier, 0))), 3);
  v_kind := coalesce(p_kind, case when v_w > 0 then 'вскрытие' else 'вира' end);
  v_before := public._pc_arrears_stage();

  v_new := v_w > 0 and p_sys is not null and not exists (
    select 1 from public.pc_arrears_log l
     where l.faction_id = p_fid and l.system_id = p_sys and l.pid = p_pid and l.weight > 0);

  insert into public.pc_arrears(faction_id, amount, taken, repaid, worlds)
    values (p_fid, greatest(0, v_w), greatest(0, v_w), greatest(0, -v_w),
            case when v_new then 1 else 0 end)
  on conflict (faction_id) do update
    set amount = greatest(0, public.pc_arrears.amount + v_w),
        taken  = public.pc_arrears.taken  + greatest(0, v_w),
        repaid = public.pc_arrears.repaid + greatest(0, -v_w),
        worlds = public.pc_arrears.worlds + case when v_new then 1 else 0 end,
        updated_at = now();

  insert into public.pc_arrears_log(faction_id, system_id, pid, kind, ichor, weight, tier)
    values (p_fid, p_sys, p_pid, v_kind, round(p_ichor, 3), v_w, p_tier);

  -- копилка Сбора: там, откуда брали
  if p_sys is not null then
    v_sec := public._legion_sector_of(p_sys);
    if v_sec is not null then
      insert into public.pc_levy_pressure(sector_id, taken, pressure)
        values (v_sec, greatest(0, v_w), greatest(0, v_w))
      on conflict (sector_id) do update
        set taken    = greatest(0, public.pc_levy_pressure.taken + v_w),
            pressure = greatest(0, public.pc_levy_pressure.pressure + v_w),
            updated_at = now();
    end if;
  end if;

  -- ── порог перейдён: об этом узнают все и сразу ──
  v_after := public._pc_arrears_stage();
  if v_after <> v_before then
    perform public._pc_arrears_announce(v_before, v_after);
  end if;
  return v_w;
end$$;
revoke all on function public._pc_arrears_add(text,text,int,numeric,int,text) from public, anon, authenticated;

-- ── 4. ГОЛОС ПОРОГА ─────────────────────────────────────────
-- Про людей и вину — ни слова: говорят руины и счёт.
create or replace function public._pc_arrears_announce(p_from text, p_to text)
returns void language plpgsql security definer set search_path=public as $$
declare v_title text; v_body text; v_top text;
begin
  select coalesce(f.name, a.faction_id) into v_top
    from public.pc_arrears a left join public.map_factions f on f.id = a.faction_id
   order by a.amount desc limit 1;

  if p_to = 'слухи' then
    v_title := 'Вскрытые святилища отвечают';
    v_body  := 'Дозвёздные миры у даллерианских руин замолчали: они больше не просят и не отвечают на знамения. '
            || 'Со вскрытых святилищ пошёл счёт — недоимка. Она видна теперь всей галактике, с поимённой разбивкой, '
            || 'и первым в списке стоит ' || coalesce(v_top, 'никто') || '.';
  elsif p_to = 'признаки' then
    v_title := 'Ихор идёт хуже по всей галактике';
    v_body  := 'Миры под Заветом отдают ихор скупее, чем отдавали, и не только те, у кого брали. '
            || 'Убыток общий: святилища считают недоимку одной книгой на всех.';
  elsif p_to = 'сбор' then
    v_title := '☠ СБОР';
    v_body  := 'Из пустоты у вскрытых руин вышли корабли, каких в реестрах нет. Они не грабят: они приходят туда, '
            || 'откуда брали, и забирают ихор — ровно взятое и сверх того пеню. Крупнейший должник галактики — '
            || coalesce(v_top, 'неизвестен') || '. Войной это не закрывается: закрывается только счётом.';
  elsif p_to = 'полный сбор' then
    v_title := '☠☠ ПОЛНЫЙ СБОР';
    v_body  := 'Взыскание пошло быстрее, и сектора выпадают из хозяйства галактики один за другим. '
            || 'Пока недоимка не погашена, доли Сбора восполняются из уже взятого.';
  else
    return;
  end if;

  begin perform public._pc_news(v_title, null, v_body, 'rgba(196,74,42,0.55)', null);
  exception when others then null; end;
  begin perform public._legion_feed(v_title, v_body);
  exception when others then null; end;
end$$;
revoke all on function public._pc_arrears_announce(text,text) from public, anon, authenticated;

-- ── 5. ОБРЯД ТОЖЕ СЧИТАЕТСЯ ─────────────────────────────────
-- Ихор с обряда (_precursor_rite.sql) — тот же ихор не от Завета. Ловим его
-- триггером по журналу, а не правкой самого обряда: одна дверь, ноль каток.
create or replace function public._pc_arrears_on_act()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_i numeric; v_tier int;
begin
  if new.action <> 'rite' then return new; end if;
  v_i := coalesce((new.payload->>'ichor')::numeric, 0);
  if v_i <= 0 then return new; end if;
  select tier into v_tier from public.primitive_civs
    where system_id = new.system_id and pid = new.pid;
  perform public._pc_arrears_add(new.faction_id, new.system_id, new.pid, v_i,
                                 coalesce(v_tier, 0), 'обряд');
  return new;
end$$;
drop trigger if exists trg_pc_arrears_act on public.primitive_acts;
create trigger trg_pc_arrears_act after insert on public.primitive_acts
  for each row execute function public._pc_arrears_on_act();

-- ── 6. ПУБЛИЧНЫЙ РЕЕСТР (§18) ───────────────────────────────
-- До первого порога недоимка скрыта: видно только, что «счёт есть».
-- После — поимённо. Это важнее самого кризиса: галактика видит, кто набрал.
create or replace function public.precursor_arrears()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_stage text; v_total numeric; v_rows jsonb; v_mine text; v_log jsonb;
begin
  v_stage := public._pc_arrears_stage();
  v_total := public._pc_arrears_total();
  v_mine  := public._ec_my_fid();

  if v_stage = 'нет' then
    -- своё видно всегда: свои книги держава ведёт сама
    return jsonb_build_object(
      'stage', v_stage, 'total', null, 'mult', public._pc_ichor_mult(),
      'next', public._pc_arrears_const('rumors'),
      'mine', (select jsonb_build_object('amount', a.amount, 'taken', a.taken,
                                         'repaid', a.repaid, 'worlds', a.worlds)
                 from public.pc_arrears a where a.faction_id = v_mine),
      'rows', '[]'::jsonb, 'log', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fid', a.faction_id,
           'name', coalesce(f.name, a.faction_id),
           'color', f.color,
           'amount', round(a.amount, 1),
           'taken', round(a.taken, 1),
           'repaid', round(a.repaid, 1),
           'worlds', a.worlds,
           'share', case when v_total > 0 then round(a.amount / v_total, 4) else 0 end,
           'mine', (a.faction_id = v_mine)) order by a.amount desc), '[]'::jsonb)
    into v_rows
    from public.pc_arrears a
    left join public.map_factions f on f.id = a.faction_id
   where a.amount > 0 or a.taken > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'at', l.at, 'name', coalesce(f.name, l.faction_id), 'kind', l.kind,
           'sys', coalesce(ms.name, l.system_id), 'weight', round(l.weight, 1))
         order by l.at desc), '[]'::jsonb)
    into v_log
    from (select * from public.pc_arrears_log order by at desc limit 25) l
    left join public.map_factions f on f.id = l.faction_id
    left join public.map_systems ms on ms.id = l.system_id;

  return jsonb_build_object(
    'stage', v_stage, 'total', round(v_total, 1), 'mult', public._pc_ichor_mult(),
    'next', case v_stage
              when 'слухи'    then public._pc_arrears_const('signs')
              when 'признаки' then public._pc_arrears_const('levy')
              when 'сбор'     then public._pc_arrears_const('full')
              else null end,
    'mine', (select jsonb_build_object('amount', a.amount, 'taken', a.taken,
                                       'repaid', a.repaid, 'worlds', a.worlds)
               from public.pc_arrears a where a.faction_id = v_mine),
    'rows', v_rows, 'log', v_log);
end$$;
grant execute on function public.precursor_arrears() to authenticated;

-- ── 7. ДОЛГАЯ ДОРОГА: ставка под порогом и зачёт за Согласие ─
-- Переопределяем суточный проход целиком (переопределить одну ветку нельзя).
-- Против прежнего два отличия, оба из §18:
--   • ставка Завета умножается на _pc_ichor_mult() — общий убыток от чужой жадности;
--   • каждый мир в Завете медленно гасит недоимку своего патрона — «в зачёт».
create or replace function public._pc_bonds_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_days numeric; v_rate numeric; v_amt numeric; n_ichor int := 0; n_miss int := 0;
        v_loy int; v_mult numeric; v_cred numeric; n_cred int := 0;
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

  v_mult := public._pc_ichor_mult();

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
    v_rate := (0.6 + 0.2 * greatest(0, r.tier)) * (case when v_loy >= 95 then 1.25 else 1.0 end) * v_mult;
    v_amt  := round(v_rate * v_days, 3);
    perform public._pc_res_add(r.covenant_fid, 'Ихор', v_amt);
    update public.primitive_civs
       set ichor_at = now(), ichor_total = ichor_total + v_amt
     where system_id = r.system_id and pid = r.pid;
    n_ichor := n_ichor + 1;

    -- §18: мир, доведённый до Завета, медленно гасит недоимку своего патрона.
    -- Медленно — это и есть смысл: набрать короткой дорогой можно за день,
    -- отработать долгой — за месяцы.
    if exists (select 1 from public.pc_arrears a
                where a.faction_id = r.covenant_fid and a.amount > 0) then
      v_cred := round(public._pc_arrears_const('credit') * v_days, 3);
      if v_cred > 0 then
        update public.pc_arrears
           set amount = greatest(0, amount - v_cred), repaid = repaid + v_cred, updated_at = now()
         where faction_id = r.covenant_fid;
        insert into public.pc_arrears_log(faction_id, system_id, pid, kind, ichor, weight, tier)
          values (r.covenant_fid, r.system_id, r.pid, 'зачёт', 0, -v_cred, r.tier);
        n_cred := n_cred + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ichor', n_ichor, 'missed', n_miss, 'credited', n_cred,
                            'mult', v_mult, 'arrears', public._pc_arrears_total());
end$$;
revoke all on function public._pc_bonds_tick() from public, anon, authenticated;

-- ── 8. ПРОВЕРКА ─────────────────────────────────────────────
select jsonb_pretty(jsonb_build_object(
  'ступень',  public._pc_arrears_stage(),
  'счёт',     public._pc_arrears_total(),
  'ставка',   public._pc_ichor_mult(),
  'книга',    (select coalesce(jsonb_agg(jsonb_build_object('fid', faction_id, 'счёт', amount)), '[]'::jsonb)
                 from public.pc_arrears),
  'секторов', (select count(*) from public.pc_levy_pressure)
)) as итог;
