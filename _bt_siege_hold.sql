-- © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ОСАДА ДЕРЖИТСЯ ДО СВОРАЧИВАНИЯ  (добор к _bt_weapon_model.sql)
-- ════════════════════════════════════════════════════════════
-- ПОЧЕМУ: залп факельщика стоит 5.4 c из пула 6.0, раскладка — 2.0 c. Если
-- осада живёт один ход, как форсаж, то в ход раскладки выстрелить уже нечем,
-- а к следующему ходу режим сам спадает — механика мёртвая по арифметике.
-- В источнике (wiki/Modules, Siege Mode) это режим С ДЛИТЕЛЬНОСТЬЮ, а не
-- разовый бонус. Поэтому: осада НЕ сбрасывается началом хода. Ход раскладки
-- отдан целиком, зато со следующего хода факельщик бьёт ×2 полным пулом,
-- пока сам не свернётся. Плата — неподвижность всё это время.
--
-- ЦЕПОЧКА: строго ПОСЛЕ _bt_weapon_model.sql. Идемпотентно.
-- ════════════════════════════════════════════════════════════

-- ── 1) Обновление хода: осаду не гасим ───────────────────────
create or replace function public._bt_tp_refresh(p_battle uuid, p_side text)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.battle_units
     set moved = false, fired = false, acted = false, flash = false,
         tp = tp_max,        -- свежие секунды
         shield = 0,         -- поле опускается: корабль снова начинает действовать
         -- мощность распределяется заново — но разложенная осадная платформа
         -- держится, пока экипаж сам её не свернёт (см. battle_stance 'off').
         stance = case when stance = 'siege' then 'siege' else 'off' end
   where battle_id = p_battle and side = p_side;
end$$;

-- ── 2) Сворачивание платформы: battle_stance(..., 'off') ─────
create or replace function public.battle_stance(p_battle uuid, p_unit uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
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

  -- СВОРАЧИВАНИЕ ОСАДЫ: единственный режим, который живёт дольше хода, — и
  -- единственный, который можно выключить. Сборка стоит столько же, сколько
  -- раскладка: встал в осаду — считай, разменял два хода на позицию.
  if p_mode = 'off' then
    if u.stance <> 'siege' then
      raise exception 'сворачивать нечего: «%» не в осадном режиме', u.unit_name;
    end if;
    cost := public._bt_siege_cost();
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

  -- ЩИТ: платы за режим нет, в поле уходит весь остаток хода.
  if p_mode = 'shd' then
    if public._bt_terra(b.terrain, u.x, u.y) = 'neb' then
      raise exception 'в туманности защитное поле не держится';
    end if;
    sec := u.tp;
    if sec <= 0 then raise exception '«%» израсходовал ход — секунд на щит не осталось', u.unit_name; end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units
       set stance = 'shd', shield = shield + sec, tp = 0, acted = true
     where id = p_unit;
    perform public._bt_log(p_battle, format('%s уводит мощность в щит: %s c поля (гасит %s урона/с, снимает %s%%)',
      u.unit_name, round(sec,1), round(u.mitig), round(u.reduc*100)));
    return jsonb_build_object('ok', true, 'stance', 'shd', 'shield', round(u.shield + sec, 1), 'tp', 0);
  end if;

  -- ОСАДА: раскладывается только факельщик. Держится до сворачивания.
  if p_mode = 'siege' then
    if not public._bt_can_siege(u.cls) then
      raise exception 'осадный режим — привилегия факельщика: «%» так не раскладывается', u.unit_name;
    end if;
    cost := public._bt_siege_cost();
    if u.tp + 1e-9 < cost then
      raise exception 'на раскладку осадной платформы нужно % c, у «%» осталось % c',
        round(cost,1), u.unit_name, round(u.tp,1);
    end if;
    perform public._bt_use_act(p_battle, p_unit);
    update public.battle_units set stance = 'siege', tp = greatest(0, tp - cost) where id = p_unit;
    perform public._bt_log(p_battle, format('%s раскладывается в осадный режим: урон ×%s, рубеж ×%s — платформа держится, пока её не свернут',
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
end$fn$;
revoke all on function public.battle_stance(uuid,uuid,text) from public;
grant execute on function public.battle_stance(uuid,uuid,text) to authenticated;

-- ПРОВЕРКА ГЛАЗАМИ:
--  1) Раскладка факельщика → следующий ход: stance всё ещё 'siege', tp = tp_max,
--     залп проходит и в журнале «(осадный режим)».
--  2) battle_stance(..., 'off') на нём → «сворачивает осадную платформу», ходить можно.
--  3) battle_stance(..., 'off') на любом другом борте → «сворачивать нечего».
