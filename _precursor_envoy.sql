-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ПОСЛАННИК, ИХ ПАМЯТЬ И СОСЕДИ  (этап 12, пункты 4–6)
--
-- Хроника читалась как книга: вы решали, мир отвечал, никто третий в ней не
-- участвовал. Три вещи, которых не хватало, чтобы это стало игрой:
--
--   4. ПОСЛАННИК. Вниз ходит не «ваш человек», а названный человек из совета
--      державы. Он ходит туда пять глав и набирает своё. Может сломаться,
--      может прикипеть к ним сильнее, чем к вам, а может СОЛГАТЬ в отчёте —
--      и тогда вы увидите не то, что было. Исход при этом считается по
--      тому, что было: ложь меняет вашу картину, а не их жизнь.
--
--   5. ИХ ЛЕТОПИСЬ О ВАС. «Камень, который говорит» остаётся в мире навсегда.
--      Следующий игрок, пришедший сюда, читает, кем были вы. И наоборот:
--      ваши прошлые дела на других мирах задают то, с чем вас встретят на
--      новом, — репутация здесь не число в углу, а строка в чужой книге.
--
--   6. ДО ВАС. Двух держав в одной системе не бывает: селиться можно только
--      в своей или ничейной (_ec_sys_open), а дозвёздный мир виден тому, у
--      кого в системе колония. Значит «сосед в том же мире» — не тот, кто
--      сидит рядом, а тот, кто был ЗДЕСЬ ДО ВАС: система перешла по войне,
--      по аннексии или была брошена и заклеймена заново. Вы приходите к
--      начатой чужой хронике, и мир помнит предыдущего. Гонка от этого не
--      исчезает — она просто идёт во времени: кто первым закрыл счёт, тот и
--      получил Побратима, а опоздавший получает мир, уже ставший чем стал.
--
-- ⚠ ГОЛОС. Ни одного слова про психику посланника. В отчёте пишут, что он
-- сделал и чего не сделал: не сдал журнал в срок, остался у камня дольше
-- положенного, назвал их «мы».
--
-- Порядок: после _precursor_risen.sql. Накат идемпотентный.
-- ════════════════════════════════════════════════════════════

-- ── 1. ПОСЛАННИК ───────────────────────────────────────────
create table if not exists public.pc_envoy (
  world      text not null,
  faction_id text not null,
  char_slug  text,                          -- персонаж из совета, если есть
  name       text not null,
  post       text,                          -- какую должность занимал
  груз       numeric not null default 0,    -- сколько он на себе унёс (0..100)
  ходок      int  not null default 0,       -- сколько раз спускался
  лжёт       boolean not null default false,
  прикипел   boolean not null default false,
  сломан     boolean not null default false,
  ушёл_at    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (world, faction_id)
);
alter table public.pc_envoy enable row level security;
drop policy if exists pc_envoy_read on public.pc_envoy;
-- Своего посланника держава видит; чужого — нет. Это её человек.
create policy pc_envoy_read on public.pc_envoy for select
  using (faction_id = public._ec_my_fid());

-- Порог, за которым человек перестаёт быть только вашим. Не «шкала стресса»:
-- это счёт того, что он на себе унёс вниз и обратно.
create or replace function public._pc_envoy_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'ложь'     then 55       -- отчёт перестаёт сходиться с тем, что было
    when 'прикипел' then 70       -- он говорит «мы» про них
    when 'сломан'   then 92       -- он не вернулся тем, кто уходил
    else 0 end
$$;

-- Кого послать. Дипломат, если он в совете есть; иначе разведка, иначе
-- глава. Совсем некого — идёт безымянный, и хроника это заметит.
create or replace function public._pc_envoy_pick(p_fid text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; p jsonb;
begin
  v := public._fm_council(p_fid);
  foreach p in array array(select jsonb_array_elements(coalesce(v->'posts', '[]'::jsonb)))
  loop
    if p->>'role' in ('diplomat', 'spymaster', 'governor') then
      return jsonb_build_object('slug', p->>'char_slug', 'name', p->>'char_name',
                                'post', p->>'title');
    end if;
  end loop;
  p := (coalesce(v->'posts', '[]'::jsonb))->0;
  if p is not null then
    return jsonb_build_object('slug', p->>'char_slug', 'name', p->>'char_name',
                              'post', p->>'title');
  end if;
  return jsonb_build_object('slug', null, 'name', 'ваш человек', 'post', null);
end$$;

-- Что ход в хронике стоит посланнику. Считается на сервере по флагам, чтобы
-- клиент не мог назначить своему человеку удобное состояние.
create or replace function public._pc_envoy_weigh(p_flags jsonb)
returns numeric language sql immutable as $$
  select
    -- Стоять рядом и не мешать тяжелее, чем распорядиться.
    case p_flags->>'подход' when 'ряд' then 10 when 'вера' then 14
                            when 'сила' then 6 when 'качать' then 4 else 3 end
  + case p_flags->>'летопись' when 'подлог' then 22   -- он знал, что это ложь
                              when 'умолчание' then 14
                              when 'полу' then 8 else 4 end
  + case p_flags->>'ваше' when 'вира' then 16          -- он простоял у камня
                          when 'сами' then 12
                          when 'выработка' then 10
                          when 'уход' then 6 else 8 end
  + case p_flags->>'голос' when 'Смутьяны' then 10 else 2 end;
$$;

-- ── 2. ИХ ЛЕТОПИСЬ О ВАС ───────────────────────────────────
-- Строка, которую мир вписал про пришедшего сверху. Пишется один раз, живёт
-- вечно и читается ВСЕМИ: следующий игрок узнает, кем были вы, но не узнает
-- от вас.
create table if not exists public.pc_record (
  world      text not null,
  faction_id text not null,
  seen_as    text,                          -- «камень, который говорит»
  ending     text,
  fate       text,
  строка     text,                          -- что именно у них записано
  at         timestamptz not null default now(),
  primary key (world, faction_id)
);
create index if not exists pc_record_fid_idx on public.pc_record(faction_id);
alter table public.pc_record enable row level security;
drop policy if exists pc_record_read on public.pc_record;
-- Читать может кто угодно: это их книга, а не ваша.
create policy pc_record_read on public.pc_record for select using (true);

-- Чем каждый исход ложится в чужую память. Числом — потому что следующий
-- мир встречает вас не рассказом, а тем, как быстро с вами садятся.
create or replace function public._pc_record_weight(p_ending text)
returns int language sql immutable as $$
  select case p_ending
    when 'побратим'       then  30
    when 'своё_имя'       then  22
    when 'долгий_счёт'    then  12
    when 'отпущенные'     then   6
    when 'спящая_вещь'    then   0
    when 'немой_век'      then  -8
    when 'смута'          then -14
    when 'осыпь'          then -18
    when 'ложный_устой'   then -20
    when 'возвратный_ход' then -26
    when 'выскобленные'   then -34
    else 0 end;
$$;

-- С чем вас встретят в НОВОМ мире. Не «репутация»: это то, что о таких, как
-- вы, уже написано в других книгах, и что дозвёздные пересказывают друг
-- другу с ошибками. Оттого и потолок ниже, чем сумма ваших дел.
create or replace function public.pc_start_attitude(p_fid text)
returns int
language sql stable security definer set search_path to 'public' as $$
  select greatest(-40, least(40, coalesce(round(
    sum(public._pc_record_weight(ending)) * 0.6)::int, 0)))
    from public.pc_record where faction_id = p_fid;
$$;

-- ── 3. ЗАПИСЬ ИТОГА: зовётся вместе с рождением мира ───────
create or replace function public._pc_record_write(p_fid text, p_world text,
  p_ending text, p_seen text)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_fate text; v_line text;
begin
  select fate into v_fate from public.pc_risen where world = p_world;
  -- Строка их книги. Пишется ИХ словами и про дело, а не про намерение.
  v_line := case p_ending
    when 'побратим'    then 'Сели в ряд и не встали, пока счёт не сошёлся. Слово держат.'
    when 'своё_имя'    then 'Стояли рядом и не мешали. Счёт закрыли мы сами.'
    when 'долгий_счёт' then 'Заплатили за тех, кто брал. Не они брали — платили они.'
    when 'отпущенные'  then 'Пришли к старшим, а говорить пришлось с нами.'
    when 'спящая_вещь' then 'Постояли и ушли. Больше про них сказать нечего.'
    when 'немой_век'   then 'Что-то решили за нас и не сказали что.'
    when 'смута'       then 'После них у нас не стало тех, кто вёл счёт.'
    when 'осыпь'       then 'После них не стало и нас.'
    when 'ложный_устой' then 'Договорились с ними, и договор был хорош. Слишком.'
    when 'возвратный_ход' then 'Они видели, как нас уводят, и записали это.'
    when 'выскобленные' then 'Взяли всё, что лежало, и ушли. Выработка стоит до сих пор.'
    else 'Приходили.' end;

  insert into public.pc_record (world, faction_id, seen_as, ending, fate, строка)
  values (p_world, p_fid, p_seen, p_ending, v_fate, v_line)
  on conflict (world, faction_id) do nothing;

  -- Посланник: он тоже кончился вместе с хроникой.
  update public.pc_envoy
     set ушёл_at = now(), updated_at = now()
   where world = p_world and faction_id = p_fid and ушёл_at is null;
end$$;
revoke all on function public._pc_record_write(text, text, text, text) from public, anon;

-- ── 4. ШАГ ХРОНИКИ: посланник, память, соседи ──────────────
create or replace function public.precursor_saga_step(
  p_world text, p_node text, p_flags jsonb default null, p_ending text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; r public.precursor_saga; v_seen jsonb; v_flags jsonb; v_wait numeric;
        v_pay jsonb; v_born jsonb; e public.pc_envoy; v_pick jsonb; v_add numeric;
        v_env jsonb;
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

  -- ── посланник ──
  select * into e from public.pc_envoy where world = p_world and faction_id = fid;
  if not found then
    v_pick := public._pc_envoy_pick(fid);
    insert into public.pc_envoy (world, faction_id, char_slug, name, post)
    values (p_world, fid, v_pick->>'slug', coalesce(v_pick->>'name', 'ваш человек'),
            v_pick->>'post')
    on conflict (world, faction_id) do nothing;
    select * into e from public.pc_envoy where world = p_world and faction_id = fid;
  end if;

  -- Считаем только на РАЗВИЛКАХ (клиент прислал флаги): проход по репликам
  -- человека не изнашивает.
  if p_flags is not null and p_flags <> '{}'::jsonb and e.ушёл_at is null then
    v_add := public._pc_envoy_weigh(p_flags);
    update public.pc_envoy
       set груз = least(100, груз + v_add), ходок = ходок + 1,
           лжёт     = (груз + v_add) >= public._pc_envoy_const('ложь'),
           прикипел = (груз + v_add) >= public._pc_envoy_const('прикипел'),
           сломан   = (груз + v_add) >= public._pc_envoy_const('сломан'),
           updated_at = now()
     where world = p_world and faction_id = fid
     returning * into e;
  end if;

  if p_ending is not null then
    v_pay  := public._pc_saga_pay(fid, p_world, p_ending);
    v_born := public._pc_risen_born(fid, p_world, p_ending);
    perform public._pc_record_write(fid, p_world, p_ending,
      coalesce(p_flags->>'seen', v_flags->>'seen'));
    -- Сломанный не возвращается в совет, и это сводка, а не строка в логе.
    if e.сломан then
      perform public._legion_news(fid, 'Посланник не вернулся',
        format('%s не поднялся с последним челноком. Журнал сдан не полностью: '
            || 'за три последние главы записей нет вовсе. На месте его видели '
            || 'у камня с девятью именами, и это последнее, что о нём известно.',
               coalesce(e.name, 'Ваш человек')));
    elsif e.прикипел then
      perform public._legion_news(fid, 'Посланник остался',
        format('%s подал прошение остаться при мире, с которым работал. '
            || 'В прошении он трижды называет их «мы».', coalesce(e.name, 'Ваш человек')));
    end if;
  end if;

  v_env := jsonb_build_object('имя', e.name, 'пост', e.post, 'ходок', e.ходок,
                              'лжёт', e.лжёт, 'прикипел', e.прикипел, 'сломан', e.сломан);

  return jsonb_build_object('ok', true, 'world', p_world, 'node', p_node,
                            'flags', v_flags, 'done', p_ending is not null,
                            'ending', p_ending, 'pay', v_pay, 'мир', v_born,
                            'посланник', v_env);
end$$;
grant execute on function public.precursor_saga_step(text, text, jsonb, text) to authenticated;

-- ── 5. ЧТЕНИЕ: след + посланник + чужая память + соседи ────
drop function if exists public.precursor_saga_get();
create or replace function public.precursor_saga_get()
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare fid text; v_rows jsonb; v_me jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'err', 'нет державы'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'world', r.world, 'node', r.node, 'flags', r.flags, 'seen', r.seen,
           'done', r.done, 'ending', r.ending,
           'started_at', r.started_at, 'updated_at', r.updated_at,
           'ready_at', case when w.hours is not null
             then r.updated_at + (w.hours || ' hours')::interval end,
           -- ваш человек внизу
           'посланник', case when e.world is not null then jsonb_build_object(
             'имя', e.name, 'пост', e.post, 'ходок', e.ходок, 'лжёт', e.лжёт,
             'прикипел', e.прикипел, 'сломан', e.сломан) end,
           -- кто держал этот мир до вас и чем у него кончилось
           'до_вас', jsonb_build_object(
             'держав', coalesce(n.всего, 0),
             'дошли',  coalesce(n.дошли, 0),
             'встал',  (select имя from public.pc_fate f
                          join public.pc_risen pr on pr.fate = f.id
                         where pr.world = r.world)),
           -- что этот мир уже записал про пришедших сверху ДО вас
           'память', coalesce(m.строки, '[]'::jsonb))
         ), '[]'::jsonb)
    into v_rows
    from public.precursor_saga r
    left join lateral (select public._pc_saga_wait(r.world, r.node) as hours) w on true
    left join public.pc_envoy e on e.world = r.world and e.faction_id = fid
    left join lateral (
      select count(*) as всего, count(*) filter (where s.done) as дошли
        from public.precursor_saga s
       where s.world = r.world and s.faction_id <> fid) n on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('кто', p.seen_as, 'что', p.строка)
                       order by p.at) as строки
        from public.pc_record p
       where p.world = r.world and p.faction_id <> fid) m on true
   where r.faction_id = fid;

  select jsonb_build_object(
           'fid', fid, 'name', a.name, 'race', a.race,
           'ideology', a.ideology, 'gov', a.gov,
           -- с чем вас встретят там, где вы ещё не были
           'встреча', public.pc_start_attitude(fid),
           'envoy', (public._pc_envoy_pick(fid))->>'name')
    into v_me
    from public.faction_applications a
   where a.faction_id = fid and a.status = 'approved'
   limit 1;

  return jsonb_build_object('ok', true, 'rows', v_rows,
                            'me', coalesce(v_me, jsonb_build_object(
                              'fid', fid, 'встреча', public.pc_start_attitude(fid))),
                            'now', now());
end$$;
grant execute on function public.precursor_saga_get() to authenticated;

-- ── 6. НОВЫЙ МИР ВСТРЕЧАЕТ ВАС ПО СТАРЫМ ДЕЛАМ ─────────────
-- Отношение к вставшему миру заводится не с нуля: то, что о вас написано в
-- других книгах, доезжает и сюда.
create or replace function public._pc_risen_born(p_fid text, p_world text, p_ending text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare f public.pc_fate; r public.pc_risen; c public.primitive_civs%rowtype;
        v_sys text; v_pid int; v_new boolean := false; v_start int;
begin
  select * into f from public.pc_fate where id = p_ending;
  if not found then return jsonb_build_object('ok', true, 'игра', 'нет'); end if;
  if p_world not like 'civ:%' then
    return jsonb_build_object('ok', true, 'игра', f.игра, 'рукопись', true);
  end if;
  v_sys := split_part(p_world, ':', 2);
  v_pid := nullif(split_part(p_world, ':', 3), '')::int;
  select * into c from public.primitive_civs where system_id = v_sys and pid = v_pid;
  v_start := public.pc_start_attitude(p_fid);

  select * into r from public.pc_risen where world = p_world;
  if not found then
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

  insert into public.pc_risen_att (world, faction_id, attitude, уговор)
  values (p_world, p_fid,
          v_start + case when not v_new then 0
               when r.fate = 'побратим'    then 70
               when r.fate = 'своё_имя'    then 45
               when r.fate = 'долгий_счёт' then 25
               when r.fate = 'отпущенные'  then 15
               else 0 end,
          case when v_new and r.fate = 'побратим' then 'побратим'
               when v_new and r.fate in ('своё_имя', 'долгий_счёт') then 'торг'
               else null end)
  on conflict (world, faction_id) do nothing;

  if v_new and r.fate = 'долгий_счёт' then
    insert into public.pc_risen_att (world, faction_id, attitude, долг)
    select p_world, a.faction_id, -10, round(a.taken * 0.10, 1)
      from public.pc_arrears a where a.taken > 0
    on conflict (world, faction_id) do update
      set долг = excluded.долг,
          attitude = least(pc_risen_att.attitude, excluded.attitude);
    update public.pc_risen_att set долг = round(долг * 0.35, 1), attitude = 25 + v_start
     where world = p_world and faction_id = p_fid;
  end if;

  return jsonb_build_object('ok', true, 'игра', r.игра, 'fate', r.fate,
    'имя', (select имя from public.pc_fate where id = r.fate),
    'первый', v_new, 'опоздали', not v_new and r.fate <> p_ending,
    'встреча', v_start);
end$$;
revoke all on function public._pc_risen_born(text, text, text) from public, anon, authenticated;
