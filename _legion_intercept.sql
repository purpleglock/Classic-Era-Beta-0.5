-- ════════════════════════════════════════════════════════════
-- 18.08 ПЕРЕХВАТ НА ПОДЛЁТЕ + КРЫСИНЫЕ ТРОПЫ
-- ────────────────────────────────────────────────────────────
-- Жалоба: «две сигнатуры абсолютно неуязвимы, не реагируют на мои флоты и
-- свободно гуляют по территории». Так и было: контакт Легиона — не флот, а
-- строка legion_contacts, которую карта рисует по маршруту. Взять её было не
-- за что нигде, кроме конечной точки, и то лишь в один миг приземления.
--
-- ЗАМЫСЕЛ. Возвращаем игроку ход, но не отдаём пиратов на убой:
--   • КРЫСИНЫЕ ТРОПЫ. Легион идёт задворками и выходит в обжитое
--     пространство только на ПОСЛЕДНИХ ДВУХ ПРЫЖКАХ перед целью. Всё, что
--     раньше, — тропа: там ватаги на трассе просто нет, ловить некого.
--     Это и есть защита от фарма: караулить весь маршрут нельзя, только
--     ближние подступы, и надо угадать, какие именно.
--   • ЗАСАДА. На узле выхода стоит чужой боевой флот — ватага выходит из
--     пустоты ТАМ, а не у цели. Регистрировать засаду не надо: флот в узле
--     и есть засада. Налёт при этом срывается — цель спасена ценой боя.
--   • ЦЕНА ЗНАНИЯ. Узлы выхода показываем только на ступени 'resolved' —
--     той самой, за которую платят полным экипажем recon-заставы. Вот зачем
--     нужны вскрытая цель и ETA: без них ты не знаешь, где вставать.
--
-- ЦЕПОЧКА: после _legion_contacts.sql, _legion_engage.sql, _legion_standoff.sql,
-- _legion_battle_ai.sql, _legion_raid_cycle.sql, _legion_spoils_cron.sql.
-- Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── 1. Куда легла засада ────────────────────────────────────
-- Перехваченный контакт переезжает целиком: target_sys становится узлом боя,
-- чтобы вся дальнейшая машинерия (standoff, spoils, losses) работала там, где
-- реально стоит ватага. Исходную цель храним отдельно — она нужна сводкам.
alter table public.legion_contacts add column if not exists orig_sys text;
alter table public.legion_contacts add column if not exists waylaid boolean not null default false;

-- ── 2. Тропа или обжитое пространство ───────────────────────
-- Диапазон индексов узлов маршрута, на которых ватагу МОЖНО встретить:
-- [n-3 .. n-2] при 0-базовой нумерации, то есть два прыжка перед целью.
-- Узел 0 (логово) исключён всегда: у порога Легиона засад не ставят.
-- Сам узел n-1 — это уже цель, там работает старая проверка прикрытия.
create or replace function public._legion_road_lo(p_n int)
returns int language sql immutable as $$ select greatest(1, coalesce(p_n,0) - 3) $$;
create or replace function public._legion_road_hi(p_n int)
returns int language sql immutable as $$ select coalesce(p_n,0) - 2 $$;

-- ── 3. ЗАСАДА ───────────────────────────────────────────────
-- Раз в тик смотрим узлы, пройденные за последние 6 минут (тик — 5): каждый
-- узел проверяется ровно один раз, пропустить проход нельзя, а поймать контакт
-- в узле, который он миновал час назад, — нельзя тем более.
create or replace function public.legion_intercept_tick()
returns jsonb language plpgsql security definer set search_path=public as $$
declare k record; foe record; i int; n int; node text; t timestamptz;
        comp jsonb; fid_new uuid; b uuid; nm_node text; nm_dst text; n_amb int := 0;
begin
  for k in select * from public.legion_contacts
            where state = 'inbound' and fleet_id is null
              and route is not null and jsonb_array_length(route) >= 3 loop
    n := jsonb_array_length(k.route);

    for i in public._legion_road_lo(n) .. public._legion_road_hi(n) loop
      t := (k.route_at->>i)::timestamptz;
      if t is null or t > now() or t <= now() - interval '6 minutes' then continue; end if;
      node := k.route->>i;
      if node is null then continue; end if;

      -- флот в узле и есть засада: регистрировать её отдельной кнопкой не надо
      select f.* into foe from public.fleets f
       where f.system_id = node
         and f.status = 'idle'
         and f.faction_id is distinct from public._legion_fid()
         and coalesce(jsonb_array_length(f.composition),0) > 0
       order by (select coalesce(sum((c->>'qty')::int),0)
                   from jsonb_array_elements(f.composition) c) desc
       limit 1;
      if foe.id is null then continue; end if;

      comp := public._legion_compose(k.strength);
      if jsonb_array_length(comp) = 0 then continue; end if;

      insert into public.fleets(faction_id, name, status, system_id, home_sys, composition)
        values (public._legion_fid(),
                case when k.reprisal then 'Карательный отряд Легиона'
                     else 'Ватага Легиона' end,
                'idle', node, node, comp)
        returning id into fid_new;

      nm_node := coalesce((select ms.name from public.map_systems ms where ms.id = node), node);
      nm_dst  := coalesce((select ms.name from public.map_systems ms where ms.id = k.target_sys),
                          k.target_sys);

      update public.legion_contacts
         set state = 'engaged', fleet_id = fid_new, waylaid = true,
             orig_sys = coalesce(orig_sys, target_sys), target_sys = node
       where id = k.id;

      b := public._war_engage(fid_new, foe.id, node, 'intercept');
      if b is not null then
        begin
          perform public.legion_battle_deploy(b);
        exception when others then null; end;
      end if;

      perform public._legion_news(foe.faction_id, '🛑 Перехват: ватага вышла из пустоты',
        format('Ваш флот в системе «%s» стоял ровно на той тропе, которой Легион выходил к «%s». Ватага вскрылась здесь: %s корпусов. Налёт сорван — но драться придётся сейчас.',
               nm_node, nm_dst,
               (select coalesce(sum((c->>'qty')::int),0) from jsonb_array_elements(comp) c)));
      if k.target_fid is not null and k.target_fid is distinct from foe.faction_id then
        perform public._legion_news(k.target_fid, 'Налёт сорван на подходе',
          format('Отряд Железного Легиона, шедший к системе «%s», перехвачен на подступах — в системе «%s». До вас он не дошёл.',
                 nm_dst, nm_node));
      end if;
      perform public._legion_feed('🛑 Пиратов перехватили на трассе',
        format('Ватага Железного Легиона вскрыта в системе «%s» — её ждали на выходе с крысиных троп.', nm_node));

      n_amb := n_amb + 1;
      exit;  -- контакт перехвачен, дальше по его маршруту смотреть нечего
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'ambushed', n_amb);
end$$;
revoke all on function public.legion_intercept_tick() from public;

-- ── 4. КАРТОЧКА УГРОЗЫ ЗНАЕТ, ГДЕ ВСТАВАТЬ ──────────────────
-- Добавлено ровно одно поле — 'road': узлы выхода с крысиных троп со временем
-- прохода. Только на 'resolved' и только пока контакт летит: вскрытая цель и
-- ETA наконец получают применение, а не остаются справкой ради справки.
create or replace function public.legion_contacts_visible()
returns jsonb language plpgsql security definer as $$
declare fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row order by row->>'eta' nulls last)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id',     g.contact_id,
        'grade',  g.grade,
        'sector', sec.name,
        'since',  g.first_seen,
        'seen',   g.last_seen,
        'stood',  (k.state = 'engaged'),
        'waylaid', case when k.waylaid then true end,
        'looted',  case when k.state = 'engaged' and coalesce(k.looted,0) > 0
                        then round(k.looted)::bigint end,
        'next_at', case when k.state = 'engaged' and k.pressed_at is not null
                        then k.pressed_at + interval '1 hour' end,
        'sys',    case when public._legion_grade_rank(g.grade) >= 2 or k.state = 'engaged'
                       then coalesce(k.target_sys, g.last_sys) end,
        'sys_name', case when public._legion_grade_rank(g.grade) >= 2 or k.state = 'engaged'
                         then coalesce(mt.name, ms.name, g.last_sys) end,
        'eta',    case when public._legion_grade_rank(g.grade) >= 2 then k.arrive_at end,
        'band',   case when public._legion_grade_rank(g.grade) >= 2 then
                    case when k.strength >= 45 then 'крупная'
                         when k.strength >= 20 then 'заметная'
                         else 'слабая' end end,
        'target_sys', case when g.grade = 'resolved' or k.state = 'engaged' then k.target_sys end,
        'target_name',case when g.grade = 'resolved' or k.state = 'engaged'
                           then coalesce(mt.name, k.target_sys) end,
        'mine',       case when g.grade = 'resolved' or k.state = 'engaged'
                           then (k.target_fid = fid) end,
        'kind',       case when g.grade = 'resolved' or k.state = 'engaged' then k.kind end,
        'reprisal',   case when (g.grade = 'resolved' or k.state = 'engaged') and k.reprisal then true end,
        'ships',      case when g.grade = 'resolved' or k.state = 'engaged'
                           then greatest(1, round(k.strength / 8.0))::int end,
        'road',   case when g.grade = 'resolved' and k.state = 'inbound'
                            and k.route is not null
                            and jsonb_array_length(k.route) >= 3
                       then (select jsonb_agg(jsonb_build_object(
                                      'sys',  k.route->>i,
                                      'name', coalesce(mr.name, k.route->>i),
                                      'at',   k.route_at->>i) order by i)
                               from generate_series(
                                      public._legion_road_lo(jsonb_array_length(k.route)),
                                      public._legion_road_hi(jsonb_array_length(k.route))) i
                               left join public.map_systems mr on mr.id = k.route->>i
                              where (k.route_at->>i)::timestamptz > now()) end
      )) as row
      from public.legion_sightings g
      join public.legion_contacts k on k.id = g.contact_id
      left join public.map_sectors  sec on sec.id = g.last_sector
      left join public.map_systems  ms  on ms.id  = g.last_sys
      left join public.map_systems  mt  on mt.id  = k.target_sys
      where g.faction_id = fid
        and (k.state = 'inbound'
             or (k.state = 'engaged' and k.target_fid = fid))
    ) q
  ), '[]'::jsonb);
end $$;

-- ── 5. ТИК ──────────────────────────────────────────────────
-- Засада проверяется ПЕРВОЙ, до приземления: контакт, встреченный на подступах,
-- не должен в этом же тике «долететь» и ограбить цель.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('legion-engage-tick')
      where exists (select 1 from cron.job where jobname = 'legion-engage-tick');
    perform cron.schedule('legion-engage-tick', '2-59/5 * * * *',
      $c$select public.legion_losses_sweep();
         select public.legion_intercept_tick();
         select public.legion_engage_tick();
         select public.legion_standoff_tick();
         select public.legion_spoils_tick();
         select public.legion_contacts_notify();$c$);
  end if;
end$$;
