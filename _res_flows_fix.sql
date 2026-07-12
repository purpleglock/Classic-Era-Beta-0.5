-- ============================================================
-- ФИКС ПАНЕЛИ ПОТОКОВ · разовый безопасный перекат (без economy_accrue!)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Чинит два бага прода:
--   1) «Разовая продажа» падала с 'no market: build a commodity market first' —
--      в проде старая версия res_sell_now с гейтом Товарной биржи. Здесь гейт
--      УБРАН: разовая продажа = явный сброс запаса по 50–75% цены, биржа не нужна.
--   2) «Режимы не сохраняются» — если таблица faction_res_flows в проде без
--      ключа (faction_id, res_name), insert…on conflict в res_flow_set падает.
--      Догоняем ключ и политику чтения идемпотентно.
--
-- ВАЖНО: economy_accrue тут НЕ трогаем — в проде живёт v8 из _budget_wellbeing.sql
-- (надмножество потоков v6). Полный _res_flows.sql НЕ катить: он откатит accrue до v6.
-- ============================================================

-- ── 1) Самолечение схемы ────────────────────────────────────
create table if not exists public.faction_res_flows (
  faction_id        text    not null,
  res_name          text    not null,
  mode              text    default null check (mode is null or mode in ('store','export')),
  market_limit      numeric default null check (market_limit is null or market_limit >= 0),
  market_from_store numeric not null default 0 check (market_from_store >= 0),
  to_store          boolean not null default true,
  updated_at        timestamptz not null default now(),
  primary key (faction_id, res_name)
);
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.faction_res_flows'::regclass and contype in ('p','u')
  ) then
    delete from public.faction_res_flows a using public.faction_res_flows b
      where a.ctid < b.ctid and a.faction_id = b.faction_id and a.res_name = b.res_name;
    alter table public.faction_res_flows add primary key (faction_id, res_name);
  end if;
end $$;
alter table public.faction_res_flows enable row level security;
drop policy if exists frf_select_own on public.faction_res_flows;
create policy frf_select_own on public.faction_res_flows
  for select to authenticated using (faction_id = public._ec_my_fid());
revoke insert, update, delete on public.faction_res_flows from anon, authenticated;

-- ── 2) res_sell_now БЕЗ гейта биржи (актуальная версия) ─────
create or replace function public.res_sell_now(p_res text, p_qty numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; eco public.faction_economy; avail numeric; sell numeric;
  rr text; gain numeric; m_gc numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if coalesce(btrim(p_res),'') = '' then raise exception 'resource required'; end if;
  if coalesce(p_qty,0) <= 0 then raise exception 'qty must be positive'; end if;
  select * into eco from public.faction_economy where faction_id = fid for update;
  if not found then raise exception 'no economy row'; end if;
  avail := coalesce((eco.resources->>btrim(p_res))::numeric, 0);
  sell := least(p_qty, avail);
  if sell <= 0 then raise exception 'nothing to sell: warehouse is empty for this resource'; end if;
  rr := coalesce((select rarity from public.resource_rarity where name = btrim(p_res)),'common');
  m_gc := (public._faction_mods(fid)->>'gc')::numeric;
  if eco.debuff_until is not null and eco.debuff_until > now() then
    m_gc := m_gc * (1 - coalesce(eco.debuff_pct,0));
  end if;
  gain := round(sell * public._res_value(btrim(p_res), rr) *
    (case rr when 'legendary' then 0.75 when 'epic' then 0.70 when 'rare' then 0.65
             when 'uncommon' then 0.55 else 0.5 end) * m_gc);
  update public.faction_economy
    set gc = gc + gain,
        resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[btrim(p_res)],
                              to_jsonb(greatest(0, avail - sell)), true)
    where faction_id = fid;
  return jsonb_build_object('ok', true, 'sold', sell, 'gc', gain);
end$$;
revoke all on function public.res_sell_now(text,numeric) from public, anon;
grant execute on function public.res_sell_now(text,numeric) to authenticated;

-- ── 3) Гранты остальных RPC панели (в проде anon мог исполнять) ──
do $$ begin
  begin revoke all on function public.res_flow_set(text,text,numeric,numeric,boolean) from public, anon; exception when undefined_function then null; end;
  begin revoke all on function public.res_flow_clear(text) from public, anon; exception when undefined_function then null; end;
  begin revoke all on function public.trade_route_from_store(uuid,boolean) from public, anon; exception when undefined_function then null; end;
  begin revoke all on function public.concession_grant(uuid,text,text) from public, anon; exception when undefined_function then null; end;
  begin revoke all on function public.concession_revoke(uuid) from public, anon; exception when undefined_function then null; end;
end $$;

-- Проверка (под своим аккаунтом в приложении):
--   1) Потоки → сменить «Режим» → Применить → F5: режим должен остаться.
--   2) Разовая продажа со склада: должна пройти без «no market».
