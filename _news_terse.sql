-- ════════════════════════════════════════════════════════════
-- СВОДКИ: ОДИН ВЫСТРЕЛ — ОДНА СТРОКА (без стихов и дублей)
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _doom_shells.sql и _legion_lair.sql. Идемпотентно.
--
-- ЧТО БЫЛО НЕ ТАК. Один залп Гиперпейсера по логову давал ТРИ сводки в общую
-- ленту: «СНАРЯД ИДЁТ НА ЛОГОВО» (из _legion_salvo_launch_grudge), «ЗАЛП
-- ГИПЕРПЕЙСЕРА ВЫПУЩЕН» (из mza_fire) и «ЖЕЛЕЗНЫЙ ЛЕГИОН ПРИНЯЛ ВЫЗОВ» (из
-- _legion_provoke) — три раза одно и то же событие, разными словами. Причём
-- сообщение о САМОМ ВЫСТРЕЛЕ выходило последним: _doom_news звался ПОСЛЕ
-- insert в doom_salvos, а на этом insert висит триггер Легиона, который успевал
-- отписаться первым. Читатель ленты видел ответ пиратов раньше, чем выстрел.
-- Плюс тексты были написаны иносказаниями и цитатами («ни птица, ни ива слезы
-- не прольёт») — из них нельзя вычитать ни кто стрелял, ни куда, ни когда.
--
-- ЧТО СТАЛО.
--   1) mza_fire постит сводку ДО вставки залпа — выстрел всегда первый.
--   2) Одно событие — одна сводка: для залпа общую ленту ведёт только
--      выстреливший (mza_fire) и, если это логово, ОДНА строка ответа Легиона.
--      Ветка «ПРИНЯЛ ВЫЗОВ» в _legion_provoke больше не срабатывает на залпы.
--   3) Текст = факты: кто, откуда, куда, за сколько часов, что теперь будет.
--      Никаких цитат.
-- ════════════════════════════════════════════════════════════

-- ── 1. ПРОВОКАЦИЯ: личная депеша коротко, общая лента — не для залпов ──
create or replace function public._legion_provoke(
  p_fid text, p_sys text, p_kind text, p_weight numeric,
  p_reason text, p_src uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare gid uuid; sname text; fname text; sec uuid;
begin
  if p_fid is null or p_fid = public._legion_fid() or coalesce(p_weight,0) <= 0 then
    return null;
  end if;
  if p_src is not null and exists (select 1 from public.legion_grudges
                                    where src_id = p_src and kind = coalesce(p_kind,'other')) then
    return null;
  end if;

  sec := case when p_sys is null then null else public._legion_sector_of(p_sys) end;
  insert into public.legion_grudges(faction_id, sys, sector_id, kind, weight, reason, src_id)
    values (p_fid, p_sys, sec, coalesce(p_kind,'other'), p_weight, p_reason, p_src)
    returning id into gid;

  perform public._legion_aggro_add(p_fid, p_weight, p_reason);

  select name into sname from public.map_systems where id = p_sys;
  select name into fname from public.faction_applications
    where faction_id = p_fid and status = 'approved' order by updated_at desc limit 1;

  -- личная депеша жертве: за что записали и чем это кончится
  perform public._legion_news(p_fid, '☠ Легион записал обиду',
    format('%s. Ответ — карательный отряд.',
           coalesce(p_reason, 'Ваши действия задели интересы Легиона')));

  -- В ОБЩУЮ ЛЕНТУ — только заметная наглость И только не залп: про залп уже
  -- отписались mza_fire (сам выстрел) и ветка логова (ответ). Третья строка о
  -- том же событии — дубль.
  if p_weight >= 6 and coalesce(p_kind,'other') not in ('salvo_launch','salvo_hit') then
    perform public._legion_feed('☠ Железный Легион собирает отряд',
      format('Против кого: %s%s. Причина: %s.',
        coalesce(fname, 'неизвестная держава'),
        case when sname is not null then ', система «' || sname || '»' else '' end,
        coalesce(p_reason, 'нападение на интересы Легиона')));
  end if;
  return gid;
end$$;
revoke all on function public._legion_provoke(text,text,text,numeric,text,uuid) from public;

-- ── 2. ЗАЛП ПО ЛОГОВУ: одна строка ответа, с подлётным временем ──
create or replace function public._legion_salvo_launch_grudge(p_salvo uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare s public.doom_salvos; w numeric; iv numeric; sname text; fname text; gid uuid; eta numeric;
begin
  select * into s from public.doom_salvos where id = p_salvo;
  if not found or s.faction_id is null then return 0; end if;
  if not public._legion_is_lair(s.target_system_id) then return 0; end if;

  iv := public._legion_interest(s.target_system_id, now());
  w  := iv * 0.5 * case when coalesce(s.kind,'doom') = 'doom' then 2.0 else 1.0 end;
  select name into sname from public.map_systems where id = s.target_system_id;
  select name into fname from public.faction_applications
    where faction_id = s.faction_id and status = 'approved' order by updated_at desc limit 1;
  eta := greatest(0, extract(epoch from (s.ready_at - now())) / 3600.0);

  gid := public._legion_provoke(
    s.faction_id, s.target_system_id, 'salvo_launch', round(w,2),
    format('залп по «%s» в системе «%s» — это верфи Легиона',
           coalesce(s.target_planet,'планете'), coalesce(sname, s.target_system_id)),
    s.id);
  if gid is null then return 0; end if;

  -- логово — единственный случай, когда Легион отвечает ДО удара: подлётное
  -- время и есть его фора. Ровно одна строка, факты по порядку.
  perform public._legion_feed('☠ Легион поднимает флот в ответ на залп',
    format('Цель залпа — «%s» в системе «%s», верфи Железного Легиона. Стреляла держава: %s. До попадания ~%s ч, но карательный отряд выходит сейчас — ждать воронки Легион не будет.',
      coalesce(s.target_planet,'планета'),
      coalesce(sname, s.target_system_id),
      coalesce(fname, 'неизвестная'),
      to_char(eta,'FM990.0')));
  return round(w,2);
end$$;
revoke all on function public._legion_salvo_launch_grudge(uuid) from public;

-- ── 3. ЗАЛП: сводка ДО вставки, текст = факты ───────────────
-- ⚠ ГЕЙТ ПРАВ: public.mza_fire — ОБЁРТКА (_fm_gates, право 'strike'), тело
-- живёт в mza_fire__raw. Перезаливаем тело как mza_fire и в конце файла
-- вешаем обёртку заново — иначе залп смог бы дать участник без права.
drop function if exists public.mza_fire(uuid, text, int, text);
drop function if exists public.mza_fire__raw(uuid, text, int, text);
drop function if exists public.mza_fire(uuid, text, int, text, text);
drop function if exists public.mza_fire__raw(uuid, text, int, text, text);
create or replace function public.mza_fire(p_id uuid, p_target_system_id text,
                                           p_target_pid int, p_target_name text default null,
                                           p_kind text default 'doom')
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; sh public.mza_ships; tgt public.map_systems; pl jsonb; rdy timestamptz;
  fly_h numeric; ptname text; fname text; newint numeric; hops int; max_hops int; bp jsonb;
  fromname text; shname text;
begin
  fid := public._ec_my_fid();
  perform public._mza_settle(fid);
  if not public._shell_kind_ok(p_kind) then raise exception 'bad shell kind'; end if;
  bp := public._ball_params(p_kind);   -- null для 'doom'
  select * into sh from public.mza_ships where id=p_id;
  if not found then raise exception 'MZA not found'; end if;
  if sh.faction_id is distinct from fid then raise exception 'not your MZA'; end if;
  if sh.status <> 'idle' or sh.system_id is null then raise exception 'MZA must be idle in a system to fire'; end if;
  if sh.integrity <= 0 then raise exception 'MZA is wrecked'; end if;
  if exists(select 1 from public.doom_salvos where mza_id = sh.id and status='in_flight') then
    raise exception 'salvo already in flight';
  end if;

  select * into tgt from public.map_systems where id = p_target_system_id;
  if not found then raise exception 'target system not found'; end if;

  max_hops := public._shell_const('mza_range_hops')::int
            * case when coalesce((bp->>'long_range')::boolean, false)
                   then public._shell_const('heavy_range_mul')::int else 1 end;
  if p_target_system_id <> sh.system_id then
    hops := public._mza_hops(sh.system_id, p_target_system_id, max_hops);
    if hops is null then
      raise exception 'target out of range: дальность залпа — % прыжков по гиперпутям', max_hops;
    end if;
  end if;

  if p_target_pid is not null then
    select value into pl from jsonb_array_elements(coalesce(tgt.planets,'[]'::jsonb))
      where (value->>'pid')::int = p_target_pid limit 1;
  end if;
  if pl is null then
    select coalesce(planet_name,'планета') into ptname from public.colonies
      where system_id = p_target_system_id
        and ((p_target_pid is not null and planet_pid = p_target_pid)
             or (p_target_name is not null and planet_name = p_target_name))
      order by (planet_pid is not null) desc limit 1;
    if ptname is null then raise exception 'target planet not found'; end if;
  else
    if coalesce((pl->>'dead')::boolean, false) then raise exception 'planet already dead'; end if;
    ptname := coalesce(pl->>'name','планета');
  end if;

  -- боекомплект: построенный снаряд выбранного типа
  perform public._shell_take(fid, p_kind);

  newint := greatest(0, sh.integrity - public._mza_const('shot_wear'));
  update public.mza_ships set integrity = newint, total_shots = total_shots + 1 where id = sh.id;

  fly_h := coalesce(public._mza_dist_hours(sh.system_id, p_target_system_id,
                      public._mza_const('salvo_h_min'), public._mza_const('salvo_h_max')),
                    public._mza_const('salvo_h_min'))
         * coalesce((bp->>'fly_mul')::numeric, 1.0);   -- лёгкая ×0.5, тяжёлая ×1.4
  rdy := now() + (round(fly_h*60)::int || ' minutes')::interval;

  select name into fname from public.faction_applications where faction_id=fid and status='approved' order by updated_at desc limit 1;
  select name into fromname from public.map_systems where id = sh.system_id;
  shname := case p_kind
              when 'doom' then 'снаряд Длани Неотвратимости'
              when 'ball_light' then 'лёгкий баллистический снаряд'
              when 'ball_emp' then 'снаряд-«Фантом» (планетарная ПРО его не видит)'
              when 'ball_cluster' then 'кассетный баллистический снаряд'
              else 'тяжёлый баллистический снаряд' end;

  -- ⚠ СВОДКА ДО INSERT: на вставке залпа висит триггер Легиона со своей
  -- сводкой. Постим после — и в ленте ответ пиратов стоит раньше выстрела.
  perform public._doom_news(
    case when p_kind = 'doom' then '☄ Залп Гиперпейсера: «' || ptname || '»'
         else '💥 Баллистический залп: «' || ptname || '»' end,
    format('Кто: %s. Откуда: система «%s». Куда: планета «%s», система «%s». Чем: %s. Подлёт: ~%s ч.',
      coalesce(fname,'неизвестная держава'),
      coalesce(fromname, sh.system_id),
      ptname,
      coalesce(tgt.name,'???'),
      shname,
      to_char(fly_h,'FM990.0')));

  insert into public.doom_salvos
    (gun_id, mza_id, faction_id, owner_id, origin_system_id, target_system_id, target_pid, target_planet, ready_at, kind)
  values
    (null, sh.id, fid, auth.uid(), sh.system_id, p_target_system_id, p_target_pid, ptname, rdy, p_kind);

  return jsonb_build_object('ok', true, 'kind', p_kind, 'ready_at', rdy, 'target', ptname,
                            'flight_h', round(fly_h,1), 'integrity', newint);
end$$;
revoke all on function public.mza_fire(uuid,text,int,text,text) from public;
grant execute on function public.mza_fire(uuid,text,int,text,text) to authenticated;

do $gate$
begin
  if to_regprocedure('public._fm_wrap(text,text,text,text)') is null then
    raise notice 'fm_wrap отсутствует — _fm_gates.sql не накачен, гейт пропущен';
    return;
  end if;
  perform public._fm_wrap('mza_fire', 'strike', null, null);
end$gate$;

notify pgrst, 'reload schema';

-- ── 4. ПРИЛЁТ: сводки без стихов (тело из _doom_shells.sql) ──
create or replace function public._doom_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare s record; tgt public.map_systems; arr jsonb; el jsonb; newpl jsonb; i int;
  victim_fid text; victim_name text; col public.colonies;
  v_icept text; bp jsonb; pop0 numeric; frac numeric; dead_pop numeric; dice int; killed int; bnames text;
begin
  for s in select * from public.doom_salvos
           where faction_id = p_fid and status='in_flight' and ready_at <= now()
  loop
    -- ⛨ ПЕРЕХВАТ: Ожерелье Немезиды (вся система) → планетарная ПРО
    v_icept := public._doom_intercept(s.target_system_id, s.target_pid, coalesce(s.kind,'doom'));
    if v_icept is not null then
      update public.doom_salvos set status='intercepted', resolved_at=now() where id = s.id;
      perform public._doom_news('⛨ Залп перехвачен: «'||coalesce(s.target_planet,'???')||'»',
        case when v_icept = 'nemesis'
          then 'Снаряд, шедший на планету «'||coalesce(s.target_planet,'???')||
               '», сбит Ожерельем Немезиды. Ожерелье прикрывает всю систему и работает без ограничений по числу залпов.'
          else 'Снаряд, шедший на планету «'||coalesce(s.target_planet,'???')||
               '», сбит планетарной ПРО. Потерь нет, израсходована одна противоракета.' end);
      continue;
    end if;

    bp := public._ball_params(coalesce(s.kind,'doom'));
    if bp is not null then
      -- 💥 БАЛЛИСТИКА: планета живёт; урон по паспорту тира
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        pop0 := coalesce(col.pop, coalesce(col.cells,6)*50);
        frac := (bp->>'pmin')::numeric + random() * ((bp->>'pmax')::numeric - (bp->>'pmin')::numeric);
        dead_pop := round(pop0 * frac);
        update public.colonies set pop = greatest(1, pop0 - dead_pop) where id = col.id;
        -- постройки: равновероятный дайс bmin..bmax (у тяжёлой bmin=bmax=5 — гарантия)
        dice := (bp->>'bmin')::int + floor(random() * ((bp->>'bmax')::int - (bp->>'bmin')::int + 1))::int;
        killed := 0; bnames := null;
        if dice > 0 then
          with victims as (
            select id, btype from public.colony_buildings
              where colony_id = col.id order by random() limit dice
          ), gone as (
            delete from public.colony_buildings cb using victims v where cb.id = v.id returning v.btype
          )
          select string_agg(coalesce(nullif(btype,''),'постройка'), ', '), count(*)
            into bnames, killed from gone;
        end if;
        select name into victim_name from public.faction_applications
          where faction_id = col.faction_id and status='approved' order by updated_at desc limit 1;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
        perform public._doom_news(
          '💥 Баллистический удар: «'||coalesce(s.target_planet,'???')||'»',
          'Баллистический снаряд достиг планеты «'||coalesce(s.target_planet,'???')||'»'||
          case when victim_name is not null then ' державы «'||victim_name||'»' else '' end||
          '. Погибло ~'||to_char(dead_pop,'FM999999990')||' жителей ('||to_char(round(frac*100),'FM990')||'% населения). '||
          case when coalesce(killed,0) > 0
               then 'Разрушено построек: '||killed||' ('||coalesce(bnames,'')||').'
               else 'Постройки уцелели.' end);
      else
        perform public._doom_news(
          '💥 Баллистический удар: попадание в пустую планету',
          'Снаряд лёг на «'||coalesce(s.target_planet,'???')||'». Колонии на планете нет — потерь и разрушений нет.');
      end if;
      update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
      continue;
    end if;

    -- ☠ СНАРЯД ДЛАНИ: планета → мёртвый камень (как раньше)
    select * into tgt from public.map_systems where id = s.target_system_id;
    if found then
      arr := coalesce(tgt.planets, '[]'::jsonb);
      newpl := '[]'::jsonb;
      for i in 0 .. jsonb_array_length(arr)-1 loop
        el := arr->i;
        if (el->>'pid')::int = s.target_pid then
          el := el
            || jsonb_build_object(
                 'g','lava', 'kind','planet', 'type','Мёртвая планета',
                 'icon','🪨', 'slotsP', 0, 'slotsK', 0,
                 'resources','[]'::jsonb, 'dead', true, 'doomed', true,
                 'doomed_by', p_fid, 'doomed_at', to_jsonb(now()));
        end if;
        newpl := newpl || jsonb_build_array(el);
      end loop;
      update public.map_systems set planets = newpl where id = tgt.id;

      if to_regclass('public.system_minefields') is not null then
        delete from public.system_minefields
          where system_id = s.target_system_id
            and ((s.target_pid is not null and planet_pid = s.target_pid)
                 or (s.target_pid is null and planet_pid is null));
      end if;

      victim_fid := null; victim_name := null;
      select * into col from public.colonies
        where system_id = s.target_system_id
          and ((s.target_pid is not null and planet_pid = s.target_pid)
               or (s.target_pid is null and s.target_planet is not null and planet_name = s.target_planet))
        order by (planet_pid is not null) desc limit 1;
      if found then
        victim_fid := col.faction_id;
        select name into victim_name from public.faction_applications
          where faction_id = victim_fid and status='approved' order by updated_at desc limit 1;
        delete from public.colonies where id = col.id;
        update public.doom_salvos set victim_fid = col.faction_id where id = s.id;
      end if;

      perform public._doom_news(
        '☠ Планета уничтожена: «'||coalesce(s.target_planet,'???')||'»',
        'Снаряд Длани Неотвратимости попал в планету «'||coalesce(s.target_planet,'???')||
        '», система «'||coalesce(tgt.name,'???')||'». Планета выжжена и больше непригодна для жизни.'||
        case when victim_name is not null then ' Колония державы «'||victim_name||'» уничтожена.' else '' end);
    end if;

    update public.doom_salvos set status='done', resolved_at=now() where id = s.id;
  end loop;
end$$;
revoke all on function public._doom_resolve(text) from public;
