-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 5: ПЕЧАТИ ВИДНЫ НА ДОСКЕ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_battle.sql (это его надмножество по _bt_arm).
-- ⚠️ Правки _bt_arm вести ОТСЮДА.
--
-- ЗАЧЕМ. На доске у ангела нет полосы корпуса — урона не существует, полоса
-- всегда была бы полной и врала бы.
--
-- ⚠️ И ШКАЛЫ ТОЖЕ НЕТ. Первая версия честно клала сюда долю печатей, а клиент
-- рисовал её десятью делениями. Это был калькулятор: враг пересчитывал деления
-- в оставшиеся залпы и переставал бояться — а заодно точное число уезжало в
-- сетевой трафик, где его достанет любой, кому не лень открыть консоль.
--
-- Осталась ОДНА ступень из трёх (pk.dim) — ею клиент только приглушает свечение
-- спрайта. Разницу между 100 и 80 печатями по ней не увидеть; видно лишь, что
-- «оно горит тише, чем в прошлый раз». Это ощущение, а не показание прибора, —
-- ровно столько игроку и полагается.
-- ════════════════════════════════════════════════════════════

create or replace function public._bt_arm(p_battle uuid)
returns void language plpgsql security definer set search_path=public as $$
declare vw int; vh int; af text; sf numeric; dim numeric;
begin
  select b.bw, b.bh into vw, vh from public.battles b where b.id = p_battle;
  perform set_config('bt.w', coalesce(vw, public._bt_wbig())::text, true);
  perform set_config('bt.h', coalesce(vh, public._bt_hbig())::text, true);

  af := public._angel_fid();
  if af is null then return; end if;
  if not exists(select 1 from public.battle_units u
                 where u.battle_id = p_battle and u.fid = af) then return; end if;

  select greatest(0, least(1, a.seals / nullif(public._angel_const('seals_max'),0)))
    into sf from public.angel_state a where a.faction_id = af;
  -- три ступени, не доля: 1.0 пока цело, 0.62 когда уже долго бьют, 0.34 в конце
  dim := case when sf > 0.62 then 1.0 when sf > 0.24 then 0.62 else 0.34 end;

  -- Одним заходом: снять всё, что успело налипнуть за ход (перезарядки,
  -- дебаффы, ослепление, потраченное время), и обновить долю печатей.
  -- Флаг acted НЕ трогаем: бюджет действий стороны — единственное, что вообще
  -- заканчивает ход ангела.
  update public.battle_units u
     set hp = u.max_hp, alive = true,
         tp = u.tp_max, mcd = '{}'::jsonb, deb = '{}'::jsonb,
         blind = 0, moved = false, fired = false,
         pk = (coalesce(u.pk, '{}'::jsonb) - 'seal') || jsonb_build_object('dim', dim)
   where u.battle_id = p_battle and u.fid = af;
end$$;

notify pgrst, 'reload schema';
