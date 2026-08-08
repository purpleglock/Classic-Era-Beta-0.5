-- © 2025–2026. Проприетарное ПО. См. LICENSE.
-- ════════════════════════════════════════════════════════════
-- РЕАКТОР → БОЙ: сигнатура и устойчивость перестают быть украшением
-- ────────────────────────────────────────────────────────────
-- До сих пор своя энергоустановка отдавала бою только мощность (энергосеть)
-- и «силу реактора» (скорость). Тепловая сигнатура жила строкой «Заметность»
-- в карточке, запас устойчивости — воротами приёмки на верфи. Теперь оба
-- параметра работают:
--
--   sig  → СКРЫТНОСТЬ борта. Радиаторы — это площадь, а площадь видно:
--          `stealth` борта уменьшается на сигнатуру установки. Дальность
--          вражеского радара считается как (sensor − stealth/2), значит
--          горячий борт враг ловит дальше.
--   stab → ПУЛ ВРЕМЕНИ хода. Исправная установка держит режим и даёт борту
--          больше секунд, аварийная — половину хода уходит на возню с зоной.
--          Нейтраль — 60% запаса (это примерно заводской реактор); шкала
--          половинная (±1% запаса = ±0.5% секунд) и зажата в 0.75…1.25,
--          чтобы бой не превращался в соревнование одних реакторов.
--
-- ⚠ ВСЁ ДЕЛАЕТСЯ В ОДНОМ ТРИГГЕРЕ `_bt_tp_fill`. Мест вставки в
-- battle_units пять (deploy / reinforce / админский / авиакрыло / клуб),
-- и править их по одному — гарантированно забыть одно (см. battle-time-pool).
-- Каталожные реакторы и боты реактора не имеют: коэффициент 1.0, sig 0 —
-- ровно прежнее поведение.
-- ════════════════════════════════════════════════════════════

-- ── 1) Реактор проекта (если он свой, с верфи) ───────────────
-- Проект помнит стабильный `data.reactorId` (см. _reactor_forge_units.sql).
-- Нет проекта, нет своей установки, установку удалили — пустой объект.
create or replace function public._rg_unit_reactor(p_unit_id uuid)
returns jsonb language sql stable as $$
  select coalesce(
    (select jsonb_build_object('sig',  coalesce((r.stats->>'sig')::numeric, 0),
                               'stab', coalesce((r.stats->>'stab')::numeric, 60))
       from public.faction_units u
       join public.faction_reactors r on r.id = (u.data->>'reactorId')::uuid
      where u.id = p_unit_id
        and nullif(u.data->>'reactorId','') is not null),
    '{}'::jsonb);
$$;
grant execute on function public._rg_unit_reactor(uuid) to authenticated;

-- Коэффициент пула времени от запаса устойчивости.
create or replace function public._rg_tp_coef(p_stab numeric)
returns numeric language sql immutable as $$
  select round(least(1.25, greatest(0.75, 1 + (coalesce(p_stab, 60) - 60) / 200.0)), 3);
$$;
grant execute on function public._rg_tp_coef(numeric) to authenticated;

-- ── 2) Заполнение борта на доске ─────────────────────────────
-- Основа — _bt_timepool.sql; добавлены два последних блока.
create or replace function public._bt_tp_fill()
returns trigger language plpgsql as $$
declare sp jsonb; rg jsonb; k numeric;
begin
  sp := public._bt_shield_spec(new.cls);
  new.tp_max     := public._bt_tp_max();
  new.tp         := new.tp_max;
  new.mitig      := (sp->>'m')::numeric;
  new.reduc      := (sp->>'r')::numeric;
  new.shield     := 0;            -- секунд щита поднято: на своём ходу ещё не решали
  new.max_shield := 0;            -- легаси-ёмкость больше не участвует в расчёте

  -- Своя энергоустановка правит пул и заметность. Боты и каталожные реакторы
  -- сюда не попадают — у них нет ни проекта, ни reactorId.
  rg := public._rg_unit_reactor(new.unit_id);
  if rg ? 'stab' then
    k := public._rg_tp_coef((rg->>'stab')::numeric);
    new.tp_max := round(new.tp_max * k, 2);
    new.tp     := new.tp_max;
    -- Тепловая сигнатура срезает скрытность борта. В ноль уводить нельзя:
    -- нулевая скрытность = радар врага на полную дальность, а это уже не
    -- «горячий борт», а слепой борт.
    new.stealth := greatest(1, new.stealth - round(coalesce((rg->>'sig')::numeric, 0))::int);
  end if;
  return new;
end$$;
drop trigger if exists trg_bt_tp_fill on public.battle_units;
create trigger trg_bt_tp_fill before insert on public.battle_units
  for each row execute function public._bt_tp_fill();

-- ── 3) Самопроверка ──────────────────────────────────────────
do $$
begin
  if public._rg_tp_coef(60) <> 1.0 then raise exception 'нейтраль пула сбита: %', public._rg_tp_coef(60); end if;
  if public._rg_tp_coef(15) <> 0.775 then raise exception 'аварийный реактор: %', public._rg_tp_coef(15); end if;
  if public._rg_tp_coef(100) <> 1.2 then raise exception 'исправный реактор: %', public._rg_tp_coef(100); end if;
  if public._rg_tp_coef(0) <> 0.75 then raise exception 'нижний зажим: %', public._rg_tp_coef(0); end if;
  raise notice 'реактор→бой: пул 0.775…1.2 от устойчивости, сигнатура режет скрытность';
end$$;
