-- ============================================================
-- СОВЕТ ДЕРЖАВЫ: персонаж на должности что-то значит
-- Применять: node tools/db_run.js _char_office.sql
-- Порядок: ПОСЛЕ _faction_members.sql, _fm_gates.sql, _fm_one_state.sql
--
-- Было: уровень персонажа считался КАЛЕНДАРЁМ (дни с play_start), статы
-- раздавались на регистрации и не читались больше нигде. Держава про
-- персонажа знала только имя в карточке состава.
--
-- Стало три сцепки:
--   1. Пост читает стат. Роль в составе (_fm_role_perms) = должность в
--      совете; у должности есть профильная характеристика, её модификатор
--      (stat-10)/2 идёт слагаемым в _faction_mods — то есть в доход, добычу,
--      цену стройки, науку. Территориальные посты умножаются на охват
--      зоны ответственности: не закрепил систем — бонуса нет.
--   2. Уровень зарабатывается должностью. XP капает в _fm_gate — точке,
--      через которую и так проходит КАЖДОЕ действие служащего. Календарь
--      как источник уровня отменён, старым персонажам опыт начислен по
--      прежней формуле, чтобы никто не обнулился.
--   3. Уровень тратится в статы (ch_spend), 1 очко за уровень. Потолок 20.
--
-- Владелец державы = глава государства: его персонаж занимает ВСЕ вакантные
-- посты вполсилы. Нет персонажа — совет просто пуст, всё как раньше.
-- ============================================================

-- ── Хранилище опыта ─────────────────────────────────────────
alter table public.characters add column if not exists xp bigint not null default 0;

-- Дневной счётчик: потолок против фарма пустыми кликами.
create table if not exists public.char_xp_day (
  slug text not null,
  d    date not null default current_date,
  xp   int  not null default 0,
  primary key (slug, d)
);
alter table public.char_xp_day enable row level security;
revoke all on public.char_xp_day from anon, authenticated;

-- ── Уровень из опыта ────────────────────────────────────────
-- 20-й уровень ≈ 7600 опыта ≈ полторы тысячи содержательных действий.
create or replace function public._ch_lvl(p_xp bigint)
returns int language sql immutable as $$
  select least(20, greatest(1, 1 + floor(sqrt(greatest(p_xp,0) / 20.0))::int))
$$;

-- Разово переводим календарный уровень в опыт, чтобы старые персонажи
-- не откатились на первый. Эталон прежней формулы — 2014 год = 20.
do $$
declare ref_days numeric := greatest(1, (current_date - '2014-01-01'::date));
begin
  update public.characters c
     set xp = (20 * power(greatest(0, least(20, round(
                 (greatest(0,
                    coalesce(case when c.status in ('dead','retired') then c.play_end end, current_date)
                    - c.play_start) / ref_days) * 20))::int - 1), 2))::bigint
   where c.xp = 0 and c.play_start is not null;
end$$;

-- ── Статы: вложенные очки и модификатор ─────────────────────
-- Итоговый стат = стартовый (stats) + вложенные уровнями (extra->'spent').
create or replace function public._ch_stat(p_ch public.characters, p_key text)
returns int language sql stable as $$
  select least(20, coalesce((p_ch.stats ->> p_key)::int, 10)
                 + coalesce((p_ch.extra -> 'spent' ->> p_key)::int, 0))
$$;

create or replace function public._ch_mod(p_val int)
returns numeric language sql immutable as $$ select floor((coalesce(p_val,10) - 10) / 2.0) $$;

-- Очков всего = уровень − 1, по одному за уровень.
create or replace function public._ch_points(p_ch public.characters)
returns int language sql stable as $$
  select greatest(0, public._ch_lvl(p_ch.xp) - 1
    - coalesce((select sum(v::int) from jsonb_each_text(coalesce(p_ch.extra->'spent','{}'::jsonb)) t(k,v)), 0))
$$;

-- ── Персонаж на службе ──────────────────────────────────────
-- Для служащего — тот, кем он подавал прошение; для владельца и на случай
-- потерянной ссылки — его действующий персонаж.
create or replace function public._ch_of_user(p_uid uuid, p_slug text default null)
returns public.characters language sql stable security definer set search_path=public as $$
  select c.* from public.characters c
   where c.owner_id = p_uid and coalesce(c.status,'active') = 'active'
     and (p_slug is null or c.slug = p_slug)
   order by (c.slug is not distinct from p_slug) desc, c.play_start desc nulls last
   limit 1
$$;

-- ============================================================
-- ДОЛЖНОСТИ СОВЕТА
--   stat — профильная характеристика, terr — считать ли охват зоны,
--   mods — что даёт ОДИН пункт модификатора характеристики.
--   Знак как в _faction_mods: build/research/colonize/claim_* — ЦЕНА,
--   у них выгода отрицательная.
-- ============================================================
create or replace function public._fm_post_def(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'governor'      then '{"stat":"wis","terr":true, "title":"Наместник",      "mods":{"gc":0.02,"build":-0.015}}'
    when 'treasurer'     then '{"stat":"cha","terr":false,"title":"Казначей",       "mods":{"gc":0.03,"claim_cost":-0.01}}'
    when 'industrialist' then '{"stat":"int","terr":true, "title":"Промышленник",   "mods":{"mine":0.02,"build":-0.02}}'
    when 'scientist'     then '{"stat":"int","terr":false,"title":"Учёный совет",   "mods":{"research":-0.025,"sci_flat":0.5}}'
    when 'spymaster'     then '{"stat":"wis","terr":false,"title":"Глава разведки", "mods":{"agents_flat":0.5}}'
    when 'diplomat'      then '{"stat":"cha","terr":false,"title":"Дипломат",       "mods":{"claim_cost":-0.02,"claim_cd":-0.02}}'
    when 'admiral'       then '{"stat":"dex","terr":true, "title":"Адмирал",        "mods":{"colonize":-0.015}}'
    when 'marshal'       then '{"stat":"str","terr":true, "title":"Маршал",         "mods":{"claim_cd":-0.015}}'
    when 'coruler'       then '{"stat":"cha","terr":false,"title":"Соправитель",    "mods":{"gc":0.02,"research":-0.01}}'
    else null end::jsonb
$$;

-- Охват зоны ответственности: доля систем державы, закреплённых за членом.
create or replace function public._fm_coverage(p_fid text, p_all boolean, p_scope jsonb)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare tot int; mine int;
begin
  if coalesce(p_all, false) then return 1; end if;
  select count(distinct c.system_id) into tot
    from public.colonies c where c.faction_id = p_fid;
  if coalesce(tot,0) = 0 then return 1; end if;   -- территории нет — пост «при дворе»
  select count(distinct c.system_id) into mine
    from public.colonies c
    join jsonb_array_elements_text(coalesce(p_scope->'systems','[]'::jsonb)) v on v = c.system_id
   where c.faction_id = p_fid;
  return least(1, coalesce(mine,0)::numeric / tot);
end$$;

-- ── Совет державы: кто на каком посту и что это даёт ────────
-- Возвращает {posts:[…], mods:{…}} — mods в тех же ключах, что _faction_mods,
-- но ДЕЛЬТАМИ (нулём, если совет пуст).
create or replace function public._fm_council(p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; ch public.characters; def jsonb; st int; md numeric; cov numeric; w numeric;
  posts jsonb := '[]'::jsonb; acc jsonb := '{}'::jsonb; kk text; vv numeric; k text;
  taken text[] := '{}'; own_uid uuid; head public.characters;
  roles text[] := array['governor','treasurer','industrialist','scientist',
                        'spymaster','diplomat','admiral','marshal'];
begin
  -- 1. Действующие служащие: один пост в одни руки, при дубле — старший по опыту.
  for r in
    select m.id, m.user_id, m.role, m.char_slug, m.scope_all, m.scope
      from public.faction_members m
      left join public.characters c on c.slug = m.char_slug
     where m.faction_id = p_fid and m.status = 'active'
     order by m.role, coalesce(c.xp, 0) desc, m.created_at asc
  loop
    def := public._fm_post_def(r.role);
    if def is null or r.role = any(taken) then continue; end if;
    ch := public._ch_of_user(r.user_id, r.char_slug);
    if ch.slug is null then continue; end if;
    taken := taken || r.role;

    st  := public._ch_stat(ch, def->>'stat');
    md  := public._ch_mod(st);
    cov := case when (def->>'terr')::boolean
                then public._fm_coverage(p_fid, r.scope_all, r.scope) else 1 end;
    w   := md * cov;

    for kk, vv in select key, value::numeric from jsonb_each_text(def->'mods') loop
      acc := jsonb_set(acc, array[kk], to_jsonb(coalesce((acc->>kk)::numeric,0) + vv * w), true);
    end loop;

    posts := posts || jsonb_build_object(
      'role', r.role, 'title', def->>'title', 'head', false,
      'char_slug', ch.slug, 'char_name', ch.name, 'char_class', ch.class,
      'stat', def->>'stat', 'stat_val', st, 'mod', md,
      'lvl', public._ch_lvl(ch.xp), 'xp', ch.xp,
      'coverage', round(cov, 2),
      'mods', (select jsonb_object_agg(key, round((value::numeric) * w, 4))
                 from jsonb_each_text(def->'mods')));
  end loop;

  -- 2. Глава государства закрывает вакансии вполсилы.
  select a.owner_id into own_uid from public.faction_applications a
   where a.faction_id = p_fid and a.status = 'approved' order by a.updated_at desc limit 1;
  if own_uid is not null then
    head := public._ch_of_user(own_uid);
    if head.slug is not null then
      foreach k in array roles loop
        if k = any(taken) then continue; end if;
        def := public._fm_post_def(k);
        st  := public._ch_stat(head, def->>'stat');
        md  := public._ch_mod(st);
        w   := md * 0.5;
        posts := posts || jsonb_build_object(
          'role', k, 'title', def->>'title', 'head', true,
          'char_slug', head.slug, 'char_name', head.name, 'char_class', head.class,
          'stat', def->>'stat', 'stat_val', st, 'mod', md,
          'lvl', public._ch_lvl(head.xp), 'xp', head.xp, 'coverage', 1,
          'mods', (select jsonb_object_agg(key, round((value::numeric) * w, 4))
                     from jsonb_each_text(def->'mods')));
        for kk, vv in select key, value::numeric from jsonb_each_text(def->'mods') loop
          acc := jsonb_set(acc, array[kk], to_jsonb(coalesce((acc->>kk)::numeric,0) + vv * w), true);
        end loop;
      end loop;
    end if;
  end if;

  -- 3. Потолки: совет — приправа, а не вторая доктрина.
  return jsonb_build_object('posts', posts, 'mods', jsonb_strip_nulls(jsonb_build_object(
    'gc',          greatest(-0.30, least(0.30, coalesce((acc->>'gc')::numeric, 0))),
    'mine',        greatest(-0.30, least(0.30, coalesce((acc->>'mine')::numeric, 0))),
    'build',       greatest(-0.25, least(0.25, coalesce((acc->>'build')::numeric, 0))),
    'research',    greatest(-0.25, least(0.25, coalesce((acc->>'research')::numeric, 0))),
    'colonize',    greatest(-0.25, least(0.25, coalesce((acc->>'colonize')::numeric, 0))),
    'claim_cost',  greatest(-0.25, least(0.25, coalesce((acc->>'claim_cost')::numeric, 0))),
    'claim_cd',    greatest(-0.25, least(0.25, coalesce((acc->>'claim_cd')::numeric, 0))),
    'sci_flat',    greatest(-4, least(4, round(coalesce((acc->>'sci_flat')::numeric, 0))))::int,
    'agents_flat', greatest(-4, least(4, round(coalesce((acc->>'agents_flat')::numeric, 0))))::int
  )));
end$$;

-- Только модификаторы — то, что подмешивается в _faction_mods.
create or replace function public._fm_council_mods(p_fid text)
returns jsonb language sql stable security definer set search_path=public as $$
  select public._fm_council(p_fid) -> 'mods'
$$;

-- ── Врезка в общий множитель державы ────────────────────────
-- _faction_mods перекатывать целиком нельзя (живое тело новее файлов), поэтому
-- слагаемое совета вшивается в тело дампом, рядом с блоком КУРСА.
do $patch$
declare src text; args text; newsrc text;
begin
  select p.prosrc, pg_get_function_identity_arguments(p.oid) into src, args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='_faction_mods' limit 1;
  if src is null then raise notice 'council: _faction_mods нет — пропуск'; return; end if;
  if src like '%_fm_council_mods%' then raise notice 'council: врезка уже стоит'; return; end if;
  if position('return jsonb_build_object(' in src) = 0 then
    raise exception 'council: не нашёл хвост _faction_mods — врезать некуда';
  end if;

  newsrc := replace(src, 'return jsonb_build_object(', $ins$
  -- СОВЕТ ДЕРЖАВЫ (_char_office.sql): персонажи на должностях.
  begin
    pol := public._fm_council_mods(p_fid);
    gc   := gc   + coalesce((pol->>'gc')::numeric, 0);
    mine := mine + coalesce((pol->>'mine')::numeric, 0);
    bld  := bld  + coalesce((pol->>'build')::numeric, 0);
    rsch := rsch + coalesce((pol->>'research')::numeric, 0);
    col  := col  + coalesce((pol->>'colonize')::numeric, 0);
    cc   := cc   + coalesce((pol->>'claim_cost')::numeric, 0);
    cd   := cd   + coalesce((pol->>'claim_cd')::numeric, 0);
    scf  := scf  + coalesce((pol->>'sci_flat')::int, 0);
    agf  := agf  + coalesce((pol->>'agents_flat')::int, 0);
  exception when others then null;
  end;

  return jsonb_build_object($ins$);

  execute format('create or replace function public._faction_mods(%s) returns jsonb'
              || ' language plpgsql stable security definer set search_path=public as %L',
                 args, newsrc);
  raise notice 'council: врезка в _faction_mods поставлена';
end$patch$;

-- ============================================================
-- ОПЫТ: капает в гейте прав
-- ============================================================
create or replace function public._ch_xp_for(p_code text)
returns int language sql immutable as $$
  select case p_code
    when 'war' then 15 when 'colonize' then 12 when 'strike' then 10
    when 'diplo' then 8 when 'spy' then 8 when 'research' then 8
    when 'battle' then 6 when 'faith' then 6 when 'defense' then 5
    when 'design' then 5 when 'fleet' then 4 when 'army' then 4
    when 'treasury' then 4 when 'corp' then 4 when 'trade' then 3
    when 'build' then 3 when 'produce' then 2 when 'market' then 1
    when 'news' then 1 else 2 end
$$;

-- Начисление: молча, с дневным потолком. Любая ошибка (в т.ч. вызов из
-- STABLE-контекста, где запись запрещена) — не повод ронять действие игрока.
create or replace function public._ch_gain(p_uid uuid, p_slug text, p_code text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare ch public.characters; amt int; day_xp int; cap int := 150;
begin
  ch := public._ch_of_user(p_uid, p_slug);
  if ch.slug is null then return; end if;
  amt := public._ch_xp_for(p_code);

  insert into public.char_xp_day(slug, d, xp) values (ch.slug, current_date, 0)
    on conflict (slug, d) do nothing;
  select xp into day_xp from public.char_xp_day where slug = ch.slug and d = current_date;
  amt := least(amt, greatest(0, cap - coalesce(day_xp, 0)));
  if amt <= 0 then return; end if;

  update public.char_xp_day set xp = xp + amt where slug = ch.slug and d = current_date;
  update public.characters set xp = coalesce(xp,0) + amt, updated_at = now() where slug = ch.slug;
exception when others then null;
end$$;

-- ── ГЛАВНЫЙ ГЕЙТ + опыт ─────────────────────────────────────
-- Тело один в один с _faction_members.sql, добавлено только начисление
-- опыта персонажу — и владельцу державы, и служащему.
create or replace function public._fm_gate(p_code text, p_kind text default null, p_ref text default null)
returns void language plpgsql volatile security definer set search_path=public as $$
declare m public.faction_members; sys text; perms text[];
begin
  if auth.uid() is null then return; end if;
  begin
    if exists (select 1 from public.user_roles where user_id = auth.uid()
                 and coalesce(role,'') in ('superadmin','editor')) then return; end if;
  exception when others then null; end;

  if public._fm_own_fid() is not null then            -- сам себе держава
    perform public._ch_gain(auth.uid(), null, p_code);
    return;
  end if;

  m := public._fm_my_row();
  if m.id is null then return; end if;   -- не участник: пусть решает старая проверка fid

  perms := public._fm_my_perms();
  if not (p_code = any(perms)) then
    raise exception 'forbidden: нет права «%» в державе (роль: %)',
      p_code, public._fm_role_title(m.role) using errcode = '42501';
  end if;

  -- Привязка к объекту: колонию/постройку сводим к системе.
  sys := p_ref;
  if p_kind = 'colony' then
    select c.system_id into sys from public.colonies c where c.id = p_ref::uuid;
    p_kind := 'sys';
  elsif p_kind = 'bld' then
    select c.system_id into sys from public.colony_buildings b
      join public.colonies c on c.id = b.colony_id where b.id = p_ref::uuid;
    p_kind := 'sys';
  end if;

  if sys is not null and not public._fm_in_scope(m, p_kind, sys) then
    raise exception 'forbidden: объект вне вашей зоны ответственности'
      using errcode = '42501';
  end if;

  perform public._ch_gain(auth.uid(), m.char_slug, p_code);
end$$;

-- ============================================================
-- RPC ДЛЯ КЛИЕНТА
-- ============================================================
-- Мой персонаж как должностное лицо: уровень, нераспределённые очки, пост.
create or replace function public.ch_office()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare m public.faction_members; own text; ch public.characters; fid text;
begin
  if auth.uid() is null then return jsonb_build_object('anon', true); end if;
  own := public._fm_own_fid();
  m   := public._fm_my_row();
  fid := coalesce(own, m.faction_id);
  ch  := public._ch_of_user(auth.uid(), m.char_slug);
  if ch.slug is null then return jsonb_build_object('character', null, 'faction_id', fid); end if;
  return jsonb_build_object(
    'faction_id', fid,
    'is_head', own is not null,
    'role', case when own is not null then 'head' else m.role end,
    'character', jsonb_build_object(
      'slug', ch.slug, 'name', ch.name, 'class', ch.class, 'status', ch.status,
      'xp', ch.xp, 'lvl', public._ch_lvl(ch.xp),
      'next_xp', 20 * power(public._ch_lvl(ch.xp), 2)::bigint,
      'points', public._ch_points(ch),
      'stats', (select jsonb_object_agg(k, public._ch_stat(ch, k))
                  from unnest(array['str','dex','con','int','wis','cha']) k),
      'spent', coalesce(ch.extra->'spent', '{}'::jsonb),
      'today_xp', coalesce((select x.xp from public.char_xp_day x
                             where x.slug = ch.slug and x.d = current_date), 0)),
    'council', case when fid is null then null else public._fm_council(fid) end);
end$$;

-- Вложить очко уровня в характеристику.
create or replace function public.ch_spend(p_stat text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ch public.characters; m public.faction_members; cur int;
begin
  if auth.uid() is null then raise exception 'не авторизован'; end if;
  if p_stat not in ('str','dex','con','int','wis','cha') then raise exception 'нет такой характеристики'; end if;
  m  := public._fm_my_row();
  ch := public._ch_of_user(auth.uid(), m.char_slug);
  if ch.slug is null then raise exception 'нет действующего персонажа'; end if;
  if public._ch_points(ch) <= 0 then raise exception 'нет свободных очков: они даются за уровень'; end if;
  cur := public._ch_stat(ch, p_stat);
  if cur >= 20 then raise exception 'характеристика уже на потолке (20)'; end if;

  update public.characters
     set extra = jsonb_set(coalesce(extra,'{}'::jsonb), array['spent', p_stat],
                   to_jsonb(coalesce((extra->'spent'->>p_stat)::int, 0) + 1), true),
         updated_at = now()
   where slug = ch.slug;
  return public.ch_office();
end$$;

-- Совет чужой/своей державы — для «Двора» и витрин.
create or replace function public.fm_council(p_fid text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text;
begin
  fid := coalesce(nullif(p_fid,''), public._fm_own_fid(), public._fm_member_fid());
  if fid is null then return jsonb_build_object('posts','[]'::jsonb,'mods','{}'::jsonb); end if;
  return public._fm_council(fid);
end$$;

grant execute on function public.ch_office()          to authenticated;
grant execute on function public.ch_spend(text)       to authenticated;
grant execute on function public.fm_council(text)     to authenticated, anon;
revoke all on function public._ch_gain(uuid, text, text) from public, anon, authenticated;
