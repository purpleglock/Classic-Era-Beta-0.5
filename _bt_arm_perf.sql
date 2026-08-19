-- ==========================================================================
-- _bt_arm: восстановление ангела было ЗАПИСЬЮ на каждый чих
-- --------------------------------------------------------------------------
-- 20.08. `battle_state`/`fc_watch_state` (опрос доски раз в 15 с у КАЖДОГО
-- зрителя) через `_bt_ensure_field` звали `_bt_arm`, а тот безусловно делал
-- UPDATE по бортам ангела. Плюс ход бота дёргает `_bt_arm` из
-- `_bt_cells_build`/`_bt_flow_build`/`_bt_do_move`/… — сотни раз за ход.
-- Итог: чтение доски вставало в очередь за блокировкой строки ангела и
-- падало с 57014 «canceling statement due to statement timeout».
--
-- Правки две, обе без изменения правил боя:
--   1) UPDATE трогает строку, только если ей ЕСТЬ что менять (иначе no-op,
--      ни новой версии строки, ни блокировки);
--   2) в пределах одной транзакции восстановление считается один раз
--      (`bt.armed` = список боёв) — оно идемпотентно, повторы бессмысленны.
-- ==========================================================================

create or replace function public._bt_arm(p_battle uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare vw int; vh int; af text; sf numeric; dim numeric; seen text;
begin
  select b.bw, b.bh into vw, vh from public.battles b where b.id = p_battle;
  perform set_config('bt.w', coalesce(vw, public._bt_wbig())::text, true);
  perform set_config('bt.h', coalesce(vh, public._bt_hbig())::text, true);

  af := public._angel_fid();
  if af is null then return; end if;

  -- уже восстанавливали этот бой в этой транзакции — второй раз нечего делать
  seen := coalesce(current_setting('bt.armed', true), '');
  if position(('|' || p_battle::text || '|') in ('|' || seen || '|')) > 0 then return; end if;

  if not exists(select 1 from public.battle_units u
                 where u.battle_id = p_battle and u.fid = af) then return; end if;

  perform set_config('bt.armed', nullif(seen,'') || case when seen = '' then '' else '|' end
                                 || p_battle::text, true);

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
   where u.battle_id = p_battle and u.fid = af
     and (u.hp is distinct from u.max_hp
       or u.alive is distinct from true
       or u.tp is distinct from u.tp_max
       or coalesce(u.mcd, '{}'::jsonb) <> '{}'::jsonb
       or coalesce(u.deb, '{}'::jsonb) <> '{}'::jsonb
       or coalesce(u.blind, 0) <> 0
       or coalesce(u.moved, false)
       or coalesce(u.fired, false)
       or coalesce(u.pk, '{}'::jsonb) ? 'seal'
       or (coalesce(u.pk, '{}'::jsonb)->>'dim') is distinct from dim::text);
end$function$;
