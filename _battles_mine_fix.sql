-- ============================================================
-- ФИКС «Сводка недоступна: column reference "fid" is ambiguous».
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Было: в battles_mine (из _war_intercept.sql) plpgsql-переменная называлась
--   fid — и в подзапросе по battle_fleets (у которой есть КОЛОНКА fid)
--   Postgres не мог решить, что имелось в виду. Пока боёв нет, jsonb_agg
--   не выполняется и всё «работает»; первый же бой валит функцию, кабинет
--   глотал ошибку через .catch(() => null) → игрок не видел, что бой начался.
-- Стало: переменная переименована в v_fid. Исходник _war_intercept.sql
--   исправлен так же.
-- ============================================================

create or replace function public.battles_mine()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_fid text;
begin
  v_fid := public._ec_my_fid();
  perform public._fleet_settle(v_fid);   -- бои завязываются лениво, при обращении
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'system_id', b.system_id,
      'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
      'status', b.status, 'kind', b.kind,
      'my_side', case when b.attacker_fid = v_fid then 'attacker' else 'defender' end,
      'foe', case when b.attacker_fid = v_fid then b.defender_fid else b.attacker_fid end,
      'foe_name', public._war_nm(case when b.attacker_fid = v_fid then b.defender_fid else b.attacker_fid end),
      'my_fleets', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)), '[]'::jsonb)
                    from public.battle_fleets bf join public.fleets f on f.id = bf.fleet_id
                    where bf.battle_id = b.id and bf.fid = v_fid),
      'created_at', b.created_at) order by b.created_at desc)
    from public.battles b
    where b.status <> 'done' and (b.attacker_fid = v_fid or b.defender_fid = v_fid)
  ), '[]'::jsonb);
end$$;
revoke all on function public.battles_mine() from public;
grant execute on function public.battles_mine() to authenticated;

-- Проверка: под аккаунтом воюющей фракции
--   select public.battles_mine();
-- должно вернуть массив с боем, а «Горячие точки» — показать карточку.
