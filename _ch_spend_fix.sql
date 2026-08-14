-- Вложение очка в характеристику не доезжало до базы.
-- jsonb_set(create_missing) достраивает только ПОСЛЕДНИЙ ключ пути: если
-- extra->'spent' ещё нет, путь ['spent',stat] невалиден и функция молча
-- возвращает исходный json. Отсюда «очко вложено» без единого изменения.
-- Лечим слиянием: гарантируем объект 'spent' перед записью.
create or replace function public.ch_spend(p_stat text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ch public.characters; m public.faction_members; cur int;
begin
  if auth.uid() is null then raise exception 'не авторизован'; end if;
  if p_stat not in ('str','dex','con','int','wis','cha') then raise exception 'нет такой характеристики'; end if;
  m  := public._fm_my_row();
  ch := public._ch_of_user(auth.uid(), m.char_slug);
  if ch.slug is null then raise exception 'нет действующего персонажа'; end if;
  if public._ch_points(ch) <= 0 then raise exception 'нет свободных очков: они даются за уровень'; end if;
  cur := public._ch_stat(ch, p_stat);
  if cur >= 20 then raise exception 'характеристика уже на потолке (20)'; end if;

  update public.characters
     set extra = jsonb_set(
                   coalesce(extra,'{}'::jsonb) || jsonb_build_object('spent',
                     coalesce(extra->'spent', '{}'::jsonb)),
                   array['spent', p_stat],
                   to_jsonb(coalesce((extra->'spent'->>p_stat)::int, 0) + 1), true),
         updated_at = now()
   where slug = ch.slug;
  if not found then raise exception 'персонаж не найден'; end if;
  return public.ch_office();
end$$;

grant execute on function public.ch_spend(text) to authenticated;
