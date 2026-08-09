-- ============================================================
-- ЦЕПНАЯ УНИЯ: разбор завала + запрет на повторение
--
-- Микустан (fac_26f25b449f) присоединил Соридонский Союз
-- (fac_085638a65d), а тот сам вёл унию с Советом Отверженных
-- (fac_997c5c8b70) и Цветущим Поясом (fac_edc69c8203).
--
-- map_systems.union_origin помнит ТОЛЬКО первого владельца:
-- слияние пишет coalesce(union_origin, faction). У систем унианцев
-- там уже стоял их собственный фид, и второе слияние переставило
-- им faction на Микустан, не тронув origin. Расторжение ищет
-- union_origin = минорная держава — не нашло ничего и оставило
-- 20 систем за Микустаном, хотя колонии на них давно вернулись
-- законным хозяевам: колония внутри чужой границы.
-- ============================================================

-- ── 1) Территория домой ─────────────────────────────────────
-- Возвращаем строго те системы, что стоят за Микустаном, но помнят
-- чужое происхождение. Своих трёх систем (union_origin is null) это
-- не касается.
update public.map_systems
   set faction = union_origin, union_origin = null
 where faction = 'fac_26f25b449f'
   and union_origin is not null
   and exists (select 1 from public.faction_applications
                where faction_id = map_systems.union_origin
                  and status = 'approved');

-- ── 2) Недвижимое следует за землёй ─────────────────────────
-- Колонии и постройки уехали по реестру сами; залипла только
-- разведохрана — она привязана к системе, а не к колонии.
do $$
declare t text;
begin
  foreach t in array array['colonies','colony_projects','doom_guns','econ_relief',
                           'guardian_posts','outposts','system_drone_posts',
                           'system_minefields','faction_intel_guard']
  loop
    begin
      execute format(
        'update public.%I x set faction_id = s.faction
           from public.map_systems s
          where s.id = x.system_id
            and x.faction_id = ''fac_26f25b449f''
            and s.faction in (''fac_997c5c8b70'',''fac_edc69c8203'')', t);
    exception when others then raise notice 'chainfix % : %', t, sqlerrm; end;
  end loop;
end$$;

-- Постройки идут за своей колонией (на случай расхождений).
update public.colony_buildings b set faction_id = c.faction_id
  from public.colonies c
 where c.id = b.colony_id and b.faction_id <> c.faction_id
   and b.faction_id = 'fac_26f25b449f';

-- ── 3) Запрет на цепную унию ────────────────────────────────
-- Корень беды: держава, которая САМА кого-то присоединила, могла
-- войти в третий состав, и её унианцы уезжали вместе с ней —
-- без всякого их согласия и без пути назад. Пока держава ведёт
-- хоть одну действующую унию, чужой состав ей закрыт: сперва
-- пусть распустит свою.
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
  -- ЦЕПЬ: у цели уже есть свои присоединённые державы.
  if exists(select 1 from public.state_annexations
             where status='accepted' and lead_fid=p_target_fid) then
    raise exception 'эта держава сама возглавляет объединение — её унию нельзя присоединить целиком';
  end if;

  insert into public.state_annexations(lead_fid, minor_fid) values (v_fid, p_target_fid);
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.annex_propose(text) from public;
grant execute on function public.annex_propose(text) to authenticated;

-- Вторая створка: согласие тоже проверяет цепь. Предложение могло
-- висеть с тех пор, когда унии у младшей ещё не было.
create or replace function public.annex_respond(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_fid text; a public.state_annexations;
        v_minor_owner uuid; v_lead_name text; v_minor_name text; v_lead_color text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  v_fid := public._fm_own_fid();
  if v_fid is null then raise exception 'только владелец державы'; end if;
  select * into a from public.state_annexations where id=p_id and status='pending';
  if not found then raise exception 'предложение не найдено'; end if;
  if a.minor_fid <> v_fid then raise exception 'это не ваше предложение'; end if;

  if not p_accept then
    update public.state_annexations set status='declined' where id=p_id;
    return jsonb_build_object('ok',true,'joined',false);
  end if;

  if exists(select 1 from public.state_annexations
             where status='accepted' and lead_fid=a.minor_fid) then
    raise exception 'вы возглавляете собственное объединение — сперва расторгните его';
  end if;

  select owner_id into v_minor_owner from public.faction_applications
    where faction_id=a.minor_fid and status='approved' order by updated_at desc limit 1;

  update public.state_annexations set status='accepted', sealed_at=now() where id=p_id;
  perform public._annex_merge(a.lead_fid, a.minor_fid, p_id);

  update public.faction_applications set status='annexed', updated_at=now()
    where faction_id=a.minor_fid and status='approved';

  begin
    update public.diplo_vassals set status='broken'
      where status in ('pending','active') and (vassal_fid=a.minor_fid or overlord_fid=a.minor_fid);
  exception when others then raise notice 'annex vassals: %', sqlerrm; end;
  begin
    update public.state_annexations set status='withdrawn'
      where status='pending' and (lead_fid=a.minor_fid or minor_fid=a.minor_fid);
  exception when others then raise notice 'annex pending: %', sqlerrm; end;

  if v_minor_owner is not null then
    begin
      update public.faction_members set status='left', updated_at=now()
        where user_id=v_minor_owner and status in ('active','pending');
      insert into public.faction_members(faction_id, user_id, status, role, perms,
                                         scope_all, note, decided_by)
        values (a.lead_fid, v_minor_owner, 'active', 'coruler', '[]'::jsonb, true,
                'Соправитель по акту объединения держав', v_minor_owner);
    exception when others then raise notice 'annex member: %', sqlerrm; end;
  end if;

  select name, color into v_lead_name, v_lead_color from public.faction_applications
    where faction_id=a.lead_fid and status='approved' limit 1;
  select name into v_minor_name from public.faction_applications
    where faction_id=a.minor_fid limit 1;
  perform public._annex_news(
    format('Провозглашена уния: «%s» и «%s»',
           coalesce(v_lead_name,a.lead_fid), coalesce(v_minor_name,a.minor_fid)),
    format('Две державы объявили о государственном объединении. Колонии, казна, войска и достижения '
        || 'науки «%s» и «%s» отныне общие, флаг «%s» сохранён над её прежними системами, '
        || 'а её правитель занял место соправителя при дворе.',
           coalesce(v_lead_name,a.lead_fid), coalesce(v_minor_name,a.minor_fid),
           coalesce(v_minor_name,a.minor_fid)),
    v_lead_color);
  return jsonb_build_object('ok',true,'joined',true);
end$$;
revoke all on function public.annex_respond(uuid,boolean) from public;
grant execute on function public.annex_respond(uuid,boolean) to authenticated;
