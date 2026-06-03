// ════════════════════════════════════════════════════════════
// FACTION REGISTRATION — пошаговый визард, страница «Фракции», модерация
// Зависит от: core.js (dbGet/dbPost/dbPatch, SB_URL/SB_ANON, getTokenFresh,
//             esc, toast, setPg), auth.js (user, showAuth, handleImgUpload)
// ════════════════════════════════════════════════════════════

const FR_GOV = ['Республика', 'Монархия', 'Империя', 'Олигархия', 'Диктатура', 'Теократия', 'Технократия', 'Корпоратократия', 'Коллективный разум', 'Машинный разум (ИИ)'];
const FR_REGIME = ['Демократический', 'Эгалитарный', 'Меритократический', 'Плутократический', 'Олигархический', 'Авторитарный', 'Тоталитарный', 'Деспотичный', 'Деспотизм', 'Анархический'];
const FR_RACE = ['Гуманоиды', 'Млекопитающие', 'Рептилоиды', 'Авианы (Птицеподобные)', 'Инсектоиды', 'Акватики (Водные)', 'Плантоиды (Растениевидные)', 'Литоиды (Каменные)', 'Синтетики / Киборги', 'Энергетические сущности'];
const FR_IDEO = ['Технократия (Культ науки)', 'Милитаризм (Культ силы)', 'Пацифизм', 'Экспансионизм', 'Изоляционизм', 'Ксенофилия', 'Ксенофобия', 'Спиритуализм', 'Трансгуманизм', 'Экоцентризм', 'Индустриализм'];
const FR_BUILDINGS = [
  { id: 'encom', name: 'Гражданская фабрика', price: 5 },
  { id: 'ind', name: 'Добывающий завод', price: 5 },
  { id: 'unit', name: 'Торговый хаб', price: 5 },
  { id: 'sci', name: 'Научный Институт', price: 10 },
  { id: 'emb', name: 'Центр Подготовки', price: 5 },
  { id: 'com', name: 'Центр Спецслужб', price: 5 },
  { id: 'yard', name: 'Военный Завод', price: 10 },
  { id: 'mil', name: 'Корабельная Верфь', price: 10 },
];
const FR_POINTS = 20;
const FR_STEPS = ['Политика', 'Цвет', 'Система', 'Постройки', 'Культура', 'История', 'Обзор'];

// ── Описания вариантов (влияние на государство — для погружения) ──
const FR_GOV_DESC = {
  'Республика': 'Власть выборна. + стабильность и дипломатия, решения принимаются медленнее.',
  'Монархия': 'Наследная власть. + легитимность и крепость элиты, риск застоя.',
  'Империя': 'Экспансия и армия. + военная мощь и территория, дороже управление.',
  'Олигархия': 'Власть немногих богатых. + экономика, выше социальное неравенство.',
  'Диктатура': 'Единоличная власть. + скорость решений и мобилизация, хрупкая стабильность.',
  'Теократия': 'Власть веры. + единство и боевой дух, слабее наука.',
  'Технократия': 'Власть учёных. + исследования и эффективность, холодная социалка.',
  'Корпоратократия': 'Власть корпораций. + торговля и производство, слабая лояльность.',
  'Коллективный разум': 'Единое сознание. идеальная координация, нет индивидуальности.',
  'Машинный разум (ИИ)': 'Правит ИИ. + логика и эффективность, страх и недоверие органиков.',
};
const FR_REGIME_DESC = {
  'Демократический': 'Свободы и выборы. + счастье граждан, медленнее переход на военные рельсы.',
  'Эгалитарный': 'Равенство всех. + сплочённость, ниже элитные бонусы.',
  'Меритократический': 'Власть по заслугам. + рост талантов и науки.',
  'Плутократический': 'Правят деньги. + экономика, риск протестов бедноты.',
  'Олигархический': 'Узкий круг власти. + стабильность верхушки, выше коррупция.',
  'Авторитарный': 'Жёсткий контроль. + порядок и армия, меньше свобод.',
  'Тоталитарный': 'Тотальный контроль. + максимум мобилизации, низкое счастье.',
  'Деспотичный': 'Власть страха. + мгновенная воля правителя, риск бунтов.',
  'Деспотизм': 'Абсолютная воля деспота. + поборы и принудительный труд (доход, добыча, тайная полиция), но наука дорожает.',
  'Анархический': 'Нет центральной власти. + свобода и гибкость, хаос и слабая армия.',
};
const FR_CIV_DESC = {
  frontier: 'Молодая колония под защитой Фонда: меньше стартовых ресурсов, но свобода роста и бонус к экспансии. Бесплатно: Центр Спецслужб.',
  colony: 'Состоявшееся планетарное государство: крепкая экономика и производство, но выше обязательства. Бесплатно: Гражданская фабрика.',
};
const FR_RACE_DESC = {
  'Гуманоиды': 'Универсалы. Сбалансированы во всём, без штрафов.',
  'Млекопитающие': 'Живучие и социальные. + рост населения.',
  'Рептилоиды': 'Выносливые хищники. + армия, медленный рост.',
  'Авианы (Птицеподобные)': 'Лёгкие и быстрые. + скорость флота и разведка.',
  'Инсектоиды': 'Роевые. + численность и производство, низкая ценность жизни.',
  'Акватики (Водные)': 'Дети океанов. + бонус на водных мирах, штраф на суше.',
  'Плантоиды (Растениевидные)': 'Самодостаточны. + производство еды, медлительны.',
  'Литоиды (Каменные)': 'Едят минералы, живучи в космосе, очень медленный рост.',
  'Синтетики / Киборги': 'Машинная плоть. не нужна еда, + наука, дорогой ремонт.',
  'Энергетические сущности': 'Чистая энергия. экзотичная мощь, уязвимы к ЭМ-оружию.',
};
const FR_IDEO_DESC = {
  'Технократия (Культ науки)': 'Прогресс превыше всего. + наука.',
  'Милитаризм (Культ силы)': 'Война — путь. + армия и флот.',
  'Пацифизм': 'Мир и рост. + экономика и счастье, слабая армия.',
  'Экспансионизм': 'Расширение границ. дешевле колонии и захват систем.',
  'Изоляционизм': 'Закрытость. + оборона и стабильность, слабая дипломатия.',
  'Ксенофилия': 'Союз с чужаками. + дипломатия и торговля.',
  'Ксенофобия': 'Превосходство своей расы. + война с чужими, штраф к союзам.',
  'Спиритуализм': 'Вера и религия. + единство и боевой дух.',
  'Трансгуманизм': 'Улучшение тела. + наука и боеспособность.',
  'Экоцентризм': 'Гармония с природой. + ресурсы планет, против тяжёлой индустрии.',
  'Индустриализм': 'Производство превыше всего. + фабрики, вред экологии.',
};
const FR_BLD_DESC = {
  encom: 'Производит товары и развивает экономику колонии.',
  ind: 'Добыча руды и минералов с планеты.',
  unit: 'Торговые маршруты и доход кредитами.',
  sci: 'Исследования и новые технологии.',
  emb: 'Обучение специалистов и офицеров.',
  com: 'Разведка, контрразведка и спецоперации.',
  yard: 'Производство наземной техники и войск.',
  mil: 'Постройка и ремонт космических кораблей.',
};
// Описание варианта = атмосферный текст + конкретные игровые эффекты (чипы доктрины).
function frOptInit(map, key, cat) {
  const flavor = `<span class="fr-opt-flavor">${esc(map[key] || '')}</span>`;
  const eff = (cat && typeof ecChoiceChips === 'function') ? ecChoiceChips(cat, key) : '';
  return flavor + eff;
}
function frSetDesc(elId, map, key, cat) { const el = document.getElementById(elId); if (el) el.innerHTML = frOptInit(map, key, cat); }

// ── Совместимость: какие режимы допустимы при форме правления ──
// (исключает абсурд вроде Республика + Тоталитарный)
const FR_GOV_REGIME = {
  'Республика': ['Демократический', 'Эгалитарный', 'Меритократический', 'Плутократический', 'Олигархический'],
  'Монархия': ['Авторитарный', 'Деспотичный', 'Деспотизм', 'Олигархический', 'Меритократический'],
  'Империя': ['Авторитарный', 'Тоталитарный', 'Деспотичный', 'Деспотизм', 'Олигархический', 'Меритократический'],
  'Олигархия': ['Олигархический', 'Плутократический', 'Авторитарный', 'Меритократический'],
  'Диктатура': ['Авторитарный', 'Тоталитарный', 'Деспотичный', 'Деспотизм'],
  'Теократия': ['Авторитарный', 'Тоталитарный', 'Деспотичный', 'Деспотизм', 'Олигархический'],
  'Технократия': ['Меритократический', 'Авторитарный', 'Олигархический', 'Эгалитарный'],
  'Корпоратократия': ['Плутократический', 'Олигархический', 'Авторитарный'],
  'Коллективный разум': ['Эгалитарный', 'Тоталитарный', 'Авторитарный'],
  'Машинный разум (ИИ)': ['Тоталитарный', 'Авторитарный', 'Меритократический'],
};
function frAllowedRegimes(gov) { return FR_GOV_REGIME[gov] || FR_REGIME; }
function frOnGovChange(gov) {
  FR.data.gov = gov;
  frSetDesc('f-gov-d', FR_GOV_DESC, gov, 'gov');
  const allowed = frAllowedRegimes(gov);
  const sel = document.getElementById('f-regime'); if (!sel) return;
  const val = allowed.includes(sel.value) ? sel.value : allowed[0];
  sel.innerHTML = allowed.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('');
  FR.data.regime = val;
  frSetDesc('f-regime-d', FR_REGIME_DESC, val, 'regime');
}

const FR = { data: null, step: 0, freeSystems: null, allSystems: null, busy: false };

function frBlank() {
  return {
    id: null, status: 'draft', name: '', color: 'rgba(80,150,255,0.34)',
    gov: FR_GOV[0], regime: FR_REGIME[0], leader: '', civ_type: 'frontier',
    system_id: null, system_name: '', planet_name: '', planet_type: '', capital_env: '',
    buildings: [], bonus_money: false,
    race: FR_RACE[0], ideology: FR_IDEO[0], culture: '', history: '', link: '', herald_url: '',
  };
}
function frFreeBuilding(t) { return t === 'frontier' ? 'com' : 'encom'; }
function frHexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return `rgba(80,150,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function frRgbaToHex(rgba) {
  const m = /rgba?\(([^)]+)\)/.exec(rgba || ''); if (!m) return '#5096ff';
  const p = m[1].split(',').map(s => parseInt(s));
  return '#' + [p[0], p[1], p[2]].map(x => (x || 0).toString(16).padStart(2, '0')).join('');
}
function frSolid(rgba) { const m = /rgba?\(([^)]+)\)/.exec(rgba || ''); if (!m) return '#5096ff'; const p = m[1].split(',').map(s => s.trim()); return `rgb(${p[0]},${p[1]},${p[2]})`; }
// цвет, читаемый на тёмном фоне (тёмные осветляет, сохраняя оттенок)
function frReadable(c) {
  let r, g, b; const m = /rgba?\(([^)]+)\)/.exec(c || '');
  if (c && c[0] === '#') { const n = parseInt(c.slice(1), 16); r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  else if (m) { const p = m[1].split(',').map(s => parseFloat(s)); r = p[0] | 0; g = p[1] | 0; b = p[2] | 0; }
  else return '#cfe3ff';
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.5) { const f = 0.45 + (0.5 - lum) * 0.8; r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f); }
  return `rgb(${r},${g},${b})`;
}

// ── Загрузка моей анкеты ─────────────────────────────────────
async function frLoadMine() {
  if (!user) return null;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&order=updated_at.desc&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════
// ВИЗАРД (#faction-new)
// ════════════════════════════════════════════════════════════
async function renderFactionWizard() {
  if (!user) {
    setPg(`<div class="fr-gate"><div class="fr-gate-ico">◈</div>
      <h2>Регистрация государства</h2>
      <p>Чтобы подать анкету, войдите или зарегистрируйтесь.</p>
      <button class="btn btn-gd" onclick="showAuth('register')">Регистрация / Вход</button></div>`);
    return;
  }
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  const mine = await frLoadMine();
  if (mine && mine.status === 'pending') {
    // на модерации — редактировать нельзя, показываем статус
    setPg(frStatusCard(mine));
    return;
  }
  FR.editApproved = !!(mine && mine.status === 'approved'); // редактирование своей фракции
  FR.data = mine ? { ...frBlank(), ...mine, buildings: mine.buildings || [] } : frBlank();
  // при редактировании — реальная столичная колония (источник истины для имени/системы)
  FR.myCapital = null;
  if (FR.editApproved && mine.faction_id) {
    try {
      const cols = await dbGet('colonies', `faction_id=eq.${encodeURIComponent(mine.faction_id)}&select=*`) || [];
      const cap = cols.find(c => c.is_capital) || cols.find(c => c.planet_type === 'Столичный мир') || cols[0];
      if (cap) {
        let sysName = mine.system_name;
        try { const ss = await dbGet('map_systems', `id=eq.${encodeURIComponent(cap.system_id)}&select=name`); if (ss && ss[0]) sysName = ss[0].name; } catch (e) {}
        FR.myCapital = { id: cap.id, system_name: sysName, planet_name: cap.planet_name };
        // в анкету кладём РЕАЛЬНОЕ имя столицы (а не устаревшее анкетное),
        // чтобы при отправке без правки не «откатывалось» старое значение
        FR.data.planet_name = cap.planet_name;
      }
    } catch (e) {}
  }
  FR.step = 0;
  FR.freeSystems = null; FR.allSystems = null;
  // Восстановление несохранённого черновика из localStorage (после перезагрузки).
  // Только для новой анкеты (не редактирование одобренной) и если локальная копия
  // не старше серверного черновика.
  if (!FR.editApproved) {
    const local = frLoadLocal();
    const serverTs = mine && mine.updated_at ? Date.parse(mine.updated_at) || 0 : 0;
    if (local && (local.ts || 0) >= serverTs) {
      FR.data = { ...FR.data, ...local.data };
      if (!Array.isArray(FR.data.buildings)) FR.data.buildings = [];
      FR.step = Math.min(Math.max(0, local.step | 0), FR_STEPS.length - 1);
      toast('Восстановлен несохранённый черновик', 'inf');
    }
  }
  frBindAutosave();
  frRenderStep();
}

function frStatusCard(app) {
  const st = { pending: ['НА МОДЕРАЦИИ', 'var(--color-warning)', 'Анкета отправлена. Ожидайте решения администрации.'],
    approved: ['ОДОБРЕНО', 'var(--ok)', 'Ваше государство принято! Оно на карте и на странице «Фракции».'] }[app.status] || ['ЧЕРНОВИК', 'var(--t3)', ''];
  return `<div class="fr-wrap"><div class="fr-status-card">
    <div class="fr-status-badge" style="color:${st[1]};border-color:${st[1]}">${st[0]}</div>
    <h2>${esc(app.name || 'Без названия')}</h2>
    <p>${st[2]}</p>
    <div class="fr-actions"><button class="btn btn-gh" onclick="go('factions')">К списку фракций</button></div>
  </div></div>`;
}

function frRenderStep() {
  const d = FR.data;
  let body = '';
  switch (FR.step) {
    case 0: body = frStepPolitics(d); break;
    case 1: body = frStepColor(d); break;
    case 2: body = frStepSystem(d); break;
    case 3: body = frStepBuildings(d); break;
    case 4: body = frStepCulture(d); break;
    case 5: body = frStepHistory(d); break;
    case 6: body = frStepReview(d); break;
  }
  const dots = FR_STEPS.map((s, i) =>
    `<div class="fr-dot${i === FR.step ? ' on' : ''}${i < FR.step ? ' done' : ''}" onclick="frGoStep(${i})"><span>${i + 1}</span><label>${s}</label></div>`).join('');
  const isLast = FR.step === FR_STEPS.length - 1;
  setPg(`<div class="fr-wrap fr-wizard">
    <div class="fr-hero">
      <div class="fr-eyebrow">◈ ВСТУПЛЕНИЕ В ИГРУ</div>
      <h1 class="fr-title">${FR.editApproved ? 'Редактирование фракции' : 'Регистрация государства'}</h1>
      <div class="fr-sub">Шаг ${FR.step + 1} / ${FR_STEPS.length} — ${esc(FR_STEPS[FR.step])}</div>
    </div>
    <div class="fr-steps">${dots}</div>
    <div class="fr-body" id="fr-body">${body}</div>
    <div class="fr-foot">
      <button class="btn btn-gh" onclick="frPrev()" ${FR.step === 0 ? 'disabled' : ''}>← Назад</button>
      ${FR.editApproved ? '' : `<button class="btn btn-gh" onclick="frSaveDraft()">💾 Сохранить черновик</button>`}
      ${isLast
        ? `<button class="btn btn-gd" onclick="frSubmit()">${FR.editApproved ? 'Сохранить изменения ✓' : 'Отправить на модерацию ✓'}</button>`
        : `<button class="btn btn-gd" onclick="frNext()">Далее →</button>`}
    </div>
  </div>`);
  if (FR.step === 2 && !FR.editApproved) frRenderSystemPicker();
}

// ── Шаги ─────────────────────────────────────────────────────
function frSel(id, opts, val, onch) {
  return `<select class="fi" id="${id}"${onch ? ` onchange="${onch}"` : ''}>` +
    opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('') + `</select>`;
}
function frStepPolitics(d) {
  return `<h3 class="fr-h3">I. Политические сведения</h3>
    <p class="fr-note">Эти решения формируют облик и сильные стороны вашего государства.</p>
    <div class="fg"><label class="fl">Полное название фракции *</label>
      <input class="fi" id="f-name" value="${esc(d.name)}" placeholder="Например: Объединённые Земные Нации"></div>
    <div class="fgr2">
      <div class="fg"><label class="fl">Форма правления</label>
        ${frSel('f-gov', FR_GOV, d.gov, "frOnGovChange(this.value)")}
        <div class="fr-opt-desc" id="f-gov-d">${frOptInit(FR_GOV_DESC, d.gov, 'gov')}</div></div>
      ${(() => { const allowed = frAllowedRegimes(d.gov); const rv = allowed.includes(d.regime) ? d.regime : allowed[0]; d.regime = rv; return `<div class="fg"><label class="fl">Политический режим <span class="fr-hint-i" title="Список зависит от формы правления">ⓘ</span></label>
        ${frSel('f-regime', allowed, rv, "frSetDesc('f-regime-d',FR_REGIME_DESC,this.value,'regime')")}
        <div class="fr-opt-desc" id="f-regime-d">${frOptInit(FR_REGIME_DESC, rv, 'regime')}</div></div>`; })()}
    </div>
    <div class="fgr2">
      <div class="fg"><label class="fl">Глава фракции</label><input class="fi" id="f-leader" value="${esc(d.leader)}" placeholder="Имя и титул"></div>
      <div class="fg"><label class="fl">Тип цивилизации</label>
        <select class="fi" id="f-type" onchange="frSetDesc('f-type-d',FR_CIV_DESC,this.value,'civ')">
          <option value="frontier"${d.civ_type === 'frontier' ? ' selected' : ''}>Зарождающийся фронтир</option>
          <option value="colony"${d.civ_type === 'colony' ? ' selected' : ''}>Самостоятельная колония</option>
        </select>
        <div class="fr-opt-desc" id="f-type-d">${frOptInit(FR_CIV_DESC, d.civ_type, 'civ')}</div></div>
    </div>`;
}
function frStepColor(d) {
  const hex = frRgbaToHex(d.color);
  return `<h3 class="fr-h3">Цвет фракции</h3>
    <p class="fr-note">Этим цветом окрасится территория вашего государства на карте галактики.</p>
    <div class="fr-color-row">
      <input type="color" id="f-color" value="${hex}" oninput="frColorPreview(this.value)">
      <div class="fr-color-prev" id="f-color-prev" style="background:${d.color};border-color:${frSolid(d.color)}">территория</div>
    </div>`;
}
function frStepSystem(d) {
  if (FR.editApproved) {
    const cap = FR.myCapital || { system_name: d.system_name, planet_name: d.planet_name };
    return `<h3 class="fr-h3">Столичная система</h3>
      <div class="fr-locked">🔒 Стартовая система закреплена за фракцией и не может быть изменена.</div>
      <div class="fr-sys-picked">Столица: <b>${esc(cap.system_name || '—')}${cap.planet_name ? ' / ' + esc(cap.planet_name) : ''}</b></div>
      <div class="fg" style="margin-top:12px"><label class="fl">Название столичной планеты</label>
        <input class="fi" id="f-planet" value="${esc(cap.planet_name || d.planet_name || '')}" placeholder="Название планеты" oninput="FR.data.planet_name=this.value.trim()"></div>
      <div class="fr-note" style="margin-top:8px">Изменение имени уйдёт на <b>проверку администрации</b> вместе с анкетой (кнопка «Сохранить» внизу). После одобрения название обновится на карте, странице фракций и в кабинете.</div>`;
  }
  return `<h3 class="fr-h3">Столичная система</h3>
    <p class="fr-note">Выберите <b>свободную</b> звезду: <span style="color:var(--gd)">голубые</span> свободны, серые заняты. Ваша столичная планета будет создана прямо в этой системе на карте.</p>
    <div class="fr-minimap" id="f-minimap"><div class="sload" style="min-height:60px"><div class="pulse-loader"></div></div></div>
    <div class="fg"><input class="fi" id="f-sys-search" placeholder="Поиск системы..." oninput="frFilterSystems(this.value)"></div>
    <div class="fr-sys-picked" id="f-sys-picked">${d.system_id ? `Выбрано: <b>${esc(d.system_name)}</b>` : 'Система не выбрана'}</div>
    <div class="fr-sys-list" id="f-sys-list"></div>
    <div class="fgr2" style="margin-top:14px">
      <div class="fg"><label class="fl">Раса (определяет родные миры)</label>
        ${frSel('f-reg-race', FR_RACE, d.race, "frOnRegRace(this.value)")}</div>
      <div class="fg"><label class="fl">Название столичной планеты</label>
        <input class="fi" id="f-planet" value="${esc(d.planet_name)}" placeholder="Имя вашей столицы" oninput="FR.data.planet_name=this.value"></div>
    </div>
    <div class="fr-planet-pick" id="f-planet-pick"></div>`;
}
// Выбор типа столичной планеты — родной мир расы. Имя вводится игроком (поле f-planet),
// тип определяется расой (EC_HAB). Если родных миров несколько — игрок выбирает.
function frRenderPlanetPick() {
  const box = document.getElementById('f-planet-pick'); if (!box) return;
  const race = FR.data.race;
  const envs = (typeof EC_HAB !== 'undefined' && EC_HAB[race]) ? EC_HAB[race] : ['terrestrial'];
  const lbl = (typeof EC_GRP_LABEL !== 'undefined') ? EC_GRP_LABEL : {};
  // авто-выбор, если среда одна или текущая не входит в родные миры расы
  if (!FR.data.capital_env || !envs.includes(FR.data.capital_env)) FR.data.capital_env = envs[0];
  if (envs.length <= 1) {
    box.innerHTML = `<div class="fr-cap-note">Тип столицы: <b>${esc(lbl[envs[0]] || envs[0])}</b> — единственный родной мир вашей расы.</div>`;
    return;
  }
  const chips = envs.map(e => `<div class="fr-cap-chip${FR.data.capital_env === e ? ' on' : ''}" onclick="frPickCapEnv('${e}')">${esc(lbl[e] || e)}</div>`).join('');
  box.innerHTML = `<div class="fr-cap-label">Родной мир столицы (по расе):</div><div class="fr-cap-chips">${chips}</div>`;
}
function frOnRegRace(v) { FR.data.race = v; frRenderPlanetPick(); }
function frPickCapEnv(env) { FR.data.capital_env = env; frSaveLocal(); frRenderPlanetPick(); }
// Переименование столицы прямо в анкете — через единый источник (colonies + map_systems).
async function frRenameCapital() {
  if (!FR.myCapital || !FR.myCapital.id) { toast('Столица ещё не создана', 'err'); return; }
  const v = (document.getElementById('f-cap-rename')?.value || '').trim();
  if (!v) { toast('Введите название', 'err'); return; }
  if (v === FR.myCapital.planet_name) { toast('Имя не изменилось', 'inf'); return; }
  try {
    await apiFetch('rpc/rename_colony', { method: 'POST', body: JSON.stringify({ p_colony_id: FR.myCapital.id, p_new_name: v }) });
    FR.myCapital.planet_name = v; FR.data.planet_name = v;
    toast('Столица переименована', 'ok');
    frRenderStep();
  } catch (e) { toast('Не удалось переименовать: ' + e.message, 'err'); }
}
function frStepBuildings(d) {
  const free = frFreeBuilding(d.civ_type);
  if (FR.editApproved) {
    const chosen = [free, ...d.buildings.filter(b => b !== free)];
    const rows = chosen.map(id => { const b = FR_BUILDINGS.find(x => x.id === id); if (!b) return ''; return `<div class="fr-bld" style="cursor:default">
      <div class="fr-bld-txt"><span class="fr-bld-name">${esc(b.name)}${id === free ? ' (беспл.)' : ''}</span><span class="fr-bld-desc">${esc(FR_BLD_DESC[id] || '')}</span></div></div>`; }).join('');
    return `<h3 class="fr-h3">Стартовые бонусы</h3>
      <div class="fr-locked">🔒 Стартовые постройки закреплены и не меняются после одобрения.</div>
      <div class="fr-bld-grid">${rows}</div>
      ${d.bonus_money ? '<div class="fr-bld" style="cursor:default;margin-top:8px"><div class="fr-bld-txt"><span class="fr-bld-name">+ 500 галактических стандартов</span></div></div>' : ''}`;
  }
  const spent = frSpent(d);
  const rows = FR_BUILDINGS.map(b => {
    const isFree = b.id === free;
    const checked = isFree || d.buildings.includes(b.id);
    return `<label class="fr-bld${isFree ? ' free' : ''}">
      <input type="checkbox" data-bid="${b.id}" data-price="${b.price}" ${checked ? 'checked' : ''} ${isFree ? 'disabled' : ''} onchange="frToggleBld()">
      <div class="fr-bld-txt"><span class="fr-bld-name">${esc(b.name)}</span><span class="fr-bld-desc">${esc(FR_BLD_DESC[b.id] || '')}</span></div>
      <span class="fr-bld-price">${isFree ? 'БЕСПЛАТНО' : b.price + ' оч.'}</span>
    </label>`;
  }).join('');
  return `<h3 class="fr-h3">Стартовые бонусы</h3>
    <div class="fr-points">Доступно очков строительства: <span id="fr-points-val">${FR_POINTS - spent}</span> / ${FR_POINTS}</div>
    <div class="fr-bld-grid">${rows}</div>
    <label class="fr-bld" style="margin-top:8px">
      <input type="checkbox" id="f-money" ${d.bonus_money ? 'checked' : ''} onchange="frToggleBld()">
      <span class="fr-bld-name">+ 500 галактических стандартов</span>
      <span class="fr-bld-price">10 оч.</span>
    </label>`;
}
function frStepCulture(d) {
  return `<h3 class="fr-h3">III. Культурные сведения</h3>
    <div class="fgr2">
      <div class="fg"><label class="fl">Биологический вид (раса)</label>
        ${frSel('c-race', FR_RACE, d.race, "frSetDesc('c-race-d',FR_RACE_DESC,this.value,'race')")}
        <div class="fr-opt-desc" id="c-race-d">${frOptInit(FR_RACE_DESC, d.race, 'race')}</div></div>
      <div class="fg"><label class="fl">Идеология / Этика</label>
        ${frSel('c-ideo', FR_IDEO, d.ideology, "frSetDesc('c-ideo-d',FR_IDEO_DESC,this.value,'ideology')")}
        <div class="fr-opt-desc" id="c-ideo-d">${frOptInit(FR_IDEO_DESC, d.ideology, 'ideology')}</div></div>
    </div>
    <div class="fg"><label class="fl">Культурные особенности</label>
      <textarea class="fi" id="c-features" rows="4" placeholder="Традиции, менталитет, быт...">${esc(d.culture)}</textarea></div>`;
}
function frStepHistory(d) {
  const len = (d.history || '').length;
  return `<h3 class="fr-h3">IV. Исторические сведения</h3>
    <div class="fg"><label class="fl">История фракции</label>
      <textarea class="fi fr-history-input" id="h-history" rows="12"
        placeholder="Происхождение народа, ключевые события, войны и союзы, нынешнее положение... Пишите столько, сколько нужно — длинный текст будет аккуратно свёрнут в карточке фракции."
        oninput="const c=document.getElementById('h-history-count');if(c)c.textContent=this.value.length+' символов'">${esc(d.history)}</textarea>
      <div class="fr-input-hint" id="h-history-count">${len} символов</div></div>
    <div class="fg"><label class="fl">Ссылка на фракцию (группа/статья)</label>
      <input class="fi" id="h-link" value="${esc(d.link)}" placeholder="https://..."></div>
    <div class="fg"><label class="fl">Геральдика (герб фракции)</label>
      <input type="file" id="h-herald-file" accept="image/*" style="display:none" onchange="frUploadHerald(this)">
      <button class="btn btn-gh btn-fw" onclick="document.getElementById('h-herald-file').click()">📁 Загрузить герб</button>
      <div class="fr-herald-prev" id="f-herald-prev">${d.herald_url ? `<img src="${esc(d.herald_url)}">` : '<span>нет изображения</span>'}</div></div>`;
}
function frStepReview(d) {
  const blds = d.buildings.map(id => FR_BUILDINGS.find(b => b.id === id)?.name).filter(Boolean);
  const free = FR_BUILDINGS.find(b => b.id === frFreeBuilding(d.civ_type))?.name;
  const row = (k, v) => `<div class="fr-rev-row"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
  return `<h3 class="fr-h3">Обзор анкеты</h3>
    <div class="fr-rev">
      ${row('Название', d.name)}
      ${row('Правление', d.gov + ' · ' + d.regime)}
      ${row('Глава', d.leader)}
      ${row('Тип', d.civ_type === 'frontier' ? 'Зарождающийся фронтир' : 'Самостоятельная колония')}
      <div class="fr-rev-row"><span>Цвет</span><b><span class="fr-swatch" style="background:${d.color}"></span></b></div>
      ${row('Система', d.system_name)}
      ${row('Планета', d.planet_name)}
      ${row('Постройки', [free + ' (беспл.)', ...blds].filter(Boolean).join(', '))}
      ${row('Финансы', d.bonus_money ? '+500 стандартов' : 'Стартовый капитал')}
      ${row('Раса', d.race)}
      ${row('Идеология', d.ideology)}
    </div>
    ${frLoreBlock('Культура', d.culture)}
    ${frLoreBlock('История', d.history)}
    ${typeof ecDoctrineHtml === 'function' ? `<div class="fr-doctrine" style="margin-top:14px">${ecDoctrineHtml(d)}</div>` : ''}
    <p class="fr-note">Выбор правления, режима, идеологии, расы и типа реально влияет на экономику — см. «Доктрину» выше. После отправки анкета попадёт на модерацию.</p>`;
}

// ── Состояние / навигация ───────────────────────────────────
function frSyncStep() {
  const d = FR.data, g = id => document.getElementById(id);
  if (FR.step === 0) { d.name = g('f-name').value.trim(); d.gov = g('f-gov').value; d.regime = g('f-regime').value; d.leader = g('f-leader').value.trim(); d.civ_type = g('f-type').value; }
  else if (FR.step === 1) { d.color = frHexToRgba(g('f-color').value, 0.34); }
  else if (FR.step === 2) { if (g('f-planet')) d.planet_name = g('f-planet').value.trim(); }
  else if (FR.step === 4) { d.race = g('c-race').value; d.ideology = g('c-ideo').value; d.culture = g('c-features').value.trim(); }
  else if (FR.step === 5) { d.link = g('h-link').value.trim(); if (g('h-history')) d.history = g('h-history').value; }
  // step3 (постройки) и герб синхронизируются в своих обработчиках
}
function frGoStep(i) { frSyncStep(); FR.step = i; frSaveLocal(); frRenderStep(); }
function frNext() {
  frSyncStep();
  if (FR.step === 0 && !FR.data.name) { toast('Укажите название фракции', 'err'); return; }
  if (FR.step === 2 && !FR.data.system_id) { toast('Выберите свободную систему', 'err'); return; }
  FR.step = Math.min(FR.step + 1, FR_STEPS.length - 1); frSaveLocal(); frRenderStep();
}
function frPrev() { frSyncStep(); FR.step = Math.max(FR.step - 1, 0); frSaveLocal(); frRenderStep(); }

// ── Автосохранение черновика в localStorage (без потери при перезагрузке) ──
function frDraftKey() { return 'fr_draft_' + (user ? user.id : 'anon'); }
function frSaveLocal() {
  // Черновики новой анкеты кэшируем локально; редактирование одобренной фракции — нет
  // (там источник истины на сервере, перезагрузка подтянет актуальную копию).
  if (!user || FR.editApproved || !FR.data) return;
  try { frSyncStep(); } catch (e) { /* инпуты текущего шага могут отсутствовать */ }
  try {
    localStorage.setItem(frDraftKey(), JSON.stringify({ data: FR.data, step: FR.step, ts: Date.now() }));
  } catch (e) { /* приватный режим / переполнение */ }
}
let _frSaveTimer = null;
function frSaveLocalDebounced() { clearTimeout(_frSaveTimer); _frSaveTimer = setTimeout(frSaveLocal, 300); }
function frLoadLocal() {
  if (!user) return null;
  try { const raw = localStorage.getItem(frDraftKey()); if (!raw) return null; const o = JSON.parse(raw); return (o && o.data) ? o : null; }
  catch (e) { return null; }
}
function frClearLocal() { try { localStorage.removeItem(frDraftKey()); } catch (e) {} }
// Однократная привязка слушателей автосохранения (ввод + закрытие/перезагрузка вкладки)
function frBindAutosave() {
  if (FR._autoSaveBound) return; FR._autoSaveBound = true;
  const inWizard = e => e.target && e.target.closest && e.target.closest('.fr-wizard');
  document.addEventListener('input', e => { if (inWizard(e)) frSaveLocalDebounced(); });
  document.addEventListener('change', e => { if (inWizard(e)) frSaveLocalDebounced(); });
  window.addEventListener('beforeunload', () => { try { clearTimeout(_frSaveTimer); frSaveLocal(); } catch (e) {} });
}

function frColorPreview(hex) {
  FR.data.color = frHexToRgba(hex, 0.34);
  const p = document.getElementById('f-color-prev');
  if (p) { p.style.background = FR.data.color; p.style.borderColor = frSolid(FR.data.color); }
}
function frSpent(d) {
  let s = d.buildings.reduce((a, id) => a + (FR_BUILDINGS.find(b => b.id === id)?.price || 0), 0);
  if (d.bonus_money) s += 10;
  return s;
}
function frToggleBld() {
  const d = FR.data;
  const sel = [...document.querySelectorAll('#fr-body [data-bid]:checked:not(:disabled)')].map(c => c.dataset.bid);
  const money = document.getElementById('f-money')?.checked || false;
  let spent = sel.reduce((a, id) => a + (FR_BUILDINGS.find(b => b.id === id)?.price || 0), 0) + (money ? 10 : 0);
  if (spent > FR_POINTS) { toast('Превышен лимит очков (' + FR_POINTS + ')', 'err'); event.target.checked = false; return; }
  d.buildings = sel; d.bonus_money = money;
  const pv = document.getElementById('fr-points-val'); if (pv) pv.textContent = FR_POINTS - spent;
}

async function frUploadHerald(input) {
  const file = input.files?.[0]; if (!file) return;
  await handleImgUpload(file, url => {
    FR.data.herald_url = url;
    const p = document.getElementById('f-herald-prev'); if (p) p.innerHTML = `<img src="${esc(url)}">`;
    frSaveLocal();
  });
}

// ── Система: список свободных ───────────────────────────────
async function frRenderSystemPicker() {
  if (FR.allSystems === null) {
    let sys = [], taken = new Set();
    try { sys = await dbGet('map_systems', 'select=id,name,faction,star_type,x,y,planets') || []; } catch (e) { sys = []; }
    // занятые чужими анкетами — необязательный запрос (таблица может отсутствовать)
    try {
      const apps = await dbGet('faction_applications', 'select=system_id,status&status=in.(pending,approved)');
      taken = new Set((apps || []).map(a => a.system_id).filter(Boolean));
    } catch (e) { /* нет таблицы анкет — игнорируем */ }
    FR.allSystems = sys.map(s => ({ ...s, x: +s.x, y: +s.y, planets: s.planets || [] }));
    FR.freeSystems = FR.allSystems.filter(s => !s.faction && (!taken.has(s.id) || s.id === FR.data.system_id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  frRenderMinimap();
  frFilterSystems(document.getElementById('f-sys-search')?.value || '');
  frRenderPlanetPick();
}
function GM_BASE_SAFE() { return (typeof GM_BASE !== 'undefined') ? GM_BASE : 'assets/map/'; }

function frRenderMinimap() {
  const box = document.getElementById('f-minimap'); if (!box) return;
  const all = FR.allSystems || [];
  if (!all.length) { box.innerHTML = `<div class="fr-empty">Карта недоступна</div>`; return; }
  const W = (typeof GM_W !== 'undefined') ? GM_W : 3300, H = (typeof GM_H !== 'undefined') ? GM_H : 2062;
  const freeIds = new Set((FR.freeSystems || []).map(s => s.id));
  const sel = FR.data.system_id;
  const dots = all.map(s => {
    const isFree = freeIds.has(s.id), isSel = s.id === sel;
    const r = isSel ? 38 : isFree ? 24 : 15;
    const cls = 'fr-mm-dot' + (isFree ? ' free' : ' taken') + (isSel ? ' sel' : '');
    const click = isFree ? ` onclick="frPickSystem('${esc(s.id)}','${esc(s.name).replace(/'/g, '&#39;')}')"` : '';
    return `<circle class="${cls}" cx="${s.x}" cy="${s.y}" r="${r}"${click}><title>${esc(s.name)}${isFree ? ' (свободна)' : ' (занята)'}</title></circle>`;
  }).join('');
  const selSys = all.find(s => s.id === sel);
  const lbl = selSys ? `<text x="${selSys.x}" y="${selSys.y - 52}" class="fr-mm-lbl" text-anchor="middle">${esc(selSys.name)}</text>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${dots}${lbl}</svg>`;
}

function frFilterSystems(q) {
  const box = document.getElementById('f-sys-list'); if (!box) return;
  q = (q || '').toLowerCase().trim();
  const list = (FR.freeSystems || []).filter(s => !q || s.name.toLowerCase().includes(q));
  if (!list.length) { box.innerHTML = `<div class="fr-empty">Свободных систем не найдено</div>`; return; }
  box.innerHTML = list.map(s => `<div class="fr-sys-item${FR.data.system_id === s.id ? ' on' : ''}" onclick="frPickSystem('${esc(s.id)}','${esc(s.name).replace(/'/g, "&#39;")}')">
    <img src="${GM_BASE_SAFE()}stars/star_${esc(s.star_type || 'yellow')}.png" onerror="this.style.visibility='hidden'">
    <span>${esc(s.name)}</span>${FR.data.system_id === s.id ? '<i>✓</i>' : ''}</div>`).join('');
}
function frPickSystem(id, name) {
  FR.data.system_id = id; FR.data.system_name = name;
  // имя столицы вводит игрок и оно не зависит от системы — не сбрасываем
  const p = document.getElementById('f-sys-picked'); if (p) p.innerHTML = `Выбрано: <b>${esc(name)}</b>`;
  frFilterSystems(document.getElementById('f-sys-search')?.value || '');
  frSaveLocal();
  frRenderMinimap();
  frRenderPlanetPick();
}

// ── Сохранение ──────────────────────────────────────────────
async function frUpsert(status, extra) {
  frSyncStep();
  const d = FR.data;
  const body = {
    owner_id: user.id, owner_email: user.email, status,
    name: d.name, color: d.color, gov: d.gov, regime: d.regime, leader: d.leader, civ_type: d.civ_type,
    system_id: d.system_id, system_name: d.system_name, planet_name: d.planet_name, capital_env: d.capital_env || null,
    buildings: d.buildings, bonus_money: d.bonus_money,
    race: d.race, ideology: d.ideology, culture: d.culture, history: d.history, link: d.link, herald_url: d.herald_url,
    updated_at: new Date().toISOString(),
    ...(extra || {}),
  };
  if (d.id) { await dbPatch('faction_applications', 'id=eq.' + d.id, body); return d.id; }
  const rows = await dbPost('faction_applications', body);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row && row.id) d.id = row.id;
  return d.id;
}
async function frSaveDraft() {
  if (FR.busy) return; FR.busy = true;
  try { await frUpsert('draft'); frClearLocal(); toast('Черновик сохранён', 'ok'); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FR.busy = false; }
}
async function frSubmit() {
  if (FR.busy) return;
  frSyncStep();
  if (!FR.data.name) { toast('Укажите название', 'err'); FR.step = 0; frRenderStep(); return; }
  if (typeof badName === 'function' && badName(FR.data.name)) { toast('Название фракции содержит недопустимые слова (мат или запрещённое)', 'err'); FR.step = 0; frRenderStep(); return; }
  if (typeof badName === 'function' && badName(FR.data.planet_name)) { toast('Название столичной планеты содержит недопустимые слова (мат или запрещённое)', 'err'); FR.step = 2; frRenderStep(); return; }
  if (!FR.data.system_id) { toast('Выберите систему', 'err'); FR.step = 2; frRenderStep(); return; }
  FR.busy = true;
  try {
    if (FR.editApproved) { await frUpsert('approved', { pending_review: true }); toast('Изменения отправлены на проверку администрации', 'ok'); }
    else { await frUpsert('pending'); toast('Анкета отправлена на модерацию!', 'ok'); }
    frClearLocal();
    go('factions');
  }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FR.busy = false; }
}

// ════════════════════════════════════════════════════════════
// СТРАНИЦА «ФРАКЦИИ» (#factions)
// ════════════════════════════════════════════════════════════
// Столица фракции из РЕАЛЬНОЙ столичной колонии (is_capital), а не из анкеты.
let _frCapCache = null, _frCapCacheTs = 0;
async function frLoadCapitals() {
  // кэш 30 с: страница фракций + каждая модалка иначе грузили бы все колонии заново
  if (_frCapCache && Date.now() - _frCapCacheTs < 30000) return _frCapCache;
  try {
    const [caps, sys] = await Promise.all([
      dbGet('colonies', 'select=faction_id,system_id,planet_name,planet_type,is_capital').catch(() => dbGet('colonies', 'select=faction_id,system_id,planet_name,planet_type').catch(() => [])),
      dbGet('map_systems', 'select=id,name').catch(() => []),
    ]);
    const sysNames = {}; (sys || []).forEach(s => { sysNames[s.id] = s.name; });
    const byFid = {};
    // столица = is_capital (после миграции) ИЛИ planet_type='Столичный мир' (текущий признак)
    (caps || []).forEach(c => {
      if (!c.faction_id) return;
      if ((c.is_capital || c.planet_type === 'Столичный мир') && !byFid[c.faction_id]) byFid[c.faction_id] = c;
    });
    // fallback: нет помеченной столицы — берём любую реальную колонию (лишь бы не данные анкеты)
    (caps || []).forEach(c => { if (c.faction_id && !byFid[c.faction_id]) byFid[c.faction_id] = c; });
    _frCapCache = { byFid, sysNames }; _frCapCacheTs = Date.now();
    return _frCapCache;
  } catch (e) { return { byFid: {}, sysNames: {} }; }
}
// Актуальные система и планета столицы фракции f (fallback на анкету).
function frCapital(f, cap) {
  const c = cap && cap.byFid[f.faction_id];
  const sysName = c ? (cap.sysNames[c.system_id] || f.system_name || '—') : (f.system_name || '—');
  const planet = c ? (c.planet_name || f.planet_name || '') : (f.planet_name || '');
  return { sysName, planet };
}

async function renderFactionsPage() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  let approved = [], mine = null, cap = { byFid: {}, sysNames: {} };
  try {
    const [ap, capData] = await Promise.all([
      dbGet('faction_applications', 'status=eq.approved&order=name.asc'),
      frLoadCapitals(),
    ]);
    approved = ap || []; cap = capData;
  } catch (e) {}
  if (user) mine = await frLoadMine();

  const canCreate = !mine || mine.status === 'rejected' || mine.status === 'draft';
  let mineHtml = '';
  if (mine) {
    const st = { draft: ['ЧЕРНОВИК', 'var(--t3)'], pending: ['НА МОДЕРАЦИИ', 'var(--color-warning)'], approved: ['ОДОБРЕНО', 'var(--ok)'], rejected: ['ОТКЛОНЕНО', 'var(--err)'] }[mine.status] || ['—', 'var(--t3)'];
    mineHtml = `<div class="fr-mine">
      <div class="fr-mine-hd"><span class="fr-status-badge" style="color:${st[1]};border-color:${st[1]}">${st[0]}</span>
        <span class="fr-mine-name">${esc(mine.name || 'Моя анкета')}</span></div>
      ${mine.status === 'rejected' && mine.reject_reason ? `<div class="fr-reject">Причина отклонения: ${esc(mine.reject_reason)}</div>` : ''}
      <div class="fr-actions">
        ${mine.status !== 'pending' ? `<button class="btn btn-gd btn-sm" onclick="go('faction-new')">${mine.status === 'approved' ? '✎ Редактировать' : 'Продолжить анкету'}</button>` : ''}
        ${mine.status === 'approved' ? `<button class="btn btn-gh btn-sm" onclick="frViewFaction('${mine.id}')">Открыть</button>` : ''}
      </div></div>`;
  }

  const cards = approved.map(f => `<div class="fr-card" onclick="frViewFaction('${f.id}')">
      <div class="fr-card-bar" style="background:${frReadable(f.color)}"></div>
      <div class="fr-card-herald">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : '<span style="color:' + frReadable(f.color) + '">◈</span>'}</div>
      <div class="fr-card-main">
        <div class="fr-card-name">${esc(f.name)}</div>
        <div class="fr-card-sub">${esc(f.gov || '')}${f.leader ? ' · ' + esc(f.leader) : ''}</div>
        <div class="fr-card-meta">★ ${esc(frCapital(f, cap).sysName)} · ${esc(f.race || '')}</div>
      </div></div>`).join('') || `<div class="fr-empty">Пока нет одобренных фракций.</div>`;

  setPg(`<div class="fr-wrap">
    <div class="fr-head"><h1>Фракции</h1>
      ${user && canCreate && !mine ? `<button class="btn btn-gd" onclick="go('faction-new')">+ Создать государство</button>` : ''}
    </div>
    ${mineHtml}
    <div class="fr-grid">${cards}</div>
  </div>`);
}

// Лор-блок с заголовком: длинный текст сворачивается (фейд + кнопка),
// в развёрнутом виде прокручивается внутри себя. Короткий — показывается целиком.
function frLoreBlock(title, text) {
  if (!text || !text.trim()) return '';
  const html = esc(text).replace(/\r?\n/g, '<br>');
  const long = text.length > 280;
  return `<div class="fr-lore-block${long ? ' collapsible' : ''}">
    <div class="fr-lore-title">${esc(title)}</div>
    <div class="fr-lore-body">${html}</div>
    ${long ? `<button class="fr-lore-toggle" onclick="frToggleLore(this)">Читать полностью ▾</button>` : ''}
  </div>`;
}
function frToggleLore(btn) {
  const blk = btn.closest('.fr-lore-block'); if (!blk) return;
  const open = blk.classList.toggle('open');
  btn.textContent = open ? 'Свернуть ▴' : 'Читать полностью ▾';
}

async function frViewFaction(id) {
  let f = null, cap = { byFid: {}, sysNames: {} };
  try {
    const [rows, capData] = await Promise.all([
      dbGet('faction_applications', 'id=eq.' + id + '&limit=1'),
      frLoadCapitals(),
    ]);
    f = rows && rows[0]; cap = capData;
  } catch (e) {}
  if (!f) { toast('Не найдено', 'err'); return; }
  const capLoc = frCapital(f, cap);
  const blds = (f.buildings || []).map(b => FR_BUILDINGS.find(x => x.id === b)?.name).filter(Boolean);
  const free = FR_BUILDINGS.find(b => b.id === frFreeBuilding(f.civ_type))?.name;
  const row = (k, v) => `<div class="fr-rev-row"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
  const isOwner = user && f.owner_id === user.id;
  const modal = document.getElementById('fr-modal') || (() => { const m = document.createElement('div'); m.id = 'fr-modal'; m.className = 'fr-modal-ov'; m.onclick = e => { if (e.target === m) frCloseView(); }; document.body.appendChild(m); return m; })();
  modal.innerHTML = `<div class="fr-modal">
    <button class="gm-close" onclick="frCloseView()">✕</button>
    <div class="fr-view-hd">
      <div class="fr-view-herald" style="border-color:${frReadable(f.color)}">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : `<span style="color:${frReadable(f.color)}">◈</span>`}</div>
      <div><div class="fr-card-name" style="font-size:22px">${esc(f.name)}</div>
      <div class="fr-card-sub">${esc(f.gov || '')} · ${esc(f.regime || '')}</div></div>
    </div>
    <div class="fr-rev">
      ${row('Глава', f.leader)} ${row('Тип', f.civ_type === 'frontier' ? 'Фронтир' : 'Колония')}
      ${row('Столица', capLoc.sysName + (capLoc.planet ? ' / ' + capLoc.planet : ''))}
      ${row('Раса', f.race)} ${row('Идеология', f.ideology)}
      ${row('Постройки', [free + ' (беспл.)', ...blds].filter(Boolean).join(', '))}
      ${row('Финансы', f.bonus_money ? '+500 стандартов' : 'Стартовый капитал')}
    </div>
    ${frLoreBlock('Культура', f.culture)}
    ${frLoreBlock('История', f.history)}
    ${f.link ? `<div class="fr-rev-row"><span>Ссылка</span><a href="${esc(f.link)}" target="_blank" rel="noopener" style="color:var(--te)">открыть ↗</a></div>` : ''}
    ${isOwner ? `<div class="fr-actions"><button class="btn btn-gd btn-sm" onclick="frCloseView();go('faction-new')">✎ Редактировать</button></div>` : ''}
  </div>`;
  modal.classList.add('show');
}
function frCloseView() { document.getElementById('fr-modal')?.classList.remove('show'); }

// ════════════════════════════════════════════════════════════
// МОДЕРАЦИЯ (вкладка «Анкеты» в #ap)
// ════════════════════════════════════════════════════════════
async function frRenderAppsTab(b) {
  b.innerHTML = `<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>`;
  let apps = [];
  try { apps = await dbGet('faction_applications', 'or=(status.eq.pending,pending_review.eq.true)&order=updated_at.asc') || []; } catch (e) { b.innerHTML = `<p style="color:var(--err)">Ошибка: ${esc(e.message)}</p>`; return; }
  if (!apps.length) { b.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--t3)">Нет анкет на модерации</div>`; return; }
  b.innerHTML = `<div style="margin-bottom:10px;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--te)">${apps.length} на модерации</div>` +
    apps.map(a => {
      const isEdit = a.status === 'approved' && a.pending_review;
      const badge = isEdit ? `<span class="fr-app-badge edit">ИЗМЕНЕНИЯ</span>` : `<span class="fr-app-badge new">НОВАЯ</span>`;
      return `<div class="fr-app" id="fr-app-${a.id}">
      <div class="fr-app-hd">${badge}<span class="fr-swatch" style="background:${a.color}"></span>
        <b>${esc(a.name || 'Без названия')}</b>
        <span class="fr-app-by">${esc(a.owner_email || '')}</span></div>
      <div class="fr-app-meta">★ ${esc(a.system_name || '—')} · ${esc(a.gov || '')} · ${esc(a.race || '')}</div>
      <div class="fr-app-acts">
        <button class="btn btn-gh btn-sm" onclick="frViewFaction('${a.id}')">Детали</button>
        <button class="btn btn-gd btn-sm" onclick="frApprove('${a.id}')">✓ ${isEdit ? 'Принять изменения' : 'Одобрить'}</button>
        ${isEdit ? '' : `<button class="btn btn-rd btn-sm" onclick="frReject('${a.id}')">✕ Отклонить</button>`}
      </div></div>`;
    }).join('');
}
async function frApprove(id) {
  if (!confirm('Одобрить анкету? Система окрасится, автор станет игроком.')) return;
  try {
    const token = await getTokenFresh();
    const r = await fetch(`${SB_URL}/rest/v1/rpc/approve_faction_application`, {
      method: 'POST', headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id }),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
    toast('Одобрено ✓', 'ok');
    document.getElementById('fr-app-' + id)?.remove();
    // перекрасить карту, если открыта/загружена
    if (typeof loadGalaxyData === 'function' && typeof GM !== 'undefined' && GM.loaded) { await loadGalaxyData(); if (document.getElementById('gm-svg') && typeof gmDraw === 'function') gmDraw(); }
  } catch (e) { toast('Ошибка одобрения: ' + e.message, 'err'); }
}
async function frReject(id) {
  const reason = prompt('Причина отклонения (увидит автор):', '');
  if (reason === null) return;
  try {
    await dbPatch('faction_applications', 'id=eq.' + id, { status: 'rejected', reject_reason: reason, updated_at: new Date().toISOString() });
    toast('Отклонено', 'inf');
    document.getElementById('fr-app-' + id)?.remove();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
}
