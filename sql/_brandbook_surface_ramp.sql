-- Брендбук: чиним лестницу поверхностей.
-- Было: --l-surface-0 = 15% (это «void», самый ТЁМНЫЙ фон) при --l-surface-1 = 4%.
-- Лестница перевёрнута: карточки на --b0 выходили СВЕТЛЕЕ страницы, а при
-- --sat-space 60% на тоне 200 — ещё и залитыми бирюзой. Отсюда «синие плитки».
-- Ставим монотонный ряд и графитовую насыщенность (дефолт токенов — 14%).
-- Откат: вернуть sat-space 60%, l-surface 15/4/9/8/17/9.
update site_settings
   set value = jsonb_set(
         (case when jsonb_typeof(value::jsonb) = 'string'
               then (value::jsonb #>> '{}')::jsonb else value::jsonb end),
         '{vars}',
         (case when jsonb_typeof(value::jsonb) = 'string'
               then (value::jsonb #>> '{}')::jsonb else value::jsonb end) -> 'vars'
           || jsonb_build_object(
                '--sat-space',    '16%',
                '--l-surface-0',  '5%',
                '--l-surface-1',  '8%',
                '--l-surface-2',  '11%',
                '--l-surface-3',  '14%',
                '--l-surface-4',  '18%',
                '--l-surface-5',  '23%'
              )
       )::text
 where key = 'wk_brandbook';

-- _ts вперёд: у клиентов в localStorage лежит старый конфиг, а побеждает
-- более свежий (_vnPickNewer в core.js) — без этого правка не доедет.
update site_settings
   set value = jsonb_set(
         (case when jsonb_typeof(value::jsonb) = 'string'
               then (value::jsonb #>> '{}')::jsonb else value::jsonb end),
         '{_ts}', to_jsonb((extract(epoch from now()) * 1000)::bigint)
       )::text
 where key = 'wk_brandbook';
