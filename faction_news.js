// ════════════════════════════════════════════════════════════
// FACTION NEWS — новости фракций: написание игроком, модерация
// администрацией, публикация на главной в «газетном» стиле.
// Поток: игрок пишет → pending → стафф одобряет/отклоняет → approved
// показывается на главной и в кабинете автора.
// ════════════════════════════════════════════════════════════

const FN = {
  approved: [],          // одобренные новости (для главной)
  byId: new Map(),       // id → новость (для открытия статьи)
  myFac: undefined,      // approved-анкета текущего игрока (null — нет)
  busy: false,
};

function fnIsStaff() { return !!(user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }

// Перерисовать активный список новостей — где бы он сейчас ни был открыт:
// в экономическом кабинете (вкладка «Новости») или в панели профиля (#ap).
function fnRefresh() {
  const mount = document.getElementById('ec-news-mount');
  if (mount) { fnRenderNewsTab(mount); return; }
  if (typeof apOpen !== 'undefined' && apOpen && typeof apTab !== 'undefined' && apTab === 'news' && typeof renderApTab === 'function') {
    renderApTab();
  }
}

// Одобренная анкета текущего пользователя (с кэшем). null — фракции нет.
async function fnGetMyFaction(force) {
  if (!user) return null;
  if (FN.myFac !== undefined && !force) return FN.myFac;
  try {
    const rows = await dbGet('faction_applications',
      `owner_id=eq.${user.id}&status=eq.approved&order=updated_at.desc&limit=1&select=faction_id,name,color,herald_url`);
    FN.myFac = (rows && rows[0]) ? rows[0] : null;
  } catch (e) { FN.myFac = null; }
  return FN.myFac;
}

// Краткое превью из текста, если лид не задан.
function fnExcerpt(n) {
  const e = (n.excerpt || '').trim();
  if (e) return e;
  const body = (n.body || '').replace(/\s+/g, ' ').trim();
  return body.length > 220 ? body.slice(0, 220).replace(/\s+\S*$/, '') + '…' : body;
}

function fnDateLine(n) {
  return fmtD(n.published_at || n.created_at);
}

// Звёздная дата для погружения: в сеттинге 3000-й год. Реальный 2026 → 3000,
// дальше год катится вперёд. Формат: «ЗВ.ДАТА 3000.157 · 12:12».
function fnStardate(dateStr) {
  const d = new Date(dateStr || Date.now());
  if (isNaN(d)) return 'ЗВ.ДАТА 3000.001';
  const galYear = 3000 + (d.getFullYear() - 2026);
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `ЗВ.ДАТА ${galYear}.${String(day).padStart(3, '0')} · ${hh}:${mm}`;
}

// ── Главная: загрузка и блок новостей ───────────────────────
async function fnLoadApproved() {
  try {
    const rows = await dbGet('faction_news',
      'status=eq.approved&order=published_at.desc.nullslast,created_at.desc&limit=12') || [];
    FN.approved = rows;
    FN.byId = new Map(rows.map(n => [n.id, n]));
  } catch (e) { FN.approved = []; }
  return FN.approved;
}

// HTML-блок для главной — «входящие передачи фракций» в sci-fi стиле.
function fnHomeBlockHtml() {
  const list = FN.approved || [];
  if (!list.length) return '';
  const card = (n, lead) => {
    const accent = n.faction_color || 'var(--gd)';
    const cardCover = n.image_url
      ? `<div class="fn-card-cov"><img src="${esc(n.image_url)}" loading="lazy" alt=""></div>` : '';
    return `<article class="fn-card${lead ? ' fn-card-lead' : ''}" onclick="fnOpenArticle('${esc(n.id)}')" style="--fn-accent:${esc(accent)}">
      ${cardCover}
      <div class="fn-card-body">
        <div class="fn-card-kicker">
          <span class="fn-card-live">ПЕРЕДАЧА</span>
          <span class="fn-card-fac"><span class="fn-dot"></span>${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>
        </div>
        <h3 class="fn-card-title">${esc(n.title || 'Без заголовка')}</h3>
        <p class="fn-card-excerpt">${esc(fnExcerpt(n))}</p>
        <div class="fn-card-foot"><span class="fn-card-date">${esc(fnStardate(n.published_at || n.created_at))}</span><span class="fn-readmore">ДЕКОДИРОВАТЬ ▸</span></div>
      </div>
    </article>`;
  };
  const [lead, ...rest] = list;
  const grid = rest.slice(0, 6).map(n => card(n, false)).join('');
  return `<section class="home-block fn-home">
    <div class="hb-head"><span class="hb-tag">ВЕСТНИК ФРАКЦИЙ</span><span class="fn-home-sub">// ВХОДЯЩИЕ ПЕРЕДАЧИ · ${list.length}</span></div>
    <div class="fn-grid">
      ${card(lead, true)}
      ${grid ? `<div class="fn-grid-rest">${grid}</div>` : ''}
    </div>
  </section>`;
}

// ── Полноэкранная статья (sci-fi «терминал-депеша») ─────────
function fnBodyToParas(body) {
  let isFirst = true;
  return String(body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => {
      // [img:URL] или голый URL картинки — рендерим как изображение
      const imgMatch = p.match(/^\[img:(https?:\/\/.+)\]$/i)
        || (p.match(/^https?:\/\/\S+$/i) && p.match(/\.(jpe?g|png|gif|webp|avif|svg)(\?[^\s]*)?$/i) ? [null, p] : null);
      if (imgMatch) return `<div class="fn-art-img"><img src="${esc(imgMatch[1])}" loading="lazy" alt=""></div>`;
      const cls = isFirst ? ' class="fn-lead-p"' : '';
      if (isFirst) isFirst = false;
      return `<p${cls}>${esc(p).replace(/\n/g, '<br>')}</p>`;
    }).join('');
}

function fnOpenArticle(id) {
  const n = FN.byId.get(id);
  if (!n) { toast('Новость не найдена', 'err'); return; }
  const accent = n.faction_color || 'var(--gd)';
  const modal = document.getElementById('fn-article') || (() => {
    const m = document.createElement('div'); m.id = 'fn-article'; m.className = 'fn-art-ov';
    m.onclick = e => { if (e.target === m) fnCloseArticle(); };
    document.body.appendChild(m); return m;
  })();
  const coverHtml = n.image_url
    ? `<div class="fn-art-cov"><img src="${esc(n.image_url)}" alt="" loading="lazy"></div>` : '';
  modal.innerHTML = `<div class="fn-art" style="--fn-accent:${esc(accent)}">
    <div class="fn-art-bar">
      <span class="fn-art-bar-l">◈ FACTION DISPATCH NETWORK</span>
      <span class="fn-art-bar-r">ВХОДЯЩАЯ ПЕРЕДАЧА</span>
    </div>
    <button class="fn-art-close" onclick="fnCloseArticle()">✕</button>
    ${coverHtml}
    <div class="fn-art-inner">
      <div class="fn-art-meta">
        <span class="fn-art-fac"><span class="fn-dot"></span>${esc((n.faction_name || 'ФРАКЦИЯ').toUpperCase())}</span>
        <span class="fn-art-date">${esc(fnStardate(n.published_at || n.created_at))}</span>
      </div>
      <h1 class="fn-art-title">${esc(n.title || 'Без заголовка')}</h1>
      <div class="fn-art-body">${fnBodyToParas(n.body)}</div>
    </div>
    <div class="fn-art-foot">
      <span>▌ КОНЕЦ ПЕРЕДАЧИ</span>
      <span class="fn-art-foot-id">REF·${esc(String(n.id).slice(0, 8).toUpperCase())}</span>
    </div>
  </div>`;
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function fnCloseArticle() {
  document.getElementById('fn-article')?.classList.remove('show');
  document.body.style.overflow = '';
}

// ── Кабинет: вкладка «Новости» ──────────────────────────────
async function fnRenderNewsTab(b) {
  b.innerHTML = `<div class="sload" style="min-height:60px"><div class="quote-loader">Загрузка...</div></div>`;
  const staff = fnIsStaff();
  const fac = await fnGetMyFaction();

  let html = '';

  // Секция автора (владельца одобренной фракции)
  if (fac && fac.faction_id) {
    let mine = [];
    try {
      mine = await dbGet('faction_news', `faction_id=eq.${encodeURIComponent(fac.faction_id)}&order=created_at.desc`) || [];
    } catch (e) {}
    const stMap = {
      pending:  ['НА МОДЕРАЦИИ', 'var(--color-warning,#e0a030)'],
      approved: ['ОПУБЛИКОВАНА', 'var(--ok,#3ec96b)'],
      rejected: ['ОТКЛОНЕНА', 'var(--err,#ff6b6b)'],
    };
    const rows = mine.length ? mine.map(n => {
      const st = stMap[n.status] || ['—', 'var(--t3)'];
      const canEdit = n.status !== 'approved';
      return `<div class="fn-mine-row">
        <div class="fn-mine-main">
          <div class="fn-mine-title">${esc(n.title || 'Без заголовка')}</div>
          <div class="fn-mine-meta">${esc(fnDateLine(n))} · <b style="color:${st[1]}">${st[0]}</b>${n.status === 'rejected' && n.reject_reason ? ` · <span style="color:var(--t3)">причина: ${esc(n.reject_reason)}</span>` : ''}</div>
        </div>
        <div class="fn-mine-acts">
          <button class="btn btn-gh btn-xs" onclick="fnPreview('${esc(n.id)}')">Просмотр</button>
          ${canEdit ? `<button class="btn btn-gh btn-xs" onclick="fnOpenComposer('${esc(n.id)}')">✎</button>` : ''}
          <button class="btn btn-rd btn-xs" onclick="fnDelete('${esc(n.id)}')">✕</button>
        </div>
      </div>`;
    }).join('') : `<div style="color:var(--t3);font-size:12px;padding:8px 0">Вы ещё не написали ни одной новости.</div>`;

    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd">
        <span>📰 Новости фракции «${esc(fac.name || '')}»</span>
        <button class="btn btn-gd btn-sm" onclick="fnOpenComposer()">✚ Написать новость</button>
      </div>
      <div class="fn-mine-list">${rows}</div>
      <div class="fn-tab-note">Новость уходит на проверку администрации. После одобрения она появится на главной в «Вестнике фракций».</div>
    </div>`;
  } else if (!staff) {
    html += `<div class="fn-tab-sec"><div style="color:var(--t3);font-size:13px;padding:8px 0">
      Писать новости могут владельцы одобренной фракции.
      <button class="btn btn-gd btn-fw" style="margin-top:10px" onclick="closeAp();go('faction-new')">⬡ Зарегистрировать фракцию</button>
    </div></div>`;
  }

  // Секция модерации (стафф)
  if (staff) {
    let pend = [];
    try { pend = await dbGet('faction_news', 'status=eq.pending&order=created_at.asc') || []; } catch (e) {}
    const modRows = pend.length ? pend.map(n => `<div class="fn-mod-row" id="fn-mod-${esc(n.id)}">
      <div class="fn-mod-main">
        <div class="fn-mod-title">${esc(n.title || 'Без заголовка')}</div>
        <div class="fn-mod-meta">${esc(n.faction_name || '—')} · ${esc(n.owner_email || '')} · ${esc(fnDateLine(n))}</div>
        <div class="fn-mod-excerpt">${esc(fnExcerpt(n))}</div>
      </div>
      <div class="fn-mod-acts">
        <button class="btn btn-gh btn-sm" onclick="fnPreview('${esc(n.id)}')">Читать</button>
        <button class="btn btn-gd btn-sm" onclick="fnApprove('${esc(n.id)}')">✓ Одобрить</button>
        <button class="btn btn-rd btn-sm" onclick="fnReject('${esc(n.id)}')">✕ Отклонить</button>
      </div>
    </div>`).join('') : `<div style="color:var(--t3);font-size:12px;padding:8px 0">Нет новостей на модерации</div>`;

    html += `<div class="fn-tab-sec">
      <div class="fn-tab-hd"><span>🛡 Модерация новостей (${pend.length})</span></div>
      <div class="fn-mod-list">${modRows}</div>
    </div>`;
  }

  b.innerHTML = html || `<div style="color:var(--t3);font-size:13px;padding:8px 0">Нет доступа к новостям.</div>`;
}

// Просмотр черновика/ожидающей новости автором или стаффом (без публикации).
async function fnPreview(id) {
  // Берём из локального кэша или подгружаем поштучно
  let n = FN.byId.get(id);
  if (!n) {
    try { const rows = await dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`); n = rows && rows[0]; } catch (e) {}
    if (n) FN.byId.set(id, n);
  }
  if (!n) { toast('Не найдено', 'err'); return; }
  fnOpenArticle(id);
}

// ── Композитор (написать / редактировать) ───────────────────
function fnOpenComposer(id) {
  const modal = document.getElementById('fn-composer') || (() => {
    const m = document.createElement('div'); m.id = 'fn-composer'; m.className = 'fn-comp-ov';
    m.onclick = e => { if (e.target === m) fnCloseComposer(); };
    document.body.appendChild(m); return m;
  })();
  // если редактируем — подтянем данные
  let n = id ? FN.byId.get(id) : null;
  const fill = (data) => {
    modal.innerHTML = `<div class="fn-comp">
      <button class="gm-close" onclick="fnCloseComposer()">✕</button>
      <div class="fn-comp-hd">${id ? '✎ Редактировать новость' : '📰 Новая новость фракции'}</div>
      <input type="hidden" id="fn-c-id" value="${id ? esc(id) : ''}">
      <div class="fg"><label class="fl">Заголовок *</label>
        <input class="fi fn-c-title" id="fn-c-title" maxlength="160" value="${esc(data?.title || '')}" placeholder="Главное событие недели"></div>
      <div class="fg">
        <label class="fl">Обложка</label>
        <div class="fn-c-cov-wrap">
          ${data?.image_url ? `<div class="fn-c-cov-prv" id="fn-c-cov-prv"><img src="${esc(data.image_url)}" alt=""><button type="button" class="fn-c-cov-rm" onclick="fnCoverRemove()">✕</button></div>` : `<div class="fn-c-cov-prv fn-c-cov-empty" id="fn-c-cov-prv"></div>`}
          <label class="btn btn-gh fn-c-cov-btn">📷 Загрузить обложку<input type="file" accept="image/*" style="display:none" onchange="fnCoverUpload(this)"></label>
        </div>
        <input type="hidden" id="fn-c-img" value="${esc(data?.image_url || '')}">
      </div>
      <div class="fg fn-c-body-fg">
        <div class="fn-c-body-hd"><label class="fl">Текст новости *</label><label class="btn btn-gh btn-xs fn-c-ins-btn">📷 Вставить фото<input type="file" accept="image/*" style="display:none" onchange="fnInsertImg(this)"></label></div>
        <textarea class="fi fn-c-body" id="fn-c-body" placeholder="Пишите свободно. Пустая строка = новый абзац.">${esc(data?.body || '')}</textarea></div>
      <div class="fn-comp-ftr">
        <button class="btn btn-gh" onclick="fnCloseComposer()">Отмена</button>
        <button class="btn btn-gd" onclick="fnSubmit()">📨 Отправить на проверку</button>
      </div>
      <div class="fn-comp-note">После отправки новость проверит администрация. Опубликованную правит только администрация.</div>
    </div>`;
    modal.classList.add('show');
  };
  if (id && !n) {
    dbGet('faction_news', `id=eq.${encodeURIComponent(id)}&limit=1`).then(rows => { fill(rows && rows[0]); }).catch(() => fill(null));
  } else { fill(n); }
}
function fnCloseComposer() { document.getElementById('fn-composer')?.classList.remove('show'); }

function fnInsertImg(input) {
  const file = input?.files?.[0];
  if (!file) return;
  handleImgUpload(file, url => {
    const ta = document.getElementById('fn-c-body');
    if (!ta) return;
    const marker = `\n\n[img:${url}]\n\n`;
    const start = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + marker + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + marker.length;
    ta.focus();
  });
  input.value = '';
}

function fnCoverUpload(input) {
  const file = input?.files?.[0];
  if (!file) return;
  handleImgUpload(file, url => {
    document.getElementById('fn-c-img').value = url;
    const prv = document.getElementById('fn-c-cov-prv');
    if (prv) {
      prv.classList.remove('fn-c-cov-empty');
      prv.innerHTML = `<img src="${url}" alt=""><button type="button" class="fn-c-cov-rm" onclick="fnCoverRemove()">✕</button>`;
    }
  });
  input.value = '';
}

function fnCoverRemove() {
  document.getElementById('fn-c-img').value = '';
  const prv = document.getElementById('fn-c-cov-prv');
  if (prv) { prv.classList.add('fn-c-cov-empty'); prv.innerHTML = ''; }
}

async function fnSubmit() {
  if (FN.busy) return;
  const id        = document.getElementById('fn-c-id')?.value || '';
  const title     = (document.getElementById('fn-c-title')?.value || '').trim();
  const body      = (document.getElementById('fn-c-body')?.value || '').trim();
  const image_url = (document.getElementById('fn-c-img')?.value || '').trim() || null;
  if (!title || !body) { toast('Заголовок и текст обязательны', 'err'); return; }
  if (typeof badName === 'function' && badName(title)) { toast('Заголовок содержит недопустимые слова', 'err'); return; }
  // Писать новости могут только владельцы одобренной фракции (игроки).
  const fac = await fnGetMyFaction();
  if (!fac || !fac.faction_id) { toast('Новости пишут только владельцы одобренной фракции', 'err'); return; }
  FN.busy = true;
  try {
    if (id) {
      await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
        { title, excerpt: null, body, image_url, status: 'pending', reject_reason: null, updated_at: new Date().toISOString() });
      toast('Изменения отправлены на проверку', 'ok');
    } else {
      await dbPost('faction_news', {
        faction_id: fac.faction_id,
        faction_name: fac.name || null,
        faction_color: fac.color || null,
        owner_id: user.id, owner_email: user.email,
        title, excerpt: null, body, image_url,
        status: 'pending',
      });
      toast('Новость отправлена на проверку', 'ok');
    }
    fnCloseComposer();
    fnRefresh();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

// ── Модерация ───────────────────────────────────────────────
async function fnApprove(id) {
  if (FN.busy) return;
  if (!confirm('Опубликовать новость на главной?')) return;
  FN.busy = true;
  try {
    await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
      { status: 'approved', published_at: new Date().toISOString(), reviewed_by: user.email, reject_reason: null, updated_at: new Date().toISOString() });
    toast('Опубликовано ✓', 'ok');
    document.getElementById('fn-mod-' + id)?.remove();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

async function fnReject(id) {
  if (FN.busy) return;
  const reason = prompt('Причина отклонения (увидит автор):', '');
  if (reason === null) return;
  FN.busy = true;
  try {
    await dbPatch('faction_news', `id=eq.${encodeURIComponent(id)}`,
      { status: 'rejected', reject_reason: reason, reviewed_by: user.email, updated_at: new Date().toISOString() });
    toast('Отклонено', 'inf');
    document.getElementById('fn-mod-' + id)?.remove();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}

async function fnDelete(id) {
  if (FN.busy) return;
  if (!confirm('Удалить новость безвозвратно?')) return;
  FN.busy = true;
  try {
    await dbDel('faction_news', `id=eq.${encodeURIComponent(id)}`);
    toast('Удалено', 'ok');
    fnRefresh();
  } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  finally { FN.busy = false; }
}
