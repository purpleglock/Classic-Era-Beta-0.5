-- ============================================================
-- ЭТАП 2L — ГОНКА ПРОДАЖИ РЕСУРСА (double-pay)
-- Применять в Supabase → SQL Editor. Идемпотентно.
--
-- Дыра: economy_sell_resource читал остаток have, потом списывал ресурс и
--   начислял ГС без сериализации. Параллельные продажи ОДНОГО ресурса:
--   оба читают have, оба пишут resources[name]=have-units (списано 1 раз),
--   но оба начисляют ГС → за одно списание платят несколько раз = деньги из воздуха.
--     Promise.all([...].map(()=>ecRpc('economy_sell_resource',{p_name,p_units,p_rarity})))
--
-- Фикс: `for update` на строке казны — параллельные продажи фракции
--   сериализуются, второй перечитывает уже уменьшенный остаток.
-- (Редкость уже серверная — см. _security_market.sql.)
-- ============================================================

create or replace function public.economy_sell_resource(p_name text, p_units numeric, p_rarity text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; eco public.faction_economy; have numeric; gain numeric; v_rarity text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if p_units is null or p_units <= 0 then raise exception 'bad units'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  -- FOR UPDATE: сериализует параллельные продажи этой фракции — нельзя получить
  -- ГС дважды за одно списание (второй перечитает уменьшенный остаток).
  select * into eco from public.faction_economy where faction_id=app.faction_id for update;
  if not found then raise exception 'no economy'; end if;
  have := coalesce((eco.resources->>p_name)::numeric, 0);
  if have < p_units then raise exception 'not enough resource'; end if;
  -- редкость определяет сервер по имени (не клиентский p_rarity)
  v_rarity := coalesce((select rarity from public.resource_rarity where name = p_name), 'common');
  gain := floor(p_units * public._res_price(v_rarity) * 0.8 * (public._faction_mods(app.faction_id)->>'gc')::numeric);
  update public.faction_economy
    set resources = jsonb_set(coalesce(resources,'{}'::jsonb), array[p_name], to_jsonb(have - p_units), true),
        gc = gc + gain
    where faction_id=app.faction_id;
  return jsonb_build_object('ok', true, 'gain', gain);
end$$;
revoke all on function public.economy_sell_resource(text,numeric,text) from public;
grant execute on function public.economy_sell_resource(text,numeric,text) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Параллельная продажа одного ресурса должна начислить ГС за РЕАЛЬНО списанное
-- кол-во один раз; «лишних» начислений быть не должно.
