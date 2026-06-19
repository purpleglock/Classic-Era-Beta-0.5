// ════════════════════════════════════════════════════════════
// ИГРОВЫЕ ЛОКАЦИИ — хаб (#locations)
//
// Витрина всех RP-страниц page_type='location'. При входе игрока с
// одобренным государством вызывает RPC ensure_my_capital_location:
// сервер создаёт/синхронизирует страницу-локацию его столицы
// (slug 'loc-cap-<faction_id>') с базовым «досье» планеты. Описание
// редактируется обычным редактором локаций — синхронизация трогает
// только досье, прозу игрока не затирает.
// ════════════════════════════════════════════════════════════

let _locMyCapSlug = null;   // slug локации моей столицы (после синхронизации)
let _locLastErr = null;     // текст последней ошибки RPC (для диагностики)
let _locMyFid = undefined;  // faction_id моего одобренного государства (кэш; null — нет)
let _locEditRows = [];      // буфер строк «Дополнительно» в модалке редактирования

// faction_id текущего игрока (одобренное государство) — для проверки прав.
async function locLoadMyFid() {
  if (_locMyFid !== undefined) return _locMyFid;
  _locMyFid = null;
  if (typeof user === 'undefined' || !user) return null;
  try {
    const rows = await dbGet('faction_applications',
      `owner_id=eq.${user.id}&status=eq.approved&faction_id=not.is.null&select=faction_id&order=updated_at.desc&limit=1`);
    if (rows && rows[0]) _locMyFid = rows[0].faction_id;
  } catch (e) {}
  return _locMyFid;
}

// Может ли текущий пользователь править досье этой столичной локации?
async function locCanEditCap(slug) {
  if (typeof user === 'undefined' || !user || user.is_banned) return false;
  if (['superadmin','editor','moderator'].includes(user.role)) return true;
  if (_locMyCapSlug && slug === _locMyCapSlug) return true;
  const fid = await locLoadMyFid();
  return !!(fid && slug === 'loc-cap-' + fid);
}

// Добавить кнопку «Редактировать досье» в плейсхолдер на странице локации.
async function locMaybeAddCapEditBtn(pg) {
  const can = await locCanEditCap(pg.slug);
  const box = document.getElementById('loc-cap-tools');
  if (!box || !can) return;
  box.innerHTML = `<div class="loc-cap-tools">
    <button class="btn btn-gh btn-sm" onclick="locEditCapDossier('${esc(pg.slug)}')">✎ Редактировать досье</button>
    <span class="loc-cap-tools-hint">досье «Основное» синхронизируется автоматически; здесь — обложка, доп. поля и описание</span>
  </div>`;
}

// Разобрать страницу локации на части для формы редактирования.
function _locParsePage(pg) {
  let blocks = [];
  try { blocks = JSON.parse((pg && (pg.content)) || '[]'); } catch (e) {}
  const ib = blocks.find(b => b && b.type === 'infobox');
  const autoRows = [];
  const extraRows = [];
  if (ib) (ib.sections || []).forEach(s => {
    const isAuto = (s.name === 'Основное');
    (s.rows || []).forEach(r => { if (r && r.key) (isAuto ? autoRows : extraRows).push({ key: r.key, val: r.val || '' }); });
  });
  const desc = blocks.filter(b => b && b.type === 'text').map(b => b.content || '').join('\n\n');
  return { autoRows, extraRows, desc, image_url: (pg && pg.image_url) || '' };
}

// Открыть модалку редактирования досье столицы.
function locEditCapDossier(slug) {
  const pg = (typeof _pgCache !== 'undefined' && _pgCache.get(slug)) ||
             (typeof pages !== 'undefined' && pages.find(p => p.slug === slug));
  if (!pg) { toast('Страница не загружена', 'err'); return; }
  const parsed = _locParsePage(pg);
  _locEditRows = parsed.extraRows.slice();
  window._locEditOrigDesc = parsed.desc;
  window._locEditSlug = slug;

  let ov = document.getElementById('mo-loc-cap');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'ov'; ov.id = 'mo-loc-cap';
    document.body.appendChild(ov);
  }
  const autoHtml = parsed.autoRows.map(r =>
    `<div class="loc-edit-auto"><span>${esc(r.key)}</span><b>${esc(r.val)}</b></div>`).join('');
  ov.innerHTML = `<div class="mo mo-sm"><div class="mo-corner"></div>
    <div class="mo-hdr"><span class="mo-t">РЕДАКТОР ЛОКАЦИИ</span><button class="xb" onclick="cm('mo-loc-cap')">✕</button></div>
    <div class="mo-body">
      <div class="loc-edit-sec">📖 РП-описание мира</div>
      <div class="fg"><textarea class="fi" id="loc-edit-desc" rows="12" placeholder="Опишите облик планеты, столицу, народ, атмосферу места… Поддерживается markdown: ## заголовок, **жирный**." style="resize:vertical;min-height:240px;line-height:1.6">${esc(parsed.desc)}</textarea></div>
      <div class="loc-edit-sec">Обложка планеты</div>
      <div class="loc-edit-cover">
        <div class="loc-edit-cover-prev" id="loc-edit-cover-prev"${parsed.image_url ? '' : ' style="display:none"'}>
          <img id="loc-edit-cover-img" src="${esc(parsed.image_url)}" alt="">
          <button class="loc-edit-cover-x" title="Убрать" onclick="locEditClearCover()">✕</button>
        </div>
        <div class="loc-edit-cover-controls">
          <input type="file" id="loc-edit-file" accept="image/*" style="display:none" onchange="locEditUploadCover(this)">
          <button class="btn btn-gh btn-sm" onclick="document.getElementById('loc-edit-file').click()">📁 Загрузить файл</button>
          <span class="loc-edit-or">или URL</span>
          <input class="fi" id="loc-edit-img" type="url" placeholder="https://..." value="${esc(parsed.image_url)}" oninput="locEditCoverPreview(this.value)">
        </div>
      </div>
      <div class="loc-edit-sec">Свои поля досье (по желанию)</div>
      <div id="loc-edit-rows"></div>
      <button class="btn btn-gh btn-sm" style="margin-top:6px" onclick="locEditAddRow()">+ Добавить поле</button>
      <div class="loc-edit-sec">Автоматические поля (обновляются игрой, только чтение)</div>
      <div class="loc-edit-auto-grid">${autoHtml || '<span style="color:var(--t4);font-size:12px">—</span>'}</div>
    </div>
    <div class="mo-ftr"><button class="btn btn-gh" onclick="cm('mo-loc-cap')">Отмена</button>
      <button class="btn btn-gd" onclick="locSaveCapDossier()">Сохранить</button></div>
  </div>`;
  ov.classList.add('open');
  locEditRenderRows();
}

function locEditRenderRows() {
  const box = document.getElementById('loc-edit-rows'); if (!box) return;
  box.innerHTML = _locEditRows.map((r, i) => `<div class="loc-edit-row">
    <input class="fi" placeholder="Поле" value="${esc(r.key)}" oninput="_locEditRows[${i}].key=this.value">
    <input class="fi" placeholder="Значение" value="${esc(r.val)}" oninput="_locEditRows[${i}].val=this.value">
    <button class="btn btn-gh btn-sm" onclick="locEditDelRow(${i})">✕</button>
  </div>`).join('') || '<div style="color:var(--t4);font-size:12px;padding:4px 0">Нет доп. полей. Например: Население, Климат, Столичный град, Достопримечательности.</div>';
}
function locEditAddRow() { _locEditRows.push({ key: '', val: '' }); locEditRenderRows(); }
function locEditDelRow(i) { _locEditRows.splice(i, 1); locEditRenderRows(); }

// Обновить превью обложки по URL.
function locEditCoverPreview(url) {
  const prev = document.getElementById('loc-edit-cover-prev');
  const img = document.getElementById('loc-edit-cover-img');
  if (!prev || !img) return;
  if (url && url.trim()) { img.src = url.trim(); prev.style.display = ''; }
  else { prev.style.display = 'none'; }
}
// Убрать обложку.
function locEditClearCover() {
  const inp = document.getElementById('loc-edit-img'); if (inp) inp.value = '';
  locEditCoverPreview('');
}
// Загрузить файл обложки в Storage (сжатие + upload через общий хелпер).
function locEditUploadCover(input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  if (typeof handleImgUpload !== 'function') { toast('Загрузчик недоступен', 'err'); return; }
  handleImgUpload(f, url => {
    const inp = document.getElementById('loc-edit-img');
    if (inp) inp.value = url;
    locEditCoverPreview(url);
  });
  input.value = '';
}

async function locSaveCapDossier() {
  const slug = window._locEditSlug;
  const img = (document.getElementById('loc-edit-img')?.value || '').trim();
  const desc = document.getElementById('loc-edit-desc')?.value ?? '';
  const rows = _locEditRows
    .map(r => ({ key: (r.key || '').trim(), val: (r.val || '').trim() }))
    .filter(r => r.key);
  const body = { p_slug: slug, p_image_url: img, p_extra_rows: rows };
  // описание отправляем только если изменилось (чтобы не затирать сложные блоки)
  if (desc !== (window._locEditOrigDesc ?? '')) body.p_desc = desc;
  try {
    await frRpc('update_capital_location', body);
    toast('Сохранено ✓', 'ok');
    cm('mo-loc-cap');
    if (typeof _pgCache !== 'undefined') _pgCache.delete(slug);
    if (typeof go === 'function') go(slug, false);
  } catch (e) {
    toast('Ошибка: ' + ((e && e.message) ? e.message : e), 'err');
  }
}

// Синхронизировать локацию своей столицы. Вернёт slug или null;
// текст ошибки кладёт в _locLastErr (показывается в хабе).
async function locEnsureMyCapital() {
  _locLastErr = null;
  if (typeof user === 'undefined' || !user) return null;
  if (!['superadmin','editor','moderator','player'].includes(user.role) &&
      !(typeof _myFactionApproved !== 'undefined' && _myFactionApproved)) return null;
  try {
    const slug = await frRpc('ensure_my_capital_location');
    _locMyCapSlug = slug || null;
    return _locMyCapSlug;
  } catch (e) {
    _locLastErr = (e && e.message) ? e.message : String(e);
    return null;
  }
}

// Ручная синхронизация (кнопка в хабе) — с тостами и перерисовкой.
async function locSyncMyCapital() {
  if (typeof toast === 'function') toast('Синхронизация…', 'inf');
  const slug = await locEnsureMyCapital();
  if (slug) {
    if (typeof loadPgs === 'function') { try { await loadPgs(); } catch (e) {} }
    if (typeof toast === 'function') toast('Локация столицы готова ✓', 'ok');
    if (typeof go === 'function') { go(slug); return; }
  } else {
    if (typeof toast === 'function') toast('Не удалось: ' + (_locLastErr || 'нет одобренного государства'), 'err');
    if (typeof curSlug !== 'undefined' && curSlug === 'locations') renderLocationsHub();
  }
}

// Достаём из инфобокса локации значение по ключу (без учёта регистра).
function _locInfo(p, key) {
  const k = key.toLowerCase();
  if (p.infobox && (p.infobox[k] !== undefined)) return p.infobox[k] || '';
  try {
    const blocks = JSON.parse(p.content || '[]');
    const ib = blocks.find(b => b && b.type === 'infobox');
    if (ib) {
      for (const s of (ib.sections || [])) for (const r of (s.rows || [])) {
        if (r && r.key && r.key.toLowerCase().trim() === k) return r.val || '';
      }
    }
  } catch (e) {}
  return '';
}

async function renderLocationsHub() {
  // Гейт для зрителей/гостей — как на самой странице локации.
  if (typeof canSeeLocations === 'function' && !canSeeLocations()) {
    setPg(`<div class="loc-gate">
      <div class="loc-gate-ico">⛬</div>
      <div class="loc-gate-title">ЗАКРЫТАЯ ЗОНА</div>
      <div class="loc-gate-sub">Игровые локации доступны только участникам игры. Получите роль игрока, зарегистрировав государство.</div>
      ${typeof user !== 'undefined' && user ? `<button class="btn btn-gd" onclick="go('factions')">⬡ К фракциям</button>` : `<button class="btn btn-gd" onclick="showAuth('login')">Войти</button>`}
    </div>`);
    return;
  }

  setPg(`<div class="sload"><div class="pulse-loader"></div></div>`);

  // 1) синхронизируем локацию своей столицы (создаст при первом заходе)
  await locEnsureMyCapital();
  // 2) перезагружаем список страниц — чтобы свежесозданная локация попала в реестр
  if (typeof loadPgs === 'function') { try { await loadPgs(); } catch (e) {} }
  if (typeof buildNav === 'function') { try { buildNav(); } catch (e) {} }

  // если пользователь уже ушёл с вкладки — не перерисовываем
  if ((typeof curSlug !== 'undefined') && curSlug !== 'locations') return;

  const locs = (typeof pages !== 'undefined' ? pages : [])
    .filter(p => p && p.page_type === 'location' && (typeof isVisiblePage !== 'function' || isVisiblePage(p)))
    .sort((a, b) => {
      // моя столица — первой, затем по названию
      if (_locMyCapSlug) { if (a.slug === _locMyCapSlug) return -1; if (b.slug === _locMyCapSlug) return 1; }
      return pT(a).localeCompare(pT(b), 'ru');
    });

  const card = p => {
    const mine = _locMyCapSlug && p.slug === _locMyCapSlug;
    const sys  = _locInfo(p, 'Система');
    const ptype = _locInfo(p, 'Тип мира');
    const ctrl = _locInfo(p, 'Контроль');
    const status = _locInfo(p, 'Статус');
    const isDraft = user && p.status === 'draft';
    const img = p.image_url
      ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">`
      : `<span class="loc-hub-ph">⛬</span>`;
    const meta = [sys && '☀ ' + esc(sys), ptype && esc(ptype)].filter(Boolean).join(' · ');
    return `<div class="loc-hub-card${mine ? ' mine' : ''}" onclick="go('${esc(p.slug)}')">
      <div class="loc-hub-cov">${img}${mine ? '<span class="loc-hub-tag">★ ВАША СТОЛИЦА</span>' : (status ? `<span class="loc-hub-tag loc-hub-tag--st">${esc(status)}</span>` : '')}${isDraft ? '<span class="loc-hub-tag loc-hub-tag--dft">ЧЕРНОВИК</span>' : ''}</div>
      <div class="loc-hub-body">
        <div class="loc-hub-name">${esc(pT(p))}</div>
        ${meta ? `<div class="loc-hub-meta">${meta}</div>` : ''}
        ${ctrl ? `<div class="loc-hub-ctrl">⚑ ${esc(ctrl)}</div>` : ''}
      </div>
    </div>`;
  };

  const myCard = locs.find(p => _locMyCapSlug && p.slug === _locMyCapSlug);
  const rest   = locs.filter(p => !(_locMyCapSlug && p.slug === _locMyCapSlug));

  // Плашка для игрока без созданной локации столицы (или при ошибке RPC).
  const isPlayerLike = user && (['superadmin','editor','moderator','player'].includes(user.role) ||
    (typeof _myFactionApproved !== 'undefined' && _myFactionApproved));
  let notice = '';
  if (isPlayerLike && !_locMyCapSlug) {
    const errLine = _locLastErr
      ? `<div class="loc-hub-err">⚠ ${esc(_locLastErr)}${/ensure_my_capital_location|does not exist|function/i.test(_locLastErr) ? ' — похоже, не применён <b>_capital_location.sql</b> в Supabase.' : ''}</div>`
      : `<div class="loc-hub-note-sub">Если у вас есть одобренное государство, нажмите — локация столицы создастся автоматически.</div>`;
    notice = `<div class="loc-hub-notice">
      <div class="loc-hub-note-t">Локация вашей столицы ещё не создана</div>
      ${errLine}
      <button class="btn btn-gd btn-sm" onclick="locSyncMyCapital()">⛬ Создать / синхронизировать столицу</button>
    </div>`;
  }

  const head = `<div class="loc-hub-head">
    <div class="loc-badge">📍 ИГРОВЫЕ ЛОКАЦИИ · только для участников</div>
    <h1 class="art-h1">Игровые локации</h1>
    <p class="loc-hub-intro">RP-страницы миров. Локация вашей столицы создаётся автоматически после регистрации государства и держится в актуальном состоянии — досье планеты синхронизируется, а описание остаётся за вами.</p>
    ${notice}
  </div>`;

  let body = '';
  if (myCard) body += `<div class="loc-hub-sec-t">★ Ваша столица</div><div class="loc-hub-grid">${card(myCard)}</div>`;
  if (rest.length) body += `<div class="loc-hub-sec-t">Все локации</div><div class="loc-hub-grid">${rest.map(card).join('')}</div>`;
  if (!myCard && !rest.length) {
    body = `<div class="sempty" style="gap:10px"><div style="font-size:42px;opacity:.15">⛬</div>
      <div style="font-family:Rajdhani,sans-serif;font-size:13px;letter-spacing:2px;color:var(--t3)">ПОКА НЕТ ЛОКАЦИЙ</div>
      ${typeof _myFactionApproved !== 'undefined' && !_myFactionApproved && (!user || user.role === 'viewer') ? '' : `<div style="font-size:12px;color:var(--t4)">Зарегистрируйте государство — локация столицы появится здесь автоматически.</div>`}</div>`;
  }

  setPg(`${head}${body}`);
}
