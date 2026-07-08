# Картинки компонентов конструктора

Формат: **WebP**. Папка: `assets/constructors/`.
Если файла нет — на его месте полосатая заглушка, вёрстка не ломается.
Рекомендуемый размер карточек ~ 480×300 (16:10), hero корпуса ~ 1000×400.

Готово пока для **кораблей** (наземка / авиация / дивизии — позже, по этому же шаблону).

Всего файлов: **137**

---

## Оформление корабля НА СХЕМЕ (все файлы опциональны)
Эти слои накладываются прямо на корабль в чертеже (обрезаются по силуэту).
Арт кладётся ГОРИЗОНТАЛЬНО, носом вправо. Фолбэк: сначала ищется файл с номером,
потом общий для класса. Классы: corvette / frigate / destroyer / cruiser / battleship / dreadnought.

**Текстура брони** — обшивка поверх корпуса (плиты, клёпка, керамика), меняется с выбранной бронёй:
- `ship_armortex_<класс>_<номер брони>.webp` — под конкретную броню (номер = порядок в списке брони, с 0)
- `ship_armortex_<класс>.webp` — общая для класса (если своей нет)

**Текстура щита** — энергоузор внутри купола щита (гексы, разводы, интерференция), светится поверх поля:
- `ship_shieldtex_<класс>_<номер щита>.webp` — под конкретный щит (0 Дефлекторный, 1 Энергетический, 2 Корпускулярный)
- `ship_shieldtex_<класс>.webp` — общая для класса

**Декор** — эмблемы, полосы, тактические надписи; рисуется ПОВЕРХ корпуса.
Нужен ПРОЗРАЧНЫЙ фон (webp/png с альфой), иначе закроет корабль целиком:
- `ship_decor_<класс>_<номер подкласса>.webp` — под конкретную специализацию
- `ship_decor_<класс>.webp` — общий для класса

## Корпуса (hero + иконка в каталоге) — 6
- `ship_class_corvette.webp` — Корвет
- `ship_class_frigate.webp` — Фрегат
- `ship_class_destroyer.webp` — Эсминец
- `ship_class_cruiser.webp` — Крейсер
- `ship_class_battleship.webp` — Линейный корабль
- `ship_class_dreadnought.webp` — Дредноут

## Специализации (типы корпуса) — 16
- `ship_type_corvette_0.webp` — Быстрый корвет
- `ship_type_corvette_1.webp` — Эскадренный корвет
- `ship_type_corvette_2.webp` — Сторожевой корвет
- `ship_type_frigate_0.webp` — Рейдерский фрегат
- `ship_type_frigate_1.webp` — Сторожевой корабль
- `ship_type_frigate_2.webp` — Тяжёлый фрегат
- `ship_type_destroyer_0.webp` — Сторожевой эсминец
- `ship_type_destroyer_1.webp` — Ракетный эсминец
- `ship_type_cruiser_0.webp` — Лёгкий крейсер
- `ship_type_cruiser_1.webp` — Рейдерский крейсер
- `ship_type_cruiser_2.webp` — Артиллерийский крейсер
- `ship_type_cruiser_3.webp` — Линейный крейсер
- `ship_type_battleship_0.webp` — Артиллерийский корабль
- `ship_type_battleship_1.webp` — Тяжелый линейный корабль
- `ship_type_dreadnought_0.webp` — Артиллерийский дредноут
- `ship_type_dreadnought_1.webp` — Броненосный дредноут

## Реакторы — 24
- `ship_reactor_corvette_0.webp` — ТГУ-25А
- `ship_reactor_corvette_1.webp` — СИГУ-27Б
- `ship_reactor_corvette_2.webp` — ПЛГУ-28В
- `ship_reactor_corvette_3.webp` — РНГУ-30Г
- `ship_reactor_frigate_0.webp` — ТГУ-30А
- `ship_reactor_frigate_1.webp` — СИГУ-33Б
- `ship_reactor_frigate_2.webp` — ПЛГУ-37В
- `ship_reactor_frigate_3.webp` — РНГУ-45Г
- `ship_reactor_destroyer_0.webp` — ТГУ-40А
- `ship_reactor_destroyer_1.webp` — СИГУ-42Б
- `ship_reactor_destroyer_2.webp` — ПЛГУ-44В
- `ship_reactor_destroyer_3.webp` — РНГУ-46Г
- `ship_reactor_cruiser_0.webp` — ТГУ-52А
- `ship_reactor_cruiser_1.webp` — СИГУ-55Б
- `ship_reactor_cruiser_2.webp` — ПЛГУ-58В
- `ship_reactor_cruiser_3.webp` — РНГУ-51Г
- `ship_reactor_battleship_0.webp` — ТГУ-65А
- `ship_reactor_battleship_1.webp` — СИГУ-68Б
- `ship_reactor_battleship_2.webp` — ПЛГУ-72В
- `ship_reactor_battleship_3.webp` — РНГУ-75Г
- `ship_reactor_dreadnought_0.webp` — ТГУ-88А
- `ship_reactor_dreadnought_1.webp` — СИГУ-92Б
- `ship_reactor_dreadnought_2.webp` — ПЛГУ-95В
- `ship_reactor_dreadnought_3.webp` — РНГУ-101Г

## Щиты — 18 (везде: 0 Дефлекторный, 1 Энергетический, 2 Корпускулярный)
- `ship_shield_corvette_0.webp` / `ship_shield_corvette_1.webp` / `ship_shield_corvette_2.webp`
- `ship_shield_frigate_0.webp` / `ship_shield_frigate_1.webp` / `ship_shield_frigate_2.webp`
- `ship_shield_destroyer_0.webp` / `ship_shield_destroyer_1.webp` / `ship_shield_destroyer_2.webp`
- `ship_shield_cruiser_0.webp` / `ship_shield_cruiser_1.webp` / `ship_shield_cruiser_2.webp`
- `ship_shield_battleship_0.webp` / `ship_shield_battleship_1.webp` / `ship_shield_battleship_2.webp`
- `ship_shield_dreadnought_0.webp` / `ship_shield_dreadnought_1.webp` / `ship_shield_dreadnought_2.webp`

## Броня — 13
- `ship_armor_corvette_0.webp` — Эскортная
- `ship_armor_corvette_1.webp` — Навесная экранированная
- `ship_armor_frigate_0.webp` — Сторожевая
- `ship_armor_frigate_1.webp` — Тяжёлая фрегатная
- `ship_armor_destroyer_0.webp` — Эскортная миноносная
- `ship_armor_destroyer_1.webp` — Рейдерская
- `ship_armor_destroyer_2.webp` — Тяжёлая навесная
- `ship_armor_cruiser_0.webp` — Облегчённая крейсерская
- `ship_armor_cruiser_1.webp` — Экранированная система бронирования
- `ship_armor_battleship_0.webp` — Линейная броня
- `ship_armor_battleship_1.webp` — Многоуровневая экранированная броня
- `ship_armor_dreadnought_0.webp` — Дредноутовская
- `ship_armor_dreadnought_1.webp` — Тяжёлая навесная броня

## Двигатели — 12
- `ship_engine_corvette_0.webp` — 4 ионных турбореактивных двигателя
- `ship_engine_corvette_1.webp` — 2 плазменных скоростных двигателя
- `ship_engine_frigate_0.webp` — 3 ионных реактивных двигателя
- `ship_engine_frigate_1.webp` — 1 плазменный маршевый двигатель
- `ship_engine_destroyer_0.webp` — 2 электро-химических реактивных двигателя
- `ship_engine_destroyer_1.webp` — 4 ионных маршевых двигателя
- `ship_engine_cruiser_0.webp` — 3 ионных маршевых двигателя
- `ship_engine_cruiser_1.webp` — 3 плазменных маршевых двигателей
- `ship_engine_battleship_0.webp` — 6 ионных маршевых двигателей
- `ship_engine_battleship_1.webp` — 4 плазменных маршевых двигателя
- `ship_engine_dreadnought_0.webp` — 6 ионных маршевых двигателей
- `ship_engine_dreadnought_1.webp` — 4 плазменных маршевых двигателей

## Вооружение — 21
**Лёгкие (light)**
- `ship_weapon_light_0.webp` — 40-мм сдвоенное баллистическое орудие
- `ship_weapon_light_1.webp` — 60-мм одиночное баллистическое орудие
- `ship_weapon_light_2.webp` — лёгкое одиночное лазерное импульсное орудие
- `ship_weapon_light_3.webp` — лёгкое одиночное электромагнитное орудие

**Средние (medium)**
- `ship_weapon_medium_0.webp` — 100-мм рельсовый ускоритель масс
- `ship_weapon_medium_1.webp` — 120-мм двойное баллистическое орудие
- `ship_weapon_medium_2.webp` — сдвоенное турболазерное орудие
- `ship_weapon_medium_3.webp` — одиночное электромагнитное орудие

**Тяжёлые (heavy)**
- `ship_weapon_heavy_0.webp` — 240-мм рельсовый ускоритель масс
- `ship_weapon_heavy_1.webp` — 300-мм тройное баллистическое орудие
- `ship_weapon_heavy_2.webp` — четырехствольное мегалазерное орудие
- `ship_weapon_heavy_3.webp` — тяжелое одиночное импульсное орудие

**Сверхтяжёлые (superheavy)**
- `ship_weapon_superheavy_0.webp` — 380-мм рельсовый ускоритель масс
- `ship_weapon_superheavy_1.webp` — 400-мм сдвоенное баллистическое орудие
- `ship_weapon_superheavy_2.webp` — четырехствольное ланцетное орудие

**Ракетное (missile)**
- `ship_weapon_missile_0.webp` — лёгкая шестиствольная пусковая установка
- `ship_weapon_missile_1.webp` — тяжелая четырехствольная пусковая установка
- `ship_weapon_missile_2.webp` — шахта баллистической ракеты

**Зенитное (aa)**
- `ship_weapon_aa_0.webp` — сдвоенный лазерный пулемёт
- `ship_weapon_aa_1.webp` — восьмиствольное ПВО орудие
- `ship_weapon_aa_2.webp` — Ракета-перехватчик

## Модули — 18
**Радарное оборудование (radar)**
- `ship_module_radar_0.webp` — Система общей связи
- `ship_module_radar_1.webp` — Локальная связь
- `ship_module_radar_2.webp` — Многоцелевой сканер (+250км)
- `ship_module_radar_3.webp` — Сканер дальнего обнаружения (+500км)
- `ship_module_radar_4.webp` — Гравитационный радар (+250км)
- `ship_module_radar_5.webp` — Тепловой сканер (+250км)

**Радиоэлектронная борьба (ew)**
- `ship_module_ew_0.webp` — Купол СЭБ-57
- `ship_module_ew_1.webp` — Активные помехи
- `ship_module_ew_2.webp` — Усилитель подавления
- `ship_module_ew_3.webp` — Нейтрализатор помех

**Активная защита (activedef)**
- `ship_module_activedef_0.webp` — Оптико-электронные станции
- `ship_module_activedef_1.webp` — Комплект теплового подавления
- `ship_module_activedef_2.webp` — Дроны-перехватчики

**Управление (control)**
- `ship_module_control_0.webp` — БИУС Флагман
- `ship_module_control_1.webp` — АСУО Терминус
- `ship_module_control_2.webp` — Системный ИИ

**Спец. системы (special)**
- `ship_module_special_0.webp` — Сверхдвигатель Фотон
- `ship_module_special_1.webp` — Варп-двигатель Слобода

## Ангары — 5
- `ship_hangar_0.webp` — Эскортный ангар
- `ship_hangar_1.webp` — Стандартный ангар
- `ship_hangar_2.webp` — Крупный ангар
- `ship_hangar_3.webp` — Транспортный ангар
- `ship_hangar_4.webp` — Грузовой ангар

## Авиагруппы (в ангарах) — 4
- `ship_airunit_0.webp` — 12 истребителей
- `ship_airunit_1.webp` — 12 бомбардировщиков
- `ship_airunit_2.webp` — 12 дронов
- `ship_airunit_3.webp` — 2 транспортника
