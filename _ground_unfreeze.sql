-- ════════════════════════════════════════════════════════════
-- НАЗЕМКА · СНЯТИЕ ЗАМОРОЗКИ (19.10.2026)
-- Пехота и наземная техника снова регистрируются и строятся.
-- Авиация по решению владельца остаётся замороженной: сервер не даёт ни
-- зарегистрировать её проект, ни заказать её производство. Снять заморозку
-- авиации — вернуть false в public._ground_frozen().
-- Клиент: constructors.js (cnFrozenCat / cnFrozenArmyClass),
--         economy.js (EC_ARMY_FROZEN = false, EC_AIR_FROZEN = true).
-- Уже применено в базе. Повторный запуск безопасен.
-- ════════════════════════════════════════════════════════════

create or replace function public._ground_freeze_gate() returns trigger
language plpgsql as $$
begin
  if new.category = 'aviation' and public._ground_frozen() then
    raise exception 'производство авиации пока заморожено';
  end if;
  return new;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.economy_publish_unit__raw'::regproc);
  if position('авиация пока заморожена' in d) = 0 then
    execute replace(d, 'if p_category not in (''ship'',''ground'',''aviation'',''division'') then raise exception ''bad category''; end if;',
      'if p_category not in (''ship'',''ground'',''aviation'',''division'') then raise exception ''bad category''; end if;
  if p_category = ''aviation'' and public._ground_frozen() then raise exception ''авиация пока заморожена — регистрировать можно пехоту и наземную технику''; end if;');
  end if;
end $$;
