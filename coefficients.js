// ════════════════════════════════════════════════════════════
// COEFFICIENTS CONFIG PAGE — Редактор коэффициентов системы
// 
// Страница для настройки всех числовых коэффициентов вики.
// Доступна только для superadmin по адресу #coefficients
// 
// Использование в коде:
//   const value = await getCoef('coefficient_name');
// 
// Коэффициенты хранятся в таблице coefficients в Supabase.
// ════════════════════════════════════════════════════════════

// ── Оружие — таблицы коэффициентов ───────────────────────────
// Используются в weapon_system.js → calculateWeaponStats()

/** Коэффициент типа технологии оружия */
const WEAPON_TECH_COEFS = {
  conventional : 1.0,   // обычное/механическое
  kinetic      : 1.0,   // кинетическое (синоним conventional)
  laser        : 1.4,   // лазерное
  plasma       : 1.6,   // плазменное
  railgun      : 1.8,   // рельсотрон
  explosive    : 1.3,   // взрывное устройство
  energy       : 1.5,   // чистая энергия
  sonic        : 1.2,   // звуковое
  nano         : 2.0,   // нанотехнологическое
  gauss        : 1.7,   // гаусс-пушка
};

/** Коэффициент типа урона оружия */
const WEAPON_DAMAGE_TYPE_COEFS = {
  kinetic    : 0.00,   // кинетический — базовая линия
  piercing   : 0.20,   // бронебойный
  explosive  : 0.40,   // взрывной
  incendiary : 0.30,   // зажигательный
  thermal    : 0.35,   // термический
  laser      : 0.50,   // лазерный
  plasma     : 0.60,   // плазменный
  energy     : 0.50,   // энергетический
  emp        : 0.35,   // электромагнитный
  chemical   : 0.45,   // химический
  sonic      : 0.25,   // звуковой
};

/** Коэффициент класса оружия */
const WEAPON_CLASS_COEFS = {
  pistol            : 0.70,
  smg               : 0.90,   // пистолет-пулемёт
  shotgun           : 0.95,
  rifle             : 1.00,   // базовая линия
  carbine           : 0.95,
  sniper            : 1.30,
  machinegun        : 1.20,
  grenade_launcher  : 1.40,
  rocket_launcher   : 1.55,
  cannon            : 1.80,   // пушка (танк/самоход)
  autocannon        : 1.50,   // автоматическая пушка
  howitzer          : 1.70,   // гаубица
  mortar            : 1.45,   // миномёт
  flamethrower      : 1.10,
  torpedo           : 2.00,
  missile           : 1.60,
  cruise_missile    : 1.80,
  railgun_weapon    : 2.20,   // рельсотронная установка
  main_battery      : 2.50,   // главный калибр корабля
  anti_air          : 1.25,   // зенитный комплекс
};

// ── Оружие — таблицы коэффициентов ───────────────────────────
// Все таблицы перенесены в DEFAULT_COEFFICIENTS (ниже).
// Ключи: weapon_tech_*, weapon_dmg_*, weapon_class_*, weapon_range_*
// Редактируются на странице /coefficients суперадмином.

// Кэш коэффициентов
let _coefficientsCache = null;

// Дефолтные значения коэффициентов
const DEFAULT_COEFFICIENTS = {
  // ── Броня ─────────────────────────────────────────────────
  armor_mat_mul_max: 2.5,
  armor_density_mul: 0.06,
  armor_tensile_mul: 0.08,
  armor_thermal_mul: 0.05,
  armor_rp_density: 0.15,
  armor_rp_tensile: 0.25,
  armor_rp_thermal: 0.10,
  armor_k_area: 0.8,
  armor_speed_per_pct: 0.2,
  armor_speed_max_penalty: 30,
  armor_pen_phys_per_kg: 0.15,
  armor_pen_hp_factor: 0.002,
  armor_pen_tensile_factor: 0.008,
  armor_pen_rp_factor: 1.5,

  // ── Персонажи (HP) ─────────────────────────────────────────
  char_hp_base_per_level: 8,
  char_hp_con_divisor: 2,

  // ── Оружие — глобальная формула ────────────────────────────
  weapon_damage_divisor: 1,
  weapon_rate_divisor:   5000,

  // ── Оружие — тип технологии (weapon_tech_*) ────────────────
  weapon_tech_conventional: 1.0,
  weapon_tech_kinetic:      1.0,
  weapon_tech_laser:        1.4,
  weapon_tech_plasma:       1.6,
  weapon_tech_railgun:      1.8,
  weapon_tech_explosive:    1.3,
  weapon_tech_energy:       1.5,
  weapon_tech_sonic:        1.2,
  weapon_tech_nano:         2.0,
  weapon_tech_gauss:        1.7,

  // ── Оружие — тип урона (weapon_dmg_*) ──────────────────────
  weapon_dmg_kinetic:    0.00,
  weapon_dmg_piercing:   0.20,
  weapon_dmg_explosive:  0.40,
  weapon_dmg_incendiary: 0.30,
  weapon_dmg_thermal:    0.35,
  weapon_dmg_laser:      0.50,
  weapon_dmg_plasma:     0.60,
  weapon_dmg_energy:     0.50,
  weapon_dmg_emp:        0.35,
  weapon_dmg_chemical:   0.45,
  weapon_dmg_sonic:      0.25,

  // ── Оружие — класс оружия — множитель урона (weapon_class_*) 
  weapon_class_pistol:           0.70,
  weapon_class_smg:              0.90,
  weapon_class_shotgun:          0.95,
  weapon_class_carbine:          0.95,
  weapon_class_rifle:            1.00,
  weapon_class_sniper:           1.30,
  weapon_class_machinegun:       1.20,
  weapon_class_grenade_launcher: 1.40,
  weapon_class_rocket_launcher:  1.55,
  weapon_class_cannon:           1.80,
  weapon_class_autocannon:       1.50,
  weapon_class_howitzer:         1.70,
  weapon_class_mortar:           1.45,
  weapon_class_flamethrower:     1.10,
  weapon_class_torpedo:          2.00,
  weapon_class_missile:          1.60,
  weapon_class_cruise_missile:   1.80,
  weapon_class_railgun_weapon:   2.20,
  weapon_class_main_battery:     2.50,
  weapon_class_anti_air:         1.25,

  // ── Оружие — дальность по умолчанию (АсК, weapon_range_*) ──
  weapon_range_pistol:           0.20,
  weapon_range_smg:              0.30,
  weapon_range_shotgun:          0.15,
  weapon_range_carbine:          0.50,
  weapon_range_rifle:            0.60,
  weapon_range_sniper:           1.50,
  weapon_range_machinegun:       0.80,
  weapon_range_grenade_launcher: 0.40,
  weapon_range_rocket_launcher:  1.00,
  weapon_range_cannon:           3.00,
  weapon_range_autocannon:       2.00,
  weapon_range_howitzer:         5.00,
  weapon_range_mortar:           2.50,
  weapon_range_flamethrower:     0.10,
  weapon_range_torpedo:          8.00,
  weapon_range_missile:          15.0,
  weapon_range_cruise_missile:   50.0,
  weapon_range_railgun_weapon:   20.0,
  weapon_range_main_battery:     30.0,
  weapon_range_anti_air:         10.0,
};

// Описания для страницы /coefficients
const COEF_DESCRIPTIONS = {
  // Броня
  armor_mat_mul_max: 'Максимальный множитель материала',
  armor_density_mul: 'Вклад очков плотности в множитель',
  armor_tensile_mul: 'Вклад очков прочности в множитель',
  armor_thermal_mul: 'Вклад очков термостойкости в множитель',
  armor_rp_density: 'HP от очков плотности (коэф.)',
  armor_rp_tensile: 'HP от очков прочности (коэф.)',
  armor_rp_thermal: 'HP от очков термостойкости (коэф.)',
  armor_k_area: 'Коэффициент масштабирования площади',
  armor_speed_per_pct: 'Штраф скорости за % перегрузки',
  armor_speed_max_penalty: 'Максимальный штраф скорости',
  armor_pen_phys_per_kg: 'Пробитие от физической массы (мм/кг)',
  armor_pen_hp_factor: 'Пробитие от HP',
  armor_pen_tensile_factor: 'Пробитие от прочности материала',
  armor_pen_rp_factor: 'Пробитие от очков прочности',
  // Персонажи
  char_hp_base_per_level: 'Базовое HP за уровень',
  char_hp_con_divisor: 'Делитель модификатора телосложения',
  // Оружие формула
  weapon_damage_divisor: 'Делитель итогового урона (чем меньше — тем больше урон)',
  weapon_rate_divisor: 'Делитель темпа стрельбы для rateMod',
  // Оружие — технология
  weapon_tech_conventional: 'Технология: обычное/кинетическое',
  weapon_tech_kinetic: 'Технология: кинетическое (алиас conventional)',
  weapon_tech_laser: 'Технология: лазерное',
  weapon_tech_plasma: 'Технология: плазменное',
  weapon_tech_railgun: 'Технология: рельсотрон',
  weapon_tech_explosive: 'Технология: взрывное',
  weapon_tech_energy: 'Технология: чистая энергия',
  weapon_tech_sonic: 'Технология: звуковое',
  weapon_tech_nano: 'Технология: нанотехнологическое',
  weapon_tech_gauss: 'Технология: гаусс-пушка',
  // Оружие — тип урона
  weapon_dmg_kinetic: 'Тип урона: кинетический (базовая линия)',
  weapon_dmg_piercing: 'Тип урона: бронебойный (+% к урону)',
  weapon_dmg_explosive: 'Тип урона: взрывной (+% к урону)',
  weapon_dmg_incendiary: 'Тип урона: зажигательный (+% к урону)',
  weapon_dmg_thermal: 'Тип урона: термический (+% к урону)',
  weapon_dmg_laser: 'Тип урона: лазерный (+% к урону)',
  weapon_dmg_plasma: 'Тип урона: плазменный (+% к урону)',
  weapon_dmg_energy: 'Тип урона: энергетический (+% к урону)',
  weapon_dmg_emp: 'Тип урона: ЭМИ (+% к урону)',
  weapon_dmg_chemical: 'Тип урона: химический (+% к урону)',
  weapon_dmg_sonic: 'Тип урона: звуковой (+% к урону)',
  // Оружие — класс (множитель урона)
  weapon_class_pistol: 'Класс: пистолет — множитель урона',
  weapon_class_smg: 'Класс: пистолет-пулемёт — множитель урона',
  weapon_class_shotgun: 'Класс: дробовик — множитель урона',
  weapon_class_carbine: 'Класс: карабин — множитель урона',
  weapon_class_rifle: 'Класс: штурмовая винтовка — множитель урона',
  weapon_class_sniper: 'Класс: снайперская винтовка — множитель урона',
  weapon_class_machinegun: 'Класс: пулемёт — множитель урона',
  weapon_class_grenade_launcher: 'Класс: гранатомёт — множитель урона',
  weapon_class_rocket_launcher: 'Класс: ракетный пусковой — множитель урона',
  weapon_class_cannon: 'Класс: орудие/пушка — множитель урона',
  weapon_class_autocannon: 'Класс: автоматическая пушка — множитель урона',
  weapon_class_howitzer: 'Класс: гаубица — множитель урона',
  weapon_class_mortar: 'Класс: миномёт — множитель урона',
  weapon_class_flamethrower: 'Класс: огнемёт — множитель урона',
  weapon_class_torpedo: 'Класс: торпеда — множитель урона',
  weapon_class_missile: 'Класс: ракета — множитель урона',
  weapon_class_cruise_missile: 'Класс: крылатая ракета — множитель урона',
  weapon_class_railgun_weapon: 'Класс: рельсотронная установка — множитель урона',
  weapon_class_main_battery: 'Класс: главный калибр — множитель урона',
  weapon_class_anti_air: 'Класс: зенитный комплекс — множитель урона',
  // Оружие — класс (дальность по умолчанию)
  weapon_range_pistol: 'Дальность по умолч.: пистолет (АсК)',
  weapon_range_smg: 'Дальность по умолч.: пистолет-пулемёт (АсК)',
  weapon_range_shotgun: 'Дальность по умолч.: дробовик (АсК)',
  weapon_range_carbine: 'Дальность по умолч.: карабин (АсК)',
  weapon_range_rifle: 'Дальность по умолч.: штурмовая винтовка (АсК)',
  weapon_range_sniper: 'Дальность по умолч.: снайперская винтовка (АсК)',
  weapon_range_machinegun: 'Дальность по умолч.: пулемёт (АсК)',
  weapon_range_grenade_launcher: 'Дальность по умолч.: гранатомёт (АсК)',
  weapon_range_rocket_launcher: 'Дальность по умолч.: ракетный пусковой (АсК)',
  weapon_range_cannon: 'Дальность по умолч.: орудие/пушка (АсК)',
  weapon_range_autocannon: 'Дальность по умолч.: автоматическая пушка (АсК)',
  weapon_range_howitzer: 'Дальность по умолч.: гаубица (АсК)',
  weapon_range_mortar: 'Дальность по умолч.: миномёт (АсК)',
  weapon_range_flamethrower: 'Дальность по умолч.: огнемёт (АсК)',
  weapon_range_torpedo: 'Дальность по умолч.: торпеда (АсК)',
  weapon_range_missile: 'Дальность по умолч.: ракета (АсК)',
  weapon_range_cruise_missile: 'Дальность по умолч.: крылатая ракета (АсК)',
  weapon_range_railgun_weapon: 'Дальность по умолч.: рельсотронная установка (АсК)',
  weapon_range_main_battery: 'Дальность по умолч.: главный калибр (АсК)',
  weapon_range_anti_air: 'Дальность по умолч.: зенитный комплекс (АсК)',
};

// Категории для страницы /coefficients
const COEF_CATEGORIES = {
  'Броня — Множители': ['armor_mat_mul_max','armor_density_mul','armor_tensile_mul','armor_thermal_mul'],
  'Броня — HP от очков': ['armor_rp_density','armor_rp_tensile','armor_rp_thermal'],
  'Броня — Масштабирование': ['armor_k_area','armor_speed_per_pct','armor_speed_max_penalty'],
  'Броня — Пробитие': ['armor_pen_phys_per_kg','armor_pen_hp_factor','armor_pen_tensile_factor','armor_pen_rp_factor'],
  'Персонажи — HP': ['char_hp_base_per_level','char_hp_con_divisor'],
  'Оружие — Формула': ['weapon_damage_divisor','weapon_rate_divisor'],
  'Оружие — Технология': [
    'weapon_tech_conventional','weapon_tech_kinetic','weapon_tech_laser','weapon_tech_plasma',
    'weapon_tech_railgun','weapon_tech_explosive','weapon_tech_energy','weapon_tech_sonic',
    'weapon_tech_nano','weapon_tech_gauss',
  ],
  'Оружие — Тип урона': [
    'weapon_dmg_kinetic','weapon_dmg_piercing','weapon_dmg_explosive','weapon_dmg_incendiary',
    'weapon_dmg_thermal','weapon_dmg_laser','weapon_dmg_plasma','weapon_dmg_energy',
    'weapon_dmg_emp','weapon_dmg_chemical','weapon_dmg_sonic',
  ],
  'Оружие — Класс (×урон)': [
    'weapon_class_pistol','weapon_class_smg','weapon_class_shotgun','weapon_class_carbine',
    'weapon_class_rifle','weapon_class_sniper','weapon_class_machinegun',
    'weapon_class_grenade_launcher','weapon_class_rocket_launcher',
    'weapon_class_cannon','weapon_class_autocannon','weapon_class_howitzer','weapon_class_mortar',
    'weapon_class_flamethrower','weapon_class_torpedo','weapon_class_missile',
    'weapon_class_cruise_missile','weapon_class_railgun_weapon','weapon_class_main_battery','weapon_class_anti_air',
  ],
  'Оружие — Дальность по умолч. (АсК)': [
    'weapon_range_pistol','weapon_range_smg','weapon_range_shotgun','weapon_range_carbine',
    'weapon_range_rifle','weapon_range_sniper','weapon_range_machinegun',
    'weapon_range_grenade_launcher','weapon_range_rocket_launcher',
    'weapon_range_cannon','weapon_range_autocannon','weapon_range_howitzer','weapon_range_mortar',
    'weapon_range_flamethrower','weapon_range_torpedo','weapon_range_missile',
    'weapon_range_cruise_missile','weapon_range_railgun_weapon','weapon_range_main_battery','weapon_range_anti_air',
  ],
};
async function loadCoefficients() {
  if (_coefficientsCache) return _coefficientsCache;
  
  try {
    const rows = await dbGet('coefficients', 'select=key,value');
    const coefs = { ...DEFAULT_COEFFICIENTS };
    
    if (rows && rows.length) {
      rows.forEach(row => {
        if (row.key && row.value !== null && row.value !== undefined) {
          coefs[row.key] = parseFloat(row.value);
        }
      });
    }
    
    _coefficientsCache = coefs;
    return coefs;
  } catch(e) {
    console.warn('Ошибка загрузки коэффициентов из БД:', e);
    return { ...DEFAULT_COEFFICIENTS };
  }
}

// Сохранение коэффициента в БД
async function saveCoefficient(key, value) {
  if (!user || !['superadmin', 'editor'].includes(user.role)) {
    toast('Недостаточно прав', 'err');
    return false;
  }
  try {
    const token = await getTokenFresh();
    const body = { key, value: parseFloat(value), updated_at: new Date().toISOString() };
    
    // Upsert: если существует - обновить, если нет - создать
    const r = await fetch(`${SB_URL}/rest/v1/coefficients`, {
      method: 'POST',
      headers: {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(body)
    });
    
    if (!r.ok) throw new Error('HTTP ' + r.status);
    
    // Обновляем кэш
    if (_coefficientsCache) {
      _coefficientsCache[key] = parseFloat(value);
    }
    
    return true;
  } catch(e) {
    console.error('Ошибка сохранения коэффициента:', e);
    return false;
  }
}

// Получение коэффициента (синхронная версия из кэша)
function getCoef(key) {
  if (_coefficientsCache && _coefficientsCache[key] !== undefined) {
    return _coefficientsCache[key];
  }
  return DEFAULT_COEFFICIENTS[key];
}

// Получение коэффициента (асинхронная версия)
async function getCoefAsync(key) {
  const coefs = await loadCoefficients();
  return coefs[key] !== undefined ? coefs[key] : DEFAULT_COEFFICIENTS[key];
}

// Рендер страницы
async function renderCoefficientsPage() {
  if (!user || !['superadmin', 'editor'].includes(user.role)) {
    setPg(`<div class="coef-page">
      <div class="coef-lock">
        <div class="coef-lock-icon">🔒</div>
        <div class="coef-lock-text">Только для администраторов</div>
      </div>
    </div>`);
    return;
  }

  setPg(`<div class="sload"><div style="width:60px;height:60px;position:relative;transform:rotate(45deg)"><div style="content:'';position:absolute;inset:0;border:3px solid #a8692c;animation:pulse-wave 2s ease-in-out infinite"></div><div style="content:'';position:absolute;inset:0;border:3px solid #6bb8d4;animation:pulse-wave 2s ease-in-out infinite;animation-delay:1s"></div></div><style>@keyframes pulse-wave{0%{transform:scale(0.5);opacity:1}50%{transform:scale(1.2);opacity:0.3}100%{transform:scale(0.5);opacity:1}}</style></div>`);
  
  const coefs = await loadCoefficients();
  
  let sectionsHtml = '';
  for (const [category, keys] of Object.entries(COEF_CATEGORIES)) {
    let rowsHtml = '';
    for (const key of keys) {
      const value = coefs[key];
      const desc = COEF_DESCRIPTIONS[key] || key;
      const isDefault = value === DEFAULT_COEFFICIENTS[key];
      
      rowsHtml += `
        <div class="coef-row">
          <div class="coef-label">
            <div class="coef-key">${key}</div>
            <div class="coef-desc">${desc}</div>
          </div>
          <div class="coef-controls">
            <input 
              type="number" 
              step="0.001" 
              class="coef-input" 
              id="coef-${key}" 
              value="${value}"
              onchange="updateCoef('${key}', this.value)"
            >
            ${!isDefault ? `<button class="coef-reset" onclick="resetCoef('${key}')" title="Сбросить">↺</button>` : ''}
          </div>
        </div>
      `;
    }
    
    sectionsHtml += `
      <div class="coef-section">
        <div class="coef-section-head">${category}</div>
        <div class="coef-rows">${rowsHtml}</div>
      </div>
    `;
  }

  setPg(`
    <div class="coef-page">
      <div class="coef-hero">
        <div class="coef-hero-bg"></div>
        <div class="coef-hero-overlay"></div>
        <div class="coef-hero-content">
          <div class="coef-eyebrow">${T('coefSystemSettings')}</div>
          <h1 class="coef-title">${T('coefTitle')}</h1>
          <div class="coef-subtitle">${T('coefSubtitle')}</div>
        </div>
      </div>

      <div class="coef-explainer">
        <div class="coef-expl-head">${T('coefHowHpWorks')}</div>
        
        <div class="coef-expl-section">
          <div class="coef-expl-title">${T('coefArmorHp')}</div>
          <div class="coef-expl-steps">
            <div class="coef-expl-step">
              <div class="coef-expl-num">1</div>
              <div class="coef-expl-text">
                <strong>${T('coefBaseHpFromRp')}</strong><br>
                HP = (${lang==='ru'?'плотность':'density'} × ${coefs.armor_rp_density}) + (${lang==='ru'?'прочность':'tensile'} × ${coefs.armor_rp_tensile}) + (${lang==='ru'?'термостойкость':'thermal'} × ${coefs.armor_rp_thermal})<br>
                ${lang==='ru'?'Затем умножаем на 10':'Then multiply by 10'}
              </div>
            </div>
            <div class="coef-expl-step">
              <div class="coef-expl-num">2</div>
              <div class="coef-expl-text">
                <strong>${T('coefMatMultiplier')}</strong><br>
                ${T('coefModifier')} = 1 + (${lang==='ru'?'плотность':'density'} × ${coefs.armor_density_mul}) + (${lang==='ru'?'прочность':'tensile'} × ${coefs.armor_tensile_mul}) + (${lang==='ru'?'термостойкость':'thermal'} × ${coefs.armor_thermal_mul})<br>
                ${T('coefMax')} ${coefs.armor_mat_mul_max}
              </div>
            </div>
            <div class="coef-expl-step">
              <div class="coef-expl-num">3</div>
              <div class="coef-expl-text">
                <strong>${T('coefFinalArmorHp')}</strong><br>
                HP ${lang==='ru'?'брони':'armor'} = ${lang==='ru'?'Базовое':'Base'} HP × ${T('coefModifier')} ${lang==='ru'?'материала':'material'}
              </div>
            </div>
            <div class="coef-expl-step">
              <div class="coef-expl-num">4</div>
              <div class="coef-expl-text">
                <strong>${T('coefHpOnUnit')}</strong><br>
                HP ${lang==='ru'?'на юните':'on unit'} = HP ${lang==='ru'?'брони':'armor'} ÷ (${lang==='ru'?'габарит юнита':'unit gabrit'} × ${coefs.armor_k_area})<br>
                <em>${T('coefUnitGabrit')}</em>
              </div>
            </div>
          </div>
          <div class="coef-expl-example">
            <strong>${T('coefExample')}</strong> ${T('coefArmorWith')} 10 ${T('coefDensity')}, 15 ${T('coefTensile')}, 5 ${T('coefThermal')}<br>
            1. ${lang==='ru'?'Базовое':'Base'} HP = (10×${coefs.armor_rp_density} + 15×${coefs.armor_rp_tensile} + 5×${coefs.armor_rp_thermal}) × 10 = ${((10*coefs.armor_rp_density + 15*coefs.armor_rp_tensile + 5*coefs.armor_rp_thermal)*10).toFixed(1)}<br>
            2. ${T('coefModifier')} = 1 + (10×${coefs.armor_density_mul} + 15×${coefs.armor_tensile_mul} + 5×${coefs.armor_thermal_mul}) = ${(1 + 10*coefs.armor_density_mul + 15*coefs.armor_tensile_mul + 5*coefs.armor_thermal_mul).toFixed(2)}<br>
            3. HP ${lang==='ru'?'брони':'armor'} = ${((10*coefs.armor_rp_density + 15*coefs.armor_rp_tensile + 5*coefs.armor_rp_thermal)*10).toFixed(1)} × ${(1 + 10*coefs.armor_density_mul + 15*coefs.armor_tensile_mul + 5*coefs.armor_thermal_mul).toFixed(2)} = ${(((10*coefs.armor_rp_density + 15*coefs.armor_rp_tensile + 5*coefs.armor_rp_thermal)*10) * (1 + 10*coefs.armor_density_mul + 15*coefs.armor_tensile_mul + 5*coefs.armor_thermal_mul)).toFixed(1)}<br>
            4. HP ${lang==='ru'?'на юните':'on unit'} = ${(((10*coefs.armor_rp_density + 15*coefs.armor_rp_tensile + 5*coefs.armor_rp_thermal)*10) * (1 + 10*coefs.armor_density_mul + 15*coefs.armor_tensile_mul + 5*coefs.armor_thermal_mul)).toFixed(1)} ÷ (1 × ${coefs.armor_k_area}) = ${Math.round((((10*coefs.armor_rp_density + 15*coefs.armor_rp_tensile + 5*coefs.armor_rp_thermal)*10) * (1 + 10*coefs.armor_density_mul + 15*coefs.armor_tensile_mul + 5*coefs.armor_thermal_mul)) / coefs.armor_k_area)}
          </div>
        </div>

        <div class="coef-expl-section">
          <div class="coef-expl-title">${T('coefCharHp')}</div>
          <div class="coef-expl-steps">
            <div class="coef-expl-step">
              <div class="coef-expl-num">1</div>
              <div class="coef-expl-text">
                <strong>${T('coefHpPerLevel')}</strong><br>
                HP ${lang==='ru'?'за уровень':'per level'} = ${coefs.char_hp_base_per_level} + (${lang==='ru'?'модификатор телосложения':'constitution modifier'})<br>
                ${T('coefModifier')} = (${lang==='ru'?'ТЕЛ':'CON'} - 10) ÷ ${coefs.char_hp_con_divisor}
              </div>
            </div>
            <div class="coef-expl-step">
              <div class="coef-expl-num">2</div>
              <div class="coef-expl-text">
                <strong>${T('coefFinalHp')}</strong><br>
                HP ${lang==='ru'?'персонажа':'character'} = ${lang==='ru'?'Уровень':'Level'} × HP ${lang==='ru'?'за уровень':'per level'} + HP ${lang==='ru'?'от брони':'from armor'}
              </div>
            </div>
          </div>
          <div class="coef-expl-example">
            <strong>${T('coefExample')}</strong> ${T('coefCharLevel')} 5 ${T('coefLevel')} 14<br>
            1. ${T('coefModifier')} ${lang==='ru'?'ТЕЛ':'CON'} = (14 - 10) ÷ ${coefs.char_hp_con_divisor} = ${Math.floor((14-10)/coefs.char_hp_con_divisor)}<br>
            2. HP ${lang==='ru'?'за уровень':'per level'} = ${coefs.char_hp_base_per_level} + ${Math.floor((14-10)/coefs.char_hp_con_divisor)} = ${coefs.char_hp_base_per_level + Math.floor((14-10)/coefs.char_hp_con_divisor)}<br>
            3. HP ${lang==='ru'?'персонажа':'character'} = 5 × ${coefs.char_hp_base_per_level + Math.floor((14-10)/coefs.char_hp_con_divisor)} = ${5 * (coefs.char_hp_base_per_level + Math.floor((14-10)/coefs.char_hp_con_divisor))}
          </div>
        </div>

        <div class="coef-expl-note">
          💡 <strong>${T('coefImportant')}</strong> ${T('coefNote')}
        </div>
      </div>

      <div class="coef-toolbar">
        <button class="coef-btn coef-btn-save" onclick="saveAllCoefs()">
          ${T('coefSaveAll')}
        </button>
        <button class="coef-btn coef-btn-reset" onclick="resetAllCoefs()">
          ${T('coefResetAll')}
        </button>
      </div>

      <div class="coef-preview">
        <div class="coef-preview-head">
          <span class="coef-preview-icon">🛡</span>
          <span class="coef-preview-title">${T('coefPreview')}</span>
        </div>
        <div class="coef-preview-body" id="coef-preview">
          <!-- Заполняется через updatePreview() -->
        </div>
      </div>

      <div class="coef-content">
        ${sectionsHtml}
      </div>

      <div class="coef-footer">
        <div class="coef-footer-note">
          ${T('coefFooterNote')}
        </div>
      </div>
    </div>
  `);
  
  // Обновляем превью
  updatePreview();
}

// Обновление превью расчетов
async function updatePreview() {
  const preview = document.getElementById('coef-preview');
  if (!preview) return;
  
  // Получаем текущие значения из инпутов
  const getCurrentCoef = (key) => {
    const input = document.getElementById(`coef-${key}`);
    return input ? parseFloat(input.value) : getCoef(key);
  };
  
  // Ищем реальную броню из базы данных
  let exampleArmor = null;
  
  try {
    // Запрашиваем страницы типа item с полным контентом
    const r = await fetch(`${SB_URL}/rest/v1/pages?page_type=eq.item&status=eq.published&select=*&limit=100`, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() }
    });
    
    if (r.ok) {
      const items = await r.json();
      
      // Ищем первый предмет с броней
      for (const item of items) {
        try {
          if (!item.content) continue;
          
          const blocks = JSON.parse(item.content);
          const ib = blocks.find(b => b.type === 'infobox');
          if (!ib) continue;
          
          const rows = ib.sections?.[0]?.rows || [];
          
          const getVal = (key) => {
            const row = rows.find(r => (r.key||'').toLowerCase().includes(key.toLowerCase()));
            return row?.val || '';
          };
          
          const armorClass = getVal('класс брони') || getVal('класс_брони');
          if (!armorClass) continue;
          
          // Проверяем есть ли очки
          const hasDensity = getVal('плотность');
          const hasTensile = getVal('прочность');
          const hasThermal = getVal('термостойкость');
          
          if (hasDensity || hasTensile || hasThermal) {
            exampleArmor = {
              name: item.title || item.title_ru || 'Броня',
              armorClass: armorClass,
              density_pts: parseFloat(hasDensity) || 0,
              tensile_pts: parseFloat(hasTensile) || 0,
              thermal_pts: parseFloat(hasThermal) || 0,
              unit_gabrit: 1,
            };
            console.log('Found armor:', exampleArmor.name);
            console.log('Points from DB:', { hasDensity, hasTensile, hasThermal });
            break;
          }
        } catch(e) {
          console.error('Error parsing item:', e);
        }
      }
    }
  } catch(e) {
    console.error('Error fetching armor:', e);
  }
  
  // Если не нашли реальную броню - используем пример
  if (!exampleArmor) {
    exampleArmor = {
      name: 'Пехотная (пример)',
      armorClass: 'infantry',
      density_pts: 10,
      tensile_pts: 15,
      thermal_pts: 5,
      unit_gabrit: 1,
    };
  }
  
  // Расчет HP брони только от очков
  const rp_density = getCurrentCoef('armor_rp_density');
  const rp_tensile = getCurrentCoef('armor_rp_tensile');
  const rp_thermal = getCurrentCoef('armor_rp_thermal');
  
  const rpLimit = (typeof ARMOR_CLASSES !== 'undefined' && ARMOR_CLASSES[exampleArmor.armorClass]) 
    ? ARMOR_CLASSES[exampleArmor.armorClass].rpLimit : 20;
  
  const hp_from_rp = (exampleArmor.density_pts * rp_density + exampleArmor.tensile_pts * rp_tensile + exampleArmor.thermal_pts * rp_thermal) * 10;
  
  // Множитель материала
  const mat_mul_max = getCurrentCoef('armor_mat_mul_max');
  const density_mul = getCurrentCoef('armor_density_mul');
  const tensile_mul = getCurrentCoef('armor_tensile_mul');
  const thermal_mul = getCurrentCoef('armor_thermal_mul');
  
  const mat_mul = Math.min(mat_mul_max, 1
    + exampleArmor.density_pts * density_mul
    + exampleArmor.tensile_pts * tensile_mul
    + exampleArmor.thermal_pts * thermal_mul);
  
  // HP брони
  const hp_armor = hp_from_rp * mat_mul;
  
  // HP на юните
  const k_area = getCurrentCoef('armor_k_area');
  const hp_on_unit = Math.round(hp_armor / (exampleArmor.unit_gabrit * k_area));
  
  // Ищем реального персонажа
  let exampleChar = null;
  
  try {
    const r2 = await fetch(`${SB_URL}/rest/v1/pages?page_type=eq.character&status=eq.published&select=*&limit=10`, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() }
    });
    
    if (r2.ok) {
      const chars = await r2.json();
      
      if (chars.length > 0) {
        const charPage = chars[0];
        try {
          const ch = JSON.parse(charPage.content || '{}');
          exampleChar = {
            name: charPage.title || charPage.title_ru || 'Персонаж',
            level: ch.level || 1,
            con: ch.stats?.con || 10,
          };
        } catch(e) {
          console.error('Error parsing character:', e);
        }
      }
    }
  } catch(e) {
    console.error('Error fetching character:', e);
  }
  
  // Если не нашли реального персонажа - используем пример
  if (!exampleChar) {
    exampleChar = {
      name: 'Персонаж (пример)',
      level: 5,
      con: 14,
    };
  }
  
  const hp_base_per_level = getCurrentCoef('char_hp_base_per_level');
  const hp_con_divisor = getCurrentCoef('char_hp_con_divisor');
  const char_hp = exampleChar.level * (hp_base_per_level + Math.floor((exampleChar.con - 10) / hp_con_divisor));
  
  const totalRP = exampleArmor.density_pts + exampleArmor.tensile_pts + exampleArmor.thermal_pts;
  
  preview.innerHTML = `
    <div class="coef-prev-section">
      <div class="coef-prev-label">Броня: ${exampleArmor.name}</div>
      <div class="coef-prev-specs">
        <div class="coef-prev-spec">РП-очки: ${totalRP}/${rpLimit}</div>
        <div class="coef-prev-spec">Плотность: ${exampleArmor.density_pts} оч.</div>
        <div class="coef-prev-spec">Прочность: ${exampleArmor.tensile_pts} оч.</div>
        <div class="coef-prev-spec">Термостойкость: ${exampleArmor.thermal_pts} оч.</div>
      </div>
      <div class="coef-prev-divider"></div>
      <div class="coef-prev-calc">
        <div class="coef-prev-row">
          <span class="coef-prev-k">Базовое HP (от РП):</span>
          <span class="coef-prev-v">${hp_from_rp.toFixed(1)}</span>
        </div>
        <div class="coef-prev-row">
          <span class="coef-prev-k">Множитель материала:</span>
          <span class="coef-prev-v">×${mat_mul.toFixed(2)}</span>
        </div>
        <div class="coef-prev-row coef-prev-result">
          <span class="coef-prev-k">HP брони на персонаже:</span>
          <span class="coef-prev-v-big">${hp_on_unit}</span>
        </div>
      </div>
    </div>
    
    <div class="coef-prev-section">
      <div class="coef-prev-label">Персонаж: ${exampleChar.name}</div>
      <div class="coef-prev-specs">
        <div class="coef-prev-spec">Уровень: ${exampleChar.level}</div>
        <div class="coef-prev-spec">Телосложение: ${exampleChar.con} (+${Math.floor((exampleChar.con - 10) / 2)})</div>
      </div>
      <div class="coef-prev-divider"></div>
      <div class="coef-prev-calc">
        <div class="coef-prev-row">
          <span class="coef-prev-k">HP за уровень:</span>
          <span class="coef-prev-v">${hp_base_per_level} + ${Math.floor((exampleChar.con - 10) / hp_con_divisor)}</span>
        </div>
        <div class="coef-prev-row coef-prev-result">
          <span class="coef-prev-k">Итоговое HP:</span>
          <span class="coef-prev-v-big">${char_hp}</span>
        </div>
      </div>
    </div>
  `;
}

// Обновление одного коэффициента
async function updateCoef(key, value) {
  const success = await saveCoefficient(key, value);
  
  if (success) {
    // Обновляем кнопку сброса
    const input = document.getElementById(`coef-${key}`);
    if (input) {
      const row = input.closest('.coef-row');
      const parsedValue = parseFloat(value);
      const isDefault = parsedValue === DEFAULT_COEFFICIENTS[key];
      const resetBtn = row.querySelector('.coef-reset');
      if (isDefault && resetBtn) {
        resetBtn.remove();
      } else if (!isDefault && !resetBtn) {
        const controls = row.querySelector('.coef-controls');
        controls.insertAdjacentHTML('beforeend', `<button class="coef-reset" onclick="resetCoef('${key}')" title="Сбросить">↺</button>`);
      }
    }
    
    // Обновляем превью
    updatePreview();
  } else {
    toast('Ошибка сохранения', 'err');
  }
}

// Сброс одного коэффициента
async function resetCoef(key) {
  const success = await saveCoefficient(key, DEFAULT_COEFFICIENTS[key]);
  
  if (success) {
    const input = document.getElementById(`coef-${key}`);
    if (input) {
      input.value = DEFAULT_COEFFICIENTS[key];
      const resetBtn = input.parentElement.querySelector('.coef-reset');
      if (resetBtn) resetBtn.remove();
    }
    
    // Обновляем превью
    updatePreview();
    toast('Коэффициент сброшен', 'ok');
  } else {
    toast('Ошибка сброса', 'err');
  }
}

// Сохранение всех коэффициентов
async function saveAllCoefs() {
  if (!user || !['superadmin', 'editor'].includes(user.role)) {
    toast('Недостаточно прав', 'err');
    return;
  }
  const btn = event?.target;
  if (btn) btn.disabled = true;
  
  let saved = 0;
  let errors = 0;
  
  for (const key of Object.keys(DEFAULT_COEFFICIENTS)) {
    const input = document.getElementById(`coef-${key}`);
    if (input) {
      const success = await saveCoefficient(key, input.value);
      if (success) saved++;
      else errors++;
    }
  }
  
  if (btn) btn.disabled = false;
  
  if (errors === 0) {
    toast(`Все коэффициенты сохранены (${saved}) ✓`, 'ok');
    updatePreview();
  } else {
    toast(`Сохранено: ${saved}, ошибок: ${errors}`, 'err');
  }
}

// Сброс всех коэффициентов
async function resetAllCoefs() {
  if (!user || !['superadmin', 'editor'].includes(user.role)) {
    toast('Недостаточно прав', 'err');
    return;
  }
  if (!confirm('Сбросить все коэффициенты к значениям по умолчанию?')) return;
  
  const btn = event?.target;
  if (btn) btn.disabled = true;
  
  try {
    const token = await getTokenFresh();
    
    // Удаляем все записи из таблицы
    const r = await fetch(`${SB_URL}/rest/v1/coefficients?key=neq.___never___`, {
      method: 'DELETE',
      headers: {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + token,
        'Prefer': 'return=minimal'
      }
    });
    
    if (!r.ok) throw new Error('HTTP ' + r.status);
    
    // Очищаем кэш
    _coefficientsCache = null;
    
    // Перерендериваем страницу
    await renderCoefficientsPage();
    toast('Все коэффициенты сброшены', 'ok');
  } catch(e) {
    toast('Ошибка сброса: ' + e.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Инициализация кэша при загрузке
if (typeof window !== 'undefined') {
  loadCoefficients().catch(() => {});
}
