// ════════════════════════════════════════════════════════════
// ARMOR SYSTEM v2 — Лимит Нагрузки и Физика Материалов
// Зависит от: ничего (чистый модуль данных и математики)
// Используется: editor.js, render.js
// ════════════════════════════════════════════════════════════

// ── §1. Классы брони ─────────────────────────────────────────
// baseWeight: базовый вес самого предмета без ресурсов (kg)
// loadLimit:  максимальный суммарный вес ресурсов без штрафов (kg)
// rpLimit:    максимум РП-очков для улучшений
const ARMOR_CLASSES = {
  infantry:        { ru:'Пехотная',             en:'Infantry',        baseWeight:5,     loadLimit:20,     rpLimit:20   },
  vehicle:         { ru:'Автомобильная',         en:'Vehicle',         baseWeight:100,   loadLimit:500,    rpLimit:40   },
  tank:            { ru:'Танковая',              en:'Tank',            baseWeight:5000,  loadLimit:30000,  rpLimit:60   },
  aviation_light:  { ru:'Авиационная Лёгкая',   en:'Aviation Lt',     baseWeight:50,    loadLimit:200,    rpLimit:30   },
  aviation_medium: { ru:'Авиационная Средняя',  en:'Aviation Md',     baseWeight:200,   loadLimit:800,    rpLimit:40   },
  aviation_heavy:  { ru:'Авиационная Тяжёлая',  en:'Aviation Hv',     baseWeight:500,   loadLimit:2000,   rpLimit:50   },
  ship_light:      { ru:'Корабельная Лёгкая',   en:'Ship Lt',         baseWeight:500,   loadLimit:3000,   rpLimit:50   },
  ship_medium:     { ru:'Корабельная Средняя',  en:'Ship Md',         baseWeight:2000,  loadLimit:15000,  rpLimit:70   },
  ship_heavy:      { ru:'Корабельная Тяжёлая',  en:'Ship Hv',         baseWeight:8000,  loadLimit:60000,  rpLimit:100  },
};

// ── §2. Ресурсы ───────────────────────────────────────────────
// kg_per_unit:  вес одной единицы ресурса (кг)
// hp_per_kg:    очки прочности на 1 кг этого ресурса
// density:      плотность материала (г/см³) — влияет на физический множитель HP
// thermal:      теплопроводность (Вт/м·К) — чем выше тем хуже против лазера
// tensile:      прочность на разрыв (МПа) — влияет на пробитие
const ARMOR_RESOURCES = {
  chermet: {
    ru:'Чермет',       en:'Scrap Metal',
    kg_per_unit: 8.0,
    hp_per_kg:   0.5,
    density:     7.8,   // сталь — тяжёлая и плотная
    thermal:     50.0,  // хорошо проводит тепло → плохо против лазера
    tensile:     400,
    color:'#8a8a9a',
    icon:'⬛',
  },
  ruda: {
    ru:'Руда',         en:'Ore',
    kg_per_unit: 5.0,
    hp_per_kg:   1.2,
    density:     4.5,
    thermal:     25.0,
    tensile:     600,
    color:'#a0724a',
    icon:'🟫',
  },
  crystals: {
    ru:'Кристаллы',    en:'Crystals',
    kg_per_unit: 0.5,  // лёгкие
    hp_per_kg:   15.0, // хорошо HP на единицу веса
    density:     2.5,
    thermal:     2.0,  // почти не проводит тепло → хорошо против лазера
    tensile:     1200,
    color:'#6bb8d4',
    icon:'💎',
  },
  starvis: {
    ru:'Старвис (ПП)', en:'Starvite PP',
    kg_per_unit: 0.1,  // сверхлёгкий
    hp_per_kg:   80.0, // колоссальное HP на кг
    density:     0.8,
    thermal:     0.1,  // практически нет теплопроводности → высокая защита от лазера
    tensile:     5000,
    color:'#d4924a',
    icon:'✦',
  },
};

// ── §3. Константы расчёта ─────────────────────────────────────
const ARMOR_K_AREA              = 0.8;   // коэффициент масштабирования площади поверхности
const ARMOR_SPEED_PER_PCT       = 0.2;   // -0.2 ед. скорости за каждый % перегрузки
const ARMOR_SPEED_MAX_PENALTY   = 30;    // максимальный штраф скорости
const ARMOR_PEN_PHYS_PER_KG     = 0.15; // вклад физической массы в пробитие
const ARMOR_PEN_HP_FACTOR       = 0.002; // вклад HP в пробитие
const ARMOR_PEN_TENSILE_FACTOR  = 0.008; // вклад прочности на разрыв
const ARMOR_PEN_RP_FACTOR       = 1.5;   // вклад ОЧ прочности

// ── §4. Главная функция расчёта ───────────────────────────────
/**
 * Полный расчёт параметров брони.
 * @param {object} params
 * @param {string}  params.armorClass  — ключ из ARMOR_CLASSES
 * @param {object}  params.resources   — {chermet, ruda, crystals, starvis} количества
 * @param {number}  params.density_pts  — ОЧ Плотность
 * @param {number}  params.tensile_pts  — ОЧ Прочность
 * @param {number}  params.thermal_pts  — ОЧ Термостойкость
 * @param {number}  params.unit_gabrit  — Габарит юнита (1 = человек, 5 = БМП, 10 = танк, 50 = корабль)
 * @returns {object} полный набор рассчитанных параметров
 */
function calcArmorFull({ armorClass, resources = {}, density_pts = 0, tensile_pts = 0, thermal_pts = 0, unit_gabrit = 1 }) {
  const cls = ARMOR_CLASSES[armorClass] || ARMOR_CLASSES.infantry;
  const RP_MAX = cls.rpLimit || 20;
  density_pts = Math.min(RP_MAX, Math.max(0, parseFloat(density_pts)  || 0));
  tensile_pts = Math.min(RP_MAX, Math.max(0, parseFloat(tensile_pts)  || 0));
  thermal_pts = Math.min(RP_MAX, Math.max(0, parseFloat(thermal_pts)  || 0));
  unit_gabrit = Math.max(0.1, parseFloat(unit_gabrit) || 1);

  // ─── 1. Вес от РП-очков ─────────────────────────────────
  // Формула: 1 кг на 1 очко для всех типов
  const total_weight = density_pts * 1.0 + tensile_pts * 1.0 + thermal_pts * 1.0;

  // ─── 2. Множитель материала (из ОЧ) — макс из коэффициентов
  const mat_mul_max = typeof getCoef === 'function' ? getCoef('armor_mat_mul_max') : 2.5;
  const density_mul = typeof getCoef === 'function' ? getCoef('armor_density_mul') : 0.06;
  const tensile_mul = typeof getCoef === 'function' ? getCoef('armor_tensile_mul') : 0.08;
  const thermal_mul = typeof getCoef === 'function' ? getCoef('armor_thermal_mul') : 0.05;
  
  const mat_mul = Math.min(mat_mul_max, 1
    + density_pts  * density_mul
    + tensile_pts  * tensile_mul
    + thermal_pts  * thermal_mul);

  // ─── 3. Базовый HP от РП-очков
  const rp_density = typeof getCoef === 'function' ? getCoef('armor_rp_density') : 0.15;
  const rp_tensile = typeof getCoef === 'function' ? getCoef('armor_rp_tensile') : 0.25;
  const rp_thermal = typeof getCoef === 'function' ? getCoef('armor_rp_thermal') : 0.10;
  
  const hp_from_rp = (density_pts * rp_density + tensile_pts * rp_tensile + thermal_pts * rp_thermal) * 10;

  // ─── 4. HP брони (до масштабирования юнита) ───────────────
  const hp_armor = hp_from_rp * mat_mul;

  // ─── 5. HP на персонаже (масштабируется по габариту) ──────
  const k_area = typeof getCoef === 'function' ? getCoef('armor_k_area') : 0.8;
  const hp_on_unit = Math.round(hp_armor / (unit_gabrit * k_area));

  // ─── 6. Штраф веса ────────────────────────────────────────
  const load_limit   = cls.loadLimit;
  let overload_pct   = 0;
  let speed_penalty  = 0;
  if (total_weight > load_limit) {
    const speed_per_pct = typeof getCoef === 'function' ? getCoef('armor_speed_per_pct') : 0.2;
    const speed_max_penalty = typeof getCoef === 'function' ? getCoef('armor_speed_max_penalty') : 30;
    overload_pct  = ((total_weight - load_limit) / load_limit) * 100;
    speed_penalty = Math.min(speed_max_penalty, Math.round(overload_pct * speed_per_pct));
  }

  // ─── 7. Рейтинг пробития (мм калибр) ─────────────────────
  const pen_rp_factor = typeof getCoef === 'function' ? getCoef('armor_pen_rp_factor') : 0.5;
  const pen_mm  = Math.max(0, Math.round(tensile_pts * pen_rp_factor));

  // ─── 8. Рейтинг абляции (лазер) ──────────────────────────
  const thermal_bonus = thermal_pts * 0.018;
  let ablation = Math.max(0, Math.min(0.95, thermal_bonus));

  let laser_label, laser_color, laser_pct;
  laser_pct = Math.round(ablation * 100);
  if (ablation >= 0.80)      { laser_label = `Иммунитет к лазеру (${laser_pct}%)`;         laser_color = '#4ec96a'; }
  else if (ablation >= 0.50) { laser_label = `Сопротивление лазеру (${laser_pct}%)`;        laser_color = '#6bb8d4'; }
  else if (ablation >= 0.25) { laser_label = `Частичная защита (${laser_pct}%)`;            laser_color = '#d4924a'; }
  else                        { laser_label = `Полный урон лазера (защита ${laser_pct}%)`;  laser_color = '#cc4848'; }

  return {
    hp_base:       Math.round(hp_from_rp),
    hp_armor:      Math.round(hp_armor),
    hp_on_unit,
    total_weight,
    load_limit,
    overload_pct,
    speed_penalty,
    pen_mm,
    ablation,
    laser_pct,
    laser_label,
    laser_color,
    mat_mul,
    avg_thermal: 0,
    avg_tensile: 0,
    avg_density: 0,
    cls,
  };
}

// ── §5. HP для разных габаритов (для превью в редакторе) ─────
function calcArmorForGabrits(params) {
  const gabrits = [1, 5, 10, 50];
  return gabrits.map(g => ({
    gabrit: g,
    label: { 1:'Человек', 5:'БМП/Мотоцикл', 10:'Танк', 50:'Корабль' }[g],
    hp: calcArmorFull({ ...params, unit_gabrit: g }).hp_on_unit,
  }));
}

// ── §6. Вспомогательные форматтеры ───────────────────────────
function fmtWeight(kg) {
  if (kg >= 1000) return (kg / 1000).toFixed(1) + ' т';
  return kg.toFixed(1) + ' кг';
}
function fmtPen(mm) {
  if (mm === 0)   return 'Не защищает';
  if (mm <= 5)    return `≤5мм (ПМ, дробь)`;
  if (mm <= 14)   return `~${mm}мм (9мм, .45)`;
  if (mm <= 20)   return `~${mm}мм (7.62×39)`;
  if (mm <= 30)   return `~${mm}мм (12.7мм пулемёт)`;
  if (mm <= 57)   return `~${mm}мм (23–57мм авто-пушка)`;
  if (mm <= 125)  return `~${mm}мм (76–125мм орудие)`;
  return `${mm}мм (главный калибр)`;
}
