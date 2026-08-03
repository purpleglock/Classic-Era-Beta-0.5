-- ═══════════════════════════════════════════════════════════════
-- ТРУД СЧИТАЕТСЯ В ЛЮДЯХ (вариант A)
-- ---------------------------------------------------------------
-- Было: предложение труда = число ЯЧЕЕК колонии (cells × pop_mult),
-- спрос = слоты × вес (1..3). Одна ячейка давала 1 «руку», а шести-
-- слотовая фабрика на ней требовала 12 — покрытие в принципе не
-- могло дойти до 1, и множитель труда сидел внизу при любом
-- населении. Население на него не влияло ВООБЩЕ.
--
-- Стало: обе стороны в жителях.
--   предложение = эффективное население системы (colonies.pop × pop_mult)
--   спрос       = Σ(слоты × вес btype) × _labor_pop_per_unit() [10 жителей]
--
-- Цена 10 жителей на единицу веса выбрана так, чтобы ПОЛНАЯ застройка
-- при ПОЛНОМ населении давала покрытие ≈1.00:
--   потолок населения = 100 × ячейку; полная застройка ≈ 10 единиц
--   веса на ячейку (6 слотов × средний вес ~1.7) → 100/10 = 10.
--
-- ВАЖНО: _budget_auto_slots (3 жителя на слот, срез слотов при нехватке
-- рук) НЕ трогаем — иначе у всех держав разом урезало бы постройки.
-- Это отдельная, более мягкая система; в гайдбуке они теперь разделены.
--
-- Переопределяет: _system_balance, _system_balance_net (поверх
-- _spatial_economy_soften.sql — это то, что сейчас живёт в базе).
-- Добавляет: _labor_pop_per_unit(), поле 'pop_people' в баланс.
-- Поле 'pop' оставлено КАК БЫЛО (ёмкость × заселённость) — на нём
-- висит цена мер poverty_relief.
-- ═══════════════════════════════════════════════════════════════

-- ── Цена одной единицы трудового веса, в жителях ───────────────
create or replace function public._labor_pop_per_unit()
returns numeric language sql immutable as $$ select 10::numeric $$;
revoke all on function public._labor_pop_per_unit() from public;
grant execute on function public._labor_pop_per_unit() to anon, authenticated;

-- ── Баланс системы (raw) ───────────────────────────────────────
create or replace function public._system_balance(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  r record; v jsonb;
  sup_r numeric:=0; sup_g numeric:=0;
  dem_r numeric:=0; dem_g numeric:=0;
  lab_u numeric:=0;                    -- спрос в ЕДИНИЦАХ веса
  pop numeric:=0;                      -- ёмкость × заселённость (легаси, для цен мер)
  pop_p numeric:=0;                    -- эффективное население в ЛЮДЯХ
  lab_s numeric; lab_d numeric; k numeric;
  cov_r numeric; cov_g numeric; cov_l numeric;
  pr_r numeric; pr_g numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  k := public._labor_pop_per_unit();

  -- легаси-«население» (ёмкость × миграция) — на нём цена poverty_relief
  select coalesce(sum(cells * coalesce(pop_mult,1)),0) into pop
    from public.colonies where system_id = p_system_id;

  -- настоящие жители системы с поправкой на отток (pop_mult)
  select coalesce(sum(coalesce(c.pop, coalesce(c.cells,0)*50) * coalesce(c.pop_mult,1)),0) into pop_p
    from public.colonies c where c.system_id = p_system_id;

  for r in
    select cb.btype, cb.slots_open
    from public.colony_buildings cb
    join public.colonies c on c.id = cb.colony_id
    where c.system_id = p_system_id
  loop
    v := public._building_vector(r.btype, r.slots_open, false);
    sup_r := sup_r + (v->>'ro')::numeric; sup_g := sup_g + (v->>'go')::numeric;
    dem_r := dem_r + (v->>'ri')::numeric; dem_g := dem_g + (v->>'gi')::numeric;
    lab_u := lab_u + (v->>'l')::numeric;
  end loop;

  lab_s := pop_p;                      -- рабочие руки = жители
  lab_d := lab_u * k;                  -- рабочие места = жители, которых они требуют

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  -- цены: мягкая премия/скидка ±15% (товары → лёгкая премия фабрикам)
  pr_r := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_r))),3);
  pr_g := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_g))),3);

  -- ПРОСПЕРИТИ = только труд (обеспеченность рабочими руками), 0.85..1.30
  welfare := least(1.5, greatest(0, cov_l));
  prosperity := round(least(1.30, greatest(0.85, 0.85 + 0.30*welfare)),3);
  if cov_l < 0.3 then st := 'stagnation';
  elsif cov_l < 0.5 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', pop, 'pop_people', pop_p,
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d,'units',lab_u,'k',k),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance(text) from public;
grant execute on function public._system_balance(text) to anon, authenticated;

-- ── Баланс NET: + спилловер сырья/товаров от соседей (труд локален) ──
create or replace function public._system_balance_net(p_system_id text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  raw jsonb; src jsonb; ng record;
  sup_r numeric; sup_g numeric;
  dem_r numeric; dem_g numeric;
  lab_s numeric; lab_d numeric;
  sp_r numeric:=0; sp_g numeric:=0;
  nsurp_r numeric:=0; nsurp_g numeric:=0;
  spill numeric;
  v_fac text;
  cov_r numeric; cov_g numeric; cov_l numeric;
  pr_r numeric; pr_g numeric;
  welfare numeric; prosperity numeric; st text; adj jsonb;
begin
  raw := public._system_balance(p_system_id);
  sup_r := (raw->'supply'->>'r')::numeric; sup_g := (raw->'supply'->>'g')::numeric;
  dem_r := (raw->'demand'->>'r')::numeric; dem_g := (raw->'demand'->>'g')::numeric;
  lab_s := (raw->'labor'->>'supply')::numeric; lab_d := (raw->'labor'->>'demand')::numeric;

  -- ПАССИВНЫЙ СПИЛЛОВЕР: соседи той же фракции гасят остаточный дефицит
  select faction into v_fac from public.map_systems where id = p_system_id;
  if v_fac is not null then
    for ng in
      select case when h.a_id = p_system_id then h.b_id else h.a_id end as nid
      from public.map_hyperlanes h
      where h.a_id = p_system_id or h.b_id = p_system_id
    loop
      if (select faction from public.map_systems where id = ng.nid) is distinct from v_fac then continue; end if;
      src := public._system_balance(ng.nid);
      nsurp_r := nsurp_r + greatest(0, (src->'supply'->>'r')::numeric - (src->'demand'->>'r')::numeric);
      nsurp_g := nsurp_g + greatest(0, (src->'supply'->>'g')::numeric - (src->'demand'->>'g')::numeric);
    end loop;
    if dem_r > sup_r then spill := least((dem_r-sup_r)*0.6, nsurp_r*0.15); sup_r := sup_r + spill; sp_r := spill; end if;
    if dem_g > sup_g then spill := least((dem_g-sup_g)*0.6, nsurp_g*0.15); sup_g := sup_g + spill; sp_g := spill; end if;
  end if;

  cov_r := case when dem_r<=0 then 1 else round(sup_r/dem_r,3) end;
  cov_g := case when dem_g<=0 then 1 else round(sup_g/dem_g,3) end;
  cov_l := case when lab_d<=0 then 1 else round(lab_s/lab_d,3) end;

  pr_r := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_r))),3);
  pr_g := round(least(1.15, greatest(0.90, 1 + 0.15*(1-cov_g))),3);

  welfare := least(1.5, greatest(0, cov_l));
  prosperity := round(least(1.30, greatest(0.85, 0.85 + 0.30*welfare)),3);
  if cov_l < 0.3 then st := 'stagnation';
  elsif cov_l < 0.5 then st := 'unrest';
  else st := 'ok'; end if;

  adj := public._econ_adjust(p_system_id, prosperity, st);
  prosperity := (adj->>'prosperity')::numeric; st := adj->>'status';

  return jsonb_build_object(
    'system_id', p_system_id, 'pop', raw->'pop', 'pop_people', raw->'pop_people',
    'supply',   jsonb_build_object('r',sup_r,'g',sup_g),
    'demand',   jsonb_build_object('r',dem_r,'g',dem_g),
    'labor',    jsonb_build_object('supply',lab_s,'demand',lab_d,
                                   'units',raw->'labor'->'units','k',raw->'labor'->'k'),
    'coverage', jsonb_build_object('r',cov_r,'g',cov_g,'l',cov_l),
    'prices',   jsonb_build_object('r',pr_r,'g',pr_g),
    'spill',    jsonb_build_object('r',sp_r,'g',sp_g),
    'prosperity', prosperity, 'status', st
  );
end$$;
revoke all on function public._system_balance_net(text) from public;
grant execute on function public._system_balance_net(text) to anon, authenticated;

-- Проверка:
-- select public._system_balance_net('<system_id>');
