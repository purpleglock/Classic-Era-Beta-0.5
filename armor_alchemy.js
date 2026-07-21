// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. См. LICENSE.
// ════════════════════════════════════════════════════════════
// ARMOR ALCHEMY — «алхимия брони» (принцип Noita)
// ────────────────────────────────────────────────────────────
// Игрок регистрирует СВОЮ броню, смешивая НАСТОЯЩИЕ ресурсы игры
// (galaxy_gen.js RESOURCES). Статы рождаются из ПРОПОРЦИЙ и ПОРОГОВ
// (реакции/синергии), а НЕ из «чем больше насыпал, тем лучше».
//
// Выход calcAlloy(mix) ложится на уже применённую математику брони:
//   cnKvArmorHp(cls, armorObj) читает armorObj.{material,category,hpBoost,
//   hpPercentBoost,resurs}. Мы формируем ровно эти поля + новые боевые
//   стойкости resist{kinetic,energy,missile}, трейты и предупреждения.
//
// Зеркало движка обязано жить в SQL (_armor_alchemy.sql) — сервер
// пересчитывает статы из РЕЦЕПТА, клиентским цифрам не доверяем.
// ВНИМАНИЕ: любое изменение чисел здесь → синхронно правь SQL-зеркало.
// ════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // ── §1. Профили элементов (ключ = id ресурса из galaxy_gen RESOURCES) ──
  // Поля профиля:
  //   density   — г/см³ (плотность материала)
  //   tensile   — МПа (прочность на разрыв → кинетика/пробитие)
  //   heat      — условная теплостойкость (→ энергозащита)
  //   conduct   — теплопроводность (⚠ ВЫСОКАЯ = дыра под лазер)
  //   hp        — базовый HP на единицу ресурса (до множителя качества)
  //   weight    — вклад в вес (−грузоподъёмность); отрицат. = облегчает
  //   role      — 'struct'|'ceramic'|'binder'|'metal'|'catalyst'|'volatile'|'reactive'|'exotic'
  //   tag       — короткая роль для UI
  const ELEMENTS = {
    // ── COMMON ──
    IRON:      { name:'Железо',        icon:'⚙️', density:7.8, tensile:400,  heat:0.30, conduct:0.55, hp:6,   weight:1.0,  role:'struct',   tag:'Каркас' },
    SILICATE:  { name:'Силикаты',      icon:'🪨', density:2.6, tensile:180,  heat:0.85, conduct:0.10, hp:4,   weight:0.4,  role:'ceramic',  tag:'Керамика' },
    ICEWATER:  { name:'Лёд',           icon:'🧊', density:0.9, tensile:20,   heat:0.20, conduct:0.15, hp:1,   weight:0.2,  role:'volatile', tag:'Хладагент' },
    CARBON:    { name:'Углерод',       icon:'⬛', density:2.0, tensile:900,  heat:0.55, conduct:0.20, hp:5,   weight:-0.2, role:'binder',   tag:'Связка' },
    METHANE:   { name:'Метан',         icon:'💚', density:0.5, tensile:5,    heat:0.05, conduct:0.10, hp:0.4, weight:0.1,  role:'volatile', tag:'Топливо' },
    SULFUR:    { name:'Сера',          icon:'🌑', density:2.0, tensile:60,   heat:0.30, conduct:0.10, hp:1.5, weight:0.3,  role:'binder',   tag:'Вулканизатор' },
    // ── UNCOMMON ──
    COPPER:    { name:'Медь',          icon:'🟤', density:8.9, tensile:220,  heat:0.35, conduct:0.95, hp:4,   weight:1.1,  role:'metal',    tag:'Проводник' },
    TITANIUM:  { name:'Титан',         icon:'🔘', density:4.5, tensile:950,  heat:0.60, conduct:0.15, hp:8,   weight:0.35, role:'struct',   tag:'Лёгкая броня' },
    SULFIDES:  { name:'Ионит',         icon:'🟡', density:3.5, tensile:150,  heat:0.40, conduct:0.30, hp:3,   weight:0.4,  role:'reactive', tag:'Ионный реагент' },
    AMMONIA:   { name:'Аммиачный лёд', icon:'🟣', density:0.8, tensile:15,   heat:0.25, conduct:0.12, hp:1,   weight:0.15, role:'volatile', tag:'Криохладагент' },
    // ── RARE ──
    RAREEARTH: { name:'Редкоземельные',icon:'💡', density:6.5, tensile:300,  heat:0.50, conduct:0.30, hp:5,   weight:0.6,  role:'catalyst', tag:'Катализатор' },
    PLATINUM:  { name:'Платина',       icon:'⬜', density:21.4,tensile:180,  heat:0.75, conduct:0.60, hp:7,   weight:1.6,  role:'metal',    tag:'Плотный щит' },
    URANIUM:   { name:'Изотопы',       icon:'☢️', density:19.0,tensile:400,  heat:0.55, conduct:0.40, hp:9,   weight:1.7,  role:'reactive', tag:'Обеднённый уран' },
    WATER:     { name:'Жидкая вода',   icon:'🌊', density:1.0, tensile:10,   heat:0.30, conduct:0.14, hp:1,   weight:0.2,  role:'volatile', tag:'Охлаждение' },
    ORGANICS:  { name:'Реликт. дерево',icon:'🧬', density:1.3, tensile:500,  heat:0.35, conduct:0.08, hp:4,   weight:-0.1, role:'binder',   tag:'Биоволокно' },
    DEUTERIUM: { name:'Дейтерий',      icon:'⚛️', density:0.6, tensile:5,    heat:0.10, conduct:0.10, hp:0.5, weight:0.1,  role:'reactive', tag:'Реакт. топливо' },
    HELIUM3:   { name:'Гелий-3',       icon:'🫧', density:0.3, tensile:5,    heat:0.15, conduct:0.10, hp:1,   weight:-0.4, role:'volatile', tag:'Лёгкий наполн.' },
    // ── EPIC ──
    THERMFUEL: { name:'Старвис',       icon:'🔥', density:2.5, tensile:100,  heat:0.90, conduct:0.20, hp:6,   weight:0.3,  role:'reactive', tag:'Энергоплазма' },
    DIAMONDS:  { name:'Хтонит',        icon:'💎', density:3.5, tensile:2200, heat:0.95, conduct:0.25, hp:14,  weight:0.5,  role:'ceramic',  tag:'Сверхтв. решётка' },
    EXOCRYST:  { name:'Стелларит',     icon:'🔷', density:4.0, tensile:1200, heat:0.98, conduct:0.05, hp:16,  weight:0.3,  role:'exotic',   tag:'Экзокристалл' },
    // ── LEGENDARY ──
    QUANTUMCRYST:{ name:'Гравиядро',   icon:'🔮', density:9.0, tensile:1500, heat:0.80, conduct:0.10, hp:22,  weight:-2.0, role:'exotic',   tag:'Гравикатализатор' },
    DEGENERATE:{ name:'Рагенод',       icon:'💀', density:40.0,tensile:1800, heat:0.70, conduct:0.30, hp:30,  weight:3.0,  role:'exotic',   tag:'Вырожд. материя' },
    NEUTRONMAT:{ name:'Прогр. материя',icon:'🟢', density:8.0, tensile:1400, heat:0.85, conduct:0.15, hp:24,  weight:0.0,  role:'exotic',   tag:'Адаптивная' },
  };

  // Потолок ввода: сумма единиц рецепта. Пропорции решают, а объём ограничен —
  // нельзя бесконечно набивать HP. Клиент не даёт превысить, движок/сервер дублируют.
  var MAX_UNITS = 100;

  // Утилиты
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function sum(o) { let s = 0; for (const k in o) s += o[k] || 0; return s; }

  // ── §2. Реакции (пороги/пары/синергии) ──────────────────────
  // Каждая реакция читает fractions f{RESID:доля 0..1} + roleFrac r{role:доля}
  // и (если условие) даёт эффект: мультипликаторы/бонусы/трейт/предупреждение.
  // Хардкор: реакции резкие, а «мусорная» смесь наказывается.
  //
  // Возвращаемые эффекты складываются в accumulator acc:
  //   hpMul (×качество HP), tenMul, densMul, heatMul, capAdd (+грузоп.),
  //   kin/en/mis (+стойкости 0..), pctHp (+% HP), traits[], warns[].
  const REACTIONS = [
    // Сталь: Железо+Углерод в балансе (обе доли ≥0.2, близки) → кинетика, гасит вес
    { id:'steel', test:(f)=> f.IRON>=0.2 && f.CARBON>=0.15 && Math.min(f.IRON,f.CARBON*2)>=0.2,
      eff:(acc,f)=>{ const q=Math.min(f.IRON, f.CARBON*3); acc.tenMul+=0.35*q; acc.kin+=0.32*q; acc.capAdd+=6*q; acc.traits.push('Легированная сталь'); } },
    // Титаналь: Титан+Углерод → лёгкая прочная
    { id:'titanal', test:(f)=> f.TITANIUM>=0.2 && f.CARBON>=0.1,
      eff:(acc,f)=>{ const q=Math.min(f.TITANIUM, f.CARBON*4); acc.tenMul+=0.30*q; acc.densMul-=0.10*q; acc.kin+=0.20*q; acc.capAdd+=10*q; acc.traits.push('Титаналь'); } },
    // Керметокомпозит: Силикаты/Хтонит + связка → энергозащита
    { id:'cermet', test:(f)=> (f.SILICATE||0)+(f.DIAMONDS||0)>=0.2 && ((f.CARBON||0)+(f.ORGANICS||0))>=0.08,
      eff:(acc,f)=>{ const q=Math.min((f.SILICATE||0)+(f.DIAMONDS||0), 0.6); acc.heatMul+=0.30*q; acc.en+=0.45*q; acc.traits.push('Керметокомпозит'); } },
    // Экзоматрица: катализатор (Редкозем/Стелларит/Гравиядро) поверх структурной базы → %HP
    { id:'exomatrix', test:(f,r)=> ((f.RAREEARTH||0)+(f.EXOCRYST||0)+(f.QUANTUMCRYST||0))>=0.08 && r.struct+r.ceramic+r.metal>=0.3,
      eff:(acc,f)=>{ const c=(f.RAREEARTH||0)+(f.EXOCRYST||0)*1.6+(f.QUANTUMCRYST||0)*2.2; acc.pctHp+=clamp(c*1.2,0,1.2); acc.traits.push('Экзоматрица'); } },
    // Медь-проводник: высокая доля меди → дыра под лазер (штраф энергозащ)
    { id:'conductor', test:(f)=> (f.COPPER||0)>=0.25,
      eff:(acc,f)=>{ acc.en-=0.30*Math.min(f.COPPER,0.6); acc.warns.push('Токопроводящая: уязвима к лазеру'); } },
    // Обеднённый уран / вырожденная материя: экстремальная плотность → кинетика + пробитие, но вес
    { id:'dense_kin', test:(f)=> (f.URANIUM||0)+(f.DEGENERATE||0)>=0.15,
      eff:(acc,f)=>{ const q=Math.min((f.URANIUM||0)+(f.DEGENERATE||0)*1.5,0.8); acc.kin+=0.50*q; acc.densMul+=0.25*q; acc.capAdd-=14*q; acc.traits.push('Кинетический монолит'); } },
    // Реактивная броня: реактивные (Ионит/Дейтерий/Старвис) + катализатор → защита от ракет, но риск
    { id:'reactive', test:(f,r)=> r.reactive>=0.12 && ((f.RAREEARTH||0)+(f.EXOCRYST||0))>=0.05,
      eff:(acc,f,r)=>{ const q=Math.min(r.reactive,0.6); acc.mis+=0.60*q; acc.traits.push('Динамическая защита'); if((f.THERMFUEL||0)+(f.DEUTERIUM||0)>=0.2) acc.warns.push('Нестабильный заряд: риск детонации'); } },
    // Адаптивная (Прогр. материя): саморемонт + сглаживает все стойкости
    { id:'adaptive', test:(f)=> (f.NEUTRONMAT||0)>=0.05,
      eff:(acc,f)=>{ const q=Math.min(f.NEUTRONMAT*2,0.5); acc.kin+=0.16*q; acc.en+=0.16*q; acc.mis+=0.16*q; acc.pctHp+=0.4*q; acc.traits.push('Саморемонт'); } },
    // Гравиоблегчение: Гравиядро отрицает вес
    { id:'gravlift', test:(f)=> (f.QUANTUMCRYST||0)>=0.03,
      eff:(acc,f)=>{ acc.capAdd+=40*Math.min(f.QUANTUMCRYST*3,1); acc.traits.push('Гравикомпенсация массы'); } },
  ];

  // ── §3. Penalty: чистота и волатильность (ХАРДКОР) ──────────
  function purityPenalty(acc, f) {
    let top = 0, topId = null;
    for (const id in f) if (f[id] > top) { top = f[id]; topId = id; }
    if (top > 0.75) {
      const over = (top - 0.75) / 0.25;         // 0..1
      acc.tenMul -= 0.5 * over;                  // хрупкий монолит
      acc.hpMul  -= 0.35 * over;
      acc.warns.push('Нестабильный монолит: хрупкость от чистоты');
    }
  }
  function volatilePenalty(acc, r, f) {
    // Волатильные (Лёд/Вода/Метан/Аммиак/Гелий/Дейтерий) без углеродной связки = мусор
    const vol = r.volatile || 0;
    const bond = (f.CARBON || 0) + (f.ORGANICS || 0) + (f.SULFUR || 0);
    if (vol > 0.15) {
      const unbound = Math.max(0, vol - bond * 2);
      if (unbound > 0) {
        acc.hpMul  -= 1.1 * Math.min(unbound, 0.7);
        acc.tenMul -= 0.6 * Math.min(unbound, 0.7);
        acc.warns.push('Несвязанные волатильные: рыхлая структура');
      }
      // но связанные волатильные → абляционное охлаждение (энергозащ)
      const bound = Math.min(vol, bond * 2);
      if (bound > 0.05) acc.en += 0.18 * Math.min(bound, 0.5);
    }
    // Самонагрев: реактивное топливо без охлаждения
    const cool = (f.ICEWATER || 0) + (f.WATER || 0) + (f.AMMONIA || 0);
    if ((f.THERMFUEL || 0) + (f.URANIUM || 0) > 0.25 && cool < 0.05)
      acc.warns.push('Перегрев: нужен хладагент (Лёд/Вода)');
  }

  // ── §4. Категория брони (для множителей cnKvArmorHp) ────────
  function pickCategory(r, dens) {
    if (r.ceramic + (r.exotic * 0.5) >= 0.4) return 'ceramic';
    if (dens >= 9)   return 'heavyMetal';
    if (dens <= 3.2) return 'lightMetal';
    if (r.binder >= 0.25) return 'composite';
    return dens >= 6 ? 'heavyMetal' : 'composite';
  }

  // ── §5. ГЛАВНАЯ ФУНКЦИЯ ──────────────────────────────────────
  // mix: { RESID: units }  (единицы реального ресурса)
  // → { ok, totalUnits, material, category, hpBoost, hpPercentBoost,
  //     capacityBoost, resist:{kinetic,energy,missile}, traits, warnings,
  //     recipe:{RESID:units}, blend:{density,tensile,heat,conduct} }
  function calcAlloy(mix) {
    const recipe = {};
    let total = 0;
    for (const id in (mix || {})) {
      const u = Math.max(0, +mix[id] || 0);
      if (u > 0 && ELEMENTS[id]) { recipe[id] = u; total += u; }
    }
    if (total <= 0) return { ok:false, empty:true, totalUnits:0, traits:[], warnings:['Добавьте ресурсы'], resist:{kinetic:0,energy:0,missile:0} };

    // Доли (пропорции — «нота» рецепта) и доли по ролям
    const f = {}, r = {};
    ['struct','ceramic','binder','metal','catalyst','volatile','reactive','exotic'].forEach(k => r[k] = 0);
    for (const id in recipe) {
      f[id] = recipe[id] / total;
      const role = ELEMENTS[id].role;
      r[role] = (r[role] || 0) + f[id];
    }

    // Смешанная физика (взвешенно по долям)
    let density = 0, tensile = 0, heat = 0, conduct = 0, hpRaw = 0, weight = 0;
    for (const id in recipe) {
      const e = ELEMENTS[id], fr = f[id];
      density += fr * e.density;
      tensile += fr * e.tensile;
      heat    += fr * e.heat;
      conduct += fr * e.conduct;
      weight  += fr * e.weight;
      hpRaw   += recipe[id] * e.hp;   // абсолют: больше ресурса = больше HP-базы
    }

    // Аккумулятор эффектов
    const acc = { hpMul:1, tenMul:1, densMul:1, heatMul:1, capAdd:0,
                  kin:0, en:0, mis:0, pctHp:0, traits:[], warns:[] };

    // Базовые стойкости из физики (до реакций)
    acc.kin += clamp(tensile / 4000, 0, 0.45) + clamp(density / 60, 0, 0.20);
    acc.en  += clamp(heat * 0.45, 0, 0.45) - clamp(conduct * 0.35, 0, 0.35);
    acc.mis += clamp(density / 50, 0, 0.25);

    // Реакции
    REACTIONS.forEach(rx => { try { if (rx.test(f, r)) rx.eff(acc, f, r); } catch (e) {} });
    // Штрафы (хардкор)
    purityPenalty(acc, f);
    volatilePenalty(acc, r, f);

    // Финальная физика
    density = Math.max(0.3, density * acc.densMul);
    tensile = Math.max(5,   tensile * acc.tenMul);
    heat    = clamp(heat * acc.heatMul, 0.02, 1.2);

    // Качество HP: множитель из реакций (никогда не выше 1.6, но может уползти к 0.1)
    const quality = clamp(acc.hpMul, 0.1, 1.6);
    // Кап объёма: HP/грузоподъёмность масштабируются по потолку — набивать нельзя.
    const capScale = total > MAX_UNITS ? MAX_UNITS / total : 1;
    const hpBoost = Math.round(hpRaw * quality * 0.6 * capScale);
    const hpPercentBoost = clamp(acc.pctHp, 0, 1.5);
    const capacityBoost = Math.round((-weight * total * 0.4 + acc.capAdd * total * 0.2) * capScale);

    const resist = {
      kinetic: +clamp(acc.kin, 0, 0.9).toFixed(3),
      energy:  +clamp(acc.en,  0, 0.9).toFixed(3),
      missile: +clamp(acc.mis, 0, 0.9).toFixed(3),
    };

    const category = pickCategory(r, density);

    // material — ровно та форма, что читает cnKvArmorHp / _cn_kv_armor_hp
    const material = {
      density: +density.toFixed(2),
      tensileStrength: { min: Math.round(tensile * 0.85), max: Math.round(tensile * 1.15) },
      thermalConductivity: Math.round(conduct * 400),   // условные Вт/м·К для формулы
      heatResistance: Math.round(heat * 2500),
    };

    // ОЦЕНКА 0..100 — «насколько хорош сплав».
    //   качество (нет штрафов) 35 + баланс трёх стойкостей 45 + бонус %HP 20 − штрафы×10.
    // 100 = сильная защита по всем трём типам + весомый %HP, БЕЗ единого ⚠.
    const qN = clamp(quality, 0, 1);
    const rScore = clamp((resist.kinetic + resist.energy + resist.missile) / 1.5, 0, 1);
    const pN = clamp(hpPercentBoost / 1.2, 0, 1);
    const grade = clamp(Math.round(qN * 35 + rScore * 45 + pN * 20 - acc.warns.length * 10), 0, 100);

    // Подсказки: чего не хватает до 100
    const hints = [];
    if (acc.warns.length) hints.push('Убери предупреждения (⚠) — каждое минус к оценке');
    if (rScore < 0.75) hints.push('Подними стойкости: нужен баланс кинетика / лазер / ракеты');
    if (pN < 0.5) hints.push('Добавь катализатор (Редкоземельные / Стелларит / Гравиядро) поверх структуры — даст %HP');
    if (qN < 0.95) hints.push('Избегай чистоты >75% и волатильных без углеродной связки');

    return {
      ok: true, totalUnits: total, recipe, maxUnits: MAX_UNITS,
      material, category, hpBoost, hpPercentBoost, capacityBoost,
      resist, traits: acc.traits, warnings: acc.warns, hints,
      grade, blend: { density:+density.toFixed(2), tensile:Math.round(tensile), heat:+heat.toFixed(2), conduct:+conduct.toFixed(2) },
      quality: +quality.toFixed(2),
    };
  }

  var API = { ELEMENTS, REACTIONS, calcAlloy, MAX_UNITS };
  if (typeof window !== 'undefined') window.ARMOR_ALCHEMY = API;
  // Node/CommonJS для теста и генерации SQL-зеркала
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
