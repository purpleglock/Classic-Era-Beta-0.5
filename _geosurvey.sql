-- ============================================================
-- ⛏ ГЕОРАЗВЕДКА — «найди новое месторождение на своей территории»
-- ============================================================
-- По сути СКРЫТОЕ КАЗИНО под вывеской геологии (лудомания «на добыче»).
-- Живёт в НОВЕЛЛЕ (оверлей hp-vn-geo), не в кабинете.
--
-- Правила (v2 — переработка после теста):
--   • «Разведать» колонию = крутка. Результат ВЫПАДАЕТ СРАЗУ (без таймера):
--     случайная залежь от «Пустышки» (common·следы) до «ДЖЕКПОТА»
--     (legendary·колоссально). Веса — как у рулетки.
--   • ОТКАЗАТЬСЯ НЕЛЬЗЯ. Единственная кнопка решения — ПРИНЯТЬ: залежь
--     ложится на колонию. Можно ПЕРЕБРОСИТЬ (новая крутка, дороже).
--   • Цена крутки РАСТЁТ ЗА ДЕНЬ и НЕ сбрасывается принятием (иначе можно
--     было бы обнулять эскалацию — это убивало систему). Счётчик крутки —
--     per-фракция, per-день; на СЛЕДУЮЩИЙ ДЕНЬ цена откатывается к базе.
--   • Расписание цены N-й крутки за день (0-я = первая): 10к / 15к / 22.5к /
--     35к / далее +15к за каждую следующую. Зеркало клиента ecGeoCost().
--
-- Не применялось автоматически: катить как обычный срез экономики.
-- Зеркало клиента — economy.js (ecGeoBody) + render.js (heroVNGeoOpen),
-- ?v=20260712geosurvey3
-- ============================================================

-- ── Чистка v1 (была таблица-сессия + start/reroll/abandon) ──
drop function if exists public.geosurvey_start(uuid);
drop function if exists public.geosurvey_reroll(uuid);
drop function if exists public.geosurvey_abandon(uuid);
drop function if exists public.geosurvey_accept(uuid);           -- старая сигнатура с аргументом
drop function if exists public._geosurvey_reroll_cost(int);
drop table if exists public.geosurvey_sessions;

-- ── Состояние георазведки: одна строка на фракцию ──
create table if not exists public.geosurvey_state (
  faction_id  text primary key,
  owner_id    uuid,
  day         date not null default current_date,   -- день, к которому относится счётчик крутки
  spins       int  not null default 0,              -- сколько круток сделано в этот день
  current     jsonb,                                -- текущая невзятая находка {name,r,amt} (null = решать нечего)
  colony_id   uuid references public.colonies(id) on delete set null,
  updated_at  timestamptz default now()
);
alter table public.geosurvey_state enable row level security;
drop policy if exists "geo_sel" on public.geosurvey_state;
create policy "geo_sel" on public.geosurvey_state for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.geosurvey_state from public, anon, authenticated;

-- ── Один бросок «рулетки»: редкость × размер × конкретный ресурс ──
-- Веса: редкость common 45 / uncommon 30 / rare 15 / epic 8 / legendary 2.
--       размер   следы 26 / мало 30 / умеренно 22 / много 13 / оч.много 7 / колоссально 2.
create or replace function public._geosurvey_roll()
returns jsonb language plpgsql volatile as $$
declare rr text; amt text; nm text; rv double precision; sv double precision;
begin
  rv := random();
  rr := case when rv < 0.45 then 'common'
             when rv < 0.75 then 'uncommon'
             when rv < 0.90 then 'rare'
             when rv < 0.98 then 'epic'
             else 'legendary' end;
  sv := random();
  amt := case when sv < 0.26 then 'следы'
              when sv < 0.56 then 'мало'
              when sv < 0.78 then 'умеренно'
              when sv < 0.91 then 'много'
              when sv < 0.98 then 'очень много'
              else 'колоссально' end;
  select name into nm from public.resource_rarity where rarity = rr order by random() limit 1;
  if nm is null then nm := 'Железо'; rr := 'common'; end if;
  return jsonb_build_object('name', nm, 'r', rr, 'amt', amt);
end$$;

-- ── Цена (n+1)-й крутки за день (n = уже сделано круток сегодня, 0-based) ──
create or replace function public._geosurvey_cost(n int)
returns numeric language sql immutable as $$
  select case
    when coalesce(n,0) <= 0 then 10000
    when n = 1 then 15000
    when n = 2 then 22500
    when n = 3 then 35000
    else 35000 + (n - 3) * 15000 end::numeric   -- дальше +15к за крутку
$$;

-- ── Текущее состояние + цена следующей крутки (read-only, для клиента) ──
create or replace function public.geosurvey_get()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.geosurvey_state; eff int;
begin
  fid := public._ec_my_fid();
  if fid is null then
    return jsonb_build_object('current', null, 'colony_id', null, 'spins', 0, 'next_cost', 10000);
  end if;
  select * into st from public.geosurvey_state where faction_id = fid;
  if not found then
    return jsonb_build_object('current', null, 'colony_id', null, 'spins', 0, 'next_cost', 10000);
  end if;
  eff := case when st.day < current_date then 0 else st.spins end;   -- новый день → эскалация сброшена
  return jsonb_build_object('current', st.current, 'colony_id', st.colony_id,
    'spins', eff, 'next_cost', public._geosurvey_cost(eff));
end$$;
revoke all on function public.geosurvey_get() from public, anon;
grant execute on function public.geosurvey_get() to authenticated;

-- ── Крутка: списывает цену, выдаёт находку (первая или реролл — единый вход) ──
create or replace function public.geosurvey_spin(p_colony uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; col public.colonies; st public.geosurvey_state; eff int; cost numeric; roll jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  select * into col from public.colonies where id = p_colony;
  if not found or col.faction_id is distinct from fid then
    raise exception 'not your colony: разведывать можно только СВОЮ территорию';
  end if;

  insert into public.geosurvey_state(faction_id, owner_id, day, spins)
    values (fid, auth.uid(), current_date, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.geosurvey_state where faction_id = fid for update;

  eff  := case when st.day < current_date then 0 else st.spins end;   -- новый день → счётчик сброшен
  cost := public._geosurvey_cost(eff);
  update public.faction_economy set gc = gc - cost where faction_id = fid and gc >= cost;
  if not found then raise exception 'not enough GC: крутка стоит % ГС', cost; end if;

  roll := public._geosurvey_roll();
  update public.geosurvey_state
    set current = roll, colony_id = p_colony, spins = eff + 1, day = current_date, updated_at = now()
    where faction_id = fid;
  return jsonb_build_object('ok', true, 'current', roll, 'colony_id', p_colony,
    'spins', eff + 1, 'next_cost', public._geosurvey_cost(eff + 1), 'spent', cost);
end$$;
revoke all on function public.geosurvey_spin(uuid) from public, anon;
grant execute on function public.geosurvey_spin(uuid) to authenticated;

-- ── Принять находку: залежь ложится на колонию (счётчик крутки НЕ сбрасываем) ──
create or replace function public.geosurvey_accept()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.geosurvey_state; dep jsonb;
begin
  fid := public._ec_my_fid();
  select * into st from public.geosurvey_state where faction_id = fid for update;
  if not found or st.current is null then raise exception 'nothing to accept: сначала разведайте'; end if;

  dep := jsonb_build_object('name', st.current->>'name', 'r', st.current->>'r', 'amt', st.current->>'amt');
  update public.colonies
    set resources = coalesce(resources, '[]'::jsonb) || dep
    where id = st.colony_id and faction_id = fid;
  if not found then raise exception 'colony gone: колония больше не ваша — находка не принята'; end if;

  -- current гасим, но spins/day НЕ трогаем: эскалация цены переживает принятие
  update public.geosurvey_state set current = null, colony_id = null, updated_at = now()
    where faction_id = fid;
  return jsonb_build_object('ok', true, 'deposit', dep, 'colony_id', st.colony_id);
end$$;
revoke all on function public.geosurvey_accept() from public, anon;
grant execute on function public.geosurvey_accept() to authenticated;
