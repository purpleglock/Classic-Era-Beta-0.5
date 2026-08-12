-- ============================================================
-- САД: ДВОЕ И БОЛЬШЕ ИГРОКОВ ОДНОВРЕМЕННО
-- ============================================================
-- Проверка показала две дыры, из-за которых «одновременно» работало только
-- у одного человека за раз:
--
-- 1) КОЛЬЦО ХРАМА ЗАБИВАЛИ ДВЕ ДЕРЖАВЫ. Отсеков на ободе всего 48 (_g_cells
--    упирается в потолок 48, и столько же рисует клиент: GD_BAYS), а лимит
--    plot_cap был 24 НА ДЕРЖАВУ. Две державы — и третьей ячеек нет ни одной,
--    притом Храм единственная земля, куда пускают всех. Ставим 8: кольцо
--    держит шестерых, и это честный предел его геометрии, а не выдумка.
--
-- 2) КРЮЧОК БЫЛ ОДИН НА ДЕРЖАВУ. pending и last_cast лежали в fishing_state,
--    у которой первичный ключ — faction_id. Двое из одной державы бросают
--    сеть: второй garden_cast затирает pending первого, и у первого haul
--    падает «stale hook», а улов исчезает. Крючок — это РУКИ, он не может
--    быть общим на державу; переносим его в отдельную таблицу по владельцу.
--    Дневные счётчики (спора раз в сутки, casts/kept) остаются державными:
--    это лимит экономики, а не рук.
-- ============================================================

-- ── 1. Ёмкость грядок на державу ──
create or replace function public._g_const(p_key text)
returns numeric language sql immutable as $$
  select case p_key
    when 'water_h'   then 24
    when 'feed_h'    then 48
    when 'weed_h'    then 36
    when 'water_min' then 20
    when 'feed_min'  then 10
    when 'weed_max'  then 60
    when 'ripe_res'  then 24
    when 'ripe_ichor' then 72
    when 'ichor_cap' then 10
    when 'seed_ichor_gc' then 200000
    when 'till_gc'   then 2500
    when 'feed_gc'   then 400
    when 'plot_cap'  then 8       -- БЫЛО 24: 48 отсеков обода / 8 = шесть держав
    else 0 end::numeric
$$;

-- ── 1б. Отсеков на ободе Храма. ⚠️ ИХ БЫЛО ВСЕГО 20: _g_cells считает
--        6 + 2·планет, а у Храма семь тел. Одна держава со старым лимитом 24
--        забирала ВЕСЬ обод, и второму игроку негде было развернуть даже одну
--        ячейку. Клиент кладёт отсеки по сетке GD_BAYS = 48 (j/48 по кругу),
--        то есть обод физически держит 48 штук — столько Храму и даём.
--        Номер ячейки = угол, поэтому уже занятые ячейки не переезжают.
create or replace function public._g_cells(p_sys text)
returns int language plpgsql stable set search_path=public as $$
declare ms record; n int;
begin
  if p_sys = public._g_temple_sys() then return 48; end if;
  select * into ms from public.map_systems where id = p_sys;
  if not found then return 0; end if;
  n := 6 + 2 * coalesce(jsonb_array_length(coalesce(ms.planets,'[]'::jsonb)), 0);
  if coalesce(ms.is_giant, false) then n := n + 8; end if;
  return least(n, 48);
end$$;

-- ── 2. Крючок по владельцу, а не по державе ──
create table if not exists public.garden_hooks (
  owner_id   uuid primary key,
  faction_id text,
  pending    jsonb,
  last_cast  timestamptz,
  updated_at timestamptz default now()
);
alter table public.garden_hooks enable row level security;
drop policy if exists "ghook_sel" on public.garden_hooks;
create policy "ghook_sel" on public.garden_hooks for select to authenticated
  using (owner_id = auth.uid());
revoke insert, update, delete on public.garden_hooks from public, anon, authenticated;

create or replace function public.garden_cast(p_sys text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.fishing_state; hk public.garden_hooks;
        v_sys text; v_rock jsonb; v_spd int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  v_sys := coalesce(nullif(btrim(coalesce(p_sys,'')),''), public._g_temple_sys());
  if v_sys is null then raise exception 'нет системы'; end if;
  if public._g_land(fid, v_sys) is null then raise exception 'это не ваш небосвод'; end if;

  -- Дневной счёт державы: спора не чаще раза в сутки на всех.
  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  -- Крючок — свой у каждого.
  insert into public.garden_hooks(owner_id, faction_id)
    values (auth.uid(), fid)
    on conflict (owner_id) do update set faction_id = excluded.faction_id;
  select * into hk from public.garden_hooks where owner_id = auth.uid() for update;

  if hk.last_cast is not null and hk.last_cast > now() - interval '1 second' then
    raise exception 'слишком часто: сеть ещё в полёте';
  end if;

  v_rock := public._g_rock_roll(v_sys);

  v_spd := case when st.day < current_date then 0 else coalesce(st.spore_day,0) end;
  if coalesce((v_rock->>'spore')::boolean,false) and v_spd >= 1 then
    v_rock := jsonb_set(v_rock, '{spore}', 'false'::jsonb);
    v_rock := jsonb_set(v_rock, '{kind}',  '"ore"'::jsonb);
    v_rock := jsonb_set(v_rock, '{name}',  '"Слиток пустоты"'::jsonb);
    v_rock := jsonb_set(v_rock, '{gc}',    to_jsonb(2500::numeric));
  end if;

  update public.garden_hooks
     set pending = v_rock, last_cast = now(), updated_at = now()
   where owner_id = auth.uid();

  update public.fishing_state
     set day = current_date, spore_day = v_spd,
         casts = case when st.day < current_date then 1 else coalesce(st.casts,0) + 1 end,
         kept  = case when st.day < current_date then 0 else st.kept end,
         updated_at = now()
   where faction_id = fid;

  return jsonb_build_object('ok', true,
    'id', v_rock->>'id', 'hard', v_rock->'hard');
end$$;
revoke all on function public.garden_cast(text) from public, anon;
grant execute on function public.garden_cast(text) to authenticated;

create or replace function public.garden_haul(p_id uuid, p_ok boolean, p_score numeric default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; hk public.garden_hooks; b jsonb; v_sc numeric; v_qty int; v_gc numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into hk from public.garden_hooks where owner_id = auth.uid() for update;
  if not found or hk.pending is null then raise exception 'сеть пуста'; end if;

  b := hk.pending;
  if (b->>'id') is distinct from p_id::text then raise exception 'stale hook'; end if;
  v_sc := least(1, greatest(0, coalesce(p_score, 1)));

  if not coalesce(p_ok, false) then
    update public.garden_hooks set pending = null, updated_at = now() where owner_id = auth.uid();
    return jsonb_build_object('ok', true, 'lost', true, 'name', b->>'name');
  end if;

  v_qty := 0; v_gc := 0;

  if (b->>'kind') = 'sprout' then
    v_qty := greatest(1, floor(1 + v_sc * 2.4)::int);
    insert into public.garden_sprouts (faction_id, res, rar, icon, qty)
    values (fid, b->>'res', coalesce((b->>'rar')::int,0), b->>'icon', v_qty)
    on conflict (faction_id, res) do update
      set qty = public.garden_sprouts.qty + excluded.qty,
          icon = coalesce(excluded.icon, public.garden_sprouts.icon),
          updated_at = now();

  elsif (b->>'kind') = 'spore' then
    insert into public.fishing_state (faction_id, seed) values (fid, 1)
      on conflict (faction_id) do update set seed = coalesce(public.fishing_state.seed,0) + 1;
    update public.fishing_state set spore_day = coalesce(spore_day,0) + 1 where faction_id = fid;

  else
    v_gc := coalesce((b->>'gc')::numeric, 0) * (0.55 + v_sc * 0.45);
    if v_gc > 0 then
      update public.faction_economy set gc = coalesce(gc,0) + v_gc where faction_id = fid;
    end if;
  end if;

  update public.garden_hooks set pending = null, updated_at = now() where owner_id = auth.uid();
  update public.fishing_state
     set kept = coalesce(kept,0) + 1, total = coalesce(total,0) + 1, updated_at = now()
   where faction_id = fid;

  return jsonb_build_object('ok', true, 'lost', false,
    'kind', b->>'kind', 'name', b->>'name', 'res', b->>'res',
    'rar', coalesce((b->>'rar')::int,0), 'qty', v_qty, 'gc', round(v_gc));
end$$;
revoke all on function public.garden_haul(uuid, boolean, numeric) from public, anon;
grant execute on function public.garden_haul(uuid, boolean, numeric) to authenticated;

-- ── 3. Старые посевы с сырым JSON в res. Так писал _g_seeds до наката
--       _garden_sprouts.sql; клиент их разворачивает при показе, но чинить
--       данные дешевле, чем таскать разбор JSON вечно. ──
do $$
declare r record; v text;
begin
  for r in select id, res from public.garden_plants where res like '{%' loop
    begin
      v := nullif(btrim(coalesce((r.res::jsonb)->>'name','')),'');
      if v is not null then
        update public.garden_plants set res = v where id = r.id;
      end if;
    exception when others then
      null;   -- не разобралось — пусть клиент показывает как умеет
    end;
  end loop;
end$$;
