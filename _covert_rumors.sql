-- ============================================================
-- АВТО-СЛУХИ О ТАЙНЫХ ОПЕРАЦИЯХ В ВЕСТНИК (в стиле телеги)
--
-- При завершении тайной операции-ДЕЙСТВИЯ (кража казны / саботаж /
-- дестабилизация / кража технологий) в ленту новостей автоматически
-- постится анонимный «слух» по шаблону — без конкретики, со слов очевидцев.
-- РАЗВЕДКУ (recon_*) НЕ публикуем.
--
-- Требует: faction_news, spy_missions, _fac_name (см. _economy_setup.sql).
-- Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
-- ============================================================

-- ── Постинг анонимного слуха по типу операции ──
-- Сносим старую одно-аргументную версию, чтобы не было неоднозначности вызова.
drop function if exists public._post_covert_rumor(text, text);
create or replace function public._post_covert_rumor(p_op text, p_target_fid text default null)
returns void language plpgsql security definer set search_path=public as $$
declare titles text[]; bodies text[]; t text; b text; v_target text; v_place text;
begin
  if p_op not in ('steal_gc','sabotage','destabilize','steal_tech') then return; end if;
  -- кто пострадал (жертва) и где — для «со слов очевидцев». Исполнитель остаётся в тайне.
  v_target := coalesce(nullif(public._fac_name(p_target_fid),''), 'одной из фракций');
  select 'системы ' || name into v_place from public.map_systems where faction = p_target_fid order by random() limit 1;
  v_place := coalesce(v_place, 'одного из секторов');
  case p_op
    when 'steal_gc' then
      titles := array['Ограбление казны в районе '||v_place, 'Дерзкая кража у фракции '||v_target, 'Пропали средства из конвоя'];
      bodies := array[
        format('Очевидцы в районе %s сообщают: ночью неизвестные вскрыли казначейский конвой %s и растворились в темноте. Официальные лица хранят молчание.', v_place, v_target),
        format('По слухам, со счетов %s исчезла крупная сумма. Свидетели в районе %s говорят о людях в форме без опознавательных знаков.', v_target, v_place),
        format('Поговаривают, что казна %s заметно похудела за одну ночь где-то в районе %s. Подробностей нет — только шёпот в портовых барах.', v_target, v_place)];
    when 'sabotage' then
      titles := array['Взрыв на объекте '||v_target, 'Диверсия в районе '||v_place, 'Ночью что-то рвануло'];
      bodies := array[
        format('Свидетели в районе %s сообщают о вспышке и густом дыме над одним из объектов %s. Власти говорят об «аварии», но очевидцы уверены — это диверсия.', v_place, v_target),
        format('По неподтверждённым данным, на заводе %s вышло из строя оборудование при крайне странных обстоятельствах. Кто-то явно постарался.', v_target),
        format('Местные в районе %s шепчутся: ночью громыхнуло так, что дрожали стёкла. У %s официально «ничего не происходило».', v_place, v_target)];
    when 'destabilize' then
      titles := array['Волнения у фракции '||v_target, 'Кто-то раскачивает '||v_place, 'Саботаж поставок'];
      bodies := array[
        format('Источники докладывают о перебоях со снабжением и нарастающем недовольстве в районе %s, на территории %s. Поговаривают о чужой руке.', v_place, v_target),
        format('Очевидцы рассказывают о странных сбоях и хаосе в делах %s. Совпадение? Вряд ли.', v_target),
        format('По слухам, кто-то методично расшатывает порядок у %s в районе %s. Доказательств, как обычно, нет.', v_target, v_place)];
    when 'steal_tech' then
      titles := array['Утечка разработок у '||v_target, 'Похищены чертежи в районе '||v_place, 'Шпионский след в НИИ'];
      bodies := array[
        format('Ходят слухи об утечке закрытых технологий из института %s в районе %s. Очевидцы видели спешно покидавший комплекс корабль без маркировки.', v_target, v_place),
        format('По неподтверждённым данным, секретные наработки %s внезапно «всплыли» у конкурентов. Совпадения исключены.', v_target),
        format('Поговаривают, что из-под носа охраны %s в районе %s вынесли нечто очень ценное. Кто именно — молчат все.', v_target, v_place)];
    else return;
  end case;
  t := titles[1 + floor(random()*array_length(titles,1))::int];
  b := bodies[1 + floor(random()*array_length(bodies,1))::int];
  insert into public.faction_news(faction_id, faction_name, faction_color, owner_id, owner_email,
      title, excerpt, body, status, published_at, created_at, updated_at)
    values (null, '⚠ СЕКТОРНЫЕ СЛУХИ', 'rgba(150,160,180,0.55)', null, null,
      t, null, b, 'approved', now(), now(), now());
  -- держим не более 15 слухов в ленте
  delete from public.faction_news
    where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
      and id not in (select id from public.faction_news
        where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
        order by created_at desc limit 15);
end$$;
revoke all on function public._post_covert_rumor(text, text) from public;

-- ── Резолвер операций с вызовом слуха (полная версия) ──
create or replace function public._spy_resolve(p_fid text)
returns void language plpgsql security definer set search_path=public as $$
declare m public.spy_missions; ok boolean; caught boolean; res jsonb; steal numeric; bid uuid; bt text;
  techs jsonb; node text; tgt public.faction_economy;
begin
  for m in select * from public.spy_missions where actor_fid=p_fid and status='active' and ready_at<=now() loop
    ok := (random()*100) < m.success_pct;
    caught := (random()*100) < m.detect_pct;
    res := '{}'::jsonb;
    select * into tgt from public.faction_economy where faction_id=m.target_fid;

    if ok then
      if m.op in ('recon_basic','recon_deep') then
        res := jsonb_build_object('gc',tgt.gc,'science',tgt.science,'agents',tgt.agents,
          'colonies',(select count(*) from public.colonies where faction_id=m.target_fid),
          'buildings',(select count(*) from public.colony_buildings where faction_id=m.target_fid));
        if m.op='recon_deep' then res := res || jsonb_build_object(
          'units',(select coalesce(sum(qty),0) from public.unit_production where faction_id=m.target_fid and status='done'),
          'research',(select coalesce(jsonb_array_length(research),0) from public.faction_economy where faction_id=m.target_fid)); end if;
      elsif m.op='steal_gc' then
        steal := round(coalesce(tgt.gc,0) * least(0.30, 0.06*m.agents));
        update public.faction_economy set gc=greatest(0,gc-steal) where faction_id=m.target_fid;
        update public.faction_economy set gc=gc+steal where faction_id=m.actor_fid;
        res := jsonb_build_object('gc',steal);
      elsif m.op='sabotage' then
        select id,btype into bid,bt from public.colony_buildings where faction_id=m.target_fid order by random() limit 1;
        if bid is not null then delete from public.colony_buildings where id=bid; res := jsonb_build_object('building',bt);
        else res := jsonb_build_object('building',null); end if;
      elsif m.op='steal_tech' then
        select research into techs from public.faction_economy where faction_id=m.target_fid;
        node := (select value::text from jsonb_array_elements_text(coalesce(techs,'[]'::jsonb)) value
                 where value::text not in (select jsonb_array_elements_text(coalesce(research,'[]'::jsonb)) from public.faction_economy where faction_id=m.actor_fid)
                 order by random() limit 1);
        if node is not null then
          update public.faction_economy set research = coalesce(research,'[]'::jsonb) || to_jsonb(node) where faction_id=m.actor_fid;
          res := jsonb_build_object('tech',node,'tech_name',node);
        else ok := false; res := jsonb_build_object('note','no tech to steal'); end if;
      elsif m.op='destabilize' then
        update public.faction_economy set debuff_pct=0.25, debuff_until=now()+interval '3 days' where faction_id=m.target_fid;
        res := jsonb_build_object('debuff_pct',0.25,'turns',3);
      end if;
    end if;

    update public.faction_economy set agents = agents + m.agents - (case when caught then 1 else 0 end)
      where faction_id=m.actor_fid;
    if caught then res := res || jsonb_build_object('caught',true,'actor_name',public._fac_name(m.actor_fid)); end if;

    update public.spy_missions
      set status='done', outcome=(case when ok then 'success' else 'fail' end), detected=caught, result=res
      where id=m.id;

    -- авто-слух в Вестник о тайной операции-ДЕЙСТВИИ (жертва+место, исполнитель в тайне); разведку не публикуем
    perform public._post_covert_rumor(m.op, m.target_fid);
  end loop;
end$$;
