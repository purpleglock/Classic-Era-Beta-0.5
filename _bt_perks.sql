-- ══════════════════════════════════════════════════════════════════
--  БОЕВЫЕ ПЕРКИ — карточки экипажа (14 штук)
--  ─────────────────────────────────────────────────────────────────
--  Перк = карточка, которую ставят В КОНСТРУКТОРЕ на конкретный проект.
--  Слот РОВНО ОДИН (_perk_slots): перки сильные, два разом ломают дуэли.
--  Право поставить карточку даёт ИССЛЕДОВАНИЕ одноимённого узла древа
--  (tech_nodes 'perk.*'), само исследование флоту НИЧЕГО не даёт.
--
--  КЛИЕНТСКОЕ ЗЕРКАЛО: perks.js (PERKS). Числа обязаны совпадать.
--
--  ХРАНЕНИЕ:
--    faction_units.data.perks : ['perk.xxx']  — проект (конструктор)
--    battle_units.perks       : jsonb-массив  — снимок на бортах доски
--    battle_units.pk          : накопители перка (заблокировано/в борт/…)
--    battles.pk               : флаги НА СТОРОНУ ('calm:attacker')
--    battles.graves           : гексы недавних смертей (для «Некрофилии»)
--
--  ПОРЯДОК: файл самодостаточен, катится одним куском, повторно — безопасно.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Узлы древа исследований ────────────────────────────────────
insert into public.tech_nodes (node_id, base_cost, prereq) values
  ('perk.patience',   60,  '[]'::jsonb),
  ('perk.timeman',    70,  '[]'::jsonb),
  ('perk.list',       70,  '[]'::jsonb),
  ('perk.altaan',     90,  '["perk.patience"]'::jsonb),
  ('perk.shine',      90,  '["perk.list"]'::jsonb),
  ('perk.slow',       100, '[]'::jsonb),
  ('perk.kchau',      110, '["perk.timeman"]'::jsonb),
  ('perk.conformist', 110, '[]'::jsonb),
  ('perk.beamrider',  120, '[]'::jsonb),
  ('perk.recycler',   130, '["perk.altaan"]'::jsonb),
  ('perk.despair',    150, '["perk.patience"]'::jsonb),
  ('perk.necro',      150, '["perk.list"]'::jsonb),
  ('perk.bloodlust',  180, '["perk.recycler"]'::jsonb),
  ('perk.calm',       220, '["perk.despair"]'::jsonb)
on conflict (node_id) do update
  set base_cost = excluded.base_cost, prereq = excluded.prereq;

-- ── 2. Хранилище ──────────────────────────────────────────────────
alter table public.battle_units add column if not exists perks jsonb not null default '[]'::jsonb;
alter table public.battle_units add column if not exists pk    jsonb not null default '{}'::jsonb;
alter table public.battles      add column if not exists pk     jsonb not null default '{}'::jsonb;
alter table public.battles      add column if not exists graves jsonb not null default '[]'::jsonb;

-- ── 3. Каталог: сколько слотов и какие классы ─────────────────────
-- Слотов под карточки на корабле. ОДИН — сознательное решение по балансу.
create or replace function public._perk_slots() returns int
  language sql immutable as $$ select 1 $$;

-- key → ограничение по классу (null = любой класс). Зеркало PERKS[].cls.
create or replace function public._perk_cat() returns jsonb
  language sql immutable as $$
  select '{
    "perk.patience":   {"n":"Терпение",                     "cls":null},
    "perk.timeman":    {"n":"Тайменеджмент",                "cls":null},
    "perk.list":       {"n":"Наклонности",                  "cls":null},
    "perk.altaan":     {"n":"Альтаанская стойкость",        "cls":null},
    "perk.shine":      {"n":"Сияй другим",                  "cls":null},
    "perk.slow":       {"n":"Медленно и верно",             "cls":null},
    "perk.kchau":      {"n":"Кчау",                         "cls":null},
    "perk.conformist": {"n":"Капитан-конформист",           "cls":null},
    "perk.beamrider":  {"n":"Бимрайдер",                    "cls":["destroyer"]},
    "perk.recycler":   {"n":"Серийный ресайклер",           "cls":null},
    "perk.despair":    {"n":"Отчаяние",                     "cls":null},
    "perk.necro":      {"n":"Некрофилия",                   "cls":null},
    "perk.bloodlust":  {"n":"Жажда крови",                  "cls":null},
    "perk.calm":       {"n":"Спокоен как пульс покойника",  "cls":null}
  }'::jsonb;
$$;

create or replace function public._perk_name(k text) returns text
  language sql immutable as $$
  select coalesce(public._perk_cat()->k->>'n', k);
$$;

-- Карточка подходит этому классу?
create or replace function public._perk_cls_ok(k text, p_cls text) returns boolean
  language sql immutable as $$
  select case when public._perk_cat()->k->'cls' is null
              or public._perk_cat()->k->'cls' = 'null'::jsonb
         then true
         else coalesce(public._perk_cat()->k->'cls' ? coalesce(p_cls,''), false) end;
$$;

-- ── 4. Карточки проекта → карточки борта ─────────────────────────
-- Отсекаем всё, что не изучено державой, не подходит классу или лишнее
-- сверх слотов. Боты (fid 'bot') исследований не имеют → карточек нет.
create or replace function public._bt_perks_of(p_unit uuid, p_fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare u record; res jsonb; cls text;
begin
  if p_unit is null then return '[]'::jsonb; end if;
  select * into u from public.faction_units where id = p_unit;
  if u.id is null then return '[]'::jsonb; end if;
  cls := nullif(u.data->>'class','');

  select coalesce(jsonb_agg(k), '[]'::jsonb) into res
  from (
    select distinct on (e.value) e.value as k
      from jsonb_array_elements_text(coalesce(u.data->'perks','[]'::jsonb)) e
     where public._perk_cat() ? e.value
       and public._perk_cls_ok(e.value, cls)
       and exists (select 1 from public.faction_economy fe
                    where fe.faction_id = coalesce(p_fid, u.faction_id)
                      and coalesce(fe.research,'[]'::jsonb) ? e.value)
     order by e.value
     limit public._perk_slots()
  ) q;
  return res;
end$$;
revoke all on function public._bt_perks_of(uuid, text) from public;
grant execute on function public._bt_perks_of(uuid, text) to authenticated;

-- Карточка стоит на борту?
create or replace function public._bt_pk_has(p_perks jsonb, p_key text)
returns boolean language sql immutable as $$
  select coalesce(p_perks, '[]'::jsonb) ? p_key;
$$;

-- ── 5. Печать карточек на борт при выставлении ───────────────────
-- Сюда же уехало «Медленно и верно»: корпус ×1.2 надо поднять ДО того,
-- как борт встанет на доску, иначе max_hp разъедется с hp.
create or replace function public._bt_units_acts_fill()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.unit_id is not null
     and (new.acts is null or jsonb_array_length(new.acts) = 0) then
    new.acts := public._bt_acts_of(new.unit_id);
  end if;
  if new.unit_id is not null
     and (new.perks is null or jsonb_array_length(new.perks) = 0) then
    new.perks := public._bt_perks_of(new.unit_id, new.fid);
  end if;
  if public._bt_pk_has(new.perks, 'perk.slow') then
    new.max_hp := round(coalesce(new.max_hp, 0) * 1.20);
    new.hp     := round(coalesce(new.hp, 0) * 1.20);
  end if;
  return new;
end$$;

-- ── 6. Мелкие рабочие руки перков ────────────────────────────────
-- Накопитель: добавить p_add в счётчик, вернуть, сколько ПОЛНЫХ порций
-- по p_step набралось (остаток остаётся копиться дальше).
create or replace function public._bt_pk_tick(p_unit uuid, p_key text, p_add numeric, p_step numeric)
returns int language plpgsql security definer set search_path=public as $$
declare tot numeric; n int;
begin
  if p_add is null or p_add <= 0 then return 0; end if;
  update public.battle_units
     set pk = coalesce(pk,'{}'::jsonb)
              || jsonb_build_object(p_key, coalesce((pk->>p_key)::numeric, 0) + p_add)
   where id = p_unit
  returning coalesce((pk->>p_key)::numeric, 0) into tot;
  if tot is null then return 0; end if;
  n := floor(tot / p_step)::int;
  if n > 0 then
    update public.battle_units
       set pk = coalesce(pk,'{}'::jsonb) || jsonb_build_object(p_key, tot - n * p_step)
     where id = p_unit;
  end if;
  return n;
end$$;

-- Снять p_n ходов со ВСЕХ кулдаунов борта.
create or replace function public._bt_mcd_cut(p_unit uuid, p_n int)
returns void language sql security definer set search_path=public as $$
  update public.battle_units
     set mcd = coalesce((
           select jsonb_object_agg(k, v::int - greatest(1, p_n))
             from jsonb_each_text(coalesce(mcd,'{}'::jsonb)) as e(k, v)
            where v::int - greatest(1, p_n) > 0
         ), '{}'::jsonb)
   where id = p_unit;
$$;

-- Копилка секунд «к следующему ходу»: перки, что срабатывают на ЧУЖОМ
-- ходу (урон в борт, «Отчаяние», «Пульс покойника»), кладут сюда —
-- _bt_tp_refresh высыпет это в пул, когда очередь дойдёт до борта.
create or replace function public._bt_perk_bank(p_unit uuid, p_sec numeric)
returns void language sql security definer set search_path=public as $$
  update public.battle_units
     set pk = coalesce(pk,'{}'::jsonb)
              || jsonb_build_object('bank', coalesce((pk->>'bank')::numeric, 0) + p_sec)
   where id = p_unit and p_sec > 0;
$$;

-- ── 7. Перки: точки срабатывания ─────────────────────────────────

-- «Альтаанская стойкость»: щит погасил урон → кулдауны короче.
create or replace function public._bt_perk_block(p_unit uuid, p_absorbed numeric)
returns void language plpgsql security definer set search_path=public as $$
declare u record; n int;
begin
  if coalesce(p_absorbed, 0) <= 0 then return; end if;
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not public._bt_pk_has(u.perks, 'perk.altaan') then return; end if;
  n := public._bt_pk_tick(p_unit, 'blk', p_absorbed, 1000);
  if n > 0 then
    perform public._bt_mcd_cut(p_unit, n);
    perform public._bt_log(u.battle_id, format(
      '%s: альтаанский контур снял с поля %s000 урона — снаряжение на %s ход(а) ближе к готовности',
      u.unit_name, n, n));
  end if;
end$$;

-- «Наклонности»: удар пришёл в БОРТ → секунды к следующему ходу.
-- Борт = относительное направление на стрелявшего 1,2,4,5 (0 — нос, 3 — корма).
create or replace function public._bt_perk_side(p_unit uuid, p_dmg numeric, p_src uuid)
returns void language plpgsql security definer set search_path=public as $$
declare u record; s record; rel int; n int;
begin
  if p_src is null or coalesce(p_dmg, 0) <= 0 then return; end if;
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not public._bt_pk_has(u.perks, 'perk.list') then return; end if;
  select * into s from public.battle_units where id = p_src;
  if s.id is null or s.id = u.id then return; end if;
  rel := ((public._bt_dirof(u.x, u.y, s.x, s.y) - coalesce(u.facing, 0)) % 6 + 6) % 6;
  if rel not in (1, 2, 4, 5) then return; end if;    -- нос и корма перк не кормят
  n := public._bt_pk_tick(p_unit, 'side', p_dmg, 500);
  if n > 0 then
    perform public._bt_perk_bank(p_unit, n * 0.5);
    perform public._bt_log(u.battle_id, format(
      '%s принимает удар вскользь: гиродины снимают %s c к следующему ходу',
      u.unit_name, round(n * 0.5, 1)));
  end if;
end$$;

-- «Сияй другим»: лечим союзника на своих последних процентах.
create or replace function public._bt_perk_heal(p_unit uuid, p_healed numeric)
returns void language plpgsql security definer set search_path=public as $$
declare u record; n int;
begin
  if coalesce(p_healed, 0) <= 0 then return; end if;
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not public._bt_pk_has(u.perks, 'perk.shine') then return; end if;
  if u.hp > u.max_hp * 0.30 then return; end if;
  n := public._bt_pk_tick(p_unit, 'heal', p_healed, 500);
  if n > 0 then
    update public.battle_units set tp = tp + n * 0.5 where id = p_unit;
    perform public._bt_log(u.battle_id, format(
      '%s светит другим: +%s c к ходу за чужой залатанный корпус', u.unit_name, round(n * 0.5, 1)));
  end if;
end$$;

-- «Отчаяние»: корпус ушёл ниже четверти — один раз за бой.
create or replace function public._bt_perk_despair(p_unit uuid)
returns void language plpgsql security definer set search_path=public as $$
declare u record;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not u.alive then return; end if;
  if not public._bt_pk_has(u.perks, 'perk.despair') then return; end if;
  if coalesce((u.pk->>'desp')::int, 0) > 0 then return; end if;
  if u.hp >= u.max_hp * 0.25 then return; end if;
  update public.battle_units
     set deb = '{}'::jsonb,
         amp = 0, hard = 0, pdb = 0, guard = 0, rapid = false, sammo = false,
         stealth = stealth - cloak, cloak = 0,
         sensor  = sensor + blind,  blind = 0,
         pk = coalesce(pk,'{}'::jsonb) || jsonb_build_object('desp', 1)
   where id = p_unit;
  perform public._bt_perk_bank(p_unit, 2.0);
  perform public._bt_mcd_cut(p_unit, 1);
  perform public._bt_log(u.battle_id, format(
    '%s срывается в отчаяние: с борта слетает ВСЁ — и чужое, и своё, +2 c и −1 ход со всех кулдаунов',
    u.unit_name));
end$$;

-- «Спокоен как пульс покойника»: смертельный удар оставляет 1 корпуса.
-- ОДИН раз за бой НА СТОРОНУ — флаг живёт в battles.pk.
create or replace function public._bt_perk_save(p_unit uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare u record; b record;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not public._bt_pk_has(u.perks, 'perk.calm') then return false; end if;
  select * into b from public.battles where id = u.battle_id for update;
  if b.id is null or coalesce(b.pk,'{}'::jsonb) ? ('calm:' || u.side) then return false; end if;
  update public.battles
     set pk = coalesce(pk,'{}'::jsonb) || jsonb_build_object('calm:' || u.side, 1)
   where id = u.battle_id;
  update public.battle_units set hp = 1, alive = true where id = p_unit;
  perform public._bt_perk_bank(p_unit, 3.0);
  perform public._bt_log(u.battle_id, format(
    '%s держится на одном корпусе: пульс покойника ровен. +3 c к следующему ходу — на всю сторону это сработало в последний раз',
    u.unit_name));
  return true;
end$$;

-- Кладбище: гекс, где только что погиб борт («Некрофилия»).
create or replace function public._bt_grave_add(p_battle uuid, p_x int, p_y int)
returns void language sql security definer set search_path=public as $$
  update public.battles
     set graves = (select coalesce(jsonb_agg(g), '[]'::jsonb)
                     from jsonb_array_elements(coalesce(graves,'[]'::jsonb)) g
                    where coalesce((g->>'t')::int, 0) >= turn_no - 1)
                  || jsonb_build_object('x', p_x, 'y', p_y, 't', turn_no)
   where id = p_battle;
$$;

-- «Некрофилия»: борт встал на свежие обломки.
create or replace function public._bt_perk_necro(p_battle uuid, p_unit uuid)
returns void language plpgsql security definer set search_path=public as $$
declare u record; b record; heal numeric;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null or not public._bt_pk_has(u.perks, 'perk.necro') then return; end if;
  select * into b from public.battles where id = p_battle for update;
  if b.id is null then return; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(b.graves,'[]'::jsonb)) g
                  where (g->>'x')::int = u.x and (g->>'y')::int = u.y
                    and coalesce((g->>'t')::int, 0) >= b.turn_no - 1) then return; end if;
  update public.battles
     set graves = (select coalesce(jsonb_agg(g), '[]'::jsonb)
                     from jsonb_array_elements(coalesce(graves,'[]'::jsonb)) g
                    where not ((g->>'x')::int = u.x and (g->>'y')::int = u.y))
   where id = p_battle;
  heal := least(u.max_hp * 0.15, greatest(0, u.max_hp - u.hp));
  update public.battle_units
     set hp = least(max_hp, hp + heal), tp = tp + 1.5 where id = p_unit;
  perform public._bt_log(p_battle, format(
    '%s обирает свежие обломки: +%s корпуса и +1.5 c к ходу', u.unit_name, round(heal)));
end$$;

-- Добивание: «Серийный ресайклер» (модулем) и «Жажда крови» (залпом).
create or replace function public._bt_perk_kill(p_unit uuid, p_by text)
returns void language plpgsql security definer set search_path=public as $$
declare u record;
begin
  select * into u from public.battle_units where id = p_unit;
  if u.id is null then return; end if;
  if p_by = 'mod' and public._bt_pk_has(u.perks, 'perk.recycler') then
    perform public._bt_mcd_cut(p_unit, 1);
    perform public._bt_log(u.battle_id, format(
      '%s пускает обломки в приёмник: −1 ход со всех кулдаунов', u.unit_name));
  elsif p_by = 'wpn' and public._bt_pk_has(u.perks, 'perk.bloodlust') then
    perform public._bt_deb_add(p_unit, 'fury', 2);
    perform public._bt_log(u.battle_id, format(
      '%s чует кровь: урон орудий +30%% на два хода', u.unit_name));
  end if;
end$$;

-- Множитель кулдауна модулей («Медленно и верно» — шина тяжелее на пятую часть).
create or replace function public._bt_perk_cd(p_perks jsonb, p_cd int)
returns int language sql immutable as $$
  select case when public._bt_pk_has(p_perks, 'perk.slow')
              then ceil(greatest(0, coalesce(p_cd, 3)) * 1.20)::int
              else greatest(0, coalesce(p_cd, 3)) end;
$$;

-- «Кчау»: вне режима «двигатели» всё прочее дороже на 30%.
create or replace function public._bt_perk_kchau(p_perks jsonb, p_stance text)
returns numeric language sql immutable as $$
  select case when public._bt_pk_has(p_perks, 'perk.kchau')
                   and coalesce(p_stance,'off') <> 'eng'
              then 1.30 else 1.0 end;
$$;

-- ── 8. «Ярость» в словаре эффектов ───────────────────────────────
create or replace function public._bt_deb_ru(k text) returns text
 language sql immutable as $$
  select coalesce((jsonb_build_object(
    'stasis','вязкое поле','disrupt','шина снаряжения заглушена',
    'wbreak','наведение сбито','soft','броня вспорота',
    'fury','ярость — урон орудий +30%')->>k), k);
$$;

-- ══════════════════════════════════════════════════════════════════
--  9. ПАТЧИ БОЕВЫХ ФУНКЦИЙ
-- ══════════════════════════════════════════════════════════════════

-- ── Начало хода стороны: пул, кулдауны, «Терпение»/«Тайменеджмент» ──
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units u
     set moved = false, fired = false, acted = false, flash = false,
         tp = greatest(1, u.tp_max - greatest(0, coalesce(u.drain, 0)))
              -- «Тайменеджмент»: половина неистраченного остатка переходит дальше
              + case when public._bt_pk_has(u.perks, 'perk.timeman')
                     then greatest(0, coalesce(u.tp, 0)) * 0.5 else 0 end
              -- «Терпение»: модули, выходящие из перезарядки, отдают секунды
              + case when public._bt_pk_has(u.perks, 'perk.patience') then coalesce((
                       select sum(0.25 * greatest(1, coalesce(
                                (public._bt_act(u.acts, e.k)->>'cd')::int, 3)))
                         from jsonb_each_text(coalesce(u.mcd,'{}'::jsonb)) as e(k, v)
                        where v::int = 1), 0) else 0 end
              -- копилка перков, сработавших на чужом ходу
              + greatest(0, coalesce((u.pk->>'bank')::numeric, 0)),
         drain = 0,
         shield = 0,
         stance = case when u.stance = 'siege' then 'siege' else 'off' end,
         -- самобаффы живут ровно до своего следующего хода
         amp = 0, hard = 0, pdb = 0, guard = 0, rapid = false, sammo = false,
         stealth = u.stealth - u.cloak, cloak = 0,
         sensor  = u.sensor + u.blind,  blind = 0,
         -- копилка высыпана, разгон «Бимрайдера» без выстрела сгорел
         pk = (coalesce(u.pk,'{}'::jsonb) - 'bank') - 'ride',
         mcd = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(u.mcd,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb),
         deb = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(u.deb,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb)
   where u.battle_id = p_battle and u.side = p_side;
end$$;

-- ── Попадание (модули, тараны, площадь). p_src — КТО бил: нужен
--    «Наклонностям», чтобы отличить борт от носа. Аргумент с умолчанием,
--    поэтому старые вызовы с 4–5 аргументами продолжают работать.
--    СТАРУЮ 5-аргументную версию сносим: иначе Postgres оставит обе и вызов
--    с 5 аргументами станет неоднозначным (42725).
drop function if exists public._bt_hit(uuid, numeric, text, jsonb, boolean);
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text, p_terr jsonb,
                                          p_pierce boolean default false, p_src uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t record; rk numeric; rsh numeric; dmgfac numeric := 1;
        gdmg numeric; absb numeric := 0; use_sec numeric; hull numeric; killed boolean;
        gid uuid; redirected boolean := false;
begin
  -- «Эгида»: удар по прикрытому союзнику переадресуется гвардейцу целиком —
  -- вместе со щитом, бронёй и корпусом. Считаем ДО блокировки строки цели.
  gid := public._bt_guard_for(p_target);
  if gid is not null then p_target := gid; redirected := true; end if;

  select * into t from public.battle_units where id = p_target for update;
  if t.id is null or not t.alive then return jsonb_build_object('hull',0,'shield_absorbed',0,'killed',false); end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if p_pierce then rsh := 0; end if;                    -- таран идёт сквозь поле
  if public._bt_terra(p_terr, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(p_terr, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  -- «Эгида» / импульс брони
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));

  rk := least(0.9, greatest(-0.75, coalesce((t.resist->>coalesce(p_k,'kinetic'))::numeric, 0)));
  -- «Разрывной таран» вспорол обшивку — стойкости работают хуже
  if public._bt_deb_has(t.deb, 'soft') then rk := rk * 0.7; end if;
  if coalesce(p_k,'kinetic') = 'missile' then
    rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
  end if;
  -- ТАРАН: пробойка бьёт в обшивку в упор — стойкости успевают рассеять треть
  if p_pierce then rk := greatest(0, rk) * 0.35; end if;
  gdmg := p_dmg * (1 - rk) * dmgfac;

  if rsh > 0 and gdmg > 0 then
    use_sec := least(rsh, gdmg / greatest(1, t.mitig));
    absb    := use_sec * t.mitig * t.reduc;
    rsh     := rsh - use_sec;
  end if;

  -- плоская броня таран тоже не держит: удар приходится не в плиту, а сквозь неё
  hull := greatest(gdmg * 0.10, (gdmg - absb) - case when p_pierce then 0 else t.armor end);
  if gdmg <= 0 then hull := 0; end if;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set shield = case when p_pierce then shield else rsh end,
         hp = greatest(0, t.hp - hull), alive = not killed
   where id = p_target;
  if redirected and hull > 0 then
    perform public._bt_log(t.battle_id, format('«Эгида» %s принимает удар на себя: %s урона%s',
      t.unit_name, round(hull), case when killed then ' — гвардеец уничтожен' else '' end));
  end if;

  -- ── ПЕРКИ ЦЕЛИ ───────────────────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;              -- «Пульс покойника»
    else perform public._bt_grave_add(t.battle_id, t.x, t.y); end if;    -- обломки для «Некрофилии»
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absb);                       -- «Альтаанская стойкость»
    perform public._bt_perk_side(p_target, absb + hull, p_src);          -- «Наклонности»
    perform public._bt_perk_despair(p_target);                           -- «Отчаяние»
  end if;

  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb),
                            'killed', killed, 'guard', redirected);
end$$;

-- ── Ход по гексам: «Кчау», «Бимрайдер», «Некрофилия» ─────────────
create or replace function public._bt_do_move(p_battle uuid, p_unit uuid, p_path jsonb, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; e jsonb;
        cx int; cy int; nx int; ny int; f int;
        terr text; i int; total int; cost numeric; spend numeric := 0; hc numeric;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if u.stance = 'siege' then raise exception 'осадный режим приковал «%» к месту: платформа разложена, до конца хода корабль не сдвинуть', u.unit_name; end if;
  if u.cls = 'ss13' or u.speed <= 0 then raise exception 'станция неподвижна — она не двигается на поле боя'; end if;
  total := coalesce(jsonb_array_length(p_path), 0);
  if total < 1 then raise exception 'пустой маршрут'; end if;

  cost := public._bt_step_cost(u.speed);
  if u.stance = 'eng' then cost := cost * public._bt_eng_mult(); end if;
  -- «Кчау»: пока мощность в двигателях, гекс стоит вдвое меньше
  if public._bt_pk_has(u.perks, 'perk.kchau') and u.stance = 'eng' then cost := cost * 0.5; end if;
  if public._bt_deb_has(u.deb, 'stasis') then cost := cost * 2; end if;   -- вязкое поле
  if u.tp + 1e-9 < cost then
    raise exception '«%» израсходовал ход: осталось % c, а шаг стоит % c',
      u.unit_name, round(u.tp, 1), round(cost, 1);
  end if;

  cx := u.x; cy := u.y; f := u.facing;
  i := 0;
  for e in select value from jsonb_array_elements(p_path) loop
    i := i + 1;
    nx := coalesce((e->>'x')::int, -1); ny := coalesce((e->>'y')::int, -1);
    if nx < 0 or nx >= public._bt_w() or ny < 0 or ny >= public._bt_h() then
      raise exception 'маршрут выходит за доску';
    end if;
    if not public._bt_in_arena(b.shape, nx, ny) then
      raise exception 'маршрут уходит в пустоту за кромкой арены';
    end if;
    if public._bt_dist(cx, cy, nx, ny) <> 1 then raise exception 'маршрут разорван — шаг только в соседний гекс'; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = nx and y = ny) then
      raise exception 'гекс %:% занят — сквозь корабли не летают', nx, ny;
    end if;
    -- цена ВХОДА в клетку: пояс и обломки съедают ход быстрее пустоты
    hc := public._bt_hex_cost(b.terrain, cost, nx, ny);
    if spend + hc > u.tp + 1e-9 then
      raise exception '«%» не дотянет: маршрут стоит % c, а осталось % c — до %-го гекса секунд хватает',
        u.unit_name, round(spend + hc, 1), round(u.tp, 1), i - 1;
    end if;
    spend := spend + hc;
    f := public._bt_dirof(cx, cy, nx, ny);
    cx := nx; cy := ny;
  end loop;

  perform public._bt_use_act(p_battle, p_unit);
  terr := public._bt_terra(b.terrain, cx, cy);
  update public.battle_units
     set x = cx, y = cy, facing = f, straight = 99, moved = true,
         tp = greatest(0, tp - spend),
         shield = 0,       -- манёвр роняет поле: идти и держать щит одновременно нельзя
         -- «Бимрайдер»: разгон копится в pk.ride, потолок 5 гексов (+25%)
         pk = case when public._bt_pk_has(perks, 'perk.beamrider') and cls = 'destroyer'
                   then coalesce(pk,'{}'::jsonb) || jsonb_build_object('ride',
                          least(5, coalesce((pk->>'ride')::int, 0) + total))
                   else coalesce(pk,'{}'::jsonb) end
   where id = p_unit;
  if terr = 'neb' then
    perform public._bt_log(p_battle, format('%s входит в туманность — защитное поле схлопывается', u.unit_name));
  end if;
  perform public._bt_perk_necro(p_battle, p_unit);
  return jsonb_build_object('ok', true, 'facing', f, 'tp', round(u.tp - spend, 1));
end$$;

-- ── Залп: «Жажда крови», «Бимрайдер», «Конформист», «Кчау», «Сияй» ──
create or replace function public._bt_do_fire(p_battle uuid, p_unit uuid, p_target uuid, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; dist int;
        wg jsonb; dmgfac numeric := 1;
        absorbed numeric; hull numeric; killed boolean := false;
        band_ok boolean := false; too_close boolean := false;
        rk numeric; resisted numeric := 0;
        rsh numeric; shabs numeric := 0;
        grp_shots int; per_shot numeric; gdmg numeric; absb numeric;
        use_sec numeric; covered numeric;
        total_dmg numeric := 0; hull_leak numeric := 0; i int;
        ally boolean; heal_sum numeric := 0; healed numeric := 0;
        fcost numeric; boost numeric := 1; rmul numeric := 1;
        grng int; gopt int; gfar numeric; fmul numeric; gdmin int;
        ride int := 0;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  fcost := public._bt_fire_cost(u.cls);
  if u.stance = 'wpn' then fcost := fcost * public._bt_wpn_cost(); end if;
  if coalesce(u.rapid, false) then fcost := fcost * 0.5; end if;   -- беглый огонь
  fcost := fcost * public._bt_perk_kchau(u.perks, u.stance);       -- «Кчау» вне разгона
  if u.tp + 1e-9 < fcost then
    raise exception '«%» не успевает дать залп: нужно % c, осталось % c',
      u.unit_name, round(fcost, 1), round(u.tp, 1);
  end if;
  if u.stance = 'wpn'   then boost := public._bt_wpn_mult(); end if;   -- ФОРСАЖ ОРУДИЙ
  if u.stance = 'siege' then                                          -- ОСАДНЫЙ РЕЖИМ
    boost := public._bt_siege_dmg();
    rmul  := public._bt_siege_rng();
  end if;
  boost := boost * (1 + coalesce(u.amp, 0));
  if public._bt_deb_has(u.deb, 'wbreak') then boost := boost * 0.5; end if;   -- «Ломовик»
  if public._bt_deb_has(u.deb, 'fury')   then boost := boost * 1.30; end if;  -- «Жажда крови»
  -- «Капитан-конформист»: за ход не сдвинулся — станки вышли на точность
  if public._bt_pk_has(u.perks, 'perk.conformist') and not coalesce(u.moved, false) then
    boost := boost * 1.25; rmul := rmul * 1.25;
  end if;
  -- «Бимрайдер»: разгон копился по гексам, сгорает этим залпом
  if public._bt_pk_has(u.perks, 'perk.beamrider') and u.cls = 'destroyer' then
    ride := least(5, greatest(0, coalesce((u.pk->>'ride')::int, 0)));
    boost := boost * (1 + 0.05 * ride);
  end if;

  select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
  if t.id is null or not t.alive then raise exception 'цели нет'; end if;

  if t.side <> u.side then
    declare g uuid; begin
      g := public._bt_guard_for(t.id);
      if g is not null then
        perform public._bt_log(p_battle, format('«Эгида» перехватывает залп, назначенный %s', t.unit_name));
        p_target := g;
        select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
      end if;
    end; end if;
  ally := (t.side = u.side);
  dist := public._bt_dist(u.x, u.y, t.x, t.y);

  -- ══ РЕМОНТ СОЮЗНИКА (нано-рой) ═════════════════════════════
  if ally then
    if t.id = u.id then
      raise exception 'нано-рой чинит только ДРУГОЙ корабль — себя им не залатать';
    end if;
    if not exists(select 1 from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) g
                   where g->>'k' = 'repair') then
      raise exception 'по своим не стреляем: на «%» нет ремонтных нано-роёв', u.unit_name;
    end if;
    if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'путь рою перекрыт астероидами';
    end if;
    for wg in select value from jsonb_array_elements(coalesce(u.wpn,'[]'::jsonb)) loop
      if wg->>'k' = 'repair' and dist >= 1 and dist <= (wg->>'rng')::int then
        band_ok := true;
        heal_sum := heal_sum + (wg->>'dmg')::numeric;
      end if;
    end loop;
    if not band_ok then
      raise exception 'дистанция % — дальше, чем добрасывает ремонтный рой «%». Сблизьтесь', dist, u.unit_name;
    end if;
    heal_sum := heal_sum * boost;      -- форсаж орудий качает и ремонтный рой
    if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then heal_sum := heal_sum * 0.7; end if;
    healed := least(round(heal_sum), greatest(0, t.max_hp - t.hp));
    if healed <= 0 then raise exception '«%» и так цел — ремонтировать нечего', t.unit_name; end if;

    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set hp = least(max_hp, hp + healed) where id = p_target;
    update public.battle_units
       set fired = true, flash = true, tp = greatest(0, tp - fcost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s ⟳ %s: нано-рой восстановил %s корпуса',
      u.unit_name, t.unit_name, round(healed)));
    perform public._bt_perk_heal(p_unit, healed);            -- «Сияй другим»
    return jsonb_build_object('ok', true, 'healed', round(healed), 'hull', 0,
                              'shield_absorbed', 0, 'resisted', 0, 'killed', false,
                              'tp', round(u.tp - fcost, 1));
  end if;

  -- ══ ОБЫЧНЫЙ ЗАЛП ═══════════════════════════════════════════
  if not exists(select 1 from public.battle_units m
                 where m.battle_id = p_battle and m.side = u.side and m.alive
                   and public._bt_detected(m.x, m.y, m.facing,
                                           greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                           t.x, t.y, t.stealth, t.flash)) then
    raise exception 'цель не захвачена: неопознанный контакт. Подведите корабль с радаром ближе (визуал — 3 гекса) или выбейте РЭБ-глушилки врага';
  end if;

  if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
    raise exception 'линия огня перекрыта астероидами';
  end if;

  rsh := greatest(0, coalesce(t.shield, 0));
  if public._bt_terra(b.terrain, t.x, t.y) = 'neb' then rsh := 0; dmgfac := 0.7; end if;
  if public._bt_terra(b.terrain, t.x, t.y) = 'deb' then dmgfac := 0.85; end if;
  dmgfac := dmgfac * (1 - least(0.8, greatest(0, coalesce(t.hard, 0))));   -- броневой замок цели
  if public._bt_deb_has(t.deb, 'soft') then dmgfac := dmgfac * 1.2; end if;   -- обшивка вспорота

  for wg in select value from jsonb_array_elements(
      case when u.wpn is null or jsonb_array_length(u.wpn) = 0
           then jsonb_build_array(jsonb_build_object('rng',u.rng,'dmg',u.dmg))
           else u.wpn end) loop
    if coalesce(wg->>'k','kinetic') <> 'repair' then
      -- Дальность группы: осадный режим и «Конформист» раздвигают рубеж.
      grng  := greatest(1, ceil((wg->>'rng')::numeric * rmul)::int);
      gdmin := greatest(1, coalesce((wg->>'dmin')::int,
                                    public._bt_wpn_dmin(wg->>'k')));
      if dist >= 1 and dist < gdmin then
        too_close := true;                       -- ракеты вплотную не наводятся
      elsif dist >= gdmin and dist <= grng then
        band_ok := true;
        -- Модель урона по дистанции: до gopt — полный, дальше линейно до gfar.
        gopt := greatest(1, floor(grng * coalesce((wg->>'opt')::numeric,
                                                  public._bt_wpn_opt(wg->>'k')))::int);
        gfar := coalesce((wg->>'far')::numeric, public._bt_wpn_far(wg->>'k'));
        if dist <= gopt or grng <= gopt then
          fmul := 1;
        else
          fmul := 1 - (1 - gfar) * (dist - gopt)::numeric / (grng - gopt)::numeric;
        end if;
        fmul := greatest(0.05, least(1, fmul));

        rk := least(0.9, greatest(-0.75, coalesce(
                (t.resist->>coalesce(wg->>'k','kinetic'))::numeric, 0)));
        if coalesce(wg->>'k','kinetic') = 'missile' and coalesce(t.pd,0) > 0 then
          rk := 1 - (1 - rk) * (1 - least(0.6, coalesce(t.pd,0) + coalesce(t.pdb,0)));
        end if;
        gdmg     := (wg->>'dmg')::numeric * boost * fmul * (1 - rk) * dmgfac;
        resisted := resisted + (wg->>'dmg')::numeric * boost * fmul * rk * dmgfac;
        grp_shots := greatest(1, least(6, coalesce((wg->>'shots')::int, 1)));
        per_shot := gdmg / grp_shots;
        for i in 1..grp_shots loop
          absb := 0;
          if rsh > 0 and per_shot > 0 then
            use_sec := least(rsh, per_shot / greatest(1, t.mitig));
            covered := use_sec * t.mitig;
            absb    := covered * t.reduc;
            rsh     := rsh - use_sec;
          end if;
          shabs     := shabs + absb;
          total_dmg := total_dmg + per_shot;
          hull_leak := hull_leak + (per_shot - absb);
        end loop;
      end if;
    end if;
  end loop;
  if not band_ok then
    if too_close then
      raise exception 'дистанция % — ракетам не хватает разгона на захват, отойдите дальше (нужно от % гексов)',
        dist, (select min(greatest(1, coalesce((g->>'dmin')::int, 1)))
                 from jsonb_array_elements(u.wpn) g
                where coalesce(g->>'k','kinetic') = 'missile');
    end if;
    raise exception 'дистанция % — дальше, чем бьют огневые группы «%». Сблизьтесь', dist, u.unit_name;
  end if;

  perform public._bt_use_act(p_battle, p_unit);

  absorbed := shabs;
  hull := greatest(total_dmg * 0.10, hull_leak - t.armor);
  if total_dmg <= 0 then hull := 0; end if;
  update public.battle_units
     set shield = rsh,
         hp = greatest(0, t.hp - hull),
         alive = (t.hp - hull) > 0
   where id = p_target;
  killed := (t.hp - hull) <= 0;
  update public.battle_units
     set fired = true, flash = true, tp = greatest(0, tp - fcost),
         pk = coalesce(pk,'{}'::jsonb) - 'ride'     -- разгон «Бимрайдера» сгорел
   where id = p_unit;

  perform public._bt_log(p_battle, format('%s → %s: %s урона%s%s%s%s',
    u.unit_name, t.unit_name, round(absorbed + hull),
    case when u.stance = 'siege' then ' (осадный режим)'
         when boost > 1 then ' (форсаж орудий)' else '' end,
    case when ride > 0 then format(' (разгон +%s%%)', ride * 5) else '' end,
    case when resisted >= 1 then format(' (броня рассеяла %s)', round(resisted)) else '' end,
    case when killed then ' — цель уничтожена' else '' end));

  -- ── ПЕРКИ ЦЕЛИ И СТРЕЛЯВШЕГО ─────────────────────────────────
  if killed then
    if public._bt_perk_save(p_target) then killed := false;
    else perform public._bt_grave_add(p_battle, t.x, t.y); end if;
  end if;
  if not killed then
    perform public._bt_perk_block(p_target, absorbed);
    perform public._bt_perk_side(p_target, absorbed + hull, p_unit);
    perform public._bt_perk_despair(p_target);
  else
    perform public._bt_perk_kill(p_unit, 'wpn');            -- «Жажда крови»
  end if;

  if coalesce(u.sammo, false) then
    perform public._bt_deb_add(p_target, 'stasis', 1);
    perform public._bt_log(p_battle, format('%s сажает %s в стазис-поле: следующий ход вдвое дороже',
      u.unit_name, t.unit_name));
  end if;
  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'shield_absorbed', round(absorbed), 'hull', round(hull),
                            'resisted', round(resisted), 'killed', killed, 'healed', 0,
                            'tp', round(u.tp - fcost, 1), 'target_shield', round(rsh, 1));
end$$;

-- ── Мощность в щит: «Кчау» вне разгона режет банкуемые секунды ────
create or replace function public.battle_stance(p_battle uuid, p_unit uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; cost numeric; sec numeric;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  perform public._bt_arm(p_battle);
  me := public._ec_my_fid();
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;
  if p_mode not in ('eng','wpn','shd','siege','off') then raise exception 'неизвестный режим «%»', p_mode; end if;

  -- СВОРАЧИВАНИЕ ОСАДЫ
  if p_mode = 'off' then
    if u.stance <> 'siege' then
      raise exception 'сворачивать нечего: «%» не в осадном режиме', u.unit_name;
    end if;
    cost := public._bt_act_cost('siege') * public._bt_perk_kchau(u.perks, u.stance);
    if u.tp + 1e-9 < cost then
      raise exception 'на сборку платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'off', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s сворачивает осадную платформу — снова на ходу', u.unit_name));
    return jsonb_build_object('ok', true, 'stance', 'off', 'tp', round(u.tp - cost, 1));
  end if;

  if u.stance <> 'off' then
    raise exception 'мощность уже направлена в этом ходу («%») — переиграть можно только следующим ходом%',
      case u.stance when 'eng' then 'двигатели' when 'wpn' then 'орудия'
                    when 'siege' then 'осадный режим' else 'щит' end,
      case when u.stance = 'siege' then '. Платформу можно свернуть — это отдельное действие' else '' end;
  end if;

  if p_mode = 'shd' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности защитное поле не держится';
    end if;
    -- «Кчау»: всё, кроме разгона, идёт с наценкой — в поле уходит меньше секунд
    sec := u.tp / public._bt_perk_kchau(u.perks, u.stance);
    if sec <= 0 then raise exception '«%» израсходовал ход — секунд на щит не осталось', u.unit_name; end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units
       set stance = 'shd', shield = shield + sec, tp = 0, acted = true
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уводит мощность в щит: %s c поля (гасит %s урона/с, снимает %s%%)',
      u.unit_name, round(sec,1), round(u.mitig), round(u.reduc*100)));
    return jsonb_build_object('ok', true, 'stance', 'shd', 'shield', round(u.shield + sec, 1), 'tp', 0);
  end if;

  -- ОСАДА: только если на борту стоит «Осадная платформа «Кряж»».
  if p_mode = 'siege' then
    if public._bt_act(u.acts, 'siege') is null then
      raise exception 'на «%» нет осадной платформы: поставьте модуль «Осадная платформа «Кряж»» в конструкторе', u.unit_name;
    end if;
    cost := public._bt_act_cost('siege') * public._bt_perk_kchau(u.perks, u.stance);
    if u.tp + 1e-9 < cost then
      raise exception 'на раскладку осадной платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'siege', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s раскладывает осадную платформу: урон ×%s, рубеж ×%s — платформа держится, пока её не свернут',
      u.unit_name, public._bt_siege_dmg(), public._bt_siege_rng()));
    return jsonb_build_object('ok', true, 'stance', 'siege', 'tp', round(u.tp - cost, 1));
  end if;

  cost := public._bt_stance_cost();
  if u.tp + 1e-9 < cost then
    raise exception 'на переброс мощности нужно % c, у «%» осталось % c',
      round(cost,1), u.unit_name, round(u.tp,1);
  end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units set stance = p_mode, tp = greatest(0, tp - cost) where id = p_unit;
  perform public._bt_log(p_battle, case p_mode
    when 'eng' then format('%s форсирует двигатели: шаг дешевле на %s%%', u.unit_name, round((1-public._bt_eng_mult())*100))
    else            format('%s форсирует орудия: урон залпа ×%s', u.unit_name, public._bt_wpn_mult()) end);
  return jsonb_build_object('ok', true, 'stance', p_mode, 'tp', round(u.tp - cost, 1));
end$$;

-- ── Что видит клиент: карточки, накопители, «Эгида»/маскировка ────
create or replace function public.battle_state(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b record; sd text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  me := public._ec_my_fid();
  select * into b from public.battles where id = p_battle;
  if b.id is null then raise exception 'no such battle'; end if;
  sd := public._bt_side(p_battle, me);
  if sd is null then raise exception 'вы не участвуете в этом бою'; end if;

  -- форма → сектора → ландшафт: генерится лениво один раз, сид = id боя
  perform public._bt_ensure_field(p_battle);
  select * into b from public.battles where id = p_battle;

  return jsonb_build_object(
    'id', b.id, 'status', b.status, 'kind', b.kind,
    'system_id', b.system_id,
    'system_name', (select coalesce(nullif(ms.name,''), ms.id) from public.map_systems ms where ms.id = b.system_id),
    'w', public._bt_w(), 'h', public._bt_h(), 'cap', public._bt_cap(),
    'duel_budget', b.duel_budget,
    'zone', public._bt_zone(), 'acts_max', public._bt_acts(), 'acts_left', b.acts_left,
    'tp_max', public._bt_tp_max(),
    'shape', b.shape, 'spawn', b.spawn,
    'my_side', sd, 'my_fid', me,
    'attacker', b.attacker_fid, 'attacker_name', public._war_nm(b.attacker_fid),
    'defender', b.defender_fid, 'defender_name', public._war_nm(b.defender_fid),
    'side_to_move', b.side_to_move, 'my_turn', (b.side_to_move = sd),
    'turn_no', b.turn_no,
    'att_turns_left', b.att_turns_left, 'def_turns_left', b.def_turns_left,
    'att_ready', b.att_ready, 'def_ready', b.def_ready,
    'deadline_at', b.deadline_at,
    'can_force', (b.status='active' and b.side_to_move is distinct from sd
                  and b.deadline_at is not null and b.deadline_at <= now()),
    'winner', b.winner_fid,
    'interdicted', public._bt_interdicted(p_battle, sd),
    'log', b.log,
    'terrain', coalesce(b.terrain, '[]'::jsonb),
    -- свежие обломки: «Некрофилия» кормится с них, доска их подсвечивает
    'graves', (select coalesce(jsonb_agg(g), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(b.graves,'[]'::jsonb)) g
                where coalesce((g->>'t')::int, 0) >= b.turn_no - 1),
    'pool', public.battle_pool(p_battle, me),
    'units', (select coalesce(jsonb_agg(
        case when u.side = sd or lk.locked then
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', (u.fid = me),
            'fid', u.fid, 'fname', public._war_nm(u.fid),
            'name', u.unit_name, 'cls', u.cls,
            'x', u.x, 'y', u.y, 'facing', u.facing, 'straight', u.straight,
            'hp', round(u.hp), 'max_hp', round(u.max_hp),
            -- ЩИТ = СЕКУНДЫ. mitig/reduc — паспорт поля, клиент рисует по ним подсказку
            'shield', round(u.shield, 1), 'mitig', round(u.mitig), 'reduc', u.reduc,
            'stance', u.stance, 'tp', round(u.tp, 1), 'tp_max', round(u.tp_max, 1),
            'step_cost', round(public._bt_step_cost(u.speed), 2),
            'fire_cost', round(public._bt_fire_cost(u.cls), 2),
            'armor', round(u.armor), 'dmg', round(u.dmg),
            'speed', u.speed, 'rng', u.rng,
            'sensor', u.sensor, 'stealth', u.stealth, 'flash', u.flash,
            'pd', u.pd, 'jam', u.jam, 'wings', u.wings, 'is_wing', u.is_wing,
            'dejam', u.dejam, 'eccm', u.eccm, 'interdict', u.interdict, 'stabil', u.stabil,
            'ftl', u.ftl,
            'locked', true,
            'wpn', case when u.side = sd then coalesce(u.wpn, '[]'::jsonb) else null end,
            'acts', case when u.side = sd then coalesce(u.acts, '[]'::jsonb) else null end)
          || jsonb_build_object(
            'deb',   coalesce(u.deb, '{}'::jsonb),
            'hard',  u.hard, 'pdb', u.pdb,
            'rapid', u.rapid, 'sammo', u.sammo,
            -- карточки экипажа видны и на чужом опознанном борте: это разведка,
            -- а не чит — иначе игрок не поймёт, почему крейсер встал на 1 HP
            'perks', coalesce(u.perks, '[]'::jsonb),
            'guard', u.guard, 'cloak', u.cloak, 'blind', u.blind,
            'mcd',  case when u.side = sd then coalesce(u.mcd, '{}'::jsonb) else null end,
            'pk',   case when u.side = sd then coalesce(u.pk, '{}'::jsonb) else null end,
            'amp',  case when u.side = sd then u.amp else null end,
            'resist', u.resist,
            'moved', u.moved, 'fired', u.fired, 'acted', u.acted)
        else
          jsonb_build_object(
            'id', u.id, 'side', u.side, 'mine', false, 'contact', true,
            'locked', false, 'x', u.x, 'y', u.y)
        end order by u.created_at), '[]'::jsonb)
      from public.battle_units u
      cross join lateral (select exists(
          select 1 from public.battle_units m
           where m.battle_id = p_battle and m.side = sd and m.alive
             and public._bt_detected(m.x, m.y, m.facing,
                                     greatest(0, m.sensor - greatest(0, public._bt_ecm(p_battle, m.side, m.x, m.y) - m.eccm)),
                                     u.x, u.y, u.stealth, u.flash)) as locked) lk
      where u.battle_id = p_battle and u.alive));
end$$;

-- ── Модули: «Кчау» на цене, «Медленно и верно» на кулдауне,
--    «Ресайклер» на добивании, «Сияй другим» на ремонте ────────────
create or replace function public._bt_do_module(p_battle uuid, p_unit uuid, p_key text, p_target uuid, p_x integer, p_y integer, p_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me text; b public.battles; u record; t record; a jsonb;
        cost numeric; cd int; dist int; hit jsonb; res jsonb;
        dmg numeric; a_rng int; val numeric; killed int := 0; healed numeric;
        n int := 0; tx int; ty int; nx int; ny int; step int;
begin
  perform public._bt_arm(p_battle);
  me := p_fid;
  b  := public._bt_require_turn(p_battle, me);
  select * into u from public.battle_units where id = p_unit and battle_id = p_battle for update;
  if u.id is null then raise exception 'no such unit'; end if;
  if u.fid is distinct from me then raise exception 'это не ваш корабль'; end if;
  if not u.alive then raise exception 'корабль уничтожен'; end if;

  if public._bt_deb_has(u.deb, 'disrupt') then
    raise exception 'шина снаряжения «%» заглушена подавителем — в этом ходу модули не работают', u.unit_name;
  end if;

  a := public._bt_act(u.acts, p_key);
  if a is null then raise exception 'на «%» нет такого снаряжения', u.unit_name; end if;

  cd := coalesce((u.mcd->>p_key)::int, 0);
  if cd > 0 then
    raise exception '«%» ещё перезаряжается: осталось % ход(ов)', public._bt_act_name(p_key), cd;
  end if;

  cost := public._bt_act_cost(p_key) * public._bt_perk_kchau(u.perks, u.stance);
  if u.tp + 1e-9 < cost then
    raise exception 'на «%» нужно % c, у «%» осталось % c',
      public._bt_act_name(p_key), round(cost,1), u.unit_name, round(u.tp,1);
  end if;

  dmg := coalesce((a->>'dmg')::numeric, 0);
  a_rng := coalesce((a->>'rng')::int, 1);
  val := coalesce((a->>'val')::numeric, 0);

  -- ══ ОДИНОЧНЫЕ УДАРЫ ПО ЦЕЛИ ═══════════════════════════════
  if p_key in ('salvo','storm','ram','rupture','drain','wbreak','disrupt','tartarus') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if p_key in ('ram','rupture') and dist <> 1 then
      raise exception 'таран бьёт только вплотную: до цели % гекс(ов)', dist;
    end if;
    if p_key = 'salvo' and dist < 2 then
      raise exception 'дистанция % — ракетам не хватает разгона на захват', dist;
    end if;
    if dist > a_rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), a_rng;
    end if;
    if p_key not in ('ram','rupture','nuke','torpedo')
       and not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;

    hit := public._bt_hit(t.id, dmg,
             case when p_key in ('ram','rupture') then 'kinetic'
                  when p_key in ('wbreak','disrupt','drain','tartarus') then 'missile'
                  else 'missile' end,
             b.terrain,
             p_key in ('ram','rupture'),             -- тараны идут сквозь щит
             p_unit);                                -- кто бил — для «Наклонностей»
    if (hit->>'killed')::bool then killed := 1; end if;

    if p_key = 'rupture'  then perform public._bt_deb_add(t.id, 'soft', 1); end if;
    if p_key = 'wbreak'   then perform public._bt_deb_add(t.id, 'wbreak', 1); end if;
    if p_key = 'disrupt'  then perform public._bt_deb_add(t.id, 'disrupt', 1); end if;
    if p_key = 'drain'    then update public.battle_units set drain = drain + val where id = t.id; end if;
    if p_key = 'tartarus' then
      perform public._bt_deb_add(t.id, 'stasis', 1);
      perform public._bt_deb_add(t.id, 'disrupt', 1);
      update public.battle_units set drain = drain + 2 where id = t.id;
    end if;

    perform public._bt_log(p_battle, format('%s ✦ %s: %s — %s урона%s',
      u.unit_name, t.unit_name, public._bt_act_name(p_key),
      (hit->>'hull')::numeric + (hit->>'shield_absorbed')::numeric,
      case when killed > 0 then ' — цель уничтожена' else '' end));
    res := jsonb_build_object('hit', hit);

  -- ══ УДАРЫ ПО ПЛОЩАДИ ══════════════════════════════════════
  elsif p_key in ('broadside','torpedo','nuke') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'по своим не бьём'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > a_rng then
      raise exception 'дистанция % — «%» достаёт до % гексов', dist, public._bt_act_name(p_key), a_rng;
    end if;
    if p_key not in ('ram','rupture','nuke','torpedo')
       and not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception 'линия огня перекрыта астероидами';
    end if;
    tx := t.x; ty := t.y;
    -- накрывает цель и всё вокруг неё, включая своих: это площадь, не выстрел
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and id <> p_unit
                and public._bt_dist(x, y, tx, ty) <= (case when p_key = 'nuke' then 2 else 1 end)
    loop
      hit := public._bt_hit(t.id,
               case when t.x = tx and t.y = ty then dmg
                    when p_key <> 'nuke' then dmg * 0.65
                    when public._bt_dist(t.x, t.y, tx, ty) = 1 then dmg * 0.75
                    else dmg * 0.45 end,
               case when p_key = 'broadside' then 'energy'
                    when p_key = 'nuke' then 'kinetic'    -- подрыв уже не сбить ПРО
                    else 'missile' end,
               b.terrain, false, p_unit);
      n := n + 1;
      if (hit->>'killed')::bool then killed := killed + 1; end if;
    end loop;
    perform public._bt_log(p_battle, format('%s ✷ %s: накрыто бортов — %s%s',
      u.unit_name, public._bt_act_name(p_key), n,
      case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('splash', n, 'killed_n', killed);

  -- ══ ИМПУЛЬС ПО ВРАГАМ ВОКРУГ ══════════════════════════════
  elsif p_key in ('hell','blind','stasis') then
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and side <> u.side
                and public._bt_dist(x, y, u.x, u.y) <= a_rng
    loop
      n := n + 1;
      if p_key = 'hell' then
        hit := public._bt_hit(t.id, dmg, 'energy', b.terrain, false, p_unit);
        if (hit->>'killed')::bool then killed := killed + 1; end if;
      elsif p_key = 'blind' then
        update public.battle_units
           set sensor = greatest(0, sensor - val::int), blind = blind + val::int
         where id = t.id;
      else
        perform public._bt_deb_add(t.id, 'stasis', 1);
      end if;
    end loop;
    if n = 0 then raise exception 'в радиусе % гексов нет ни одного врага', a_rng; end if;
    perform public._bt_log(p_battle, format('%s ◎ %s: задето врагов — %s%s',
      u.unit_name, public._bt_act_name(p_key), n,
      case when killed > 0 then format(', уничтожено %s', killed) else '' end));
    res := jsonb_build_object('hit_n', n, 'killed_n', killed);

  -- ══ ИМПУЛЬС ПО СВОИМ ВОКРУГ ═══════════════════════════════
  elsif p_key in ('pboost','pdup','aboost') then
    for t in select * from public.battle_units
              where battle_id = p_battle and alive and side = u.side
                and public._bt_dist(x, y, u.x, u.y) <= a_rng
    loop
      n := n + 1;
      if p_key = 'pboost' then
        update public.battle_units set amp = amp + val where id = t.id;
      elsif p_key = 'pdup' then
        update public.battle_units set pdb = greatest(pdb, val) where id = t.id;
      else
        update public.battle_units set hard = greatest(hard, val) where id = t.id;
      end if;
    end loop;
    perform public._bt_log(p_battle, format('%s ◈ %s: накрыто своих бортов — %s',
      u.unit_name, public._bt_act_name(p_key), n));
    res := jsonb_build_object('ally_n', n);

  -- ══ БАФФ СОЮЗНИКУ / РЕМОНТ ════════════════════════════════
  elsif p_key in ('wboost','drones') then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side <> u.side then raise exception 'это снаряжение работает по СВОИМ'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > a_rng then raise exception 'дистанция % — достаёт до % гексов', dist, a_rng; end if;
    if p_key = 'wboost' then
      update public.battle_units set amp = amp + val where id = t.id;
      perform public._bt_log(p_battle, format('%s ◈ %s: орудийный контур разогнан на %s%%',
        u.unit_name, t.unit_name, round(val * 100)));
      res := jsonb_build_object('amp', val);
    else
      healed := least(val, greatest(0, t.max_hp - t.hp));
      if healed <= 0 then raise exception '«%» и так цел', t.unit_name; end if;
      update public.battle_units set hp = least(max_hp, hp + healed) where id = t.id;
      perform public._bt_log(p_battle, format('%s ⟳ %s: ремонтные дроны вернули %s корпуса',
        u.unit_name, t.unit_name, round(healed)));
      perform public._bt_perk_heal(p_unit, healed);          -- «Сияй другим»
      res := jsonb_build_object('healed', round(healed));
    end if;

  -- ══ ТЯГОВЫЙ ЛУЧ ═══════════════════════════════════════════
  elsif p_key = 'tractor' then
    select * into t from public.battle_units where id = p_target and battle_id = p_battle;
    if t.id is null or not t.alive then raise exception 'цели нет'; end if;
    if t.side = u.side then raise exception 'тяговый луч — для чужих бортов'; end if;
    dist := public._bt_dist(u.x, u.y, t.x, t.y);
    if dist > a_rng then raise exception 'дистанция % — луч достаёт до % гексов', dist, a_rng; end if;
    if dist <= 1 then raise exception '«%» и так вплотную — тянуть некуда', t.unit_name; end if;
    nx := t.x; ny := t.y;
    -- шагаем к себе, пока есть куда: занятый или закрытый гекс останавливает
    for step in 1..greatest(1, val::int) loop
      tx := nx + sign(u.x - nx); ty := ny + sign(u.y - ny);
      exit when public._bt_dist(tx, ty, u.x, u.y) < 1;
      exit when not public._bt_in_arena(b.shape, tx, ty);
      exit when exists(select 1 from public.battle_units
                        where battle_id = p_battle and alive and x = tx and y = ty);
      nx := tx; ny := ty;
    end loop;
    if nx = t.x and ny = t.y then raise exception 'цель не сдвинуть: путь к вам перекрыт'; end if;
    update public.battle_units set x = nx, y = ny where id = t.id;
    perform public._bt_log(p_battle, format('%s ⟿ %s: тяговый луч подтянул цель на %s гекс(ов)',
      u.unit_name, t.unit_name, public._bt_dist(t.x, t.y, nx, ny)));
    res := jsonb_build_object('x', nx, 'y', ny);

  -- ══ ПРЫЖОК ════════════════════════════════════════════════
  elsif p_key = 'blink' then
    if p_x is null or p_y is null then raise exception 'некуда прыгать: не указан гекс'; end if;
    if p_x < 0 or p_x >= public._bt_w() or p_y < 0 or p_y >= public._bt_h()
       or not public._bt_in_arena(b.shape, p_x, p_y) then
      raise exception 'прыжок за кромку арены';
    end if;
    dist := public._bt_dist(u.x, u.y, p_x, p_y);
    if dist < 1 or dist > a_rng then raise exception 'прыжок бьёт на % гексов, а до цели %', a_rng, dist; end if;
    if exists(select 1 from public.battle_units
               where battle_id = p_battle and alive and x = p_x and y = p_y) then
      raise exception 'гекс %:% занят', p_x, p_y;
    end if;
    if u.stance = 'siege' then raise exception 'из разложенной осады не прыгают'; end if;
    update public.battle_units set x = p_x, y = p_y, moved = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит прыжком на %s гекс(ов)', u.unit_name, dist));
    perform public._bt_perk_necro(p_battle, p_unit);          -- обломки под килем
    res := jsonb_build_object('x', p_x, 'y', p_y);

  -- ══ САМОБАФФЫ ═════════════════════════════════════════════
  elsif p_key = 'cloak' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности поле маскировки не держится';
    end if;
    update public.battle_units
       set stealth = stealth + val::int, cloak = cloak + val::int, flash = false
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уходит под маскировочное поле: +%s к скрытности', u.unit_name, val::int));
    res := jsonb_build_object('cloak', val::int);

  elsif p_key = 'amp' then
    update public.battle_units set amp = amp + val where id = p_unit;
    perform public._bt_log(p_battle, format('%s разгоняет орудийный контур: +%s%% урона до конца хода',
      u.unit_name, round(val * 100)));
    res := jsonb_build_object('amp', val);

  elsif p_key = 'hard' then
    update public.battle_units
       set hard = greatest(hard, val), guard = greatest(guard, greatest(1, rng))
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s поднимает «Эгиду»: удары по соседним своим идут в него, входящий −%s%%',
      u.unit_name, round(val * 100)));
    res := jsonb_build_object('hard', val);

  elsif p_key = 'rapid' then
    update public.battle_units set rapid = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s переходит на беглый огонь: залп вдвое дешевле', u.unit_name));
    res := jsonb_build_object('rapid', true);

  elsif p_key = 'sammo' then
    update public.battle_units set sammo = true where id = p_unit;
    perform public._bt_log(p_battle, format('%s заряжает стазис-боеприпас', u.unit_name));
    res := jsonb_build_object('sammo', true);

  elsif p_key = 'energy' then
    update public.battle_units set tp = least(tp_max, tp + val) where id = p_unit;
    perform public._bt_log(p_battle, format('%s сбрасывает буфер в шину: +%s c к ходу', u.unit_name, val));
    res := jsonb_build_object('tp_gain', val);

  elsif p_key = 'reboot' then
    perform public._bt_mcd_cut(p_unit, greatest(1, val::int));
    perform public._bt_log(p_battle, format('%s перезапускает шину снаряжения: −%s ход(а) со всех кулдаунов',
      u.unit_name, greatest(1, val::int)));
    res := jsonb_build_object('reboot', greatest(1, val::int));

  else
    raise exception 'неизвестное снаряжение «%»', p_key;
  end if;

  -- «Серийный ресайклер»: последний удар нанёс МОДУЛЬ
  if killed > 0 then perform public._bt_perk_kill(p_unit, 'mod'); end if;

  perform public._bt_use_act(p_battle, p_unit);
  update public.battle_units
     set tp  = greatest(0, tp - cost),
         mcd = coalesce(mcd,'{}'::jsonb)
               || jsonb_build_object(p_key, public._bt_perk_cd(u.perks, (a->>'cd')::int))
   where id = p_unit;

  perform public._bt_check_end(p_battle);
  return jsonb_build_object('ok', true, 'key', p_key,
                            'tp', round(u.tp - cost, 1),
                            'cd', public._bt_perk_cd(u.perks, (a->>'cd')::int)) || coalesce(res, '{}'::jsonb);
end$$;

-- ── Публикация проекта: карточка требует изученного узла ──────────
create or replace function public._cn_req_tech(p_cat text, p_data jsonb)
returns text[] language plpgsql immutable as $$
declare
  cab jsonb := public._cn_catalog();
  base_cls jsonb; base_wpn jsonb; keys text[] := '{}';
  k text; w jsonb; m jsonb; h jsonb;
begin
  if p_cat = 'division' then return '{}'; end if;
  base_cls := cab->'base'->'classes'->p_cat;
  base_wpn := cab->'base'->'weapons'->p_cat;
  k := p_data->>'class';
  if k is not null and not (base_cls ? k) then keys := array_append(keys, 'cls.'||p_cat||'.'||k); end if;
  if k is not null and coalesce((p_data->>'type')::int,0) >= 1 then keys := array_append(keys, 'type.'||p_cat||'.'||k); end if;
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    if (w->>'g') is not null
       and (w->>'turretId') is null
       and (w->>'g') <> '⚙ Свои орудия'
       and not (base_wpn ? (w->>'g'))
    then keys := array_append(keys, 'wpn.'||p_cat||'.'||(w->>'g')); end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
    if (m->>'g') is not null then keys := array_append(keys, 'mod.'||p_cat||'.'||(m->>'g')); end if;
  end loop;
  if jsonb_array_length(coalesce(p_data->'hangars','[]'::jsonb)) > 0 then
    keys := array_append(keys, 'hangar.ship');
    for h in select * from jsonb_array_elements(p_data->'hangars') loop
      if (h->>'id')::int in (1,2) then keys := array_append(keys, 'hangar.ship.heavy'); end if;
    end loop;
  end if;
  -- КАРТОЧКИ ЭКИПАЖА: id перка = id узла древа, гейт прямой
  for k in select value from jsonb_array_elements_text(coalesce(p_data->'perks','[]'::jsonb)) loop
    if public._perk_cat() ? k then keys := array_append(keys, k); end if;
  end loop;
  return (select array_agg(distinct e) from unnest(keys) e);
end$$;
