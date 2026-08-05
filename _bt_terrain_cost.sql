-- ════════════════════════════════════════════════════════════════════════
-- ЦЕНА ГЕКСА: ландшафт сопротивляется движению
-- Применять ПОСЛЕ _bt_timepool.sql / _bt_stance.sql и _bt_arena_zoning.sql.
-- ────────────────────────────────────────────────────────────────────────
-- Было: шаг стоил ОДИНАКОВО по всему маршруту. Ландшафт трогал движение
-- ровно один раз — если корабль СТАРТОВАЛ с обломков, весь его ход дорожал
-- в 1.5 раза. Пролёт сквозь астероидный пояс не стоил ничего: камни резали
-- линию огня, но пройти через них было так же дёшево, как по пустоте.
-- Планировка карты (_bt_arena_zoning.sql) на этом разваливалась: гряда,
-- сквозь которую можно просто пролететь, — не барьер, а декорация, и створы
-- в ней ничего не значат.
--
-- Стало: цена платится ЗА КАЖДЫЙ ВХОД в гекс, по его ландшафту.
--   ast астероиды  ×2.2 — сквозь пояс продавливаются, а не пролетают;
--   deb обломки    ×1.5 — прежний штраф, но теперь за вход, а не за старт;
--   neb туманность ×1.25 — вслепую идут медленнее.
-- Чистый гекс стоит ровно столько же, сколько раньше: у боя, идущего в
-- открытом поле, ничего не изменилось.
--
-- ⚠ Штраф «стартовал с обломков» СНЯТ — он заменён ценой входа. Иначе
--   обломки брали дважды: за то, что в них зашли, и за то, что из них вышли.
--
-- ⚠ Маршрут перестал быть «N шагов по фиксированной цене». Проверка «влезет
--   ли» теперь считает СУММУ по клеткам, поэтому одна и та же длина пути то
--   проходит, то нет — это и есть смысл правки. Клиент считает ту же сумму
--   (bbComputeReach — Дейкстра по цене, а не волна по шагам).
-- ════════════════════════════════════════════════════════════════════════

-- Множитель цены входа в гекс. Единственное место, где живут эти числа;
-- клиентское зеркало — BBW_TERRA в battle_board.js.
create or replace function public._bt_terra_mult(k text)
returns numeric language sql immutable as $$
  select case k when 'ast' then 2.2 when 'deb' then 1.5 when 'neb' then 1.25 else 1.0 end;
$$;

-- Цена входа в конкретный гекс при базовой цене шага.
create or replace function public._bt_hex_cost(t jsonb, base numeric, px int, py int)
returns numeric language sql immutable as $$
  select base * public._bt_terra_mult(public._bt_terra(t, px, py));
$$;

-- ── Ядро хода: сумма по клеткам маршрута ───────────────────────────────
-- Основа — ЖИВАЯ версия из _bt_stance.sql (форсаж двигателей на месте).
-- Изменено ровно одно: вместо `spend := cost * total` маршрут просчитывается
-- поклеточно, и он же служит проверкой «хватает ли секунд».
create or replace function public._bt_do_move(p_battle uuid, p_unit uuid, p_path jsonb, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; f int;
        terr text; i int; total int; cost numeric; spend numeric := 0; hc numeric;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.cls = 'ss13' or u.speed <= 0 then raise exception 'станция неподвижна — она не двигается на поле боя'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  cost := public._bt_step_cost(u.speed);
  if u.stance = 'eng' then cost := cost * public._bt_eng_mult(); end if;   -- ФОРСАЖ: дальше за те же секунды
  if u.tp + 1e-9 < cost then
    raise exception '«%» израсходовал ход: осталось % c, а шаг стоит % c',
      u.unit_name, round(u.tp, 1), round(cost, 1);
  end if;

  cx := u.x; cy := u.y; f := u.facing;
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1;
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
    end if;
    if not public._bt_in_arena(b.shape, nx, ny) then
      raise exception 'маршрут уходит в пустоту за кромкой арены';
    end if;
    if public._bt_dist(cx, cy, nx, ny) <> 1 then raise exception 'маршрут разорван — шаг только в соседний гекс'; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = nx and y = ny) then
      raise exception 'гекс %:% занят — сквозь корабли не летают', nx, ny;
    end if;
    -- цена ВХОДА в клетку: пояс и обломки съедают ход быстрее пустоты
    hc := public._bt_hex_cost(b.terrain, cost, nx, ny);
    if spend + hc > u.tp + 1e-9 then
      raise exception '«%» не дотянет: маршрут стоит % c, а осталось % c — до %-го гекса секунд хватает',
        u.unit_name, round(spend + hc, 1), round(u.tp, 1), i - 1;
    end if;
    spend := spend + hc;
    f := public._bt_dirof(cx, cy, nx, ny);
    cx := nx; cy := ny;
  end loop;

  perform public._bt_use_act(p_battle, p_unit);
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = 99, moved = true,
         tp = greatest(0, tp - spend),
         shield = 0        -- манёвр роняет поле: идти и держать щит одновременно нельзя
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  return jsonb_build_object('ok', true, 'facing', f, 'tp', round(u.tp - spend, 1));
end$fn$;
revoke all on function public._bt_do_move(uuid, uuid, jsonb, text) from public;

-- ── Бот: считать тот же бюджет ─────────────────────────────────────────
-- Бот набирал ровно `speed` шагов, не глядя на цену. С платными клетками
-- такой маршрут не влезал бы в пул, `_bt_do_move` кидал бы исключение, а
-- вызывающий его код глушит ошибки (`exception when others then null`) —
-- бот молча стоял бы на месте. Ровно та поломка, что уже была с bbDirOf.
-- Поэтому маршрут теперь копится по секундам и обрывается, когда денег нет.
create or replace function public._bt_bot_path(p_battle uuid, p_unit uuid, p_tx int, p_ty int, p_goal int)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare u record; b record; path jsonb := '[]'::jsonb;
        cx int; cy int; d int; cand int; nb int[]; nx int; ny int;
        bx int; byy int; bpen numeric; pen numeric; tt text; step int; curd int;
        base numeric; budget numeric; hc numeric; bhc numeric;
begin
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle;
  if u.id is null or not u.alive or u.moved or coalesce(u.speed,0) <= 0
     or u.cls = 'ss13' then return path; end if;
  select * into b from public.battles where id = p_battle;

  base := public._bt_step_cost(u.speed);
  if u.stance = 'eng' then base := base * public._bt_eng_mult(); end if;
  budget := coalesce(u.tp, 0);
  cx := u.x; cy := u.y;

  for step in 1..40 loop
    curd := public._bt_dist(cx, cy, p_tx, p_ty);
    exit when curd <= greatest(1, p_goal);
    d := public._bt_dirof(cx, cy, p_tx, p_ty);
    bx := null; bpen := 1e9; bhc := 0;
    -- шире веер направлений: у рваной арены прямой курс часто упирается в пустоту
    foreach cand in array array[d, (d + 1) % 6, (d + 5) % 6, (d + 2) % 6, (d + 4) % 6] loop
      nb := public._bt_step(cx, cy, cand);
      nx := nb[1]; ny := nb[2];
      if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then continue; end if;
      if not public._bt_in_arena(b.shape, nx, ny) then continue; end if;   -- пустота
      if public._bt_dist(nx, ny, p_tx, p_ty) >= curd then continue; end if;   -- не приближает
      if exists(select 1 from public.battle_units
                 where battle_id = p_battle and alive and x = nx and y = ny) then continue; end if;
      if exists(select 1 from jsonb_array_elements(path) e
                 where (e->>'x')::int = nx and (e->>'y')::int = ny) then continue; end if;
      tt := public._bt_terra(b.terrain, nx, ny);
      hc := base * public._bt_terra_mult(tt);
      if budget < hc then continue; end if;              -- не по карману
      -- предпочтение: дешевле пройти, а пояс ещё и грызёт обшивку
      pen := public._bt_terra_mult(tt) + case when tt = 'ast' then 0.5 else 0 end;
      if pen < bpen then bpen := pen; bx := nx; byy := ny; bhc := hc; end if;
    end loop;
    exit when bx is null;                      -- шагнуть некуда или нечем
    path := path || jsonb_build_array(jsonb_build_object('x', bx, 'y', byy));
    budget := budget - bhc;
    cx := bx; cy := byy;
  end loop;
  return path;
end$fn$;
revoke all on function public._bt_bot_path(uuid,uuid,int,int,int) from public;

-- ── Проверка ───────────────────────────────────────────────────────────
--   select public._bt_terra_mult('ast');            → 2.2
--   select public._bt_hex_cost(terrain, 0.75, 30, 30) from public.battles limit 1;
