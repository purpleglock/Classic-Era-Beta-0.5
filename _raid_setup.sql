-- ============================================================
-- ПИРАТСТВО (КАПЕРСТВО) — ФАЗА 1, СРЕЗ 1: каркас (таблица + запуск/отмена/патруль)
-- Применять в Supabase → SQL Editor. Идемпотентно. АДДИТИВНО: бой и разрешение —
-- срез 2 (там же интеграция в economy_accrue). Пока raid_resolve нет — запущенные
-- рейды просто висят 'active'; UI не подключаем до среза 2.
--
-- Модель: игрок шлёт N военных кораблей грабить КОНКРЕТНЫЙ активный караван
-- (trade_routes) другой фракции. Защита — конвой каравана + патруль цели.
-- Исход (двусторонний бой, потери, добыча) считает СЕРВЕР на тике (срез 2).
--
-- Безопасность: всё через SECURITY DEFINER RPC; сила от ЧИСЛА кораблей (не ТТХ —
-- они клиентские); for update на казне (сериализация занятых кораблей); RLS
-- detected-gate как у spy_missions; прямой записи игроку нет.
-- ============================================================

-- ── Патруль: корабли на охране своих путей (зеркало counter_agents) ──
alter table public.faction_economy add column if not exists patrol_ships int default 0;

-- ── Таблица рейдов (зеркало spy_missions) ───────────────────
create table if not exists public.raid_missions (
  id           uuid primary key default gen_random_uuid(),
  actor_fid    text, actor_owner uuid,
  target_fid   text, target_owner uuid, target_name text,
  route_id     uuid,                       -- цель: trade_routes.id (исходящий караван жертвы)
  ships        int  not null default 1,    -- кораблей в рейде
  power_att    int,                        -- снимок силы атаки (для прозрачности)
  status       text not null default 'active',  -- active | done
  detected     boolean not null default false,  -- раскрыт ли пират перед жертвой
  outcome      jsonb,                       -- результат боя (заполняется при resolve, срез 2)
  started_at   timestamptz, ready_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists raid_actor_idx  on public.raid_missions(actor_fid, status);
create index if not exists raid_target_idx on public.raid_missions(target_owner);
create index if not exists raid_ready_idx  on public.raid_missions(ready_at);

alter table public.raid_missions enable row level security;
drop policy if exists "raid_sel" on public.raid_missions;
-- Свои рейды видит автор; цель — ТОЛЬКО если раскрыт; стафф — всё. (как spy_missions)
create policy "raid_sel" on public.raid_missions for select to authenticated
  using (actor_owner = auth.uid()
      or (target_owner = auth.uid() and detected = true)
      or public.current_user_role() in ('superadmin','editor','moderator'));
-- Запись — только через RPC (security definer). Прямого insert/update игроку не даём.

-- ── helper: свободные корабли фракции ───────────────────────
-- готовые − занятые в конвоях − занятые в активных рейдах − патруль
create or replace function public._raid_free_ships(p_fid text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce((select sum(qty) from public.unit_production
                   where faction_id=p_fid and category='ship' and status='done'),0)
       - coalesce((select sum(convoy) from public.trade_routes
                   where a_fid=p_fid and status in ('pending','active')),0)
       - coalesce((select sum(ships) from public.raid_missions
                   where actor_fid=p_fid and status='active'),0)
       - coalesce((select patrol_ships from public.faction_economy where faction_id=p_fid),0)
$$;
revoke all on function public._raid_free_ships(text) from public;

-- ── RPC: запуск рейда ───────────────────────────────────────
create or replace function public.raid_launch(p_target_fid text, p_route_id uuid, p_ships int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; me public.faction_economy; rt public.trade_routes;
  n int; freep int; adj boolean; turns int; powa int; tgt_owner uuid;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  n := greatest(1, coalesce(p_ships,1));
  if p_target_fid = fid then raise exception 'cannot raid yourself'; end if;

  -- цель — активный ИСХОДЯЩИЙ караван жертвы (грабить нечего, если не торгует)
  select * into rt from public.trade_routes where id = p_route_id and a_fid = p_target_fid and status='active';
  if not found then raise exception 'target caravan not active'; end if;

  select owner_id into tgt_owner from public.faction_economy where faction_id = p_target_fid;
  if tgt_owner is null then raise exception 'target has no economy'; end if;

  -- LOCK казны: сериализуем учёт занятых кораблей (нельзя послать одни корабли в 2 рейда гонкой)
  select * into me from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy'; end if;

  freep := public._raid_free_ships(fid);
  if n > freep then raise exception 'not enough free ships (free: %)', greatest(0, freep); end if;

  -- дистанция: смежна ли твоя территория с маршрутом жертвы → 1 ход, иначе 2 (дальше дольше)
  select exists(
    select 1 from public.map_systems ms
    join public.map_hyperlanes h on (h.a_id = ms.id or h.b_id = ms.id)
    where ms.faction = fid
      and (rt.origin_sys in (h.a_id, h.b_id) or rt.dest_sys in (h.a_id, h.b_id))
  ) into adj;
  turns := case when adj then 1 else 2 end;

  powa := round(n * 10);   -- сила от ЧИСЛА кораблей; доктрина/тех-тир — позже, безопасно

  insert into public.raid_missions(actor_fid, actor_owner, target_fid, target_owner, target_name,
      route_id, ships, power_att, status, started_at, ready_at)
    values(fid, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid),
      p_route_id, n, powa, 'active', now(), now() + (turns || ' days')::interval);

  return jsonb_build_object('ok', true, 'ships', n, 'turns', turns, 'power', powa, 'adjacent', adj);
end$$;
revoke all on function public.raid_launch(text,uuid,int) from public;
grant execute on function public.raid_launch(text,uuid,int) to authenticated;

-- ── RPC: отзыв рейда (возврат кораблей; атомарно от гонки) ───
create or replace function public.raid_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  -- DELETE…RETURNING как гейт: только один вызов удалит, корабли освободятся (учёт виртуальный)
  delete from public.raid_missions where id = p_id and actor_owner = auth.uid() and status = 'active';
  if not found then raise exception 'raid not found or already resolved'; end if;
  return jsonb_build_object('ok', true);
end$$;
revoke all on function public.raid_cancel(uuid) from public;
grant execute on function public.raid_cancel(uuid) to authenticated;

-- ── RPC: назначить патруль (корабли на защиту своих путей) ───
create or replace function public.raid_patrol_set(p_n int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; done_ships int; conv int; raids int; maxfree int; n int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  -- LOCK: считаем доступные корабли консистентно
  perform 1 from public.faction_economy where faction_id=fid for update;
  select coalesce(sum(qty),0)    into done_ships from public.unit_production where faction_id=fid and category='ship' and status='done';
  select coalesce(sum(convoy),0) into conv       from public.trade_routes   where a_fid=fid and status in ('pending','active');
  select coalesce(sum(ships),0)  into raids      from public.raid_missions  where actor_fid=fid and status='active';
  maxfree := done_ships - conv - raids;   -- патруль ≤ свободных (без учёта уже-патруля)
  n := greatest(0, least(coalesce(p_n,0), maxfree));
  update public.faction_economy set patrol_ships = n where faction_id=fid;
  return jsonb_build_object('ok', true, 'patrol_ships', n);
end$$;
revoke all on function public.raid_patrol_set(int) from public;
grant execute on function public.raid_patrol_set(int) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- select count(*) from public.raid_missions;            -- 0 (новая таблица)
-- select public._raid_free_ships('<свой fid>');         -- сколько кораблей свободно
-- Запуск/отмена/патруль доступны, но рейды НЕ резолвятся до среза 2.
