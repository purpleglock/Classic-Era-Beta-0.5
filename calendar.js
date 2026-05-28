// ════════════════════════════════════════════════════════════
// CALENDAR v3 — праздничный календарь
// Зависит от: core.js, auth.js, vk.js
// Автоотправка: Supabase Edge Function + pg_cron (12:00 NSK = 06:00 UTC)
// ════════════════════════════════════════════════════════════

const CAL_DEFAULT_TEXT = `Новоэровцам доброе утро!\nОстальным соболезную.\nИ помните: Саня Анякин приносит удачу!`;
const CAL_TABLE = 'calendar_events';

let _calEvents      = [];
let _calYear        = new Date().getFullYear();
let _calMonth       = new Date().getMonth();
let _calBusy        = false;

// "YYYY-MM-DD" → "MM-DD"
function _calMD(ds) { return ds.slice(5); }

async function calLoad(year, month) {
  const mm = String(month + 1).padStart(2, '0');
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/${CAL_TABLE}?month_day=gte.${mm}-01&month_day=lte.${mm}-31&order=month_day.asc`,
      { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }
    );
    _calEvents = r.ok ? await r.json() : [];
  } catch(e) { _calEvents = []; }
  // Грузим глобальный дефолт времени из settings
  try {
    const r2 = await fetch(
      `${SB_URL}/rest/v1/settings?key=eq.vk_post_time&select=value&limit=1`,
      { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + getToken() } }
    );
  } catch(e) {}
}

// ds = "YYYY-MM-DD", ищем по month_day = "MM-DD" (без года)
function calGetEvents(ds) { return _calEvents.filter(e => e.month_day === _calMD(ds)); }
function calGetEvent(ds) { return calGetEvents(ds)[0] || null; } // обратная совместимость
function _calDateStr(d)  { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ════════════════════════════════════════════════════════════
// РЕНДЕР СЕТКИ (карточка теперь в модальном окне)
// ════════════════════════════════════════════════════════════
async function renderCalendarBlock() {
  const el = document.getElementById('cal-block');
  if (!el) return;
  await calLoad(_calYear, _calMonth);

  const isSA  = ['superadmin','editor'].includes(user?.role);
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const todayStr  = _calDateStr(new Date());
  const firstDow  = new Date(_calYear, _calMonth, 1).getDay();
  const startDow  = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMon = new Date(_calYear, _calMonth + 1, 0).getDate();

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= daysInMon; d++) {
    const ds  = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const ev  = calGetEvent(ds);
    const dow = new Date(ds + 'T00:00:00').getDay();
    const isWe = dow === 0 || dow === 6;
    cells += `<div class="cal-cell${ds===todayStr?' cal-today':''}${ev?' cal-has-ev':''}${isWe?' cal-we':''}" onclick="calOpenDay('${ds}')">
    ${(ev?.composite_image_url || ev?.image_url) ? `<img class="cal-cell-img" src="${esc(ev.composite_image_url || ev.image_url)}" loading="lazy">` : ''}
      <div class="cal-cell-inner">
        <span class="cal-day-num">${d}</span>
        ${ev?.title ? `<span class="cal-cell-name">${esc(ev.title)}</span>` : ''}
      </div>
    </div>`;
  }

  el.innerHTML = `
<div style="margin-top:56px;padding-top:32px">
  <div class="hp-cl-hdr">◈ КАЛЕНДАРЬ</div>
  <div class="cal-wrap">
    <div class="cal-header">
      <div class="cal-nav">
        <button class="cal-nav-btn" onclick="calPrev()">&#8249;</button>
        <span class="cal-month-label">${MONTHS[_calMonth]} ${_calYear}</span>
        <button class="cal-nav-btn" onclick="calNext()">&#8250;</button>
      </div>
      ${isSA ? `
    ` : ''}
    </div>
    <div class="cal-grid-wrap">
      <div class="cal-dow-row">
        <span>ПН</span><span>ВТ</span><span>СР</span><span>ЧТ</span><span>ПТ</span>
        <span class="cal-dow-we">СБ</span><span class="cal-dow-we">ВС</span>
      </div>
      <div class="cal-grid">${cells}</div>
    </div>
  </div>
</div>`;
}

// ════════════════════════════════════════════════════════════
// МОДАЛЬНОЕ ОКНО ДНЯ
// ════════════════════════════════════════════════════════════
function calOpenDay(ds) {
  const events = calGetEvents(ds);
  const isSA   = ['superadmin','editor'].includes(user?.role);

  const _render = () => _buildDayModal(ds, events, isSA);

  let ov = document.getElementById('cal-modal-ov');
  if (ov && ov.classList.contains('cal-modal-ov--open')) {
    const modal = document.getElementById('cal-modal');
    if (modal) { modal.innerHTML = `<button class="cal-modal-close" onclick="calCloseDay()">&#x2715;</button>${_render()}`; window._calCurrentDay = ds; return; }
  }
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'cal-modal-ov'; ov.className = 'cal-modal-ov';
  ov.addEventListener('click', e => { if (e.target === ov) calCloseDay(); });
  ov.innerHTML = `
  <button class="cal-modal-nav cal-modal-nav-prev" onclick="calNavigateDay(-1)" title="Предыдущий день">‹</button>
  <button class="cal-modal-nav cal-modal-nav-next" onclick="calNavigateDay(1)" title="Следующий день">›</button>
  <div class="cal-modal" id="cal-modal">
    <button class="cal-modal-close" onclick="calCloseDay()">&#x2715;</button>
    ${_render()}
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('cal-modal-ov--open')));
  window._calCurrentDay = ds;
  if (!window._calKeyHandler) {
    window._calKeyHandler = (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); calNavigateDay(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); calNavigateDay(1); }
      else if (e.key === 'Escape') { calCloseDay(); }
    };
    document.addEventListener('keydown', window._calKeyHandler);
  }
}

function calCloseDay() {
  const ov = document.getElementById('cal-modal-ov');
  if (!ov) return;
  ov.classList.remove('cal-modal-ov--open');
  document.body.style.overflow = '';
  setTimeout(() => ov.remove(), 280);
  
  // Убираем обработчик клавиш
  if (window._calKeyHandler) {
    document.removeEventListener('keydown', window._calKeyHandler);
    window._calKeyHandler = null;
  }
  window._calCurrentDay = null;
}

// ════════════════════════════════════════════════════════════
// МОДАЛ ДНЯ — несколько событий
// ════════════════════════════════════════════════════════════
function _buildDayModal(ds, events, isSA) {
  const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const d        = new Date(ds + 'T00:00:00');
  const dayNum   = d.getDate();
  const monthStr = MONTHS_NOM[d.getMonth()].toUpperCase();
  const yearStr  = d.getFullYear();
  const fullDate = d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  const ev       = events[0] || null; // первое событие для картинки

  // ── Шапка с картинкой (hero переключается по кликам на события) ──
  let heroHtml = '';
  if (ev?.image_url) {
    const imgSrc = esc(ev.composite_image_url || ev.image_url);
    const hasComposite = !!ev.composite_image_url;
    heroHtml = `<div class="cal-card-img-wrap" id="cal-hero-wrap">
      <img src="${imgSrc}" class="cal-card-img" id="cal-hero-img" onclick="openLightbox('${imgSrc}','')">
      ${hasComposite ? '' : `<div class="cal-card-overlay">
        <div class="cal-card-date-badge">
          <span class="cal-card-day-big">${dayNum}</span>
          <span class="cal-card-month-sm">${monthStr} ${yearStr}</span>
        </div>
        <div class="cal-card-title" id="cal-hero-title">${ev.title ? esc(ev.title) : ''}</div>
      </div>`}
    </div>`;
  } else {
    heroHtml = `<div class="cal-card-noimg" id="cal-hero-wrap">
      <div class="cal-noimg-scan"></div><div class="cal-noimg-glow"></div>
      <div class="cal-noimg-body">
        <div class="cal-noimg-eyebrow">&#9672; &nbsp; ${monthStr} &nbsp; ${yearStr} &nbsp; &#9672;</div>
        <div class="cal-noimg-num">${dayNum}</div>
        ${ev?.title ? `<div class="cal-noimg-name">${esc(ev.title)}</div>` : `<div class="cal-noimg-void">— СОБЫТИЙ НЕТ —</div>`}
      </div>
    </div>`;
  }

  // ── Список событий ──────────────────────────────────────
  let eventsHtml = '';
  if (events.length > 0) {
    const multi = events.length > 1;

    eventsHtml = events.map((e, i) => {
      const bodyText  = e.body?.trim() ? e.body : CAL_DEFAULT_TEXT;
      const hasImg    = !!(e.composite_image_url || e.image_url);
      const headerClick = multi ? `onclick="calSwitchEvent(${i})"` : '';
      return `
    <div class="cal-event-item${i === 0 ? ' cal-event-item--first cal-event-item--active' : ''}${multi ? ' cal-event-item--multi' : ''}" id="cal-ev-item-${i}">
      <div class="cal-event-item-header" ${headerClick}>
        ${multi ? `<span class="cal-ev-chevron" id="cal-ev-arr-${i}">&#9658;</span>` : ''}
        <span class="cal-event-item-title${multi ? ' cal-event-item-title--link' : ''}">
          ${multi ? '' : '✦ '}${esc(e.title || '').toUpperCase()}
        </span>
        ${isSA ? `<div class="cal-event-item-actions" onclick="event.stopPropagation()">
          <button class="cal-icon-btn cal-icon-copy" onclick="calCopyTextEv('${esc(e.id)}')" title="Скопировать">📋</button>
          ${hasImg ? `<button class="cal-icon-btn cal-icon-dl" onclick="calDownloadImageEv('${esc(e.id)}')" title="Скачать">💾</button>` : ''}
          ${hasImg ? `<button class="cal-icon-btn cal-icon-regen" onclick="calRegenComposite('${ds}','${esc(e.id)}')" title="Перегенерировать картинку">🔄</button>` : ''}
          <button class="cal-icon-btn cal-icon-edit" onclick="calEditEvent('${ds}','${esc(e.id)}')" title="Редактировать">✏️</button>
          <button class="cal-icon-btn cal-icon-del" onclick="calDeleteEvent('${esc(e.id)}')" title="Удалить">✕</button>
        </div>` : ''}
      </div>
      <div class="cal-event-body-wrap" id="cal-ev-body-${i}" style="${multi && i !== 0 ? 'display:none' : ''}">
        <div class="cal-card-body-text">${esc(bodyText).replace(/\n/g,'<br>')}</div>
      </div>
    </div>`;
    }).join('');

    eventsHtml = `<div class="cal-events-list">
      <div class="cal-card-body-header">
        <span class="cal-card-body-date">🗓 ${fullDate.toUpperCase()}</span>
      </div>
      ${eventsHtml}
      <div class="cal-card-body-sign">— Новая Эра</div>
    </div>`;

    // Сохраняем для переключения hero-картинки
    if (multi) {
      window._calDayEvData = events.map(e => ({
        imgSrc:  e.composite_image_url || e.image_url || null,
        title:   e.title || '',
      }));
    } else {
      window._calDayEvData = null;
    }
  }

  // ── Кнопка добавить (только SA) ─────────────────────────
  const addBtn = isSA ? `<button class="cal-btn-add-event" onclick="calEditEvent('${ds}','')">＋ Добавить событие</button>` : '';

  // ── Форма редактирования (скрыта по умолчанию) ──────────
  const editForm = isSA ? `<div class="cal-edit-wrap" id="cal-edit-form" style="display:none">
    <div class="cal-edit-hdr">
      <span class="cal-edit-label" id="cal-edit-form-label">&#9672; НОВОЕ СОБЫТИЕ</span>
      <button class="cal-icon-btn" onclick="calEditClose()" title="Закрыть">✕</button>
    </div>
    <input id="cal-f-title" class="cal-input" placeholder="Название праздника" maxlength="120">
    <div class="cal-img-row">
      <input id="cal-f-img" class="cal-input" placeholder="URL картинки" oninput="calPreviewImg()">
      <label class="cal-upload-btn" title="Загрузить файл">📎<input type="file" accept="image/*" style="display:none" onchange="calUploadImg(this)"></label>
    </div>
    <textarea id="cal-f-body" class="cal-textarea" rows="5" placeholder="Текст поздравления (пусто = дефолт)"></textarea>
    <div class="cal-form-hint">Пустой текст → «${CAL_DEFAULT_TEXT.split('\n')[0]}…»</div>
    <div class="cal-form-btns">
      <button class="cal-btn-save" id="cal-f-save-btn" onclick="calSaveEventForm('${ds}')">&#x2713; Сохранить</button>
      <button class="cal-btn-preview" onclick="calGeneratePreviewForm('${ds}')">&#128065; Превью</button>
    </div>
  </div>` : '';

  return `<div class="cal-card">${heroHtml}</div>${eventsHtml}${addBtn}${editForm}`;
}

// Обратная совместимость
function _buildCalCard(ds, ev, isSA) {
  return _buildDayModal(ds, ev ? [ev] : [], isSA);
}

// ── Открыть форму редактирования события ────────────────────
function calEditEvent(ds, evId) {
  const form = document.getElementById('cal-edit-form');
  if (!form) return;
  const label = document.getElementById('cal-edit-form-label');

  if (evId) {
    const ev = _calEvents.find(e => e.id === evId);
    if (ev) {
      document.getElementById('cal-f-title').value = ev.title || '';
      document.getElementById('cal-f-img').value   = ev.image_url || '';
      document.getElementById('cal-f-body').value  = ev.body || '';
      if (label) label.textContent = '◈ РЕДАКТИРОВАТЬ · ' + (ev.title || '');
      form.dataset.editId = evId;
    }
  } else {
    document.getElementById('cal-f-title').value = '';
    document.getElementById('cal-f-img').value   = '';
    document.getElementById('cal-f-body').value  = '';
    if (label) label.textContent = '◈ НОВОЕ СОБЫТИЕ';
    form.dataset.editId = '';
  }

  form.style.display = 'flex';
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function calEditClose() {
  const form = document.getElementById('cal-edit-form');
  if (form) form.style.display = 'none';
}

// ── Сохранить из формы ────────────────────────────────────────
async function calSaveEventForm(ds) {
  const form  = document.getElementById('cal-edit-form');
  const evId  = form?.dataset.editId || '';
  await calSaveEvent(ds, evId);
}

function calGeneratePreviewForm(ds) {
  calGeneratePreview(ds);
}

// ── Копировать/скачать по id события ─────────────────────────
function calCopyTextEv(evId) {
  const ev = _calEvents.find(e => e.id === evId); if (!ev) return;
  const d = new Date((ev.event_date||'2000-01-01') + 'T00:00:00');
  const fullDate = d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  const text = `📅 ${fullDate.toUpperCase()}\n✦ ${(ev.title||'').toUpperCase()}\n\n${ev.body?.trim()||CAL_DEFAULT_TEXT}\n\n— Новая Эра`;
  navigator.clipboard.writeText(text).then(() => toast('Текст скопирован', 'ok')).catch(e => toast('Ошибка: '+e.message,'err'));
}

function calDownloadImageEv(evId) {
  const ev = _calEvents.find(e => e.id === evId); if (!ev) return;
  const url = ev.composite_image_url || ev.image_url; if (!url) { toast('Нет картинки','err'); return; }
  fetch(url).then(r=>r.blob()).then(blob=>{
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `event_${evId}.jpg`; document.body.appendChild(a); a.click();
    document.body.removeChild(a); toast('Скачивается','ok');
  }).catch(e=>toast('Ошибка: '+e.message,'err'));
}
function calPrev() { if(_calMonth===0){_calMonth=11;_calYear--;}else _calMonth--; renderCalendarBlock(); }
function calNext() { if(_calMonth===11){_calMonth=0;_calYear++;}else _calMonth++; renderCalendarBlock(); }

function calPreviewImg() {
  const url = document.getElementById('cal-f-img')?.value.trim();
  const img = document.querySelector('#cal-modal .cal-card-img');
  if (img && url) img.src = url;
}

async function calUploadImg(input) {
  const file = input.files[0]; if (!file) return;
  try {
    const token = await getTokenFresh();
    const ext   = file.name.split('.').pop().toLowerCase();
    const fname = `cal_${Date.now()}.${ext}`;
    const r = await fetch(`${SB_URL}/storage/v1/object/images/${fname}`, {
      method:  'POST',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': file.type, 'x-upsert': 'true' },
      body: file,
    });
    if (!r.ok) { const errText = await r.text().catch(()=>''); throw new Error(`HTTP ${r.status}${errText?': '+errText.slice(0,120):''}`); }
    const url = `${SB_URL}/storage/v1/object/public/images/${fname}`;
    const inp = document.getElementById('cal-f-img');
    if (inp) { inp.value = url; calPreviewImg(); }
    toast('Картинка загружена', 'ok');
  } catch(e) { toast('Ошибка загрузки: ' + e.message, 'err'); }
}


async function calGeneratePreview(ds) {
  // Ищем весь верхний контейнер карточки
  const cardContainer = document.querySelector('#cal-modal .cal-card');
  if (!cardContainer) return;

  // Берем данные, которые ты прямо сейчас вбил в инпуты
  const title = document.getElementById('cal-f-title')?.value.trim() || '';
  const imageUrl = document.getElementById('cal-f-img')?.value.trim() || '';
  
  toast('Генерирую превью...', 'inf');
  
  try {
    // Рисуем квадрат 1000х1000
    const blob = await calRenderCompositeImage(ds, { title, image_url: imageUrl });
    const localUrl = URL.createObjectURL(blob);
    
    // Жестко заменяем всё, что было сверху (хоть старую картинку, хоть пустую заглушку), на готовый превью-рендер
    cardContainer.innerHTML = `
      <div class="cal-card-img-wrap">
        <img src="${localUrl}" class="cal-card-img" onclick="openLightbox('${localUrl}','')">
      </div>
    `;
    
  } catch (e) {
    toast('Ошибка генерации превью', 'err');
    console.error(e);
  }
}

async function calSaveEvent(ds, existingId) {
  if (_calBusy || !['superadmin','editor'].includes(user?.role)) return;
  const title         = document.getElementById('cal-f-title')?.value.trim() || '';
  const bodyVal       = document.getElementById('cal-f-body')?.value.trim()  || '';
  const imageUrl      = document.getElementById('cal-f-img')?.value.trim()   || '';
  _calBusy = true;
  try {
    const token   = await getTokenFresh();
    // month_day = "MM-DD" — без года, работает вечно
    const payload = {
      event_date:     ds,          // <--- ДОБАВЬ ВОТ ЭТУ СТРОЧКУ
      month_day:      _calMD(ds),
      title:          title    || null,
      body:           bodyVal  || null,
      image_url:      imageUrl || null,
    };
    if (!existingId) payload.created_by = user.id;

    const r = await fetch(
      existingId ? `${SB_URL}/rest/v1/${CAL_TABLE}?id=eq.${existingId}` : `${SB_URL}/rest/v1/${CAL_TABLE}`,
      { method: existingId ? 'PATCH' : 'POST',
        headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify(payload) }
    );
    if (!r.ok) { const errData = await r.json().catch(()=>({})); throw new Error(errData?.message||errData?.error||'HTTP '+r.status); }
    const saved   = await r.json().catch(()=>[]);
    const savedId = (Array.isArray(saved) ? saved[0]?.id : saved?.id) || existingId;
    toast('Сохранено', 'ok');

    if (savedId) {
      calUpdateComposite(ds, savedId, { title, image_url: imageUrl }).catch(e =>
        console.warn('[cal] composite auto-render failed:', e.message)
      );
    }

    await calLoad(_calYear, _calMonth);
    renderCalendarBlock();
    // Обновляем модал без закрытия
    const modal = document.getElementById('cal-modal');
    if (modal) {
      const isSA = ['superadmin','editor'].includes(user?.role);
      modal.innerHTML = `<button class="cal-modal-close" onclick="calCloseDay()">&#x2715;</button>${_buildDayModal(ds, calGetEvents(ds), isSA)}`;
    } else {
      calCloseDay();
      setTimeout(() => calOpenDay(ds), 80);
    }
  } catch(e) { toast(e.message, 'err'); }
  finally { _calBusy = false; }
}


async function calDeleteEvent(id) {
  if (!confirm('Удалить событие?')) return;
  try {
    const token = await getTokenFresh();
    await fetch(`${SB_URL}/rest/v1/${CAL_TABLE}?id=eq.${id}`, { method:'DELETE', headers:{'apikey':SB_ANON,'Authorization':'Bearer '+token} });
    toast('Удалено', 'inf');
    calCloseDay();
    await calLoad(_calYear, _calMonth);
    renderCalendarBlock();
  } catch(e) { toast(e.message, 'err'); }
}

// ── Перегенерировать composite для существующего события ────────
async function calRegenComposite(ds, evId) {
  if (_calBusy || !['superadmin','editor'].includes(user?.role)) return;
  const ev = _calEvents.find(e => e.id === evId);
  if (!ev) { toast('Событие не найдено', 'err'); return; }
  _calBusy = true;
  try {
    toast('Генерирую картинку…', 'inf');
    await calUpdateComposite(ds, evId, { title: ev.title, image_url: ev.image_url });
    toast('Картинка перегенерирована', 'ok');
    await calLoad(_calYear, _calMonth);
    renderCalendarBlock();
    const modal = document.getElementById('cal-modal');
    if (modal) {
      modal.innerHTML = `<button class="cal-modal-close" onclick="calCloseDay()">&#x2715;</button>${_buildDayModal(ds, calGetEvents(ds), true)}`;
    }
  } catch(e) { toast(e.message, 'err'); }
  finally { _calBusy = false; }
}

// ════════════════════════════════════════════════════════════
// CANVAS — композитная картинка для ВК (1200×630)
// ════════════════════════════════════════════════════════════

async function calUpdateComposite(ds, savedId, data) {
  try {
    console.log('[cal] Рисуем композитную картинку...');

    // 1. Рисуем канвас (передаем данные, которые ввели в форму)
    const ev = { ...data, id: savedId };
    const blob = await calRenderCompositeImage(ds, ev);

    // 2. Загружаем готовую картинку в Supabase Storage
    const token = await getTokenFresh();
    const fname = `cal_composite_${_calMD(ds)}_${Date.now()}.jpg`;

    const rUpload = await fetch(`${SB_URL}/storage/v1/object/images/${fname}`, {
      method: 'POST',
      headers: {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'true'
      },
      body: blob,
    });

    if (!rUpload.ok) throw new Error('Ошибка загрузки файла в Storage');
    const compositeUrl = `${SB_URL}/storage/v1/object/public/images/${fname}`;

    // 3. Сохраняем ссылку в колонку composite_image_url
    const rUpdate = await fetch(`${SB_URL}/rest/v1/${CAL_TABLE}?id=eq.${savedId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ composite_image_url: compositeUrl })
    });

    if (!rUpdate.ok) throw new Error('Ошибка обновления БД');
    console.log('[cal] ✅ Композитная картинка сохранена:', compositeUrl);

  } catch (e) {
    console.warn('[cal] ❌ Ошибка:', e.message);
  }
}

async function calRenderCompositeImage(ds, ev) {
  const W = 1000, H = 1000; 
  const canvas   = document.createElement('canvas');
  canvas.width   = W;
  canvas.height  = H;
  const ctx      = canvas.getContext('2d');

  const d        = new Date(ds + 'T00:00:00');
  const dayNum   = String(d.getDate());
  const monthIndex = d.getMonth();
  
  // Месяцы в родительном падеже
  const monthsGenitive = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const monthStr = monthsGenitive[monthIndex].toUpperCase();
  
  const title    = ev?.title || '';

  // 1. Фон 
  if (ev?.image_url) {
    try {
      const img   = await _calLoadImage(ev.image_url);
      const scale = Math.max(W / img.width, H / img.height);
      const sw    = img.width  * scale;
      const sh    = img.height * scale;
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
    } catch(e) { _calDrawDarkBg(ctx, W, H); }
  } else {
    _calDrawDarkBg(ctx, W, H);
  }

  // 2. Чистые градиенты для читаемости (без грязи на всем фото)
  // Плотный темный низ для названия
  const gradBottom = ctx.createLinearGradient(0, H * 0.4, 0, H);
  gradBottom.addColorStop(0,   'rgba(4,5,10,0)');       
  gradBottom.addColorStop(0.6, 'rgba(4,5,10,0.7)');    
  gradBottom.addColorStop(1,   'rgba(4,5,10,0.98)'); // Усилил черноту в самом низу
  ctx.fillStyle = gradBottom;
  ctx.fillRect(0, 0, W, H);

  // Темный верх для защиты верхнего лейбла (сделал чуть длиннее и плотнее)
  const gradTop = ctx.createLinearGradient(0, 0, 0, 220);
  gradTop.addColorStop(0, 'rgba(4,5,10,0.9)');
  gradTop.addColorStop(1, 'rgba(4,5,10,0)');
  ctx.fillStyle = gradTop;
  ctx.fillRect(0, 0, W, 220);

  // 3. Элегантная рамка
  const pad = 40;
  
  // Тонкая полупрозрачная линия по всему периметру
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // Сделал стекло чуть виднее
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

  // Чистые золотые уголки (сделал золото поярче)
  const cornerL = 50;
  const goldColor = '#e8b948'; 
  ctx.strokeStyle = goldColor;
  ctx.lineWidth   = 3;
  [[pad, pad, 1, 1],[W-pad, pad,-1,1],[pad, H-pad,1,-1],[W-pad,H-pad,-1,-1]].forEach(([x,y,dx,dy]) => {
    ctx.beginPath();
    ctx.moveTo(x + dx * cornerL, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * cornerL);
    ctx.stroke();
  });

  const setPremiumText = () => {
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.shadowOffsetX = 2;
  };
  const clearShadow = () => {
    ctx.shadowColor = 'transparent';
  };

  // --- ВЕРСТКА СНИЗУ ВВЕРХ ---
  const tlh   = 52;
  const tFont = 'bold 40px "Arial Black", Arial, sans-serif';

  // Разбиваем название на строки
  let lines = [];
  if (title) {
    ctx.font = tFont;
    const maxW = W - pad * 2 - 40 - 40 - 40; // Вычитаем отступы для точек слева и справа (по 40px)
    const words = title.toUpperCase().split(' ');
    let line = '';
    for (const w of words) {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';

  // Layout: компактные адаптивные размеры
  const NUM_SIZE  = W * 0.15;  // увеличил с 0.12
  const MON_SIZE  = W * 0.065; // увеличил с 0.05
  const T_SIZE    = W * 0.04;
  const LINE_H    = T_SIZE * 1.4;
  
  // Отступы внутри лейблов
  const PAD_X = 10;
  const PAD_Y = 14;
  
  const nLines     = lines.length;
  const BOTTOM     = pad + W * 0.04;
  const GAP = 15;
  const LABEL_GAP = W * 0.02;

  // --- Название в рамке (снизу) ---
  ctx.font = `bold ${T_SIZE}px "Arial Black", Arial, sans-serif`;
  const titleBoxH  = nLines * T_SIZE * 0.85 + PAD_Y * 2 + (nLines - 1) * (LINE_H - T_SIZE * 0.85);
  const titleBoxY  = H - BOTTOM - titleBoxH;
  const titleBoxW = W - pad * 2 - 40;

  // --- Число и месяц: высота = размер шрифта * 0.85 (реальная высота букв) + отступы ---
  // Рамка числа
  ctx.font = `bold ${NUM_SIZE}px "Arial Black", Arial, sans-serif`;
  const numTextW  = ctx.measureText(dayNum).width;
  const numBoxW   = numTextW + PAD_X * 2;
  const numBoxH   = NUM_SIZE * 0.85 + PAD_Y * 2;
  const numBoxBottomY = titleBoxY - GAP;
  const numBoxY   = numBoxBottomY - numBoxH;
  const numBoxX   = pad + 20;
  
  // Рамка месяца
  ctx.font = `bold ${MON_SIZE}px "Arial Black", Arial, sans-serif`;
  const monTextW  = ctx.measureText(monthStr).width;
  const monBoxW   = monTextW + PAD_X * 2;
  const monBoxH   = MON_SIZE * 0.85 + PAD_Y * 2;
  const monBoxY   = numBoxBottomY - monBoxH;
  const monBoxX   = numBoxX + numBoxW + LABEL_GAP;

  // ── Лейбл сверху с рамкой (широкий с вырезами, по центру) ─────────────────────────────────
  const headerText = '◈  НОВАЯ ЭРА  ·  ПРАЗДНИЧНЫЙ КАЛЕНДАРЬ  ◈';
  const headerSize = 18;
  ctx.font = `bold ${headerSize}px "Arial Black", Arial, sans-serif`;
  const headerTextW = ctx.measureText(headerText).width;
  const headerBoxW = Math.min(headerTextW + 120, W - pad * 2 - 40); // Ширина с запасом для иконки
  const headerBoxH = headerSize * 0.85 + PAD_Y * 2 + 8;
  const headerBoxX = (W - headerBoxW) / 2; // По центру
  const headerBoxY = pad + 15;
  const cutSize = 30; // размер вырезов по бокам
  
  // Фон
  const headerGrad = ctx.createLinearGradient(headerBoxX, headerBoxY, headerBoxX, headerBoxY + headerBoxH);
  headerGrad.addColorStop(0, 'rgba(12,14,22,0.85)');
  headerGrad.addColorStop(1, 'rgba(6,8,14,0.8)');
  ctx.fillStyle = headerGrad;
  
  // Сложная форма с вырезами
  ctx.beginPath();
  ctx.moveTo(headerBoxX + cutSize, headerBoxY);
  ctx.lineTo(headerBoxX + headerBoxW - cutSize, headerBoxY);
  ctx.lineTo(headerBoxX + headerBoxW, headerBoxY + cutSize);
  ctx.lineTo(headerBoxX + headerBoxW, headerBoxY + headerBoxH - cutSize);
  ctx.lineTo(headerBoxX + headerBoxW - cutSize, headerBoxY + headerBoxH);
  ctx.lineTo(headerBoxX + cutSize, headerBoxY + headerBoxH);
  ctx.lineTo(headerBoxX, headerBoxY + headerBoxH - cutSize);
  ctx.lineTo(headerBoxX, headerBoxY + cutSize);
  ctx.closePath();
  ctx.fill();
  
  // Обводка
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Текст по центру
  const headerTextGrad = ctx.createLinearGradient(headerBoxX, headerBoxY, headerBoxX, headerBoxY + headerBoxH);
  headerTextGrad.addColorStop(0, '#f4d88a');
  headerTextGrad.addColorStop(0.5, goldColor);
  headerTextGrad.addColorStop(1, '#c89a3a');
  ctx.fillStyle = headerTextGrad;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  setPremiumText();
  ctx.fillText(headerText, headerBoxX + headerBoxW / 2, headerBoxY + headerBoxH / 2);
  clearShadow();

  // ── Рамка + текст числа ───────────────────────────────────
  const numSkew = 12; // Увеличил скос для более выразительной формы
  
  // Тонкий градиент
  const numGrad = ctx.createLinearGradient(numBoxX, numBoxY, numBoxX, numBoxY + numBoxH);
  numGrad.addColorStop(0, 'rgba(12,14,22,0.9)');
  numGrad.addColorStop(1, 'rgba(6,8,14,0.85)');
  ctx.fillStyle = numGrad;
  
  ctx.beginPath();
  ctx.moveTo(numBoxX + numSkew, numBoxY);
  ctx.lineTo(numBoxX + numBoxW - numSkew, numBoxY);
  ctx.lineTo(numBoxX + numBoxW, numBoxY + numSkew);
  ctx.lineTo(numBoxX + numBoxW, numBoxY + numBoxH - numSkew);
  ctx.lineTo(numBoxX + numBoxW - numSkew, numBoxY + numBoxH);
  ctx.lineTo(numBoxX + numSkew, numBoxY + numBoxH);
  ctx.lineTo(numBoxX, numBoxY + numBoxH - numSkew);
  ctx.lineTo(numBoxX, numBoxY + numSkew);
  ctx.closePath();
  ctx.fill();
  
  // Тонкая подсветка
  const numLight = ctx.createLinearGradient(numBoxX, numBoxY, numBoxX, numBoxY + 30);
  numLight.addColorStop(0, 'rgba(255,255,255,0.12)');
  numLight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = numLight;
  ctx.fill();
  
  // Двойная обводка (более контрастная)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 5;
  ctx.stroke();
  
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Декоративные углы (более крупные и яркие)
  const numCorner = 18;
  ctx.strokeStyle = 'rgba(100,200,255,0.9)';
  ctx.lineWidth = 3;
  
  // Левый верхний
  ctx.beginPath();
  ctx.moveTo(numBoxX + numSkew + numCorner, numBoxY);
  ctx.lineTo(numBoxX + numSkew, numBoxY);
  ctx.lineTo(numBoxX, numBoxY + numSkew);
  ctx.lineTo(numBoxX, numBoxY + numSkew + numCorner);
  ctx.stroke();
  
  // Правый нижний
  ctx.beginPath();
  ctx.moveTo(numBoxX + numBoxW - numSkew - numCorner, numBoxY + numBoxH);
  ctx.lineTo(numBoxX + numBoxW - numSkew, numBoxY + numBoxH);
  ctx.lineTo(numBoxX + numBoxW, numBoxY + numBoxH - numSkew);
  ctx.lineTo(numBoxX + numBoxW, numBoxY + numBoxH - numSkew - numCorner);
  ctx.stroke();
  
  ctx.font = `bold ${NUM_SIZE}px "Arial Black", Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  // Градиентная текстура для числа (более контрастная)
  const numTextGrad = ctx.createLinearGradient(numBoxX, numBoxY, numBoxX, numBoxY + numBoxH);
  numTextGrad.addColorStop(0, '#ffffff');
  numTextGrad.addColorStop(0.3, '#f0f0f0');
  numTextGrad.addColorStop(0.7, '#b8b8b8');
  numTextGrad.addColorStop(1, '#909090');
  ctx.fillStyle = numTextGrad;
  
  setPremiumText();
  ctx.fillText(dayNum, numBoxX + PAD_X, numBoxY + PAD_Y);
  clearShadow();

  // ── Рамка + текст месяца ──────────────────────────────────
  const monSkew = 6;
  
  // Тонкий градиент
  const monGrad = ctx.createLinearGradient(monBoxX, monBoxY, monBoxX, monBoxY + monBoxH);
  monGrad.addColorStop(0, 'rgba(12,14,22,0.85)');
  monGrad.addColorStop(1, 'rgba(6,8,14,0.8)');
  ctx.fillStyle = monGrad;
  
  ctx.beginPath();
  ctx.moveTo(monBoxX + monSkew, monBoxY);
  ctx.lineTo(monBoxX + monBoxW - monSkew, monBoxY);
  ctx.lineTo(monBoxX + monBoxW, monBoxY + monSkew);
  ctx.lineTo(monBoxX + monBoxW, monBoxY + monBoxH - monSkew);
  ctx.lineTo(monBoxX + monBoxW - monSkew, monBoxY + monBoxH);
  ctx.lineTo(monBoxX + monSkew, monBoxY + monBoxH);
  ctx.lineTo(monBoxX, monBoxY + monBoxH - monSkew);
  ctx.lineTo(monBoxX, monBoxY + monSkew);
  ctx.closePath();
  ctx.fill();
  
  // Тонкая подсветка
  const monLight = ctx.createLinearGradient(monBoxX, monBoxY, monBoxX, monBoxY + 20);
  monLight.addColorStop(0, 'rgba(232,185,72,0.1)');
  monLight.addColorStop(1, 'rgba(232,185,72,0)');
  ctx.fillStyle = monLight;
  ctx.fill();
  
  // Двойная обводка для месяца
  ctx.strokeStyle = 'rgba(232,185,72,0.3)';
  ctx.lineWidth = 4;
  ctx.stroke();
  
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Декоративные углы
  const monCorner = 8;
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 2;
  
  // Правый верхний
  ctx.beginPath();
  ctx.moveTo(monBoxX + monBoxW - monSkew - monCorner, monBoxY);
  ctx.lineTo(monBoxX + monBoxW - monSkew, monBoxY);
  ctx.lineTo(monBoxX + monBoxW, monBoxY + monSkew);
  ctx.lineTo(monBoxX + monBoxW, monBoxY + monSkew + monCorner);
  ctx.stroke();
  
  // Левый нижний
  ctx.beginPath();
  ctx.moveTo(monBoxX + monSkew + monCorner, monBoxY + monBoxH);
  ctx.lineTo(monBoxX + monSkew, monBoxY + monBoxH);
  ctx.lineTo(monBoxX, monBoxY + monBoxH - monSkew);
  ctx.lineTo(monBoxX, monBoxY + monBoxH - monSkew - monCorner);
  ctx.stroke();
  
  // Маленькие индикаторы снизу
  ctx.fillStyle = 'rgba(232,185,72,0.5)';
  const monIndY = monBoxY + monBoxH - 8;
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(monBoxX + 10 + i * 6, monIndY, 3, 3);
  }
  
  ctx.font = `bold ${MON_SIZE}px "Arial Black", Arial, sans-serif`;
  ctx.fillStyle = goldColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  // Градиентная текстура для месяца
  const monTextGrad = ctx.createLinearGradient(monBoxX, monBoxY, monBoxX, monBoxY + monBoxH);
  monTextGrad.addColorStop(0, '#f4d88a');
  monTextGrad.addColorStop(0.5, goldColor);
  monTextGrad.addColorStop(1, '#c89a3a');
  ctx.fillStyle = monTextGrad;
  
  setPremiumText();
  ctx.fillText(monthStr, monBoxX + PAD_X, monBoxY + PAD_Y);
  clearShadow();

  // ── Рамка + текст названия ────────────────────────────────
  const titleSkew = 8;
  const titleBoxX = pad + 20;
  
  // Тонкий градиент
  const titleGrad = ctx.createLinearGradient(titleBoxX, titleBoxY, titleBoxX, titleBoxY + titleBoxH);
  titleGrad.addColorStop(0, 'rgba(12,14,22,0.85)');
  titleGrad.addColorStop(1, 'rgba(6,8,14,0.8)');
  ctx.fillStyle = titleGrad;
  
  ctx.beginPath();
  ctx.moveTo(titleBoxX + titleSkew, titleBoxY);
  ctx.lineTo(titleBoxX + titleBoxW - titleSkew, titleBoxY);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleSkew);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleBoxH - titleSkew);
  ctx.lineTo(titleBoxX + titleBoxW - titleSkew, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX + titleSkew, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX, titleBoxY + titleBoxH - titleSkew);
  ctx.lineTo(titleBoxX, titleBoxY + titleSkew);
  ctx.closePath();
  ctx.fill();
  
  // Тонкая подсветка
  const titleLight = ctx.createLinearGradient(titleBoxX, titleBoxY, titleBoxX, titleBoxY + 20);
  titleLight.addColorStop(0, 'rgba(232,185,72,0.08)');
  titleLight.addColorStop(1, 'rgba(232,185,72,0)');
  ctx.fillStyle = titleLight;
  ctx.fill();
  
  // Двойная обводка для названия
  ctx.strokeStyle = 'rgba(232,185,72,0.3)';
  ctx.lineWidth = 4;
  ctx.stroke();
  
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Декоративные углы для названия
  const titleCorner = 14;
  ctx.strokeStyle = goldColor;
  ctx.lineWidth = 2.5;
  
  // Левый верхний угол
  ctx.beginPath();
  ctx.moveTo(titleBoxX + titleSkew + titleCorner, titleBoxY);
  ctx.lineTo(titleBoxX + titleSkew, titleBoxY);
  ctx.lineTo(titleBoxX, titleBoxY + titleSkew);
  ctx.lineTo(titleBoxX, titleBoxY + titleSkew + titleCorner);
  ctx.stroke();
  
  // Правый верхний угол
  ctx.beginPath();
  ctx.moveTo(titleBoxX + titleBoxW - titleSkew - titleCorner, titleBoxY);
  ctx.lineTo(titleBoxX + titleBoxW - titleSkew, titleBoxY);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleSkew);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleSkew + titleCorner);
  ctx.stroke();
  
  // Левый нижний угол
  ctx.beginPath();
  ctx.moveTo(titleBoxX + titleSkew + titleCorner, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX + titleSkew, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX, titleBoxY + titleBoxH - titleSkew);
  ctx.lineTo(titleBoxX, titleBoxY + titleBoxH - titleSkew - titleCorner);
  ctx.stroke();
  
  // Правый нижний угол
  ctx.beginPath();
  ctx.moveTo(titleBoxX + titleBoxW - titleSkew - titleCorner, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX + titleBoxW - titleSkew, titleBoxY + titleBoxH);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleBoxH - titleSkew);
  ctx.lineTo(titleBoxX + titleBoxW, titleBoxY + titleBoxH - titleSkew - titleCorner);
  ctx.stroke();
  
  // Маленькие индикаторы слева
  ctx.fillStyle = 'rgba(232,185,72,0.6)';
  const titleIndX = titleBoxX + 12;
  const titleIndY = titleBoxY + titleBoxH / 2;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(titleIndX, titleIndY - 6 + i * 6, 4, 4);
  }
  
  // Маленькие индикаторы справа
  const titleIndRightX = titleBoxX + titleBoxW - 20;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(titleIndRightX, titleIndY - 6 + i * 6, 4, 4);
  }
  
  ctx.font = `bold ${T_SIZE}px "Arial Black", Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  if (nLines > 0) {
    lines.forEach((l, i) => {
      // Градиентная текстура для каждой строки (более контрастная)
      const lineY = titleBoxY + PAD_Y + i * LINE_H;
      const lineTextGrad = ctx.createLinearGradient(titleBoxX, lineY, titleBoxX, lineY + T_SIZE);
      lineTextGrad.addColorStop(0, '#ffffff');
      lineTextGrad.addColorStop(0.3, '#f0f0f0');
      lineTextGrad.addColorStop(0.7, '#b8b8b8');
      lineTextGrad.addColorStop(1, '#909090');
      ctx.fillStyle = lineTextGrad;
      
      setPremiumText();
      ctx.fillText(l, titleBoxX + PAD_X + 20, lineY); // Добавил отступ 20px слева для точек
    });
    clearShadow();
  }

  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.95));
}

function _calDrawDarkBg(ctx, W, H) {
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W/2, H*0.55, 0, W/2, H*0.55, W * 0.55);
  glow.addColorStop(0, 'rgba(168,105,44,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function _calLoadImage(url) {
  return new Promise((resolve, reject) => {
    const img      = new Image();
    img.crossOrigin = 'anonymous';
    img.onload     = () => resolve(img);
    img.onerror    = () => reject(new Error('img load failed: ' + url));
    img.src        = url + (url.includes('?') ? '&' : '?') + '_c=' + Date.now();
  });
}

// ════════════════════════════════════════════════════════════
// ОТПРАВКА В ВК — composite картинка + правильный текст поста
// ════════════════════════════════════════════════════════════



// ── Копирование текста события ────────────────────────────────
function calCopyText(ds) {
  const ev = calGetEvent(ds);
  const d = new Date(ds + 'T00:00:00');
  const fullDate = d.toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'});
  
  const title = ev?.title || '';
  const body = ev?.body?.trim() || CAL_DEFAULT_TEXT;
  
  // Форматируем текст с нормальными отступами
  const text = `📅 ${fullDate.toUpperCase()}
✦ ${title.toUpperCase()}

${body}

— Новая Эра`;
  
  navigator.clipboard.writeText(text).then(() => {
    toast('Текст скопирован в буфер обмена', 'ok');
  }).catch(err => {
    toast('Ошибка копирования: ' + err.message, 'err');
  });
}

// ── Скачивание картинки события ───────────────────────────────
function calDownloadImage(ds) {
  const ev = calGetEvent(ds);
  if (!ev?.composite_image_url && !ev?.image_url) {
    toast('Нет картинки для скачивания', 'err');
    return;
  }
  
  const imageUrl = ev.composite_image_url || ev.image_url;
  const d = new Date(ds + 'T00:00:00');
  const fileName = `${ds}_${(ev.title || 'event').replace(/[^a-zа-яё0-9]/gi, '_')}.jpg`;
  
  fetch(imageUrl)
    .then(res => res.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast('Картинка скачивается', 'ok');
    })
    .catch(err => {
      toast('Ошибка скачивания: ' + err.message, 'err');
    });
}

// ── Переключение активного события в модале (несколько событий в день) ──
function calSwitchEvent(idx) {
  const evData = window._calDayEvData;
  if (!evData || idx < 0 || idx >= evData.length) return;

  evData.forEach((_, i) => {
    const body = document.getElementById(`cal-ev-body-${i}`);
    if (body) body.style.display = i === idx ? '' : 'none';

    const chevron = document.getElementById(`cal-ev-arr-${i}`);
    if (chevron) chevron.style.transform = i === idx ? 'rotate(90deg)' : '';

    const item = document.getElementById(`cal-ev-item-${i}`);
    if (item) item.classList.toggle('cal-event-item--active', i === idx);
  });

  // Переключаем hero-картинку
  const ev = evData[idx];
  const heroImg = document.getElementById('cal-hero-img');
  if (heroImg && ev.imgSrc) {
    heroImg.src = ev.imgSrc;
    heroImg.onclick = () => openLightbox(ev.imgSrc, '');
  }
  const heroTitle = document.getElementById('cal-hero-title');
  if (heroTitle) heroTitle.textContent = ev.title;
}

// ── Навигация между днями стрелками ────────────────────────────
async function calNavigateDay(direction) {
  if (!window._calCurrentDay) return;
  
  // Парсим текущую дату из строки YYYY-MM-DD
  const parts = window._calCurrentDay.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // месяцы с 0
  const day = parseInt(parts[2], 10);
  
  const currentDate = new Date(year, month, day);
  currentDate.setDate(currentDate.getDate() + direction);
  
  const newYear = currentDate.getFullYear();
  const newMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
  const newDay = String(currentDate.getDate()).padStart(2, '0');
  const newDs = `${newYear}-${newMonth}-${newDay}`;
  
  // Проверяем, нужно ли переключить месяц в календаре
  if (currentDate.getMonth() !== _calMonth || currentDate.getFullYear() !== _calYear) {
    _calMonth = currentDate.getMonth();
    _calYear = currentDate.getFullYear();
    // Загружаем события для нового месяца
    await calLoad(_calYear, _calMonth);
    renderCalendarBlock();
  }
  
  // Открываем новый день
  calOpenDay(newDs);
}
