// ════════════════════════════════════════════════════════════
// ДОЗВЁЗДНЫЕ · АРТ МИРОВ: раса × эпоха
//
// Один мир выглядит по-разному не «вообще», а по двум осям: КТО там живёт
// (раса из precursor_gen.RACES) и КОГДА мы их застали (фаза из PHASES, E0–E11).
// Поэтому арт лежит сеткой, а не мешком:
//
//   assets/precursor/worlds/<раса>/<E#>_<номер>.webp
//   assets/precursor/worlds/common/<E#>_<номер>.webp   ← для любой расы
//
// Заливает файлы tools/precursor_arts.bat (перетащить на него картинки); он же
// переписывает manifest.json — список того, что реально лежит. Манифест нужен,
// чтобы клиент не гадал вариантами и не собирал 404 при каждом открытии сцены.
//
// Файла нет — возвращается null, и сцена рисует ровный тон. Ничего не ломается
// и заглушка не притворяется артом.
// ════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const ROOT = 'assets/precursor/worlds/';

  // Слаг папки: кириллица в путях ассетов уже подводила на деплое, поэтому
  // папки латиницей, а соответствие держим здесь — одно на весь проект.
  const SLUG = {
    'Гуманоиды':                  'humanoid',
    'Млекопитающие':              'mammal',
    'Рептилоиды':                 'reptiloid',
    'Авианы (Птицеподобные)':     'avian',
    'Инсектоиды':                 'insectoid',
    'Акватики (Водные)':          'aquatic',
    'Плантоиды (Растениевидные)': 'plantoid',
    'Литоиды (Каменные)':         'lithoid',
    'Синтетики / Киборги':        'synth',
    'Энергетические сущности':    'energy',
  };

  // {раса: {E8: ['E8_1.webp', 'E8_2.png']}} — имена, а не счёт: расширения
  // у вариантов бывают разные, и «сколько штук» однажды промахнётся.
  let MAN = null;
  let loading = null;

  function load() {
    if (MAN) return Promise.resolve(MAN);
    if (loading) return loading;
    loading = fetch(ROOT + 'manifest.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}))
      .then(j => { MAN = j || {}; return MAN; });
    return loading;
  }

  const slugOf = race => SLUG[race] || (race ? String(race) : '') || 'common';

  // Вариант выбирается детерминированно от повода (обычно — сид мира плюс id
  // сцены): один и тот же мир не должен менять облик при каждой перерисовке.
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  // Кандидаты по убыванию точности: своя раса → общий арт эпохи.
  function pick(race, phase, seed) {
    if (!MAN || !phase) return null;
    const tries = [slugOf(race), 'common'];
    for (const dir of tries) {
      const files = (MAN[dir] || {})[phase];
      if (files && files.length) {
        const i = hash(String(seed || '') + '|' + dir + '|' + phase) % files.length;
        return ROOT + dir + '/' + files[i];
      }
    }
    return null;
  }

  // Есть ли вообще хоть что-то — чтобы вкладка могла честно сказать «арта нет»
  // вместо того, чтобы молча показывать пустые панели.
  const empty = () => !MAN || !Object.keys(MAN).length;


  // ══════════════════════════════════════════════════════════
  // АРТ КОНКРЕТНОЙ ХРОНИКИ: спрайты говорящих, фоны сцен, дверь
  //
  // Сетка «раса × эпоха» отвечает на «кто и когда» и годится любому миру.
  // Здесь — то, что принадлежит одной хронике: лицо Ниру, кадр её главы,
  // карточка на двери. Ключи придумывает файл хроники (saga_*.js), движок
  // и этот модуль их не знают и знать не должны:
  //
  //   assets/precursor/saga/<мир>/who_<говорящий>.webp
  //   assets/precursor/saga/<мир>/bg_<узел>.webp
  //   assets/precursor/saga/<мир>/door.webp
  //
  // Файла нет — вернётся null, и сцена спокойно уедет на сетку эпох, а потом
  // на ровный тон. Ничего не настраивается кодом: залил файл — он в игре.
  // ══════════════════════════════════════════════════════════
  const SROOT = 'assets/precursor/saga/';
  let SMAN = null, sloading = null;

  function sagaLoad() {
    if (SMAN) return Promise.resolve(SMAN);
    if (sloading) return sloading;
    sloading = fetch(SROOT + 'manifest.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}))
      .then(j => { SMAN = j || {}; return SMAN; });
    return sloading;
  }
  // Перечитать после заливки из админки — иначе новый арт увидят только с F5.
  function sagaReset() { SMAN = null; sloading = null; }

  const sagaCell = w => (SMAN && SMAN[w]) || null;
  function sagaFile(world, kind, key) {
    const c = sagaCell(world);
    const f = c && c[kind] && c[kind][key];
    return f ? SROOT + world + '/' + f : null;
  }
  const who  = (world, key)  => sagaFile(world, 'who', key) || sagaFile('common', 'who', key);
  // Кадр ищется сперва в папке мира, потом в общей: местность у миров разная, а
  // РОД сцены (совет, ночь, вода, дорога) повторяется везде. Один общий набор
  // тегов закрывает все хроники сразу, свой файл мира его перебивает.
  const bg   = (world, node) => node
    ? (sagaFile(world, 'bg', node) || sagaFile('common', 'bg', node)) : null;
  const door = (world) => {
    const c = sagaCell(world);
    return c && c.door ? SROOT + world + '/' + c.door : null;
  };

  window.PcArt = { load, pick, empty, slugOf, SLUG, ROOT,
                   sagaLoad, sagaReset, who, bg, door, SROOT };
})();
