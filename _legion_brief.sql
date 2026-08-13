-- ════════════════════════════════════════════════════════════
-- ЛЕГИОН, ШАГ 6: СВОДКА ДЛЯ КАБИНЕТА («⚔ Война» → «☠ Легион»)
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _legion_faction.sql, _legion_contacts.sql, _legion_tick.sql,
-- _legion_engage.sql. Идемпотентно, ничего не пересоздаёт из прежних шагов.
--
-- ЗАМЫСЕЛ. legion_state() — админская кухня и наружу закрыта: копилка давления
-- по секторам это внутренние весы ИИ, показав их, мы превратим пиратов в
-- расписание. Игроку нужна не копилка, а ответ на три вопроса:
--   1. КТО ИДЁТ СЕЙЧАС      → contacts (та же дверь legion_contacts_visible)
--   2. ЗА ЧТО НАС НАВЕЩАЮТ  → aggro: наше собственное аггро и его причина
--                             (ради этого _legion_aggro_add и хранит reason)
--   3. КУДА УДАРЯТ СЛЕДУЮЩИЙ РАЗ → targets: формула выбора цели, прогнанная
--                             ТОЛЬКО по нашим системам
--
-- ⚠ ГЛАВНОЕ ПРАВИЛО ЭТОГО СРЕЗА: наружу уходит лишь то, что игрок и так может
-- сосчитать сам по своему добру, плюс то, что с ним уже случилось. Ни чужих
-- колоний, ни чужой обороны, ни давления сектора здесь нет. Поэтому «вероятные
-- ходы» — это ЧЕСТНЫЙ вывод из своей же обороны (value ÷ guard), а не подсмотр
-- в чужой карман: игрок видит, что его окраинная колония лежит плохо, и может
-- это исправить — ровно то влияние на выбор цели, ради которого оборона и
-- стоит в знаменателе (_legion_tick.sql, шаг 2).
-- ════════════════════════════════════════════════════════════

-- ── 1. ВЕРОЯТНЫЕ ХОДЫ ПО НАШИМ СИСТЕМАМ ─────────────────────
-- Зеркало _legion_targets, но с жёстким `fid = мой`: та же ценность, та же
-- оборона, тот же множитель аггро. Считаем именно так, а не «на глазок», чтобы
-- в кабинете и в тике Легиона была ОДНА арифметика: расхождение здесь читалось
-- бы игроком как враньё интерфейса.
create or replace function public._legion_my_targets(p_fid text)
returns table(sys text, kind text, value numeric, guard numeric, score numeric)
language plpgsql stable security definer set search_path=public as $$
declare k numeric;
begin
  -- множитель аггро — тот же, что в _legion_targets: до ×2
  select 1.0 + least(1.0, coalesce((select a.aggro from public.legion_aggro a
                                     where a.faction_id = p_fid), 0)
                          / (public._legion_const('aggro_bite') * 2))
    into k;

  return query
  with cand as (
    -- УДАР: колонии
    select c.system_id sid, 'strike'::text kd,
           1.0 + coalesce(c.pop,0)/500.0
               + coalesce((select least(150,e.prosperity) from public.system_econ e
                            where e.system_id = c.system_id),0)/100.0 val
      from public.colonies c where c.faction_id = p_fid
    union all
    -- ОСЛЕПЛЕНИЕ: наши глаза и заправка
    select o.system_id, 'blind',
           case o.mode when 'recon' then 3.0 when 'depot' then 2.6 else 1.2 end
      from public.outposts o
     where o.faction_id = p_fid and public._outpost_crew_k(o.crew, o.mode) >= 0.5
    union all
    -- ЩУПАЛЬЦА: концы наших караванных трасс
    select r.origin_sys, 'probe', 1.0 + least(4.0, coalesce(r.volume,0)/200.0)
      from public.trade_routes r where r.status = 'active' and r.a_fid = p_fid
    union all
    select r.dest_sys, 'probe', 1.0 + least(4.0, coalesce(r.volume,0)/200.0)
      from public.trade_routes r where r.status = 'active' and r.b_fid = p_fid
  ), agg as (
    -- ценность системы складывается по замыслам, но замысел показываем самый
    -- дорогой из найденных: он и определяет, чем сюда придут
    select cd.sid, sum(cd.val) val,
           (array_agg(cd.kd order by case cd.kd when 'strike' then 3
                                                when 'blind'  then 2 else 1 end desc))[1] kd
      from cand cd where cd.sid is not null group by cd.sid
  )
  select a.sid, a.kd, round(a.val,2), round(g.gv,2), round(a.val / g.gv * k, 3)
    from agg a cross join lateral (select public._legion_sys_guard(a.sid) gv) g
   order by 5 desc;
end$$;
revoke all on function public._legion_my_targets(text) from public;

-- ── 2. СВОДКА ───────────────────────────────────────────────
create or replace function public.legion_brief()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare fid text; res jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('fid', null); end if;

  select jsonb_build_object(
    'fid',  fid,
    'meta', public._legion_meta(),

    -- ЗА ЧТО: наше аггро и последняя причина. Число сырое — игрок должен
    -- видеть, что оно тает (полураспад ~7 суток), иначе «злость» пиратов
    -- выглядит вечной меткой.
    'aggro', (select jsonb_build_object(
                'v', round(a.aggro,2),
                'bite', public._legion_const('aggro_bite'),
                'reason', a.last_reason,
                'at', a.last_provoke)
                from public.legion_aggro a where a.faction_id = fid),

    -- КТО ИДЁТ: единственная дверь наружу по контактам, повторно не сеем
    'contacts', public.legion_contacts_visible(),

    -- ГЛАЗА: чем именно куплена ступень осведомлённости. Ровно те пороги, по
    -- которым работает _legion_grade: полный экипаж recon → 'resolved'.
    'eyes', (select jsonb_build_object(
               'recon_full', count(*) filter (where o.mode='recon' and public._outpost_crew_k(o.crew,o.mode) >= 1.0),
               'recon_weak', count(*) filter (where o.mode='recon' and public._outpost_crew_k(o.crew,o.mode) <  1.0),
               'depot',      count(*) filter (where o.mode='depot'))
               from public.outposts o where o.faction_id = fid),

    -- УЖЕ В ГОСТЯХ: материализованные ватаги, стоящие в наших системах.
    -- Показываем только те, что в системе с нашей колонией или заставой —
    -- то есть там, где мы физически не можем их не заметить.
    'here', coalesce((select jsonb_agg(jsonb_build_object(
              'fleet', f.id, 'sys', f.system_id,
              'ships', (select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                          from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)))
              from public.fleets f
             where f.faction_id = public._legion_fid()
               and (exists (select 1 from public.colonies c where c.system_id = f.system_id and c.faction_id = fid)
                 or exists (select 1 from public.outposts o where o.system_id = f.system_id and o.faction_id = fid))
            ), '[]'::jsonb),

    -- ВЕРОЯТНЫЕ ХОДЫ: наши системы, отсортированные той же формулой, что в тике
    -- Отдаём верхушку, а не весь реестр: у крупной державы это 300+ систем, а
    -- смысл среза — «куда придут», то есть первые строки. Хвост списка это
    -- просто «здесь Легиону нечего ловить», и его незачем возить на клиент.
    'targets', coalesce((select jsonb_agg(jsonb_build_object(
                 'sys', q.sys, 'name', coalesce(ms.name, q.sys),
                 'sector', sec.name,
                 'kind', q.kind, 'value', q.value, 'guard', q.guard, 'score', q.score)
                 order by q.score desc)
                 from (select * from public._legion_my_targets(fid)
                        order by score desc limit 40) q
                 left join public.map_systems ms on ms.id = q.sys
                 left join public.map_sectors sec on q.sys = any(sec.system_ids)
               ), '[]'::jsonb),
    -- сколько всего наших систем вообще попало в поле зрения формулы —
    -- иначе «40 целей» читалось бы как «у нас всего 40 систем»
    'targets_total', (select count(*) from public._legion_my_targets(fid)),

    -- ЧТО БЫЛО: налёты по нам за 30 суток. Это наша собственная память —
    -- по каждому такому контакту нам уже приходила депеша.
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', h.kind, 'sys', h.target_sys,
                 'name', coalesce(hms.name, h.target_sys),
                 'at', h.arrive_at, 'state', h.state)
                 order by h.arrive_at desc)
                 from (select * from public.legion_contacts c
                        where c.target_fid = fid and c.state <> 'inbound'
                          and c.arrive_at > now() - interval '30 days'
                        order by c.arrive_at desc limit 40) h
                 left join public.map_systems hms on hms.id = h.target_sys
               ), '[]'::jsonb)
  ) into res;

  return res;
end$$;
revoke all on function public.legion_brief() from public;
grant execute on function public.legion_brief() to authenticated;
