-- ============================================================
-- ЖУРНАЛ ДЕЙСТВИЙ ИГРОКА — серверный аудит на триггерах (УНИВЕРСАЛЬНЫЙ)
--
-- Ловит ВСЁ, что пишется в игровые таблицы фракции, любым путём (UI / RPC /
-- правка из консоли — RLS проверяет владельца, а не путь). Плюс БЭКФИЛЛ
-- реконструирует ВСЮ доступную историю из существующих строк (по реальным
-- датам) — не только колонии/постройки, а займы, бартер, биржу, дипломатию,
-- союзы, вассалитет, веру, оборону, агентов и т.д.
--
-- Движок универсальный (общие helper'ы _audit_fid/_audit_owner/_audit_hint +
-- карта _audit_map): faction_id/владелец/«зацепка» достаются из to_jsonb по
-- списку кандидатных колонок — схему каждой таблицы хардкодить не нужно.
-- Триггеры и бэкфилл навешиваются ТОЛЬКО на существующие таблицы (срезы
-- биржи/обороны/веры могут быть ещё не применены — пропускаются, не ошибка).
--
-- ЧЕГО ВОССТАНОВИТЬ НЕЛЬЗЯ задним числом: денежные переводы прошлого
-- (economy_transfer мутирует gc и не оставляет записи) и удаления. ВПЕРЁД
-- переводы/траты/покупки на бирже фиксируются (эвристика last_tick, см. ниже).
--
-- Выполнить ЦЕЛИКОМ в Supabase → SQL Editor. Идемпотентно (перезапускаемо).
-- В конце вывода — NOTICE со списком покрытых таблиц и числом записей бэкфилла.
-- ============================================================

-- ── Таблица журнала ─────────────────────────────────────────
create table if not exists public.faction_audit (
  id          bigint generated always as identity primary key,
  ts          timestamptz default now(),
  faction_id  text,
  owner_id    uuid,
  actor_email text,
  actor_role  text,
  is_staff    boolean default false,
  category    text,
  action      text,
  summary     text,
  detail      jsonb default '{}'::jsonb,
  src_table   text,
  row_id      text,
  source      text default 'trigger'
);
create index if not exists fa_faction_ts_idx on public.faction_audit (faction_id, ts desc);
create index if not exists fa_ts_idx          on public.faction_audit (ts desc);
create index if not exists fa_cat_idx          on public.faction_audit (category);

alter table public.faction_audit enable row level security;
drop policy if exists "fa_sel" on public.faction_audit;
drop policy if exists "fa_del" on public.faction_audit;
create policy "fa_sel" on public.faction_audit for select to authenticated
  using (owner_id = auth.uid() or public.current_user_role() in ('superadmin','editor','moderator'));
create policy "fa_del" on public.faction_audit for delete to authenticated
  using (public.current_user_role() in ('superadmin','editor'));

-- ── Карта: таблица → категория + ярлык (единый источник правды) ──
create or replace function public._audit_map()
returns table(tbl text, category text, label text) language sql immutable as $$
  values
    ('faction_economy','economy','Экономика'),
    ('econ_relief',     'economy','Антикризис'),
    ('colonies',        'colony', 'Колония'),
    ('colony_buildings','building','Постройка'),
    ('colony_projects', 'building','Стройка'),
    ('unit_production', 'unit',   'Производство'),
    ('faction_units',   'design', 'Проект'),
    ('trade_routes',    'caravan','Караван'),
    ('barter_offers',   'trade',  'Бартер'),
    ('loans',           'finance','Заём'),
    ('spy_missions',    'spy',    'Тайная операция'),
    ('spy_agents',      'spy',    'Агент'),
    ('spy_recruits',    'spy',    'Рекрут'),
    ('spy_ransoms',     'spy',    'Выкуп'),
    ('spy_artifacts',   'spy',    'Артефакт'),
    ('faction_news',    'news',   'Новость'),
    ('news_reactions',  'news',   'Реакция'),
    ('faction_relations','diplo', 'Отношения'),
    ('diplo_unions',    'diplo',  'Союз'),
    ('diplo_members',   'diplo',  'Член союза'),
    ('diplo_invites',   'diplo',  'Приглашение в союз'),
    ('diplo_vassals',   'diplo',  'Вассалитет'),
    ('faiths',          'faith',  'Религия'),
    ('faith_membership','faith',  'Вероисповедание'),
    ('faith_offers',    'faith',  'Признание веры'),
    ('faith_sects',     'faith',  'Секта'),
    ('corporations',    'exchange','Корпорация'),
    ('corp_shares',     'exchange','Акции'),
    ('corp_listings',   'exchange','Листинг акций'),
    ('bond_issues',     'exchange','Выпуск облигаций'),
    ('bond_holdings',   'exchange','Облигации'),
    ('margin_positions','exchange','Маржа'),
    ('futures_positions','exchange','Фьючерс'),
    ('option_positions','exchange','Опцион'),
    ('index_holdings',  'exchange','Индекс-пай'),
    ('exchange_orders', 'exchange','Госзаказ'),
    ('tech_offers',     'research','Обмен технологий'),
    ('outposts',        'defense','Аванпост'),
    ('outpost_ships',   'defense','Корабль-носитель'),
    ('system_minefields','defense','Минное поле'),
    ('doom_guns',       'defense','Длань Неотвратимости'),
    ('doom_salvos',     'defense','Залп судного дня');
$$;

create or replace function public._audit_meta(p_table text)
returns table(category text, label text) language sql immutable as $$
  select category, label from public._audit_map() where tbl = p_table;
$$;

-- ── Helper'ы: вытащить fid / владельца / «зацепку» из строки-jsonb ──
create or replace function public._audit_fid(j jsonb) returns text language sql immutable as $$
  select coalesce(
    nullif(j->>'faction_id',''), nullif(j->>'a_fid',''),  nullif(j->>'actor_fid',''),
    nullif(j->>'holder_fid',''), nullif(j->>'seller_fid',''), nullif(j->>'buyer_fid',''),
    nullif(j->>'issuer_fid',''), nullif(j->>'from_fid',''), nullif(j->>'leader_fid',''),
    nullif(j->>'overlord_fid',''), nullif(j->>'reactor_fid',''), nullif(j->>'founder_fid',''),
    nullif(j->>'owner_fid',''), nullif(j->>'captor_fid',''), nullif(j->>'lender_fid',''),
    nullif(j->>'fid',''));
$$;

create or replace function public._audit_owner(j jsonb) returns uuid language plpgsql immutable as $$
declare v uuid;
begin
  begin
    v := nullif(coalesce(
      j->>'owner_id', j->>'actor_owner', j->>'a_owner', j->>'from_owner',
      j->>'reactor_owner', j->>'founder_owner', j->>'overlord_owner',
      j->>'seller_owner', j->>'buyer_owner', j->>'lender_owner'),'')::uuid;
  exception when others then v := null; end;
  return v;
end$$;

create or replace function public._audit_hint(j jsonb) returns text language sql immutable as $$
  select coalesce(
    nullif(j->>'name',''), nullif(j->>'title',''), nullif(j->>'planet_name',''),
    nullif(j->>'unit_name',''), nullif(j->>'btype',''), nullif(j->>'kind',''),
    nullif(j->>'resource',''), nullif(j->>'res',''), nullif(j->>'target_name',''),
    nullif(j->>'b_name',''), nullif(j->>'host_fid',''), nullif(j->>'to_fid',''),
    nullif(j->>'label',''), nullif(j->>'op',''), nullif(j->>'mtype',''));
$$;

-- fac_xxxx → читаемое название державы (для сводок); прочее без изменений
create or replace function public._audit_name(v text) returns text language sql stable as $$
  select case when v like 'fac\_%' escape '\' then coalesce(public._fac_name(v), v) else v end;
$$;

-- ── Универсальный триггер захвата (всё, что происходит ВПЕРЁД) ──
create or replace function public._audit_capture() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  newj      jsonb;
  oldj      jsonb;
  m         record;
  v_fid     text;
  v_owner   uuid;
  v_detail  jsonb;
  v_changed text;
  v_hint    text;
  v_summary text;
  v_rowid   text;
  v_email   text := auth.jwt() ->> 'email';
  v_role    text := public.current_user_role();
  v_staff   boolean;
  v_money   boolean := false;
  v_arr     text[] := '{}';
  v_d       numeric;
  v_rstr    text;
  heavy     text[] := array['data','body','card_text','card','summary','params','result',
                            'planets','mining_targets','detail','image_url','resources','price_history'];
  noise     text[] := array['created_at','updated_at','last_tick','gc','science','tnp',
                            'last_price','market_value','index_value','nav','last_fix','phase','basis'];
begin
  select category, label into m from public._audit_meta(tg_table_name);
  if m.category is null then return null; end if;

  v_staff := coalesce(v_role in ('superadmin','editor','moderator'), false);
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;
  newj := to_jsonb(rec);
  if tg_op = 'UPDATE' then oldj := to_jsonb(old); end if;

  if tg_table_name = 'faction_news' and newj->>'owner_id' is null then return null; end if;

  -- Движение казны: тик economy_accrue ВСЕГДА двигает last_tick, а
  -- перевод/трата/покупка на бирже — нет → ловим действие.
  if tg_table_name = 'faction_economy' and tg_op = 'UPDATE'
     and (oldj->>'last_tick') is not distinct from (newj->>'last_tick') then
    v_money := true;
    noise := array['created_at','updated_at','last_tick','last_price','market_value',
                   'index_value','nav','last_fix','phase','basis'];
    heavy := array_remove(heavy, 'resources');  -- чтобы перевод РЕСУРСАМИ не отсёкся как «пустой»
  end if;

  v_fid   := public._audit_fid(newj);
  v_owner := public._audit_owner(newj);
  if v_fid is null and v_owner is null then return null; end if;
  v_rowid := coalesce(newj->>'id', newj->>'faction_id', newj->>'building_id');

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('old', oldj->k, 'new', newj->k)), '{}'::jsonb)
      into v_detail
    from jsonb_object_keys(newj) as k
    where (newj->k) is distinct from (oldj->k)
      and k <> all (heavy) and k <> all (noise);
    if v_detail = '{}'::jsonb then return null; end if;
    select string_agg(k, ', ') into v_changed from jsonb_object_keys(v_detail) as k;
  else
    v_detail := newj;
    foreach v_changed in array heavy loop v_detail := v_detail - v_changed; end loop;
    v_changed := null;
  end if;

  v_hint := public._audit_name(public._audit_hint(newj));

  v_summary := case tg_op
    when 'INSERT' then m.label || ': ' || coalesce(v_hint, 'создано')
    when 'DELETE' then m.label || ': удалено' || coalesce(' — ' || v_hint, '')
    else m.label || coalesce(' «' || v_hint || '»', '') || ': изменено (' || coalesce(v_changed, '—') || ')'
  end;

  if v_money then
    -- дельты валют казны
    v_arr := '{}';
    v_d := coalesce((newj->>'gc')::numeric,0) - coalesce((oldj->>'gc')::numeric,0);
    if v_d <> 0 then v_arr := v_arr || ('ГС '  || (case when v_d > 0 then '+' else '−' end) || trim(to_char(abs(v_d),'FM999999999990'))); end if;
    v_d := coalesce((newj->>'science')::numeric,0) - coalesce((oldj->>'science')::numeric,0);
    if v_d <> 0 then v_arr := v_arr || ('ОН '  || (case when v_d > 0 then '+' else '−' end) || trim(to_char(abs(v_d),'FM999999999990'))); end if;
    v_d := coalesce((newj->>'tnp')::numeric,0) - coalesce((oldj->>'tnp')::numeric,0);
    if v_d <> 0 then v_arr := v_arr || ('ТНП ' || (case when v_d > 0 then '+' else '−' end) || trim(to_char(abs(v_d),'FM999999999990'))); end if;

    -- дельты РЕСУРСОВ (перевод/трата сырья: faction_economy.resources = {имя:число})
    select string_agg(
             d.rk || ' ' || (case when d.rd > 0 then '+' else '−' end) || trim(to_char(abs(d.rd),'FM999999999990')),
             ', ' order by d.rk)
      into v_rstr
    from (
      select ks.k as rk,
             coalesce((newj->'resources'->>ks.k)::numeric,0) - coalesce((oldj->'resources'->>ks.k)::numeric,0) as rd
      from (
        select jsonb_object_keys(coalesce(newj->'resources','{}'::jsonb)) as k
        union
        select jsonb_object_keys(coalesce(oldj->'resources','{}'::jsonb)) as k
      ) ks
    ) d
    where d.rd <> 0;

    if array_length(v_arr,1) is not null or v_rstr is not null then
      v_summary := array_to_string(
        array_remove(array[
          case when array_length(v_arr,1) is not null then 'Казна: ' || array_to_string(v_arr, ', ') end,
          case when v_rstr is not null then 'Ресурсы: ' || v_rstr end
        ], null), ' · ');
      v_detail := jsonb_build_object('gc', newj->>'gc', 'science', newj->>'science', 'tnp', newj->>'tnp', 'res_delta', v_rstr);
    end if;
  end if;

  insert into public.faction_audit
    (faction_id, owner_id, actor_email, actor_role, is_staff, category, action, summary, detail, src_table, row_id, source)
  values
    (v_fid, v_owner, v_email, v_role, v_staff, m.category, lower(tg_op), v_summary, coalesce(v_detail,'{}'::jsonb), tg_table_name, v_rowid, 'trigger');
  return null;
end$$;

-- ── Навешиваем триггеры на ВСЕ существующие таблицы из карты ──
do $$
declare t text; cnt int := 0; lst text := '';
begin
  for t in select tbl from public._audit_map() loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I', t);
      execute format(
        'create trigger trg_audit after insert or update or delete on public.%I
           for each row execute function public._audit_capture()', t);
      cnt := cnt + 1; lst := lst || t || ' ';
    end if;
  end loop;
  raise notice 'AUDIT: триггеры навешены на % таблиц: %', cnt, lst;
end$$;

-- ── БЭКФИЛЛ: реконструкция всей доступной истории из существующих строк ──
-- Для каждой существующей таблицы из карты вставляет запись «создано» по
-- реальной дате (created_at/started_at/published_at/issued_at/now()).
create or replace function public._audit_backfill() returns text
language plpgsql security definer set search_path = public as $$
declare
  t      text;
  m      record;
  arr    jsonb;
  el     jsonb;
  v_fid  text;
  v_own  uuid;
  v_ts   timestamptz;
  v_hint text;
  v_det  jsonb;
  k      text;
  total  int := 0;
  heavy  text[] := array['data','body','card_text','card','summary','params','result',
                        'planets','mining_targets','detail','image_url','resources','price_history'];
begin
  delete from public.faction_audit where source = 'backfill';
  for t in select tbl from public._audit_map() loop
    if to_regclass('public.' || t) is null then continue; end if;
    if t = 'faction_economy' then continue; end if;  -- баланс не реконструируем (только живые движения вперёд)
    select category, label into m from public._audit_meta(t);
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into arr;

    for el in select * from jsonb_array_elements(arr) loop
      if t = 'faction_news' and (el->>'owner_id') is null then continue; end if;  -- авто-сводки сектора
      v_fid := public._audit_fid(el);
      v_own := public._audit_owner(el);
      if v_fid is null and v_own is null then continue; end if;

      -- только реальная дата: без неё в историю не пишем (иначе свалка «сейчас»);
      -- такие действия всё равно ловятся триггером ВПЕРЁД.
      begin
        v_ts := coalesce(
          nullif(el->>'created_at','')::timestamptz,
          nullif(el->>'started_at','')::timestamptz,
          nullif(el->>'published_at','')::timestamptz,
          nullif(el->>'issued_at','')::timestamptz);
      exception when others then v_ts := null; end;
      if v_ts is null then continue; end if;

      v_hint := public._audit_name(public._audit_hint(el));
      v_det  := el;
      foreach k in array heavy loop v_det := v_det - k; end loop;

      insert into public.faction_audit
        (ts, faction_id, owner_id, actor_email, actor_role, is_staff, category, action, summary, detail, src_table, row_id, source)
      values
        (v_ts, v_fid, v_own, nullif(el->>'owner_email',''), 'player', false,
         m.category, 'insert', m.label || ': ' || coalesce(v_hint, 'создано'),
         coalesce(v_det,'{}'::jsonb), t, el->>'id', 'backfill');
      total := total + 1;
    end loop;
  end loop;
  return format('AUDIT backfill: %s записей восстановлено', total);
end$$;

select public._audit_backfill();
-- готово
