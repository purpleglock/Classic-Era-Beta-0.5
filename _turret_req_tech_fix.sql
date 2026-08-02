-- ═══════════════════════════════════════════════════════════════
-- СВОИ ОРУДИЯ НЕ ТРЕБУЮТ ИССЛЕДОВАНИЯ (оружейная верфь)
-- ═══════════════════════════════════════════════════════════════
-- Орудие верфи уже оплачено наукой при ковке (turret_upsert списывает ОН),
-- и узла в tech_nodes у группы «⚙ Свои орудия» нет. Но _cn_req_tech строил
-- ключ 'wpn.<cat>.⚙ Свои орудия' наравне с каталожными группами → публикация
-- корабля со своим орудием падала с 'research locked: wpn.ship.⚙ Свои орудия'.
-- Клиентское зеркало (cnUnitReqTech) эту группу пропускало уже давно.
-- Второй признак — turretId в записи оружия: он едет рядом с {g,idx} и не
-- зависит от локализации имени группы.
-- Порядок: после _unit_publish.sql / _turret_forge_units.sql.

create or replace function public._cn_req_tech(p_cat text, p_data jsonb)
returns text[] language plpgsql immutable as $$
declare
  cab jsonb := public._cn_catalog();
  base_cls jsonb; base_wpn jsonb; keys text[] := '{}';
  k text; w jsonb; m jsonb; h jsonb;
begin
  if p_cat = 'division' then return '{}'; end if;
  base_cls := cab->'base'->'classes'->p_cat;
  base_wpn := cab->'base'->'weapons'->p_cat;
  k := p_data->>'class';
  if k is not null and not (base_cls ? k) then keys := array_append(keys, 'cls.'||p_cat||'.'||k); end if;
  if k is not null and coalesce((p_data->>'type')::int,0) >= 1 then keys := array_append(keys, 'type.'||p_cat||'.'||k); end if;
  for w in select * from jsonb_array_elements(coalesce(p_data->'weapons','[]'::jsonb)) loop
    if (w->>'g') is not null
       and (w->>'turretId') is null
       and (w->>'g') <> '⚙ Свои орудия'
       and not (base_wpn ? (w->>'g'))
    then keys := array_append(keys, 'wpn.'||p_cat||'.'||(w->>'g')); end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_data->'modules','[]'::jsonb)) loop
    if (m->>'g') is not null then keys := array_append(keys, 'mod.'||p_cat||'.'||(m->>'g')); end if;
  end loop;
  if jsonb_array_length(coalesce(p_data->'hangars','[]'::jsonb)) > 0 then
    keys := array_append(keys, 'hangar.ship');
    for h in select * from jsonb_array_elements(p_data->'hangars') loop
      if (h->>'id')::int in (1,2) then keys := array_append(keys, 'hangar.ship.heavy'); end if;
    end loop;
  end if;
  return (select array_agg(distinct e) from unnest(keys) e);
end$$;
