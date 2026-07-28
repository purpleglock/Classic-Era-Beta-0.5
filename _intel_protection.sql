-- ============================================================
-- 🛡 ЗАЩИЩЁННОСТЬ СИСТЕМ — реворк контрразведки и сложности операций
-- ============================================================
-- ТЗ юзера (28.07.2026):
--   1. Убрать микроменеджмент «агент на каждую колонию». Агенты назначаются
--      НА СИСТЕМУ; сколько их влезет — зависит от числа Постов разведки
--      (colony_buildings.btype='intel') в этой системе: 1 пост = 3 агента.
--   2. «Защищённость» — единый показатель, который ЗАМЕНЯЕТ сложность
--      операции. К нему сверху добавляются дебафы расы оперативников и их
--      личные изъяны. Больше нет отдельного числа diff у операции — есть вес
--      операции (насколько она чувствительна к защите).
--   3. Артефакты — предметы с картинками, заливаемыми через админку; падают,
--      когда на державу «ПОСМОТРЕЛИ В ОТВЕТ» в Разломе (джекпот nova).
--      Есть одноразовые (гарантия успеха) и ПРОКЛЯТЫЕ (снять нельзя до смерти).
--
-- Применять ПОСЛЕ: _spy_agents8.sql, _spy_fleet_ops.sql, _spy_race_infiltration.sql,
-- _stargaze.sql. Идемпотентно. Зеркала: economy.js (ecProt*/ecSpyCalc/ecArt*),
-- admin.js (adArtKinds*), render.js (Разлом).
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 0. ИЗЪЯНЫ ОПЕРАТИВНИКОВ — личные особенности, утяжеляющие дело
-- ════════════════════════════════════════════════════════════
alter table public.spy_agents   add column if not exists flaw text;
alter table public.spy_recruits add column if not exists flaw text;

-- Каталог изъянов. diff — прибавка к сложности (для профильных операций —
-- через ops), det — прибавка к шансу раскрытия. 'clean' = без изъяна.
create or replace function public._spy_flaw_meta(p_flaw text)
returns jsonb language sql immutable as $$
  select case coalesce(p_flaw,'clean')
    when 'bottle'  then '{"icon":"🥃","label":"Не просыхает","diff":6,"det":4,"desc":"Пьёт перед выходом. Любое дело идёт тяжелее."}'::jsonb
    when 'famous'  then '{"icon":"🎤","label":"Слишком известен","diff":2,"det":12,"desc":"Лицо примелькалось: раскрывают почти сразу."}'::jsonb
    when 'soft'    then '{"icon":"❤","label":"Мягкое сердце","diff":10,"det":0,"ops":["kill_agent","sabotage","mass_demolish"],"desc":"Не поднимается рука. Мешает только грязной работе."}'::jsonb
    when 'greed'   then '{"icon":"🪙","label":"Жадность","diff":8,"det":2,"ops":["steal_gc","steal_res","steal_tech"],"desc":"Тянет взять больше, чем нужно, — и попасться на этом."}'::jsonb
    when 'loud'    then '{"icon":"📢","label":"Тяжёлая поступь","diff":0,"det":14,"desc":"Шумит. Успеху не мешает, но следы остаются везде."}'::jsonb
    when 'glitch'  then '{"icon":"🔩","label":"Сбоящий имплант","diff":5,"det":6,"desc":"Железо в голове барахлит в самый неподходящий момент."}'::jsonb
    when 'codex'   then '{"icon":"📜","label":"Кодекс","diff":9,"det":0,"ops":["destabilize","faith_impose"],"desc":"Отказывается лгать народу. Подрывная работа даётся плохо."}'::jsonb
    when 'ghosted' then '{"icon":"🕯","label":"Старая школа","diff":4,"det":4,"desc":"Учился на прошлой войне. Методы устарели."}'::jsonb
    else '{"icon":"✦","label":"Без изъянов","diff":0,"det":0,"desc":"Редкий случай: за оперативником ничего не числится."}'::jsonb
  end
$$;

-- Прибавка к сложности от изъяна с учётом профиля операции.
create or replace function public._spy_flaw_diff(p_flaw text, p_op text)
returns numeric language sql immutable as $$
  select case
    when not (public._spy_flaw_meta(p_flaw) ? 'ops') then (public._spy_flaw_meta(p_flaw)->>'diff')::numeric
    when (public._spy_flaw_meta(p_flaw)->'ops') ? p_op then (public._spy_flaw_meta(p_flaw)->>'diff')::numeric
    else 0 end
$$;
create or replace function public._spy_flaw_det(p_flaw text)
returns numeric language sql immutable as $$ select (public._spy_flaw_meta(p_flaw)->>'det')::numeric $$;

-- Случайный изъян (1 из 10 оперативников — чистый).
create or replace function public._spy_roll_flaw()
returns text language sql volatile as $$
  select (array['bottle','famous','soft','greed','loud','glitch','codex','ghosted','clean','clean'])
         [1 + floor(random()*10)::int]
$$;

-- Бэкфилл: у всех, кто уже нанят/в рекрутах, изъян ещё не проставлен.
update public.spy_agents   set flaw = public._spy_roll_flaw() where flaw is null;
update public.spy_recruits set flaw = public._spy_roll_flaw() where flaw is null;

-- ════════════════════════════════════════════════════════════
-- 1. ЗАЩИЩЁННОСТЬ СИСТЕМЫ
-- ════════════════════════════════════════════════════════════
-- Агент стоит в ОДНОЙ системе (или нигде). Микроменеджмент по колониям
-- и роли state/forces упразднены.
create table if not exists public.faction_intel_guard (
  faction_id text not null,
  agent_id   uuid not null references public.spy_agents(id) on delete cascade,
  system_id  text not null,
  set_at     timestamptz not null default now(),
  primary key (faction_id, agent_id)
);
create index if not exists fig_fac_idx on public.faction_intel_guard(faction_id);
create index if not exists fig_sys_idx on public.faction_intel_guard(faction_id, system_id);
alter table public.faction_intel_guard enable row level security;
drop policy if exists "fig_sel" on public.faction_intel_guard;
create policy "fig_sel" on public.faction_intel_guard for select to public using (true);

-- Постов разведки в системе (btype='intel' по всем моим колониям системы).
create or replace function public._intel_posts(p_fid text, p_sys text)
returns int language sql stable security definer set search_path=public as $$
  select coalesce(count(*)::int, 0)
  from public.colony_buildings cb
  join public.colonies c on c.id = cb.colony_id
  where cb.faction_id = p_fid and cb.btype = 'intel' and c.system_id = p_sys
$$;

-- Мест под оперативников в системе: 1 пост = 3 агента.
create or replace function public._intel_slots(p_fid text, p_sys text)
returns int language sql stable security definer set search_path=public as $$
  select public._intel_posts(p_fid, p_sys) * 3
$$;

-- Столичная система державы (к ней же привязаны «государственные» операции:
-- казна, технологии, дестабилизация — всё это сидит в столице).
create or replace function public._intel_capital_sys(p_fid text)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select c.system_id from public.colonies c
       where c.faction_id = p_fid and coalesce(c.is_capital,false) order by c.created_at limit 1),
    (select c.system_id from public.colonies c
       where c.faction_id = p_fid and c.system_id is not null order by c.created_at limit 1))
$$;

-- ЗАЩИЩЁННОСТЬ СИСТЕМЫ (0..95) — единая шкала, она же сложность операций.
--   • 12 — базовая бдительность державы (даже без построек не пусто);
--   • +8 за каждый Пост разведки в системе;
--   • +4 за каждого оперативника в охране, +3 за каждый его уровень сверх первого;
--   • +2 за каждого Куратора (перк handler) в державе, но не больше +10 — они
--     работают на всю страну, и без потолка большой ростер сам по себе закрывал
--     все системы разом (у иных держав по 20+ Кураторов);
--   • +10 столичной системе;
--   • + сила спецслужб от доктрины.
create or replace function public.system_protection(p_fid text, p_sys text)
returns int language sql stable security definer set search_path=public as $$
  select least(95, greatest(0, round(
      12
    + public._intel_posts(p_fid, p_sys) * 8
    + coalesce((select sum(4 + 3 * (greatest(coalesce(a.level,1),1) - 1))
                from public.faction_intel_guard g
                join public.spy_agents a on a.id = g.agent_id and coalesce(a.captive,false) = false
                where g.faction_id = p_fid and g.system_id = p_sys), 0)
    + least(10, coalesce((select count(*) * 2 from public.spy_agents
                where faction_id = p_fid and perk = 'handler'
                  and coalesce(captive,false) = false and ready_at <= now()), 0))
    + case when p_sys is not distinct from public._intel_capital_sys(p_fid) then 10 else 0 end
    + public._spy_power(p_fid)
  )))::int
$$;

-- Система, отвечающая за операцию: колониальные операции — система колонии,
-- всё остальное — столичная система цели.
create or replace function public._intel_op_sys(p_fid text, p_colony uuid)
returns text language sql stable security definer set search_path=public as $$
  select coalesce(
    (select c.system_id from public.colonies c where c.id = p_colony and c.faction_id = p_fid),
    public._intel_capital_sys(p_fid))
$$;

-- ЛЕГАСИ-МОСТ: старые вызовы _spy_ci_power(fid, scope) остаются рабочими —
-- отдают ту же защищённость, сведённую к прежней шкале «человек в защите»
-- (в старых формулах она умножалась на 9). scope: 'hq' | <colony_id>.
create or replace function public._spy_ci_power(p_fid text, p_scope text)
returns int language sql stable security definer set search_path=public as $$
  select greatest(0, round(public.system_protection(p_fid,
    case when p_scope in ('hq','state','forces') or p_scope !~ '^[0-9a-f-]{36}$'
         then public._intel_capital_sys(p_fid)
         else public._intel_op_sys(p_fid, p_scope::uuid) end) / 9.0))::int
$$;
revoke all on function public._spy_ci_power(text,text) from public;
grant execute on function public._spy_ci_power(text,text) to authenticated;

-- Сводка counter_agents = сколько РАЗНЫХ агентов стоит в охране (для старых гейтов).
create or replace function public._fci_sync(p_fid text)
returns void language sql security definer set search_path=public as $$
  update public.faction_economy
    set counter_agents = (select count(*) from public.faction_intel_guard where faction_id=p_fid)
    where faction_id=p_fid;
$$;

-- ── Поставить/снять оперативника в охрану системы ──
create or replace function public.intel_guard_set(p_agent_id uuid, p_system_id text, p_on boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_slots int; v_used int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;

  if p_on then
    -- система должна быть моей: есть хотя бы одна моя колония в ней
    if not exists(select 1 from public.colonies where faction_id=fid and system_id=p_system_id) then
      raise exception 'not your system: в этой системе нет ваших колоний';
    end if;
    v_slots := public._intel_slots(fid, p_system_id);
    if v_slots < 1 then
      raise exception 'no intel post: в системе нет Поста разведки — некуда селить оперативника';
    end if;
    select count(*) into v_used from public.faction_intel_guard
      where faction_id=fid and system_id=p_system_id and agent_id <> p_agent_id;
    if v_used >= v_slots then
      raise exception 'no room: мест в системе % из %, постройте ещё Пост разведки', v_used, v_slots;
    end if;
    -- агент мой, готов, не пленник, не на задании
    if not exists(select 1 from public.spy_agents a where a.id=p_agent_id and a.faction_id=fid
                  and coalesce(a.captive,false)=false and a.ready_at<=now()) then
      raise exception 'agent unavailable: оперативник занят или недоступен';
    end if;
    if exists(select 1 from public.spy_missions sm where sm.actor_fid=fid and sm.status='active'
              and sm.agent_ids ? p_agent_id::text) then
      raise exception 'agent is on a mission: сперва дождитесь конца операции';
    end if;
    insert into public.faction_intel_guard(faction_id, agent_id, system_id)
      values(fid, p_agent_id, p_system_id)
      on conflict (faction_id, agent_id) do update set system_id=excluded.system_id, set_at=now();
  else
    delete from public.faction_intel_guard where faction_id=fid and agent_id=p_agent_id;
  end if;

  perform public._fci_sync(fid);
  return public.intel_guard_list();
end$$;
revoke all on function public.intel_guard_set(uuid,text,boolean) from public;
grant execute on function public.intel_guard_set(uuid,text,boolean) to authenticated;

-- ── Полная картина обороны: по каждой моей системе посты/места/защищённость/люди ──
create or replace function public.intel_guard_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_cap text;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('systems','[]'::jsonb,'assignments','[]'::jsonb); end if;
  v_cap := public._intel_capital_sys(fid);
  return jsonb_build_object(
    'capital_sys', v_cap,
    'systems', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'system_id', s.sys,
          'name', coalesce(ms.name, s.sys),
          'is_capital', s.sys is not distinct from v_cap,
          'colonies', s.cols,
          'posts',  public._intel_posts(fid, s.sys),
          'slots',  public._intel_slots(fid, s.sys),
          'used',   (select count(*) from public.faction_intel_guard g where g.faction_id=fid and g.system_id=s.sys),
          'protection', public.system_protection(fid, s.sys)
        ) order by (s.sys is not distinct from v_cap) desc, coalesce(ms.name, s.sys)), '[]'::jsonb)
      from (select c.system_id as sys, count(*)::int as cols
              from public.colonies c where c.faction_id=fid and c.system_id is not null
             group by c.system_id) s
      left join public.map_systems ms on ms.id = s.sys),
    'assignments', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'agent_id', g.agent_id, 'system_id', g.system_id,
          'first_name', a.first_name, 'last_name', a.last_name,
          'level', coalesce(a.level,1), 'perk', a.perk, 'flaw', a.flaw) order by a.last_name), '[]'::jsonb)
      from public.faction_intel_guard g
      join public.spy_agents a on a.id=g.agent_id
      where g.faction_id=fid));
end$$;
revoke all on function public.intel_guard_list() from public;
grant execute on function public.intel_guard_list() to authenticated;

-- ── МИГРАЦИЯ со старой контрразведки: каждый назначенный агент переезжает ──
-- Роль 'state'/'forces' → столичная система, роль-колония → её система.
-- Переезжают только те, кому есть куда (в системе стоит Пост разведки); лишние
-- просто освобождаются — игрок расставит заново.
do $mig$
declare f record; ci record; v_cap text; v_sys text; v_used int;
begin
  if to_regclass('public.faction_counterintel') is null then return; end if;
  for f in select distinct faction_id from public.faction_counterintel loop
    v_cap := public._intel_capital_sys(f.faction_id);
    for ci in select x.* from public.faction_counterintel x
              where x.faction_id = f.faction_id order by x.set_at loop
      v_sys := case when ci.role in ('state','forces') then v_cap
                    else (select c.system_id from public.colonies c where c.id::text = ci.role) end;
      if v_sys is null then v_sys := v_cap; end if;
      if v_sys is null then continue; end if;
      select count(*) into v_used from public.faction_intel_guard
        where faction_id=f.faction_id and system_id=v_sys;
      if v_used < public._intel_slots(f.faction_id, v_sys) then
        insert into public.faction_intel_guard(faction_id, agent_id, system_id)
          values(f.faction_id, ci.agent_id, v_sys)
          on conflict (faction_id, agent_id) do nothing;
      end if;
    end loop;
  end loop;
  delete from public.faction_counterintel;
  update public.faction_economy fe
     set counter_agents = (select count(*) from public.faction_intel_guard g where g.faction_id=fe.faction_id);
end$mig$;

-- Старые RPC контрразведки больше не нужны — снимаем права, чтобы клиент
-- не мог случайно вернуть микроменеджмент.
do $$ begin
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='spy_counter_set') then
    execute 'revoke all on function public.spy_counter_set(uuid,text,boolean) from public, authenticated';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='counterintel_set' and p.pronargs=2) then
    execute 'revoke all on function public.counterintel_set(text,int) from public, authenticated';
  end if;
end $$;

-- spy_counter_list оставляем как ТОНКУЮ ОБЁРТКУ над новой охраной: старый
-- клиент (и «Тревоги») читает assignments и не падает.
create or replace function public.spy_counter_list()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; g jsonb;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('assignments','[]'::jsonb); end if;
  g := public.intel_guard_list();
  return jsonb_build_object(
    'state_power',  public.system_protection(fid, public._intel_capital_sys(fid)),
    'forces_power', public.system_protection(fid, public._intel_capital_sys(fid)),
    'assignments', (select coalesce(jsonb_agg(jsonb_build_object(
        'agent_id', e->>'agent_id', 'role', e->>'system_id',
        'first_name', e->>'first_name', 'last_name', e->>'last_name',
        'level', (e->>'level')::int, 'perk', e->>'perk')), '[]'::jsonb)
      from jsonb_array_elements(g->'assignments') e),
    'guard', g);
end$$;
revoke all on function public.spy_counter_list() from public;
grant execute on function public.spy_counter_list() to authenticated;

-- ════════════════════════════════════════════════════════════
-- 2. АРТЕФАКТЫ 2.0 — каталог с картинками, редактируемый из админки
-- ════════════════════════════════════════════════════════════
create table if not exists public.spy_artifact_kinds (
  key         text primary key,
  label       text not null,
  icon        text default '🎁',
  img_url     text,                       -- арт из assets/artifacts (грузится админкой)
  descr       text default '',
  lore        text default '',
  rarity      text default 'common',      -- common|rare|legendary (влияет на вес дропа и рамку)
  succ_any    numeric default 0,          -- + к успеху любой операции
  succ_ops    text[] default '{}',        -- ... или только этих операций
  succ_op_val numeric default 0,          -- прибавка для профильных операций
  det         numeric default 0,          -- − к раскрытию (положительное = лучше прячет)
  xp_mult     numeric default 0,          -- + к множителю получаемого опыта
  pierce      numeric default 0,          -- − к защищённости цели
  turn_cut    boolean default false,      -- операция на один ход короче
  guaranteed  boolean default false,      -- гарантированный успех операции
  one_shot    boolean default false,      -- рассыпается после применения
  cursed      boolean default false,      -- снять с оперативника нельзя до его смерти
  drop_weight int default 10,             -- вес в лотерее Разлома (0 = не падает)
  enabled     boolean default true,
  sort        int default 100
);
alter table public.spy_artifact_kinds enable row level security;
drop policy if exists "sak_sel" on public.spy_artifact_kinds;
create policy "sak_sel" on public.spy_artifact_kinds for select to public using (true);
drop policy if exists "sak_all" on public.spy_artifact_kinds;
create policy "sak_all" on public.spy_artifact_kinds for all to authenticated
  using (public.current_user_role() in ('superadmin','editor'))
  with check (public.current_user_role() in ('superadmin','editor'));

alter table public.spy_artifacts add column if not exists source text default 'op';
alter table public.spy_artifacts add column if not exists spent  boolean default false;

-- ── Каталог: 8 легаси-предметов (падают с операций) + 8 из Разлома ──
insert into public.spy_artifact_kinds
  (key, label, icon, descr, rarity, succ_any, succ_ops, succ_op_val, det, xp_mult, pierce, turn_cut, guaranteed, one_shot, cursed, drop_weight, sort)
values
  ('masterkey','Мастер-ключ','🗝','Открывает то, что заперто. +8% к успеху краж.','common',
    0,'{steal_gc,steal_tech,steal_res}',8, 0,0,0,false,false,false,false, 14, 10),
  ('charge','Заряд-фантом','🧨','Взрыв, которого не было. +8% к успеху саботажа и сноса.','common',
    0,'{sabotage,destabilize,mass_demolish}',8, 0,0,0,false,false,false,false, 14, 20),
  ('scanner','Сканер-имплант','📡','Видит сквозь стены отчётности. +10% к успеху разведки.','common',
    0,'{recon_basic,recon_deep}',10, 0,0,0,false,false,false,false, 14, 30),
  ('blade','Моно-клинок','🔪','Один взмах — одна строчка в некрологе. +12% к ликвидации.','common',
    0,'{kill_agent}',12, 0,0,0,false,false,false,false, 12, 40),
  ('neurochip','Нейро-чип','🧬','Холодная голова в любом деле. +5% к успеху любой операции.','common',
    5,'{}',0, 0,0,0,false,false,false,false, 14, 50),
  ('jammer','Глушилка','🛰','Тишина в эфире. +4% к успеху и −6% к раскрытию.','common',
    4,'{}',0, 6,0,0,false,false,false,false, 12, 60),
  ('mask','Маска-морф','🎭','Чужое лицо на один вечер. −10% к раскрытию.','common',
    0,'{}',0, 10,0,0,false,false,false,false, 12, 70),
  ('sim','Симулятор','📚','Прогоняет операцию сто раз до неё самой. +50% опыта.','common',
    0,'{}',0, 0,0.5,0,false,false,false,false, 12, 80),

  -- ── Из Разлома: «на тебя посмотрели в ответ» ──
  ('seal','Печать Взгляда','👁','ОДНОРАЗОВЫЙ. Следующая операция этого оперативника удаётся ГАРАНТИРОВАННО — что бы ни стояло на пути. После чего печать рассыпается в пыль.','legendary',
    0,'{}',0, 0,0,0,false,true,true,false, 4, 100),
  ('yoke','Ярмо Разлома','⛓','ПРОКЛЯТ. Опыт приходит втрое быстрее — оперативник учится у чего-то, что смотрит на него из шва мироздания. Снять нельзя: ярмо отпустит только мёртвого. И да, оно светится в темноте (+10% к раскрытию).','legendary',
    0,'{}',0, -10,2.0,0,false,false,false,true, 5, 110),
  ('mute','Сердце Немого','🫥','Оперативника перестают замечать: взгляд соскальзывает, камеры пишут пустой коридор. −18% к раскрытию.','rare',
    0,'{}',0, 18,0,0,false,false,false,false, 8, 120),
  ('mirror','Зеркальная маска','🪞','Свидетели клянутся, что видели кого-то другого. +4% к успеху, −10% к раскрытию.','rare',
    4,'{}',0, 10,0,0,false,false,false,false, 8, 130),
  ('chrono','Хронокапля','⏳','Операция занимает на один ход меньше: дело сделано раньше, чем начато.','rare',
    0,'{}',0, 0,0,0,true,false,false,false, 7, 140),
  ('swarm','Шёпот роя','🐝','ПРОКЛЯТ. Подсказывает верный ход (+12% к успеху) и не затыкается никогда — оперативник говорит вслух в самых неподходящих местах (+14% к раскрытию). Снять нельзя.','legendary',
    12,'{}',0, -14,0,0,false,false,false,true, 5, 150),
  ('glasseye','Стеклянный глаз','🔍','Смотрит на чужую оборону и видит в ней дыру. −12 к защищённости цели.','rare',
    0,'{}',0, 0,0,12,false,false,false,false, 7, 160),
  ('ash','Пепел Тетославии','🜃','Горсть праха державы, которой больше нет. Помнит, как её взяли: +6% к успеху и +25% опыта.','rare',
    6,'{}',0, 0,0.25,0,false,false,false,false, 8, 170)
on conflict (key) do update set
  label=excluded.label, icon=excluded.icon, descr=excluded.descr, rarity=excluded.rarity,
  succ_any=excluded.succ_any, succ_ops=excluded.succ_ops, succ_op_val=excluded.succ_op_val,
  det=excluded.det, xp_mult=excluded.xp_mult, pierce=excluded.pierce, turn_cut=excluded.turn_cut,
  guaranteed=excluded.guaranteed, one_shot=excluded.one_shot, cursed=excluded.cursed,
  sort=excluded.sort
where public.spy_artifact_kinds.img_url is null;   -- НЕ затираем арты, залитые админом

-- Легаси-восьмёрка падает ещё и с успешных операций (_spy_resolve), поэтому в
-- лотерее Разлома её вес занижен: «взгляд в ответ» должен отдавать в первую
-- очередь то, что больше нигде не достать.
update public.spy_artifact_kinds set drop_weight = 5
  where key in ('masterkey','charge','scanner','blade','neurochip','jammer','mask','sim');

-- ── Каталог-функции: теперь читают таблицу (легаси-имена сохранены) ──
create or replace function public._spy_artifact_succ(p_kind text, p_op text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select k.succ_any + case when p_op = any(k.succ_ops) then k.succ_op_val else 0 end
                   from public.spy_artifact_kinds k where k.key=p_kind), 0)
$$;
create or replace function public._spy_artifact_det(p_kind text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select det from public.spy_artifact_kinds where key=p_kind), 0)
$$;
create or replace function public._spy_artifact_xpmult(p_kind text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce((select xp_mult from public.spy_artifact_kinds where key=p_kind), 0)
$$;
create or replace function public._spy_agent_xp_mult(p_agent uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select 1 + coalesce((select sum(public._spy_artifact_xpmult(kind))
                       from public.spy_artifacts
                       where equipped_agent=p_agent and coalesce(spent,false)=false), 0)
$$;
revoke all on function public._spy_agent_xp_mult(uuid) from public;

-- ── Проклятый предмет уходит вместе с оперативником ──
create or replace function public._spy_artifact_on_agent_gone()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.spy_artifacts a
    using public.spy_artifact_kinds k
   where a.equipped_agent = old.id and k.key = a.kind and k.cursed;
  return old;
end$$;
drop trigger if exists spy_artifacts_agent_gone on public.spy_agents;
create trigger spy_artifacts_agent_gone before delete on public.spy_agents
  for each row execute function public._spy_artifact_on_agent_gone();

-- ── Выдать случайный артефакт (лотерея по весам) ──
create or replace function public._spy_artifact_grant(p_fid text, p_source text default 'rift')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_key text; k public.spy_artifact_kinds; v_id uuid; v_tot int;
begin
  select coalesce(sum(drop_weight),0) into v_tot from public.spy_artifact_kinds
    where enabled and drop_weight > 0;
  if v_tot < 1 then return null; end if;
  select key into v_key from (
    select key, sum(drop_weight) over (order by sort, key) as acc
      from public.spy_artifact_kinds where enabled and drop_weight > 0) x
    where x.acc >= 1 + floor(random()*v_tot)::int order by x.acc limit 1;
  if v_key is null then return null; end if;
  insert into public.spy_artifacts(faction_id, kind, source)
    values(p_fid, v_key, p_source) returning id into v_id;
  select * into k from public.spy_artifact_kinds where key=v_key;
  return jsonb_build_object('id', v_id, 'kind', v_key, 'label', k.label, 'icon', k.icon,
    'img_url', k.img_url, 'descr', k.descr, 'rarity', k.rarity,
    'cursed', k.cursed, 'one_shot', k.one_shot);
end$$;
revoke all on function public._spy_artifact_grant(text,text) from public;

-- ── Экипировка: 2 слота, проклятое не снимается ──
create or replace function public.spy_artifact_equip(p_artifact_id uuid, p_agent_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_n int;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if not exists(select 1 from public.spy_artifacts where id=p_artifact_id and faction_id=fid
                and coalesce(spent,false)=false) then
    raise exception 'no artifact'; end if;
  if not exists(select 1 from public.spy_agents where id=p_agent_id and faction_id=fid
                and coalesce(captive,false)=false) then
    raise exception 'no agent'; end if;
  select count(*) into v_n from public.spy_artifacts
    where equipped_agent=p_agent_id and coalesce(spent,false)=false;
  if v_n >= 2 then raise exception 'slots full: у оперативника уже два предмета'; end if;
  update public.spy_artifacts set equipped_agent=p_agent_id where id=p_artifact_id;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_artifact_equip(uuid,uuid) from public;
grant execute on function public.spy_artifact_equip(uuid,uuid) to authenticated;

create or replace function public.spy_artifact_unequip(p_artifact_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_cursed boolean;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select k.cursed into v_cursed from public.spy_artifacts a
    join public.spy_artifact_kinds k on k.key=a.kind
    where a.id=p_artifact_id and a.faction_id=fid;
  if not found then raise exception 'no artifact'; end if;
  if v_cursed then
    raise exception 'cursed: этот предмет не снимается — он отпустит оперативника только мёртвым';
  end if;
  update public.spy_artifacts set equipped_agent=null where id=p_artifact_id and faction_id=fid;
  return jsonb_build_object('ok',true);
end$$;
revoke all on function public.spy_artifact_unequip(uuid) from public;
grant execute on function public.spy_artifact_unequip(uuid) to authenticated;

-- ── Состояние разведуправления для клиента: каталог + охрана + изъяны ──
-- Отдельная RPC, чтобы не переписывать огромный spy_recruits_list: клиент
-- домешивает эти поля к ростеру по agent_id.
create or replace function public.intel_state()
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text;
begin
  fid := public._ec_my_fid();
  return jsonb_build_object(
    'kinds', (select coalesce(jsonb_agg(to_jsonb(k) order by k.sort, k.key), '[]'::jsonb)
              from public.spy_artifact_kinds k where k.enabled),
    'flaws', case when fid is null then '{}'::jsonb else
      (select coalesce(jsonb_object_agg(a.id::text, coalesce(a.flaw,'clean')), '{}'::jsonb)
       from public.spy_agents a where a.faction_id=fid) end,
    'inventory', case when fid is null then '[]'::jsonb else
      (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,
          'equipped_agent',a.equipped_agent,'source',a.source) order by a.acquired_at desc), '[]'::jsonb)
       from public.spy_artifacts a where a.faction_id=fid and coalesce(a.spent,false)=false) end,
    'guard', public.intel_guard_list());
end$$;
revoke all on function public.intel_state() from public;
grant execute on function public.intel_state() to authenticated;

-- ════════════════════════════════════════════════════════════
-- 3. ВЕС ОПЕРАЦИИ и НОВЫЙ spy_launch
-- ════════════════════════════════════════════════════════════
-- Своего числа сложности у операции больше нет. Есть ВЕС: насколько операция
-- чувствительна к защищённости цели. Разведка со стороны — вполовину, кража
-- технологий из-под носа — в полтора раза.
create or replace function public._spy_op_weight(p_op text)
returns numeric language sql immutable as $$
  select case p_op
    when 'recon_basic'    then 0.5
    when 'recon_deep'     then 0.7
    when 'steal_gc'       then 1.0
    when 'steal_res'      then 1.0
    when 'faith_impose'   then 1.0
    when 'sabotage'       then 1.1
    when 'fleet_sabotage' then 1.1
    when 'outpost_strike' then 1.1
    when 'destabilize'    then 1.2
    when 'subspace_hunt'  then 1.2
    when 'kill_agent'     then 1.3
    when 'steal_tech'     then 1.5
    when 'mass_demolish'  then 1.5
    else 1.0 end::numeric
$$;

create or replace function public.spy_launch(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare app public.faction_applications; me public.faction_economy; tgt public.faction_economy;
  meta jsonb; intel jsonb; need text; rec text;
  a int; ibonus numeric; spow numeric; succ int; det int; turns int;
  tgt_owner uuid; v_ids uuid[]; v_avail int; succ_b numeric; det_b numeric; v_colony uuid;
  trace text; race_mod numeric; flaw_diff numeric; flaw_det numeric;
  art_succ numeric; art_det numeric; art_pierce numeric;
  v_sys text; prot int; wt numeric; hard numeric;
  v_guar uuid; v_cut boolean; v_used jsonb := '[]'::jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  meta := public._spy_op_meta(p_op);
  if meta is null then raise exception 'bad op'; end if;
  select * into app from public.faction_applications where owner_id=auth.uid() and status='approved' order by updated_at desc limit 1;
  if not found then raise exception 'no approved faction'; end if;
  if p_target_fid = app.faction_id then raise exception 'self'; end if;

  if p_op = 'faith_impose' then
    if not exists(select 1 from public.faith_membership where faction_id=app.faction_id) then
      raise exception 'you follow no faith to spread'; end if;
    if exists(select 1 from public.faith_sects where owner_fid=app.faction_id and host_fid=p_target_fid and status='active') then
      raise exception 'you already run a sect in that nation'; end if;
  end if;

  select * into me from public.faction_economy where faction_id=app.faction_id for update;
  select * into tgt from public.faction_economy where faction_id=p_target_fid;
  if not found then raise exception 'target has no economy'; end if;
  select owner_id into tgt_owner from public.faction_economy where faction_id=p_target_fid;

  -- доступные агенты: готовы, не пленники, не на задании, НЕ в охране систем
  select array_agg(ag.id) into v_ids
  from public.spy_agents ag
  where ag.faction_id=app.faction_id and coalesce(ag.captive,false)=false
    and ag.id in (select (jsonb_array_elements_text(coalesce(p_agent_ids,'[]'::jsonb)))::uuid)
    and ag.ready_at <= now()
    and not exists(select 1 from public.spy_missions sm
                   where sm.actor_fid=app.faction_id and sm.status='active' and sm.agent_ids ? ag.id::text)
    and not exists(select 1 from public.faction_intel_guard g
                   where g.faction_id=app.faction_id and g.agent_id=ag.id);
  a := coalesce(array_length(v_ids,1),0);
  if a < 1 then raise exception 'select at least one available agent: свободных оперативников нет (проверьте охрану систем)'; end if;
  if p_op in ('steal_tech','mass_demolish') and a < 2 then
    raise exception 'this op needs a network: at least 2 agents'; end if;

  intel := public._spy_intel(app.faction_id, p_target_fid);
  need := meta->>'need'; rec := intel->>'level';
  if need = 'basic' and rec is null then raise exception 'intel required: basic recon'; end if;
  if need = 'deep'  and rec is distinct from 'deep' then raise exception 'intel required: deep recon'; end if;

  if p_op in ('sabotage','mass_demolish') and p_colony_id is not null
     and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid) then
    v_colony := p_colony_id;
  end if;

  -- перки + уровни выбранных
  select coalesce(sum(
           public._spy_perk_succ(ag.perk,  p_op, ag.level)
         + public._spy_perk_succ(ag.perk2, p_op, ag.level)
         + (greatest(coalesce(ag.level,1),1)-1)*3 ),0),
         coalesce(sum(
           (case when ag.perk='ghost' or ag.perk2='ghost'
                 then 10 + (greatest(coalesce(ag.level,1),1)-1)*2 else 0 end)
         + (greatest(coalesce(ag.level,1),1)-1)*2 ),0)
    into succ_b, det_b
    from public.spy_agents ag where ag.id = any(v_ids);

  -- изъяны оперативников — прямо в сложность
  select coalesce(sum(public._spy_flaw_diff(ag.flaw, p_op)),0),
         coalesce(sum(public._spy_flaw_det(ag.flaw)),0)
    into flaw_diff, flaw_det
    from public.spy_agents ag where ag.id = any(v_ids);

  -- артефакты выбранных (непотраченные)
  select coalesce(sum(public._spy_artifact_succ(art.kind, p_op)),0),
         coalesce(sum(public._spy_artifact_det(art.kind)),0),
         coalesce(sum(k.pierce),0),
         bool_or(k.turn_cut)
    into art_succ, art_det, art_pierce, v_cut
    from public.spy_artifacts art
    join public.spy_artifact_kinds k on k.key=art.kind
    where art.equipped_agent = any(v_ids) and coalesce(art.spent,false)=false;
  succ_b := succ_b + coalesce(art_succ,0);
  det_b  := det_b  + coalesce(art_det,0);

  -- вживание по расе
  select race into trace from public.faction_applications
    where faction_id=p_target_fid and status='approved' order by updated_at desc limit 1;
  if trace is null then
    select race into trace from public.faction_applications
      where faction_id=p_target_fid order by updated_at desc limit 1;
  end if;
  select coalesce(avg(public._spy_race_penalty(ag.race, trace)),0) into race_mod
    from public.spy_agents ag where ag.id = any(v_ids);
  race_mod := round(race_mod * (case when meta ? 'recon' then 0.5 else 1 end));

  -- ЗАЩИЩЁННОСТЬ ЦЕЛИ = сложность операции
  v_sys := public._intel_op_sys(p_target_fid, v_colony);
  prot  := public.system_protection(p_target_fid, v_sys);
  wt    := public._spy_op_weight(p_op);
  hard  := round(greatest(0, prot - coalesce(art_pierce,0)) * wt) + race_mod + flaw_diff;

  ibonus := case when meta ? 'recon' then 0
                 else greatest(0, (case when rec='deep' then 20 else 10 end) - coalesce((intel->>'age')::numeric,9999)) end;
  spow := public._spy_power(app.faction_id);

  succ := greatest(5, least(95, round(55 + a*8 + ibonus + spow + succ_b - hard)));
  det  := greatest(2, least(90, round(6 + prot*0.7 + a*2 + flaw_det
                                      + public._spy_power(p_target_fid) - spow - det_b)));
  turns := greatest(1, least(2, ceil((meta->>'base')::numeric / sqrt(a))));
  if coalesce(v_cut,false) then turns := greatest(1, turns - 1); end if;

  -- ГАРАНТИЯ: одноразовый предмет с guaranteed сгорает и делает операцию верной
  select art.id into v_guar
    from public.spy_artifacts art
    join public.spy_artifact_kinds k on k.key=art.kind
   where art.equipped_agent = any(v_ids) and coalesce(art.spent,false)=false and k.guaranteed
   limit 1;
  if v_guar is not null then
    succ := 100;
    delete from public.spy_artifacts where id=v_guar;
    v_used := v_used || to_jsonb(v_guar::text);
  end if;
  -- прочие одноразовые предметы тратятся на этой операции
  delete from public.spy_artifacts a using public.spy_artifact_kinds k
    where k.key=a.kind and k.one_shot and a.equipped_agent = any(v_ids) and a.id is distinct from v_guar;

  insert into public.spy_missions(actor_fid,actor_owner,target_fid,target_owner,target_name,op,mtype,agents,
      agent_ids, target_colony, success_pct,detect_pct,status,started_at,ready_at,params)
    values(app.faction_id, auth.uid(), p_target_fid, tgt_owner, public._fac_name(p_target_fid), p_op, p_op, a,
      (select jsonb_agg(x::text) from unnest(v_ids) x), v_colony,
      succ, det, 'active', now(), coalesce(me.last_tick, now()) + (turns || ' days')::interval,
      jsonb_build_object('protection', prot, 'weight', wt, 'race_mod', race_mod,
                         'flaw_diff', flaw_diff, 'hard', hard, 'guaranteed', v_guar is not null));
  return jsonb_build_object('ok',true,'success_pct',succ,'detect_pct',det,'turns',turns,'agents',a,
    'protection',prot,'weight',wt,'race_mod',race_mod,'flaw_diff',flaw_diff,'hard',hard,
    'pierce',coalesce(art_pierce,0),'guaranteed', v_guar is not null, 'system_id', v_sys);
end$$;
revoke all on function public.spy_launch(text,text,jsonb,uuid) from public;
grant execute on function public.spy_launch(text,text,jsonb,uuid) to authenticated;

-- ── Превью для клиента: та же арифметика без запуска (честная витрина) ──
create or replace function public.spy_preview(p_target_fid text, p_op text, p_agent_ids jsonb, p_colony_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; v_sys text; v_colony uuid; prot int; wt numeric;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok',false); end if;
  if p_colony_id is not null and exists(select 1 from public.colonies where id=p_colony_id and faction_id=p_target_fid)
    then v_colony := p_colony_id; end if;
  v_sys := public._intel_op_sys(p_target_fid, v_colony);
  prot  := public.system_protection(p_target_fid, v_sys);
  wt    := public._spy_op_weight(p_op);
  return jsonb_build_object('ok',true,'protection',prot,'weight',wt,'system_id',v_sys,
    'posts', public._intel_posts(p_target_fid, v_sys),
    'guards',(select count(*) from public.faction_intel_guard g where g.faction_id=p_target_fid and g.system_id=v_sys));
end$$;
revoke all on function public.spy_preview(text,text,jsonb,uuid) from public;
grant execute on function public.spy_preview(text,text,jsonb,uuid) to authenticated;

-- ════════════════════════════════════════════════════════════
-- 4. РАЗЛОМ: «на тебя посмотрели в ответ» → артефакт
-- ════════════════════════════════════════════════════════════
-- Пересоздаём stargaze_pick надмножеством: всё как было (осколки цикла,
-- хроника, раскрытие поля), плюс на джекпоте nova выдаётся АРТЕФАКТ.
create or replace function public.stargaze_pick(p_idx int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; st public.stargaze_state; cell jsonb; mult numeric; win numeric;
        op jsonb; done boolean; v_gc numeric; jack_i int; total numeric; fin jsonb;
        v_nm text; v_quasar int; v_photo int; v_shard text; v_classes text[]; v_art jsonb;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  if fid is null then raise exception 'no faction'; end if;
  select * into st from public.stargaze_state where faction_id = fid for update;
  if not found or not st.active then raise exception 'no round: сначала сделайте ставку'; end if;
  if p_idx is null or p_idx < 0 or p_idx > 48 then raise exception 'bad cell'; end if;
  if exists (select 1 from jsonb_array_elements(st.opened) e where (e->>'i')::int = p_idx) then
    raise exception 'already opened: этот узел Разлома уже прощупан';
  end if;

  cell := st.board -> p_idx;
  mult := 1 + 0.25 * st.extras;
  win := floor(st.stake * (cell->>'m')::numeric * mult);
  update public.faction_economy set gc = gc + win where faction_id = fid
    returning gc into v_gc;

  -- ── ВЗГЛЯД В ОТВЕТ: из Разлома выпадает артефакт для оперативника ──
  if cell->>'t' = 'nova' then
    begin v_art := public._spy_artifact_grant(fid, 'rift');
    exception when others then v_art := null; end;
  end if;

  op   := st.opened || jsonb_build_object('i', p_idx, 't', cell->>'t',
            'm', (cell->>'m')::numeric, 's', (cell->>'s')::int, 'win', win,
            'artifact', v_art);
  done := jsonb_array_length(op) >= st.picks;

  if done then
    select (i - 1)::int into jack_i
      from jsonb_array_elements(st.board) with ordinality a(e, i)
      where e->>'t' = 'nova' limit 1;
    select coalesce(sum((e->>'win')::numeric), 0) into total from jsonb_array_elements(op) e;

    select count(*) filter (where e->>'t' = 'quasar'),
           count(*) filter (where e->>'t' = 'photo')
      into v_quasar, v_photo
      from jsonb_array_elements(op) e;
    v_shard := null;
    if v_quasar >= 2 or v_photo >= 4 then
      v_classes := array['corvette','destroyer','mediumCruiser','hyperCruiser'];
      v_shard := v_classes[1 + floor(random() * array_length(v_classes, 1))::int];
      begin
        update public.faction_economy
           set cycle_shards = jsonb_set(coalesce(cycle_shards, '{}'::jsonb),
                 array[v_shard],
                 to_jsonb(coalesce((cycle_shards->>v_shard)::int, 0) + 1))
         where faction_id = fid;
      exception when others then v_shard := null;
      end;
    end if;

    fin := jsonb_build_object('board', st.board, 'opened', op, 'stake', st.stake,
      'extras', st.extras, 'mult', mult, 'won', total,
      'spent', st.stake * (1 + st.extras), 'jackpot_i', jack_i,
      'shard', v_shard, 'shard_from', case when v_quasar >= 2 then 'quasar' when v_photo >= 4 then 'photo' else null end);
    update public.stargaze_state
      set active = false, board = null, opened = '[]'::jsonb, last = fin, updated_at = now()
      where faction_id = fid;
  else
    update public.stargaze_state set opened = op, updated_at = now() where faction_id = fid;
  end if;

  if cell->>'t' = 'nova' then
    begin
      v_nm := coalesce(nullif(public._fac_name(fid), ''), 'Одна из держав');
      perform public._luck_post('rift', fid,
        case when v_art is null
          then format('На %s посмотрели в ответ: живой узел, +%s ГС.', v_nm, floor(win)::text)
          else format('На %s посмотрели в ответ и что-то отдали: %s «%s», +%s ГС.',
                      v_nm, coalesce(v_art->>'icon','◈'), coalesce(v_art->>'label','предмет'), floor(win)::text)
        end);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'i', p_idx, 't', cell->>'t',
    'm', (cell->>'m')::numeric, 'win', win, 'gc', v_gc, 'done', done,
    'opened', op, 'picks', st.picks, 'mult', mult, 'artifact', v_art,
    'feed', public._luck_feed('rift', 8),
    'last', case when done then fin else null end);
end$$;
revoke all on function public.stargaze_pick(int) from public, anon;
grant execute on function public.stargaze_pick(int) to authenticated;
