// ════════════════════════════════════════════════════════════
// FACTION REGISTRATION — пошаговый визард, страница «Фракции», модерация
// Зависит от: core.js (dbGet/dbPost/dbPatch, SB_URL/SB_ANON, getTokenFresh,
//             esc, toast, setPg), auth.js (user, showAuth, handleImgUpload)
// ════════════════════════════════════════════════════════════

const FR_GOV = ['Республика', 'Монархия', 'Империя', 'Олигархия', 'Диктатура', 'Теократия', 'Технократия', 'Корпоратократия', 'Коллективный разум', 'Машинный разум (ИИ)'];
const FR_REGIME = ['Демократический', 'Эгалитарный', 'Меритократический', 'Плутократический', 'Олигархический', 'Авторитарный', 'Тоталитарный', 'Деспотичный', 'Анархический'];
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

const FR = { data: null, step: 0, freeSystems: null, busy: false };

function frBlank() {
  return {
    id: null, status: 'draft', name: '', color: 'rgba(80,150,255,0.34)',
    gov: FR_GOV[0], regime: FR_REGIME[0], leader: '', civ_type: 'frontier',
    system_id: null, system_name: '', planet_name: '',
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
  if (mine && (mine.status === 'pending' || mine.status === 'approved')) {
    // уже подана/одобрена — не даём вторую, показываем статус
    setPg(frStatusCard(mine));
    return;
  }
  // продолжаем черновик/отклонённую, либо новая
  FR.data = mine ? { ...frBlank(), ...mine, buildings: mine.buildings || [] } : frBlank();
  FR.step = 0;
  FR.freeSystems = null;
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
  setPg(`<div class="fr-wrap">
    <div class="fr-head"><h1>Регистрация государства</h1>
      <div class="fr-steps">${dots}</div></div>
    <div class="fr-body" id="fr-body">${body}</div>
    <div class="fr-foot">
      <button class="btn btn-gh" onclick="frPrev()" ${FR.step === 0 ? 'disabled' : ''}>← Назад</button>
      <button class="btn btn-gh" onclick="frSaveDraft()">💾 Сохранить черновик</button>
      ${isLast
        ? `<button class="btn btn-gd" onclick="frSubmit()">Отправить на модерацию ✓</button>`
        : `<button class="btn btn-gd" onclick="frNext()">Далее →</button>`}
    </div>
  </div>`);
  if (FR.step === 2) frRenderSystemPicker();
}

// ── Шаги ─────────────────────────────────────────────────────
function frSel(id, opts, val, onch) {
  return `<select class="fi" id="${id}"${onch ? ` onchange="${onch}"` : ''}>` +
    opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('') + `</select>`;
}
function frStepPolitics(d) {
  return `<h3 class="fr-h3">I. Политические сведения</h3>
    <div class="fg"><label class="fl">Полное название фракции *</label>
      <input class="fi" id="f-name" value="${esc(d.name)}" placeholder="Например: Объединённые Земные Нации"></div>
    <div class="fgr2">
      <div class="fg"><label class="fl">Форма правления</label>${frSel('f-gov', FR_GOV, d.gov)}</div>
      <div class="fg"><label class="fl">Политический режим</label>${frSel('f-regime', FR_REGIME, d.regime)}</div>
    </div>
    <div class="fgr2">
      <div class="fg"><label class="fl">Глава фракции</label><input class="fi" id="f-leader" value="${esc(d.leader)}" placeholder="Имя и титул"></div>
      <div class="fg"><label class="fl">Тип цивилизации</label>
        <select class="fi" id="f-type">
          <option value="frontier"${d.civ_type === 'frontier' ? ' selected' : ''}>Зарождающийся фронтир</option>
          <option value="colony"${d.civ_type === 'colony' ? ' selected' : ''}>Самостоятельная колония</option>
        </select></div>
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
  return `<h3 class="fr-h3">Столичная система</h3>
    <p class="fr-note">Выберите <b>свободную</b> звезду — она станет столицей и при одобрении окрасится в ваш цвет.</p>
    <div class="fg"><input class="fi" id="f-sys-search" placeholder="Поиск системы..." oninput="frFilterSystems(this.value)"></div>
    <div class="fr-sys-picked" id="f-sys-picked">${d.system_id ? `Выбрано: <b>${esc(d.system_name)}</b>` : 'Система не выбрана'}</div>
    <div class="fr-sys-list" id="f-sys-list"><div class="sload" style="min-height:60px"><div class="pulse-loader"></div></div></div>
    <div class="fg" style="margin-top:12px"><label class="fl">Название столичной планеты</label>
      <input class="fi" id="f-planet" value="${esc(d.planet_name)}" placeholder="Планета"></div>`;
}
function frStepBuildings(d) {
  const free = frFreeBuilding(d.civ_type);
  const spent = frSpent(d);
  const rows = FR_BUILDINGS.map(b => {
    const isFree = b.id === free;
    const checked = isFree || d.buildings.includes(b.id);
    return `<label class="fr-bld${isFree ? ' free' : ''}">
      <input type="checkbox" data-bid="${b.id}" data-price="${b.price}" ${checked ? 'checked' : ''} ${isFree ? 'disabled' : ''} onchange="frToggleBld()">
      <span class="fr-bld-name">${esc(b.name)}</span>
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
      <div class="fg"><label class="fl">Биологический вид (раса)</label>${frSel('c-race', FR_RACE, d.race)}</div>
      <div class="fg"><label class="fl">Идеология / Этика</label>${frSel('c-ideo', FR_IDEO, d.ideology)}</div>
    </div>
    <div class="fg"><label class="fl">Культурные особенности</label>
      <textarea class="fi" id="c-features" rows="4" placeholder="Традиции, менталитет, быт...">${esc(d.culture)}</textarea></div>`;
}
function frStepHistory(d) {
  return `<h3 class="fr-h3">IV. Исторические сведения</h3>
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
    <p class="fr-note">После отправки анкета попадёт на модерацию. До одобрения видна только вам.</p>`;
}

// ── Состояние / навигация ───────────────────────────────────
function frSyncStep() {
  const d = FR.data, g = id => document.getElementById(id);
  if (FR.step === 0) { d.name = g('f-name').value.trim(); d.gov = g('f-gov').value; d.regime = g('f-regime').value; d.leader = g('f-leader').value.trim(); d.civ_type = g('f-type').value; }
  else if (FR.step === 1) { d.color = frHexToRgba(g('f-color').value, 0.34); }
  else if (FR.step === 2) { if (g('f-planet')) d.planet_name = g('f-planet').value.trim(); }
  else if (FR.step === 4) { d.race = g('c-race').value; d.ideology = g('c-ideo').value; d.culture = g('c-features').value.trim(); }
  else if (FR.step === 5) { d.link = g('h-link').value.trim(); }
  // step3 (постройки) и герб синхронизируются в своих обработчиках
}
function frGoStep(i) { frSyncStep(); FR.step = i; frRenderStep(); }
function frNext() {
  frSyncStep();
  if (FR.step === 0 && !FR.data.name) { toast('Укажите название фракции', 'err'); return; }
  if (FR.step === 2 && !FR.data.system_id) { toast('Выберите свободную систему', 'err'); return; }
  FR.step = Math.min(FR.step + 1, FR_STEPS.length - 1); frRenderStep();
}
function frPrev() { frSyncStep(); FR.step = Math.max(FR.step - 1, 0); frRenderStep(); }

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
  });
}

// ── Система: список свободных ───────────────────────────────
async function frRenderSystemPicker() {
  if (FR.freeSystems === null) {
    let sys = [], taken = new Set();
    try { sys = await dbGet('map_systems', 'select=id,name,faction,star_type') || []; } catch (e) { sys = []; }
    // занятые чужими анкетами — необязательный запрос (таблица может отсутствовать)
    try {
      const apps = await dbGet('faction_applications', 'select=system_id,status&status=in.(pending,approved)');
      taken = new Set((apps || []).map(a => a.system_id).filter(Boolean));
    } catch (e) { /* нет таблицы анкет — игнорируем */ }
    FR.freeSystems = sys.filter(s => !s.faction && (!taken.has(s.id) || s.id === FR.data.system_id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  frFilterSystems(document.getElementById('f-sys-search')?.value || '');
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
function GM_BASE_SAFE() { return (typeof GM_BASE !== 'undefined') ? GM_BASE : 'assets/map/'; }
function frPickSystem(id, name) {
  FR.data.system_id = id; FR.data.system_name = name;
  const p = document.getElementById('f-sys-picked'); if (p) p.innerHTML = `Выбрано: <b>${esc(name)}</b>`;
  frFilterSystems(document.getElementById('f-sys-search')?.value || '');
}

// ── Сохранение ──────────────────────────────────────────────
async function frUpsert(status) {
  frSyncStep();
  const d = FR.data;
  const body = {
    owner_id: user.id, owner_email: user.email, status,
    name: d.name, color: d.color, gov: d.gov, regime: d.regime, leader: d.leader, civ_type: d.civ_type,
    system_id: d.system_id, system_name: d.system_name, planet_name: d.planet_name,
    buildings: d.buildings, bonus_money: d.bonus_money,
    race: d.race, ideology: d.ideology, culture: d.culture, history: d.history, link: d.link, herald_url: d.herald_url,
    updated_at: new Date().toISOString(),
  };
  if (d.id) { await dbPatch('faction_applications', 'id=eq.' + d.id, body); return d.id; }
  const rows = await dbPost('faction_applications', body);
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (row && row.id) d.id = row.id;
  return d.id;
}
async function frSaveDraft() {
  if (FR.busy) return; FR.busy = true;
  try { await frUpsert('draft'); toast('Черновик сохранён', 'ok'); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FR.busy = false; }
}
async function frSubmit() {
  if (FR.busy) return;
  frSyncStep();
  if (!FR.data.name) { toast('Укажите название', 'err'); FR.step = 0; frRenderStep(); return; }
  if (!FR.data.system_id) { toast('Выберите систему', 'err'); FR.step = 2; frRenderStep(); return; }
  FR.busy = true;
  try { await frUpsert('pending'); toast('Анкета отправлена на модерацию!', 'ok'); go('factions'); }
  catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FR.busy = false; }
}

// ════════════════════════════════════════════════════════════
// СТРАНИЦА «ФРАКЦИИ» (#factions)
// ════════════════════════════════════════════════════════════
async function renderFactionsPage() {
  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);
  let approved = [], mine = null;
  try { approved = await dbGet('faction_applications', 'status=eq.approved&order=name.asc') || []; } catch (e) {}
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
      <div class="fr-card-bar" style="background:${frSolid(f.color)}"></div>
      <div class="fr-card-herald">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : '<span style="color:' + frSolid(f.color) + '">◈</span>'}</div>
      <div class="fr-card-main">
        <div class="fr-card-name">${esc(f.name)}</div>
        <div class="fr-card-sub">${esc(f.gov || '')}${f.leader ? ' · ' + esc(f.leader) : ''}</div>
        <div class="fr-card-meta">★ ${esc(f.system_name || '—')} · ${esc(f.race || '')}</div>
      </div></div>`).join('') || `<div class="fr-empty">Пока нет одобренных фракций.</div>`;

  setPg(`<div class="fr-wrap">
    <div class="fr-head"><h1>Фракции</h1>
      ${user && canCreate && !mine ? `<button class="btn btn-gd" onclick="go('faction-new')">+ Создать государство</button>` : ''}
    </div>
    ${mineHtml}
    <div class="fr-grid">${cards}</div>
  </div>`);
}

async function frViewFaction(id) {
  let f = null;
  try { const rows = await dbGet('faction_applications', 'id=eq.' + id + '&limit=1'); f = rows && rows[0]; } catch (e) {}
  if (!f) { toast('Не найдено', 'err'); return; }
  const blds = (f.buildings || []).map(b => FR_BUILDINGS.find(x => x.id === b)?.name).filter(Boolean);
  const free = FR_BUILDINGS.find(b => b.id === frFreeBuilding(f.civ_type))?.name;
  const row = (k, v) => `<div class="fr-rev-row"><span>${k}</span><b>${esc(v || '—')}</b></div>`;
  const isOwner = user && f.owner_id === user.id;
  const modal = document.getElementById('fr-modal') || (() => { const m = document.createElement('div'); m.id = 'fr-modal'; m.className = 'fr-modal-ov'; m.onclick = e => { if (e.target === m) frCloseView(); }; document.body.appendChild(m); return m; })();
  modal.innerHTML = `<div class="fr-modal">
    <button class="gm-close" onclick="frCloseView()">✕</button>
    <div class="fr-view-hd">
      <div class="fr-view-herald" style="border-color:${frSolid(f.color)}">${f.herald_url ? `<img src="${esc(f.herald_url)}">` : `<span style="color:${frSolid(f.color)}">◈</span>`}</div>
      <div><div class="fr-card-name" style="font-size:22px">${esc(f.name)}</div>
      <div class="fr-card-sub">${esc(f.gov || '')} · ${esc(f.regime || '')}</div></div>
    </div>
    <div class="fr-rev">
      ${row('Глава', f.leader)} ${row('Тип', f.civ_type === 'frontier' ? 'Фронтир' : 'Колония')}
      ${row('Столица', (f.system_name || '—') + (f.planet_name ? ' / ' + f.planet_name : ''))}
      ${row('Раса', f.race)} ${row('Идеология', f.ideology)}
      ${row('Постройки', [free + ' (беспл.)', ...blds].filter(Boolean).join(', '))}
      ${row('Финансы', f.bonus_money ? '+500 стандартов' : 'Стартовый капитал')}
    </div>
    ${f.culture ? `<div class="fr-lore"><b>Культура.</b> ${esc(f.culture)}</div>` : ''}
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
  try { apps = await dbGet('faction_applications', 'status=eq.pending&order=updated_at.asc') || []; } catch (e) { b.innerHTML = `<p style="color:var(--err)">Ошибка: ${esc(e.message)}</p>`; return; }
  if (!apps.length) { b.innerHTML = `<div style="text-align:center;padding:24px 0;color:var(--t3)">Нет анкет на модерации</div>`; return; }
  b.innerHTML = `<div style="margin-bottom:10px;font-family:JetBrains Mono,monospace;font-size:10px;color:var(--te)">${apps.length} на модерации</div>` +
    apps.map(a => `<div class="fr-app" id="fr-app-${a.id}">
      <div class="fr-app-hd"><span class="fr-swatch" style="background:${a.color}"></span>
        <b>${esc(a.name || 'Без названия')}</b>
        <span class="fr-app-by">${esc(a.owner_email || '')}</span></div>
      <div class="fr-app-meta">★ ${esc(a.system_name || '—')} · ${esc(a.gov || '')} · ${esc(a.race || '')}</div>
      <div class="fr-app-acts">
        <button class="btn btn-gh btn-sm" onclick="frViewFaction('${a.id}')">Детали</button>
        <button class="btn btn-gd btn-sm" onclick="frApprove('${a.id}')">✓ Одобрить</button>
        <button class="btn btn-rd btn-sm" onclick="frReject('${a.id}')">✕ Отклонить</button>
      </div></div>`).join('');
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
