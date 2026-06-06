-- ============================================================
-- АВТО-СЛУХИ О ТАЙНЫХ ОПЕРАЦИЯХ — через ТРИГГЕР (надёжно, мало кода)
--
-- Не трогает большую _spy_resolve. Триггер сам ловит момент, когда операция
-- становится 'done', и постит анонимный слух в Вестник — только для ДЕЙСТВИЙ
-- (кража/саботаж/дестабилизация/кража тех), разведку игнорирует.
-- Слух не может сломать резолв операции (обёрнут в exception-guard).
--
-- Выполнить в Supabase → SQL Editor ОДИН РАЗ. Идемпотентно.
-- ============================================================

-- 1) Функция-постер слуха (жертва + место, исполнитель в тайне)
drop function if exists public._post_covert_rumor(text);
create or replace function public._post_covert_rumor(p_op text, p_target_fid text default null)
returns void language plpgsql security definer set search_path=public as $$
declare titles text[]; bodies text[]; t text; b text; v_target text; v_place text;
begin
  if p_op not in ('steal_gc','sabotage','destabilize','steal_tech') then return; end if;
  begin v_target := coalesce(nullif(public._fac_name(p_target_fid),''), 'одной из фракций');
  exception when others then v_target := 'одной из фракций'; end;
  begin select 'системы ' || name into v_place from public.map_systems where faction = p_target_fid order by random() limit 1;
  exception when others then v_place := null; end;
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
  delete from public.faction_news
    where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
      and id not in (select id from public.faction_news
        where owner_id is null and faction_name = '⚠ СЕКТОРНЫЕ СЛУХИ'
        order by created_at desc limit 15);
end$$;

-- 2) Триггер-обёртка: ловит переход операции в 'done' и постит слух (безопасно)
create or replace function public._covert_rumor_after()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if NEW.status = 'done' and (OLD.status is distinct from 'done')
     and NEW.op in ('steal_gc','sabotage','destabilize','steal_tech') then
    begin
      perform public._post_covert_rumor(NEW.op, NEW.target_fid);
    exception when others then null;   -- слух НИКОГДА не ломает резолв операции
    end;
  end if;
  return NEW;
end$$;

-- 3) Сам триггер на таблице операций
drop trigger if exists trg_covert_rumor on public.spy_missions;
create trigger trg_covert_rumor
  after update on public.spy_missions
  for each row execute function public._covert_rumor_after();
