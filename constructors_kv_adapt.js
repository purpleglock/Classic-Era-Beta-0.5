// ════════════════════════════════════════════════════════════
// АДАПТЕР KV → db сайта (синтез конструкторов)
// ────────────────────────────────────────────────────────────
// window.KV (данные Кваквантора) → window.KV_DB = { ship, ground, aviation }
// в форме, которую потребляет constructors.js (cnVehCalc / cnDrawShip / пикеры):
//   data[k]      : класс { name, cost, baseON, modON, hp, ...KV-поля }
//   reactors[k]  : [ { name, cost, energy, ...KV } ]
//   engines[k]   : [ { name, cost, speed, energy, ...KV } ]   (маршевые двигатели KV.modules3)
//   armors[k]    : [ { name, cost, armor, ...KV } ]           (KV.armorElements)
//   shields[k]   : [ { name, cost, shield, energy, ...KV } ]  (KV.modules6)
//   radars[k]    : [ { name, cost, ...KV } ]                  (KV.modules5)
//   weapons[k]   : { group: [ { name, cost, dmg, energy, kind, ...KV } ] }  (per-class!)
//   modules[k]   : { group: [ { name, cost, energy, ...KV } ] }
// Оружие KV — пооклассовые списки имён с заголовками-секциями (=== ... ===),
// тянущие объект из weaponLibrary; здесь разворачиваем в group→[obj] и считаем dmg.
// ════════════════════════════════════════════════════════════
(function () {
  "use strict";
  var K = window.KV;
  if (!K) { console.warn('[KV_DB] window.KV не загружен — constructors_kv.js должен идти раньше'); return; }

  // Разбивка 18 классов KV по трём форжам сайта (по группировке из html-селекта)
  var CAT_CLASSES = {
    ground:   ['peh', 'btr', 'tanki', 'arta'],
    aviation: ['dron', 'aviacia', 'vertihui', 'dronkos', 'mla'],
    ship:     ['corvette', 'destroyer', 'supportCarrier', 'mediumCruiser',
               'hyperCruiser', 'multiroleCarrier', 'battleship', 'dreadnought', 'ss13'],
  };

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // Урон орудия по формуле Кваквантора (calculateResults, блок ВООРУЖЕНИЕ)
  function weaponDmg(w) {
    if (!w || !w.customParameter) return 0;
    var tCoef = (K.techCoefficients[w.tech] != null) ? K.techCoefficients[w.tech] : 1;
    var dCoef = (K.damageTypeCoefficients[w.damageType] != null) ? K.damageTypeCoefficients[w.damageType] : 0;
    var cCoef = (K.classCoefficients[w.class] != null) ? K.classCoefficients[w.class] : 1;
    var kal = num(String(w.customParameter.kal || '0').replace(' мм', '').replace(' кг', ''));
    var rof = num(w.customParameter.skorostrelnost);
    var weight = Math.sqrt(num(w.weight) || 100);
    var rateMod = 1 + (rof / 5000);
    var baseDmg = kal * weight * tCoef * cCoef;
    return Math.round(baseDmg * (1 + dCoef) * rateMod / 50);
  }

  // Тип боеприпаса для ресурсной ведомости сервера/клиента
  function weaponKind(w) {
    var cls = (w.class || '').toLowerCase(), tech = (w.tech || '').toLowerCase();
    if (cls.indexOf('ракет') >= 0 || cls === 'missile' || cls === 'rocket') return 'missile';
    if (tech.indexOf('лазер') >= 0 || tech.indexOf('плазм') >= 0 || tech.indexOf('энерг') >= 0 ||
        tech.indexOf('ион') >= 0 || cls === 'energy') return 'energy';
    return 'kinetic';
  }

  // Отображаемая «скорость» двигателя для SVG-факела/старого превью (реальная = KV-математика позже).
  function engDisplaySpeed(m) {
    if (m.speedBoost) return Math.min(100, Math.round(num(m.speedBoost)));
    var f = num(m.force);
    return f > 0 ? Math.min(90, Math.max(10, Math.round(Math.sqrt(f)))) : 10;
  }

  // Список KV-оружия класса (имена + заголовки === ... ===) → { group: [obj] }
  function buildClassWeapons(names) {
    var groups = {}, cur = 'Основное';
    (names || []).forEach(function (nm) {
      if (typeof nm !== 'string') return;
      var t = nm.trim();
      if (!t || t === 'Нет выбранного вооружения') return;
      var hdr = t.match(/^=+\s*(.+?)\s*=+$/);
      if (hdr) { cur = hdr[1].trim() || cur; return; }
      var w = K.weaponLibrary[nm];
      if (!w) return;
      (groups[cur] || (groups[cur] = [])).push(Object.assign({}, w, {
        name: nm,
        cost: num(w.price),
        energy: num(w.power),
        dmg: weaponDmg(w),
        kind: weaponKind(w),
      }));
    });
    return groups;
  }

  // Модули поддержки KV.modules[k] (плоский массив объектов) → { group: [obj] }
  function buildClassModules(list) {
    var groups = {};
    (list || []).forEach(function (m) {
      if (!m || !m.name || m.name === 'Нет выбранных модулей') return;
      var g = m.category || 'Модули';
      (groups[g] || (groups[g] = [])).push(Object.assign({}, m, {
        cost: num(m.price),
        energy: num(m.power),
      }));
    });
    return groups;
  }

  function buildCat(keys) {
    var data = {}, reactors = {}, engines = {}, armors = {}, shields = {}, radars = {};
    // Оружие/модули — кат-широкие группы (объединение классов, стабильные индексы)
    // + карта доступности по классу: availW[k] = Set("group|idx").
    var weapons = {}, modules = {}, availW = {}, availM = {};
    var wIndex = {}, mIndex = {};
    function unionInto(store, index, groups, avail) {
      for (var g in groups) {
        groups[g].forEach(function (obj) {
          var loc = index[obj.name];
          if (!loc) {
            if (!store[g]) store[g] = [];
            loc = index[obj.name] = { g: g, idx: store[g].length };
            store[g].push(obj);
          }
          avail.add(loc.g + '|' + loc.idx);
        });
      }
    }
    keys.forEach(function (k) {
      var sc = K.shipClasses[k];
      if (!sc) return;
      availW[k] = new Set();
      availM[k] = new Set();
      unionInto(weapons, wIndex, buildClassWeapons(K.weapons[k]), availW[k]);
      unionInto(modules, mIndex, buildClassModules(K.modules[k]), availM[k]);
      // Класс: KV-поля сохраняем целиком (нужны математике), плюс сайтовые псевдонимы
      data[k] = Object.assign({}, sc, {
        name: sc.xxx || k,
        cost: num(sc.price),
        hp: num(sc.hp),
        baseON: Math.max(1, Math.round(num(sc.size) || 1)),
        modON: 0.5,
      });
      // Реакторы (KV.engines) — выработка энергии удвоена (×2): баланс энергосети в
      // cnVehCalc читает reactObj.power, поэтому двоим и .power, и зеркало .energy.
      reactors[k] = (K.engines[k] || []).map(function (e) {
        var pw = num(e.power) * 4;
        return Object.assign({}, e, { cost: num(e.price), power: pw, energy: pw });
      });
      // Маршевые двигатели (KV.modules3) — .speed отображаемая
      engines[k] = (K.modules3[k] || []).map(function (m) {
        return Object.assign({}, m, { cost: num(m.price), energy: num(m.power), speed: engDisplaySpeed(m) });
      });
      // Броня (KV.armorElements) — записи-ссылки {reference} резолвим из materialsDatabase
      // (зеркало resolveReferences из html); .armor = hpBoost.
      armors[k] = (K.armorElements[k] || []).map(function (a) {
        var base = a && a.reference ? (K.materialsDatabase[a.reference] || {}) : a;
        return Object.assign({}, base, { cost: num(base.price), armor: Math.round(num(base.hpBoost)) });
      });
      // Щиты (KV.modules6) — .shield = protectiveField (у KV shieldBoost всегда 0,
      // реальная ёмкость щита лежит в protectiveField).
      shields[k] = (K.modules6[k] || []).map(function (s) {
        return Object.assign({}, s, { cost: num(s.price), energy: num(s.power), shield: Math.round(num(s.protectiveField) || num(s.shieldBoost)) });
      });
      // Радары (KV.modules5)
      radars[k] = (K.modules5[k] || []).map(function (r) {
        return Object.assign({}, r, { cost: num(r.price), energy: num(r.power) });
      });
    });
    return {
      data: data, reactors: reactors, engines: engines, armors: armors,
      shields: shields, radars: radars, weapons: weapons, modules: modules,
      weaponsAvail: availW, modulesAvail: availM,
      hangarTypes: [], airUnits: [],
    };
  }

  window.KV_DB = {
    ship: buildCat(CAT_CLASSES.ship),
    ground: buildCat(CAT_CLASSES.ground),
    aviation: buildCat(CAT_CLASSES.aviation),
    // Единый планетарный форж: пехота + техника + авиация в одном конструкторе.
    // В БД юнит всё равно уходит с категорией ground/aviation (выводится из класса
    // при публикации), поэтому каталоги/исследования/SQL-зеркало не меняются.
    army: buildCat(CAT_CLASSES.ground.concat(CAT_CLASSES.aviation)),
  };
  window.KV_CAT_CLASSES = CAT_CLASSES;
})();
