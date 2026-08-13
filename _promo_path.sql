-- ============================================================
-- ПОРОГ ВХОДА: ПРОМОКОДЫ + «ПУТЬ СТАНОВЛЕНИЯ»
-- Применять: node tools/db_run.js _promo_path.sql
-- Требует: _economy_setup.sql, _faction_members.sql (_ec_my_fid), _build_coupons.sql
--
-- ЗАЧЕМ. Новичок открывает кабинет и видит пустую казну и полсотни кнопок.
-- Промокод даёт ему стартовый капитал, «Путь становления» — говорит, ЧТО
-- нажимать, и платит за каждый шаг. Обе штуки настраиваются из админки:
-- в коде нет ни одной зашитой суммы.
--
-- БЕЗОПАСНОСТЬ. Клиент НЕ пишет ни в одну из этих таблиц (политик на
-- insert/update нет вовсе) — всё через SECURITY DEFINER RPC. Иначе это
-- была бы ровно та дыра, что уже ловили (см. память: client-write RLS hole).
--
-- НАГРАДЫ — единый jsonb для промокода и для вехи пути:
--   { "gc": 5000, "science": 200, "tnp": 50,
--     "res":      {"Железо": 100, "Кремний": 40},   -- склад
--     "coupons":  2,                                 -- универсальные осколки цикла
--     "shards":   {"corvette": 3, "ground": 2},      -- классовые осколки
--     "research": ["eng.basic"] }                    -- готовые узлы древа
-- «Корабли/корпус» выдаются ИМЕННО осколками, а не строками производства:
-- готовый корабль требует ДИЗАЙНА, которого у новичка ещё нет, а осколок
-- превращается в любой его будущий корвет мгновенно и бесплатно.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 0. ОБЩИЙ НАЧИСЛЯТЕЛЬ НАГРАД
--    Возвращает то, что РЕАЛЬНО начислено (для лога и для тоста игроку).
--    Ресурсы/осколки — опциональные колонки: если миграции нет, шаг тихо
--    пропускается, а не рушит всю выдачу.
-- ════════════════════════════════════════════════════════════
create or replace function public._reward_grant(p_fid text, p_reward jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r      jsonb := coalesce(p_reward, '{}'::jsonb);
  out_j  jsonb := '{}'::jsonb;
  v_gc   numeric := coalesce((r->>'gc')::numeric, 0);
  v_sci  numeric := coalesce((r->>'science')::numeric, 0);
  v_tnp  numeric := coalesce((r->>'tnp')::numeric, 0);
  v_cpn  int     := coalesce((r->>'coupons')::int, 0);
  k text; v numeric; n int;
begin
  if p_fid is null then return out_j; end if;

  -- ── Казна ──
  if v_gc <> 0 or v_sci <> 0 or v_tnp <> 0 then
    update public.faction_economy
       set gc      = coalesce(gc,0)      + v_gc,
           science = coalesce(science,0) + v_sci,
           tnp     = coalesce(tnp,0)     + v_tnp
     where faction_id = p_fid;
    if v_gc  <> 0 then out_j := out_j || jsonb_build_object('gc',  v_gc);  end if;
    if v_sci <> 0 then out_j := out_j || jsonb_build_object('science', v_sci); end if;
    if v_tnp <> 0 then out_j := out_j || jsonb_build_object('tnp', v_tnp); end if;
  end if;

  -- ── Склад ──
  if jsonb_typeof(r->'res') = 'object' then
    begin
      for k, v in select key, value::numeric from jsonb_each_text(r->'res') loop
        if v <> 0 then
          update public.faction_economy
             set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[k],
                   to_jsonb(greatest(0, coalesce((resources->>k)::numeric,0) + v)), true)
           where faction_id = p_fid;
        end if;
      end loop;
      out_j := out_j || jsonb_build_object('res', r->'res');
    exception when others then null;   -- нет колонки resources / кривое значение
    end;
  end if;

  -- ── Универсальные осколки цикла ──
  if v_cpn <> 0 then
    begin
      update public.faction_economy
         set build_coupons = greatest(0, coalesce(build_coupons,0) + v_cpn)
       where faction_id = p_fid;
      out_j := out_j || jsonb_build_object('coupons', v_cpn);
    exception when undefined_column then null;
    end;
  end if;

  -- ── Классовые осколки ──
  if jsonb_typeof(r->'shards') = 'object' then
    begin
      for k, n in select key, value::int from jsonb_each_text(r->'shards') loop
        if n <> 0 then
          update public.faction_economy
             set cycle_shards = jsonb_set(coalesce(cycle_shards,'{}'::jsonb), array[k],
                   to_jsonb(greatest(0, coalesce((cycle_shards->>k)::int,0) + n)), true)
           where faction_id = p_fid;
        end if;
      end loop;
      out_j := out_j || jsonb_build_object('shards', r->'shards');
    exception when others then null;
    end;
  end if;

  -- ── Готовые технологии (без дублей) ──
  if jsonb_typeof(r->'research') = 'array' and jsonb_array_length(r->'research') > 0 then
    begin
      update public.faction_economy fe
         set research = (
           select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
             from jsonb_array_elements(coalesce(fe.research,'[]'::jsonb) || (r->'research')) e)
       where fe.faction_id = p_fid;
      out_j := out_j || jsonb_build_object('research', r->'research');
    exception when others then null;
    end;
  end if;

  return out_j;
end$$;
revoke all on function public._reward_grant(text, jsonb) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- 1. ПРОМОКОДЫ
-- ════════════════════════════════════════════════════════════
create table if not exists public.promo_codes (
  code        text primary key,                    -- хранится в ВЕРХНЕМ регистре
  title       text not null default '',            -- как показать игроку («Стартовый набор»)
  note        text default '',                     -- служебная пометка (откуда код, для кого)
  reward      jsonb not null default '{}'::jsonb,  -- см. схему в шапке файла
  max_uses    int  not null default 0,             -- 0 = без лимита
  uses        int  not null default 0,             -- счётчик активаций
  per_faction int  not null default 1,             -- сколько раз одна держава может ввести
  starts_at   timestamptz,                         -- null = сразу
  ends_at     timestamptz,                         -- null = бессрочно
  max_age_days int,                                -- null = для всех; иначе держава младше N суток
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create table if not exists public.promo_redemptions (
  id         uuid primary key default gen_random_uuid(),
  code       text not null references public.promo_codes(code) on delete cascade,
  faction_id text not null,
  owner_id   uuid,
  granted    jsonb not null default '{}'::jsonb,   -- что реально начислено
  created_at timestamptz not null default now()
);
create index if not exists promo_red_code_idx on public.promo_redemptions(code);
create index if not exists promo_red_fid_idx  on public.promo_redemptions(faction_id);

alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;

-- Каталог кодов игроку НЕ виден (иначе можно вычитать чужие коды) — только стаффу.
drop policy if exists promo_codes_staff on public.promo_codes;
create policy promo_codes_staff on public.promo_codes for select to authenticated
  using (public.current_user_role() in ('superadmin','editor','moderator'));

-- Свои активации игрок видит (история «что я получил»).
drop policy if exists promo_red_own on public.promo_redemptions;
create policy promo_red_own on public.promo_redemptions for select to authenticated
  using (owner_id = auth.uid()
         or public.current_user_role() in ('superadmin','editor','moderator'));

revoke insert, update, delete on public.promo_codes,       public.promo_redemptions from anon, authenticated;
grant  select                 on public.promo_codes,       public.promo_redemptions to authenticated;

-- ── Погашение кода игроком ──────────────────────────────────
-- Все проверки на сервере; ошибки — человеческим текстом, клиент их показывает как есть.
create or replace function public.promo_redeem(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  fid    text;
  v_code text;
  pc     public.promo_codes;
  used   int;
  age_d  numeric;
  got    jsonb;
begin
  fid    := public._ec_my_fid();
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then raise exception 'Введите код'; end if;

  -- Блокируем строку: два одновременных ввода одного кода не должны пробить max_uses.
  -- (имя переменной НЕ совпадает с колонкой code — иначе 42702 ambiguous)
  select * into pc from public.promo_codes where promo_codes.code = v_code for update;
  if pc.code is null then raise exception 'Такого кода нет'; end if;
  if not pc.active  then raise exception 'Код больше не действует'; end if;
  if pc.starts_at is not null and now() < pc.starts_at then raise exception 'Код ещё не начал действовать'; end if;
  if pc.ends_at   is not null and now() > pc.ends_at   then raise exception 'Срок действия кода истёк'; end if;
  if pc.max_uses > 0 and pc.uses >= pc.max_uses        then raise exception 'Код исчерпан'; end if;

  select count(*) into used from public.promo_redemptions
   where promo_redemptions.code = pc.code and faction_id = fid;
  if used >= greatest(1, pc.per_faction) then raise exception 'Этот код уже применён вашей державой'; end if;

  if pc.max_age_days is not null then
    select extract(epoch from (now() - coalesce(created_at, now()))) / 86400.0
      into age_d from public.faction_economy where faction_id = fid;
    if coalesce(age_d, 0) > pc.max_age_days then
      raise exception 'Код только для молодых держав (младше % сут.)', pc.max_age_days;
    end if;
  end if;

  got := public._reward_grant(fid, pc.reward);

  insert into public.promo_redemptions(code, faction_id, owner_id, granted)
       values (pc.code, fid, auth.uid(), got);
  update public.promo_codes set uses = uses + 1 where promo_codes.code = pc.code;

  return jsonb_build_object('ok', true, 'code', pc.code, 'title', pc.title, 'granted', got);
end$$;
grant execute on function public.promo_redeem(text) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. «ПУТЬ СТАНОВЛЕНИЯ»
--    Каталог вех редактируется в админке; УСЛОВИЕ выбирается из закрытого
--    списка check_key (произвольный SQL из админки — это дыра), а порог,
--    текст, порядок и награда — свободные поля.
-- ════════════════════════════════════════════════════════════
create table if not exists public.starter_path (
  id        text primary key,
  ord       int  not null default 100,
  icon      text not null default '•',
  title     text not null default '',
  hint      text not null default '',       -- «что нажать» — ради этого всё и затевалось
  check_key text not null default 'gc',     -- см. список в path_check ниже
  threshold numeric not null default 1,
  reward    jsonb not null default '{}'::jsonb,
  active    boolean not null default true
);

create table if not exists public.starter_path_done (
  faction_id text not null,
  step_id    text not null,
  granted    jsonb not null default '{}'::jsonb,
  done_at    timestamptz not null default now(),
  primary key (faction_id, step_id)
);

alter table public.starter_path      enable row level security;
alter table public.starter_path_done enable row level security;

-- Каталог вех читают все (это обучающий список, скрывать нечего).
drop policy if exists sp_read on public.starter_path;
create policy sp_read on public.starter_path for select to authenticated using (true);

drop policy if exists spd_own on public.starter_path_done;
create policy spd_own on public.starter_path_done for select to authenticated
  using (exists (select 1 from public.faction_economy fe
                  where fe.faction_id = starter_path_done.faction_id and fe.owner_id = auth.uid())
         or public.current_user_role() in ('superadmin','editor','moderator'));

revoke insert, update, delete on public.starter_path, public.starter_path_done from anon, authenticated;
grant  select                 on public.starter_path, public.starter_path_done to authenticated;

-- ── Стартовый каталог (правится в админке; повторный накат не затирает правки) ──
insert into public.starter_path (id, ord, icon, title, hint, check_key, threshold, reward) values
  ('first_mine',   10, '⛏', 'Первая шахта',        'Кабинет → «Колонии» → в столице заложите добывающую отрасль. Сырьё — основа всего.',        'b_mining',      1, '{"gc":1500}'),
  ('first_factory',20, '🏭', 'Первый завод',        'Там же поставьте фабрику: она превращает сырьё в ГС или в товары народного потребления.',  'b_factory',     1, '{"gc":1500}'),
  ('first_science',30, '🔬', 'Дом науки',           'Постройте научный центр — без очков науки древо технологий стоит на месте.',              'b_science',     1, '{"gc":1500,"science":100}'),
  ('first_tech',   40, '🧪', 'Первая технология',   'Кабинет → «Технологии» → возьмите любой узел древа в работу и дождитесь конца.',           'research',      1, '{"gc":2000}'),
  ('first_trade',  50, '🚚', 'Первый караван',      'Кабинет → «Караваны» → снарядите маршрут: торговля даёт доход без войны.',                 'routes',        1, '{"gc":2500}'),
  ('first_colony', 60, '🪐', 'Вторая колония',      'Карта → выберите планету в своей системе → «Колонизировать».',                             'colonies',      2, '{"gc":3000,"coupons":1}'),
  ('first_design', 70, '📐', 'Свой корабль',        'Кабинет → «Конструктор» → соберите и опубликуйте первый дизайн корвета.',                  'units_designed',1, '{"gc":2000,"shards":{"corvette":2}}'),
  ('first_build',  80, '⚙', 'Первый корпус',       'Кабинет → «Вооружённые силы» → закажите постройку своего дизайна (или потратьте осколок).', 'units_built',   1, '{"gc":2500}'),
  ('first_fleet',  90, '🚀', 'Флот на карте',       'Соберите корабли во флот и выведите его на карту — так державы видят вашу силу.',          'fleets',        1, '{"gc":3000}'),
  ('first_battle',100, '⚔', 'Первое сражение',     'Клуб бойцов или война: проведите бой до конца. Дальше вы уже сами.',                       'battles',       1, '{"gc":5000,"coupons":2}')
on conflict (id) do nothing;

-- ── Настройки подсистемы (правятся в админке) ───────────────
-- ЗАЧЕМ. Без порога возраста ветеран при первом же заходе закрывает разом все
-- вехи и получает гору ГС из воздуха — путь задуман для новичков, а не как
-- ретро-выплата всей галактике. Держава старше N суток видит путь только
-- справочно (stale=true), награды не начисляются.
create table if not exists public.promo_settings (
  key   text primary key,
  value jsonb not null default '{}'::jsonb
);
insert into public.promo_settings(key, value)
  values ('path', '{"max_age_days": 30}'::jsonb)
  on conflict (key) do nothing;

alter table public.promo_settings enable row level security;
drop policy if exists ps_read on public.promo_settings;
create policy ps_read on public.promo_settings for select to authenticated using (true);
revoke insert, update, delete on public.promo_settings from anon, authenticated;
grant  select                 on public.promo_settings to authenticated;

create or replace function public.admin_promo_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._promo_staff();
  insert into public.promo_settings(key, value) values ('path', coalesce(p,'{}'::jsonb))
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end$$;
grant execute on function public.admin_promo_settings_save(jsonb) to authenticated;

-- ── Проверка и выдача вех ───────────────────────────────────
-- Best-effort как в ach_check: падение одной проверки не должно обнулять весь список.
create or replace function public.path_check()
returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
declare
  fid text;
  st  public.starter_path;
  prog numeric;
  vals jsonb := '{}'::jsonb;
  steps jsonb := '[]'::jsonb;
  new_ids jsonb := '[]'::jsonb;
  newly int := 0;
  got jsonb;
  d public.starter_path_done;
  v numeric;
  v_max_age numeric;
  v_age     numeric;
  v_stale   boolean := false;
begin
  fid := public._ec_my_fid();

  -- Порог возраста: старая держава путь не проходит (только смотрит).
  select coalesce((value->>'max_age_days')::numeric, 30) into v_max_age
    from public.promo_settings where key = 'path';
  select extract(epoch from (now() - coalesce(created_at, now()))) / 86400.0 into v_age
    from public.faction_economy where faction_id = fid;
  v_stale := coalesce(v_max_age, 30) > 0 and coalesce(v_age, 0) > coalesce(v_max_age, 30);

  -- ── Один проход по всем счётчикам (дешевле, чем считать на каждой вехе) ──
  begin
    select coalesce(jsonb_array_length(coalesce(research,'[]'::jsonb)),0) into v
      from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('research', coalesce(v,0));
    select coalesce(gc,0) into v from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('gc', coalesce(v,0));
    select coalesce(science,0) into v from public.faction_economy where faction_id = fid;
    vals := vals || jsonb_build_object('science', coalesce(v,0));
  exception when others then null; end;

  begin
    select count(*) into v from public.colonies where faction_id = fid;
    vals := vals || jsonb_build_object('colonies', coalesce(v,0));
    select count(*) into v from public.colony_buildings where faction_id = fid;
    vals := vals || jsonb_build_object('buildings', coalesce(v,0));
    select count(*) into v from public.colony_buildings where faction_id = fid and btype = 'mining';
    vals := vals || jsonb_build_object('b_mining', coalesce(v,0));
    select count(*) into v from public.colony_buildings where faction_id = fid and btype = 'factory';
    vals := vals || jsonb_build_object('b_factory', coalesce(v,0));
    select count(*) into v from public.colony_buildings where faction_id = fid and btype = 'science';
    vals := vals || jsonb_build_object('b_science', coalesce(v,0));
    select count(*) into v from public.colony_buildings where faction_id = fid and btype = 'shipyard';
    vals := vals || jsonb_build_object('b_shipyard', coalesce(v,0));
    select count(distinct system_id) into v from public.colonies where faction_id = fid;
    vals := vals || jsonb_build_object('systems', coalesce(v,0));
  exception when others then null; end;

  begin
    select count(*) into v from public.faction_units where faction_id = fid;
    vals := vals || jsonb_build_object('units_designed', coalesce(v,0));
  exception when others then null; end;

  begin
    select coalesce(sum(qty),0) into v from public.unit_production
      where faction_id = fid and status = 'done';
    vals := vals || jsonb_build_object('units_built', coalesce(v,0));
  exception when others then null; end;

  -- Опциональные подсистемы: считаем только если таблица есть в этом окружении.
  if to_regclass('public.trade_routes') is not null then
    begin
      -- у маршрута две стороны (a_fid/b_fid) — свой считаем с любой
      execute 'select count(*) from public.trade_routes where (a_fid = $1 or b_fid = $1) and status = ''active''' into v using fid;
      vals := vals || jsonb_build_object('routes', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.fleets') is not null then
    begin
      execute 'select count(*) from public.fleets where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('fleets', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.battles') is not null then
    begin
      execute 'select count(*) from public.battles where (attacker_fid = $1 or defender_fid = $1)' into v using fid;
      vals := vals || jsonb_build_object('battles', coalesce(v,0));
    exception when others then null; end;
  end if;
  if to_regclass('public.spy_agents') is not null then
    begin
      execute 'select count(*) from public.spy_agents where faction_id = $1' into v using fid;
      vals := vals || jsonb_build_object('agents', coalesce(v,0));
    exception when others then null; end;
  end if;

  -- ── Выдача ──
  for st in select * from public.starter_path where active order by ord, id loop
    prog := coalesce((vals->>st.check_key)::numeric, 0);
    select * into d from public.starter_path_done
      where faction_id = fid and step_id = st.id;

    if d.step_id is null and prog >= st.threshold and not v_stale then
      got := public._reward_grant(fid, st.reward);
      insert into public.starter_path_done(faction_id, step_id, granted)
           values (fid, st.id, got)
        on conflict do nothing;
      if found then
        newly   := newly + 1;
        new_ids := new_ids || to_jsonb(st.id);
      end if;
      select * into d from public.starter_path_done where faction_id = fid and step_id = st.id;
    end if;

    steps := steps || jsonb_build_array(jsonb_build_object(
      'id', st.id, 'ord', st.ord, 'icon', st.icon, 'title', st.title, 'hint', st.hint,
      'check_key', st.check_key, 'threshold', st.threshold, 'reward', st.reward,
      'progress', prog, 'done', (d.step_id is not null), 'done_at', d.done_at));
  end loop;

  select coalesce(gc,0) into v from public.faction_economy where faction_id = fid;
  return jsonb_build_object('steps', steps, 'newly', newly, 'new_ids', new_ids,
                            'gc', coalesce(v,0), 'stale', v_stale,
                            'age_days', round(coalesce(v_age,0), 1), 'max_age_days', v_max_age);
end$$;
grant execute on function public.path_check() to authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. АДМИНКА
-- ════════════════════════════════════════════════════════════
create or replace function public._promo_staff()
returns void language plpgsql stable security definer set search_path=public as $$
begin
  if public.current_user_role() not in ('superadmin','editor') then
    raise exception 'forbidden: staff only';
  end if;
end$$;

create or replace function public.admin_promo_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare out_j jsonb;
begin
  perform public._promo_staff();
  select jsonb_build_object(
    'codes', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.promo_codes c), '[]'::jsonb),
    'path',  coalesce((select jsonb_agg(to_jsonb(s) order by s.ord, s.id) from public.starter_path s), '[]'::jsonb),
    'settings', coalesce((select value from public.promo_settings where key = 'path'), '{"max_age_days":30}'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                         from (select * from public.promo_redemptions order by created_at desc limit 50) r), '[]'::jsonb)
  ) into out_j;
  return out_j;
end$$;
grant execute on function public.admin_promo_list() to authenticated;

-- Сохранение кода. p ждёт поля таблицы; code нормализуется в верхний регистр.
create or replace function public.admin_promo_save(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c text;
begin
  perform public._promo_staff();
  c := upper(btrim(coalesce(p->>'code','')));
  if c = '' then raise exception 'Пустой код'; end if;
  if c !~ '^[A-Z0-9_-]{3,32}$' then
    raise exception 'Код: 3-32 символа, латиница/цифры/дефис/подчёркивание';
  end if;

  insert into public.promo_codes as t
    (code, title, note, reward, max_uses, per_faction, starts_at, ends_at, max_age_days, active, created_by)
  values (c,
          coalesce(p->>'title',''), coalesce(p->>'note',''),
          coalesce(p->'reward','{}'::jsonb),
          coalesce((p->>'max_uses')::int, 0),
          greatest(1, coalesce((p->>'per_faction')::int, 1)),
          nullif(p->>'starts_at','')::timestamptz,
          nullif(p->>'ends_at','')::timestamptz,
          nullif(p->>'max_age_days','')::int,
          coalesce((p->>'active')::boolean, true),
          auth.uid())
  on conflict (code) do update set
    title = excluded.title, note = excluded.note, reward = excluded.reward,
    max_uses = excluded.max_uses, per_faction = excluded.per_faction,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    max_age_days = excluded.max_age_days, active = excluded.active;

  return jsonb_build_object('ok', true, 'code', c);
end$$;
grant execute on function public.admin_promo_save(jsonb) to authenticated;

create or replace function public.admin_promo_delete(p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._promo_staff();
  delete from public.promo_codes where code = upper(btrim(p_code));
  return jsonb_build_object('ok', true);
end$$;
grant execute on function public.admin_promo_delete(text) to authenticated;

create or replace function public.admin_path_save(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i text;
begin
  perform public._promo_staff();
  i := btrim(coalesce(p->>'id',''));
  if i = '' then raise exception 'Пустой id вехи'; end if;

  insert into public.starter_path as t (id, ord, icon, title, hint, check_key, threshold, reward, active)
  values (i,
          coalesce((p->>'ord')::int, 100), coalesce(p->>'icon','•'),
          coalesce(p->>'title',''), coalesce(p->>'hint',''),
          coalesce(p->>'check_key','gc'),
          coalesce((p->>'threshold')::numeric, 1),
          coalesce(p->'reward','{}'::jsonb),
          coalesce((p->>'active')::boolean, true))
  on conflict (id) do update set
    ord = excluded.ord, icon = excluded.icon, title = excluded.title, hint = excluded.hint,
    check_key = excluded.check_key, threshold = excluded.threshold,
    reward = excluded.reward, active = excluded.active;

  return jsonb_build_object('ok', true, 'id', i);
end$$;
grant execute on function public.admin_path_save(jsonb) to authenticated;

create or replace function public.admin_path_delete(p_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public._promo_staff();
  delete from public.starter_path      where id = btrim(p_id);
  delete from public.starter_path_done where step_id = btrim(p_id);
  return jsonb_build_object('ok', true);
end$$;
grant execute on function public.admin_path_delete(text) to authenticated;
