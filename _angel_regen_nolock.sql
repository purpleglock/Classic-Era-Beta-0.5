-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ЗАРАСТАНИЕ БОЛЬШЕ НЕ ГЛУШИТСЯ ПОПАДАНИЕМ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_voice.sql. Надмножество `_angel_regen`. Идемпотентно.
--
-- ЧТО УБИРАЕМ. Правило «печати зарастают только после ПЯТИ ЧАСОВ без единого
-- попадания» (`calm_h`, живёт с самого _angel_core.sql).
--
-- ПОЧЕМУ ЭТО БЫЛО СЛОМАНО. Оно превращало кризис в объект, который КОНТРЯТ
-- копейками: один самый дешёвый снаряд раз в пять часов — и зарастание стоит
-- на нуле вечно. Не кампания, не выбор, не риск: пять выстрелов в сутки
-- «на поддержание», и ангел не лечится никогда, сколько бы миров он ни съел.
-- Любая механика, которую можно обнулить минимальным регулярным действием,
-- обнуляется именно так, и всё, что построено выше (якоря, часы, Глас),
-- перестаёт что-либо значить.
--
-- ЧТО ВМЕСТО. Зарастание идёт ВСЕГДА, а его скорость задают ТОЛЬКО якоря
-- (см. _angel_anchors.sql). Значит рычаг у игрока ровно один и он на карте:
-- срезать якоря флотом. Дешёвого способа «подержать» кризиса больше нет.
--
-- ЗАМЕР ПО ЖИВОЙ БАЗЕ (86 залпов Длани по ангелу, 20.07–24.08):
--   • пиковые сутки кампании — 42 залпа, то есть выстрел каждые 34 минуты;
--   • снаряд снимает 2.2–3.4 печати → около 118 печатей урона в сутки.
--   Против этого зарастание без «покоя»:
--     1 якорь  — 1.7/час  =  40/сут → кампания выигрывает уверенно;
--     4 якоря  — 7/час    = 169/сут → кампания встаёт;
--     8 якорей — 14/час   = 338/сут → безнадёжно, пока не срежешь якоря.
--   А при вялой стрельбе (раз в 3.4 часа = 20 печатей в сутки) даже ОДИН
--   якорь перебивает огонь. Это и правильно: по кризису надо бить кампанией,
--   а не поплёвывать.
--
-- ⚠️ `last_hit` ПРОДОЛЖАЕМ ПИСАТЬ. Регенерация его больше не читает, но поле
-- живёт и в других слоях (давление, парирование, интерфейс). Перестать его
-- обновлять — тихо сломать соседей.
-- ⚠️ Константу `calm_h` из `_angel_const` НЕ трогаем: она immutable и
-- переписывается целиком в каждом ангельском файле, а её может читать что-то
-- ещё. Просто перестаём на неё смотреть здесь.
-- ════════════════════════════════════════════════════════════
create or replace function public._angel_regen()
returns void language plpgsql security definer set search_path=public as $$
declare a record; hrs numeric; gain numeric; mul numeric; mx numeric;
        f record; anch int; knit numeric;
begin
  mx   := public._angel_const('seals_max');
  knit := 1 + public._angel_grip();          -- Глас: чем выше Вознесение, тем быстрее
  for a in select * from public.angel_state where fell_at is null loop
    -- ⚠️ ЗДЕСЬ СТОЯЛА ПРОВЕРКА ПОКОЯ. Снята намеренно, см. шапку файла.
    hrs := greatest(0, least(24, extract(epoch from (now() - a.last_regen)) / 3600.0));
    if hrs < 0.05 then continue; end if;

    -- ЯКОРЯ — ЕДИНСТВЕННЫЙ РЫЧАГ. Ноль якорей — ноль зарастания: голодному
    -- кризису лечиться нечем, и кампания Длани доходит до конца без отмены.
    select count(*)::int into anch from public.angel_anchor
     where faction_id = a.faction_id and broken_at is null;
    if anch <= 0 then
      update public.angel_state set last_regen = now() where faction_id = a.faction_id;
      continue;
    end if;

    select * into f from public.fleets where id = a.fleet_id;
    mul := case when a.stance = 'roost' and coalesce(f.system_id,'') = coalesce(a.home_sys,'')
                then public._angel_const('roost_mul') else 1 end;
    gain := public._angel_anchor_const('regen_each') * hrs * mul * knit
            * least(anch, public._angel_anchor_const('regen_cap')::int);
    update public.angel_state
       set seals = least(mx, seals + gain), last_regen = now()
     where faction_id = a.faction_id;
  end loop;
end$$;
revoke all on function public._angel_regen() from public;

notify pgrst, 'reload schema';

do $$
declare anch int; grip numeric; rate numeric;
begin
  select count(*) into anch from public.angel_anchor where broken_at is null;
  grip := public._angel_grip();
  rate := public._angel_anchor_const('regen_each')
          * least(anch, public._angel_anchor_const('regen_cap')::int) * (1 + grip);
  raise notice 'якорей %, Вознесение %%%, зарастание %/час (%/сут). Покой больше не требуется.',
    anch, round(grip*100,1), round(rate,2), round(rate*24,1);
end$$;
