// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  ОБЩИЙ ЧАТ «ГИПЕРСВЯЗЬ» — Supabase Realtime Broadcast (вебсокет) + история.
//  ДОСТАВКА живая, по вебсокету: разослали всем, кто сейчас в сети, — быстро и
//  без круга через базу. ИСТОРИЯ пишется в public.chat_messages: таблица-кольцо
//  на 300 строк (хвост режет триггер chat_trim, см. _chat_history.sql). Вошедший
//  читает последние 300 и видит, о чём речь, — раньше чат забывал всё при
//  закрытии вкладки. sessionStorage остался кадром «до ответа сервера».
//  Подключение ПОСТОЯННОЕ (с момента входа), окно можно закрывать — эфир
//  копится, на кнопке растёт бейдж непрочитанных.
//  Зависит от: core.js (sb, dbGet, dbPost, esc, toast, user, userProfile).
// ════════════════════════════════════════════════════════════════════════

const CH = {
  channel: null,      // RealtimeChannel
  joined: false,      // подписка подтверждена сервером
  open: false,        // окно чата раскрыто
  log: [],            // {name, fac, fc, staff, body, at} — только в памяти/сессии
  online: [],         // presence: [{name, fac, fc, staff}]
  unread: 0,          // счётчик для бейджа на кнопке
  busy: false,        // защёлка от даблсенда
  lastSent: 0,        // троттлинг: не чаще 1 сообщения в 2с
  fac: null,          // {name, color} — моя фракция (для подписи в чате)
  facLoaded: false,
  retryT: null,       // таймер пересоздания канала после CLOSED
  ghost: false,       // «невидимка»: стафф не публикует presence (нет в «На связи»)
  histAt: 0,          // когда последний раз тянули историю из БД
  histBusy: false,
};
const CH_LOG_CAP = 300;   // столько же строк держит кольцо в базе
const CH_MSG_MAX = 500;
const CH_SS_KEY = 'wk_chat_log';   // sessionStorage: история переживает F5
const CH_GHOST_KEY = 'wk_chat_ghost';  // localStorage: выбор режима невидимки переживает вкладку

function chCanUse() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator', 'player'].includes(user.role)); }
function chIsStaff() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }
function chMyName() {
  return (typeof userProfile !== 'undefined' && userProfile.display_name)
    || (typeof user !== 'undefined' && user && (user.email || '').split('@')[0])
    || 'Аноним';
}
// Невидимка доступна только стаффу. По умолчанию ВКЛючена (чтобы не спалиться на первом входе),
// но запоминаем явный выбор игрока в localStorage.
function chLoadGhost() {
  if (!chIsStaff()) { CH.ghost = false; return; }
  try {
    const v = localStorage.getItem(CH_GHOST_KEY);
    CH.ghost = (v === null) ? true : (v === '1');
  } catch (e) { CH.ghost = true; }
}
function chSaveGhost() { try { localStorage.setItem(CH_GHOST_KEY, CH.ghost ? '1' : '0'); } catch (e) {} }
// Публикуем/снимаем presence по режиму. В невидимке — untrack (пропадаем из списка и счётчика).
async function chSyncPresence() {
  if (!CH.channel || !CH.joined) return;
  try {
    if (CH.ghost) { await CH.channel.untrack(); }
    else { await CH.channel.track({ name: chMyName(), staff: chIsStaff(), fac: CH.fac?.name || '', fc: CH.fac?.color || '', av: chMyAvatar() }); }
  } catch (e) {}
}
// Молчаливое управление из консоли (без кнопок — кнопка сама по себе палит).
//   chGhost()       → показать текущий режим
//   chGhost(false)  → стать видимым в «На связи»
//   chGhost(true)   → снова спрятаться
async function chGhost(on) {
  if (!chIsStaff()) return 'только для стаффа';
  if (typeof on === 'boolean' && on !== CH.ghost) {
    CH.ghost = on; chSaveGhost(); await chSyncPresence();
  }
  return CH.ghost ? 'невидимка (тебя нет в «На связи»)' : 'виден под своим именем';
}
if (typeof window !== 'undefined') window.chGhost = chGhost;
function chWhen(ts) { try { return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
// Валидатор ссылки на аватар для контекста <img src> (esc() уже гасит XSS в атрибуте).
// safeAvatar() из core.js слишком строг — режет относительные/storage-пути и data:svg,
// которые остальной сайт (шапка, editor.js) рисует как есть → у профиля пропадала аватарка.
// Пропускаем http(s), data:image, protocol-relative и same-origin пути; режем чужие схемы.
function chAvUrl(u) {
  const s = String(u || '').trim();
  if (!s || /[\s"'<>`]/.test(s)) return '';
  if (/^https?:\/\//i.test(s)) return s;                                  // абсолютный http(s)
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s;   // data-картинка (img не исполняет скрипты)
  if (/^\/\//.test(s)) return 'https:' + s;                               // protocol-relative
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) return s;                         // относительный (same-origin) путь
  return '';                                                              // javascript:, blob: и прочие схемы — мимо
}
function chMyAvatar() { return chAvUrl((typeof userProfile !== 'undefined' && userProfile.avatar_url) || ''); }
// Аватарка: реальная ссылка или инициалы с цветом по имени (fallback как в getAvatarHtml)
function chAvatar(name, av) {
  const u = chAvUrl(av);
  const nm = String(name || '?');
  const initials = esc(nm.slice(0, 2).toUpperCase());
  const hue = [...nm].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const ini = `<span class="ch-av-ini" style="background:hsl(${hue},35%,22%);color:hsl(${hue},60%,70%)">${initials}</span>`;
  if (u) return `<img class="ch-av-img" src="${esc(u)}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.ini" data-ini="${esc(ini)}">`;
  return ini;
}

// ── Мгновенный кадр в sessionStorage (пока не пришла история из БД) ──
function chSaveLog() { try { sessionStorage.setItem(CH_SS_KEY, JSON.stringify(CH.log.slice(-CH_LOG_CAP))); } catch (e) {} }
function chLoadLog() {
  try {
    const raw = sessionStorage.getItem(CH_SS_KEY); if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) CH.log = arr.filter(m => m && typeof m.body === 'string').slice(-CH_LOG_CAP);
  } catch (e) {}
}

// ── История из БД (последние 300) ──────────────────────────────
// Живая доставка идёт мимо базы, поэтому строка может прийти дважды: broadcast'ом
// и в выборке. Серверные строки помечены `id` — по нему и склеиваем; у пришедших
// вебсокетом id нет, их отсеиваем по совпадению автора и текста.
function chKey(m) { return String(m.name) + '|' + String(m.body); }
function chMergeHistory(rows) {
  const hist = rows.map(r => ({
    id: r.id,
    name: String(r.name || 'Аноним').slice(0, 40),
    fac: String(r.fac || '').slice(0, 60),
    fc: /^#[0-9a-fA-F]{3,8}$/.test(r.fc || '') ? r.fc : '',
    av: chAvUrl(r.av),
    staff: !!r.staff,
    body: String(r.body || '').slice(0, CH_MSG_MAX),
    at: r.created_at ? Date.parse(r.created_at) : Date.now(),
  }));
  const seen = new Set(hist.map(m => chKey(m)));
  const live = CH.log.filter(m => !m.id && !seen.has(chKey(m)));
  CH.log = hist.concat(live).slice(-CH_LOG_CAP);
  chSaveLog();
  if (CH.open) chRenderLog();
}
async function chLoadHistory(force) {
  if (CH.histBusy) return;
  if (!force && CH.histAt && Date.now() - CH.histAt < 120000) return;
  CH.histBusy = true;
  try {
    const rows = await dbGet('chat_messages', `select=id,name,fac,fc,av,staff,body,created_at&order=id.desc&limit=${CH_LOG_CAP}`);
    if (Array.isArray(rows)) { CH.histAt = Date.now(); chMergeHistory(rows.reverse()); }
  } catch (e) {}
  finally { CH.histBusy = false; }
}

// Моя фракция (название+цвет) — один запрос за сессию, дальше из памяти
async function chLoadFaction() {
  if (CH.facLoaded || typeof user === 'undefined' || !user) return;
  CH.facLoaded = true;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&status=eq.approved&select=name,color&limit=1`);
    if (rows && rows[0]) CH.fac = { name: rows[0].name || '', color: rows[0].color || '' };
  } catch (e) {}
}

// ── Кнопка + оверлей-модалка (как у тикетов) ───────────────────
function chMount() {
  if (document.getElementById('ch-fab')) return;
  chLoadLog();
  chLoadGhost();
  const fab = document.createElement('button');
  fab.id = 'ch-fab';
  fab.title = 'Общий чат «Гиперсвязь» (хранятся последние 300 сообщений)';
  fab.innerHTML = '<svg class="ch-fab-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4c-1.2 0-2.4-.2-3.4-.7L3 21l1.8-4.4A8.4 8.4 0 1 1 21 11.5z"/></svg><span id="ch-fab-badge" class="ch-fab-badge" style="display:none">0</span>';
  fab.onclick = chToggle;
  fab.style.display = 'none';   // показывается только игрокам/админам (chUpdateVisibility)
  document.body.appendChild(fab);

  const ov = document.createElement('div');
  ov.id = 'ch-ov'; ov.className = 'ch-ov';
  ov.onclick = e => { if (e.target === ov) chToggle(); };
  document.body.appendChild(ov);
  chUpdateVisibility();
}
function chUpdateVisibility() {
  const fab = document.getElementById('ch-fab');
  if (fab) fab.style.display = chCanUse() ? '' : 'none';
  if (chCanUse()) chConnect();          // подключаемся сразу после входа — эфир копится
  else if (CH.open) chToggle();
}

function chToggle() {
  const ov = document.getElementById('ch-ov'); if (!ov) return;
  CH.open = !CH.open;
  ov.classList.toggle('show', CH.open);
  if (CH.open) {
    CH.unread = 0; chBadge();
    chConnect();
    chRender();
    chLoadHistory();
    setTimeout(() => document.getElementById('ch-inp')?.focus(), 60);
  }
}
function chBadge() {
  const b = document.getElementById('ch-fab-badge'); if (!b) return;
  b.style.display = CH.unread > 0 ? '' : 'none';
  b.textContent = CH.unread > 9 ? '9+' : String(CH.unread);
}

// ── Вебсокет-канал (Broadcast + Presence) ──────────────────────
function chConnect() {
  if (CH.channel || typeof sb === 'undefined' || !chCanUse()) return;
  CH.channel = sb.channel('global-chat', {
    config: {
      broadcast: { self: true },                       // своё сообщение получаем тем же путём, что и все
      presence: { key: (typeof user !== 'undefined' && user && user.id) || String(Math.random()) },
    },
  });
  CH.channel
    .on('broadcast', { event: 'msg' }, ({ payload }) => chOnMsg(payload))
    .on('presence', { event: 'sync' }, () => {
      const st = CH.channel.presenceState();
      CH.online = Object.values(st).map(arr => arr[0]).filter(Boolean);
      chRenderOnline();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        CH.joined = true;
        await chLoadFaction();
        chLoadGhost();            // user уже авторизован — теперь роль известна
        await chSyncPresence();   // в невидимке НЕ трекаемся — нет в «На связи»
        chLoadHistory(true);      // последние 300 строк — чтобы вошедший видел разговор
        chRenderStatus(); chRenderOnline();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        CH.joined = false;
        chRenderStatus();
        // Пересоздаём канал: сокет supabase-js переподключается сам, но канал
        // после CLOSED сам не оживает — иначе «Переподключение…» висит вечно.
        if (!CH.retryT) CH.retryT = setTimeout(() => {
          CH.retryT = null;
          try { sb.removeChannel(CH.channel); } catch (e) {}
          CH.channel = null;
          chConnect();
        }, 3000);
      }
    });
}

function chOnMsg(p) {
  if (!p || typeof p.body !== 'string') return;
  CH.log.push({
    name: String(p.name || 'Аноним').slice(0, 40),
    fac: String(p.fac || '').slice(0, 60),
    fc: /^#[0-9a-fA-F]{3,8}$/.test(p.fc || '') ? p.fc : '',
    av: chAvUrl(p.av),
    staff: !!p.staff,
    body: p.body.slice(0, CH_MSG_MAX),
    at: Date.now(),
  });
  if (CH.log.length > CH_LOG_CAP) CH.log.splice(0, CH.log.length - CH_LOG_CAP);
  chSaveLog();
  if (CH.open) chRenderLog();
  else { CH.unread++; chBadge(); }
}

async function chSend() {
  const inp = document.getElementById('ch-inp'); if (!inp) return;
  const body = (inp.value || '').trim().slice(0, CH_MSG_MAX);
  if (!body || CH.busy) return;
  const now = Date.now();
  if (now - CH.lastSent < 2000) { toast('Не так быстро — раз в пару секунд', 'err'); return; }
  if (!CH.channel || !CH.joined) { toast('Чат ещё подключается…', 'err'); return; }
  // В невидимке сообщение всё равно уходит под твоим именем — предупреждаем один раз.
  if (CH.ghost && !confirm('Ты в режиме невидимки, но сообщение уйдёт под именем «' + chMyName() + '» и спалит тебя. Отправить?')) return;
  CH.busy = true;
  try {
    const p = { name: chMyName(), staff: chIsStaff(), fac: CH.fac?.name || '', fc: CH.fac?.color || '', av: chMyAvatar(), body };
    await CH.channel.send({ type: 'broadcast', event: 'msg', payload: p });
    CH.lastSent = now;
    inp.value = '';
    // История: живую доставку не задерживаем — пишем строку после отправки в эфир.
    // Не легло в базу (RLS, обрыв) — сообщение всё равно услышали, поэтому тихо.
    dbPost('chat_messages', p).catch(() => {});
  } catch (e) { toast('Не отправилось: ' + (e.message || 'нет связи'), 'err'); }
  finally { CH.busy = false; inp.focus(); }
}

// ── Рендер ─────────────────────────────────────────────────────
function chRender() {
  const ov = document.getElementById('ch-ov'); if (!ov || !CH.open) return;
  ov.innerHTML = `<div class="ch-modal">
    <div class="ch-hd">
      <div class="ch-hd-main">
        <span class="ch-hd-k">ГИПЕРСВЯЗЬ · ОТКРЫТЫЙ КАНАЛ</span>
        <span class="ch-hd-t">Общий чат</span>
      </div>
      <span class="ch-status" id="ch-status"></span>
      <button class="ch-x" onclick="chToggle()" title="Закрыть">✕</button>
    </div>
    <div class="ch-body">
      <div class="ch-main">
        <div class="ch-note"><span class="ch-note-dot"></span>Открытый эфир — в записи держатся последние 300 сообщений</div>
        <div class="ch-log" id="ch-log"></div>
        <div class="ch-input-row">
          <div class="ch-inp-wrap">
            <input id="ch-inp" class="ch-inp" maxlength="${CH_MSG_MAX}" placeholder="Передать в эфир…" autocomplete="off">
          </div>
          <button class="ch-send" onclick="chSend()">Передать</button>
        </div>
      </div>
      <div class="ch-side">
        <div class="ch-side-t">На связи <b id="ch-online-n">0</b></div>
        <div class="ch-side-list" id="ch-online-list"></div>
      </div>
    </div>
  </div>`;
  document.getElementById('ch-inp').onkeydown = e => { if (e.key === 'Enter') chSend(); };
  chRenderLog(); chRenderOnline(); chRenderStatus();
}
function chRenderLog() {
  const box = document.getElementById('ch-log'); if (!box) return;
  box.innerHTML = CH.log.length
    ? CH.log.map(m => {
      const fc = m.fc || 'var(--te, #3ec0d0)';
      const facChip = m.fac ? `<span class="ch-msg-f" style="--fc:${m.fc || 'var(--t3)'}">${esc(m.fac)}</span>` : '';
      return `<div class="ch-msg${m.staff ? ' staff' : ''}" style="--fc:${fc}">
        <div class="ch-msg-av">${chAvatar(m.name, m.av)}</div>
        <div class="ch-msg-main">
          <div class="ch-msg-hd"><span class="ch-msg-a">${m.staff ? '🛡 ' : ''}${esc(m.name)}</span>${facChip}<span class="ch-msg-w">${chWhen(m.at)}</span></div>
          <div class="ch-msg-b">${esc(m.body)}</div>
        </div>
      </div>`;
    }).join('')
    : '<div class="ch-empty">В эфире тишина.<br>Скажи что-нибудь — услышат все, кто сейчас в игре.</div>';
  box.scrollTop = box.scrollHeight;
}
function chRenderOnline() {
  const n = document.getElementById('ch-online-n'); if (n) n.textContent = String(CH.online.length);
  const list = document.getElementById('ch-online-list'); if (!list) return;
  list.innerHTML = CH.online.length
    ? CH.online.map(o => {
      const fc = (/^#[0-9a-fA-F]{3,8}$/.test(o.fc || '') ? o.fc : '') || 'var(--te, #3ec0d0)';
      return `<div class="ch-who" style="--fc:${fc}">
        <span class="ch-who-dot"></span>
        <span class="ch-who-n">${o.staff ? '🛡 ' : ''}${esc(o.name || '')}</span>
        ${o.fac ? `<span class="ch-who-f">${esc(o.fac)}</span>` : ''}
      </div>`;
    }).join('')
    : '<div class="ch-empty sm">Никого…</div>';
}
function chRenderStatus() {
  const el = document.getElementById('ch-status'); if (!el) return;
  el.textContent = CH.joined ? '● КАНАЛ ОТКРЫТ' : '◌ ПЕРЕПОДКЛЮЧЕНИЕ…';
  el.classList.toggle('down', !CH.joined);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chMount);
else chMount();
