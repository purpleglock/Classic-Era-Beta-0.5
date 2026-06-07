-- ════════════════════════════════════════════════════════════════════════
--  МИГРАЦИЯ: Разлом материи (интерактивный регион «другой вселенной»)
--  Спец-фракция 'rift' + кластер «поражённых» систем в свободном углу карты
--  (низ-право, x≈2900–3250 — там пусто). Связи между ними. Мост к основной карте
--  НЕ создаём — проведёшь сам в редакторе (выберешь систему-рубеж).
--  Пока без механик: разлом просто существует и интерактивен (клик → лор).
--
--  Координаты можно подвинуть в редакторе карты, если кластер куда-то налез.
-- ════════════════════════════════════════════════════════════════════════

insert into public.map_factions (id, name, color, sort) values
  ('rift', 'Разлом', 'rgba(150,46,210,0.26)', 99)
on conflict (id) do update set name=excluded.name, color=excluded.color, sort=excluded.sort;

insert into public.map_systems (id, name, star_type, x, y, is_giant, faction, description, planets, sort) values
  ('rift_core','Разлом','white',3060,1720,true,'rift','Разрыв в ткани мироздания. За ним — иная вселенная. Что-то смотрит оттуда в ответ.','[]'::jsonb,900),
  ('rift_1','Бледный Предел','white',2905,1600,false,'rift','Граница, за которой звёзды гаснут. Сигналы отсюда приходят искажёнными.','[]'::jsonb,901),
  ('rift_2','Изнанка','red',3225,1625,false,'rift','Пространство вывернуто наизнанку. Навигация бессмысленна.','[]'::jsonb,902),
  ('rift_3','Немота','blue',2950,1905,false,'rift','Здесь не проходит свет и не слышно эфира. Только давление пустоты.','[]'::jsonb,903),
  ('rift_4','Эхо Пустоты','white',3210,1885,false,'rift','Отражение систем, которых не существует. Или ещё не существует.','[]'::jsonb,904)
on conflict (id) do update set name=excluded.name, star_type=excluded.star_type, x=excluded.x, y=excluded.y,
  is_giant=excluded.is_giant, faction=excluded.faction, description=excluded.description, sort=excluded.sort;

-- внутренние гиперпути разлома (ядро ↔ поражённые системы), без дублей
insert into public.map_hyperlanes (a_id, b_id)
select 'rift_core', s from unnest(array['rift_1','rift_2','rift_3','rift_4']) s
where not exists (
  select 1 from public.map_hyperlanes h
  where (h.a_id='rift_core' and h.b_id=s) or (h.a_id=s and h.b_id='rift_core')
);
