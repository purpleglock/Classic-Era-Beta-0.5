-- ════════════════════════════════════════════════════════════
-- «ПРЕСТОЛ» — ШАГ 10: ОНО ПРОШЛО. КОВЧЕГ УХОДИТ САМ
-- ────────────────────────────────────────────────────────────
-- ПОРЯДОК: после _angel_wipe_end.sql, перед _angel_lock.sql.
--   node tools/db_run.js _angel_moves_on.sql
--   node tools/db_run.js _angel_lock.sql
-- Идемпотентно. Накат разбирает уже завязавшуюся карусель.
--
-- ЖАЛОБА: «флоты остаются в одной системе», «это флот игрока, он его не может
-- увести». Обе верны, и вторая закрывает целый класс лечений.
--
-- ЧТО ПРОИСХОДИЛО. Бой кончался (шаг 9) — и через две минуты в сводках стояло
-- «Столкновение флотов». Круг такой:
--   • бой закрыт, флоты расскованы;
--   • `_war_sweep` (_war_standing_fix.sql) раз в тик обходит СТОЯЩИЕ флоты и
--     заводит бой всем, кто стоит в одной системе с врагом;
--   • ковчег стоит там же — новый бой, оба флота снова скованы.
-- И главное: `angel_war_tick` шаг 9.4 КАЖДЫЙ тик пытается увести ковчег
-- дальше («стоящий на месте кризис перестаёт быть кризисом»). Не мог:
-- `battle_lock_fleet` поднимает исключение на скованном флоте, тик его глотает.
-- То есть ангел был заперт собственным боем в системе, которую уже подмёл.
--
-- ⚠️ ЗАБРАКОВАНО: любое лечение, которое ЖДЁТ ДЕЙСТВИЯ ИГРОКА — «уцелевшие
-- уходят», «дайте им окно на отступление», затишье на N часов. Флот игрока
-- уводить может только игрок, а он может и не мочь: бак пуст (топливо в
-- плечах, заправка только верфь/depot), система своя и бросать её нельзя,
-- игрока просто нет онлайн. Правило, которое держится на чужом ходе, — не
-- правило, а надежда.
--
-- ЛЕЧЕНИЕ. Уходит тот, кто может уйти всегда: ангел. Разошлись — ковчег в ту
-- же транзакцию снимается с орбиты и идёт к следующей цели. Пока он в прыжке,
-- `system_id` пуст, `_war_hostile_fleet` его не видит, цепляться не с кем —
-- карусель обрывается без единого запрета и без единой отсрочки.
--
-- ЭТО НЕ ПОБЛАЖКА ИГРОКУ. Кризис не «отпускает» — он идёт дальше по галактике,
-- ровно как задумано в _angel_ai.sql. Держава, которую подмели, получает не
-- прощение, а передышку; ковчег вернётся, когда `_angel_pick_target` снова
-- выберет эту систему (память похода на 12 систем мешает ходить челноком).
--
-- ⚠️ ГОЛОС: «оно ушло, потому что бой кончился» не пишем. Уход ангела и так
-- освещается сводкой ОТМЕТКА СНЯЛАСЬ (_angel_news в тике); здесь молчим.
-- ════════════════════════════════════════════════════════════

-- ── 1. РАЗОШЛИСЬ — И ОНО СНЯЛОСЬ С МЕСТА ────────────────────
-- Надмножество _angel_no_grip.sql: тот же _angel_slip слово в слово, плюс
-- проводы ковчега в конце. Ставим ЗДЕСЬ, а не в `_bt_check_end` и не в тике:
-- через `_angel_slip` проходят ВСЕ три способа кончить бой с ангелом —
-- выбитая доска (шаг 9), лимит ходов и стена по часам (шаг 7), ручная дверь
-- стаффа. Уход обязан висеть на самом разходе, иначе найдётся четвёртый путь,
-- на котором ковчег снова останется стоять.
create or replace function public._angel_slip(p_battle uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b record; af text; foe text; sysname text; r record; f record;
        comp jsonb; e jsonb; newc jsonb; q int; loss int; dead int := 0;
        dest text; gone jsonb := null;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.status = 'done' then return jsonb_build_object('ok', true, 'skip', true); end if;
  af := case when public._angel_is(b.attacker_fid) then b.attacker_fid
             when public._angel_is(b.defender_fid) then b.defender_fid else null end;
  if af is null then return jsonb_build_object('ok', false, 'why', 'ангела в этом бою нет'); end if;
  foe := case when b.attacker_fid = af then b.defender_fid else b.attacker_fid end;

  -- Борт ангела снимаем с доски: доска кончилась, тело возвращается ковчегу.
  delete from public.battle_units where battle_id = p_battle and fid = af;

  -- Потери — только реально погибшие на доске.
  for r in select fid, unit_id, count(*) as n
             from public.battle_units
            where battle_id = p_battle and not alive and unit_id is not null
            group by 1,2
  loop
    dead := dead + r.n;
    loss := r.n;
    for f in select bf.fleet_id from public.battle_fleets bf
              where bf.battle_id = p_battle and bf.fid = r.fid
    loop
      exit when loss <= 0;
      select composition into comp from public.fleets where id = f.fleet_id for update;
      newc := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(comp,'[]'::jsonb)) loop
        if (e->>'unit_id')::uuid = r.unit_id and loss > 0 then
          q := greatest(0, coalesce((e->>'qty')::int,0));
          if q <= loss then loss := loss - q; q := 0;
          else q := q - loss; loss := 0; end if;
          if q > 0 then newc := newc || jsonb_build_array(jsonb_set(e, array['qty'], to_jsonb(q), true)); end if;
        else
          newc := newc || jsonb_build_array(e);
        end if;
      end loop;
      update public.fleets set composition = newc where id = f.fleet_id;
    end loop;
  end loop;

  -- Флот, у которого не осталось ни одного корабля, распускаем.
  delete from public.fleets fl
   where fl.id in (select fleet_id from public.battle_fleets where battle_id = p_battle)
     and coalesce((select sum(greatest(0, coalesce((c->>'qty')::int,0)))
                   from jsonb_array_elements(coalesce(fl.composition,'[]'::jsonb)) c), 0) = 0;

  -- ⚠️ winner_fid НЕ ставим: победы не было. Флага никто не поднимает.
  -- Флоты расковываются самим фактом status='done' (_fleet_in_battle).
  update public.battles
     set status = 'done', ended_at = now(), side_to_move = null, deadline_at = null
   where id = p_battle;

  select coalesce(nullif(name,''), id) into sysname from public.map_systems where id = b.system_id;
  perform public._angel_tell(foe,
    public._angel_glitch('◈ ' || coalesce(sysname,'?') || ': стрельба прекратилась', 0.22),
    public._angel_glitch(
      'Цель перестала отвечать на манёвры и держит орбиту так, будто боя не было. '
      || 'Уцелевшие возвращаются. Что считать итогом, штаб', 0.16)
    || ' ' || public._angel_scream(13));

  -- ── ОНО ИДЁТ ДАЛЬШЕ ───────────────────────────────────────
  -- Сразу здесь, а не «в следующий тик»: между закрытием боя и тиком стоит
  -- `_war_sweep`, и он успевает завязать новый бой на тех же стоящих флотах.
  -- Ковчег к этой секунде уже расскован (бой 'done'), так что триггер
  -- battle_lock_fleet пропускает.
  -- В гнездо — если ангел ранен и разворачивался домой; иначе к новой цели.
  begin
    if exists(select 1 from public.angel_state s
               where s.faction_id = af and s.stance = 'roost') then
      select case when s.home_sys is distinct from b.system_id then s.home_sys end
        into dest from public.angel_state s where s.faction_id = af;
    end if;
    if dest is null then dest := public._angel_pick_target(); end if;
    if dest is not null and dest is distinct from b.system_id then
      gone := public._angel_send(dest);
    end if;
  exception when others then gone := jsonb_build_object('ok', false, 'why', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'battle', p_battle, 'foe', foe, 'dead', dead,
                            'left', gone);
end$$;
revoke all on function public._angel_slip(uuid) from public;

-- ── 2. РАЗБОР КАРУСЕЛИ ──────────────────────────────────────
-- Всё, что успело завязаться заново, снимаем — теперь уже с проводами.
do $$
declare af text; r record; n int := 0; res jsonb;
begin
  af := public._angel_fid();
  if af is null then return; end if;
  for r in select b.id from public.battles b
            where b.status <> 'done' and (b.attacker_fid = af or b.defender_fid = af)
  loop
    begin
      res := public._angel_slip(r.id); n := n + 1;
      raise notice 'slip %: %', r.id, res;
    exception when others then raise notice 'battle % : %', r.id, sqlerrm; end;
  end loop;
  raise notice 'angel battles closed: %', n;
end$$;

notify pgrst, 'reload schema';

-- ── ПРОВЕРКА ────────────────────────────────────────────────
-- 1) Бой ангела закрылся → ковчег в status='transit' с dest_sys, его
--    system_id пуст. Следующий тик НЕ заводит «Столкновение флотов»:
--    цепляться не с кем.
-- 2) Флот игрока стоит там же, где стоял, в 'idle' — от него ничего не
--    требуется и ничего не отнято, кроме погибших на доске.
-- 3) Ковчег прилетел в новую систему → там всё по-старому: война по факту,
--    бой, доска. Кризис едет дальше.
-- 4) Ангел ранен (stance='roost') → уходит в гнездо, а не к новой цели.
