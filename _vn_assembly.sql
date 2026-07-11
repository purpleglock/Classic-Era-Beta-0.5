-- ════════════════════════════════════════════════════════════════════
-- МЕЖЗВЁЗДНАЯ АССАМБЛЕЯ — социальная мини-игра новеллы «в духе Secret
-- Hitler»: скрытые роли, ежедневные раунды, законы бьют по ВСЕЙ галактике.
--
-- СОЗЫВ. Запись заявками (мин. 5 держав). В день старта первые 10 по
-- жребию получают кресла, остальные — ЛОББИСТЫ (совещательный голос +
-- очередь на замену выбывших). Роли тайные: Федералисты (либералы),
-- Галактоцентристы (~⅓) и АРХОНТ (скрытый претендент на трон).
--
-- РИТМ: один раунд = один день (UTC).
--   до 12:00 — Спикер (ротация кресел) назначает Канцлера
--   до 17:00 — все голосуют ja/nein (большинство «за» из отдавших голос)
--   до 24:00 — Спикер сбрасывает 1 из 3 законов, Канцлер вводит 1 из 2,
--              затем Спикер применяет спецвласть (если положена).
-- Просрочил ход — сервер делает случайный легальный ход и ставит «неявку»;
-- 2 неявки → кресло (вместе с ролью!) переходит первому лоббисту очереди.
-- 3 проваленных выборов подряд — «хаос»: верхний закон колоды вступает сам.
--
-- ПОБЕДА: 5 законов Федерации / 6 Директив / Архонт-Канцлер после
-- 3-й Директивы / Архонт казнён. Спецвласти Директив — как в оригинале
-- (проверка лояльности, внеочередные выборы, взгляд в колоду, казнь),
-- таблица зависит от числа кресел на старте.
--
-- ЗАКОНЫ ДЕЙСТВУЮТ НА ВСЕХ: каждый принятый закон = разовый умеренный
-- эффект по faction_economy ВСЕЙ галактики (тик economy_accrue НЕ трогаем
-- — без клобберов) + новость от «🏛 МЕЖЗВЁЗДНАЯ АССАМБЛЕЯ».
--
-- Применять в Supabase SQL Editor ПОСЛЕ _economy_setup.sql (нужны
-- faction_applications / faction_economy / faction_news). Всё лениво:
-- _asm_ensure() дорезолвливает просроченные фазы при первом обращении
-- (assembly_state / любое действие), крон не нужен.
-- ════════════════════════════════════════════════════════════════════

-- ── Созывы ──
create table if not exists public.assembly_convocations (
  id           bigint generated always as identity primary key,
  status       text not null default 'signup',   -- signup | active | done
  created_at   timestamptz not null default now(),
  start_date   date not null,                    -- день 1-го раунда (UTC)
  seats        int,                              -- кресел на старте (5..10)
  deck         text[] not null default '{}',     -- 'L' | 'G'
  deck_pos     int  not null default 0,
  discard      text[] not null default '{}',
  lib_laws     int  not null default 0,
  gal_laws     int  not null default 0,
  tracker      int  not null default 0,          -- провальные выборы подряд
  last_speaker_seat    int,                      -- лимиты на переизбрание
  last_chancellor_seat int,
  special_seat int,                              -- внеочередные выборы: кто спикер завтра
  winner       text,                             -- lib | gal
  win_reason   text,
  finished_at  timestamptz
);

-- ── Участники: кресло = игрок, seat null = лоббист (очередь на замену) ──
create table if not exists public.assembly_members (
  conv_id    bigint not null references public.assembly_convocations(id) on delete cascade,
  faction_id text   not null,
  seat       int,
  role       text,                               -- lib | gal | archon
  alive      boolean not null default true,      -- false = казнён
  replaced   boolean not null default false,     -- уступил кресло лоббисту
  missed     int not null default 0,             -- неявки подряд
  joined_at  timestamptz not null default now(),
  owner      uuid,
  primary key (conv_id, faction_id)
);

-- ── Раунды (день = раунд). Должности храним КРЕСЛАМИ — замена игрока
--    в кресле наследует и роль, и текущие обязанности. ──
create table if not exists public.assembly_rounds (
  conv_id      bigint not null references public.assembly_convocations(id) on delete cascade,
  round_no     int    not null,
  day          date   not null,
  speaker_seat int    not null,
  nominee_seat int,
  phase        text   not null default 'nominate',  -- nominate|vote|legislate|power|done
  vote_passed  boolean,
  hand         text[],                          -- 3 карты Спикера / 2 после сброса
  speaker_discarded boolean not null default false,
  enacted      text,                            -- 'L' | 'G' | 'chaos:L' ...
  law          jsonb,                           -- принятый закон {id,title,descr,side}
  power        text,                            -- investigate|special|peek|execute
  power_used   boolean not null default false,
  power_result jsonb,                           -- виден только Спикеру
  primary key (conv_id, round_no)
);

-- ── Голоса раунда (advisory = совещательный голос лоббиста) ──
create table if not exists public.assembly_votes (
  conv_id    bigint not null,
  round_no   int    not null,
  faction_id text   not null,
  vote       boolean not null,
  advisory   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (conv_id, round_no, faction_id)
);

-- ── Штрафы за самовольный выход из активного созыва:
--    запрет на участие до выплаты Ассамблее 500 000 ГС ──
create table if not exists public.assembly_penalties (
  faction_id text primary key,
  fine       bigint not null default 500000,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
alter table public.assembly_penalties enable row level security;
revoke all on public.assembly_penalties from anon, authenticated;

alter table public.assembly_convocations enable row level security;
alter table public.assembly_members      enable row level security;
alter table public.assembly_rounds       enable row level security;
alter table public.assembly_votes        enable row level security;
revoke all on public.assembly_convocations, public.assembly_members,
              public.assembly_rounds, public.assembly_votes from anon, authenticated;

-- ── Детерминированный «рандом» (как в поэме) ──
create or replace function public._asm_hash(p text) returns int language sql immutable as $$
  select ('x' || substr(md5(p), 1, 8))::bit(32)::int & 2147483647
$$;

-- ── Спецвласти Директив по числу кресел на старте (зеркало в render.js!) ──
--    5-6: 3=peek 4=execute 5=execute · 7-8: 2=investigate 3=special 4-5=execute
--    9-10: 1-2=investigate 3=special 4-5=execute
create or replace function public._asm_power(p_seats int, p_gal int) returns text language sql immutable as $$
  select case
    when p_seats <= 6 then case p_gal when 3 then 'peek' when 4 then 'execute' when 5 then 'execute' end
    when p_seats <= 8 then case p_gal when 2 then 'investigate' when 3 then 'special' when 4 then 'execute' when 5 then 'execute' end
    else case p_gal when 1 then 'investigate' when 2 then 'investigate' when 3 then 'special' when 4 then 'execute' when 5 then 'execute' end
  end
$$;

-- ── Каталог законов: конкретный закон подбирается детерминированно из
--    пула стороны. Эффекты УМЕРЕННЫЕ, разовые, по всей галактике. ──
create or replace function public._asm_law_pick(p_side text, p_seed text)
returns jsonb language sql stable as $$
  select l from (values
    -- Федерация ('L'): послабления всем
    ('L','fed_trade',   'Акт о свободной торговле',      'Пошлины снижены: казна каждой державы выросла на 1% (от 100 до 2 500 ГС).'),
    ('L','fed_science', 'Хартия открытой науки',          'Обмен архивами: каждая держава получила 25 очков науки.'),
    ('L','fed_goods',   'Программа гуманитарных конвоев', 'Каждая держава получила 20 товаров.'),
    ('L','fed_grant',   'Субсидия окраинным мирам',       'Каждая держава получила 400 ГС из фондов Ассамблеи.'),
    ('L','fed_dual',    'Пакт о мирном атоме',            'Каждая держава получила 200 ГС и 12 очков науки.'),
    ('L','fed_amnesty', 'Всеобщая амнистия капитала',     'Казна каждой державы выросла на 0.7% (от 80 до 1 800 ГС).'),
    -- Галактоцентризм ('G'): имперские поборы со всех
    ('G','gal_tax',     'Имперский военный налог',        'Сборщики прошли по всем мирам: −1% казны каждой державы (от 100 до 2 500 ГС).'),
    ('G','gal_censor',  'Директива о цензуре архивов',    'Опечатаны лаборатории: каждая держава потеряла 15 очков науки.'),
    ('G','gal_requis',  'Реквизиция конвоев',             'Каждая держава лишилась 15 товаров в пользу «имперских нужд».'),
    ('G','gal_levy',    'Чрезвычайная подать',            'Каждая держава уплатила 300 ГС в имперскую казну.'),
    ('G','gal_darktax', 'Десятина Архонта',               '−0.7% казны каждой державы (от 80 до 1 800 ГС) — на «неотложные нужды трона».'),
    ('G','gal_double',  'Эдикт о двойной дани',           'Каждая держава уплатила 200 ГС и потеряла 8 очков науки.')
  ) as t(side,id,title,descr),
  lateral (select jsonb_build_object('id',t.id,'title',t.title,'descr',t.descr,'side',t.side) as l) x
  where t.side = p_side
  order by md5(p_seed || ':' || t.id)
  limit 1
$$;

-- ── Применить эффект закона ко ВСЕЙ галактике (разово, как эффекты поэмы) ──
create or replace function public._asm_law_apply(p_law jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  -- pg_safeupdate (session-preload в Supabase) требует WHERE → ставим where true
  case p_law->>'id'
    when 'fed_trade'   then update public.faction_economy set gc = gc + least(2500, greatest(100, round(gc * 0.01))) where true;
    when 'fed_science' then update public.faction_economy set science = science + 25 where true;
    when 'fed_goods'   then update public.faction_economy set tnp = tnp + 20 where true;
    when 'fed_grant'   then update public.faction_economy set gc = gc + 400 where true;
    when 'fed_dual'    then update public.faction_economy set gc = gc + 200, science = science + 12 where true;
    when 'fed_amnesty' then update public.faction_economy set gc = gc + least(1800, greatest(80, round(gc * 0.007))) where true;
    when 'gal_tax'     then update public.faction_economy set gc = greatest(0, gc - least(2500, greatest(100, round(gc * 0.01)))) where true;
    when 'gal_censor'  then update public.faction_economy set science = greatest(0, science - 15) where true;
    when 'gal_requis'  then update public.faction_economy set tnp = greatest(0, tnp - 15) where true;
    when 'gal_levy'    then update public.faction_economy set gc = greatest(0, gc - 300) where true;
    when 'gal_darktax' then update public.faction_economy set gc = greatest(0, gc - least(1800, greatest(80, round(gc * 0.007)))) where true;
    when 'gal_double'  then update public.faction_economy set gc = greatest(0, gc - 200), science = greatest(0, science - 8) where true;
    else null;
  end case;
end$$;
revoke all on function public._asm_law_apply(jsonb) from public, anon, authenticated;

-- ── Новость от Ассамблеи (общая лента) ──
create or replace function public._asm_news(p_title text, p_body text)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values (null, '🏛 МЕЖЗВЁЗДНАЯ АССАМБЛЕЯ', 'rgba(150,130,200,0.6)', null, null,
      p_title, null, p_body, 'approved', now(), now(), now());
  delete from public.faction_news
    where owner_id is null and faction_name = '🏛 МЕЖЗВЁЗДНАЯ АССАМБЛЕЯ'
      and id not in (select id from public.faction_news
        where owner_id is null and faction_name = '🏛 МЕЖЗВЁЗДНАЯ АССАМБЛЕЯ'
        order by created_at desc limit 12);
end$$;
revoke all on function public._asm_news(text, text) from public, anon, authenticated;

-- ── Тянуть карты из колоды (с перетасовкой остатка+сброса, если <3) ──
create or replace function public._asm_draw(p_conv bigint, p_n int)
returns text[] language plpgsql security definer set search_path=public as $$
declare c public.assembly_convocations; v_rest text[]; v_new text[]; v_out text[];
begin
  select * into c from public.assembly_convocations where id = p_conv for update;
  if coalesce(array_length(c.deck,1),0) - c.deck_pos < 3 then
    v_rest := coalesce(c.deck[c.deck_pos+1:], '{}') || c.discard;
    select coalesce(array_agg(x order by md5(p_conv::text || ':' || clock_timestamp()::text || ':' || x || ':' || o)), '{}')
      into v_new from unnest(v_rest) with ordinality as t(x, o);
    update public.assembly_convocations set deck = v_new, deck_pos = 0, discard = '{}' where id = p_conv;
    c.deck := v_new; c.deck_pos := 0;
  end if;
  v_out := c.deck[c.deck_pos+1 : c.deck_pos+p_n];
  update public.assembly_convocations set deck_pos = deck_pos + p_n where id = p_conv;
  return v_out;
end$$;
revoke all on function public._asm_draw(bigint, int) from public, anon, authenticated;

-- ── Ввести закон в силу: счётчики, эффект на всех, новость, проверка победы,
--    спецвласть (только для Директив, принятых правительством). ──
create or replace function public._asm_enact(p_conv bigint, p_round int, p_card text, p_by_gov boolean)
returns void language plpgsql security definer set search_path=public as $$
declare c public.assembly_convocations; v_law jsonb; v_pow text; v_cnt int;
begin
  select * into c from public.assembly_convocations where id = p_conv for update;
  v_law := public._asm_law_pick(p_card, p_conv::text || ':' || p_round || ':' || c.lib_laws || ':' || c.gal_laws);
  perform public._asm_law_apply(v_law);
  if p_card = 'L' then
    update public.assembly_convocations set lib_laws = lib_laws + 1 where id = p_conv returning lib_laws into v_cnt;
  else
    update public.assembly_convocations set gal_laws = gal_laws + 1 where id = p_conv returning gal_laws into v_cnt;
  end if;
  update public.assembly_rounds set enacted = p_card, law = v_law where conv_id = p_conv and round_no = p_round;
  perform public._asm_news(
    (case when p_card='L' then '🏛 Ассамблея приняла закон Федерации: «' else '🏛 Ассамблея ввела Директиву: «' end) || (v_law->>'title') || '»',
    (v_law->>'descr') || case when p_by_gov then '' else E'\n\nЗакон вступил в силу САМ — три созыва подряд не смогли избрать правительство (хаос).' end);

  -- победа по счётчикам
  if p_card = 'L' and v_cnt >= 5 then
    update public.assembly_convocations set status='done', winner='lib', win_reason='laws', finished_at=now() where id = p_conv;
    perform public._asm_news('🏛 Созыв завершён: ФЕДЕРАЦИЯ отстояла галактику', 'Принят пятый закон Федерации. Заговор Галактоцентристов сорван, Ассамблея распущена до нового созыва.');
    return;
  end if;
  if p_card = 'G' and v_cnt >= 6 then
    update public.assembly_convocations set status='done', winner='gal', win_reason='laws', finished_at=now() where id = p_conv;
    perform public._asm_news('🏛 Созыв завершён: ГАЛАКТОЦЕНТРИСТЫ взяли власть', 'Шестая Директива подписана. Ассамблея объявила себя Имперским Сенатом.');
    return;
  end if;
  -- спецвласть — только правительственные Директивы
  if p_by_gov and p_card = 'G' then
    v_pow := public._asm_power(c.seats, v_cnt);
    if v_pow is not null then
      update public.assembly_rounds set phase='power', power=v_pow where conv_id = p_conv and round_no = p_round;
      return;
    end if;
  end if;
  update public.assembly_rounds set phase='done' where conv_id = p_conv and round_no = p_round;
end$$;
revoke all on function public._asm_enact(bigint, int, text, boolean) from public, anon, authenticated;

-- ── Неявка: +1 пропуск; на 2-м — кресло (и роль) переходит первому лоббисту ──
create or replace function public._asm_miss(p_conv bigint, p_seat int)
returns void language plpgsql security definer set search_path=public as $$
declare m public.assembly_members; sub public.assembly_members;
begin
  select * into m from public.assembly_members
    where conv_id = p_conv and seat = p_seat and alive and not replaced;
  if not found then return; end if;
  update public.assembly_members set missed = missed + 1
    where conv_id = p_conv and faction_id = m.faction_id;
  if m.missed + 1 >= 2 then
    select * into sub from public.assembly_members
      where conv_id = p_conv and seat is null and not replaced
      order by joined_at limit 1;
    if found then
      update public.assembly_members set seat = null, replaced = true
        where conv_id = p_conv and faction_id = m.faction_id;
      update public.assembly_members set seat = m.seat, role = m.role, missed = 0
        where conv_id = p_conv and faction_id = sub.faction_id;
    end if;
  end if;
end$$;
revoke all on function public._asm_miss(bigint, int) from public, anon, authenticated;

-- ── Следующий Спикер: внеочередной (special_seat) или следующее живое кресло ──
create or replace function public._asm_next_speaker(p_conv bigint, p_after int)
returns int language plpgsql security definer set search_path=public as $$
declare c public.assembly_convocations; v int;
begin
  select * into c from public.assembly_convocations where id = p_conv;
  if c.special_seat is not null then
    v := c.special_seat;
    update public.assembly_convocations set special_seat = null where id = p_conv;
    if exists (select 1 from public.assembly_members where conv_id=p_conv and seat=v and alive) then return v; end if;
  end if;
  select min(seat) into v from public.assembly_members
    where conv_id = p_conv and alive and seat > p_after;
  if v is null then
    select min(seat) into v from public.assembly_members where conv_id = p_conv and alive;
  end if;
  return v;
end$$;
revoke all on function public._asm_next_speaker(bigint, int) from public, anon, authenticated;

-- ── Кандидаты в Канцлеры: живое кресло ≠ Спикер, лимиты прошлого правительства ──
create or replace function public._asm_eligible(p_conv bigint, p_speaker int)
returns int[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(m.seat order by m.seat), '{}')
  from public.assembly_members m, public.assembly_convocations c
  where c.id = p_conv and m.conv_id = p_conv and m.alive and m.seat is not null
    and m.seat <> p_speaker
    and (c.last_chancellor_seat is null or m.seat <> c.last_chancellor_seat)
    and ( (select count(*) from public.assembly_members where conv_id=p_conv and alive and seat is not null) <= 5
          or c.last_speaker_seat is null or m.seat <> c.last_speaker_seat )
$$;
revoke all on function public._asm_eligible(bigint, int) from public, anon, authenticated;

-- ── Подвести итог голосования (кворум = отдавшие голос; ничья = провал) ──
create or replace function public._asm_resolve_vote(p_conv bigint, p_round int, p_punish boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  r public.assembly_rounds; c public.assembly_convocations;
  v_ja int; v_nein int; v_role text; v_card text; m record;
begin
  select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
  select * into c from public.assembly_convocations where id=p_conv;
  select count(*) filter (where v.vote), count(*) filter (where not v.vote)
    into v_ja, v_nein
  from public.assembly_votes v
  join public.assembly_members mm on mm.conv_id=v.conv_id and mm.faction_id=v.faction_id
  where v.conv_id=p_conv and v.round_no=p_round and not v.advisory and mm.alive and mm.seat is not null;
  -- неявки не голосовавших (только при принудительном резолве по дедлайну)
  if p_punish then
    for m in select mm.seat from public.assembly_members mm
      where mm.conv_id=p_conv and mm.alive and mm.seat is not null
        and not exists (select 1 from public.assembly_votes v
          where v.conv_id=p_conv and v.round_no=p_round and v.faction_id=mm.faction_id)
    loop perform public._asm_miss(p_conv, m.seat); end loop;
  end if;

  if v_ja > v_nein then
    update public.assembly_rounds set vote_passed=true where conv_id=p_conv and round_no=p_round;
    update public.assembly_convocations set tracker=0,
        last_speaker_seat=r.speaker_seat, last_chancellor_seat=r.nominee_seat where id=p_conv;
    -- Архонт-Канцлер после 3-й Директивы = победа заговора
    select role into v_role from public.assembly_members
      where conv_id=p_conv and seat=r.nominee_seat and alive and not replaced;
    if c.gal_laws >= 3 and v_role = 'archon' then
      update public.assembly_rounds set phase='done' where conv_id=p_conv and round_no=p_round;
      update public.assembly_convocations set status='done', winner='gal', win_reason='archon_elected', finished_at=now() where id=p_conv;
      perform public._asm_news('🏛 Созыв завершён: АРХОНТ на троне',
        'Ассамблея своими руками вручила канцлерскую печать скрытому Архонту. Галактоцентристы победили.');
      return;
    end if;
    update public.assembly_rounds
      set phase='legislate', hand = public._asm_draw(p_conv, 3)
      where conv_id=p_conv and round_no=p_round;
  else
    update public.assembly_rounds set vote_passed=false, phase='done' where conv_id=p_conv and round_no=p_round;
    update public.assembly_convocations set tracker = tracker + 1 where id=p_conv returning tracker into v_ja;
    if v_ja >= 3 then
      -- хаос: верхний закон вступает сам, лимиты сбрасываются
      update public.assembly_convocations set tracker=0, last_speaker_seat=null, last_chancellor_seat=null where id=p_conv;
      v_card := (public._asm_draw(p_conv, 1))[1];
      perform public._asm_enact(p_conv, p_round, v_card, false);
      update public.assembly_rounds set phase='done' where conv_id=p_conv and round_no=p_round;
    end if;
  end if;
end$$;
revoke all on function public._asm_resolve_vote(bigint, int, boolean) from public, anon, authenticated;

-- ── Принудительно дорезолвить раунд (дедлайны прошли): авто-ходы + неявки ──
create or replace function public._asm_force_round(p_conv bigint, p_round int)
returns void language plpgsql security definer set search_path=public as $$
declare r public.assembly_rounds; v_el int[]; v_pick int; v_idx int; v_card text;
begin
  select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
  if r.phase = 'nominate' then
    v_el := public._asm_eligible(p_conv, r.speaker_seat);
    if coalesce(array_length(v_el,1),0) = 0 then
      update public.assembly_rounds set phase='done', vote_passed=false where conv_id=p_conv and round_no=p_round;
      return;
    end if;
    v_pick := v_el[1 + public._asm_hash(p_conv::text||':'||p_round||':nom') % array_length(v_el,1)];
    perform public._asm_miss(p_conv, r.speaker_seat);
    update public.assembly_rounds set nominee_seat=v_pick, phase='vote' where conv_id=p_conv and round_no=p_round;
    r.phase := 'vote';
  end if;
  if r.phase = 'vote' then
    perform public._asm_resolve_vote(p_conv, p_round, true);
    select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
  end if;
  if r.phase = 'legislate' then
    if not r.speaker_discarded then
      v_idx := 1 + public._asm_hash(p_conv::text||':'||p_round||':sd') % 3;
      perform public._asm_miss(p_conv, r.speaker_seat);
      update public.assembly_convocations set discard = discard || r.hand[v_idx] where id=p_conv;
      update public.assembly_rounds
        set hand = r.hand[1:v_idx-1] || r.hand[v_idx+1:], speaker_discarded = true
        where conv_id=p_conv and round_no=p_round;
      select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
    end if;
    v_idx := 1 + public._asm_hash(p_conv::text||':'||p_round||':ce') % 2;
    v_card := r.hand[v_idx];
    perform public._asm_miss(p_conv, r.nominee_seat);
    update public.assembly_convocations set discard = discard || r.hand[3-v_idx] where id=p_conv;
    update public.assembly_rounds set hand=null where conv_id=p_conv and round_no=p_round;
    perform public._asm_enact(p_conv, p_round, v_card, true);
    select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
  end if;
  if r.phase = 'power' then
    -- неиспользованная власть сгорает (кроме peek — он «мгновенный», просто закрываем)
    update public.assembly_rounds set phase='done', power_used = power_used or (power='peek')
      where conv_id=p_conv and round_no=p_round;
  end if;
end$$;
revoke all on function public._asm_force_round(bigint, int) from public, anon, authenticated;

-- ── Мягкая авто-номинация 12:00: назначаем Канцлера за проспавшего Спикера,
--    но голосование остаётся открытым до 17:00 ──
create or replace function public._asm_auto_nominate(p_conv bigint, p_round int)
returns void language plpgsql security definer set search_path=public as $$
declare r public.assembly_rounds; v_el int[]; v_pick int;
begin
  select * into r from public.assembly_rounds where conv_id=p_conv and round_no=p_round;
  if r.phase <> 'nominate' then return; end if;
  v_el := public._asm_eligible(p_conv, r.speaker_seat);
  if coalesce(array_length(v_el,1),0) = 0 then
    update public.assembly_rounds set phase='done', vote_passed=false where conv_id=p_conv and round_no=p_round;
    return;
  end if;
  v_pick := v_el[1 + public._asm_hash(p_conv::text||':'||p_round||':nom') % array_length(v_el,1)];
  perform public._asm_miss(p_conv, r.speaker_seat);
  update public.assembly_rounds set nominee_seat=v_pick, phase='vote' where conv_id=p_conv and round_no=p_round;
end$$;
revoke all on function public._asm_auto_nominate(bigint, int) from public, anon, authenticated;

-- ── Ленивый сеттл: создать созыв, стартовать, дорезолвить прошедшие раунды ──
create or replace function public._asm_ensure()
returns void language plpgsql security definer set search_path=public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_now   time := (now() at time zone 'utc')::time;
  c record; r record; m record;
  v_n int; v_i int; v_deck text[]; v_gal int; v_roles text[]; v_last int;
begin
  perform pg_advisory_xact_lock(hashtext('asm_settle'));

  if not exists (select 1 from public.assembly_convocations where status in ('signup','active')) then
    insert into public.assembly_convocations(status, start_date) values ('signup', v_today + 1);
  end if;

  for c in select * from public.assembly_convocations where status='signup' and start_date <= v_today loop
    select count(*) into v_n from public.assembly_members where conv_id = c.id;
    if v_n < 5 then
      update public.assembly_convocations set start_date = v_today + 1 where id = c.id;
      continue;
    end if;
    v_n := least(v_n, 10);
    v_i := 0;
    for m in select faction_id from public.assembly_members where conv_id = c.id
             order by md5(c.id::text || ':seat:' || faction_id) loop
      v_i := v_i + 1;
      if v_i <= 10 then
        update public.assembly_members set seat = v_i where conv_id = c.id and faction_id = m.faction_id;
      end if;
    end loop;
    v_gal := case when v_n <= 6 then 1 when v_n <= 8 then 2 else 3 end;
    v_roles := array_fill('lib'::text, array[v_n]);
    v_roles[1] := 'archon';
    for v_i in 2 .. (1 + v_gal) loop v_roles[v_i] := 'gal'; end loop;
    v_i := 0;
    for m in select faction_id from public.assembly_members
             where conv_id = c.id and seat is not null
             order by md5(c.id::text || ':role:' || faction_id) loop
      v_i := v_i + 1;
      update public.assembly_members set role = v_roles[v_i] where conv_id = c.id and faction_id = m.faction_id;
    end loop;
    select array_agg(x order by md5(c.id::text || ':deck:' || o)) into v_deck
      from unnest(array_fill('L'::text, array[6]) || array_fill('G'::text, array[11])) with ordinality t(x, o);
    update public.assembly_convocations
      set status='active', seats=v_n, deck=v_deck, deck_pos=0 where id = c.id;
    insert into public.assembly_rounds(conv_id, round_no, day, speaker_seat)
      values (c.id, 1, v_today, (select min(seat) from public.assembly_members where conv_id=c.id and seat is not null));
    perform public._asm_news('🏛 Межзвёздная Ассамблея открыла созыв',
      'За столом ' || v_n || ' держав. Где-то среди них — скрытые Галактоцентристы и их Архонт. Первое заседание — сегодня.');
  end loop;

  for c in select * from public.assembly_convocations where status='active' loop
    select * into r from public.assembly_rounds where conv_id=c.id order by round_no desc limit 1;
    while r.day < v_today and r.phase <> 'done' loop
      perform public._asm_force_round(c.id, r.round_no);
      select * into r from public.assembly_rounds where conv_id=c.id order by round_no desc limit 1;
      -- созыв мог завершиться внутри
      if not exists (select 1 from public.assembly_convocations where id=c.id and status='active') then exit; end if;
    end loop;
    if not exists (select 1 from public.assembly_convocations where id=c.id and status='active') then continue; end if;

    if r.day = v_today then
      if r.phase = 'nominate' and v_now >= time '12:00' then
        perform public._asm_auto_nominate(c.id, r.round_no);
        select * into r from public.assembly_rounds where conv_id=c.id order by round_no desc limit 1;
      end if;
      if r.phase = 'vote' then
        select count(*) into v_n from public.assembly_members where conv_id=c.id and alive and seat is not null;
        select count(*) into v_i from public.assembly_votes v
          join public.assembly_members mm on mm.conv_id=v.conv_id and mm.faction_id=v.faction_id
          where v.conv_id=c.id and v.round_no=r.round_no and not v.advisory and mm.alive and mm.seat is not null;
        if v_i >= v_n then perform public._asm_resolve_vote(c.id, r.round_no, false);
        elsif v_now >= time '17:00' then perform public._asm_resolve_vote(c.id, r.round_no, true);
        end if;
      end if;
    end if;

    if not exists (select 1 from public.assembly_convocations where id=c.id and status='active') then continue; end if;
    select * into r from public.assembly_rounds where conv_id=c.id order by round_no desc limit 1;
    if r.phase = 'done' and r.day < v_today then
      v_last := r.speaker_seat;
      insert into public.assembly_rounds(conv_id, round_no, day, speaker_seat)
        values (c.id, r.round_no + 1, v_today, public._asm_next_speaker(c.id, v_last));
    end if;
  end loop;
end$$;
revoke all on function public._asm_ensure() from public, anon, authenticated;

-- ── Своя фракция (одобренная) ──
create or replace function public._asm_my_fid()
returns text language sql stable security definer set search_path=public as $$
  select faction_id from public.faction_applications
  where owner_id = auth.uid() and status = 'approved'
  order by updated_at desc limit 1
$$;
revoke all on function public._asm_my_fid() from public, anon, authenticated;

-- ── Состояние для клиента ──
create or replace function public.assembly_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_now   time := (now() at time zone 'utc')::time;
  v_fid text; c public.assembly_convocations; r public.assembly_rounds;
  me public.assembly_members;
  v_members jsonb; v_round jsonb; v_hist jsonb; v_me jsonb; v_last jsonb;
  v_votes jsonb; v_my boolean; v_cast int; v_alive int; v_adv jsonb;
  v_allies jsonb; v_closes int; v_hand jsonb; v_el int[];
begin
  perform public._asm_ensure();
  v_fid := public._asm_my_fid();

  select * into c from public.assembly_convocations
    where status in ('signup','active') order by id desc limit 1;

  select * into me from public.assembly_members where conv_id = c.id and faction_id = v_fid;

  -- участники (кресла + лоббисты) с публичными атрибутами
  select coalesce(jsonb_agg(jsonb_build_object(
      'fid', m.faction_id, 'seat', m.seat, 'alive', m.alive, 'replaced', m.replaced,
      'missed', m.missed, 'me', m.faction_id = v_fid,
      'name', a.name, 'crest', a.herald_url, 'color', a.color,
      'role', case when c.status = 'done' then m.role else null end
    ) order by m.seat nulls last, m.joined_at), '[]'::jsonb)
    into v_members
  from public.assembly_members m
  left join lateral (select name, herald_url, color from public.faction_applications
      where faction_id = m.faction_id and status='approved'
      order by updated_at desc limit 1) a on true
  where m.conv_id = c.id;

  if c.status = 'active' then
    select * into r from public.assembly_rounds where conv_id=c.id order by round_no desc limit 1;

    select count(*) into v_alive from public.assembly_members where conv_id=c.id and alive and seat is not null;
    select count(*), bool_or(v.faction_id = v_fid and v.vote) into v_cast, v_my
      from public.assembly_votes v where v.conv_id=c.id and v.round_no=r.round_no and not v.advisory;
    select vote into v_my from public.assembly_votes
      where conv_id=c.id and round_no=r.round_no and faction_id=v_fid;
    -- итоги голосования открываются после резолва
    if r.phase in ('legislate','power','done') and r.nominee_seat is not null then
      select coalesce(jsonb_agg(jsonb_build_object('fid', v.faction_id, 'vote', v.vote)), '[]'::jsonb)
        into v_votes from public.assembly_votes v
        where v.conv_id=c.id and v.round_no=r.round_no and not v.advisory;
    end if;
    -- совещательный тон лоббистов (агрегат, всегда открыт)
    select jsonb_build_object(
        'ja', count(*) filter (where vote), 'nein', count(*) filter (where not vote))
      into v_adv from public.assembly_votes
      where conv_id=c.id and round_no=r.round_no and advisory;

    -- рука видна только тому, чей сейчас ход
    if r.phase = 'legislate' and me.seat is not null then
      if (not r.speaker_discarded and me.seat = r.speaker_seat)
         or (r.speaker_discarded and me.seat = r.nominee_seat) then
        v_hand := to_jsonb(r.hand);
      end if;
    end if;

    if me.seat = r.speaker_seat and r.phase = 'nominate' then
      v_el := public._asm_eligible(c.id, r.speaker_seat);
    end if;

    v_closes := greatest(0, extract(epoch from (
      case
        when r.phase = 'nominate' and v_now < time '12:00' then (v_today::timestamp + time '12:00')
        when r.phase = 'vote'     and v_now < time '17:00' then (v_today::timestamp + time '17:00')
        else (v_today + 1)::timestamp
      end - (now() at time zone 'utc')))::int);

    v_round := jsonb_build_object(
      'no', r.round_no, 'day', r.day, 'phase', r.phase,
      'speaker_seat', r.speaker_seat, 'nominee_seat', r.nominee_seat,
      'speaker_discarded', r.speaker_discarded,
      'vote_passed', r.vote_passed, 'enacted', r.enacted, 'law', r.law,
      'power', r.power, 'power_used', r.power_used,
      'power_result', case when me.seat = r.speaker_seat then r.power_result else null end,
      'votes_cast', coalesce(v_cast,0), 'votes_total', coalesce(v_alive,0),
      'my_vote', v_my, 'votes', v_votes, 'advisory', v_adv,
      'hand', v_hand, 'eligible', to_jsonb(coalesce(v_el,'{}')),
      'closes_s', v_closes);

    select coalesce(jsonb_agg(jsonb_build_object(
        'no', h.round_no, 'day', h.day, 'speaker_seat', h.speaker_seat,
        'nominee_seat', h.nominee_seat, 'vote_passed', h.vote_passed,
        'enacted', h.enacted, 'law_title', h.law->>'title') order by h.round_no desc), '[]'::jsonb)
      into v_hist
    from public.assembly_rounds h where h.conv_id=c.id and h.phase='done';
  end if;

  -- моя тайная роль + известные союзники (галактоцентристы видят своих и
  -- Архонта; Архонт видит соратников только при 5-6 креслах)
  if me.role is not null then
    if me.role = 'gal' or (me.role = 'archon' and c.seats <= 6) then
      select coalesce(jsonb_agg(jsonb_build_object('seat', m2.seat, 'fid', m2.faction_id, 'role', m2.role)), '[]'::jsonb)
        into v_allies from public.assembly_members m2
        where m2.conv_id=c.id and m2.role in ('gal','archon') and m2.faction_id <> me.faction_id and not m2.replaced;
    end if;
  end if;
  v_me := case when me.faction_id is null then null else jsonb_build_object(
    'fid', me.faction_id, 'seat', me.seat, 'role', me.role,
    'alive', me.alive, 'replaced', me.replaced, 'missed', me.missed,
    'allies', coalesce(v_allies, '[]'::jsonb)) end;

  -- последний завершённый созыв: исход + вскрытые роли
  select jsonb_build_object('id', p.id, 'winner', p.winner, 'reason', p.win_reason,
      'lib_laws', p.lib_laws, 'gal_laws', p.gal_laws, 'finished_at', p.finished_at,
      'members', (select coalesce(jsonb_agg(jsonb_build_object(
          'fid', m.faction_id, 'seat', m.seat, 'role', m.role, 'alive', m.alive,
          'name', a.name, 'crest', a.herald_url) order by m.seat nulls last), '[]'::jsonb)
        from public.assembly_members m
        left join lateral (select name, herald_url from public.faction_applications
            where faction_id=m.faction_id and status='approved' order by updated_at desc limit 1) a on true
        where m.conv_id = p.id and m.seat is not null))
    into v_last
  from public.assembly_convocations p where p.status='done'
  order by p.id desc limit 1;

  return jsonb_build_object(
    'me_faction', v_fid is not null,
    'me_fine', (select fine from public.assembly_penalties
                where faction_id = v_fid and paid_at is null),
    'conv', jsonb_build_object(
      'id', c.id, 'status', c.status, 'start_date', c.start_date, 'seats', c.seats,
      'lib_laws', c.lib_laws, 'gal_laws', c.gal_laws, 'tracker', c.tracker,
      'deck_left', greatest(0, coalesce(array_length(c.deck,1),0) - c.deck_pos),
      'signups', (select count(*) from public.assembly_members where conv_id=c.id)),
    'members', coalesce(v_members, '[]'::jsonb),
    'me', v_me,
    'round', v_round,
    'history', coalesce(v_hist, '[]'::jsonb),
    'last', v_last);
end$$;
revoke all on function public.assembly_state() from public, anon;
grant execute on function public.assembly_state() to authenticated;

-- ── Общие проверки действий ──
create or replace function public._asm_ctx(out o_conv public.assembly_convocations,
                                           out o_round public.assembly_rounds,
                                           out o_me public.assembly_members)
language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._asm_ensure();
  v_fid := public._asm_my_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;
  select * into o_conv from public.assembly_convocations
    where status in ('signup','active') order by id desc limit 1;
  select * into o_me from public.assembly_members where conv_id=o_conv.id and faction_id=v_fid;
  if o_conv.status = 'active' then
    select * into o_round from public.assembly_rounds where conv_id=o_conv.id order by round_no desc limit 1;
  end if;
end$$;
revoke all on function public._asm_ctx() from public, anon, authenticated;

-- ── Заявка на участие (во время записи; в активный созыв — в очередь лоббистов) ──
create or replace function public.assembly_signup()
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if me.faction_id is not null then raise exception 'already signed up'; end if;
  if exists (select 1 from public.assembly_penalties
             where faction_id = public._asm_my_fid() and paid_at is null) then
    raise exception 'assembly fine unpaid';
  end if;
  insert into public.assembly_members(conv_id, faction_id, owner)
    values (c.id, public._asm_my_fid(), auth.uid());
  return public.assembly_state();
end$$;
revoke all on function public.assembly_signup() from public, anon;
grant execute on function public.assembly_signup() to authenticated;

-- ── Спикер назначает Канцлера ──
create or replace function public.assembly_nominate(p_seat int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if c.status <> 'active' or r.phase <> 'nominate' then raise exception 'not nomination phase'; end if;
  if me.seat is null or me.seat <> r.speaker_seat or not me.alive then raise exception 'not the speaker'; end if;
  if not (p_seat = any (public._asm_eligible(c.id, r.speaker_seat))) then raise exception 'ineligible nominee'; end if;
  update public.assembly_rounds set nominee_seat = p_seat, phase = 'vote'
    where conv_id = c.id and round_no = r.round_no;
  update public.assembly_members set missed = 0 where conv_id=c.id and faction_id=me.faction_id;
  return public.assembly_state();
end$$;
revoke all on function public.assembly_nominate(int) from public, anon;
grant execute on function public.assembly_nominate(int) to authenticated;

-- ── Голос ja/nein (кресла — решающий, лоббисты — совещательный; можно передумать) ──
create or replace function public.assembly_vote(p_ja boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if c.status <> 'active' or r.phase <> 'vote' then raise exception 'not voting phase'; end if;
  if me.faction_id is null or not me.alive or me.replaced then raise exception 'not a member'; end if;
  insert into public.assembly_votes(conv_id, round_no, faction_id, vote, advisory)
    values (c.id, r.round_no, me.faction_id, p_ja, me.seat is null)
    on conflict (conv_id, round_no, faction_id)
      do update set vote = excluded.vote, created_at = now();
  if me.seat is not null then
    update public.assembly_members set missed = 0 where conv_id=c.id and faction_id=me.faction_id;
  end if;
  perform public._asm_ensure();   -- все проголосовали → ранний резолв
  return public.assembly_state();
end$$;
revoke all on function public.assembly_vote(boolean) from public, anon;
grant execute on function public.assembly_vote(boolean) to authenticated;

-- ── Спикер сбрасывает 1 из 3 законов (p_idx: 1..3) ──
create or replace function public.assembly_discard(p_idx int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if c.status <> 'active' or r.phase <> 'legislate' or r.speaker_discarded then raise exception 'not speaker draw phase'; end if;
  if me.seat is null or me.seat <> r.speaker_seat or not me.alive then raise exception 'not the speaker'; end if;
  if p_idx not between 1 and 3 then raise exception 'bad card'; end if;
  update public.assembly_convocations set discard = discard || r.hand[p_idx] where id = c.id;
  update public.assembly_rounds
    set hand = r.hand[1:p_idx-1] || r.hand[p_idx+1:], speaker_discarded = true
    where conv_id = c.id and round_no = r.round_no;
  update public.assembly_members set missed = 0 where conv_id=c.id and faction_id=me.faction_id;
  return public.assembly_state();
end$$;
revoke all on function public.assembly_discard(int) from public, anon;
grant execute on function public.assembly_discard(int) to authenticated;

-- ── Канцлер вводит 1 из 2 законов (p_idx: 1..2) ──
create or replace function public.assembly_enact_law(p_idx int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members; v_card text;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if c.status <> 'active' or r.phase <> 'legislate' or not r.speaker_discarded then raise exception 'not chancellor phase'; end if;
  if me.seat is null or me.seat <> r.nominee_seat or not me.alive then raise exception 'not the chancellor'; end if;
  if p_idx not between 1 and 2 then raise exception 'bad card'; end if;
  v_card := r.hand[p_idx];
  update public.assembly_convocations set discard = discard || r.hand[3 - p_idx] where id = c.id;
  update public.assembly_rounds set hand = null where conv_id = c.id and round_no = r.round_no;
  update public.assembly_members set missed = 0 where conv_id=c.id and faction_id=me.faction_id;
  perform public._asm_enact(c.id, r.round_no, v_card, true);
  return public.assembly_state();
end$$;
revoke all on function public.assembly_enact_law(int) from public, anon;
grant execute on function public.assembly_enact_law(int) to authenticated;

-- ── Спикер применяет спецвласть Директивы ──
--    peek: p_seat игнорируется · investigate/execute/special: p_seat = цель
create or replace function public.assembly_power(p_seat int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.assembly_convocations; r public.assembly_rounds; me public.assembly_members;
  tgt public.assembly_members; v_res jsonb; ctx record;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if c.status <> 'active' or r.phase <> 'power' or r.power_used then raise exception 'no power pending'; end if;
  if me.seat is null or me.seat <> r.speaker_seat or not me.alive then raise exception 'not the speaker'; end if;

  if r.power = 'peek' then
    v_res := jsonb_build_object('peek', to_jsonb(c.deck[c.deck_pos+1 : c.deck_pos+3]));
    update public.assembly_rounds set power_used=true, power_result=v_res, phase='done'
      where conv_id=c.id and round_no=r.round_no;
    return public.assembly_state();
  end if;

  select * into tgt from public.assembly_members
    where conv_id=c.id and seat=p_seat and alive and not replaced;
  if not found or p_seat = me.seat then raise exception 'bad target'; end if;

  if r.power = 'investigate' then
    v_res := jsonb_build_object('seat', p_seat,
      'party', case when tgt.role = 'lib' then 'lib' else 'gal' end);
    update public.assembly_rounds set power_used=true, power_result=v_res, phase='done'
      where conv_id=c.id and round_no=r.round_no;
  elsif r.power = 'special' then
    update public.assembly_convocations set special_seat = p_seat where id=c.id;
    update public.assembly_rounds set power_used=true,
        power_result=jsonb_build_object('special', p_seat), phase='done'
      where conv_id=c.id and round_no=r.round_no;
  elsif r.power = 'execute' then
    update public.assembly_members set alive=false where conv_id=c.id and faction_id=tgt.faction_id;
    update public.assembly_rounds set power_used=true,
        power_result=jsonb_build_object('executed', p_seat), phase='done'
      where conv_id=c.id and round_no=r.round_no;
    if tgt.role = 'archon' then
      update public.assembly_convocations set status='done', winner='lib', win_reason='archon_executed', finished_at=now() where id=c.id;
      perform public._asm_news('🏛 Созыв завершён: АРХОНТ КАЗНЁН',
        'Приговор Ассамблеи привёл заговор к эшафоту: казнённый делегат оказался скрытым Архонтом. Федерация победила.');
    else
      perform public._asm_news('🏛 Ассамблея вынесла смертный приговор',
        'Делегат кресла №' || p_seat || ' исключён из Ассамблеи навсегда. Его тайная роль осталась нераскрытой.');
    end if;
  else
    raise exception 'unknown power';
  end if;
  update public.assembly_members set missed = 0 where conv_id=c.id and faction_id=me.faction_id;
  return public.assembly_state();
end$$;
revoke all on function public.assembly_power(int) from public, anon;
grant execute on function public.assembly_power(int) to authenticated;

-- ── Самовольный выход из сессии ──
--    Во время записи — просто отзыв заявки (без последствий).
--    Из активного созыва — кресло уходит первому лоббисту (наследует роль),
--    на беглеца накладывается штраф 500 000 ГС: запрет на участие до выплаты.
--    Если замены нет — делегат выбывает из игры; дезертирство Архонта = победа Федерации.
create or replace function public.assembly_leave()
returns jsonb language plpgsql security definer set search_path=public as $$
declare ctx record; c public.assembly_convocations; r public.assembly_rounds;
        me public.assembly_members; sub public.assembly_members;
begin
  ctx := public._asm_ctx(); c := ctx.o_conv; r := ctx.o_round; me := ctx.o_me;
  if me.faction_id is null or me.replaced then raise exception 'not a member'; end if;

  if c.status = 'signup' then
    delete from public.assembly_members where conv_id=c.id and faction_id=me.faction_id;
    return public.assembly_state();
  end if;

  if me.seat is not null and me.alive then
    select * into sub from public.assembly_members
      where conv_id=c.id and seat is null and not replaced and faction_id <> me.faction_id
      order by joined_at limit 1;
    if found then
      update public.assembly_members set seat=null, replaced=true
        where conv_id=c.id and faction_id=me.faction_id;
      update public.assembly_members set seat=me.seat, role=me.role, missed=0
        where conv_id=c.id and faction_id=sub.faction_id;
      perform public._asm_news('🏛 Делегат покинул Ассамблею',
        'Кресло №' || me.seat || ' самовольно оставлено. Место занял лоббист; на беглеца наложен штраф 500 000 ГС.');
    else
      update public.assembly_members set seat=null, replaced=true, alive=false
        where conv_id=c.id and faction_id=me.faction_id;
      if me.role = 'archon' then
        update public.assembly_convocations
          set status='done', winner='lib', win_reason='archon_fled', finished_at=now()
          where id=c.id;
        perform public._asm_news('🏛 Созыв завершён: АРХОНТ ДЕЗЕРТИРОВАЛ',
          'Покинувший заседание делегат оказался скрытым Архонтом. Заговор обезглавлен — Федерация победила.');
      else
        perform public._asm_news('🏛 Делегат покинул Ассамблею',
          'Кресло №' || me.seat || ' опустело: замены в очереди лоббистов нет. На беглеца наложен штраф 500 000 ГС.');
      end if;
    end if;
  else
    update public.assembly_members set replaced=true
      where conv_id=c.id and faction_id=me.faction_id;
  end if;

  insert into public.assembly_penalties(faction_id) values (me.faction_id)
    on conflict (faction_id) do update set fine=500000, created_at=now(), paid_at=null;
  perform public._asm_ensure();   -- выход мог снять блокировку фазы (ранний резолв)
  return public.assembly_state();
end$$;
revoke all on function public.assembly_leave() from public, anon;
grant execute on function public.assembly_leave() to authenticated;

-- ── Выплата штрафа Ассамблее (снимает запрет на участие) ──
create or replace function public.assembly_pay_fine()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; p public.assembly_penalties;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._asm_my_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;
  select * into p from public.assembly_penalties where faction_id=v_fid and paid_at is null;
  if not found then raise exception 'no fine'; end if;
  update public.faction_economy set gc = gc - p.fine where faction_id=v_fid and gc >= p.fine;
  if not found then raise exception 'not enough gc'; end if;
  update public.assembly_penalties set paid_at=now() where faction_id=v_fid;
  return public.assembly_state();
end$$;
revoke all on function public.assembly_pay_fine() from public, anon;
grant execute on function public.assembly_pay_fine() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ЧАТ АССАМБЛЕИ — кулуары зала заседаний.
-- Писать могут только участники созыва (кресла и лоббисты), читать — все
-- (наблюдатели тоже: переговоры публичны). Галактоцентристы и Архонт могут
-- ставить галочку «шёпот заговора»: такое сообщение видят только они.
-- После завершения созыва шёпот вскрывается вместе с ролями — читают все.
-- Живость без Realtime: клиент опрашивает assembly_chat_list(p_after)
-- раз в ~10 секунд и дотягивает только новые сообщения.
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.assembly_chat (
  id         bigint generated always as identity primary key,
  conv_id    bigint not null references public.assembly_convocations(id) on delete cascade,
  faction_id text   not null,
  body       text   not null,
  whisper    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists assembly_chat_conv_idx on public.assembly_chat (conv_id, id);
alter table public.assembly_chat enable row level security;
revoke all on public.assembly_chat from anon, authenticated;

-- Может ли фракция видеть шёпот созыва: заговорщик-gal — всегда; Архонт —
-- ТОЛЬКО при 5-6 креслах (при 7+ он не знает соратников — канал выдал бы их,
-- зеркало правила «известные соратники» из assembly_state); созыв done — все.
create or replace function public._asm_chat_sees_whisper(p_conv bigint, p_fid text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.assembly_convocations where id = p_conv and status = 'done')
      or exists (select 1 from public.assembly_members m
                 join public.assembly_convocations c on c.id = m.conv_id
                 where m.conv_id = p_conv and m.faction_id = p_fid and not m.replaced
                   and (m.role = 'gal' or (m.role = 'archon' and coalesce(c.seats, 10) <= 6)))
$$;
revoke all on function public._asm_chat_sees_whisper(bigint, text) from public, anon, authenticated;

-- ── Чтение: p_after = id последнего уже полученного сообщения (0 = всё, до 80) ──
create or replace function public.assembly_chat_list(p_after bigint default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_fid text; c public.assembly_convocations;
  v_sees boolean; v_can boolean; v_msgs jsonb;
begin
  v_fid := public._asm_my_fid();
  select * into c from public.assembly_convocations order by id desc limit 1;
  if c.id is null then return jsonb_build_object('conv', null, 'msgs', '[]'::jsonb); end if;

  v_sees := v_fid is not null and public._asm_chat_sees_whisper(c.id, v_fid);
  -- писать шёпотом может тот же круг, что его видит (активный созыв)
  v_can  := c.status = 'active' and v_sees;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'fid', t.faction_id, 'body', t.body, 'whisper', t.whisper,
      'ts', t.created_at, 'mine', t.faction_id = v_fid,
      'name', t.name, 'crest', t.crest, 'color', t.color) order by t.id), '[]'::jsonb)
    into v_msgs
  from (
    select ch.*, a.name, a.herald_url as crest, a.color
    from public.assembly_chat ch
    left join lateral (select name, herald_url, color from public.faction_applications
        where faction_id = ch.faction_id and status = 'approved'
        order by updated_at desc limit 1) a on true
    where ch.conv_id = c.id and ch.id > p_after
      and (not ch.whisper or v_sees)
    order by ch.id desc limit 80
  ) t;

  return jsonb_build_object(
    'conv', c.id, 'status', c.status,
    'can_post', v_fid is not null and exists (
        select 1 from public.assembly_members where conv_id = c.id and faction_id = v_fid),
    'can_whisper', v_can,
    'msgs', v_msgs);
end$$;
revoke all on function public.assembly_chat_list(bigint) from public, anon;
grant execute on function public.assembly_chat_list(bigint) to authenticated;

-- ── Отправка. Шёпот доступен только заговорщикам активного созыва. ──
create or replace function public.assembly_chat_post(p_body text, p_whisper boolean default false, p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; c public.assembly_convocations; v_body text; v_last timestamptz;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._asm_ensure();
  v_fid := public._asm_my_fid();
  if v_fid is null then raise exception 'no approved faction'; end if;

  select * into c from public.assembly_convocations order by id desc limit 1;
  if c.id is null or c.status = 'done' then raise exception 'no active convocation'; end if;
  if not exists (select 1 from public.assembly_members
                 where conv_id = c.id and faction_id = v_fid) then
    raise exception 'not a member';
  end if;

  v_body := trim(coalesce(p_body, ''));
  if length(v_body) < 1 then raise exception 'empty message'; end if;
  if length(v_body) > 500 then raise exception 'message too long'; end if;

  -- антифлуд: не чаще 1 сообщения в 3 секунды
  select max(created_at) into v_last from public.assembly_chat
    where conv_id = c.id and faction_id = v_fid;
  if v_last is not null and v_last > now() - interval '3 seconds' then
    raise exception 'too fast';
  end if;

  -- шёпот: тот же круг, что видит канал (gal всегда, Архонт лишь при ≤6 креслах)
  if p_whisper and not public._asm_chat_sees_whisper(c.id, v_fid) then
    raise exception 'whisper not allowed';
  end if;

  insert into public.assembly_chat(conv_id, faction_id, body, whisper)
    values (c.id, v_fid, v_body, coalesce(p_whisper, false));

  -- держим не больше 400 сообщений на созыв
  delete from public.assembly_chat
    where conv_id = c.id and id not in (
      select id from public.assembly_chat where conv_id = c.id order by id desc limit 400);

  return public.assembly_chat_list(p_after);
end$$;
revoke all on function public.assembly_chat_post(text, boolean, bigint) from public, anon;
grant execute on function public.assembly_chat_post(text, boolean, bigint) to authenticated;
