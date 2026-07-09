# Арт «Управления колониями» (новелла)

Файлы кладутся в эту папку (заливка батником). Пока файла нет — клиент мягко
откатывается на градиент класса планеты / эмодзи-иконку здания.

## Фоны планет (сцена + миниатюра карточки)
Формат: webp, горизонтальный пейзаж поверхности, ~1600×900.

- `bg_<look>.webp` — фон по классу планеты. Классы (те же, что текстуры карты):
  `bg_gas.webp`, `bg_ocean.webp`, `bg_ice.webp`, `bg_lava.webp`, `bg_terran.webp`, `bg_rock.webp`
- `bg_p<pid>.webp` — персональный фон конкретной планеты по её pid
  (перекрывает классовый), напр. `bg_p1042.webp`.

## Спрайты зданий
Формат: webp с прозрачностью, ~400×300, здание по центру (рисуется на «участке»).

`bld_<btype>.webp`, где btype — ключ EC_BUILD:
`bld_factory.webp`, `bld_mining.webp`, `bld_goodsfab.webp`, `bld_trade.webp`,
`bld_market.webp`, `bld_science.webp`, `bld_training.webp`, `bld_intel.webp`,
`bld_military_factory.webp`, `bld_shipyard.webp`, `bld_warehouse.webp`,
`bld_temple.webp`, `bld_doomgun.webp`, `bld_starbase.webp`, `bld_flak.webp`,
`bld_abm.webp`
