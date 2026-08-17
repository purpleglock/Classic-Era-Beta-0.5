-- ════════════════════════════════════════════════════════════
-- ДОЗВЁЗДНЫЕ · ОБРЯД КАК КОНЕЦ ПАРТИИ
--
-- До этого наката «ВЫКАЧАТЬ» была обычной ступенью века: двигала две шкалы,
-- била по досье Фонда — и ВСЁ. Серверный обряд (`_precursor_rite.sql`) она
-- не звала, поэтому мир после выкачивания оставался жив, а ихор, ради
-- которого обряд и служат, на склад не капал ни разу.
--
-- Сшить их в лоб было нельзя: обряд НЕОБРАТИМ (status='dead', pop=0, клеймо
-- на вере, оглашение на всю галактику), а ступень руки жмётся с обычной
-- кнопки хода и обещает «следующий век». Поэтому:
--
--   1. `тёмное` снята с двери ступеней (`precursor_run_act`) — оттуда она
--      больше не проходит вовсе;
--   2. заведена своя дверь `precursor_run_rite`, за подтверждением на
--      экране: она зовёт `precursor_act(..., 'rite')` — тот самый обряд, со
--      всеми его гейтами (уклад, своя вера, присутствие в системе), ихором
--      на склад по счёту 100 душ = 1 ихор и −80 досье;
--   3. партия закрывается ЧЕТВЁРТЫМ исходом `обмен`: мира больше нет, и
--      считать ему развитие с ущербом не по чему.
--
-- Накат идемпотентный. Порядок: после `_precursor_run.sql` (нужны
-- `_pcr_open`/`_pcr_const`) и `_precursor_rite.sql` (нужен сам обряд).
-- ════════════════════════════════════════════════════════════

-- ── 1. «ТЁМНОЕ» БОЛЬШЕ НЕ СТУПЕНЬ ──────────────────────────
-- Зеркало precursor_run.js: в РУКЕ осталось три ступени, четвёртая карта
-- ходит своей дверью. Расходятся эти два места — расходится игра.
create or replace function public._pcr_act(p_act text, p_tier int)
returns jsonb language sql immutable as $$
  select case p_act
    when 'покой'  then jsonb_build_object('att',1,'gc',0,
                        'rep', 5,'flow', 0,'wound', -7,'tail','глухо')
    when 'ритм'   then jsonb_build_object('att',2,'gc', 60000 + 20000*greatest(p_tier,0),
                        'rep',-3,'flow', 8,'wound', -5,'tail','беда')
    when 'слово'  then jsonb_build_object('att',2,'gc', 90000 + 30000*greatest(p_tier,0),
                        'rep',-15,'flow',12,'wound',  5,'tail','ноет')
    else null end
$$;

-- ── 2. ДВЕРЬ СТУПЕНЕЙ: явный отказ вместо «нет такого действия» ──
-- Тело — то же, что в `_precursor_run.sql`, плюс один ранний гейт. Старый
-- клиент из кеша не должен получать в ответ загадку.
create or replace function public.precursor_run_act(
  p_system_id text, p_pid integer, p_act text)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; a jsonb; K jsonb;
        v_gc numeric; v_cost numeric; v_rep int; v_fine numeric := 0; v_before int;
begin
  if p_act = 'тёмное' then
    return jsonb_build_object('ok', false,
      'why', 'обряд идёт своей дверью, с подтверждением');
  end if;

  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  r := public._pcr_open(fid, p_system_id, p_pid);
  if r.faction_id is null then return jsonb_build_object('ok', false, 'why', 'мира нет'); end if;
  if r.ending is not null then return jsonb_build_object('ok', false, 'why', 'партия окончена'); end if;

  a := public._pcr_act(p_act, r.tier);
  if a is null then return jsonb_build_object('ok', false, 'why', 'нет такого действия'); end if;
  if r.att < (a->>'att')::int then
    return jsonb_build_object('ok', false, 'why', 'в этом веке уже некогда');
  end if;

  v_cost := (a->>'gc')::numeric;
  select gc into v_gc from public.faction_economy where faction_id = fid for update;
  if v_cost > 0 and coalesce(v_gc, 0) < v_cost then
    return jsonb_build_object('ok', false,
      'why', 'казна не тянет: нужно ' || v_cost::bigint || ' ГС');
  end if;
  if v_cost > 0 then
    update public.faction_economy set gc = gc - v_cost where faction_id = fid;
  end if;

  select coalesce(rep, 0) into v_before from public.faction_foundation where faction_id = fid;
  v_rep := public._pc_rep(fid, (a->>'rep')::int);
  if v_before > -100 and v_rep = -50 then
    select coalesce(v_gc,0) - v_cost - coalesce(gc,0) into v_fine
      from public.faction_economy where faction_id = fid;
    v_fine := greatest(0, v_fine);
  end if;

  K := public._pcr_const();
  update public.precursor_run set
    att   = att - (a->>'att')::int,
    flow  = least(100, greatest(0, flow  + (a->>'flow')::int)),
    wound = least((K->>'предел')::int, greatest(0, wound + (a->>'wound')::int)),
    ache  = ache + (case when a->>'tail' = 'ноет' then 1 else 0 end),
    mark  = (case when a->>'tail' in ('беда','злоба') then a->>'tail' else mark end),
    spent = spent + v_cost,
    fined = fined + v_fine,
    trail = trail || jsonb_build_object('век', turn, 'что', p_act),
    updated_at = now()
  where faction_id = fid and system_id = p_system_id and pid = p_pid
  returning * into r;

  if r.wound >= (K->>'предел')::int then
    update public.precursor_run set ending = 'кризис', why = 'срыв', updated_at = now()
     where faction_id = fid and system_id = p_system_id and pid = p_pid
    returning * into r;
  end if;

  select gc into v_gc from public.faction_economy where faction_id = fid;
  return jsonb_build_object('ok', true, 'run', to_jsonb(r),
    'gc', coalesce(v_gc,0), 'rep', v_rep, 'fine', v_fine, 'cost', v_cost);
end$$;

-- ── 3. ДВЕРЬ ОБРЯДА ────────────────────────────────────────
-- Своей кассы здесь НЕТ: ихор, клеймо, досье и оглашение считает сам обряд
-- (`precursor_act(...,'rite')`). Партия только закрывается по его следу.
--
-- Гейты обряда прилетают исключениями (`no faith of your own`, `forbidden by
-- creed`, …) — ловим и переводим в человеческий `why`, как на карточке мира.
create or replace function public.precursor_run_rite(
  p_system_id text, p_pid integer)
returns jsonb
language plpgsql volatile security definer set search_path to 'public' as $$
declare fid text; r public.precursor_run%rowtype; res jsonb; msg text;
        v_gc numeric; v_rep int; v_ichor numeric := 0;
begin
  fid := public._ec_my_fid();
  if fid is null then return jsonb_build_object('ok', false, 'why', 'нет державы'); end if;

  r := public._pcr_open(fid, p_system_id, p_pid);
  if r.faction_id is null then return jsonb_build_object('ok', false, 'why', 'мира нет'); end if;
  if r.ending is not null then return jsonb_build_object('ok', false, 'why', 'партия окончена'); end if;
  if r.att < 1 then return jsonb_build_object('ok', false, 'why', 'в этом веке уже некогда'); end if;

  begin
    res := public.precursor_act(p_system_id, p_pid, 'rite');
  exception when others then
    msg := sqlerrm;
    return jsonb_build_object('ok', false, 'why',
      case
        when msg like '%forbidden by creed%' then 'Уклад вашей державы обряда не допускает.'
        when msg like '%no faith of your own%' then 'Обряд служат своей вере — у вашей державы её нет.'
        when msg like '%no presence in system%' then 'Нет колонии в этой системе — до них не дотянуться.'
        when msg like '%another patron%' then 'Этот мир уже под чужим покровительством.'
        when msg like '%civ is gone%' then 'Там уже некого приносить.'
        when msg like '%no civ%' then 'Мира нет.'
        else msg end);
  end;
  if res is null or coalesce((res->>'ok')::boolean, false) = false then
    return jsonb_build_object('ok', false,
      'why', coalesce(res->>'why', 'обряд не состоялся'));
  end if;
  v_ichor := coalesce((res->>'ichor')::numeric, 0);

  -- Партия закрыта. Влияние века всё-таки списываем: обряд занял этот век
  -- целиком, и в летописи должно быть видно, чем игрок его занял.
  update public.precursor_run set
    att    = greatest(0, att - 1),
    flow   = least(100, flow + 18),
    wound  = (public._pcr_const()->>'предел')::int,
    trail  = trail || jsonb_build_object('век', turn, 'что', 'тёмное'),
    ending = 'обмен', why = 'обряд', updated_at = now()
  where faction_id = fid and system_id = p_system_id and pid = p_pid
  returning * into r;

  select gc into v_gc from public.faction_economy where faction_id = fid;
  select coalesce(rep, 0) into v_rep from public.faction_foundation where faction_id = fid;

  return jsonb_build_object('ok', true, 'run', to_jsonb(r),
    'gc', coalesce(v_gc,0), 'rep', coalesce(v_rep,0),
    'ichor', v_ichor, 'pop', coalesce((res->>'pop')::numeric, 0),
    'stigma', res->'stigma', 'txt', res->>'txt');
end$$;

revoke all on function public.precursor_run_rite(text, integer) from public, anon;
grant execute on function public.precursor_run_rite(text, integer) to authenticated;
grant execute on function public.precursor_run_act(text, integer, text) to authenticated;

comment on function public.precursor_run_rite(text, integer) is
  'Обряд из партии: зовёт precursor_act(rite), ихор на склад, партия закрывается исходом «обмен».';
