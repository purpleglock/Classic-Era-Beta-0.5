// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════
// WEAPON SYSTEM v2 — Динамический расчёт урона и дальности
// Зависит от: coefficients.js (getCoef + DEFAULT_COEFFICIENTS)
// Используется: render.js (renderItemPage, renderCharacterPage)
// ════════════════════════════════════════════════════════════
// Все таблицы коэффициентов живут в coefficients.js (DEFAULT_COEFFICIENTS)
// под префиксами weapon_tech_*, weapon_dmg_*, weapon_class_*, weapon_range_*
// Редактируются суперадмином на странице /coefficients.

// ── §1. Классы носителей ──────────────────────────────────────
const WEAPON_SMALL_CARRIERS = [
  'infantry', 'vehicle', 'tank',
  'aviation_light', 'aviation_medium', 'aviation_heavy',
];

// ── §2. Парсеры ───────────────────────────────────────────────
function _wParseNum(str) {
  if (str === null || str === undefined || str === '') return 0;
  const m = String(str).replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
function _wKey(str) {
  return String(str || '').toLowerCase().trim().replace(/[\s\-]+/g, '_');
}

// ── §3. Форматтер дальности ───────────────────────────────────
function fmtWeaponRange(ask, carrierClass) {
  if (!ask || ask <= 0) return '—';
  const small = !carrierClass || WEAPON_SMALL_CARRIERS.includes(carrierClass);
  if (small) {
    if (ask % 1 === 0) return `${ask} АсК`;
    return `${String(ask.toFixed(2)).replace(/0+$/, '').replace('.', ',')} АсК`;
  }
  return `${Math.round(ask)} АсК`;
}

// ── §4. Чтение коэффициентов ──────────────────────────────────
// Все берутся из getCoef() → Supabase / DEFAULT_COEFFICIENTS
function _wCoef(prefix, key, fallback) {
  if (typeof getCoef !== 'function') return fallback;
  const v = getCoef(prefix + key);
  return (v !== undefined && v !== null) ? v : fallback;
}

// ── §5. Главная функция расчёта ───────────────────────────────
/**
 * @param {object} weaponData
 *   caliber, weight, fireRate, techType, damageType, weaponClass, baseRange
 * @param {object} [modifiers]
 *   radarDalnostBoost, damageBonus, carrierClass
 */
function calculateWeaponStats(weaponData, modifiers) {
  const m = modifiers || {};
  if (!weaponData || typeof weaponData !== 'object') {
    return { damage: 0, finalRange: 0, rangeLabel: '—',
             caliber: 0, weightSqrt: 10, fireRate: 0, rateMod: 1,
             tCoef: 1, dCoef: 0, cCoef: 1 };
  }

  // 1. Калибр
  const caliber = _wParseNum(weaponData.caliber);

  // 2. √Вес
  const rawW = _wParseNum(weaponData.weight);
  const weightSqrt = Math.sqrt(rawW > 0 ? rawW : 100);

  // 3. Темп
  const fireRate = _wParseNum(weaponData.fireRate);

  // 4. rateMod = 1 + fireRate / weapon_rate_divisor
  const rateDivisor = _wCoef('', 'weapon_rate_divisor', 5000);
  const rateMod = 1 + (fireRate > 0 ? fireRate / rateDivisor : 0);

  // 5. Коэффициенты из Supabase/defaults
  const tKey = _wKey(weaponData.techType)   || 'conventional';
  const dKey = _wKey(weaponData.damageType) || 'kinetic';
  const cKey = _wKey(weaponData.weaponClass) || 'rifle';

  const tCoef = _wCoef('weapon_tech_',  tKey, 1.0);
  const dCoef = _wCoef('weapon_dmg_',   dKey, 0.0);
  const cCoef = _wCoef('weapon_class_', cKey, 1.0);

  // 6. Урон
  const damageDivisor = _wCoef('', 'weapon_damage_divisor', 1);
  const baseDamage    = caliber * weightSqrt * tCoef * cCoef;
  const rawDamage     = Math.round(baseDamage * (1 + dCoef) * rateMod / damageDivisor);
  const bonusDmg      = parseInt(m.damageBonus, 10) || 0;
  const damage = caliber > 0
    ? Math.max(1, rawDamage) + bonusDmg
    : Math.max(0, rawDamage) + bonusDmg;

  // 7. Дальность: ручная или из weapon_range_<class>
  const manualRange = _wParseNum(weaponData.baseRange);
  const autoRange   = _wCoef('weapon_range_', cKey, 0);
  const baseRange   = manualRange > 0 ? manualRange : autoRange;
  const radarBoost  = parseFloat(m.radarDalnostBoost) || 0;
  const finalRange  = Math.max(0, baseRange + radarBoost);
  const rangeLabel  = fmtWeaponRange(finalRange, m.carrierClass || '');

  return { damage, finalRange, rangeLabel, caliber, weightSqrt, fireRate, rateMod,
           tCoef, dCoef, cCoef, damageDivisor };
}

// ── §6. Превью для нескольких носителей ───────────────────────
function calcWeaponPreview(weaponData) {
  return [
    { key:'infantry',       label:'Пехота'  },
    { key:'vehicle',        label:'Техника' },
    { key:'tank',           label:'Танк'    },
    { key:'aviation_light', label:'Авиация' },
    { key:'ship_medium',    label:'Корабль' },
  ].map(c => ({ carrierClass:c.key, label:c.label,
                ...calculateWeaponStats(weaponData, { carrierClass:c.key }) }));
}

// ── §7. Извлечь weaponData из extra-объекта infobox ───────────
function weaponDataFromExtra(extra) {
  if (!extra || typeof extra !== 'object') return {};
  const g = (k1, k2) => extra[k1] || (k2 ? extra[k2] : '') || '';
  return {
    caliber:     g('калибр',         'caliber'),
    weight:      g('вес',            'weight'),
    fireRate:    g('темп_стрельбы',  'темп стрельбы') || g('fire_rate', 'firerate'),
    techType:    g('тип_технологии', 'тип технологии') || g('tech_type', 'techtype'),
    damageType:  g('тип_урона',      'тип урона')     || g('damage_type', 'damagetype'),
    weaponClass: g('класс_оружия',   'класс оружия')  || g('weapon_class', 'weaponclass'),
    baseRange:   g('дальность',      'dalnost')       || g('base_range', 'baserange'),
  };
}
