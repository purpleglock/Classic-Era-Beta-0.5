-- ПРО и «Фантом» (Х69, ball_emp): честное предупреждение вместо ловушки.
-- Х69 несёт no_abm=true — _doom_intercept выходит с null ДО планетарной ПРО
-- (_doom_shells.sql), сбивает его только Ожерелье Немезиды. Но abm_incoming тянула
-- все in_flight-залпы без разбора: игрок открывал окно перехвата, наводил сеть и
-- тратил своё ЕДИНСТВЕННОЕ решение (def_approach пишется один раз) на снаряд,
-- который ПРО всё равно не увидит. Теперь строка остаётся — видно, что летит, —
-- но помечена, наведение закрыто и на клиенте, и на сервере.
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
      'clear_p',       d.clear_p,
      -- снаряд-невидимка: планетарная ПРО его не берёт, нужна Немезида
      'no_abm',        d.no_abm,
      'nemesis',       d.nemesis
    ) order by s.ready_at)
    from public.doom_salvos s
    join public.colonies c
      on c.system_id = s.target_system_id and c.planet_pid = s.target_pid and c.faction_id = fid
    cross join lateral (
      select
        sl.slots,
        (tg.n >= 2) as needs_target,
        cp.p as clear_p,
        coalesce((public._ball_params(coalesce(s.kind,'doom'))->>'no_abm')::boolean, false) as no_abm,
        exists(select 1 from public.colony_buildings cb
                 join public.colonies c2 on c2.id = cb.colony_id
                where cb.btype='nemesis' and c2.system_id = s.target_system_id) as nemesis,
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

-- Тот же запрет на сервере: клиент можно обойти, решение расходуется навсегда.
create or replace function public.abm_set_defense(
  p_salvo_id uuid, p_approach text, p_window text default null, p_pid int default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; s public.doom_salvos; ok boolean; n_targets int;
begin
  fid := public._ec_my_fid();
  if not (p_approach = any(public._abm_profiles())) then raise exception 'bad approach'; end if;
  if p_window is not null and not (p_window = any(public._abm_windows())) then raise exception 'bad window'; end if;
  select * into s from public.doom_salvos where id = p_salvo_id for update;
  if not found or s.status <> 'in_flight' then raise exception 'отметка уже отработала'; end if;

  select exists(select 1 from public.colonies c
                 where c.system_id = s.target_system_id and c.planet_pid = s.target_pid
                   and c.faction_id = fid) into ok;
  if not ok then raise exception 'это не ваша планета'; end if;
  if coalesce((public._ball_params(coalesce(s.kind,'doom'))->>'no_abm')::boolean, false) then
    raise exception 'снаряд-невидимка: планетарная ПРО его не видит — остановит только Ожерелье Немезиды';
  end if;
  if public._abm_slots(fid, s.target_system_id) <= 0 then
    raise exception 'в этой системе нет Комплекса ПРО — вести перехват нечем';
  end if;
  if s.def_approach is not null then raise exception 'сеть уже наведена — решение одно'; end if;

  n_targets := public._abm_targets(fid, s.target_system_id);
  if n_targets >= 2 and p_pid is null then raise exception 'укажите планету-цель'; end if;

  update public.doom_salvos
     set def_approach = p_approach,
         def_window   = coalesce(p_window, (public._abm_windows())[1]),
         def_pid      = case when n_targets >= 2 then p_pid else s.target_pid end,
         def_pick_at  = now(), def_fid = fid
   where id = s.id;
  return jsonb_build_object('ok', true, 'approach', p_approach, 'window', p_window, 'pid', p_pid);
end$$;
revoke all on function public.abm_set_defense(uuid,text,text,int) from public;
grant execute on function public.abm_set_defense(uuid,text,text,int) to authenticated;
