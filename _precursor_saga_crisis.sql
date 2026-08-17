-- Исход «кризис»: счёт перенесён на чужой берег ровно так же, как в «указал»
-- (недоимка гасится, ихора не прибавилось), а цена стоит не на складе игрока,
-- а в рукаве — Долгая Вода вышла к звёздам взысканием.
insert into public.precursor_saga_reward (world, ending, ichor, arrears) values
  ('kailat', 'кризис', 0, 70)
on conflict (world, ending) do update
  set ichor = excluded.ichor, arrears = excluded.arrears;
