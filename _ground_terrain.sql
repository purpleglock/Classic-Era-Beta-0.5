-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА · РЕЛЬЕФ НАЗЕМНОГО БОЯ  (19.10.2026)
-- ------------------------------------------------------------
-- Космический рельеф (астероиды / обломки / туманности / колодцы) в
-- наземном бою заменён своим. Три новых кода клеток:
--   'mtn' ГОРЫ  — непроходимы, закрывают линию огня. Хребты и массивы:
--                 бой идёт через перевалы.
--   'clf' ОБРЫВ — непроходим, но простреливается насквозь: через пропасть
--                 видно и стреляют, перейти нельзя.
--   'rck' ОСЫПЬ — каменистый склон: вход ×1.5 к цене хода, стоящий на
--                 осыпи получает на 15% меньше урона (укрытие).
-- Непроходимость — множитель цены хода 99: на него не хватит ни одного
-- хода, поэтому и доска, и ИИ, и сервер обходят такие клетки сами; сервер
-- вдобавок прямо отказывает с понятной причиной.
-- Поле наземного боя — сплошной прямоугольник 30×22 (без космических
-- рваных кромок). Планировки (выбор детерминирован по id боя):
--   хребет  — гряда поперёк оси боя с двумя-тремя перевалами;
--   долина  — две горные цепи по флангам, в долине обрывы и осыпи;
--   массив  — горный массив в центре, обходы по флангам, обрывы-уступы.
-- Космические бои не меняются: все правки срабатывают только на новых кодах
-- или при kind = 'ground'. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════

-- ── Цена и свойства клеток ───────────────────────────────────
create or replace function public._bt_terra_mult(k text) returns numeric
language sql immutable as $$
  select case k when 'ast' then 2.2 when 'deb' then 1.5 when 'neb' then 1.25
                when 'rck' then 1.5 when 'mtn' then 99 when 'clf' then 99
                else 1.0 end
$$;

create or replace function public._bt_flow_cost(k text) returns integer
language sql immutable as $$
  select case k when 'ast' then 3 when 'deb' then 2 when 'neb' then 2
                when 'rck' then 2 when 'mtn' then 99 when 'clf' then 99
                else 1 end
$$;

create or replace function public._bt_terra_pen(k text) returns numeric
language sql immutable as $$
  select case k when 'ast' then 14 when 'neb' then 6 when 'deb' then 3
                when 'rck' then 3 when 'mtn' then 99 when 'clf' then 99
                else 0 end::numeric
$$;

create or replace function public._ground_impassable(k text) returns boolean
language sql immutable as $$ select k in ('mtn', 'clf') $$;

-- ── Точечные врезки в движок ─────────────────────────────────
do $$
declare d text;
begin
  -- линию огня закрывают и горы
  d := pg_get_functiondef('public._bt_los_clear(jsonb,integer,integer,integer,integer)'::regprocedure);
  if position('''mtn''' in d) = 0 then
    execute replace(d, 'if public._bt_terra(t, hx, hy) = ''ast'' then return false; end if;',
                       'if public._bt_terra(t, hx, hy) in (''ast'', ''mtn'') then return false; end if;');
  end if;

  -- осыпь — укрытие, как обломки
  d := pg_get_functiondef('public._bt_do_fire(uuid,uuid,uuid,text)'::regprocedure);
  if position('''rck''' in d) = 0 then
    execute replace(d, 'if public._bt_terra(b.terrain, t.x, t.y) = ''deb'' then dmgfac := 0.85; end if;',
                       'if public._bt_terra(b.terrain, t.x, t.y) in (''deb'', ''rck'') then dmgfac := 0.85; end if;');
  end if;
  d := pg_get_functiondef('public._bt_hit(uuid,numeric,text,jsonb,boolean,uuid)'::regprocedure);
  if position('''rck''' in d) = 0 then
    execute replace(d, 'if public._bt_terra(p_terr, t.x, t.y) = ''deb'' then dmgfac := 0.85; end if;',
                       'if public._bt_terra(p_terr, t.x, t.y) in (''deb'', ''rck'') then dmgfac := 0.85; end if;');
  end if;

  -- ход: в горы и обрывы не войти, причина — прямым текстом
  d := pg_get_functiondef('public._bt_do_move(uuid,uuid,jsonb,text)'::regprocedure);
  if position('_ground_impassable' in d) = 0 then
    execute replace(d, '    hc := public._bt_hex_cost(b.terrain, cost, nx, ny);',
      '    if public._ground_impassable(public._bt_terra(b.terrain, nx, ny)) then
      raise exception ''клетка %:% непроходима — %'', nx, ny,
        case when public._bt_terra(b.terrain, nx, ny) = ''mtn'' then ''горы, обходите через перевал''
             else ''обрыв: через него можно стрелять, но не пройти'' end;
    end if;
    hc := public._bt_hex_cost(b.terrain, cost, nx, ny);');
  end if;

  -- ополчение, постройки и авторасстановка не встают в горы и на обрыв
  d := pg_get_functiondef('public._ground_free_cell(uuid,text,integer)'::regprocedure);
  if position('''mtn''' in d) = 0 then
    execute replace(d, '(select terrain from public.battles where id = p_battle), gx, gy), '''') <> ''ast''',
                       '(select terrain from public.battles where id = p_battle), gx, gy), '''') not in (''ast'', ''mtn'', ''clf'')');
  end if;

  -- форма поля: наземный бой — сплошной прямоугольник
  d := pg_get_functiondef('public._bt_gen_shape(uuid)'::regprocedure);
  if position('''ground''' in d) = 0 then
    execute replace(d, '  roll := random();',
      '  if kd = ''ground'' then return jsonb_build_object(''k'', ''rect'', ''w'', w, ''h'', h); end if;
  roll := random();');
  end if;

  -- рельеф: наземный бой — свой генератор
  d := pg_get_functiondef('public._bt_gen_terrain(uuid)'::regprocedure);
  if position('_ground_gen_terrain' in d) = 0 then
    execute replace(d, '  perform setseed((abs(hashtext(''zone'' || p_battle::text)) % 100000) / 100000.0);',
      '  if kd = ''ground'' then return public._ground_gen_terrain(p_battle); end if;
  perform setseed((abs(hashtext(''zone'' || p_battle::text)) % 100000) / 100000.0);');
  end if;
end $$;

-- ── Генератор наземного рельефа ──────────────────────────────
create or replace function public._ground_gen_terrain(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w int := public._bt_w(); h int := public._bt_h();
        sh jsonb; sp jsonb; phi numeric; uv numeric[];
        axu numeric; ayv numeric; bxu numeric; byv numeric;
        res jsonb := '{}'::jsonb; arch text; roll numeric; i int; s int;
        aa numeric; pp numeric; ap numeric[]; g1 numeric; g2 numeric; g3 numeric;
begin
  select b.shape, b.spawn into sh, sp from public.battles b where b.id = p_battle;
  perform setseed((abs(hashtext('ground' || p_battle::text)) % 100000) / 100000.0);

  -- ось боя: от якоря атакующего к якорю защитника (как у космоса)
  if sp is null then
    phi := 0;
  else
    uv := public._bt_norm(w, h, coalesce((sp->'att'->>'x')::int, 0), coalesce((sp->'att'->>'y')::int, 0));
    axu := uv[1]; ayv := uv[2];
    uv := public._bt_norm(w, h, coalesce((sp->'def'->>'x')::int, 0), coalesce((sp->'def'->>'y')::int, 0));
    bxu := uv[1]; byv := uv[2];
    if abs(bxu - axu) < 0.0001 and abs(byv - ayv) < 0.0001 then phi := 0;
    else phi := atan2(byv - ayv, bxu - axu); end if;
  end if;

  roll := random();
  arch := case when roll < 0.40 then 'ridge' when roll < 0.72 then 'valley' else 'massif' end;
  s := case when random() < 0.5 then -1 else 1 end;

  if arch = 'ridge' then
    -- ХРЕБЕТ поперёк оси: два-три перевала, у перевалов осыпь —
    -- кто занял склон над перевалом, тот и держит проход.
    g1 := -0.55 + random() * 0.15;
    g2 :=  0.05 + random() * 0.20 - 0.10;
    g3 :=  0.55 - random() * 0.15;
    res := public._bt_zcross(res, sh, sp, phi, -1.0, 1.0, (random() * 0.16 - 0.08)::numeric, 'mtn',
                             case when random() < 0.5 then array[g1, g3] else array[g1, g2, g3] end,
                             0.09, 0.08);
    res := public._bt_zblob(res, sh, sp, phi, -0.18, g1, 1, 'rck');
    res := public._bt_zblob(res, sh, sp, phi,  0.18, g3, 1, 'rck');
    -- обрыв вдоль одного фланга: обход есть, но по краю пропасти
    res := public._bt_zline(res, sh, sp, phi, -0.75, -0.25, 0.80 * s, 'clf', null, 0, 0);
    res := public._bt_zline(res, sh, sp, phi,  0.25,  0.75, -0.80 * s, 'clf', null, 0, 0);
    -- одиночные скалы на подступах
    res := public._bt_zblob(res, sh, sp, phi, -0.45,  0.35 * s, 1, 'rck');
    res := public._bt_zblob(res, sh, sp, phi,  0.45, -0.35 * s, 1, 'rck');

  elsif arch = 'valley' then
    -- ДОЛИНА: горные цепи по флангам сжимают бой в коридор; в долине
    -- обрывы-трещины и осыпи — укрытия посреди открытого поля.
    res := public._bt_zline(res, sh, sp, phi, -1.0, 1.0,  0.78, 'mtn', array[(random() * 0.6 - 0.3)::numeric], 0.10, 0.10);
    res := public._bt_zline(res, sh, sp, phi, -1.0, 1.0, -0.78, 'mtn', array[(random() * 0.6 - 0.3)::numeric], 0.10, 0.10);
    res := public._bt_zline(res, sh, sp, phi, -0.20, 0.20, 0.30 * s, 'clf', null, 0, 0);
    res := public._bt_zcross(res, sh, sp, phi, -0.25, 0.10, (0.15 * s)::numeric, 'clf', null, 0, 0);
    for i in 0..3 loop
      aa := -0.55 + i * 0.37;
      pp := (case when i % 2 = 0 then 0.42 else -0.42 end) * s;
      res := public._bt_zblob(res, sh, sp, phi, aa, pp, 1, 'rck');
    end loop;
    res := public._bt_zblob(res, sh, sp, phi, 0.05, -0.10 * s, 1, 'rck');

  else
    -- МАССИВ: гора в центре закрывает прямую линию, бой расходится по
    -- флангам; уступы-обрывы режут фланги на позиции.
    res := public._bt_zblob(res, sh, sp, phi, 0.0, (random() * 0.2 - 0.1)::numeric, 3, 'mtn');
    res := public._bt_zblob(res, sh, sp, phi, (0.18 * s)::numeric, 0.28, 1, 'mtn');
    res := public._bt_zblob(res, sh, sp, phi, (-0.18 * s)::numeric, -0.28, 1, 'mtn');
    -- осыпь по подножию
    res := public._bt_zblob(res, sh, sp, phi, -0.30, 0.0, 1, 'rck');
    res := public._bt_zblob(res, sh, sp, phi,  0.30, 0.0, 1, 'rck');
    -- уступы на флангах
    res := public._bt_zline(res, sh, sp, phi, -0.55, -0.15,  0.62, 'clf', null, 0, 0);
    res := public._bt_zline(res, sh, sp, phi,  0.15,  0.55, -0.62, 'clf', null, 0, 0);
    res := public._bt_zblob(res, sh, sp, phi,  0.55,  0.62, 1, 'rck');
    res := public._bt_zblob(res, sh, sp, phi, -0.55, -0.62, 1, 'rck');
  end if;

  -- одиночная гора на дальнем фланге — естественное укрытие для артиллерии
  ap := public._bt_zfit(sh, sp, phi, (0.25 + random() * 0.2)::numeric, (0.55 * -s)::numeric);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], 0, 'mtn');
  ap := public._bt_zfit(sh, sp, phi, (-0.25 - random() * 0.2)::numeric, (0.55 * s)::numeric);
  res := public._bt_zblob(res, sh, sp, phi, ap[1], ap[2], 0, 'mtn');

  return res;
end $$;
revoke all on function public._ground_gen_terrain(uuid) from public, anon, authenticated;
