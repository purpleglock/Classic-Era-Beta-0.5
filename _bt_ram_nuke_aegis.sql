-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ТАРАНЫ, ЯДЕРКА И «ЭГИДА» (правка к _bt_modules2.sql)
-- ────────────────────────────────────────────────────────────
-- ЧТО БЫЛО НЕ ТАК.
-- 1) ТАРАН. Лор обещал «сквозь щит», код это и делал — и на том всё. Дальше
--    удар честно проходил через стойкости (rk) и плоскую броню (armor), то есть
--    ровно тот слой, ради которого таран и берут. 8000 у «Плазменного» после
--    resist 0.3 и armor 2500 превращались в ~3100 по корпусу — за 2 секунды,
--    кулдаун 3 хода и обязательство встать вплотную к тому, кто тебя убьёт.
-- 2) ЯДЕРКА. Радиус накрытия = 1 гекс (как у «Голиафа» вдвое дешевле), тип
--    урона 'missile' — то есть ПРО цели резала до 60% от боеголовки, уже
--    подорвавшейся в гексе. Плюс общий гейт _bt_los_clear: астероид на линии
--    отменял пуск, хотя ракета идёт по дуге.
-- 3) «БРОНЕВОЙ ЗАМОК». Имя обещало неуязвимость, механика давала −50% себе —
--    то же, что «Импульс брони» даёт ВСЕМУ строю, только хуже.
--
-- ЧТО ДЕЛАЕМ.
-- 1) p_pierce в _bt_hit теперь настоящая пробойка: мимо щита, мимо плоской
--    брони, стойкости работают на треть. Урон таранов поднят (см. каталог).
-- 2) Ядерка и «Голиаф» бьют по дуге (LOS не проверяем), ядерка накрывает ДВА
--    кольца (1.0 / 0.75 / 0.45) и считается кинетикой: вспышку не перехватишь.
-- 3) 'hard' переименован в «Эгиду» и стал ПЕРЕНАПРАВЛЕНИЕМ: пока гвардеец жив
--    и его шина не заглушена, любой удар по союзнику в двух гексах прилетает
--    в него. Ровно то условие, которое просил дизайн: контрится подавителем.
--
-- ⚠ acts запекаются в battle_units при деплое — живые бои доигрывают на старых
--   числах, новые собираются уже по новому каталогу.
-- ЦЕПОЧКА: ПОСЛЕ _bt_modules2.sql и _club_gladiators3.sql.
--          Каталог: node tools/gen_unit_catalog.js → _unit_catalog.sql.
-- ════════════════════════════════════════════════════════════

-- ── 1) Флаг гвардейца ────────────────────────────────────────
alter table public.battle_units add column if not exists guard int not null default 0;
comment on column public.battle_units.guard is
  'радиус «Эгиды» в гексах (0 — не гвардеец): удары по союзникам в нём перенаправляются сюда';

-- ── 2) Кто прикрывает этот борт ──────────────────────────────
-- Возвращает id гвардейца ИЛИ null. Сам гвардеец себя не «прикрывает» (иначе
-- перенаправление зациклится), мёртвый и заглушённый подавителем — не считается.
-- Если гвардейцев несколько — прикрывает самый живучий: так строй не теряет
-- прикрытие из-за того, что первый удар пришёлся в добитого.
create or replace function public._bt_guard_for(p_target uuid) returns uuid
language sql stable security definer set search_path=public as $$
  select g.id
    from public.battle_units t
    join public.battle_units g
      on g.battle_id = t.battle_id and g.side = t.side and g.alive
     and g.id <> t.id and coalesce(g.guard, 0) > 0
     and public._bt_dist(g.x, g.y, t.x, t.y) <= g.guard
     and not public._bt_deb_has(g.deb, 'disrupt')
   where t.id = p_target and t.alive and coalesce(t.guard, 0) = 0
   order by g.hp desc
   limit 1;
$$;
revoke all on function public._bt_guard_for(uuid) from public;

-- ── 3) Имена активаций ───────────────────────────────────────
create or replace function public._bt_act_name(k text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'siege','осадная платформа','salvo','ракетный залп','broadside','бортовой залп',
    'blink','прыжок','cloak','маскировка','amp','усилитель контура','drones','ремонтные дроны',
    'torpedo','торпеда «Голиаф»','storm','ракеты «Шквал»','ram','плазменный таран',
    'rupture','разрывной таран','drain','торпеда-иссушитель','wbreak','ракета «Ломовик»',
    'disrupt','ракета-подавитель','wboost','ракета-усилитель','pboost','импульс «Хорал»',
    'hell','адские лазеры','blind','скремблер-импульс','pdup','противоракетные лазеры',
    'stasis','стазис-лучи','aboost','импульс брони','tractor','тяговый луч',
    'nuke','ядерная ракета','tartarus','ракета «Тартар»','sammo','стазис-боеприпас',
    'hard','протокол «Эгида»','reboot','перезапуск снаряжения','rapid','беглый огонь',
    'energy','энергогенератор')->>k), k);
$$;

-- ── 4) Пробойка: перенаправление + настоящий таран ───────────
create or replace function public._bt_hit(p_target uuid, p_dmg numeric, p_k text, p_terr jsonb,
                                          p_pierce boolean default false)
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
  return jsonb_build_object('hull', round(hull), 'shield_absorbed', round(absb),
                            'killed', killed, 'guard', redirected);
end$$;
revoke all on function public._bt_hit(uuid,numeric,text,jsonb,boolean) from public;

-- ── 5) Начало хода гасит и «Эгиду» ───────────────────────────
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         tp = greatest(1, tp_max - greatest(0, coalesce(drain, 0))),
         drain = 0,
         shield = 0,
         stance = case when stance = 'siege' then 'siege' else 'off' end,
         -- самобаффы живут ровно до своего следующего хода
         amp = 0, hard = 0, pdb = 0, guard = 0, rapid = false, sammo = false,
         stealth = stealth - cloak, cloak = 0,
         sensor  = sensor + blind,  blind = 0,
         mcd = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(mcd,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb),
         deb = coalesce((
           select jsonb_object_agg(k, v::int - 1)
             from jsonb_each_text(coalesce(deb,'{}'::jsonb)) as e(k, v)
            where v::int - 1 > 0
         ), '{}'::jsonb)
   where battle_id = p_battle and side = p_side;
end$$;

-- ── 6) Обычный залп тоже уходит в гвардейца ──────────────────
-- Правим ИСХОДНИК живой _bt_do_fire, а не переписываем её: там уже сидят
-- беглый огонь, «Ломовик», стазис-боеприпас и зонтик ПРО из пакета 2.
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = '_bt_do_fire'
   order by p.oid limit 1;
  if src is null then raise exception '_bt_do_fire не найдена'; end if;
  if position('_bt_guard_for' in src) > 0 then
    raise notice '«Эгида» уже вшита в залп — пропускаю';
    return;
  end if;
  if position('ally := (t.side = u.side);' in src) = 0 then
    raise exception 'якорь выбора цели в _bt_do_fire не найден';
  end if;
  -- перехват ДО расчёта дистанции и захвата: дальше вся функция работает с
  -- p_target/t, поэтому подмены одной пары переменных достаточно.
  src := replace(src,
    'ally := (t.side = u.side);',
    'if t.side <> u.side then
    declare g uuid; begin
      g := public._bt_guard_for(t.id);
      if g is not null then
        perform public._bt_log(p_battle, format(''«Эгида» перехватывает залп, назначенный %s'', t.unit_name));
        p_target := g;
        select * into t from public.battle_units where id = p_target and battle_id = p_battle for update;
      end if;
    end; end if;
  ally := (t.side = u.side);');
  execute src;
end$patch$;

-- ── 7) Активации: тараны, ядерка, «Эгида» ────────────────────
do $patch$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'battle_module'
   order by p.oid limit 1;
  if src is null then raise exception 'battle_module не найдена'; end if;

  -- 7a) таран не отменяется астероидом: он бьёт вплотную, линии огня нет вовсе.
  --     ядерка и «Голиаф» идут по баллистической дуге поверх препятствий.
  if position('линия огня перекрыта астероидами' in src) = 0 then
    raise exception 'якорь LOS в battle_module не найден';
  end if;
  src := replace(src,
    'if not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception ''линия огня перекрыта астероидами'';
    end if;',
    'if p_key not in (''ram'',''rupture'',''nuke'',''torpedo'')
       and not public._bt_los_clear(b.terrain, u.x, u.y, t.x, t.y) then
      raise exception ''линия огня перекрыта астероидами'';
    end if;');

  -- 7b) ядерка накрывает ДВА кольца и считается кинетикой (вспышку не перехватить)
  if position('and public._bt_dist(x, y, tx, ty) <= 1' in src) = 0 then
    raise exception 'якорь радиуса накрытия не найден';
  end if;
  src := replace(src,
    'and public._bt_dist(x, y, tx, ty) <= 1',
    'and public._bt_dist(x, y, tx, ty) <= (case when p_key = ''nuke'' then 2 else 1 end)');
  src := replace(src,
    'case when t.x = tx and t.y = ty then dmg
                    when p_key = ''nuke'' then dmg * 0.6 else dmg * 0.5 end',
    'case when t.x = tx and t.y = ty then dmg
                    when p_key <> ''nuke'' then dmg * 0.65
                    when public._bt_dist(t.x, t.y, tx, ty) = 1 then dmg * 0.75
                    else dmg * 0.45 end');
  src := replace(src,
    'case when p_key = ''broadside'' then ''energy'' else ''missile'' end',
    'case when p_key = ''broadside'' then ''energy''
                    when p_key = ''nuke'' then ''kinetic''    -- подрыв уже не сбить ПРО
                    else ''missile'' end');

  -- 7c) «Эгида» поднимает не только броню, но и флаг гвардейца
  if position('update public.battle_units set hard = greatest(hard, val) where id = p_unit;' in src) = 0 then
    raise exception 'якорь «броневого замка» не найден';
  end if;
  src := replace(src,
    'update public.battle_units set hard = greatest(hard, val) where id = p_unit;',
    'update public.battle_units
       set hard = greatest(hard, val), guard = greatest(guard, greatest(1, rng))
     where id = p_unit;');
  -- текст лога: без подстановки радиуса — лишний аргумент в format() потребовал бы
  -- править и список аргументов, а радиус игрок и так видит в карточке модуля
  src := replace(src,
    '%s встаёт в броневой замок: −%s%% входящего урона',
    '%s поднимает «Эгиду»: удары по соседним своим идут в него, входящий −%s%%');

  execute src;
end$patch$;

-- ── 8) Ценник арены под новые числа ──────────────────────────
-- Кнопки подорожали ровно там, где выросла их отдача, иначе драфт клуба снова
-- скатится к «дешёвый корпус + самая злая кнопка» (см. _club_gladiators3.sql).
create or replace function public._fc_act_price(k text) returns numeric
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'nuke',   260000,   -- 24000 по двум кольцам через полдоски, мимо ПРО
    'torpedo',130000,   -- 13000 по площади, поверх астероидов
    'tartarus',60000,
    'hard',    75000,   -- гвардеец строя: перехватывает всё, что летит в соседей
    'ram',     70000,   -- 18000 мимо щита и брони
    'rupture', 60000,
    'pboost',  40000,
    'siege',   40000,
    'hell',    35000,
    'broadside',35000,
    'aboost',  35000,
    'storm',   30000,
    'stasis',  30000,
    'sammo',   30000,
    'rapid',   30000,
    'salvo',   28000,
    'cloak',   28000,
    'disrupt', 28000,
    'amp',     25000,
    'blind',   25000,
    'tractor', 25000,
    'wboost',  25000,
    'wbreak',  25000,
    'pdup',    25000,
    'reboot',  25000,
    'blink',   22000,
    'drones',  22000,
    'drain',   22000,
    'energy',  18000)->>k)::numeric, 25000);
$$;
grant execute on function public._fc_act_price(text) to anon, authenticated, service_role;

-- Переоценка ростера от ЗАПОМНЕННОЙ базы (идемпотентно, как в срезе 3)
do $$
declare r record; base numeric; add numeric;
begin
  for r in select id, summary from public.faction_units where faction_id = 'club' loop
    base := coalesce((r.summary->>'cost0')::numeric, (r.summary->>'cost')::numeric, 0);
    select coalesce(sum(public._fc_act_price(a->>'k')), 0) into add
      from jsonb_array_elements(public._bt_acts_of(r.id)) a;
    update public.faction_units
       set summary = summary || jsonb_build_object('cost0', base, 'cost', round(base + add))
     where id = r.id;
  end loop;
end $$;

-- Карточка «Мурмиллона» описывала старый замок
update public.faction_units
   set card_text = replace(card_text,
        '«броневой замок» вдвое режет входящий урон на чужой ход',
        'протокол «Эгида» стягивает на него все удары по соседям и вдвое режет входящий урон')
 where faction_id = 'club' and card_text like '%броневой замок%';
