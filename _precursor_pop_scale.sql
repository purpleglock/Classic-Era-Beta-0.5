-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · НАСЕЛЕНИЕ В ИГРОВЫХ ЕДИНИЦАХ + ДАТЫ ДЛЯ СТАРЫХ ЗАПИСЕЙ
--
-- 1. Население дозвёздных считалось «по-настоящему» — миллиардами, тогда как вся
--    остальная игра живёт в единицах колоний (100 на ячейку, держава на 200
--    колоний ≈ 80 000). Дикарь с копьём выходил крупнее космической империи.
--    Пересчитываем по фазе: старая опорная величина фазы → новая, разброс мира
--    внутри фазы сохраняем.
-- 2. Записи летописи, сделанные ДО триггера дат (_precursor_chron_dates.sql),
--    остались без 'at'. Живые (вмешательства, недельные паузы, взлёт) датируем
--    по журналу primitive_acts, помечая 'approx' — клиент рисует их с «≈».
--    Дописанное генератором прошлое дат не получает: у него своё летоисчисление.
-- ════════════════════════════════════════════════════════════

-- ── 1. население ──────────────────────────────────────────
do $$
declare
  old_base numeric[] := array[4e4, 5e5, 3e6, 1.2e7, 4e7, 1.1e8, 3e8, 1.6e8, 7e8, 2.2e9, 6e9, 9e9];
  new_base numeric[] := array[6, 15, 45, 110, 260, 520, 900, 700, 1500, 2600, 4500, 6500];
  r record; ph int;
begin
  for r in select system_id, pid, phase, pop from public.primitive_civs where pop > 3000 loop
    ph := greatest(0, least(11, r.phase)) + 1;   -- массивы в pg с единицы
    update public.primitive_civs
       set pop = greatest(1, round(r.pop * new_base[ph] / old_base[ph]))::bigint
     where system_id = r.system_id and pid = r.pid;
  end loop;
end$$;

-- ── 2. даты для старых «живых» записей ────────────────────
do $$
declare
  r record; e jsonb; i int; k int; arr jsonb; ts timestamptz; acts timestamptz[];
begin
  for r in select system_id, pid, chronicle, contacted_at, last_act_at, created_at
             from public.primitive_civs
            where chronicle::text like '%"ph": "вмешательство"%'
               or chronicle::text like '%"ph": "пауза"%'
               or chronicle::text like '%"ph": "★"%'
               or chronicle::text like '%"ph": "конец"%' loop
    select coalesce(array_agg(a.at order by a.at), '{}') into acts
      from public.primitive_acts a where a.system_id = r.system_id and a.pid = r.pid;
    arr := '[]'::jsonb; k := 0;
    for i in 0 .. jsonb_array_length(r.chronicle) - 1 loop
      e := r.chronicle->i;
      if not (e ? 'at') and (e->>'ph') in ('вмешательство', 'пауза', '★', 'конец') then
        k := k + 1;
        ts := coalesce(acts[k], r.last_act_at, r.contacted_at, r.created_at, now());
        e := e || jsonb_build_object(
          'at', to_char(ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'approx', true);
      end if;
      arr := arr || jsonb_build_array(e);
    end loop;
    update public.primitive_civs set chronicle = arr
     where system_id = r.system_id and pid = r.pid;
  end loop;
end$$;
