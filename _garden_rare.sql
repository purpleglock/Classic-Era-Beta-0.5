-- ══════════════════════════════════════════════════════════════
-- ПОЯС ПЕРЕСТАЁТ БЫТЬ ОДНОРОДНЫМ
-- ══════════════════════════════════════════════════════════════
-- ⚠️ ДО ЭТОГО ВСЕ КАМНИ ДАВАЛИ ОДНО И ТО ЖЕ. Раз добыча не зависит от места,
-- лететь к дальней кромке незачем: ловишь у самых грядок, топливо целее. Пояс
-- получает СОРТА: рядовой камень, рудная жила и кристаллическое ядро. Сорт
-- задаёт клиент по высоте орбиты (чем дальше от светила, тем чаще редкий) и
-- шлёт числом 0..2; сервер режет его до этих границ и решает награду сам —
-- подделка даёт максимум «жилу», а не спору мира из воздуха.
--
-- Цепочка: после _garden_sprouts.sql и _garden_multi.sql (перекрывает
-- _g_rock_roll, garden_cast и garden_haul из них).
-- ══════════════════════════════════════════════════════════════

-- Старые подписи убираем: с default-аргументом они дали бы неоднозначность
-- при вызове по имени параметра из PostgREST.
drop function if exists public._g_rock_roll(text);
drop function if exists public.garden_cast(text);

create or replace function public._g_rock_roll(p_sys text, p_tier int default 0)
returns jsonb language plpgsql volatile set search_path=public as $$
declare
  v_pool jsonb := public._g_res_pool(p_sys);
  v_n int := jsonb_array_length(coalesce(v_pool,'[]'::jsonb));
  v_t int := least(2, greatest(0, coalesce(p_tier,0)));
  v_rv double precision := random();
  v_el jsonb; v_alt jsonb; v_kind text; v_nm text; v_rar int := 0; v_gc numeric := 0;
  v_res text := null; v_icon text := null; v_hard numeric := 1; v_spore boolean := false;
  v_try int;
  v_p_spore double precision;
  v_p_sprout double precision;
  v_p_ore double precision;
begin
  if v_n = 0 then
    return jsonb_build_object('id', gen_random_uuid(), 'kind', 'dust',
      'name', 'Пыль', 'rar', 0, 'hard', 0.8, 'gc', 0, 'tier', v_t);
  end if;

  -- Границы полос. У редкого камня пустая порода почти не выпадает: за него уже
  -- заплачено дорогой к кромке.
  v_p_spore  := 0.012 * (1 + v_t * 2.2);
  v_p_sprout := v_p_spore + 0.61 + v_t * 0.10;
  v_p_ore    := v_p_sprout + 0.24 + v_t * 0.08;

  if v_rv < v_p_spore then
    v_kind := 'spore'; v_nm := 'Спора мира'; v_rar := 4; v_hard := 1.7;
    v_spore := true; v_gc := 0;

  -- Росток. Основной улов: ради него и ловят.
  elsif v_rv < v_p_sprout then
    v_el := v_pool->(floor(random()*v_n)::int);
    if v_t >= 2 then
      -- Ядро тянет породу ВВЕРХ: из двух жребиев берём БОЛЕЕ РЕДКИЙ.
      for v_try in 1..2 loop
        v_alt := v_pool->(floor(random()*v_n)::int);
        if public._g_rar(v_alt->>'r') > public._g_rar(v_el->>'r') then v_el := v_alt; end if;
      end loop;
    else
      -- Рядовой камень редкую породу, наоборот, чаще роняет: иначе система с
      -- одной легендарной залежью раздавала бы её каждым обломком. У жилы этот
      -- откат заметно слабее.
      for v_try in 1..2 loop
        if public._g_rar(v_el->>'r') > 1 and random() < (case when v_t = 1 then 0.30 else 0.62 end) then
          v_el := v_pool->(floor(random()*v_n)::int);
        end if;
      end loop;
    end if;
    v_kind := 'sprout';
    v_res  := v_el->>'name';
    v_icon := v_el->>'icon';
    v_rar  := public._g_rar(v_el->>'r');
    v_nm   := case v_t when 2 then 'Ядро: ' when 1 then 'Жила: ' else 'Росток: ' end || v_res;
    v_hard := 0.9 + v_rar * 0.22;

  -- Порода как есть: сразу в деньги, сеять нечего.
  elsif v_rv < v_p_ore then
    v_el := v_pool->(floor(random()*v_n)::int);
    v_kind := 'ore';
    v_res  := v_el->>'name';
    v_icon := v_el->>'icon';
    v_rar  := public._g_rar(v_el->>'r');
    v_nm   := case v_t when 2 then 'Кристалл: ' when 1 then 'Слиток: ' else 'Обломок: ' end || v_res;
    v_gc   := ((300 + v_rar * 900) * (1 + v_t * 1.3))::numeric;
    v_hard := 0.85 + v_rar * 0.12;

  -- Пыль. Без промахов ловля перестаёт быть ловлей.
  else
    v_kind := 'dust'; v_rar := 0; v_hard := 0.75; v_gc := 0;
    v_nm := (array['Пыль и лёд','Пустая порода','Кусок шлака','Мёрзлая крошка'])
              [1 + floor(random()*4)::int];
  end if;

  -- Редкий камень и держится крепче: награда должна стоить работы руками.
  v_hard := v_hard + v_t * 0.28;

  return jsonb_build_object(
    'id', gen_random_uuid(), 'kind', v_kind, 'name', v_nm,
    'res', v_res, 'icon', v_icon, 'rar', v_rar, 'tier', v_t,
    'gc', v_gc, 'spore', v_spore, 'hard', round(v_hard, 2), 'sys', p_sys);
end$$;

-- ══════════════════════════════════════════════════════════════
-- БРОСОК СЕТИ (крючок по владельцу — из _garden_multi.sql)
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_cast(p_sys text default null, p_tier int default 0)
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

  insert into public.fishing_state(faction_id, owner_id, day, kept, casts)
    values (fid, auth.uid(), current_date, 0, 0)
    on conflict (faction_id) do nothing;
  select * into st from public.fishing_state where faction_id = fid for update;

  insert into public.garden_hooks(owner_id, faction_id)
    values (auth.uid(), fid)
    on conflict (owner_id) do update set faction_id = excluded.faction_id;
  select * into hk from public.garden_hooks where owner_id = auth.uid() for update;

  if hk.last_cast is not null and hk.last_cast > now() - interval '1 second' then
    raise exception 'слишком часто: сеть ещё в полёте';
  end if;

  v_rock := public._g_rock_roll(v_sys, p_tier);

  -- Спора мира — не чаще раза в сутки на державу, сорт камня этого не меняет.
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
    'id', v_rock->>'id', 'hard', v_rock->'hard', 'tier', v_rock->'tier');
end$$;
revoke all on function public.garden_cast(text, int) from public, anon;
grant execute on function public.garden_cast(text, int) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- ВЫВАЖИВАНИЕ: сорт камня добавляет ростков в горсть
-- ══════════════════════════════════════════════════════════════
create or replace function public.garden_haul(p_id uuid, p_ok boolean, p_score numeric default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; hk public.garden_hooks; b jsonb; v_sc numeric; v_qty int; v_gc numeric; v_t int;
begin
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into hk from public.garden_hooks where owner_id = auth.uid() for update;
  if not found or hk.pending is null then raise exception 'сеть пуста'; end if;

  b := hk.pending;
  if (b->>'id') is distinct from p_id::text then raise exception 'stale hook'; end if;
  v_sc := least(1, greatest(0, coalesce(p_score, 1)));
  v_t  := least(2, greatest(0, coalesce((b->>'tier')::int, 0)));

  if not coalesce(p_ok, false) then
    update public.garden_hooks set pending = null, updated_at = now() where owner_id = auth.uid();
    return jsonb_build_object('ok', true, 'lost', true, 'name', b->>'name');
  end if;

  v_qty := 0; v_gc := 0;

  if (b->>'kind') = 'sprout' then
    v_qty := greatest(1, floor(1 + v_sc * 2.4)::int) + v_t;
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
    'rar', coalesce((b->>'rar')::int,0), 'tier', v_t, 'qty', v_qty, 'gc', round(v_gc));
end$$;
revoke all on function public.garden_haul(uuid, boolean, numeric) from public, anon;
grant execute on function public.garden_haul(uuid, boolean, numeric) to authenticated;
