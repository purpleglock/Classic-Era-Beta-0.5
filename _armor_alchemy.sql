-- ════════════════════════════════════════════════════════════
-- ALCHEMY OF ARMOR — серверное зеркало движка armor_alchemy.js
-- ────────────────────────────────────────────────────────────
-- Таблица кастомных сплавов фракций + RLS + RPC (SECURITY DEFINER),
-- пересчитывающие статы АВТОРИТЕТНО из рецепта (клиентским цифрам не
-- доверяем — см. client-write RLS-дыра). _cn_recompute (в _unit_publish.sql)
-- при публикации резолвит armorAlloyId → материал/HP/стойкости отсюда.
--
-- ВНИМАНИЕ: числа ДОЛЖНЫ совпадать с armor_alchemy.js. Менял там — правь тут.
-- Порядок применения: этот файл ДО обновлённого _unit_publish.sql.
-- ════════════════════════════════════════════════════════════

-- ── §0. Таблица ──────────────────────────────────────────────
create table if not exists public.faction_armor_alloys (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid(),
  faction_id    text,
  faction_name  text,
  faction_color text,
  name          text not null,
  recipe        jsonb not null default '{}'::jsonb,
  stats         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_faa_faction on public.faction_armor_alloys(faction_id);

alter table public.faction_armor_alloys enable row level security;

-- SELECT: свои-фракционные + общедоступные (faction_id is null) + владелец + админ.
drop policy if exists faa_select on public.faction_armor_alloys;
create policy faa_select on public.faction_armor_alloys for select using (
  faction_id is null
  or owner_id = auth.uid()
  or faction_id = public._ec_my_fid_opt()
  or public.current_user_role() in ('superadmin','editor')
);
-- Прямой DML запрещён — только через RPC ниже.
revoke insert, update, delete on public.faction_armor_alloys from authenticated, anon;

-- ── §1. Порт движка: recipe(jsonb) → stats(jsonb) ────────────
-- геттер доли (0 по умолчанию) — определён ДО calc (тот его вызывает)
create or replace function public._aa_g(f jsonb, k text)
returns numeric language sql immutable as $$
  select coalesce((f->>k)::numeric, 0)
$$;

create or replace function public._armor_alchemy_calc(mix jsonb)
returns jsonb language plpgsql immutable as $aa$
declare
  els jsonb := $j${
    "IRON":{"density":7.8,"tensile":400,"heat":0.30,"conduct":0.55,"hp":6,"weight":1.0,"role":"struct"},
    "SILICATE":{"density":2.6,"tensile":180,"heat":0.85,"conduct":0.10,"hp":4,"weight":0.4,"role":"ceramic"},
    "ICEWATER":{"density":0.9,"tensile":20,"heat":0.20,"conduct":0.15,"hp":1,"weight":0.2,"role":"volatile"},
    "CARBON":{"density":2.0,"tensile":900,"heat":0.55,"conduct":0.20,"hp":5,"weight":-0.2,"role":"binder"},
    "METHANE":{"density":0.5,"tensile":5,"heat":0.05,"conduct":0.10,"hp":0.4,"weight":0.1,"role":"volatile"},
    "SULFUR":{"density":2.0,"tensile":60,"heat":0.30,"conduct":0.10,"hp":1.5,"weight":0.3,"role":"binder"},
    "COPPER":{"density":8.9,"tensile":220,"heat":0.35,"conduct":0.95,"hp":4,"weight":1.1,"role":"metal"},
    "TITANIUM":{"density":4.5,"tensile":950,"heat":0.60,"conduct":0.15,"hp":8,"weight":0.35,"role":"struct"},
    "SULFIDES":{"density":3.5,"tensile":150,"heat":0.40,"conduct":0.30,"hp":3,"weight":0.4,"role":"reactive"},
    "AMMONIA":{"density":0.8,"tensile":15,"heat":0.25,"conduct":0.12,"hp":1,"weight":0.15,"role":"volatile"},
    "RAREEARTH":{"density":6.5,"tensile":300,"heat":0.50,"conduct":0.30,"hp":5,"weight":0.6,"role":"catalyst"},
    "PLATINUM":{"density":21.4,"tensile":180,"heat":0.75,"conduct":0.60,"hp":7,"weight":1.6,"role":"metal"},
    "URANIUM":{"density":19.0,"tensile":400,"heat":0.55,"conduct":0.40,"hp":9,"weight":1.7,"role":"reactive"},
    "WATER":{"density":1.0,"tensile":10,"heat":0.30,"conduct":0.14,"hp":1,"weight":0.2,"role":"volatile"},
    "ORGANICS":{"density":1.3,"tensile":500,"heat":0.35,"conduct":0.08,"hp":4,"weight":-0.1,"role":"binder"},
    "DEUTERIUM":{"density":0.6,"tensile":5,"heat":0.10,"conduct":0.10,"hp":0.5,"weight":0.1,"role":"reactive"},
    "HELIUM3":{"density":0.3,"tensile":5,"heat":0.15,"conduct":0.10,"hp":1,"weight":-0.4,"role":"volatile"},
    "THERMFUEL":{"density":2.5,"tensile":100,"heat":0.90,"conduct":0.20,"hp":6,"weight":0.3,"role":"reactive"},
    "DIAMONDS":{"density":3.5,"tensile":2200,"heat":0.95,"conduct":0.25,"hp":14,"weight":0.5,"role":"ceramic"},
    "EXOCRYST":{"density":4.0,"tensile":1200,"heat":0.98,"conduct":0.05,"hp":16,"weight":0.3,"role":"exotic"},
    "QUANTUMCRYST":{"density":9.0,"tensile":1500,"heat":0.80,"conduct":0.10,"hp":22,"weight":-2.0,"role":"exotic"},
    "DEGENERATE":{"density":40.0,"tensile":1800,"heat":0.70,"conduct":0.30,"hp":30,"weight":3.0,"role":"exotic"},
    "NEUTRONMAT":{"density":8.0,"tensile":1400,"heat":0.85,"conduct":0.15,"hp":24,"weight":0.0,"role":"exotic"}
  }$j$::jsonb;
  rid text; u numeric; e jsonb; fr numeric; role text;
  total numeric := 0;
  f jsonb := '{}'::jsonb;
  rr jsonb := jsonb_build_object('struct',0,'ceramic',0,'binder',0,'metal',0,'catalyst',0,'volatile',0,'reactive',0,'exotic',0);
  density numeric:=0; tensile numeric:=0; heat numeric:=0; conduct numeric:=0; hpraw numeric:=0; weight numeric:=0;
  hpmul numeric:=1; tenmul numeric:=1; densmul numeric:=1; heatmul numeric:=1; capadd numeric:=0;
  kin numeric:=0; en numeric:=0; mis numeric:=0; pcthp numeric:=0;
  traits text[] := '{}'; warns text[] := '{}';
  q numeric; c numeric; topf numeric:=0; over numeric; vol numeric; bond numeric; unbound numeric; bound numeric; cool numeric;
  category text; quality numeric; hpboost numeric; hppct numeric; cap numeric; rk numeric; re numeric; rm numeric; grade numeric;
  capscale numeric := 1; qn numeric; rscore numeric; pn numeric;
begin
  -- сбор рецепта
  for rid, u in select key, (value#>>'{}')::numeric from jsonb_each(mix) loop
    if (els ? rid) and coalesce(u,0) > 0 then
      total := total + floor(u);
    end if;
  end loop;
  if total <= 0 then
    return jsonb_build_object('ok', false, 'hpBoost',0,'resist',jsonb_build_object('kinetic',0,'energy',0,'missile',0));
  end if;

  -- доли, роли, физика
  for rid, u in select key, (value#>>'{}')::numeric from jsonb_each(mix) loop
    if not (els ? rid) or coalesce(u,0) <= 0 then continue; end if;
    u := floor(u); e := els->rid; fr := u/total; role := e->>'role';
    f := f || jsonb_build_object(rid, fr);
    rr := jsonb_set(rr, array[role], to_jsonb((rr->>role)::numeric + fr));
    density := density + fr*(e->>'density')::numeric;
    tensile := tensile + fr*(e->>'tensile')::numeric;
    heat    := heat    + fr*(e->>'heat')::numeric;
    conduct := conduct + fr*(e->>'conduct')::numeric;
    weight  := weight  + fr*(e->>'weight')::numeric;
    hpraw   := hpraw   + u*(e->>'hp')::numeric;
  end loop;

  -- базовые стойкости
  kin := least(tensile/4000, 0.45) + least(density/60, 0.20);
  en  := least(heat*0.45, 0.45) - least(conduct*0.35, 0.35);
  mis := least(density/50, 0.25);

  -- ── реакции (fget/rget через coalesce) ──
  -- 1 steel
  if _aa_g(f,'IRON')>=0.2 and _aa_g(f,'CARBON')>=0.15 and least(_aa_g(f,'IRON'), _aa_g(f,'CARBON')*2)>=0.2 then
    q := least(_aa_g(f,'IRON'), _aa_g(f,'CARBON')*3);
    tenmul := tenmul + 0.35*q; kin := kin + 0.32*q; capadd := capadd + 6*q; traits := traits || 'Легированная сталь'::text;
  end if;
  -- 2 titanal
  if _aa_g(f,'TITANIUM')>=0.2 and _aa_g(f,'CARBON')>=0.1 then
    q := least(_aa_g(f,'TITANIUM'), _aa_g(f,'CARBON')*4);
    tenmul := tenmul + 0.30*q; densmul := densmul - 0.10*q; kin := kin + 0.20*q; capadd := capadd + 10*q; traits := traits || 'Титаналь'::text;
  end if;
  -- 3 cermet
  if (_aa_g(f,'SILICATE')+_aa_g(f,'DIAMONDS'))>=0.2 and (_aa_g(f,'CARBON')+_aa_g(f,'ORGANICS'))>=0.08 then
    q := least(_aa_g(f,'SILICATE')+_aa_g(f,'DIAMONDS'), 0.6);
    heatmul := heatmul + 0.30*q; en := en + 0.45*q; traits := traits || 'Керметокомпозит'::text;
  end if;
  -- 4 exomatrix
  if (_aa_g(f,'RAREEARTH')+_aa_g(f,'EXOCRYST')+_aa_g(f,'QUANTUMCRYST'))>=0.08
     and ((rr->>'struct')::numeric+(rr->>'ceramic')::numeric+(rr->>'metal')::numeric)>=0.3 then
    c := _aa_g(f,'RAREEARTH')+_aa_g(f,'EXOCRYST')*1.6+_aa_g(f,'QUANTUMCRYST')*2.2;
    pcthp := pcthp + greatest(0, least(c*1.2, 1.2)); traits := traits || 'Экзоматрица'::text;
  end if;
  -- 5 conductor
  if _aa_g(f,'COPPER')>=0.25 then
    en := en - 0.30*least(_aa_g(f,'COPPER'), 0.6); warns := warns || 'Токопроводящая: уязвима к лазеру'::text;
  end if;
  -- 6 dense_kin
  if (_aa_g(f,'URANIUM')+_aa_g(f,'DEGENERATE'))>=0.15 then
    q := least(_aa_g(f,'URANIUM')+_aa_g(f,'DEGENERATE')*1.5, 0.8);
    kin := kin + 0.50*q; densmul := densmul + 0.25*q; capadd := capadd - 14*q; traits := traits || 'Кинетический монолит'::text;
  end if;
  -- 7 reactive
  if (rr->>'reactive')::numeric>=0.12 and (_aa_g(f,'RAREEARTH')+_aa_g(f,'EXOCRYST'))>=0.05 then
    q := least((rr->>'reactive')::numeric, 0.6);
    mis := mis + 0.60*q; traits := traits || 'Динамическая защита'::text;
    if (_aa_g(f,'THERMFUEL')+_aa_g(f,'DEUTERIUM'))>=0.2 then warns := warns || 'Нестабильный заряд: риск детонации'::text; end if;
  end if;
  -- 8 adaptive
  if _aa_g(f,'NEUTRONMAT')>=0.05 then
    q := least(_aa_g(f,'NEUTRONMAT')*2, 0.5);
    kin := kin + 0.16*q; en := en + 0.16*q; mis := mis + 0.16*q; pcthp := pcthp + 0.4*q; traits := traits || 'Саморемонт'::text;
  end if;
  -- 9 gravlift
  if _aa_g(f,'QUANTUMCRYST')>=0.03 then
    capadd := capadd + 40*least(_aa_g(f,'QUANTUMCRYST')*3, 1); traits := traits || 'Гравикомпенсация массы'::text;
  end if;

  -- чистота
  select max(v) into topf from (select (value#>>'{}')::numeric v from jsonb_each(f)) s;
  if topf > 0.75 then
    over := (topf-0.75)/0.25;
    tenmul := tenmul - 0.5*over; hpmul := hpmul - 0.35*over;
    warns := warns || 'Нестабильный монолит: хрупкость от чистоты'::text;
  end if;
  -- волатильность
  vol := (rr->>'volatile')::numeric;
  bond := _aa_g(f,'CARBON')+_aa_g(f,'ORGANICS')+_aa_g(f,'SULFUR');
  if vol > 0.15 then
    unbound := greatest(0, vol - bond*2);
    if unbound > 0 then
      hpmul := hpmul - 1.1*least(unbound,0.7); tenmul := tenmul - 0.6*least(unbound,0.7);
      warns := warns || 'Несвязанные волатильные: рыхлая структура'::text;
    end if;
    bound := least(vol, bond*2);
    if bound > 0.05 then en := en + 0.18*least(bound,0.5); end if;
  end if;
  cool := _aa_g(f,'ICEWATER')+_aa_g(f,'WATER')+_aa_g(f,'AMMONIA');
  if (_aa_g(f,'THERMFUEL')+_aa_g(f,'URANIUM')) > 0.25 and cool < 0.05 then
    warns := warns || 'Перегрев: нужен хладагент (Лёд/Вода)'::text;
  end if;

  -- финал
  density := greatest(0.3, density*densmul);
  tensile := greatest(5,   tensile*tenmul);
  heat    := greatest(0.02, least(1.2, heat*heatmul));
  quality := greatest(0.1, least(1.6, hpmul));
  -- кап объёма: HP/грузоподъёмность масштабируются по потолку (зеркало MAX_UNITS=100)
  capscale := case when total > 100 then 100.0/total else 1 end;
  hpboost := round(hpraw*quality*0.6*capscale);
  cap     := round((-weight*total*0.4 + capadd*total*0.2)*capscale);
  hppct   := greatest(0, least(1.5, pcthp));
  rk := round(greatest(0, least(0.9, kin))::numeric, 3);
  re := round(greatest(0, least(0.9, en ))::numeric, 3);
  rm := round(greatest(0, least(0.9, mis))::numeric, 3);

  -- категория
  if ((rr->>'ceramic')::numeric + (rr->>'exotic')::numeric*0.5) >= 0.4 then category := 'ceramic';
  elsif density >= 9   then category := 'heavyMetal';
  elsif density <= 3.2 then category := 'lightMetal';
  elsif (rr->>'binder')::numeric >= 0.25 then category := 'composite';
  else category := case when density >= 6 then 'heavyMetal' else 'composite' end;
  end if;

  -- оценка 0..100: качество 35 + баланс трёх стойкостей 45 + %HP 20 − штрафы×10 (зеркало JS)
  qn := greatest(0, least(1, quality));
  rscore := greatest(0, least(1, (rk+re+rm)/1.5));
  pn := greatest(0, least(1, hppct/1.2));
  grade := greatest(0, least(100, round(qn*35 + rscore*45 + pn*20 - coalesce(array_length(warns,1),0)*10)));

  return jsonb_build_object(
    'ok', true,
    'totalUnits', total,
    'category', category,
    'hpBoost', hpboost,
    'hpPercentBoost', hppct,
    'capacityBoost', cap,
    'quality', round(quality,2),
    'grade', grade,
    'resist', jsonb_build_object('kinetic', rk, 'energy', re, 'missile', rm),
    'traits', to_jsonb(traits),
    'warnings', to_jsonb(warns),
    'material', jsonb_build_object(
      'density', round(density,2),
      'tensileStrength', jsonb_build_object('min', round(tensile*0.85), 'max', round(tensile*1.15)),
      'thermalConductivity', round(conduct*400),
      'heatResistance', round(heat*2500)
    )
  );
end;
$aa$;

-- id ресурса → русское имя (для ведомости постройки; зеркало galaxy_gen RESOURCES)
create or replace function public._aa_name(id text)
returns text language sql immutable as $$
  select case id
    when 'IRON' then 'Железо' when 'SILICATE' then 'Силикаты' when 'ICEWATER' then 'Лёд'
    when 'CARBON' then 'Углерод' when 'METHANE' then 'Метан' when 'SULFUR' then 'Сера'
    when 'COPPER' then 'Медь' when 'TITANIUM' then 'Титан' when 'SULFIDES' then 'Ионит'
    when 'AMMONIA' then 'Аммиачный лёд' when 'RAREEARTH' then 'Редкоземельные руды'
    when 'PLATINUM' then 'Платина' when 'URANIUM' then 'Изотопы' when 'WATER' then 'Жидкая вода'
    when 'ORGANICS' then 'Реликтовое дерево' when 'DEUTERIUM' then 'Дейтерий' when 'HELIUM3' then 'Гелий-3'
    when 'THERMFUEL' then 'Старвис' when 'DIAMONDS' then 'Хтонит' when 'EXOCRYST' then 'Стелларит'
    when 'QUANTUMCRYST' then 'Гравиядро' when 'DEGENERATE' then 'Рагенод' when 'NEUTRONMAT' then 'Программируемая материя'
    else id end
$$;
grant execute on function public._aa_name(text) to authenticated;

-- ── §2. RPC upsert ───────────────────────────────────────────
create or replace function public.armor_alloy_upsert(
  p_alloy_id uuid, p_name text, p_recipe jsonb,
  p_faction_id text, p_faction_name text, p_faction_color text
) returns public.faction_armor_alloys language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  st jsonb;
  row public.faction_armor_alloys;
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'empty name'; end if;
  if not staff and my_fid is null then raise exception 'no approved faction'; end if;
  -- Проверка права выступать от фракции (если указана): своя анкета или админ.
  if p_faction_id is not null and not staff and p_faction_id is distinct from my_fid then
    raise exception 'no rights for faction';
  end if;
  st := public._armor_alchemy_calc(coalesce(p_recipe,'{}'::jsonb));
  if (st->>'ok')::boolean is not true then raise exception 'empty recipe'; end if;

  if p_alloy_id is null then
    insert into public.faction_armor_alloys(owner_id, faction_id, faction_name, faction_color, name, recipe, stats)
    values (uid, p_faction_id, p_faction_name, p_faction_color, left(p_name,48), coalesce(p_recipe,'{}'::jsonb), st)
    returning * into row;
  else
    update public.faction_armor_alloys
      set name = left(p_name,48), recipe = coalesce(p_recipe,'{}'::jsonb), stats = st,
          faction_name = coalesce(p_faction_name, faction_name),
          faction_color = coalesce(p_faction_color, faction_color),
          updated_at = now()
    where id = p_alloy_id
          and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid))
    returning * into row;
    if row.id is null then raise exception 'alloy not found or forbidden'; end if;
  end if;
  return row;
end;
$$;

-- ── §3. RPC delete ───────────────────────────────────────────
create or replace function public.armor_alloy_delete(p_alloy_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
  staff boolean := public.current_user_role() in ('superadmin','editor');
  my_fid text := public._ec_my_fid_opt();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from public.faction_armor_alloys
   where id = p_alloy_id
     and (owner_id = uid or staff or (faction_id is not null and faction_id = my_fid));
end;
$$;

grant execute on function public.armor_alloy_upsert(uuid,text,jsonb,text,text,text) to authenticated;
grant execute on function public.armor_alloy_delete(uuid) to authenticated;
grant execute on function public._armor_alchemy_calc(jsonb) to authenticated;
grant execute on function public._aa_g(jsonb,text) to authenticated;
