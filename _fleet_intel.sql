-- ════════════════════════════════════════════════════════════════════════
-- _fleet_intel.sql — ВИДИМОСТЬ ФЛОТОВ И СТЕЛС ГИПЕРКРЕЙСЕРА
-- ════════════════════════════════════════════════════════════════════════
-- Применять ПОСЛЕ: _army_fleet.sql, _fleet_ops.sql, _mza.sql,
--                  _interstellar_artillery.sql, _economy_setup.sql.
-- Связано: [[army-fleet]], [[mza-mobile-doomgun]], [[passive-intel]].
--
-- Правила, заданные дизайном (ОБНОВЛЕНО 2026-06-30: чужой флот больше НЕ виден
-- «из вакуума» — его надо ОБНАРУЖИТЬ):
--   • ЧУЖОЙ ФЛОТ виден на карте, только если наблюдатель его ОБНАРУЖИЛ:
--       (а) ЛОКАЛЬНЫЕ СЕНСОРЫ — флот стоит/входит в систему наблюдателя или
--           соседнюю с ней (колонии + аванпосты + их соседи по гиперпутям), ИЛИ
--       (б) РАЗВЕДКА фракции-владельца (basic+ recon / пассивная связь) — тогда
--           её флоты видны везде.
--     Необнаруженный флот в карту НЕ попадает (ни позиция, ни движение).
--   • ЧИСЛЕННОСТЬ/СОСТАВ виден только при РАЗВЕДКЕ владельца; локальный сенсор
--     даёт лишь «есть флот» → клиент рисует «⚓?».
--   • ГИПЕРКРЕЙСЕР (mza_ships) НЕ виден никому — ни с разведкой, ни без,
--     пока не ВЫСТРЕЛИТ: после залпа он подсвечивается в своей системе,
--     пока не сменит позицию (уйдёт в transit / в другую систему). Плюс его
--     можно вскрыть спецоперацией «подпространственная охота»
--     (см. _spy_fleet_ops.sql — пишет в mza_reveals).
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. Схема: торможение флота диверсией + журнал вскрытий гиперкрейсера ──
alter table public.fleets    add column if not exists stalled_until timestamptz;  -- диверсия: нельзя двигать до этого времени
alter table public.mza_ships add column if not exists revealed_until timestamptz; -- вскрыт охотой: виден чужим до этого времени

-- журнал «кто кого вскрыл охотой» — раскрытие персональное (видит только охотник)
create table if not exists public.mza_reveals (
  id            uuid primary key default gen_random_uuid(),
  mza_id        uuid not null references public.mza_ships(id) on delete cascade,
  hunter_fid    text not null,                 -- кто вскрыл (видит цель)
  revealed_until timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists mza_reveals_hunter_idx on public.mza_reveals(hunter_fid);
create index if not exists mza_reveals_mza_idx     on public.mza_reveals(mza_id);
alter table public.mza_reveals enable row level security;
drop policy if exists "mzarev_sel" on public.mza_reveals;
create policy "mzarev_sel" on public.mza_reveals for select to public using (true);

-- ── 1. Известен ли наблюдателю состав чужого флота ──
-- Своё — всегда. Чужое — если есть успешная разведка (basic/deep) или пассивная
-- развед-связь (торг.путь/отношения/союз — _spy_intel это не покрывает, поэтому
-- допускаем basic+ recon как порог; пассив добавим, если появится отдельный флаг).
-- ВНИМАНИЕ: НЕ опираемся на _spy_intel — там баг агрегата по пустому набору
-- (bool_or над 0 строк = NULL → case ... else 'basic' → 'basic' ДЛЯ ВСЕХ без
-- единой миссии). Проверяем наличие реальной успешной разведки НАПРЯМУЮ.
create or replace function public._fleet_intel_known(p_viewer text, p_owner text)
returns boolean language sql stable as $$
  select p_viewer = p_owner
      or exists (
        select 1 from public.spy_missions
        where actor_fid = p_viewer and target_fid = p_owner
          and outcome = 'success' and op in ('recon_basic', 'recon_deep'));
$$;

-- ── 1b. Сенсорное покрытие наблюдателя ──
-- Системы, которые наблюдатель «видит» локально: где у него есть колония или
-- аванпост, плюс системы, соседние с ними по гиперпутям (map_hyperlanes). Чужой
-- флот в одной из этих систем (или входящий в неё) считается обнаруженным.
drop function if exists public._fleet_coverage(text);
create or replace function public._fleet_coverage(p_viewer text)
returns table(sid text) language sql stable as $$
  with mine as (
    select c.system_id::text as sid from public.colonies c where c.faction_id = p_viewer
    union
    select o.system_id::text as sid from public.outposts o where o.faction_id = p_viewer
  )
  select sid from mine
  union
  select hl.b_id::text from public.map_hyperlanes hl join mine m on m.sid = hl.a_id::text
  union
  select hl.a_id::text from public.map_hyperlanes hl join mine m on m.sid = hl.b_id::text
$$;

-- ── 2. fleets_visible — ОБНАРУЖЕННЫЕ флоты на карте для текущего игрока ──
-- Свои — всегда. Чужие — только если обнаружены: разведкой владельца (видны
-- везде) или локальным сенсором (флот в системе наблюдателя/соседней, либо
-- входит в неё — for transit смотрим from_sys/dest_sys). mine — мой ли;
-- intel — известен ли состав; ships/composition обнуляются без разведки.
create or replace function public.fleets_visible()
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer text;
begin
  viewer := public._ec_my_fid();
  -- лениво «досаживаем» прибывшие транзиты для всех держав, чтобы позиции были свежими
  perform public._fleet_settle(fl.faction_id) from (select distinct faction_id from public.fleets) fl;
  return (
    with cov as (select sid from public._fleet_coverage(viewer))
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',          f.id,
        'faction_id',  f.faction_id,
        'faction_name',public._fac_name(f.faction_id),
        'name',        case when f.faction_id = viewer then f.name else null end,
        'status',      f.status,
        'system_id',   f.system_id,
        'from_sys',    f.from_sys,
        'dest_sys',    f.dest_sys,
        'depart_at',   f.depart_at,
        'arrive_at',   f.arrive_at,
        'mine',        (f.faction_id = viewer),
        'stalled',     (f.stalled_until is not null and f.stalled_until > now()),
        'intel',       k.known,
        -- состав/численность — только если вскрыт (иначе клиент рисует «⚓?»)
        'ships',       case when k.known then (
                          select coalesce(sum(greatest(0,(c->>'qty')::int)),0)
                          from jsonb_array_elements(coalesce(f.composition,'[]'::jsonb)) c)
                        else null end,
        'composition', case when k.known then f.composition else null end
      ) order by f.faction_id, f.id), '[]'::jsonb)
    from public.fleets f
    cross join lateral (select public._fleet_intel_known(viewer, f.faction_id) as known) k
    cross join lateral (select (
        f.faction_id = viewer                                  -- своё видно всегда
        or k.known                                             -- разведка владельца → везде
        or (f.status = 'idle'  and f.system_id::text in (select sid from cov))   -- стоит в зоне сенсора
        or (f.status <> 'idle' and (f.from_sys::text in (select sid from cov)    -- выходит из / входит в зону
                                 or f.dest_sys::text in (select sid from cov)))
      ) as seen) d
    where d.seen
  );
end$$;
revoke all on function public._fleet_coverage(text) from public;
revoke all on function public.fleets_visible() from public;
grant execute on function public.fleets_visible() to authenticated;

-- ── 3. mza_visible — ЧУЖИЕ гиперкрейсеры, ТОЛЬКО когда вскрыты ──
-- Свои гиперкрейсеры идут через mza_ships_mine (как раньше). Здесь — только
-- вражеские, и только если: (а) недавно стреляли и ещё стоят в той же системе
-- («подсвечен после залпа, пока не сменил позицию»), ИЛИ (б) вскрыты охотой
-- этим наблюдателем (mza_reveals), ИЛИ (в) revealed_until ещё активен.
create or replace function public.mza_visible()
returns jsonb language plpgsql security definer set search_path=public as $$
declare viewer text;
begin
  viewer := public._ec_my_fid();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',          sh.id,
        'faction_id',  sh.faction_id,
        'faction_name',public._fac_name(sh.faction_id),
        'system_id',   sh.system_id,
        'status',      sh.status,
        'reason',      r.reason
      ) order by sh.id), '[]'::jsonb)
    from public.mza_ships sh
    cross join lateral (
      select case
        -- (а) выстрелил из текущей системы за последние 12ч и не двинулся
        when sh.status='idle' and exists(
               select 1 from public.doom_salvos s
               where s.mza_id = sh.id and s.origin_system_id = sh.system_id
                 and s.launched_at > now() - interval '12 hours')
          then 'fired'
        -- (б) вскрыт охотой именно этого наблюдателя
        when exists(select 1 from public.mza_reveals mr
               where mr.mza_id = sh.id and mr.hunter_fid = viewer and mr.revealed_until > now())
          then 'hunted'
        -- (в) глобальное вскрытие (на случай иных источников)
        when sh.revealed_until is not null and sh.revealed_until > now()
          then 'revealed'
        else null end as reason
    ) r
    where sh.faction_id is distinct from viewer
      and sh.status in ('idle','transit')
      and r.reason is not null
  );
end$$;
revoke all on function public.mza_visible() from public;
grant execute on function public.mza_visible() to authenticated;
