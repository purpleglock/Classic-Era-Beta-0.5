-- ============================================================
-- ПРОСТРАНСТВЕННАЯ ЭКОНОМИКА · СРЕЗ 1 — паспорта домиков + баланс системы
-- Выполнить целиком в Supabase → SQL Editor.
-- Чистая математика: НИЧЕГО не меняет в деньгах (economy_accrue не трогаем).
-- Доход начнёт зависеть от баланса в Срезе 2 (_system_prosperity в economy_accrue).
-- Требует: public.colonies, public.colony_buildings, public.map_systems,
--          public.faction_applications, public.current_user_role().
-- ============================================================

-- ── Паспорт домика (на 1 слот × slots) ──────────────────────
--   Каждый тип = вектор: что ПРОИЗВОДИТ (ro/go/co) и ПОТРЕБЛЯЕТ (ri/gi/ci) по
--   3 категориям благ — сырьё(r) · товары(g) · потребление(c) — плюс труд(l).
--   Шкала 0..3 на слот. Источник истины чисел — таблица паспортов в дизайне;
--   зеркалить при изменении в economy.js (срез 2+).
create or replace function public._building_vector(p_btype text, p_slots numeric, p_tnp boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'ro', ro*s, 'go', go*s, 'co', co*s,
    'ri', ri*s, 'gi', gi*s, 'ci', ci*s, 'l', l*s)
  from (select
    -- произв. сырья
    case p_btype when 'mining' then 3 else 0 end as ro,
    -- произв. товаров (фабрика в обычном режиме)
    case p_btype when 'factory' then (case when p_tnp then 0 else 3 end) else 0 end as go,
    -- произв. потребления (фабрика в ТНП-режиме = еда/ТНП; храм = соц.услуги)
    case p_btype when 'factory' then (case when p_tnp then 3 else 0 end)
                 when 'temple'  then 1 else 0 end as co,
    -- потр. сырья
    case p_btype when 'factory' then (case when p_tnp then 1 else 2 end)
                 when 'military_factory' then 2 when 'shipyard' then 3 else 0 end as ri,
    -- потр. товаров
    case p_btype when 'science' then 1 when 'training' then 1 when 'intel' then 1
                 when 'military_factory' then 1 when 'shipyard' then 2 else 0 end as gi,
    -- потр. потребления (казармы кормят солдат)
    case p_btype when 'training' then 1 else 0 end as ci,
    -- труд
    case p_btype
      when 'mining' then 1 when 'factory' then 2 when 'trade' then 1 when 'market' then 1
      when 'warehouse' then 0.5 when 'science' then 2 when 'training' then 2 when 'intel' then 1
      when 'military_factory' then 2 when 'shipyard' then 3 when 'temple' then 1 else 0 end as l,
    coalesce(p_slots, 0)::numeric as s
  ) v
$$;
revoke all on function public._building_vector(text,numeric,boolean) from public;
grant execute on function public._building_vector(text,numeric,boolean) to anon, authenticated;

-- ── Баланс системы ──────────────────────────────────────────
--   Сводит векторы всех домиков системы + население (= Σ cells колоний: даёт
--   труд ×1, ест потребление ×0.5). Возвращает покрытия по R/G/C/труду,
--   цены-множители продавцам, черновую просперити и статус.
--   ⚠ Срез 1: статус МГНОВЕННЫЙ (без накопления тиков — это срез 4),
--   просперити ещё НЕ применяется к деньгам (это срез 2).
create or replace function public._system_balance(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; v jsonb;
  sup_r numeric:=0; sup_g numeric:=0; sup_c numeric:=0;
  dem_r numeric:=0; dem_g numeric:=0; dem_c numeric:=0;
  lab_d numeric:=0; pop numeric:=0; lab_s numeric;
  cov_r numeric; cov_g numeric; cov_c numeric; cov_l numeric;
  pr_r numeric; pr_g numeric; pr_c numeric;
  welfare numeric; prosperity numeric; st text;
begin
  select coalesce(sum(cells),0) into pop from public.colonies where system_id = p_system_id;

  for r in
    select cb.btype, cb.slots_open, cb.tnp_mode
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where c.system_id = p_system_id
  loop
    v := public._building_vector(r.btype, r.slots_open, coalesce(r.tnp_mode,false));
    sup_r := sup_r + (v->>'ro')::numeric; sup_g := sup_g + (v->>'go')::numeric; sup_c := sup_c + (v->>'co')::numeric;
    dem_r := dem_r + (v->>'ri')::numeric; dem_g := dem_g + (v->>'gi')::numeric; dem_c := dem_c + (v->>'ci')::numeric;
    lab_d := lab_d + (v->>'l')::numeric;
  end loop;

  -- население: труд и потребление (еда/ТНП)
  lab_s := pop * 1;
  dem_c := dem_c + pop * 0.5;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_c := case when dem_c<=0 then 1 else round(sup_c/dem_c,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  -- цена-множитель ПРОДАВЦУ блага: дефицит платит больше, затоварка меньше (0.5..1.6)
  pr_r := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_r))),3);
  pr_g := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_g))),3);
  pr_c := round(least(1.6, greatest(0.5, 1 + 0.6*(1-cov_c))),3);

  -- довольство = слабейшее из (потребление, труд); просперити 0.4..1.6
  welfare := least(2.0, greatest(0, least(cov_c, cov_l)));
  prosperity := round(least(1.6, greatest(0.4, 0.4 + 0.6*welfare)),3);

  if cov_c < 0.4 or cov_l < 0.4 then st := 'stagnation';
  elsif cov_c < 0.7 or cov_l < 0.7 then st := 'unrest';
  else st := 'ok'; end if;

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', pop,
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g,'c',sup_c),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g,'c',dem_c),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'c',cov_c,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g,'c',pr_c),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance(text) from public;
grant execute on function public._system_balance(text) to anon, authenticated;

-- ── RPC: баланс всех систем текущей фракции (для UI-полоски дефицита) ──
create or replace function public.spatial_status()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare app public.faction_applications; res jsonb := '[]'::jsonb; s record;
begin
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then return res; end if;
  for s in
    select distinct c.system_id, ms.name
    from public.colonies c
    left join public.map_systems ms on ms.id = c.system_id
    where c.faction_id = app.faction_id and c.system_id is not null
  loop
    res := res || jsonb_build_array(
      public._system_balance(s.system_id) || jsonb_build_object('name', s.name)
    );
  end loop;
  return res;
end$$;
revoke all on function public.spatial_status() from public;
grant execute on function public.spatial_status() to authenticated;
