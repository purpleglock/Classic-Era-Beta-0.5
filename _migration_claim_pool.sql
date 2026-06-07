-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: захват систем — модель «пул» вместо «цикла»
--  Базово: 1 захват → перезарядка (кулдаун = 7 дн. × доктрина claim_cd).
--  «Дом в небесах» / роботы: пул из 2 захватов — можно взять 2 системы ПОДРЯД,
--  и только после исчерпания пула стартует кулдаун (от последнего захвата).
--  Пул пополняется целиком после окончания кулдауна.
--
--  Запускать ОТДЕЛЬНО в SQL-редакторе. Заменяет economy_claim_system.
--  Зависимости (_faction_mods, _faction_is_robot) уже в базе.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.economy_claim_system(p_system_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  sys public.map_systems;
  adj boolean;
  cost numeric := 3000;
  cd interval := '7 days';
  mods jsonb;
  max_claims int := 1;
  pool_used int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  mods := public._faction_mods(app.faction_id);
  cost := round(3000 * (mods->>'claim_cost')::numeric);
  cd := (round(7 * (mods->>'claim_cd')::numeric) || ' days')::interval;
  select * into eco from public.faction_economy where faction_id = app.faction_id;
  if not found then raise exception 'no economy'; end if;
  select * into sys from public.map_systems where id = p_system_id;
  if not found then raise exception 'system not found'; end if;
  if sys.faction is not null then raise exception 'system already claimed'; end if;

  select exists (
    select 1 from public.map_hyperlanes h
    join public.map_systems ms
      on ms.id = case when h.a_id = p_system_id then h.b_id
                      when h.b_id = p_system_id then h.a_id end
    where (h.a_id = p_system_id or h.b_id = p_system_id) and ms.faction = app.faction_id
  ) into adj;
  if not adj then raise exception 'system not adjacent to your territory'; end if;

  if eco.gc < cost then raise exception 'not enough GC'; end if;

  -- размер пула захватов до перезарядки: «Дом в небесах» ИЛИ роботы → 2, иначе 1
  if (eco.research is not null and eco.research ? 'pol.house_heavens')
     or public._faction_is_robot(app.faction_id) then max_claims := 2; end if;

  -- Кулдаун идёт ТОЛЬКО при исчерпанном пуле (last_system_claim ставится на последнем
  -- захвате пула). Пока в пуле есть захваты — last_system_claim = null.
  if eco.last_system_claim is not null and eco.last_system_claim > now() - cd then
    raise exception 'claim cooldown active';
  end if;
  if eco.last_system_claim is not null then pool_used := 0; else pool_used := coalesce(eco.claim_used, 0); end if;
  pool_used := pool_used + 1;

  if pool_used >= max_claims then
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = now()
      where faction_id = app.faction_id;
  else
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = null
      where faction_id = app.faction_id;
  end if;
  update public.map_systems set faction = app.faction_id where id = p_system_id;

  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost);
end$$;
revoke all on function public.economy_claim_system(text) from public;
grant execute on function public.economy_claim_system(text) to authenticated;
