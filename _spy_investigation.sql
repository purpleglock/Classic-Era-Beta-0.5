-- ============================================================
-- ШПИОНАЖ · СЛЕДСТВЕННОЕ ДЕЛО (контрразведка как мини-игра)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_investigate_fix.sql. Идемпотентно.
--
-- Было: одна кнопка «Расследовать · 150 ГС» → тупое накопление улик до 100%.
-- Никакого выбора, никакой дедукции — брутфорс за деньги.
--
-- Стало: ГИБРИД дедукции и тактики.
--   • Каждая незаметная враждебная операция = СЛЕДСТВЕННОЕ ДЕЛО с пулом
--     ПОДОЗРЕВАЕМЫХ (реальный исполнитель + ложные следы из знакомых держав).
--   • У преступника есть ПРОФИЛЬ из реальных данных (режим/раса/мотив).
--   • Разные СЛЕДСТВЕННЫЕ МЕТОДЫ вскрывают по одному измерению профиля,
--     каждый со своей ценой/требованием/риском:
--       🔬 Криминалистика — ГС, режим виновного;
--       👁 Слежка        — ГС + свободный агент, раса;
--       📡 Перехват связи — ГС + сильная КР области, мотив (отношения к вам);
--       🗣 Допрос         — бесплатно, ТОЛЬКО если агент пойман: сдаёт приметы.
--   • Сила КР области даёт ЧИСТЫЕ улики; маскировка операции добавляет ШУМ
--     (улика «?», метод можно перепроверить дороже).
--   • СЛЕД ОСТЫВАЕТ во времени (тем быстрее, чем тише сработал шпион). Не успел
--     обвинить — дело закрыто холодным, шпион ушёл.
--   • Финал — ОБВИНЕНИЕ конкретной державы. Верно → шпион раскрыт. Ошибка →
--     отношения с невиновным падают, реальный шпион остаётся в тени.
-- ============================================================

alter table public.spy_missions add column if not exists case_state jsonb;

-- ── Профиль державы для дедукции ────────────────────────────
-- gov / race берём из анкеты; мотив = корзина отношений ОТ державы К жертве.
create or replace function public._spy_motive_bucket(p_score int)
returns text language sql immutable as $$
  select case when coalesce(p_score,0) <= -20 then 'вражда'
              when coalesce(p_score,0) >   40 then 'дружба'
              else 'нейтралитет' end
$$;

create or replace function public._spy_profile(p_actor text, p_victim text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'gov',  coalesce((select gov  from public.faction_applications
                       where faction_id=p_actor and status='approved' limit 1), 'неизвестен'),
    'race', coalesce((select race from public.faction_applications
                       where faction_id=p_actor and status='approved' limit 1), 'неизвестна'),
    'motive', public._spy_motive_bucket(
                (select score from public.faction_relations
                  where from_fid=p_actor and to_fid=p_victim limit 1)))
$$;

-- ── Лениво построить дело (пул подозреваемых + профили) ──────
create or replace function public._spy_case_build(m public.spy_missions)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare actor_p jsonb; decoys text[]; sus text[]; sprof jsonb := '{}'::jsonb; f text;
begin
  actor_p := public._spy_profile(m.actor_fid, m.target_fid);
  -- кандидаты в ложные следы: знакомые державы (есть отношения / соседи),
  -- приоритет тем, кто делит ≥1 измерение с виновным (правдоподобный след).
  select array_agg(fa.faction_id) into decoys from (
    select fa.faction_id,
           ((coalesce(fa.gov,'')  = (actor_p->>'gov'))::int
          + (coalesce(fa.race,'') = (actor_p->>'race'))::int
          + (public._spy_motive_bucket((select score from public.faction_relations r
               where r.from_fid=fa.faction_id and r.to_fid=m.target_fid limit 1))
               = (actor_p->>'motive'))::int) as shared,
           random() as rnd
    from public.faction_applications fa
    where fa.status='approved' and fa.faction_id <> m.target_fid and fa.faction_id <> m.actor_fid
    order by shared desc, rnd
    limit 3
  ) fa;
  decoys := coalesce(decoys, array[]::text[]);

  -- собрать подозреваемых (виновный + ложные) и перемешать
  sus := array[m.actor_fid] || decoys;
  select array_agg(x order by random()) into sus from unnest(sus) x;

  -- снимок профиля каждого подозреваемого (стабилен на всё дело)
  foreach f in array sus loop
    sprof := sprof || jsonb_build_object(f, public._spy_profile(f, m.target_fid));
  end loop;

  return jsonb_build_object(
    'v', 1,
    'actor', m.actor_fid,          -- серверный секрет, клиенту НЕ отдаём
    'profile', actor_p,            -- истинные значения виновного
    'suspects', to_jsonb(sus),
    'sprof', sprof,
    'revealed', '{}'::jsonb,       -- {dim: {noisy:bool}}
    'methods', '{}'::jsonb,        -- {method: use_count}
    'elim', '[]'::jsonb,           -- державы, исключённые допросом
    'verdict', null, 'accused', null,
    'born', now());
end$$;

-- ── Остаток «следа» 0..100 (остывает со временем) ───────────
create or replace function public._spy_case_trail(m public.spy_missions, cs jsonb)
returns int language sql stable as $$
  -- окно жизни следа: 2..7 суток, тем дольше чем громче (выше detect_pct) шпион
  select greatest(0, least(100, round(100 * (1 - (
      extract(epoch from (now() - coalesce((cs->>'born')::timestamptz, m.created_at)))
      / (((2 + (100 - least(100,coalesce(m.detect_pct,30)))::numeric/100*5)) * 86400)
    )))))::int
$$;

-- ── Санитизированный вид дела для клиента ───────────────────
-- НИКОГДА не отдаёт actor / какой подозреваемый виновен.
create or replace function public._spy_case_view(m public.spy_missions, fid text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cs jsonb; trail int; ci int; idle int; caught boolean;
        rev jsonb; prof jsonb; sprof jsonb; elim jsonb; dims text[] := array['gov','race','motive'];
        d text; sus jsonb := '[]'::jsonb; sf text; smarks jsonb; consistent int := 0; total int;
        clue jsonb := '[]'::jsonb; cons_ok boolean; conf int; verdict text; accused text;
        dim_label jsonb := '{"gov":"Режим","race":"Раса","motive":"Мотив"}'::jsonb;
begin
  cs := m.case_state;
  trail := public._spy_case_trail(m, cs);
  verdict := cs->>'verdict';
  if verdict is null and trail <= 0 then verdict := 'cold'; end if;
  accused := cs->>'accused';
  rev := coalesce(cs->'revealed','{}'::jsonb);
  prof := cs->'profile'; sprof := cs->'sprof'; elim := coalesce(cs->'elim','[]'::jsonb);

  ci := public._spy_ci_power(fid, coalesce(m.target_colony::text, 'hq'));
  select count(*)::int into idle from public.spy_agents ag
    where ag.faction_id=fid and ag.ready_at<=now()
      and not exists(select 1 from public.spy_missions sm
                     where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? ag.id::text);
  caught := coalesce((m.result->>'caught')::boolean, false);

  -- открытые улики (значение виновного по вскрытым измерениям)
  foreach d in array dims loop
    if rev ? d then
      clue := clue || jsonb_build_array(jsonb_build_object(
        'dim', d, 'label', dim_label->>d, 'value', prof->>d,
        'noisy', coalesce((rev->d->>'noisy')::boolean,false)));
    end if;
  end loop;

  -- подозреваемые с отметками ✓/✗/? и проверкой совместимости
  total := jsonb_array_length(cs->'suspects');
  for sf in select jsonb_array_elements_text(cs->'suspects') loop
    smarks := '{}'::jsonb; cons_ok := true;
    if elim ? sf then
      foreach d in array dims loop smarks := smarks || jsonb_build_object(d,'no'); end loop;
      cons_ok := false;          -- исключён допросом
    else
      foreach d in array dims loop
        if rev ? d then
          if coalesce((rev->d->>'noisy')::boolean,false) then
            smarks := smarks || jsonb_build_object(d,'?');     -- шумная улика
          elsif (sprof->sf->>d) = (prof->>d) then
            smarks := smarks || jsonb_build_object(d,'yes');
          else
            smarks := smarks || jsonb_build_object(d,'no'); cons_ok := false;
          end if;
        else
          smarks := smarks || jsonb_build_object(d, null);
        end if;
      end loop;
    end if;
    if cons_ok then consistent := consistent + 1; end if;
    sus := sus || jsonb_build_array(jsonb_build_object(
      'fid', sf, 'name', public._fac_name(sf), 'marks', smarks, 'consistent', cons_ok));
  end loop;

  -- ясность: 1 совместимый → 100%, все совместимы → 0%
  if total <= 1 then conf := 100;
  else conf := greatest(0, round(100.0 * (total - consistent) / (total - 1)))::int; end if;

  return jsonb_build_object(
    'mission_id', m.id, 'op', m.op, 'outcome', m.outcome,
    'trail', trail, 'verdict', verdict, 'accused', accused,
    'caught', caught, 'ci', ci, 'idle_agents', idle,
    'clues', clue, 'suspects', sus, 'confidence', conf,
    'methods', jsonb_build_object(
      'forensics', coalesce((cs#>>'{methods,forensics}')::int,0),
      'surveil',   coalesce((cs#>>'{methods,surveil}')::int,0),
      'wiretap',   coalesce((cs#>>'{methods,wiretap}')::int,0),
      'interro',   coalesce((cs#>>'{methods,interro}')::int,0)));
end$$;

-- ── Открыть дело (лениво строит case_state) ─────────────────
create or replace function public.spy_case_open(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.spy_missions;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into m from public.spy_missions where id=p_mission_id and target_fid=fid and status='done';
  if not found then raise exception 'incident not found'; end if;
  if m.op not in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose')
     or m.outcome <> 'success' then raise exception 'nothing to investigate'; end if;
  if m.detected then raise exception 'already unmasked'; end if;

  if m.case_state is null or (m.case_state->>'v') is null then
    update public.spy_missions set case_state = public._spy_case_build(m) where id=m.id returning * into m;
  end if;
  return public._spy_case_view(m, fid);
end$$;
revoke all on function public.spy_case_open(uuid) from public;
grant execute on function public.spy_case_open(uuid) to authenticated;

-- ── Применить следственный метод ────────────────────────────
create or replace function public.spy_case_method(p_mission_id uuid, p_method text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.spy_missions; cs jsonb; dim text; cost int; uses int;
        ci int; idle int; caught boolean; conceal numeric; noise_pct numeric; noisy boolean;
        scope text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into m from public.spy_missions where id=p_mission_id and target_fid=fid and status='done' for update;
  if not found then raise exception 'incident not found'; end if;
  if m.detected then raise exception 'already unmasked'; end if;
  if m.case_state is null or (m.case_state->>'v') is null then
    update public.spy_missions set case_state=public._spy_case_build(m) where id=m.id returning * into m;
  end if;
  cs := m.case_state;
  if cs->>'verdict' is not null then raise exception 'case closed'; end if;
  if public._spy_case_trail(m, cs) <= 0 then raise exception 'trail went cold'; end if;

  scope := coalesce(m.target_colony::text, 'hq');
  ci := public._spy_ci_power(fid, scope);
  caught := coalesce((m.result->>'caught')::boolean, false);
  uses := coalesce((cs->'methods'->>p_method)::int, 0);

  -- маршрутизация метода → измерение + цена + требования
  if p_method = 'forensics' then dim := 'gov';  cost := 80;
  elsif p_method = 'surveil' then dim := 'race'; cost := 60;
    select count(*)::int into idle from public.spy_agents ag
      where ag.faction_id=fid and ag.ready_at<=now()
        and not exists(select 1 from public.spy_missions sm
                       where sm.actor_fid=fid and sm.status='active' and sm.agent_ids ? ag.id::text);
    if idle < 1 then raise exception 'need a free agent for surveillance'; end if;
  elsif p_method = 'wiretap' then dim := 'motive'; cost := 120;
    if ci < 3 then raise exception 'wiretap needs counterintel >= 3 in the area'; end if;
  elsif p_method = 'interro' then
    if not caught then raise exception 'no captured agent to interrogate'; end if;
    if uses >= 1 then raise exception 'agent already interrogated'; end if;
  else raise exception 'unknown method';
  end if;

  -- перепроверка вскрытого измерения дороже (×1.5), но прицельная — не брутфорс
  if p_method <> 'interro' and (cs->'revealed') ? dim then cost := ceil(cost * 1.5)::int; end if;

  if cost > 0 then
    update public.faction_economy set gc = gc - cost where faction_id=fid and gc >= cost;
    if not found then raise exception 'not enough GC (need %)', cost; end if;
  end if;

  if p_method = 'interro' then
    -- пойманный агент сдаёт приметы хозяина: режим+раса вскрываются ЧИСТО
    cs := jsonb_set(cs, '{revealed,gov}',  '{"noisy":false}'::jsonb, true);
    cs := jsonb_set(cs, '{revealed,race}', '{"noisy":false}'::jsonb, true);
  else
    -- чистота улики = состязание КР области и маскировки операции
    conceal := greatest(0, 100 - coalesce(m.detect_pct, 30));
    noise_pct := greatest(5, least(85, conceal - ci*12 - uses*15));  -- перепроверка снижает шум
    noisy := (random()*100) < noise_pct;
    cs := jsonb_set(cs, array['revealed',dim], jsonb_build_object('noisy',noisy), true);
  end if;

  cs := jsonb_set(cs, array['methods',p_method], to_jsonb(uses+1), true);
  update public.spy_missions set case_state=cs where id=m.id returning * into m;
  return public._spy_case_view(m, fid);
end$$;
revoke all on function public.spy_case_method(uuid,text) from public;
grant execute on function public.spy_case_method(uuid,text) to authenticated;

-- ── Выдвинуть обвинение ─────────────────────────────────────
create or replace function public.spy_case_accuse(p_mission_id uuid, p_suspect_fid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.spy_missions; cs jsonb; correct boolean; actor text;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into m from public.spy_missions where id=p_mission_id and target_fid=fid and status='done' for update;
  if not found then raise exception 'incident not found'; end if;
  if m.detected then raise exception 'already unmasked'; end if;
  if m.case_state is null or (m.case_state->>'v') is null then raise exception 'open the case first'; end if;
  cs := m.case_state;
  if cs->>'verdict' is not null then raise exception 'case closed'; end if;
  if public._spy_case_trail(m, cs) <= 0 then raise exception 'trail went cold'; end if;
  -- обвинять можно только из пула подозреваемых
  if not (cs->'suspects' ? p_suspect_fid) then raise exception 'not a suspect'; end if;

  actor := cs->>'actor';
  correct := (p_suspect_fid = actor);

  if correct then
    cs := jsonb_set(jsonb_set(cs,'{verdict}','"solved"'),'{accused}', to_jsonb(p_suspect_fid));
    update public.spy_missions set detected=true, evidence=100, case_state=cs where id=m.id;
    insert into public.faction_relations(from_fid,to_fid,score,updated_at)
      values(fid, actor, -15, now())
      on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-15), updated_at=now();
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(fid, '🕵 КОНТРРАЗВЕДКА', 'rgba(90,140,200,0.55)', null, null,
        'Шпион вычислен', null,
        format('Контрразведка «%s» довела следственное дело до конца: за тайной операцией стоит фракция «%s».',
          public._fac_name(fid), public._fac_name(actor)),
        'approved', now(), now(), now());
  else
    -- ложное обвинение: дело сгорает, реальный шпион уходит, отношения с невиновным падают
    cs := jsonb_set(jsonb_set(cs,'{verdict}','"wrong"'),'{accused}', to_jsonb(p_suspect_fid));
    update public.spy_missions set case_state=cs where id=m.id;
    insert into public.faction_relations(from_fid,to_fid,score,updated_at)
      values(fid, p_suspect_fid, -10, now())
      on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-10), updated_at=now();
  end if;

  return jsonb_build_object('ok',true,'correct',correct,
    'actor_name', case when correct then public._fac_name(actor) else null end,
    'accused_name', public._fac_name(p_suspect_fid),
    'case', public._spy_case_view((select m2 from public.spy_missions m2 where m2.id=m.id), fid));
end$$;
revoke all on function public.spy_case_accuse(uuid,text) from public;
grant execute on function public.spy_case_accuse(uuid,text) to authenticated;

-- ── spy_incoming: добавить флаг открытого дела ──────────────
-- has_case = операцию ещё можно расследовать (незаметная, успешная, враждебная,
-- дело не закрыто). Клиент по нему рисует кнопку «Открыть дело».
-- DROP обязателен: меняем набор возвращаемых колонок (CREATE OR REPLACE не может).
drop function if exists public.spy_incoming();
create or replace function public.spy_incoming()
returns table(
  id uuid, op text, outcome text, detected boolean,
  actor_name text, result jsonb, evidence int, hint text,
  has_case boolean, case_verdict text, case_confidence int,
  created_at timestamptz, ready_at timestamptz)
language sql security definer set search_path = public as $$
  with me as (
    select faction_id from public.faction_applications
    where owner_id = auth.uid() and status = 'approved'
    order by updated_at desc limit 1
  )
  select
    m.id, m.op, m.outcome, m.detected,
    case when m.detected then public._fac_name(m.actor_fid) else null end,
    case when m.detected then m.result else (coalesce(m.result,'{}'::jsonb) - 'actor_name') end,
    coalesce(m.evidence,0),
    null::text,                       -- старый текстовый «hint» больше не нужен
    (not m.detected
        and m.outcome='success'
        and m.op in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose')
        -- ещё расследуемо: дело не закрыто вердиктом И след не остыл
        and coalesce(m.case_state->>'verdict','') not in ('wrong','solved')
        and (m.case_state is null or public._spy_case_trail(m, m.case_state) > 0)) as has_case,
    -- вердикт для строки: явный (wrong/solved) либо «cold» если след остыл
    case when coalesce(m.case_state->>'verdict','') <> '' then m.case_state->>'verdict'
         when m.case_state is not null and public._spy_case_trail(m, m.case_state) <= 0 then 'cold'
         else null end,
    case when m.case_state is not null
         then (public._spy_case_view(m, me.faction_id)->>'confidence')::int else null end,
    m.created_at, m.ready_at
  from public.spy_missions m, me
  where m.target_fid = me.faction_id
    and m.status = 'done'
    and (m.detected = true
         or (m.outcome = 'success'
             and m.op in ('steal_gc','steal_res','sabotage','mass_demolish','destabilize','steal_tech','kill_agent','faith_impose')))
  order by m.created_at desc
  limit 30;
$$;
revoke all on function public.spy_incoming() from public;
grant execute on function public.spy_incoming() to authenticated;

-- ── Старая spy_investigate → дружелюбная ошибка (мигрировано) ─
create or replace function public.spy_investigate(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'investigation reworked: open the case file instead';
end$$;

-- ── Проверка ────────────────────────────────────────────────
-- select * from public.spy_incoming();
-- select public.spy_case_open('<mission_uuid>');
-- select public.spy_case_method('<mission_uuid>','forensics');
-- select public.spy_case_accuse('<mission_uuid>','<suspect_fid>');
