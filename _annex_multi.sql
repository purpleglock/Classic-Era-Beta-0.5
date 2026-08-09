-- ── Объединение держав: несколько приглашений разом ─────────────
-- Было: любое висящее предложение с участием ведущего блокировало новое,
-- поэтому пригласить в унию больше одной державы за раз было нельзя.
-- Стало: ограничение только на ПАРУ (одному и тому же дважды),
-- на встречное предложение самому ведущему и на цель,
-- которой уже предложили войти в чей-то состав.
create or replace function public.annex_propose(p_target_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  if v_fid is null then raise exception 'только владелец державы может присоединять'; end if;
  if p_target_fid is null or p_target_fid = v_fid then raise exception 'bad target'; end if;
  if not exists(select 1 from public.faction_applications
                 where faction_id=p_target_fid and status='approved') then
    raise exception 'держава не найдена'; end if;
  if exists(select 1 from public.diplo_vassals where vassal_fid=v_fid and status='active') then
    raise exception 'вы сами вассал — сперва разорвите свой вассалитет'; end if;

  -- Вам самим предложили войти в чужой состав — сперва ответьте.
  if exists(select 1 from public.state_annexations
             where status='pending' and minor_fid=v_fid) then
    raise exception 'вам предложено объединение — сперва ответьте на него'; end if;
  -- Этой державе уже предложено войти в чей-то состав.
  if exists(select 1 from public.state_annexations
             where status='pending' and minor_fid=p_target_fid) then
    raise exception 'этой державе уже предложено объединение'; end if;
  -- Цель сама зовёт кого-то в свой состав — пусть сперва закроет свой круг.
  if exists(select 1 from public.state_annexations
             where status='pending' and lead_fid=p_target_fid) then
    raise exception 'эта держава сама ведёт переговоры об объединении'; end if;

  insert into public.state_annexations(lead_fid, minor_fid) values (v_fid, p_target_fid);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.annex_propose(text) from public;
grant execute on function public.annex_propose(text) to authenticated;
