-- ============================================================
-- ШПИОНАЖ · ФИКС РАССЛЕДОВАНИЯ (контрразведка vs маскировка)
-- Применять в Supabase → SQL Editor ПОСЛЕ _spy_agents5.sql. Идемпотентно.
--
-- Было: gain := greatest(5, round((10 + ci*6) * …)) — гарантированный пол +5
-- за клик и полное игнорирование скрытности атакующего. Из-за этого улики
-- копились ВСЕГДА и расследование вскрывало шпиона почти в 100% случаев —
-- независимо от того, насколько тихо прошла операция.
--
-- Стало: расследование — СОСТЯЗАНИЕ. Сила КР области против маскировки
-- операции (берётся из её detect_pct: чем тише сработал шпион, тем сложнее
-- его вскрыть). Нет перевеса контрразведки → след «остывает», улик 0.
-- Брутфорсом за деньги вычислить элитного шпиона больше нельзя — нужна
-- реальная контрразведка.
-- ============================================================

create or replace function public.spy_investigate(p_mission_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare fid text; m public.spy_missions; ci int;
        conceal numeric; attack numeric; gain int; ev int; revealed boolean := false;
begin
  if public.current_user_banned() then raise exception 'forbidden: account banned'; end if;
  fid := public._ec_my_fid();
  select * into m from public.spy_missions where id=p_mission_id and target_fid=fid and status='done';
  if not found then raise exception 'incident not found'; end if;
  if m.op not in ('steal_gc','sabotage','destabilize','steal_tech') or m.outcome <> 'success' then
    raise exception 'nothing to investigate'; end if;
  if m.detected or coalesce(m.evidence,0) >= 100 then raise exception 'already unmasked'; end if;

  update public.faction_economy set gc = gc - 150 where faction_id=fid and gc >= 150;
  if not found then raise exception 'not enough GC (need 150)'; end if;

  -- Контрразведка области инцидента (саботаж по колонии → её КР, иначе Центр)
  ci := public._spy_ci_power(fid, coalesce(m.target_colony::text, 'hq'));
  -- Маскировка атакующего = насколько чисто прошла операция. detect_pct уже
  -- агрегирует сложность, силу его сети, ghost-перки и т.п. — чем он ниже,
  -- тем плотнее заметены следы и тем выше сопротивление расследованию.
  conceal := greatest(0, 100 - coalesce(m.detect_pct, 30)) * 0.45;
  attack  := 10 + ci * 8;
  -- Состязание со случайным разбросом. Без перевеса КР gain=0 — след остыл,
  -- улики не растут, сколько денег в них ни вкладывай.
  gain := greatest(0, round((attack - conceal) * (0.5 + random())));
  ev := least(100, coalesce(m.evidence,0) + gain);

  if ev >= 100 then
    revealed := true;
    update public.spy_missions set evidence=100, detected=true where id=m.id;
    insert into public.faction_relations(from_fid,to_fid,score,updated_at)
      values(fid, m.actor_fid, -15, now())
      on conflict (from_fid,to_fid) do update set score=greatest(-100, public.faction_relations.score-15), updated_at=now();
    insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
        title, excerpt, body, status, published_at, created_at, updated_at)
      values(fid, '🕵 КОНТРРАЗВЕДКА', 'rgba(90,140,200,0.55)', null, null,
        'Шпион вычислен', null,
        format('Контрразведка «%s» установила: за тайной операцией стоит фракция «%s».',
          public._fac_name(fid), public._fac_name(m.actor_fid)),
        'approved', now(), now(), now());
  else
    update public.spy_missions set evidence=ev where id=m.id;
  end if;

  return jsonb_build_object('ok',true,'evidence',ev,'gain',gain,'revealed',revealed,
    'actor_name', case when revealed then public._fac_name(m.actor_fid) else null end);
end$$;
revoke all on function public.spy_investigate(uuid) from public;
grant execute on function public.spy_investigate(uuid) to authenticated;

-- ── Проверка ────────────────────────────────────────────────
-- Тихий шпион (detect_pct~10): conceal≈40 → нужна КР ci≈4-5, чтобы пошли улики.
-- Громкий шпион (detect_pct~70): conceal≈13 → ловится уже при ci≈1-2.
-- Без контрразведки (ci=0, attack=10): почти все вычисления дают gain=0.
