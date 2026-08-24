// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  ЧАТ «ГИПЕРСВЯЗЬ» — КОМНАТЫ
//
//  Комнат несколько: общая, рыбалка, чат державы, чат каждого союза и унии,
//  плюс свои комнаты, заведённые игроком внутри своего субъекта. СПИСОК СВОИХ
//  КОМНАТ СЧИТАЕТ СЕРВЕР (rpc chat_my_rooms) — клиент не перечисляет чужие
//  ключи и не угадывает их.
//
//  ⚠️ ПОЧЕМУ ЖИВОЙ ЭФИР БОЛЬШЕ НЕ BROADCAST. Broadcast-канал слушает всякий,
//  кто знает его имя, а имя знает клиент → державная переписка утекала бы
//  вместе с открытой консолью. Теперь сообщение приходит подпиской на ВСТАВКУ
//  в chat_messages (postgres_changes): Realtime прогоняет строку через RLS
//  каждого подписчика (chat_can_read), и не член державы не получает пакет.
//  Секретность держит сервер, а не то, что клиент «не показал».
//
//  История — те же строки: в каждой комнате кольцо на 300 (см. _chat_rooms.sql).
//  Presence («На связи») остался на ОБЩЕМ публичном канале и отвечает «кто
//  сейчас в игре» — по комнатам его не разносим, чтобы состав закрытых комнат
//  не читался снаружи по именам топиков.
//
//  Зависит от: core.js (sb, dbGet, dbPost, esc, toast, user, userProfile).
// ════════════════════════════════════════════════════════════════════════

const CH = {
  rooms: [],          // [{room, scope, subj, name, subtitle}] — с сервера
  room: 'global',     // открытая комната
  logs: {},           // room → [{id,name,fac,fc,av,staff,body,at}]
  unread: {},         // room → сколько непрочитанных
  histAt: {},         // room → когда тянули историю
  rt: null,           // канал postgres_changes (живая доставка)
  pres: null,         // канал presence («На связи»)
  joined: false,      // presence-канал подтверждён сервером
  open: false,        // окно чата раскрыто
  online: [],         // presence: [{name, fac, fc, staff}]
  busy: false,        // защёлка от даблсенда
  lastSent: 0,        // троттлинг: не чаще 1 сообщения в 2с
  fac: null,          // {name, color} — моя фракция (для подписи в чате)
  facLoaded: false,
  retryT: null,       // таймер пересоздания presence-канала после CLOSED
  ghost: false,       // «невидимка»: стафф не публикует presence
  adding: false,      // раскрыта форма «завести комнату»
  roomsAt: 0,
  q: '',              // фильтр списка комнат
  qm: '',             // поиск по эфиру открытой комнаты
};
const CH_LOG_CAP = 300;   // столько же строк держит кольцо в базе
const CH_MSG_MAX = 500;
const CH_SS_KEY = 'wk_chat_logs';      // sessionStorage: кадр до ответа сервера
const CH_ROOM_KEY = 'wk_chat_room';    // localStorage: последняя открытая комната
const CH_GHOST_KEY = 'wk_chat_ghost';  // localStorage: режим невидимки

function chCanUse() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator', 'player'].includes(user.role)); }
function chIsStaff() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }
function chMyName() {
  return (typeof userProfile !== 'undefined' && userProfile.display_name)
    || (typeof user !== 'undefined' && user && (user.email || '').split('@')[0])
    || 'Аноним';
}
function chLog(room) { return (CH.logs[room = room || CH.room] || (CH.logs[room] = [])); }
function chRoomInfo(key) { return CH.rooms.find(r => r.room === (key || CH.room)) || { room: key || CH.room, name: 'Комната', scope: '', subj: '', subtitle: '' }; }
function chUnreadTotal() { return Object.values(CH.unread).reduce((a, b) => a + b, 0); }

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
  if (!CH.pres || !CH.joined) return;
  try {
    if (CH.ghost) { await CH.pres.untrack(); }
    else { await CH.pres.track({ name: chMyName(), staff: chIsStaff(), fac: CH.fac?.name || '', fc: CH.fac?.color || '', av: chMyAvatar() }); }
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
function chSaveLog() {
  try {
    const out = {};
    for (const k of Object.keys(CH.logs)) out[k] = CH.logs[k].slice(-60);
    sessionStorage.setItem(CH_SS_KEY, JSON.stringify(out));
  } catch (e) {}
}
function chLoadLog() {
  try {
    const raw = sessionStorage.getItem(CH_SS_KEY); if (!raw) return;
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      if (Array.isArray(o[k])) CH.logs[k] = o[k].filter(m => m && typeof m.body === 'string');
    }
  } catch (e) {}
}

// ── Комнаты ────────────────────────────────────────────────────
// Строку приводим к виду лога здесь, чтобы история из REST и живая вставка из
// Realtime попадали в один формат (у обеих есть id — по нему и склеиваем).
function chRow(r) {
  return {
    id: r.id,
    room: r.room || 'global',
    name: String(r.name || 'Аноним').slice(0, 40),
    fac: String(r.fac || '').slice(0, 60),
    fc: /^#[0-9a-fA-F]{3,8}$/.test(r.fc || '') ? r.fc : '',
    av: chAvUrl(r.av),
    staff: !!r.staff,
    body: String(r.body || '').slice(0, CH_MSG_MAX),
    at: r.created_at ? Date.parse(r.created_at) : Date.now(),
  };
}
async function chLoadRooms() {
  try {
    const rows = await dbPost('rpc/chat_my_rooms', {});
    if (!Array.isArray(rows)) return;
    CH.rooms = rows; CH.roomsAt = Date.now();
    let saved = ''; try { saved = localStorage.getItem(CH_ROOM_KEY) || ''; } catch (e) {}
    if (saved && rows.some(r => r.room === saved)) CH.room = saved;
    if (!rows.some(r => r.room === CH.room)) CH.room = 'global';
    chSubscribe();
    if (CH.open) { chRenderRooms(); chHistory(CH.room); }
  } catch (e) {}
}
function chPickRoom(key) {
  if (key === CH.room) return;
  CH.room = key; CH.unread[key] = 0; chBadge();
  try { localStorage.setItem(CH_ROOM_KEY, key); } catch (e) {}
  CH.adding = false;
  CH.qm = '';                                  // поиск был по прежнему эфиру
  const fq = document.getElementById('ch-fq'); if (fq) fq.value = '';
  chRenderRooms(); chRenderLog(); chHistory(key);
  document.getElementById('ch-inp')?.focus();
}

// ── Живая доставка: вставки в chat_messages по моим комнатам ────
// Один канал, по слушателю на комнату. Пакет отдаёт сервер, сверив строку с
// RLS подписчика, — чужая комната не долетит, даже если знать её ключ.
function chSubscribe() {
  if (typeof sb === 'undefined' || !chCanUse() || !CH.rooms.length) return;
  if (CH.rt) { try { sb.removeChannel(CH.rt); } catch (e) {} CH.rt = null; }
  const ch = sb.channel('chat-rt-' + (user?.id || 'anon'));
  for (const r of CH.rooms) {
    ch.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room=eq.${r.room}` },
      ({ new: row }) => chOnRow(row));
  }
  CH.rt = ch;
  ch.subscribe();
}
function chOnRow(row) {
  if (!row || typeof row.body !== 'string') return;
  const m = chRow(row);
  const log = chLog(m.room);
  if (m.id && log.some(x => x.id === m.id)) return;      // своя же строка, уже показана
  log.push(m);
  if (log.length > CH_LOG_CAP) log.splice(0, log.length - CH_LOG_CAP);
  chSaveLog();
  if (CH.open && m.room === CH.room) chRenderLog();
  else { CH.unread[m.room] = (CH.unread[m.room] || 0) + 1; chBadge(); if (CH.open) chRenderRooms(); }
}

// ── История комнаты (последние 300) ────────────────────────────
async function chHistory(room, force) {
  if (!force && CH.histAt[room] && Date.now() - CH.histAt[room] < 120000) return;
  CH.histAt[room] = Date.now();
  try {
    const rows = await dbGet('chat_messages', `room=eq.${encodeURIComponent(room)}&select=id,room,name,fac,fc,av,staff,body,created_at&order=id.desc&limit=${CH_LOG_CAP}`);
    if (!Array.isArray(rows)) return;
    const hist = rows.reverse().map(chRow);
    const ids = new Set(hist.map(m => m.id));
    const live = (CH.logs[room] || []).filter(m => m.id && !ids.has(m.id));
    CH.logs[room] = hist.concat(live).slice(-CH_LOG_CAP);
    chSaveLog();
    if (CH.open && room === CH.room) chRenderLog();
  } catch (e) { CH.histAt[room] = 0; }
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
  fab.title = 'Чат «Гиперсвязь» (хранятся последние 300 сообщений в комнате)';
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
    CH.unread[CH.room] = 0; chBadge();
    chConnect();
    chRender();
    if (!CH.rooms.length || Date.now() - CH.roomsAt > 120000) chLoadRooms();
    chHistory(CH.room);
    setTimeout(() => document.getElementById('ch-inp')?.focus(), 60);
  }
}
function chBadge() {
  const b = document.getElementById('ch-fab-badge'); if (!b) return;
  const n = chUnreadTotal();
  b.style.display = n > 0 ? '' : 'none';
  b.textContent = n > 9 ? '9+' : String(n);
}

// ── Presence: «кто сейчас в игре» (общий публичный канал) ───────
function chConnect() {
  if (typeof sb === 'undefined' || !chCanUse()) return;
  if (!CH.rooms.length) chLoadRooms();
  if (CH.pres) return;
  CH.pres = sb.channel('global-chat', {
    config: { presence: { key: (typeof user !== 'undefined' && user && user.id) || String(Math.random()) } },
  });
  CH.pres
    .on('presence', { event: 'sync' }, () => {
      const st = CH.pres.presenceState();
      CH.online = Object.values(st).map(arr => arr[0]).filter(Boolean);
      chRenderOnline();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        CH.joined = true;
        await chLoadFaction();
        chLoadGhost();            // user уже авторизован — теперь роль известна
        await chSyncPresence();   // в невидимке НЕ трекаемся — нет в «На связи»
        chRenderStatus(); chRenderOnline();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        CH.joined = false;
        chRenderStatus();
        // Пересоздаём канал: сокет supabase-js переподключается сам, но канал
        // после CLOSED сам не оживает — иначе «Переподключение…» висит вечно.
        if (!CH.retryT) CH.retryT = setTimeout(() => {
          CH.retryT = null;
          try { sb.removeChannel(CH.pres); } catch (e) {}
          CH.pres = null;
          chConnect();
        }, 3000);
      }
    });
}

async function chSend() {
  const inp = document.getElementById('ch-inp'); if (!inp) return;
  const body = (inp.value || '').trim().slice(0, CH_MSG_MAX);
  if (!body || CH.busy) return;
  const now = Date.now();
  if (now - CH.lastSent < 2000) { toast('Не так быстро — раз в пару секунд', 'err'); return; }
  // В невидимке сообщение всё равно уходит под твоим именем — предупреждаем.
  if (CH.ghost && !confirm('Ты в режиме невидимки, но сообщение уйдёт под именем «' + chMyName() + '» и спалит тебя. Отправить?')) return;
  CH.busy = true;
  const room = CH.room;
  try {
    const rows = await dbPost('chat_messages', {
      room, body, name: chMyName(), staff: chIsStaff(),
      fac: CH.fac?.name || '', fc: CH.fac?.color || '', av: chMyAvatar(),
    });
    CH.lastSent = now;
    inp.value = '';
    if (Array.isArray(rows) && rows[0]) chOnRow(rows[0]);   // своя строка сразу, не дожидаясь эха
  } catch (e) { toast('Не отправилось: ' + (e.message || 'нет связи'), 'err'); }
  finally { CH.busy = false; inp.focus(); }
}

// ── Свои комнаты: завести / снести ─────────────────────────────
// Субъект берём из СВОИХ комнат: завести можно только там, где состоишь, —
// то же правило сервер проверяет ещё раз в chat_room_create.
function chSubjects() {
  const seen = new Set(), out = [];
  for (const r of CH.rooms) {
    const k = r.scope + '~' + r.subj;
    if (seen.has(k)) continue; seen.add(k);
    if (r.scope === 'global' || r.scope === 'fishing') { if (chIsStaff()) out.push({ scope: r.scope, subj: '', label: r.name }); continue; }
    out.push({ scope: r.scope, subj: r.subj, label: r.name });
  }
  return out;
}
function chAddToggle() { CH.adding = !CH.adding; chRenderRooms(); if (CH.adding) setTimeout(() => document.getElementById('ch-new-n')?.focus(), 40); }
async function chRoomCreate() {
  const sel = document.getElementById('ch-new-s'), nm = document.getElementById('ch-new-n');
  if (!sel || !nm) return;
  const [scope, subj] = (sel.value || '').split('~');
  const name = (nm.value || '').trim();
  if (name.length < 2) { toast('Название: от 2 знаков', 'err'); return; }
  try {
    const key = await dbPost('rpc/chat_room_create', { p_scope: scope, p_subj: subj || '', p_name: name });
    CH.adding = false;
    await chLoadRooms();
    if (typeof key === 'string') chPickRoom(key);
    toast('Комната заведена', 'ok');
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}
async function chRoomDelete() {
  const key = CH.room;
  if (!key.startsWith('r:')) return;
  if (!confirm('Снести комнату «' + chRoomInfo(key).name + '» вместе со всей перепиской?')) return;
  try {
    await dbPost('rpc/chat_room_delete', { p_room: key });
    delete CH.logs[key]; delete CH.unread[key];
    CH.room = 'global';
    await chLoadRooms();
    chRenderLog();
    toast('Комната снесена', 'ok');
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}

// ── Рендер ─────────────────────────────────────────────────────
function chRender() {
  const ov = document.getElementById('ch-ov'); if (!ov || !CH.open) return;
  ov.innerHTML = `<div class="ch-modal">
    <div class="ch-hd">
      <div class="ch-hd-main">
        <span class="ch-hd-t" id="ch-hd-t">Чат</span>
      </div>
      <input id="ch-fq" class="ch-fq" placeholder="Поиск по эфиру" value="${esc(CH.qm)}" oninput="chSetQM(this.value)">
      <span class="ch-status" id="ch-status"></span>
      <button class="ch-x" onclick="chToggle()" title="Закрыть">✕</button>
    </div>
    <div class="ch-body">
      <div class="ch-side">
        <div class="ch-rooms" id="ch-rooms"></div>
        <div class="ch-side-t">На связи <b id="ch-online-n">0</b></div>
        <div class="ch-side-list" id="ch-online-list"></div>
      </div>
      <div class="ch-main">
        <select class="ch-room-sel" id="ch-room-sel" onchange="chPickRoom(this.value)"></select>
        <div class="ch-log" id="ch-log"></div>
        <div class="ch-input-row">
          <div class="ch-inp-wrap">
            <input id="ch-inp" class="ch-inp" maxlength="${CH_MSG_MAX}" placeholder="Сообщение" autocomplete="off">
          </div>
          <button class="ch-send" onclick="chSend()">Передать</button>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('ch-inp').onkeydown = e => { if (e.key === 'Enter') chSend(); };
  chRenderRooms(); chRenderLog(); chRenderOnline(); chRenderStatus();
}
// Комнаты — списком в рельсе, а не вкладками: у державы и союза имена длинные,
// в корешок они не влезали и рвались на вторую строку.
// КОМНАТ БЫВАЕТ МНОГО (держава + союзы + уния + по 8 своих на каждый субъект —
// это уже за два десятка), поэтому список: сгруппирован по субъекту, внутри
// группы непрочитанные наверху, сверху фильтр по названию, вся рельса скроллится.
function chGroups() {
  const q = CH.q.trim().toLowerCase();
  const map = new Map();
  for (const r of CH.rooms) {
    if (q && !(r.name || '').toLowerCase().includes(q)) continue;
    const key = (r.scope === 'global' || r.scope === 'fishing') ? 'pub' : r.scope + '~' + r.subj;
    if (!map.has(key)) map.set(key, { key, title: '', rows: [] });
    map.get(key).rows.push(r);
  }
  for (const g of map.values()) {
    const base = g.rows.find(r => !r.room.startsWith('r:')) || g.rows[0];
    g.title = g.key === 'pub' ? 'Открытые' : (base.scope === 'fac' ? 'Держава' : base.scope === 'un' ? 'Союз' : 'Уния') + ' · ' + base.name;
    g.rows.sort((a, b) => (CH.unread[b.room] || 0) - (CH.unread[a.room] || 0));
  }
  return [...map.values()];
}
function chSetQ(v) { CH.q = v; chRenderRooms(); const i = document.getElementById('ch-q'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }
function chRenderRooms() {
  const box = document.getElementById('ch-rooms'); if (!box) return;
  const subs = chSubjects();
  const groups = chGroups();
  const body = groups.map(g => `<div class="ch-grp">${esc(g.title)}</div>` + g.rows.map(r => {
    const n = CH.unread[r.room] || 0;
    const shut = r.scope !== 'global' && r.scope !== 'fishing';
    const del = r.room === CH.room && r.room.startsWith('r:')
      ? `<span class="ch-room-x" onclick="event.stopPropagation();chRoomDelete()" title="Снести комнату">✕</span>` : '';
    return `<button class="ch-room${r.room === CH.room ? ' on' : ''}" onclick="chPickRoom('${esc(r.room)}')" title="${esc(r.subtitle || '')}">
      <span class="ch-room-n">${shut ? '<span class="ch-room-lock" title="закрытый эфир">⌁</span>' : ''}${esc(r.name)}</span>
      ${n ? `<i class="ch-room-b">${n > 9 ? '9+' : n}</i>` : ''}${del}
    </button>`;
  }).join('')).join('');
  box.innerHTML = `<div class="ch-side-t">Комнаты</div>
    ${CH.rooms.length > 6 || CH.q ? `<input id="ch-q" class="ch-q" placeholder="Найти комнату" value="${esc(CH.q)}" oninput="chSetQ(this.value)">` : ''}
    <div class="ch-room-list">${body || '<div class="ch-empty sm">Ничего не нашлось</div>'}</div>
    ${subs.length ? `<button class="ch-room-add" onclick="chAddToggle()">${CH.adding ? '× отмена' : '+ завести комнату'}</button>` : ''}
    ${CH.adding ? `<div class="ch-new">
      <select id="ch-new-s" class="ch-new-s">${subs.map(s => `<option value="${esc(s.scope + '~' + s.subj)}">${esc(s.label)}</option>`).join('')}</select>
      <input id="ch-new-n" class="ch-new-n" maxlength="40" placeholder="Название">
      <button class="ch-new-go" onclick="chRoomCreate()">Завести</button>
    </div>` : ''}`;

  // Телефон: рельса скрыта, комнаты переключает список над эфиром.
  const sel = document.getElementById('ch-room-sel');
  if (sel) {
    sel.innerHTML = CH.rooms.map(r => {
      const n = CH.unread[r.room] || 0;
      return `<option value="${esc(r.room)}"${r.room === CH.room ? ' selected' : ''}>${esc(r.name)}${n ? ` (${n})` : ''}</option>`;
    }).join('');
  }
  const cur = chRoomInfo();
  const t = document.getElementById('ch-hd-t');
  if (t) t.textContent = cur.name;
  const s = document.getElementById('ch-status');
  if (s) s.title = (CH.joined ? 'Канал открыт' : 'Переподключение…') + (cur.subtitle ? ' · ' + cur.subtitle : '');
}
// Поиск по эфиру идёт по загруженной истории комнаты — а это и есть ВСЁ, что
// вообще хранится (кольцо на 300). Искать на сервере нечего: за пределами
// кольца сообщений не существует.
function chSetQM(v) {
  CH.qm = v;
  chRenderLog();
  const i = document.getElementById('ch-fq'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
}
function chMark(s, q) {
  const t = esc(s);
  if (!q) return t;
  const i = s.toLowerCase().indexOf(q);
  if (i < 0) return t;
  return esc(s.slice(0, i)) + '<mark class="ch-hit">' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
}
function chRenderLog() {
  const box = document.getElementById('ch-log'); if (!box) return;
  const all = chLog();
  const q = CH.qm.trim().toLowerCase();
  const log = q ? all.filter(m => (m.body + ' ' + m.name).toLowerCase().includes(q)) : all;
  const note = q ? `<div class="ch-found">Найдено ${log.length} из ${all.length}<button class="ch-found-x" onclick="chSetQM('')">сбросить</button></div>` : '';
  box.innerHTML = note + (log.length
    ? log.map(m => {
      const fc = m.fc || 'var(--te, #3ec0d0)';
      const facChip = m.fac ? `<span class="ch-msg-f" style="--fc:${m.fc || 'var(--t3)'}">${esc(m.fac)}</span>` : '';
      return `<div class="ch-msg${m.staff ? ' staff' : ''}" style="--fc:${fc}">
        <div class="ch-msg-av">${chAvatar(m.name, m.av)}</div>
        <div class="ch-msg-main">
          <div class="ch-msg-hd"><span class="ch-msg-a">${m.staff ? '🛡 ' : ''}${esc(m.name)}</span>${facChip}<span class="ch-msg-w">${chWhen(m.at)}</span></div>
          <div class="ch-msg-b">${chMark(m.body, q)}</div>
        </div>
      </div>`;
    }).join('')
    : `<div class="ch-empty">${q ? 'Ничего не нашлось.' : 'Тишина в эфире.'}</div>`);
  if (!q) box.scrollTop = box.scrollHeight;
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
    : '';
}
function chRenderStatus() {
  const el = document.getElementById('ch-status'); if (!el) return;
  el.title = CH.joined ? 'Канал открыт' : 'Переподключение…';
  el.classList.toggle('down', !CH.joined);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chMount);
else chMount();
