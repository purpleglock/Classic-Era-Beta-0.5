-- Проект с нулевым корпусом публиковался молча, а потом ИСЧЕЗАЛ из резерва:
-- battle_pool отбирает борта по `summary.hp > 0`. Корпус в KV-модели = целиком
-- броня, поэтому «Нет брони» даёт hp 0 — и корабль нельзя ни выставить, ни
-- вызвать подкреплением, без единого слова почему. Ставим заслон на публикации.
do $patch$
declare src text; anchor text; ins text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'economy_publish_unit';
  if src is null then raise exception 'нет функции economy_publish_unit'; end if;

  -- если патч уже стоял (в т.ч. в старой, слишком широкой редакции) — вырезаем
  -- его и накладываем заново: гейт касается ТОЛЬКО кораблей. У наземки и авиации
  -- (в т.ч. у стоковых записей) hp в summary честно нулевой — их гейтить нельзя.
  src := regexp_replace(src,
    '\n\n  -- нулевой корпус[\s\S]*?\n  end if;', '', 'g');

  anchor := '  v_sum := public._cn_recompute(p_category, p_data);';
  if position(anchor in src) = 0 then raise exception 'не нашёл якорь _cn_recompute'; end if;

  ins := anchor || '

  -- нулевой корпус: борт не попадёт в резерв боя (battle_pool отбирает hp > 0)
  if p_category = ''ship'' and coalesce((v_sum->>''hp'')::numeric, 0) <= 0 then
    raise exception ''нулевой корпус: без брони кораблю нечем держать удар — поставьте бронирование, иначе борт не выйдет на доску боя'';
  end if;';

  src := replace(src, anchor, ins);
  execute src;
end$patch$;
