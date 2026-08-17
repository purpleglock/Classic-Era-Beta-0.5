-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · МИР ВСТАЛ СУБЪЕКТОМ  (этап 12, пункты 2 и 3)
--
-- Хроника кончалась исходом — и исход оставался строкой на двери. Держава,
-- которая пять глав выхаживала чужую беду, получала за это абзац текста.
-- Здесь исход впадает в игру: мир выходит на карту и дальше живёт сам.
--
-- Две дороги, обе от того, чем кончился счёт (SagaWeave.FATES → колонка `игра`):
--
--   npc     — держава: продаёт ихор, держит уговор, помнит поимённо, кто чем
--             с ней рассчитался. Отношение считается ПО КАЖДОЙ ДЕРЖАВЕ
--             отдельно: с одним побратимство, с другим торг по прейскуранту,
--             третьему сперва по старому счёту.
--   кризис  — мир выносит своё наружу. Не грабит: УВОДИТ население чужих
--             миров ровно так, как уводили его, и с каждого уведённого растёт.
--
-- ⚠ КТО ПЕРВЫЙ. Хроника у каждой державы своя, а мир один. Исход миру ставит
-- ТА, ЧТО ЗАКРЫЛА СЧЁТ ПЕРВОЙ, — остальные приходят к уже вставшему миру и
-- получают его отношение, а не свой финал. Оттого побратимство и нельзя
-- «взять»: его можно только успеть.
--
-- ⚠ ГОЛОС. Ни слова из клиники ни в одном тексте, уходящем игроку. Сводка
-- говорит, ЧТО СЛУЧИЛОСЬ: сколько не вернулось, чей корабль стоял в системе,
-- какую цену назвали. Складывает читатель.
--
-- Порядок: после _precursor_saga_civs.sql. Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

-- ── 1. ИСХОДЫ: зеркало клиентского FATES ───────────────────
-- Клиент решает, какой исход выпал (он один знает флаги всех пяти глав);
-- сервер обязан знать, ЧТО ЭТОТ ИСХОД ЗНАЧИТ, иначе игрок присылал бы
-- «побратим» с любого узла и получал бы державу за одну кнопку.
create table if not exists public.pc_fate (
  id     text primary key,
  имя    text not null,
  игра   text not null default 'нет',      -- npc | кризис | нет | открыт
  сила   int  not null default 40,          -- чем мир вышел в галактику
  ord    int  not null default 0
);
alter table public.pc_fate enable row level security;
drop policy if exists pc_fate_read on public.pc_fate;
create policy pc_fate_read on public.pc_fate for select using (true);

insert into public.pc_fate (id, имя, игра, сила, ord) values
  ('побратим',      'Побратим',      'npc',    70, 1),
  ('отпущенные',    'Отпущенные',    'npc',    55, 2),
  ('долгий_счёт',   'Долгий счёт',   'npc',    60, 3),
  ('своё_имя',      'Своё имя',      'npc',    65, 4),
  ('ложный_устой',  'Ложный устой',  'кризис', 75, 5),
  ('возвратный_ход','Возвратный ход','кризис', 85, 6),
  ('немой_век',     'Немой век',     'кризис', 35, 7),
  ('смута',         'Смута',         'кризис', 45, 8),
  ('осыпь',         'Осыпь',         'нет',    10, 9),
  ('выскобленные',  'Выскобленные',  'нет',     5, 10),
  ('спящая_вещь',   'Спящая вещь',   'открыт', 20, 11)
on conflict (id) do update
  set имя = excluded.имя, игра = excluded.игра, сила = excluded.сила, ord = excluded.ord;

-- ── 2. ВСТАВШИЙ МИР ────────────────────────────────────────
create table if not exists public.pc_risen (
  world      text primary key,              -- civ:<system_id>:<pid>
  system_id  text,
  pid        int,
  fate       text not null references public.pc_fate(id),
  игра       text not null default 'нет',
  сила       numeric not null default 40,
  by_fid     text,                          -- кто закрыл счёт первым
  name       text,                          -- как мир называет себя сам
  ichor      numeric not null default 0,    -- что лежит на продажу
  pop        bigint  not null default 0,
  -- Скрытность: «Ложный устой» до срока ведёт себя как держава и торгует.
  скрыт      boolean not null default false,
  вскрыт_at  timestamptz,
  born_at    timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pc_risen_game_idx on public.pc_risen(игра);
alter table public.pc_risen enable row level security;
drop policy if exists pc_risen_read on public.pc_risen;
-- Читать можно всем: вставший мир — субъект на карте, а не чья-то тайна.
-- Кроме одного: пока «Ложный устой» скрыт, наружу он отдаётся как npc
-- (это делает витрина pc_risen_list, а не политика).
create policy pc_risen_read on public.pc_risen for select using (true);

-- ── 3. ОТНОШЕНИЕ: по каждой державе отдельно ───────────────
-- «Побратим держит уговор ИМЕННО С ВАМИ» — значит, отношение не может быть
-- одним числом на мир. У каждой державы своя строка, свой уговор и свой
-- старый счёт.
create table if not exists public.pc_risen_att (
  world      text not null references public.pc_risen(world) on delete cascade,
  faction_id text not null,
  attitude   int  not null default 0,        -- −100..+100
  уговор     text,                           -- null | 'торг' | 'побратим'
  долг       numeric not null default 0,     -- что этот мир спрашивает с ЭТОЙ державы
  плачено    numeric not null default 0,
  куплено    numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (world, faction_id)
);
alter table public.pc_risen_att enable row level security;
drop policy if exists pc_risen_att_read on public.pc_risen_att;
create policy pc_risen_att_read on public.pc_risen_att for select
  using (faction_id = public._ec_my_fid());

-- ── 4. КРИЗИС: копилка и уведённые ─────────────────────────
-- Движок тот же, что у Легиона: копится давление, тратится на выход. Логика
-- ДРУГАЯ. Легион берёт, что плохо лежит, и уходит. Этот не грабит — уводит
-- население, и с каждого уведённого растёт: чем дольше не мешают, тем
-- быстрее следующий увод.
create table if not exists public.pc_crisis (
  world      text primary key references public.pc_risen(world) on delete cascade,
  pressure   numeric not null default 0,
  уведено    bigint  not null default 0,     -- сколько душ всего
  миров      int     not null default 0,     -- со скольких миров
  счёт       numeric not null default 0,     -- чем это можно закрыть (растёт с уведённым)
  закрыто    numeric not null default 0,
  last_at    timestamptz not null default now(),
  next_at    timestamptz not null default now() + interval '6 hours',
  утих_at    timestamptz,                    -- счёт закрыт: мир остановился
  updated_at timestamptz not null default now()
);
alter table public.pc_crisis enable row level security;

-- ── 5. КАЛИБРОВКА В ОДНОМ МЕСТЕ ────────────────────────────
-- «На порядок жёстче пиратов, но с понятным способом остановить»:
--   Легион угоняет ≤400 душ и 4% колонии — налог на бардак.
--   Этот уводит до 4000 и до 25% — событие, после которого колонию видно.
-- Способ остановить назван прямо в сводке и стоит ровно столько, сколько
-- уведено: вира по числу душ. Военный способ тоже есть — но он в бою.
create or replace function public._pc_risen_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'take_cap'    then 4000      -- потолок одного увода
    when 'take_share'  then 0.25      -- доля населения цели за раз
    when 'grow'        then 0.14      -- насколько растёт сила с каждого увода
    when 'cool_hours'  then 6         -- реже этого не выходит
    when 'vira_per'    then 3.0       -- ихора за душу, чтобы закрыть счёт
    when 'ichor_price' then 1400      -- ГС за единицу ихора у вставшего мира
    when 'restock'     then 0.6       -- сколько ихора мир кладёт на продажу в час
    when 'false_days'  then 21        -- сколько «Ложный устой» держит лицо
    else 0 end
$$;

-- ── 6. РОЖДЕНИЕ: исход стал субъектом ──────────────────────
-- Зовётся из precursor_saga_step в тот миг, когда исход ставится впервые.
-- Первая закрывшая счёт держава задаёт миру судьбу; вторая и дальше просто
-- получают своё отношение к уже вставшему миру.
create or replace function public._pc_risen_born(p_fid text, p_world text, p_ending text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare f public.pc_fate; r public.pc_risen; c public.primitive_civs%rowtype;
        v_sys text; v_pid int; v_taken numeric; v_new boolean := false;
begin
  select * into f from public.pc_fate where id = p_ending;
  if not found then return jsonb_build_object('ok', true, 'игра', 'нет'); end if;

  -- Ключ мира — тело: civ:<system_id>:<pid>. Рукописные хроники (kailat)
  -- субъектами не встают: у них нет строки на карте, вставать нечему.
  if p_world not like 'civ:%' then
    return jsonb_build_object('ok', true, 'игра', f.игра, 'рукопись', true);
  end if;
  v_sys := split_part(p_world, ':', 2);
  v_pid := nullif(split_part(p_world, ':', 3), '')::int;
  select * into c from public.primitive_civs where system_id = v_sys and pid = v_pid;

  select * into r from public.pc_risen where world = p_world;
  if not found then
    -- Первый закрывший счёт. Он и решает, чем мир вышел в галактику.
    insert into public.pc_risen (world, system_id, pid, fate, игра, сила, by_fid,
                                 name, pop, скрыт)
    values (p_world, v_sys, v_pid, f.id, f.игра, f.сила, p_fid,
            coalesce(c.self_name, 'Безымянный мир'), coalesce(c.pop, 0),
            f.id = 'ложный_устой')
    on conflict (world) do nothing;
    select * into r from public.pc_risen where world = p_world;
    v_new := true;

    if f.игра = 'кризис' then
      insert into public.pc_crisis (world, next_at)
      values (p_world, now() + (case when f.id = 'ложный_устой'
                then public._pc_risen_const('false_days') * 24 else 6 end || ' hours')::interval)
      on conflict (world) do nothing;
    end if;
  end if;

  -- Отношение ЭТОЙ державы к миру.
  insert into public.pc_risen_att (world, faction_id, attitude, уговор)
  values (p_world, p_fid,
          case when not v_new then 0                       -- пришли к готовому миру
               when r.fate = 'побратим'    then 70
               when r.fate = 'своё_имя'    then 45
               when r.fate = 'долгий_счёт' then 25
               when r.fate = 'отпущенные'  then 15
               else 0 end,
          case when v_new and r.fate = 'побратим' then 'побратим'
               when v_new and r.fate in ('своё_имя', 'долгий_счёт') then 'торг'
               else null end)
  on conflict (world, faction_id) do nothing;

  -- «Долгий счёт сперва берёт по старому счёту»: мир выставляет цену тем, кто
  -- брал у дозвёздных — по их же книге недоимки. Не мстит, а считает.
  if v_new and r.fate = 'долгий_счёт' then
    insert into public.pc_risen_att (world, faction_id, attitude, долг)
    select p_world, a.faction_id, -10, round(a.taken * 0.10, 1)
      from public.pc_arrears a where a.taken > 0
    on conflict (world, faction_id) do update
      set долг = excluded.долг,
          attitude = least(pc_risen_att.attitude, excluded.attitude);
    -- Тот, кто выходил мир, платит по общему счёту тоже, но со скидкой:
    -- виру он уже отдал в хронике.
    update public.pc_risen_att set долг = round(долг * 0.35, 1), attitude = 25
     where world = p_world and faction_id = p_fid;
  end if;

  -- Второй и дальше приходят к УЖЕ ВСТАВШЕМУ миру: имя ему дал первый, и
  -- своего исхода они этим миру не поставят. Оттого имя берём по r.fate.
  return jsonb_build_object('ok', true, 'игра', r.игра, 'fate', r.fate,
    'имя', (select имя from public.pc_fate where id = r.fate),
    'первый', v_new, 'опоздали', not v_new and r.fate <> p_ending);
end$$;
revoke all on function public._pc_risen_born(text, text, text) from public, anon, authenticated;

-- ── 7. ШАГ ХРОНИКИ ЗОВЁТ РОЖДЕНИЕ ──────────────────────────
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb; v_born jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  if p_world is null or length(p_world) = 0 or length(p_world) > 96 then
    return jsonb_build_object('ok', false, 'err', 'хроника не названа');
  end if;
  if p_node is null or length(p_node) = 0 or length(p_node) > 64 then
    return jsonb_build_object('ok', false, 'err', 'узел не назван');
  end if;

  select * into r from public.precursor_saga where faction_id = fid and world = p_world;
  if not found then
    insert into public.precursor_saga (faction_id, world) values (fid, p_world)
      on conflict (faction_id, world) do nothing;
    select * into r from public.precursor_saga where faction_id = fid and world = p_world;
  end if;

  if r.done then return jsonb_build_object('ok', false, 'err', 'хроника дописана'); end if;

  v_wait := public._pc_saga_wait(p_world, r.node);
  if v_wait is not null and now() < r.updated_at + (v_wait || ' hours')::interval then
    return jsonb_build_object(
      'ok', false, 'err', 'срок не вышел', 'wait', true,
      'ready_at', r.updated_at + (v_wait || ' hours')::interval);
  end if;

  v_flags := coalesce(r.flags, '{}'::jsonb) || coalesce(p_flags, '{}'::jsonb);
  v_seen  := case when coalesce(r.seen, '[]'::jsonb) @> to_jsonb(array[r.node])
                  then r.seen else coalesce(r.seen, '[]'::jsonb) || to_jsonb(array[r.node]) end;

  update public.precursor_saga
     set node = p_node, flags = v_flags, seen = v_seen,
         done = (p_ending is not null), ending = p_ending, updated_at = now()
   where faction_id = fid and world = p_world;

  if p_ending is not null then
    v_pay  := public._pc_saga_pay(fid, p_world, p_ending);
    v_born := public._pc_risen_born(fid, p_world, p_ending);
  end if;

  return jsonb_build_object('ok', true, 'world', p_world, 'node', p_node,
                            'flags', v_flags, 'done', p_ending is not null,
                            'ending', p_ending, 'pay', v_pay, 'мир', v_born);
end$$;
grant execute on function public.precursor_saga_step(text, text, jsonb, text) to authenticated;

-- ── 8. ВИТРИНА: что держава видит о вставших мирах ─────────
-- Скрытый «Ложный устой» отдаётся как обычная держава — в этом весь он.
create or replace function public.pc_risen_list()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare fid text; v jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'world', r.world, 'system_id', r.system_id, 'pid', r.pid,
           'name', r.name, 'fate', r.fate, 'имя', f.имя,
           -- скрытый кризис показывается как торгующая держава
           'игра', case when r.скрыт then 'npc' else r.игра end,
           'сила', round(r.сила, 0),
           'ваш', r.by_fid = fid,
           'ихор', round(r.ichor, 1),
           'цена', public._pc_risen_price(r.world, fid),
           'attitude', coalesce(a.attitude, 0),
           'уговор', a.уговор,
           'долг', round(coalesce(a.долг, 0) - coalesce(a.плачено, 0), 1),
           'союз', public._pc_risen_pact_ok(r.fate),
           'уведено', case when r.скрыт then null else k.уведено end,
           'счёт', case when r.скрыт then null
                        else round(coalesce(k.счёт, 0) - coalesce(k.закрыто, 0), 1) end,
           'утих', k.утих_at is not null)
         order by f.ord), '[]'::jsonb)
    into v
    from public.pc_risen r
    join public.pc_fate f on f.id = r.fate
    left join public.pc_risen_att a on a.world = r.world and a.faction_id = fid
    left join public.pc_crisis k on k.world = r.world
   where r.игра in ('npc', 'кризис');

  return jsonb_build_object('ok', true, 'worlds', v, 'now', now());
end$$;
grant execute on function public.pc_risen_list() to authenticated;

-- Союз: с кем он вообще возможен. «Отпущенные продают всё, кроме союза».
create or replace function public._pc_risen_pact_ok(p_fate text)
returns boolean language sql immutable as $$
  select p_fate in ('побратим', 'своё_имя', 'долгий_счёт');
$$;

-- Цена ихора у вставшего мира. Не прейскурант, а отношение:
--   побратим  — уговор отдельно от общего прейскуранта и переживёт вас;
--   отпущенные— одна цена всем, и своим, и чужим;
--   долгий счёт — сперва по старому счёту, а пока он открыт, цена кусается.
create or replace function public._pc_risen_price(p_world text, p_fid text)
returns numeric
language sql stable security definer set search_path to 'public' as $$
  select round(public._pc_risen_const('ichor_price')
    * case r.fate when 'отпущенные' then 1.00 else
        greatest(0.55, 1.35 - coalesce(a.attitude, 0) * 0.006) end
    * case when a.уговор = 'побратим' then 0.70 else 1.00 end
    * case when r.fate = 'долгий_счёт'
              and coalesce(a.долг, 0) > coalesce(a.плачено, 0) then 1.60 else 1.00 end, 0)
  from public.pc_risen r
  left join public.pc_risen_att a on a.world = r.world and a.faction_id = p_fid
  where r.world = p_world;
$$;

-- ── 9. ТОРГ: купить ихор у вставшего мира ──────────────────
create or replace function public.pc_risen_buy(p_world text, p_qty numeric)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.pc_risen; a public.pc_risen_att; v_price numeric;
        v_cost numeric; v_gc numeric; v_qty numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  select * into r from public.pc_risen where world = p_world for update;
  if not found or (r.игра <> 'npc' and not r.скрыт) then
    return jsonb_build_object('ok', false, 'err', 'этот мир не торгует');
  end if;

  v_qty := floor(greatest(0, coalesce(p_qty, 0)));
  if v_qty <= 0 then return jsonb_build_object('ok', false, 'err', 'сколько?'); end if;
  if v_qty > r.ichor then
    return jsonb_build_object('ok', false, 'err', 'столько у них не лежит');
  end if;

  select * into a from public.pc_risen_att where world = p_world and faction_id = fid;

  -- «Своё имя» торгует с теми, с кем сговорилось. Незнакомому — от ворот.
  if r.fate = 'своё_имя' and coalesce(a.attitude, 0) < 10 and coalesce(a.уговор,'') = '' then
    return jsonb_build_object('ok', false, 'err',
      'С вами не сговаривались. Сперва уговор, потом товар.');
  end if;
  -- «Долгий счёт сперва берёт по старому счёту».
  if r.fate = 'долгий_счёт' and coalesce(a.долг, 0) > coalesce(a.плачено, 0) then
    return jsonb_build_object('ok', false, 'err',
      format('Сперва по старому счёту: %s ихора.',
             round(coalesce(a.долг,0) - coalesce(a.плачено,0), 1)),
      'долг', round(coalesce(a.долг,0) - coalesce(a.плачено,0), 1));
  end if;

  v_price := public._pc_risen_price(p_world, fid);
  v_cost  := round(v_price * v_qty, 0);
  select gc into v_gc from public.faction_economy where faction_id = fid for update;
  if coalesce(v_gc, 0) < v_cost then
    return jsonb_build_object('ok', false, 'err', 'не хватает ГС', 'цена', v_cost);
  end if;

  update public.faction_economy
     set gc = gc - v_cost,
         resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
           to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) + v_qty, 3)), true)
   where faction_id = fid;
  update public.pc_risen set ichor = ichor - v_qty, updated_at = now() where world = p_world;

  -- Торг сближает, но медленно и с потолком: купленное — не побратимство.
  insert into public.pc_risen_att (world, faction_id, attitude, куплено)
  values (p_world, fid, 2, v_qty)
  on conflict (world, faction_id) do update
    set attitude = least(60, pc_risen_att.attitude + 2),
        куплено  = pc_risen_att.куплено + v_qty,
        updated_at = now();

  return jsonb_build_object('ok', true, 'ихор', v_qty, 'гс', v_cost, 'цена', v_price);
end$$;
grant execute on function public.pc_risen_buy(text, numeric) to authenticated;

-- ── 10. РАСЧЁТ: закрыть счёт ───────────────────────────────
-- Одна дверь на два случая, потому что для мира это одно и то же действие:
--   npc «Долгий счёт» — заплатить по старому счёту, и тогда с вами торгуют;
--   кризис — вира по числу уведённых, и тогда мир останавливается.
-- Платят ИХОРОМ: деньгами такое не закрывают, и об этом сказано прямо.
create or replace function public.pc_risen_settle(p_world text, p_qty numeric)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.pc_risen; k public.pc_crisis; v_have numeric; v_qty numeric;
        v_left numeric; v_att public.pc_risen_att;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  select * into r from public.pc_risen where world = p_world for update;
  if not found then return jsonb_build_object('ok', false, 'err', 'нет такого мира'); end if;

  v_qty := round(greatest(0, coalesce(p_qty, 0)), 1);
  if v_qty <= 0 then return jsonb_build_object('ok', false, 'err', 'сколько?'); end if;
  select coalesce((resources->>'Ихор')::numeric, 0) into v_have
    from public.faction_economy where faction_id = fid for update;
  if coalesce(v_have, 0) < v_qty then
    return jsonb_build_object('ok', false, 'err', 'столько ихора нет');
  end if;

  update public.faction_economy
     set resources = jsonb_set(coalesce(resources, '{}'::jsonb), array['Ихор'],
           to_jsonb(round(coalesce((resources->>'Ихор')::numeric, 0) - v_qty, 3)), true)
   where faction_id = fid;

  select * into k from public.pc_crisis where world = p_world for update;
  if found and k.утих_at is null then
    -- Вира кризису. Счёт растёт с каждым уводом, поэтому платить лучше рано.
    update public.pc_crisis
       set закрыто = закрыто + v_qty, updated_at = now(),
           -- Заплаченное сбивает и разгон: мир, с которым рассчитались,
           -- перестаёт спешить.
           pressure = greatest(0, pressure - v_qty * 0.8),
           утих_at = case when закрыто + v_qty >= счёт then now() end
     where world = p_world
     returning * into k;
    insert into public.pc_risen_att (world, faction_id, attitude, плачено)
    values (p_world, fid, 8, v_qty)
    on conflict (world, faction_id) do update
      set attitude = least(80, pc_risen_att.attitude + 8),
          плачено = pc_risen_att.плачено + v_qty, updated_at = now();
    if k.утих_at is not null then
      update public.pc_risen set игра = 'нет', скрыт = false, updated_at = now()
       where world = p_world;
      perform public._legion_news(fid, 'Счёт закрыт',
        format('Мир «%s» остановился. Уведённых не вернуть, но брать больше не будут: '
            || 'счёт закрыт полностью, последними %s единицами ихора.', r.name, v_qty));
    end if;
    return jsonb_build_object('ok', true, 'закрыто', round(k.закрыто, 1),
      'счёт', round(k.счёт, 1), 'утих', k.утих_at is not null);
  end if;

  -- Старый счёт у «Долгого счёта».
  insert into public.pc_risen_att (world, faction_id, attitude, плачено)
  values (p_world, fid, 10, v_qty)
  on conflict (world, faction_id) do update
    set плачено = pc_risen_att.плачено + v_qty,
        attitude = least(80, pc_risen_att.attitude + 10), updated_at = now()
  returning * into v_att;
  v_left := greatest(0, coalesce(v_att.долг, 0) - coalesce(v_att.плачено, 0));
  return jsonb_build_object('ok', true, 'долг', round(v_left, 1),
                            'закрыт', v_left <= 0);
end$$;
grant execute on function public.pc_risen_settle(text, numeric) to authenticated;

-- ── 11. УГОВОР: попроситься в союз ─────────────────────────
create or replace function public.pc_risen_pact(p_world text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.pc_risen; a public.pc_risen_att;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;
  select * into r from public.pc_risen where world = p_world;
  if not found then return jsonb_build_object('ok', false, 'err', 'нет такого мира'); end if;
  select * into a from public.pc_risen_att where world = p_world and faction_id = fid;

  if not public._pc_risen_pact_ok(r.fate) then
    return jsonb_build_object('ok', false, 'err',
      'Вас выслушали до конца, не перебивая, и отказали в конце. Как и всем.');
  end if;
  if coalesce(a.уговор, '') = 'побратим' then
    return jsonb_build_object('ok', false, 'err', 'Уговор с вами уже есть.');
  end if;
  if coalesce(a.attitude, 0) < 40 then
    return jsonb_build_object('ok', false, 'err',
      'Пока рано. Уговор — это то, что повторили столько раз, что перестали проверять.');
  end if;
  if r.fate = 'долгий_счёт' and coalesce(a.долг, 0) > coalesce(a.плачено, 0) then
    return jsonb_build_object('ok', false, 'err', 'Сперва по старому счёту.');
  end if;

  update public.pc_risen_att set уговор = 'торг', updated_at = now()
   where world = p_world and faction_id = fid;
  return jsonb_build_object('ok', true, 'уговор', 'торг');
end$$;
grant execute on function public.pc_risen_pact(text) to authenticated;

-- ── 12. ТИК КРИЗИСА: увод ──────────────────────────────────
-- Чужой движок с чужой логикой. Легион ищет, где плохо лежит, и уносит
-- добро. Этот идёт за ЛЮДЬМИ и предпочитает тех, кто похож на него самого:
-- сперва дозвёздные миры по соседству, и только потом колонии держав.
create or replace function public.pc_crisis_tick()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare k record; r public.pc_risen; v_take bigint; v_pop bigint;
        v_cnt int := 0; v_col record; v_civ record; v_sector uuid; v_txt text;
begin
  for k in select c.*, w.name, w.system_id, w.сила, w.fate, w.скрыт
             from public.pc_crisis c join public.pc_risen w on w.world = c.world
            where c.утих_at is null and c.next_at <= now()
            order by c.next_at loop

    -- «Ложный устой» до срока торгует и держит слово. Срок вышел — вскрылся,
    -- и вскрылся разом: он всё это время рос.
    if k.скрыт then
      update public.pc_risen set скрыт = false, вскрыт_at = now(), updated_at = now()
       where world = k.world;
      perform public._pc_crisis_news(k.world, k.name, 'Уговор кончился',
        format('Мир «%s» не вышел на срок. В системе, где стоял его торговый пост, '
            || 'не осталось ни поста, ни людей поста. Ушли не они одни: с трёх '
            || 'ближних миров за сутки не вернулось около %s жителей.',
               k.name, greatest(200, floor(k.pressure * 3))::bigint));
    end if;

    -- Кого уводить. Сперва соседний дозвёздный мир: он ближе и беззащитнее,
    -- и уводят его точно так же, как когда-то уводили их.
    select c.system_id, c.pid, c.self_name, c.pop into v_civ
      from public.primitive_civs c
     where c.pop > 500 and c.status not in ('dead', 'spacefaring')
       and c.system_id <> k.system_id
     order by (case when public._legion_sector_of(c.system_id)
                     = public._legion_sector_of(k.system_id) then 0 else 1 end),
              c.pop desc
     limit 1;

    if v_civ.system_id is not null then
      v_take := least(public._pc_risen_const('take_cap')::bigint,
                      floor(v_civ.pop * public._pc_risen_const('take_share'))::bigint);
      v_take := least(v_take, v_civ.pop - 100);
      if v_take > 0 then
        update public.primitive_civs set pop = pop - v_take
         where system_id = v_civ.system_id and pid = v_civ.pid;
        perform public._pc_crisis_hit(k.world, v_take, 1);
        perform public._pc_crisis_news(k.world, k.name, 'Увод',
          format('С мира «%s» за одну ночь не вернулось около %s жителей. '
              || 'Следов драки нет: их собрали у %s и увели ровным строем. '
              || 'Корабли ушли в сторону системы %s.',
              coalesce(v_civ.self_name, 'безымянного'), v_take,
              'общего схода', k.system_id));
        v_cnt := v_cnt + 1;
      end if;
    end if;

    -- Колонии держав идут следом — и вот их уже видит игрок.
    select c.id, c.faction_id, c.system_id, c.planet_name, c.pop into v_col
      from public.colonies c
     where c.pop > 1000
     order by c.pop desc, random()
     limit 1;

    if v_col.id is not null and k.pressure >= 30 then
      v_take := least(public._pc_risen_const('take_cap')::bigint,
                      floor(v_col.pop * public._pc_risen_const('take_share'))::bigint);
      v_take := least(v_take, v_col.pop - 1);
      if v_take > 0 then
        update public.colonies set pop = greatest(1, pop - v_take) where id = v_col.id;
        perform public._pc_crisis_hit(k.world, v_take, 1);
        perform public._legion_news(v_col.faction_id, 'Увод населения',
          format('В систему %s вошли корабли мира «%s». Они не тронули ни склада, '
              || 'ни верфи: из колонии «%s» увели около %s жителей и ушли тем же '
              || 'ходом. Счёт, которым это можно закрыть, они назвали сами — '
              || '%s единиц ихора.',
              v_col.system_id, k.name, coalesce(v_col.planet_name, 'колония'), v_take,
              round(k.счёт - k.закрыто + v_take * public._pc_risen_const('vira_per'), 1)));
        v_cnt := v_cnt + 1;
      end if;
    end if;

    -- Разгон: чем дольше не мешают, тем чаще выходят.
    update public.pc_crisis
       set last_at = now(), updated_at = now(),
           next_at = now() + (greatest(2.0,
             public._pc_risen_const('cool_hours') / (1 + миров * 0.20)) || ' hours')::interval
     where world = k.world;
  end loop;

  return jsonb_build_object('ok', true, 'уводов', v_cnt);
end$$;
revoke all on function public.pc_crisis_tick() from public, anon;

-- Один увод: он же разгон. Сила мира растёт с каждого уведённого — это и
-- есть «с каждого уведённого растёт», и это же делает промедление дорогим.
create or replace function public._pc_crisis_hit(p_world text, p_take bigint, p_worlds int)
returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.pc_crisis
     set уведено = уведено + p_take,
         миров   = миров + p_worlds,
         счёт    = счёт + p_take * public._pc_risen_const('vira_per'),
         pressure = pressure + p_take * 0.01,
         updated_at = now()
   where world = p_world;
  update public.pc_risen
     set сила = least(100, сила * (1 + public._pc_risen_const('grow')
                 * least(1.0, p_take / 2000.0))),
         pop  = pop + p_take,
         -- Уведённые не пропадают: их ставят к делу, и часть дела — ихор.
         ichor = ichor + p_take * 0.002,
         updated_at = now()
   where world = p_world;
end$$;
revoke all on function public._pc_crisis_hit(text, bigint, int) from public, anon;

-- Сводка от вставшего мира: своим именем, а не от Легиона.
create or replace function public._pc_crisis_news(p_world text, p_name text,
  p_title text, p_body text)
returns void
language sql security definer set search_path to 'public' as $$
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id,
      owner_email, title, excerpt, body, status, published_at, created_at, updated_at)
  select f.faction_id, upper(coalesce(p_name, 'ВСТАВШИЙ МИР')), 'rgba(120,96,168,0.55)',
         null, null, p_title, null, p_body, 'published', now(), now(), now()
    from (select distinct faction_id from public.colonies) f;
$$;
revoke all on function public._pc_crisis_news(text, text, text, text) from public, anon;

-- ── 13. ЛАВКА ПОПОЛНЯЕТСЯ ──────────────────────────────────
-- Мир кладёт ихор на продажу сам, по своей силе. Без этого «продажа ихора»
-- была бы одной покупкой на всю историю.
create or replace function public.pc_risen_restock()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update public.pc_risen
     set ichor = least(400, ichor + сила * public._pc_risen_const('restock')
                   * greatest(0, extract(epoch from (now() - updated_at)) / 3600.0)),
         updated_at = now()
   where игра = 'npc' or скрыт;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'миров', n);
end$$;
revoke all on function public.pc_risen_restock() from public, anon;

-- ── 14. ЧАСЫ ───────────────────────────────────────────────
-- Кризис идёт своим ходом и без игрока: в этом весь смысл — «мир живёт сам».
-- Реже Легиона (у того четыре раза в час), потому что один выход этого мира
-- весит на порядок больше одного налёта пиратов.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pc-risen-tick')
      where exists (select 1 from cron.job where jobname = 'pc-risen-tick');
    perform cron.schedule('pc-risen-tick', '17 * * * *',
      'select public.pc_risen_restock(); select public.pc_crisis_tick();');
  end if;
end$$;
