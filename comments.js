// ════════════════════════════════════════════════════════════
// COMMENTS — загрузка, рендер, отправка, удаление
// Зависит от: core.js, auth.js (user, getTokenFresh, esc,
//             getAvatarHtml, userLabel, timeAgo, toast, SB_URL, SB_ANON)
// ════════════════════════════════════════════════════════════

// ── Константы ──────────────────────────────────────────────
const CMT_MAX_LEN   = 2000;
const CMT_MIN_LEN   = 1;
const CMT_PAGE_SIZE = 30;

// ── Состояние ──────────────────────────────────────────────
let _cmtSlug   = null;   // slug страницы, для которой показаны комменты
let _cmtItems  = [];     // массив загруженных комментариев
let _cmtBusy   = false;  // блокировка повторной отправки
let _cmtReplyTo = null;  // ID комментария, на который отвечаем
let _cmtEditId = null;   // ID комментария, который редактируем
// ── Режим локации (форумный отыгрыш) ──
let _cmtPageType = null;    // тип текущей страницы ('location' и пр.)
let _cmtLocationName = '';  // название локации (для «голоса локации»)
let _cmtFactionMap = {};    // email автора -> { name, color } (одобренные фракции)
let _cmtAsLocation = false; // тумблер «писать от имени локации» (для администрации)
function _cmtIsLocation() { return _cmtPageType === 'location'; }

// ── Разрешение на комментирование ──────────────────────────
function canComment() {
  if (!user) return false;
  if (user.is_banned) return false;
  // viewer и выше могут комментировать
  return VALID_ROLES.includes(user.role);
}
function canDeleteComment(cmt) {
  if (!user) return false;
  if (user.is_banned) return false;
  if (user.id === cmt.user_id) return true;
  return ['superadmin', 'moderator'].includes(user.role);
}
function canEditComment(cmt) {
  if (!user) return false;
  if (user.is_banned) return false;
  return user.id === cmt.user_id;
}

// ── Загрузка комментариев из Supabase ──────────────────────
async function loadComments(slug) {
  try {
    const token = getToken();
    const url = `${SB_URL}/rest/v1/comments`
      + `?page_slug=eq.${encodeURIComponent(slug)}`
      + `&is_deleted=eq.false`
      + `&order=created_at.asc`
      + `&limit=${CMT_PAGE_SIZE}`
      + `&select=id,page_slug,user_id,user_email,body,created_at,parent_id,as_location`;
    const r = await fetch(url, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) {
    console.warn('[comments] load error:', e.message);
    return [];
  }
}

// ── Отправка нового комментария ─────────────────────────────
async function submitComment() {
  if (_cmtBusy) return;
  if (!canComment()) { toast(lang === 'ru' ? 'Войдите, чтобы комментировать' : 'Sign in to comment', 'err'); return; }

  const ta = document.getElementById('cmt-input');
  if (!ta) return;
  const raw = ta.value;
  const body = raw.trim();

  if (body.length < CMT_MIN_LEN) { toast(lang === 'ru' ? 'Комментарий не может быть пустым' : 'Comment cannot be empty', 'err'); return; }
  if (body.length > CMT_MAX_LEN) { toast(lang === 'ru' ? `Максимум ${CMT_MAX_LEN} символов` : `Max ${CMT_MAX_LEN} chars`, 'err'); return; }

  _cmtBusy = true;
  const btn = document.getElementById('cmt-send-btn');
  if (btn) btn.disabled = true;

  try {
    const token = await getTokenFresh();
    if (!token || token === SB_ANON) {
      toast(lang === 'ru' ? 'Сессия истекла, войдите снова' : 'Session expired', 'err');
      _cmtBusy = false; if (btn) btn.disabled = false;
      return;
    }

    // Если редактируем
    if (_cmtEditId) {
      const r = await fetch(`${SB_URL}/rest/v1/comments?id=eq.${_cmtEditId}`, {
        method: 'PATCH',
        headers: {
          'apikey':        SB_ANON,
          'Authorization': 'Bearer ' + token,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({ body: body }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = err?.message || err?.error || 'HTTP ' + r.status;
        throw new Error(msg);
      }

      const rows = await r.json();
      const updated = Array.isArray(rows) ? rows[0] : rows;
      if (updated) {
        const idx = _cmtItems.findIndex(c => c.id === _cmtEditId);
        if (idx !== -1) _cmtItems[idx] = updated;
        renderCommentsList();
      }

      ta.value = '';
      updateCharCount();
      cancelEdit();
      toast(lang === 'ru' ? 'Комментарий обновлён' : 'Comment updated', 'ok');
    } else {
      // Создаём новый
      const payload = {
        page_slug:  _cmtSlug,
        user_id:    user.id,
        user_email: user.email,
        body:       body,
        parent_id:  _cmtReplyTo || null,
        as_location: !!(_cmtIsLocation() && _cmtAsLocation && typeof isLocationStaff === 'function' && isLocationStaff()),
      };

      const r = await fetch(`${SB_URL}/rest/v1/comments`, {
        method:  'POST',
        headers: {
          'apikey':        SB_ANON,
          'Authorization': 'Bearer ' + token,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = err?.message || err?.error || 'HTTP ' + r.status;
        throw new Error(msg.includes('violates') || msg.includes('policy')
          ? (lang === 'ru' ? 'Нет прав для отправки' : 'Not allowed')
          : msg);
      }

      const rows = await r.json();
      const newCmt = Array.isArray(rows) ? rows[0] : rows;
      if (newCmt) {
        _cmtItems.push(newCmt);
        renderCommentsList();
      }

      ta.value = '';
      updateCharCount();
      cancelReply();
      // сброс тумблера «от имени локации» после отправки
      if (_cmtAsLocation) { _cmtAsLocation = false; const tg = document.getElementById('cmt-aslocation'); if (tg) tg.checked = false; const fm = document.querySelector('.cmt-form'); if (fm) fm.classList.remove('cmt-form-aslocation'); }
      toast(lang === 'ru' ? (_cmtIsLocation() ? 'Сообщение добавлено в ленту' : 'Комментарий отправлен') : 'Posted', 'ok');
    }
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    _cmtBusy = false;
    if (btn) btn.disabled = false;
  }
}

// ── Начать ответ на комментарий ─────────────────────────────
function replyToComment(id) {
  const cmt = _cmtItems.find(c => c.id === id);
  if (!cmt) return;
  
  _cmtReplyTo = id;
  const ta = document.getElementById('cmt-input');
  if (ta) {
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  const form = document.querySelector('.cmt-form');
  if (form) {
    let indicator = form.querySelector('.cmt-reply-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'cmt-reply-indicator';
      form.insertBefore(indicator, form.firstChild);
    }
    const prof = getProfileOf(cmt.user_email);
    const displayName = prof.display_name || (cmt.user_email || '').split('@')[0] || '?';
    indicator.innerHTML = `
      <span class="cmt-reply-text">↩ ${lang === 'ru' ? 'Ответ на комментарий' : 'Reply to'} <strong>${esc(displayName)}</strong></span>
      <button class="cmt-reply-cancel" onclick="cancelReply()">✕</button>
    `;
  }
}

// ── Отменить ответ ──────────────────────────────────────────
function cancelReply() {
  _cmtReplyTo = null;
  document.querySelector('.cmt-reply-indicator')?.remove();
}

// ── Начать редактирование ───────────────────────────────────
function editComment(id) {
  const cmt = _cmtItems.find(c => c.id === id);
  if (!cmt || !canEditComment(cmt)) return;
  
  cancelReply();
  _cmtEditId = id;
  
  const ta = document.getElementById('cmt-input');
  if (ta) {
    ta.value = cmt.body;
    updateCharCount();
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  const form = document.querySelector('.cmt-form');
  if (form) {
    let indicator = form.querySelector('.cmt-reply-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'cmt-reply-indicator';
      form.insertBefore(indicator, form.firstChild);
    }
    indicator.innerHTML = `
      <span class="cmt-reply-text">✎ ${lang === 'ru' ? 'Редактирование комментария' : 'Editing comment'}</span>
      <button class="cmt-reply-cancel" onclick="cancelEdit()">✕</button>
    `;
  }
  
  const btn = document.getElementById('cmt-send-btn');
  if (btn) btn.textContent = lang === 'ru' ? 'Сохранить' : 'Save';
}

// ── Отменить редактирование ─────────────────────────────────
function cancelEdit() {
  _cmtEditId = null;
  document.querySelector('.cmt-reply-indicator')?.remove();
  const ta = document.getElementById('cmt-input');
  if (ta) {
    ta.value = '';
    updateCharCount();
  }
  const btn = document.getElementById('cmt-send-btn');
  if (btn) btn.textContent = lang === 'ru' ? 'Отправить' : 'Send';
}

// ── Soft-delete комментария ─────────────────────────────────
async function deleteComment(id) {
  const cmt = _cmtItems.find(c => c.id === id);
  if (!cmt || !canDeleteComment(cmt)) return;

  const confirmed = window.confirm(
    lang === 'ru' ? 'Удалить комментарий?' : 'Delete this comment?'
  );
  if (!confirmed) return;

  try {
    const token = await getTokenFresh();
    
    // Мягкое удаление - помечаем как удалённый
    const r = await fetch(`${SB_URL}/rest/v1/comments?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey':        SB_ANON,
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ is_deleted: true }),
    });
    
    if (!r.ok && r.status !== 204) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err?.message || 'HTTP ' + r.status);
    }
    
    _cmtItems = _cmtItems.filter(c => c.id !== id);
    renderCommentsList();
    toast(lang === 'ru' ? 'Комментарий удалён' : 'Deleted', 'inf');
  } catch (e) {
    console.error('[deleteComment]', e);
    toast(e.message, 'err');
  }
}

// ── Счётчик символов ────────────────────────────────────────
function updateCharCount() {
  const ta    = document.getElementById('cmt-input');
  const ctr   = document.getElementById('cmt-char-count');
  if (!ta || !ctr) return;
  const len   = ta.value.length;
  ctr.textContent = `${len} / ${CMT_MAX_LEN}`;
  ctr.style.color = len > CMT_MAX_LEN * 0.9
    ? 'var(--err)'
    : 'var(--t4)';
}

// ── Переключение режима «от имени локации» (для администрации) ──
function toggleAsLocation(el) {
  _cmtAsLocation = !!(el && el.checked);
  const form = document.querySelector('.cmt-form');
  if (form) form.classList.toggle('cmt-form-aslocation', _cmtAsLocation);
  const ta = document.getElementById('cmt-input');
  if (ta) ta.placeholder = _cmtAsLocation
    ? (lang === 'ru' ? `Голос локации «${_cmtLocationName}» — опишите событие сцены…` : 'Narrate the scene…')
    : (lang === 'ru' ? 'Опишите действие вашего персонажа…' : 'Describe your action…');
}

// ── Загрузка одобренных фракций для отображения авторов-игроков ──
async function _cmtLoadFactions() {
  _cmtFactionMap = {};
  try {
    const token = getToken();
    const url = `${SB_URL}/rest/v1/faction_applications?status=eq.approved&select=owner_email,name,color`;
    const r = await fetch(url, { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + token } });
    if (!r.ok) return;
    const rows = await r.json();
    (rows || []).forEach(f => { if (f.owner_email) _cmtFactionMap[f.owner_email] = { name: f.name || '', color: f.color || '' }; });
  } catch (e) { /* фракции необязательны */ }
}
// Читаемый на тёмном фоне цвет фракции (используем frReadable, если доступен)
function _cmtFacColor(c) { return (typeof frReadable === 'function') ? frReadable(c) : (c || '#9fb4d8'); }

// ── Рендер одного комментария ───────────────────────────────
function renderCommentItem(cmt, depth = 0) {
  // Пост «от имени локации» — особая карточка рассказчика
  if (cmt.as_location && _cmtIsLocation()) {
    const canDel = canDeleteComment(cmt);
    const body = esc(cmt.body).replace(/\n/g, '<br>');
    return `
<div class="cmt-location-voice" id="cmt-${esc(cmt.id)}" style="--depth:${depth}">
  <div class="cmt-lv-head"><span class="cmt-lv-ico">📍</span><span class="cmt-lv-name">${esc(_cmtLocationName || 'Локация')}</span><span class="cmt-lv-tag">голос локации</span>
    <span class="cmt-time">${timeAgo(cmt.created_at)}</span>
    ${canDel ? `<button class="cmt-del-btn" onclick="deleteComment('${esc(cmt.id)}')" title="Удалить">✕</button>` : ''}
  </div>
  <div class="cmt-lv-body">${body}</div>
</div>`;
  }
  const prof        = getProfileOf(cmt.user_email);
  const displayName = prof.display_name || (cmt.user_email || '').split('@')[0] || '?';
  const avatarUrl   = prof.avatar_url   || '';
  const avHtml      = getAvatarHtml(cmt.user_email, avatarUrl, displayName, 32);
  const canDel      = canDeleteComment(cmt);
  const canEdit     = canEditComment(cmt);
  const isOwn       = user && user.id === cmt.user_id;
  const canReply    = canComment();

  const bodyHtml = esc(cmt.body).replace(/\n/g, '<br>');

  // В режиме локации: автор с одобренной фракцией = игрок → чип фракции + акцент её цветом
  const fac = _cmtIsLocation() ? _cmtFactionMap[cmt.user_email] : null;
  const facCol = fac ? _cmtFacColor(fac.color) : '';
  const facChip = fac ? `<span class="cmt-fac-chip" style="--fac:${facCol}">⬡ ${esc(fac.name)}</span>` : '';
  const playerCls = fac ? ' cmt-player' : '';
  const facStyle = fac ? ` style="--fac:${facCol}"` : '';

  return `
<div class="cmt-item${isOwn ? ' cmt-own' : ''}${playerCls}" id="cmt-${esc(cmt.id)}" style="--depth:${depth}"${fac ? ` data-fac="1"` : ''}>
  <div class="cmt-av"${facStyle}>${avHtml}</div>
  <div class="cmt-bubble"${facStyle}>
    <div class="cmt-meta">
      <span class="cmt-author"${facStyle}>${esc(displayName)}</span>
      ${facChip}
      <span class="cmt-time">${timeAgo(cmt.created_at)}</span>
      ${canReply ? `<button class="cmt-reply-btn" onclick="replyToComment('${esc(cmt.id)}')" title="${lang === 'ru' ? 'Ответить' : 'Reply'}">${lang === 'ru' ? 'ответить' : 'reply'}</button>` : ''}
      ${canEdit ? `<button class="cmt-edit-btn" onclick="editComment('${esc(cmt.id)}')" title="${lang === 'ru' ? 'Редактировать' : 'Edit'}">✎</button>` : ''}
      ${canDel ? `<button class="cmt-del-btn" onclick="deleteComment('${esc(cmt.id)}')" title="${lang === 'ru' ? 'Удалить' : 'Delete'}">✕</button>` : ''}
    </div>
    <div class="cmt-body">${bodyHtml}</div>
  </div>
</div>`;
}

// ── Построение дерева комментариев ──────────────────────────
function buildCommentTree(comments) {
  const map = {};
  const roots = [];
  
  comments.forEach(c => {
    map[c.id] = { ...c, children: [] };
  });
  
  comments.forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  
  return roots;
}

// ── Рендер дерева комментариев ──────────────────────────────
function renderCommentTree(node, depth = 0) {
  let html = renderCommentItem(node, depth);
  
  if (node.children && node.children.length > 0) {
    html += '<div class="cmt-replies">';
    node.children.forEach(child => {
      html += renderCommentTree(child, depth + 1);
    });
    html += '</div>';
  }
  
  return html;
}

// ── Рендер списка комментариев ──────────────────────────────
function renderCommentsList() {
  const list = document.getElementById('cmt-list');
  if (!list) return;

  if (!_cmtItems.length) {
    list.innerHTML = `<div class="cmt-empty">${_cmtIsLocation()
      ? (lang === 'ru' ? 'В этой локации ещё тихо. Опишите, как сюда прибывает ваш персонаж.' : 'The location is quiet. Be the first to arrive.')
      : (lang === 'ru' ? 'Комментариев пока нет. Будьте первым!' : 'No comments yet. Be the first!')}</div>`;
    return;
  }

  const tree = buildCommentTree(_cmtItems);
  list.innerHTML = tree.map(node => renderCommentTree(node)).join('');
}

// ── Рендер всей секции комментариев ────────────────────────
function renderCommentsSection(slug) {
  const pg = document.getElementById('pg');
  if (!pg) return;

  // Убираем старую секцию, если есть
  document.getElementById('cmt-section')?.remove();

  _cmtSlug  = slug;
  _cmtItems = [];
  _cmtAsLocation = false;

  // Не показываем комменты на главной и секциях
  if (!slug || slug === 'home' || slug.startsWith('sec:')) return;

  // Определяем тип страницы — для «режима локации»
  const _pageMeta = (typeof pages !== 'undefined') ? pages.find(p => p.slug === slug) : null;
  _cmtPageType = _pageMeta ? (_pageMeta.page_type || 'article') : null;
  _cmtLocationName = (_cmtIsLocation() && _pageMeta) ? (pT(_pageMeta) || _pageMeta.title || 'Локация') : '';
  const isLoc = _cmtIsLocation();
  const canVoice = isLoc && typeof isLocationStaff === 'function' && isLocationStaff();

  const canWrite = canComment();
  const notLoggedIn = !user;

  // Форма ввода или заглушка
  let formHtml = '';
  if (canWrite) {
    const prof = userProfile;
    const avHtml = getAvatarHtml(user.email, prof.avatar_url, prof.display_name || user.email.split('@')[0], 32);
    const ph = isLoc
      ? (lang === 'ru' ? 'Опишите действие вашего персонажа…' : 'Describe your action…')
      : (lang === 'ru' ? 'Оставить комментарий…' : 'Leave a comment…');
    const voiceToggle = canVoice ? `
      <label class="cmt-aslocation-toggle" title="Сообщение появится как голос локации (рассказчик)">
        <input type="checkbox" id="cmt-aslocation" onchange="toggleAsLocation(this)">
        <span>✦ ${lang === 'ru' ? 'От имени локации' : 'As location'}</span>
      </label>` : '';
    formHtml = `
<div class="cmt-form">
  <div class="cmt-form-av">${avHtml}</div>
  <div class="cmt-form-right">
    <textarea
      id="cmt-input"
      class="cmt-textarea"
      placeholder="${esc(ph)}"
      maxlength="${CMT_MAX_LEN}"
      rows="3"
      oninput="updateCharCount()"
      onkeydown="if(event.ctrlKey&&event.key==='Enter')submitComment()"
    ></textarea>
    <div class="cmt-form-footer">
      ${voiceToggle}
      <span class="cmt-hint">${lang === 'ru' ? 'Ctrl+Enter — отправить' : 'Ctrl+Enter to send'}</span>
      <span id="cmt-char-count" class="cmt-char">0 / ${CMT_MAX_LEN}</span>
      <button id="cmt-send-btn" class="btn btn-gd btn-sm" onclick="submitComment()">
        ${isLoc ? (lang === 'ru' ? 'Отправить в ленту' : 'Post') : (lang === 'ru' ? 'Отправить' : 'Send')}
      </button>
    </div>
  </div>
</div>`;
  } else if (notLoggedIn) {
    formHtml = `
<div class="cmt-login-prompt">
  <span class="cmt-login-ico">◈</span>
  <span>${lang === 'ru' ? 'Войдите, чтобы оставить комментарий' : 'Sign in to comment'}</span>
  <button class="btn btn-gd btn-sm" onclick="showAuth('login')">${lang === 'ru' ? 'Войти' : 'Sign in'}</button>
</div>`;
  } else {
    // Залогинен, но banned
    formHtml = `
<div class="cmt-login-prompt">
  <span class="cmt-login-ico">⛔</span>
  <span>${lang === 'ru' ? 'Ваш аккаунт заблокирован' : 'Your account is banned'}</span>
</div>`;
  }

  const section = document.createElement('div');
  section.id = 'cmt-section';
  section.className = 'cmt-section' + (isLoc ? ' cmt-location' : '');
  
  // Получаем метаданные страницы
  const currentPage = pages.find(p => p.slug === slug);
  const sec2 = currentPage?.section ? sections.find(s => s.slug === currentPage.section) : null;
  const tagsHtml = currentPage?.tags ? `<span>🏷 ${currentPage.tags.split(',').map(t => `<span class="art-tag">${esc(t.trim())}</span>`).join(' ')}</span>` : '';
  const metaHtml = currentPage ? `<div class="art-meta"><span>📅 ${fmtD(currentPage.updated_at)}</span><span>✍ ${esc(userLabel(currentPage.created_by||''))}</span>${sec2?`<span>📁 ${esc(sN(sec2))}</span>`:''}${tagsHtml}</div>` : '';
  
  const headerHtml = `
<div class="cmt-section-hdr">
  <span class="cmt-section-title">${isLoc ? '📍 ' + (lang === 'ru' ? 'ЛЕНТА ЛОКАЦИИ' : 'LOCATION FEED') : '◈ ' + (lang === 'ru' ? 'КОММЕНТАРИИ' : 'COMMENTS')}</span>
  <span class="cmt-count" id="cmt-count">—</span>
</div>`;
  const listHtml = `<div id="cmt-list" class="cmt-list">
  <div class="cmt-loading">${lang === 'ru' ? (isLoc ? 'Загрузка ленты…' : 'Загрузка комментариев…') : 'Loading…'}</div>
</div>`;
  // В режиме локации: лента сверху, композер «прибит» к низу экрана (как в чате).
  section.innerHTML = isLoc
    ? `${metaHtml}${headerHtml}${listHtml}<div class="cmt-composer-dock">${formHtml}</div>`
    : `${metaHtml}${headerHtml}${formHtml}${listHtml}`;

  pg.appendChild(section);

  // Загрузка асинхронно (в режиме локации — сперва карта фракций для авторов-игроков)
  const _factionsReady = isLoc ? _cmtLoadFactions() : Promise.resolve();
  Promise.all([loadComments(slug), _factionsReady]).then(([items]) => {
    if (_cmtSlug !== slug) return; // ушли на другую страницу
    _cmtItems = items;
    const countEl = document.getElementById('cmt-count');
    if (countEl) countEl.textContent = items.length
      ? `${items.length} ${lang === 'ru' ? (isLoc ? 'сообщ.' : 'комм.') : (isLoc ? 'posts' : 'comments')}`
      : '';
    renderCommentsList();
  });
}
