// © 2025–2026 Setis241 (setisalanstrong@gmail.com). Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  ТИКЕТЫ (поддержка) — всё на сайте.
//  Зависит от: core.js (dbGet/dbPost/dbPatch, apiFetch, SB_URL/SB_ANON,
//  getTokenFresh, esc, toast, user, userProfile), editor.js (handleImgUpload).
//  Таблицы: public.tickets, public.ticket_messages (см. _migration_tickets.sql).
// ════════════════════════════════════════════════════════════════════════

// URL Edge Function ticket-vk (она держит токен VK и шлёт messages.send).
//   Уже прописан под твой проект. Заработает, как только задеплоишь функцию
//   и зададишь секреты VK_TOKEN/VK_PEER_ID (инструкция — рядом, в чате).
//   Пока функции нет — запрос молча падает, на работу сайта не влияет.
const TK_VK_WEBHOOK = 'https://pgngkkiiopymvrcozvvr.supabase.co/functions/v1/dynamic-responder';

const TK_CATS = [
  ['tech',  '🛠 Техническая проблема'],
  ['howto', '❓ Не разобрался / как сделать'],
  ['broke', '💥 Слетело / пропало / баг'],
  ['idea',  '💡 Предложение / скучно'],
  ['other', '📨 Другое'],
];
const TK_CAT_LABEL = Object.fromEntries(TK_CATS);
const TK = { shots: [], mine: [], openId: null, busy: false };

function tkIsStaff() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }
// Тикеты доступны только игрокам и администрации (не viewer / не анонимам).
function tkCanUse() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator', 'player'].includes(user.role)); }
function tkUpdateVisibility() { const fab = document.getElementById('tk-fab'); if (fab) fab.style.display = tkCanUse() ? '' : 'none'; }
function tkCatLabel(c) { return TK_CAT_LABEL[c] || c || '—'; }
function tkWhen(ts) { try { return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

// ── Плавающая кнопка + контейнер модалки ───────────────────────
function tkMount() {
  if (document.getElementById('tk-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'tk-fab';
  fab.title = 'Написать тикет в поддержку';
  fab.innerHTML = '<svg class="tk-fab-ic" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="3.6"/><line x1="5.4" y1="5.4" x2="9.4" y2="9.4"/><line x1="14.6" y1="14.6" x2="18.6" y2="18.6"/><line x1="18.6" y1="5.4" x2="14.6" y2="9.4"/><line x1="9.4" y1="14.6" x2="5.4" y2="18.6"/></svg><span class="tk-fab-l">Поддержка</span>';
  fab.onclick = tkOpen;
  fab.style.display = 'none';   // показывается только игрокам/админам (tkUpdateVisibility)
  document.body.appendChild(fab);
  tkUpdateVisibility();
  const ov = document.createElement('div');
  ov.id = 'tk-ov'; ov.className = 'tk-ov';
  ov.onclick = e => { if (e.target === ov) tkCloseModal(); };
  document.body.appendChild(ov);
}
function tkCloseModal() { const ov = document.getElementById('tk-ov'); if (ov) ov.classList.remove('show'); TK.openId = null; }

async function tkOpen() {
  if (typeof user === 'undefined' || !user) { toast('Войдите в аккаунт, чтобы написать тикет', 'err'); return; }
  if (!tkCanUse()) { toast('Тикеты доступны игрокам и администрации', 'err'); return; }
  const ov = document.getElementById('tk-ov'); if (!ov) return;
  ov.classList.add('show');
  TK.shots = []; TK.openId = null;
  ov.innerHTML = `<div class="tk-modal"><div class="tk-loading">Загрузка…</div></div>`;
  await tkLoadMine();
  tkRender();
}

// ── Данные ─────────────────────────────────────────────────────
async function tkLoadMine() {
  try { TK.mine = await dbGet('tickets', `order=created_at.desc&limit=30`) || []; }
  catch (e) { TK.mine = []; }
}
async function tkLoadThread(id) {
  try { return await dbGet('ticket_messages', `ticket_id=eq.${id}&order=created_at.asc`) || []; }
  catch (e) { return []; }
}

// ── Рендер модалки игрока (создание + мои тикеты) ──────────────
function tkRender() {
  const ov = document.getElementById('tk-ov'); if (!ov || !ov.classList.contains('show')) return;
  const cats = TK_CATS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  const shots = TK.shots.map((u, i) => `<div class="tk-shot"><img src="${esc(u)}" alt="" loading="lazy" onclick="tkViewImg(this.src)"><button title="Убрать" onclick="tkRemoveShot(${i})">✕</button></div>`).join('');
  const mineHtml = TK.mine.length
    ? TK.mine.map(tkMineRow).join('')
    : '<div class="tk-empty">У вас пока нет тикетов.</div>';
  ov.innerHTML = `<div class="tk-modal">
    <div class="tk-hd"><span class="tk-hd-t"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="3.6"/><line x1="5.4" y1="5.4" x2="9.4" y2="9.4"/><line x1="14.6" y1="14.6" x2="18.6" y2="18.6"/><line x1="18.6" y1="5.4" x2="14.6" y2="9.4"/><line x1="9.4" y1="14.6" x2="5.4" y2="18.6"/></svg>Поддержка</span><button class="tk-x" onclick="tkCloseModal()">✕</button></div>
    <div class="tk-body">
      <div class="tk-form">
        <div class="tk-form-t">Новый тикет</div>
        <label class="tk-lbl">Что случилось?</label>
        <select id="tk-cat" class="tk-inp">${cats}</select>
        <label class="tk-lbl">Краткое описание</label>
        <textarea id="tk-desc" class="tk-inp" rows="3" placeholder="Опишите проблему в двух словах…"></textarea>
        <label class="tk-lbl">Скриншоты <span class="tk-hint">(по желанию; удалятся после закрытия тикета)</span></label>
        <div class="tk-shots">${shots}<label class="tk-shot-add">＋<input type="file" accept="image/*" multiple style="display:none" onchange="tkPickShot(this)"></label></div>
        <label class="tk-lbl">Ссылка на ваш ВК <span class="tk-hint">(чтобы с вами связались)</span></label>
        <input id="tk-vk" class="tk-inp" placeholder="https://vk.com/...">
        <button class="tk-send" ${TK.busy ? 'disabled' : ''} onclick="tkSubmit()">Отправить тикет</button>
      </div>
      <div class="tk-mine">
        <div class="tk-form-t">Мои тикеты</div>
        ${mineHtml}
      </div>
    </div>
  </div>`;
}
function tkMineRow(t) {
  const open = TK.openId === t.id;
  const st = t.status === 'closed'
    ? '<span class="tk-badge closed">закрыт</span>'
    : '<span class="tk-badge open">открыт</span>';
  return `<div class="tk-card${open ? ' open' : ''}">
    <div class="tk-card-hd" onclick="tkToggle('${t.id}')">
      <span class="tk-card-cat">${esc(tkCatLabel(t.category))}</span>${st}
      <span class="tk-card-when">${tkWhen(t.created_at)}</span>
    </div>
    ${open ? `<div class="tk-card-body" id="tk-thread-${t.id}"><div class="tk-loading">…</div></div>` : ''}
  </div>`;
}
async function tkToggle(id) {
  TK.openId = TK.openId === id ? null : id;
  tkRender();
  if (TK.openId) tkRenderThread(id, false);
}
async function tkRenderThread(id, staff) {
  const box = document.getElementById(`tk-thread-${id}`); if (!box) return;
  const t = (TK.mine.find(x => x.id === id)) || (TK.admin || []).find(x => x.id === id) || {};
  const msgs = await tkLoadThread(id);
  const shots = (t.screenshots || []).map(u => `<button type="button" class="tk-thumb" onclick="tkViewImg(this.firstElementChild.src)"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('');
  const thread = msgs.map(m => `<div class="tk-msg ${m.is_staff ? 'staff' : 'me'}"><div class="tk-msg-a">${m.is_staff ? '🛡 ' : ''}${esc(m.author_name || 'Игрок')} · ${tkWhen(m.created_at)}</div><div class="tk-msg-b">${esc(m.body).replace(/\n/g, '<br>')}</div></div>`).join('') || '<div class="tk-empty">Сообщений пока нет.</div>';
  const closed = t.status === 'closed';
  box.innerHTML = `
    <div class="tk-desc-full">${esc(t.description || '')}</div>
    ${shots ? `<div class="tk-thumbs">${shots}</div>` : ''}
    ${t.vk_link ? `<div class="tk-vk-row">ВК: <a href="${esc(t.vk_link)}" target="_blank" rel="noopener">${esc(t.vk_link)}</a></div>` : ''}
    <div class="tk-thread">${thread}</div>
    ${closed ? '<div class="tk-closed-note">Тикет закрыт.</div>'
      : `<div class="tk-reply"><textarea id="tk-r-${id}" class="tk-inp" rows="2" placeholder="Ответить…"></textarea>
          <button class="tk-send sm" onclick="tkReply('${id}',${staff ? 'true' : 'false'})">Отправить</button>
          ${staff ? `<button class="tk-send sm close" onclick="tkCloseTicket('${id}')">✓ Закрыть тикет</button>` : ''}</div>`}`;
}

// ── Скриншоты ──────────────────────────────────────────────────
function tkPickShot(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  if (typeof handleImgUpload !== 'function') { toast('Загрузка изображений недоступна', 'err'); return; }
  files.forEach(f => {
    if (TK.shots.length >= 4) { toast('Не более 4 скриншотов', 'err'); return; }
    handleImgUpload(f, url => { TK.shots.push(url); tkRender(); });
  });
  input.value = '';
}
function tkRemoveShot(i) { TK.shots.splice(i, 1); tkRender(); }

// Просмотр скриншота во весь экран (лайтбокс поверх всего)
function tkViewImg(src) {
  if (!src) return;
  let ov = document.getElementById('tk-img-ov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'tk-img-ov'; ov.className = 'tk-img-ov';
    ov.onclick = e => { if (e.target === ov) tkImgClose(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<button class="tk-img-x" onclick="tkImgClose()" title="Закрыть">✕</button><img src="${esc(src)}" alt="">`;
  ov.classList.add('show');
}
function tkImgClose() { const ov = document.getElementById('tk-img-ov'); if (ov) ov.classList.remove('show'); }

// ── Отправка тикета ────────────────────────────────────────────
async function tkSubmit() {
  if (TK.busy) return;
  const cat = document.getElementById('tk-cat')?.value;
  const desc = (document.getElementById('tk-desc')?.value || '').trim();
  const vk = (document.getElementById('tk-vk')?.value || '').trim();
  if (!desc) { toast('Опишите проблему', 'err'); return; }
  TK.busy = true; tkRender();
  try {
    const row = {
      user_id: user.id, user_email: user.email,
      user_name: (typeof userProfile !== 'undefined' && userProfile.display_name) || (user.email || '').split('@')[0],
      category: cat, description: desc, vk_link: vk || null,
      screenshots: TK.shots,
    };
    await dbPost('tickets', row);
    tkNotifyVK(row);
    TK.shots = [];
    toast('Тикет отправлен — администрация увидит его на сайте', 'ok');
    await tkLoadMine();
  } catch (e) { toast('Ошибка отправки: ' + (e.message || ''), 'err'); }
  finally { TK.busy = false; tkRender(); }
}

// Ответ в треде (игрок или стафф)
async function tkReply(id, staff) {
  const ta = document.getElementById(`tk-r-${id}`); const body = (ta?.value || '').trim();
  if (!body) { toast('Введите сообщение', 'err'); return; }
  try {
    await dbPost('ticket_messages', {
      ticket_id: id, author_id: user.id,
      author_name: (typeof userProfile !== 'undefined' && userProfile.display_name) || (user.email || '').split('@')[0],
      is_staff: !!staff, body,
    });
    if (staff) tkRenderThread(id, true); else { await tkLoadMine(); tkRenderThread(id, false); }
  } catch (e) { toast('Ошибка: ' + (e.message || ''), 'err'); }
}

// ── Уведомление в VK через Edge Function ticket-vk (fire-and-forget) ──
async function tkNotifyVK(t) {
  if (!TK_VK_WEBHOOK) return;
  let token = (typeof SB_ANON !== 'undefined') ? SB_ANON : '';
  try { token = await getTokenFresh(); } catch (e) {}
  try {
    fetch(TK_VK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: (typeof SB_ANON !== 'undefined' ? SB_ANON : ''), Authorization: 'Bearer ' + token },
      body: JSON.stringify({ category: tkCatLabel(t.category), description: t.description, user_name: t.user_name, vk_link: t.vk_link, screenshots: t.screenshots || [], at: new Date().toISOString() }),
    }).catch(() => {});
  } catch (e) {}
}

// ── Удаление скриншотов из Storage (бакет wiki-images) ─────────
async function tkDeleteShots(urls) {
  if (!urls || !urls.length) return;
  let token = ''; try { token = await getTokenFresh(); } catch (e) {}
  for (const u of urls) {
    const m = /\/wiki-images\/(.+)$/.exec(u || '');
    if (!m) continue;
    try {
      await fetch(`${SB_URL}/storage/v1/object/wiki-images/${m[1]}`, {
        method: 'DELETE', headers: { apikey: SB_ANON, Authorization: 'Bearer ' + token },
      });
    } catch (e) {}
  }
}

// ── АДМИН: вкладка тикетов (вызывается из editor.js renderAp) ──
async function tkRenderAdmin(box) {
  if (!box) return;
  box.innerHTML = `<div class="tk-loading">Загрузка тикетов…</div>`;
  let all = [];
  try { all = await dbGet('tickets', 'order=created_at.desc&limit=100') || []; } catch (e) { box.innerHTML = `<p style="color:var(--err)">Ошибка: ${esc(e.message || '')}</p>`; return; }
  TK.admin = all;
  const open = all.filter(t => t.status !== 'closed');
  const closed = all.filter(t => t.status === 'closed');
  const row = t => {
    const isOpen = TK.openId === t.id;
    const st = t.status === 'closed' ? '<span class="tk-badge closed">закрыт</span>' : '<span class="tk-badge open">открыт</span>';
    return `<div class="tk-card${isOpen ? ' open' : ''}">
      <div class="tk-card-hd" onclick="tkAdminToggle('${t.id}')">
        <span class="tk-card-cat">${esc(tkCatLabel(t.category))}</span>${st}
        <span class="tk-card-who">${esc(t.user_name || t.user_email || '')}</span>
        <span class="tk-card-when">${tkWhen(t.created_at)}</span>
      </div>
      ${isOpen ? `<div class="tk-card-body" id="tk-thread-${t.id}"><div class="tk-loading">…</div></div>` : ''}
    </div>`;
  };
  box.innerHTML = `<div class="tk-admin">
    <div class="tk-admin-sec">Открытые <b>${open.length}</b></div>
    ${open.map(row).join('') || '<div class="tk-empty">Нет открытых тикетов 🎉</div>'}
    ${closed.length ? `<div class="tk-admin-sec">Закрытые <b>${closed.length}</b></div>${closed.slice(0, 20).map(row).join('')}` : ''}
  </div>`;
}
async function tkAdminToggle(id) {
  TK.openId = TK.openId === id ? null : id;
  const box = document.getElementById('ap-body');
  await tkRenderAdmin(box);
  if (TK.openId) tkRenderThread(id, true);
}
async function tkCloseTicket(id) {
  if (!confirm('Закрыть тикет? Скриншоты будут удалены.')) return;
  const t = (TK.admin || []).find(x => x.id === id) || {};
  try {
    await tkDeleteShots(t.screenshots || []);
    await dbPatch('tickets', `id=eq.${id}`, { status: 'closed', screenshots: [], closed_at: new Date().toISOString(), closed_by: (user.email || '') });
    toast('Тикет закрыт, скриншоты удалены', 'ok');
    const box = document.getElementById('ap-body'); TK.openId = null; if (box) tkRenderAdmin(box);
  } catch (e) { toast('Ошибка: ' + (e.message || ''), 'err'); }
}

// Бейдж количества открытых тикетов (для вкладки админки)
async function tkOpenCount() {
  if (!tkIsStaff()) return 0;
  try { const r = await dbGet('tickets', 'status=eq.open&select=id'); return (r || []).length; } catch (e) { return 0; }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tkMount);
else tkMount();
