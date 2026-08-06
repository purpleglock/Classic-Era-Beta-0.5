-- © 2025–2026. Все права защищены.
-- ════════════════════════════════════════════════════════════
-- ГЛАДИАТОРЫ КЛУБА, рев.2 — ростер под АКТИВНЫЕ МОДУЛИ
-- ────────────────────────────────────────────────────────────
-- ЦЕПОЧКА: ПОСЛЕ _club_gladiators.sql, _bt_modules.sql, _bt_modules2.sql,
--          _bt_weapon_model.sql, _bt_siege_hold.sql. Идемпотентно.
-- ⚠ ПРИМЕНЁН 06.08. Перекатывать ТОЛЬКО вместе с _club_gladiators3.sql следом:
--   §1 пересоздаёт борта с НОВЫМИ id (живая дуэль в forming ссылается на старые)
--   и сбрасывает ценник арены, который ставит файл 3.
--
-- ЗАЧЕМ. Ростер арены собирался ДО активных модулей: у всех восьми
-- гладиаторов `_bt_acts_of` возвращал пустой массив — на арене не нажималась
-- ни одна кнопка. 29 модулей ввели, а единственное место, где в них играют
-- каждый круг, их не видело.
--
-- ЧТО ДЕЛАЕМ:
--   §1  ростер 8 → 16. Старые восемь получают по 1–3 активации (роль та же,
--       имена те же), восемь новых построены ВОКРУГ модулей: осадник,
--       торпедоносец, контролёр, командный баффер, ядерный смертник.
--   §2  пул драфта 6 → 8 разных проектов на сторону (из 16 — половина).
--   §3  бюджет драфта: множитель медианы 5 → 14. Было «1 тяжёлый ИЛИ
--       14 лёгких», стало полноценная эскадра. Потолок бортов на доску
--       (_bt_cap = 50) не трогаем — он и есть настоящий предел.
--
-- ⚠ Модули адресуются ПАРОЙ {g,idx} — порядок групп каталога это якорь
--   (см. modules_order). Индексы ниже сверены с живым _cn_catalog() 05.08:
--   «Конструкционные модули» 7 осада, 8 залп, 9 бортовой, 10 прыжок,
--   11 ярость, 12 дроны, 13 «Голиаф», 14 «Шквал», 15 таран, 16 разрывной,
--   17 иссушитель, 18 «Ломовик», 19 подавитель, 20 усилитель, 21 «Хорал»,
--   22 адские лазеры, 23 ПР-лазеры, 24 стазис, 25 замок, 26 перезапуск,
--   27 беглый огонь, 28 энергогенератор, 29 тяга, 30 ядерная, 31 «Тартар»,
--   32 импульс брони, 33 стазис-боеприпас; «Модули радиотумана» 10 «Вуаль»,
--   11 скремблер. При перегенерации каталога ЭТОТ ФАЙЛ ПЕРЕСВЕРИТЬ.
-- ════════════════════════════════════════════════════════════

-- ── §1. Ростер арены (16 бортов) ────────────────────────────
do $$
declare
  v_fid   text := 'club';
  v_fname text := 'Бойцовский клуб';
  v_fcol  text := '#ff3c82';
  v_K     text := 'Конструкционные модули';
  v_R     text := 'Модули радиотумана';
  v_data  jsonb;
  v_sum   jsonb;
begin
  delete from public.faction_units where faction_id = v_fid and name = any(array[
    'Гладиатор «Мурмиллон»', 'Гладиатор «Димахер»', 'Гладиатор «Секутор»',
    'Гладиатор «Ретиарий»', 'Гладиатор «Провокатор»', 'Гладиатор «Андабат»',
    'Гладиатор «Эквит»', 'Гладиатор «Велит»',
    'Гладиатор «Ланиста»', 'Гладиатор «Гопломах»', 'Гладиатор «Крупеллярий»',
    'Гладиатор «Эсседарий»', 'Гладиатор «Сагиттарий»', 'Гладиатор «Скиссор»',
    'Гладиатор «Ноксий»', 'Гладиатор «Рудиарий»']);

  -- ── Мурмиллон: стена арены. Замок + импульс брони = переживает залп ──
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',3,'armor',3,'shield',4,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',4),     -- КАЗ, ПРО 0.35
      jsonb_build_object('g',v_K,'idx',25),    -- броневой замок
      jsonb_build_object('g',v_K,'idx',32)));  -- импульс брони
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Мурмиллон»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Стена арены: корпус, щит и активная защита против ракет. Теперь ещё и кнопки: «броневой замок» вдвое режет входящий урон на чужой ход, «импульс брони» накрывает тем же −35% всех своих в трёх гексах. Ставится впереди и держит — догнать он всё равно никого не догонит.');

  -- ── Димахер: два клинка. Ярость + беглый огонь = два залпа с бустом ──
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',4,'armor',2,'shield',4,'engine',3,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',11),    -- «Ярость» +60% урона
      jsonb_build_object('g',v_K,'idx',27)));  -- беглый огонь: залп вдвое дешевле
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Димахер»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Лазеры «Плага» на 6 гексов — вдвое дальше пушек. Круг решается одним ходом: «беглый огонь» делает залп вдвое дешевле по секундам, «Ярость» добавляет +60% урона обоим. Платит корпусом и отсутствием ПРО: размен в его пользу, пока по нему не попали.');

  -- ── Секутор: догоняющий. Прыжок в упор + плазменный таран ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',10),    -- «Мгла»: прыжок на 5, бесплатно по секундам
      jsonb_build_object('g',v_K,'idx',15)));  -- плазменный таран сквозь щит
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Секутор»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Ответ на кайт. «Мгла» переносит его на пять гексов не тратя секунд — прямо в лицо стрелку, а плазменный таран проходит СКВОЗЬ щит в корпус. Прыжок, таран, залп рельсотронами — и дальнобойного борта больше нет. Промахнулся прыжком — стоит один посреди чужой эскадры.');

  -- ── Ретиарий: сеть. Тяга подтаскивает, «Буревестник» добивает ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',1,'shield',2,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',3)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',29),    -- тяговый луч: −2 гекса дистанции
      jsonb_build_object('g',v_K,'idx',8)));   -- «Буревестник»: залп на 12
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Ретиарий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Сеть на 30 гексов и свой радар, чтобы наводиться без чужой помощи. Тяговый луч выдёргивает цель из-за укрытия на два гекса к себе, «Буревестник» кладёт сверху отдельный ракетный залп. Всё летящее — ракеты, поэтому чужая ПРО срезает его; догнали — умер.');

  -- ── Провокатор: РЭБ. Слепит радары и глушит чужие кнопки ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_R,'idx',0),     -- глушение 5
      jsonb_build_object('g',v_R,'idx',11),    -- скремблер: −5 сенсоров всем в 3
      jsonb_build_object('g',v_K,'idx',19)));  -- подавитель: цель не жмёт модули
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Провокатор»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Не убивает — отключает. Постоянное глушение обрубает чужое наведение, скремблер сажает сенсоры всем врагам в трёх гексах, а ракета-подавитель на ход лишает выбранный борт ВСЕХ его модулей: ни осады, ни прыжка, ни ремонта. Против эскадры на кнопках стоит дороже любого урона.');

  -- ── Андабат: слепой боец. Вуаль поверх постоянной скрытности ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',1,'shield',1,'engine',4,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',3),     -- транспондер: стелс 3 пассивно
      jsonb_build_object('g',v_R,'idx',10)));  -- «Вуаль»: +8 скрытности на ход
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Андабат»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Стреляет раньше, чем его опознают: ракеты на 30 гексов из-под маскировки. «Вуаль» добавляет +8 к скрытности до своего следующего хода — по непойманному контакту просто не стреляют. Контрится «Эквитом»: сенсор вскрывает поле, а корпуса у «Андабата» на один залп.');

  -- ── Эквит: дозор. Видит всех и разгоняет чужой залп ──
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_R,'idx',5),     -- сенсор 4
      jsonb_build_object('g',v_K,'idx',20)));  -- ракета-усилитель: +75% союзнику
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Эквит»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Глаза отряда за двадцать тысяч: вскрывает маскировку «Андабата» и держит наведение под глушением. Сам почти не бьёт — зато ракетой-усилителем разгоняет орудийный контур союзника на 75% с десяти гексов. Дешёвый корвет, который стреляет чужими пушками.');

  -- ── Велит: рой. Намеренно БЕЗ модулей — цена всему голова ──
  v_data := jsonb_build_object(
    'class','corvette','reactor',0,'armor',1,'shield',1,'engine',2,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',2,'q',3)),
    'modules', '[]'::jsonb);
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Велит»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Самый дешёвый боец арены и единственный без единой кнопки: три «Феникса» на 15 гексов, и всё. Берут его числом — на бюджет эскадры их влезает столько, сколько влезет на доску. Залп ракетный, поэтому одна активная защита обесценивает половину стаи.');

  -- ── Ланиста: командный борт. Хорал + импульс брони + дроны ──
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',4,'armor',3,'shield',3,'engine',2,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',21),    -- «Хорал»: +50% урона себе и союзным в 3
      jsonb_build_object('g',v_K,'idx',32),    -- импульс брони: −35% входящего в 3
      jsonb_build_object('g',v_K,'idx',12)));  -- ремонтные дроны: 2500 корпуса союзнику
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Ланиста»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Хозяин школы: сам дерётся вполсилы, а строй вокруг него бьёт как один корабль. «Хорал» даёт +50% урона всем своим в трёх гексах, импульс брони — −35% входящего им же, ремонтные дроны латают подбитого. Всё это работает только в плотном строю: разбежались — «Ланиста» бесполезен.');

  -- ── Гопломах: торпедоносец. «Голиаф» и «Шквал» ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',3,'engine',3,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',13),    -- «Голиаф»: 9000 по площади на 8
      jsonb_build_object('g',v_K,'idx',14)));  -- «Шквал»: 5600 в упор на 5
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Гопломах»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Копьё арены. Торпеда «Голиаф» выжигает гекс и всё вплотную к нему — включая ваши борта, если подошли близко; «Шквал» добивает в упор. Между пусками — четыре хода перезарядки и посредственные пушки: «Гопломах» опасен ровно дважды за бой, и оба раза надо угадать момент.');

  -- ── Крупеллярий: осадная батарея ──
  v_data := jsonb_build_object(
    'class','mediumCruiser','reactor',4,'armor',3,'shield',3,'engine',1,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',4,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',7),     -- осадная платформа «Кряж»
      jsonb_build_object('g',v_K,'idx',4)));   -- КАЗ, чтобы пережить кайт
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Крупеллярий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Латник, который врос в грунт. Разложил «Кряж» — урон ×2 и рубеж ×1.25, свернул — потерял два хода. Пока платформа стоит, он не двигается вообще: выбрал позицию неправильно — просто зритель. Активная защита прикрывает от ракет, на которые он ответить не успеет.');

  -- ── Эсседарий: контролёр. Тяга, стазис, прыжок ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',2,'engine',4,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',2,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',29),    -- тяговый луч
      jsonb_build_object('g',v_K,'idx',24),    -- стазис-лучи: всем в 2 ход вдвое дороже
      jsonb_build_object('g',v_K,'idx',10)));  -- «Мгла»
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Эсседарий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Колесничий: прыгает в чужой строй, включает стазис — и каждому врагу в двух гексах следующий ход обходится вдвое дороже по секундам. Тяговый луч довешивает: выдёргивает одного к себе и оставляет без хода. Урон средний, смысл не в нём — он забирает у врага сам ход.');

  -- ── Сагиттарий: дебаффер с дистанции ──
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',3,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',18),    -- «Ломовик»: −50% урона цели
      jsonb_build_object('g',v_K,'idx',31)));  -- «Тартар»: стазис+иссушение+глушение шины
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Сагиттарий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Лучник, который почти не наносит урона. «Ломовик» на десяти гексах вполовину срезает залп цели, «Тартар» на двенадцати вешает разом стазис, высаженную энергосеть и глухую шину — выбранный борт следующий ход фактически пропускает. Корвет: заметили — сбили.');

  -- ── Скиссор: свалка. Адские лазеры + разрывной таран ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',3,'engine',4,'radar',1,
    'weapons', jsonb_build_array(jsonb_build_object('g','ЭНЕРГЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',0,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',22),    -- адские лазеры: по всем врагам в 2
      jsonb_build_object('g',v_K,'idx',16),    -- разрывной таран: −30% стойкости
      jsonb_build_object('g',v_K,'idx',28)));  -- энергогенератор: +2 секунды к ходу
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Скиссор»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Оружие того, кого обступили: кольцо адских лазеров бьёт КАЖДОГО врага в двух гексах разом. Разрывной таран сдирает с цели стойкость брони — следующий залп по ней проходит на треть глубже, аварийный генератор докидывает две секунды на всё это. Один против роя стоит дороже, чем один против одного.');

  -- ── Ноксий: смертник с ядерной ракетой ──
  v_data := jsonb_build_object(
    'class','corvette','reactor',2,'armor',1,'shield',1,'engine',3,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','ВЗРЫВНОЕ ВООРУЖЕНИЕ','idx',1,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',30),    -- ядерная ракета: 14000 на 14
      jsonb_build_object('g',v_K,'idx',26)));  -- перезапуск: −2 хода со всех кулдаунов
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Ноксий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Приговорённый. Ядерная ракета летит через полдоски и выжигает гекс со всем, что рядом; кулдаун пять ходов, но «перезапуск снаряжения» снимает с него два — второй пуск реален. Всё остальное у него корветское: одна попавшая по нему очередь, и пусковая не понадобится.');

  -- ── Рудиарий: ветеран. Стазис-боеприпас + беглый огонь + ПР-зонт ──
  v_data := jsonb_build_object(
    'class','destroyer','reactor',4,'armor',2,'shield',3,'engine',3,'radar',2,
    'weapons', jsonb_build_array(jsonb_build_object('g','КИНЕТИЧЕСКОЕ ВООРУЖЕНИЕ','idx',3,'q',2)),
    'modules', jsonb_build_array(
      jsonb_build_object('g',v_K,'idx',33),    -- стазис-боеприпас: каждый залп сажает в стазис
      jsonb_build_object('g',v_K,'idx',27),    -- беглый огонь
      jsonb_build_object('g',v_K,'idx',23)));  -- ПР-лазеры: +30% перехвата себе и соседям
  v_sum := public._cn_recompute('ship', v_data);
  insert into public.faction_units (category,name,faction_id,faction_name,faction_color,owner_id,summary,data,card_text)
  values ('ship','Гладиатор «Рудиарий»', v_fid, v_fname, v_fcol, null, v_sum, v_data,
    'Отпущенный на волю и вернувшийся сам. Заряжает стазис-боеприпас — и КАЖДЫЙ его залп сажает цель в вязкое поле; «беглый огонь» делает этих залпов два за ход. Противоракетные лазеры поднимают зонт над ним и соседями: в ракетной свалке рядом с ним стоять безопаснее всего.');
end $$;

-- ── §2. Пул драфта: 8 разных проектов на сторону ────────────
-- Ростер вырос вдвое, а видели по-прежнему шесть — половина ролей просто не
-- доезжала до стола. Восемь из шестнадцати: выбор есть, зеркала нет.
create or replace function public._fc_pool_designs()
returns int language sql immutable as $$ select 8 $$;

-- ── §3. Бюджет драфта ───────────────────────────────────────
-- Было 5 × медиана ≈ 200k: один тяжёлый борт съедал бюджет целиком, и дуэль
-- сводилась к «кто удачнее выбрал одного». Стало 14 × медиана — на доску
-- выходит эскадра, а кап бортов (_bt_cap = 50) наконец начинает что-то значить.
create or replace function public._fc_pool_mult()
returns numeric language sql immutable as $$ select 14::numeric $$;
