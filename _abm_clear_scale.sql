-- ПРО: чистая отметка — ЛЕСТНИЦА от числа слотов, а не монетка на пороге.
-- Было: при slots >= abm_clear_slots шанс чистой отметки ровно 50% и дальше не рос.
-- Игрок с 12 слотами и игрок с 30 видели один и тот же жребий: разницы между
-- «двумя порогами» и «пятью» не было, а на экране это читалось как поломка.
-- Стало: 50% на пороге, +5% за каждый слот сверх — уверенная отметка с 16 слотов.
-- Жребий по-прежнему детерминированный (_abm_roll), от F5 подсказка не скачет.
create or replace function public._abm_clear_p(p_slots numeric)
returns numeric language sql immutable as $$
  select greatest(0, least(1,
    public._defense_const('abm_clear_chance')
    + greatest(0, coalesce(p_slots,0) - public._defense_const('abm_clear_slots')) * 0.05))
$$;

create or replace function public.abm_incoming()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  if fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'salvo_id',   s.id,
      'system_id',  s.target_system_id,
      'planet',     s.target_planet,
      'pid',        s.target_pid,
      'ready_at',   s.ready_at,
      'slots',      d.slots,
      'my_approach', s.def_approach,
      'my_window',   s.def_window,
      'my_pid',      s.def_pid,
      'needs_target', d.needs_target,
      'candidates',   d.candidates,
      'ap_hint_kind',  d.ap_kind,
      'ap_hint_value', d.ap_value,
      'window_known',  d.window_known,
      'window_value',  d.window_value,
      'target_known',  d.target_known,
      'target_value',  d.target_value,
      -- какой шанс чистой отметки давали слоты: игрок должен видеть, за что платит
      'clear_p',       d.clear_p
    ) order by s.ready_at)
    from public.doom_salvos s
    join public.colonies c
      on c.system_id = s.target_system_id and c.planet_pid = s.target_pid and c.faction_id = fid
    cross join lateral (
      select
        sl.slots,
        (tg.n >= 2) as needs_target,
        cp.p as clear_p,
        (select jsonb_agg(jsonb_build_object('pid', cc.planet_pid, 'name', cc.planet_name)
                   order by cc.planet_name)
           from public.colonies cc
          where cc.faction_id = fid and cc.system_id = s.target_system_id) as candidates,
        case when sl.slots >= public._defense_const('abm_clear_slots')
                  and public._abm_roll(s.id,'clear') < cp.p*100
               then 'clear'
             when sl.slots >= public._defense_const('abm_narrow_slots') then 'narrow'
             else 'none' end as ap_kind,
        case when sl.slots >= public._defense_const('abm_clear_slots')
                  and public._abm_roll(s.id,'clear') < cp.p*100
               then public._abm_approach(s.id, s.approach)
             when sl.slots >= public._defense_const('abm_narrow_slots')
               then public._abm_narrow_out(s.id, public._abm_approach(s.id, s.approach), s.feint)
             else null end as ap_value,
        (sl.slots >= public._defense_const('abm_radar_slots')) as window_known,
        case when sl.slots >= public._defense_const('abm_radar_slots')
               then public._abm_window(s.id, s.appr_window) else null end as window_value,
        -- цель раскрывается там же, где чистая отметка: тот же уровень разведки
        (sl.slots >= public._defense_const('abm_clear_slots') and tg.n >= 2) as target_known,
        case when sl.slots >= public._defense_const('abm_clear_slots') and tg.n >= 2
               then s.target_pid else null end as target_value
      from (select public._abm_slots(fid, s.target_system_id) as slots) sl
      cross join lateral (select public._abm_clear_p(sl.slots) as p) cp
      cross join (select public._abm_targets(fid, s.target_system_id) as n) tg
    ) d
    where s.status = 'in_flight'
  ), '[]'::jsonb);
end$$;
revoke all on function public.abm_incoming() from public;
grant execute on function public.abm_incoming() to authenticated;
