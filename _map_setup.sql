-- ============================================================
-- КАРТА ГАЛАКТИКИ — схема, RLS и сид (51 система, 2 фракции)
-- Выполнить целиком в Supabase → SQL Editor
-- ============================================================

create table if not exists public.map_factions (
  id text primary key,
  name text not null,
  color text,
  sort int default 0
);
create table if not exists public.map_systems (
  id text primary key,
  name text not null,
  star_type text default 'yellow',
  x numeric not null,
  y numeric not null,
  is_giant boolean default false,
  faction text references public.map_factions(id) on delete set null,
  description text,
  planets jsonb default '[]'::jsonb,
  sort int default 0
);
create table if not exists public.map_hyperlanes (
  id uuid primary key default gen_random_uuid(),
  a_id text references public.map_systems(id) on delete cascade,
  b_id text references public.map_systems(id) on delete cascade
);

alter table public.map_factions   enable row level security;
alter table public.map_systems     enable row level security;
alter table public.map_hyperlanes  enable row level security;

-- RLS: читать всем, писать superadmin/editor
do $$
declare t text;
begin
  foreach t in array array['map_factions','map_systems','map_hyperlanes'] loop
    execute format('drop policy if exists "read" on public.%I', t);
    execute format('drop policy if exists "write" on public.%I', t);
    execute format('create policy "read" on public.%I for select to public using (true)', t);
    execute format('create policy "write" on public.%I for all to authenticated using (public.current_user_role() in (''superadmin'',''editor'')) with check (public.current_user_role() in (''superadmin'',''editor''))', t);
  end loop;
end$$;

-- ── Фракции ──
insert into public.map_factions (id, name, color, sort) values
  ('empire', 'Империя', 'rgba(255, 50, 50, 0.3)', 0),
  ('rebels', 'Повстанцы', 'rgba(50, 150, 255, 0.3)', 1)
on conflict (id) do update set name=excluded.name, color=excluded.color;

-- ── Системы (51) ──
insert into public.map_systems (id, name, star_type, x, y, is_giant, faction, description, planets, sort) values
  ('sys_50', 'Даллерия', 'yellow', 1188, 1091, true, 'empire', 'Сверхмассивная желтая звезда. Сердце региона.', '[]'::jsonb, 0),
  ('sys_00', 'Валас', 'yellow', 1650, 1031, false, 'empire', 'Система, расположенная недалеко от суперзвезды Даллерия. Известна богатой планетой Трасвалакия.', '[{"name":"Трасвалакия","type":"Терра","owner":"Не колонизирована","img":"planets/Terra.png"},{"name":"Кольцо Гелиоса","type":"Пояс астероидов","owner":"Не колонизирована","img":"planets/asteroid.png"},{"name":"Облако Оорта","type":"Турмион","owner":"Не колонизирована","img":"planets/Turmion.png"},{"name":"Ева-IV","type":"Псамора","owner":"Не колонизирована","img":"planets/Psamora.png"}]'::jsonb, 1),
  ('sys_01', 'Вестуза', 'red', 215, 1844, false, 'rebels', 'Окраинный мир. Суровые условия, но богатые залежи руды.', '[]'::jsonb, 2),
  ('sys_02', 'Меркатор', 'blue', 2800, 450, false, 'empire', 'Массивная промышленная зона. Орбита усеяна верфями.', '[]'::jsonb, 3),
  ('sys_03', 'Веридис', 'green', 850, 320, false, null, 'Аномальная зона. Радиация звезды вызывает бурный рост экзофлоры.', '[]'::jsonb, 4),
  ('sys_04', 'Люмина', 'white', 2400, 1600, false, 'rebels', 'Ярчайшая звезда сектора. База ученых и исследователей.', '[]'::jsonb, 5),
  ('sys_05', 'Альтон', 'yellow', 500, 1200, false, 'empire', 'Богатая планетами звёздная система', '[]'::jsonb, 6),
  ('sys_06', 'Инферно', 'red', 3100, 1100, false, null, 'Нестабильный красный гигант. Зона повышенной опасности.', '[]'::jsonb, 7),
  ('sys_07', 'Аквалон', 'blue', 1200, 1850, false, 'rebels', 'Система океанических миров. Крупный поставщик пресной воды.', '[]'::jsonb, 8),
  ('sys_08', 'Тарсонис', 'green', 2000, 250, false, 'empire', 'Военный полигон и секретные исследовательские лаборатории.', '[]'::jsonb, 9),
  ('sys_09', 'Эридан', 'yellow', 1500, 500, false, null, 'Тихая система, облюбованная контрабандистами.', '[]'::jsonb, 10),
  ('sys_10', 'Шер-Маан', 'white', 2900, 1800, false, 'rebels', 'Система, ранее принадлежавшая Королевским Дюнам Шер-Маана.', '[]'::jsonb, 11),
  ('sys_11', 'Кел-Тарис', 'red', 400, 700, false, null, 'Пустынная планета, убежище для наемников.', '[]'::jsonb, 12),
  ('sys_12', 'Альтаир', 'blue', 1000, 800, false, 'empire', 'Важный стратегический форпост.', '[]'::jsonb, 13),
  ('sys_13', 'Сириус', 'white', 1300, 1400, false, 'rebels', 'Богатая система с развитой экономикой.', '[]'::jsonb, 14),
  ('sys_14', 'Вега', 'yellow', 2100, 1400, false, 'empire', 'Аграрный мир, поставляющий провизию флоту.', '[]'::jsonb, 15),
  ('sys_15', 'Проксима-Прайм', 'red', 2600, 900, false, 'rebels', 'Шахтерская колония в астероидном поясе.', '[]'::jsonb, 16),
  ('sys_16', 'Энигма', 'green', 200, 200, false, null, 'Неизведанный сектор, откуда редко возвращаются корабли.', '[]'::jsonb, 17),
  ('sys_17', 'Дайтория', 'yellow', 3100, 300, false, 'empire', 'Закрытый мир для элиты.', '[]'::jsonb, 18),
  ('sys_18', 'Орион', 'blue', 1800, 1800, false, 'rebels', 'Секретные верфи Повстанцев.', '[]'::jsonb, 19),
  ('sys_19', 'Авалон', 'white', 700, 1600, false, null, 'Мир-загадка с руинами неизвестной расы.', '[]'::jsonb, 20),
  ('sys_20', 'Драконис', 'red', 2200, 700, false, 'empire', 'Военно-учебная база, славящаяся жесткой дисциплиной.', '[]'::jsonb, 21),
  ('sys_21', 'Нова', 'blue', 1700, 100, false, null, 'Холодная, покрытая льдами система на самом краю карты.', '[]'::jsonb, 22),
  ('sys_22', 'Гелиос', 'yellow', 2700, 1300, false, 'rebels', 'Огромный город-планета, центр торговли и интриг.', '[]'::jsonb, 23),
  ('sys_23', 'Икар', 'white', 1400, 200, false, 'empire', 'Система с аномально высокой солнечной активностью.', '[]'::jsonb, 24),
  ('sys_24', 'Омега', 'red', 3000, 1500, false, null, 'Глухое место. Здесь не задают лишних вопросов.', '[]'::jsonb, 25),
  ('sys_25', 'Нексус', 'blue', 1800, 1200, false, 'rebels', 'Крупный координационный центр флота.', '[]'::jsonb, 26),
  ('sys_26', 'Аркадия', 'green', 900, 900, false, 'empire', 'Планета-курорт для высшего командования.', '[]'::jsonb, 27),
  ('sys_27', 'Элизиум', 'yellow', 2500, 250, false, 'rebels', 'Мир джунглей, полный смертоносной фауны.', '[]'::jsonb, 28),
  ('sys_28', 'Ригель', 'blue', 300, 1400, false, null, 'Вольный торговый порт на пересечении торговых путей.', '[]'::jsonb, 29),
  ('sys_29', 'Воларис', 'white', 2200, 1800, false, 'empire', 'Тюремная колония строгого режима.', '[]'::jsonb, 30),
  ('sys_30', 'Зион', 'yellow', 1600, 1500, false, 'rebels', 'Скрытая база, глубоко в подземных пещерах.', '[]'::jsonb, 31),
  ('sys_31', 'Астерия', 'red', 600, 400, false, null, 'Кладбище старых кораблей. Рай для мародеров.', '[]'::jsonb, 32),
  ('sys_32', 'Хеликон', 'green', 2800, 800, false, 'empire', 'Научный комплекс по изучению биологического оружия.', '[]'::jsonb, 33),
  ('sys_33', 'Терра Нова', 'blue', 1100, 1500, false, 'rebels', 'Недавно колонизированная система с большими перспективами.', '[]'::jsonb, 34),
  ('sys_34', 'Махаон', 'yellow', 1900, 300, false, null, 'Нейтральная территория, где проводятся подпольные бои.', '[]'::jsonb, 35),
  ('sys_35', 'Септим', 'white', 150, 800, false, 'empire', 'Таможенная застава Империи.', '[]'::jsonb, 36),
  ('sys_36', 'Атум', 'red', 3200, 600, false, 'rebels', 'Система, пережившая масштабную орбитальную бомбардировку.', '[]'::jsonb, 37),
  ('sys_37', 'Каденция', 'blue', 1400, 800, false, null, 'Родина искусных инженеров и механиков.', '[]'::jsonb, 38),
  ('sys_38', 'Сомнус', 'green', 2000, 1100, false, 'empire', 'Мир вечной ночи, окутанный густым туманом.', '[]'::jsonb, 39),
  ('sys_39', 'Иллиум', 'yellow', 2600, 1100, false, 'rebels', 'Процветающий финансовый сектор.', '[]'::jsonb, 40),
  ('sys_40', 'Эребус', 'red', 800, 1900, false, null, 'Зона нестабильных гравитационных полей.', '[]'::jsonb, 41),
  ('sys_41', 'Харон', 'white', 3000, 100, false, 'empire', 'Мрачная система, используемая для ссылки диссидентов.', '[]'::jsonb, 42),
  ('sys_42', 'Калибан', 'blue', 400, 1000, false, 'rebels', 'Оплот сопротивления с тяжелой планетарной обороной.', '[]'::jsonb, 43),
  ('sys_43', 'Сигма', 'yellow', 2100, 1600, false, null, 'Крупный промышленный узел без политической принадлежности.', '[]'::jsonb, 44),
  ('sys_44', 'Тау', 'green', 1700, 600, false, 'empire', 'Центр подготовки шпионов и диверсантов.', '[]'::jsonb, 45),
  ('sys_45', 'Цетус', 'red', 1200, 200, false, 'rebels', 'Ремонтные доки, укрытые внутри газового гиганта.', '[]'::jsonb, 46),
  ('sys_46', 'Лира', 'white', 2300, 500, false, null, 'Система с невероятно красивыми кристаллическими планетами.', '[]'::jsonb, 47),
  ('sys_47', 'Дракон', 'blue', 2700, 1900, false, 'empire', 'Стоянка тяжелых дредноутов.', '[]'::jsonb, 48),
  ('sys_48', 'Феникс', 'yellow', 1000, 1800, false, 'rebels', 'Мир, восстающий из пепла прошлых войн.', '[]'::jsonb, 49),
  ('sys_49', 'Кассиопея', 'green', 150, 1500, false, null, 'Дальняя окраина. Связь здесь ловит очень редко.', '[]'::jsonb, 50)
on conflict (id) do update set name=excluded.name, star_type=excluded.star_type, x=excluded.x, y=excluded.y, is_giant=excluded.is_giant, faction=excluded.faction, description=excluded.description, planets=excluded.planets, sort=excluded.sort;
