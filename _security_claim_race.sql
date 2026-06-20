-- ============================================================
-- ЭТАП 2j — ГОНКА ЗАХВАТА СИСТЕМ (обход пула + overdraw + двойной захват)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыры в economy_claim_system при параллельных вызовах:
--   1) обход пула: все читают один claim_used ДО апдейта → захватывают больше
--      систем, чем разрешает пул (1–2 за кулдаун);
--   2) overdraw: списание gc=gc-cost без guard;
--   3) двойной захват одной системы (оба проходят проверку faction is null).
--
-- Фикс (логика стоимости/кулдауна/пула/смежности — без изменений):
--   • `select … for update` на казне — сериализует учёт пула по фракции
--     (второй вызов перечитывает уже обновлённый claim_used). Так же защищён spy_launch.
--   • атомарный захват: `update map_systems … where id=? and faction is null` —
--     только ничью систему, иначе raise.
--   • списание с guard `and gc>=cost`.
--   Вся функция — одна транзакция: любой raise откатывает всё.
-- ============================================================

create or replace function public.economy_claim_system(p_system_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  app public.faction_applications;
  eco public.faction_economy;
  sys public.map_systems;
  adj boolean;
  cost numeric := 3000;
  cd interval := '4 days';
  mods jsonb;
  max_claims int := 1;     -- размер пула захватов: «Дом в небесах»/роботы → 2
  pool_used int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  select * into app from public.faction_applications
    where owner_id = auth.uid() and status = 'approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  -- доктрина: модификаторы стоимости и кулдауна захвата
  mods := public._faction_mods(app.faction_id);
  cost := round(3000 * (mods->>'claim_cost')::numeric);
  cd := (round(4 * (mods->>'claim_cd')::numeric) || ' days')::interval;

  -- LOCK казны: сериализует параллельные захваты этой фракции (учёт пула честный)
  select * into eco from public.faction_economy where faction_id = app.faction_id for update;
  if not found then raise exception 'no economy'; end if;

  select * into sys from public.map_systems where id = p_system_id;
  if not found then raise exception 'system not found'; end if;
  if sys.faction is not null then raise exception 'system already claimed'; end if;

  -- смежность по гиперпути с любой системой фракции
  select exists (
    select 1 from public.map_hyperlanes h
    join public.map_systems ms
      on ms.id = case when h.a_id = p_system_id then h.b_id
                      when h.b_id = p_system_id then h.a_id end
    where (h.a_id = p_system_id or h.b_id = p_system_id) and ms.faction = app.faction_id
  ) into adj;
  if not adj then raise exception 'system not adjacent to your territory'; end if;

  if eco.gc < cost then raise exception 'not enough GC'; end if;

  -- размер пула захватов: «Дом в небесах» ИЛИ роботы ИЛИ экспансионисты → 2, иначе 1
  if (eco.research is not null and eco.research ? 'pol.house_heavens')
     or public._faction_is_robot(app.faction_id)
     or app.ideology = 'Экспансионизм' then max_claims := 2; end if;

  -- кулдаун идёт ТОЛЬКО если пул был исчерпан
  if eco.last_system_claim is not null and eco.last_system_claim > now() - cd then
    raise exception 'claim cooldown active';
  end if;
  if eco.last_system_claim is not null then pool_used := 0; else pool_used := coalesce(eco.claim_used, 0); end if;
  pool_used := pool_used + 1;

  -- АТОМАРНЫЙ захват: только если система всё ещё ничья
  update public.map_systems set faction = app.faction_id where id = p_system_id and faction is null;
  if not found then raise exception 'system already claimed'; end if;

  -- списание с guard (overdraw-safe); raise откатит и захват системы
  if pool_used >= max_claims then
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = now()
      where faction_id = app.faction_id and gc >= cost;
  else
    update public.faction_economy
      set gc = gc - cost, claim_used = pool_used, last_system_claim = null
      where faction_id = app.faction_id and gc >= cost;
  end if;
  if not found then raise exception 'not enough GC'; end if;

  return jsonb_build_object('ok', true, 'system_id', p_system_id, 'cost', cost);
end$$;
revoke all on function public.economy_claim_system(text) from public;
grant execute on function public.economy_claim_system(text) to authenticated;
