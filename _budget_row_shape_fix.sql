-- Фикс: «cannot cast type record to faction_budget».
-- _budget_row собирал дефолтную строку через row(...) с ЖЁСТКИМ числом полей (8),
-- а _state_union.sql добавил 9-й столбец union_origin → позиционный каст ломался,
-- и с ним падали все читатели бюджета (план рабочих, экономика).
-- Собираем запись по ИМЕНАМ полей — новые столбцы больше не ломают функцию.
create or replace function public._budget_row(p_fid text)
returns public.faction_budget
language sql stable as $$
  select coalesce(
    (select b from public.faction_budget b where b.faction_id = p_fid),
    jsonb_populate_record(null::public.faction_budget, jsonb_build_object(
      'faction_id', p_fid,
      'industry', 2, 'military', 2, 'science', 2, 'social', 2, 'infra', 2,
      'updated_at', now(), 'industry_eff', 2)));
$$;
