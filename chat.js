// © 2025–2026. Все права защищены.
// Проприетарное ПО. Использование, копирование, изменение и распространение
// без письменного разрешения правообладателя запрещены. См. файл LICENSE.
// ════════════════════════════════════════════════════════════════════════
//  ЧАТ «ГИПЕРСВЯЗЬ» — КОМНАТЫ И ЖИВОЙ РАЗГОВОР
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
//  По той же причине «печатает…» ходит строкой в chat_typing, а не броадкастом.
//
//  История — те же строки: в каждой комнате кольцо на 300 (см. _chat_rooms.sql).
//  Presence («На связи») остался на ОБЩЕМ публичном канале и отвечает «кто
//  сейчас в игре» — по комнатам его не разносим, чтобы состав закрытых комнат
//  не читался снаружи по именам топиков.
//
//  ⚠️ РАЗГОВОР, А НЕ ЛЕНТА (см. _chat_social.sql). Ответ цитатой, реакции,
//  правка и мягкий снос своей реплики, упоминания @, «печатает…». Правила
//  рисования, которые легко нарушить, доделывая:
//    • ПОДРЯД ИДУЩИЕ реплики одного автора склеиваются в блок — аватарка и
//      подпись рисуются один раз. Иначе десять «ага» подряд занимают экран.
//    • Лента НЕ ПРЫГАЕТ вниз, если человек читает историю выше: доскроллить
//      сами имеем право, только когда он и так внизу. Иначе новая реплика
//      выдёргивает из чтения. Не внизу — показываем пилюлю «N новых».
//    • Перерисовка лога — это innerHTML целиком, поэтому scrollTop
//      восстанавливаем вручную по приросту высоты (см. chRenderLog).
//
//  Зависит от: core.js (sb, apiFetch, dbGet, dbPost, dbPatch, dbDel, esc, toast,
//  user, userProfile).
// ════════════════════════════════════════════════════════════════════════

const CH = {
  rooms: [],          // [{room, scope, subj, name, subtitle}] — с сервера
  room: 'global',     // открытая комната
  logs: {},           // room → [{id,name,fac,fc,av,staff,body,at,re,ed,del,uid}]
  unread: {},         // room → сколько непрочитанных
  ment: {},           // room → сколько непрочитанных С УПОМИНАНИЕМ меня
  histAt: {},         // room → когда тянули историю
  rt: null,           // канал postgres_changes по всем комнатам (сообщения)
  rtRoom: null,       // канал открытой комнаты (реакции + «печатает…»)
  rtRoomKey: '',      // на какую комнату он подписан
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
  rx: {},             // msg_id → [{author_id, emoji, name}] — реакции
  reply: null,        // на какое сообщение отвечаем (id)
  edit: null,         // какое сообщение правим (id)
  pick: null,         // над каким сообщением раскрыта палитра реакций
  typ: {},            // author_id → {name, at} — кто печатает в открытой комнате
  typT: 0,            // когда сами последний раз докладывали, что печатаем
  typTick: null,      // таймер протухания «печатает…»
  stick: true,        // лента прижата к низу (можно доскроллить самим)
  fresh: 0,           // сколько новых реплик пришло, пока читали выше
  emo: false,         // раскрыта палитра значков у поля ввода
  at: -1,             // подсказка @: индекс подсвеченного имени (-1 = закрыта)
  atList: [],         // подсказка @: кандидаты
  hover: 0,           // над какой репликой стоит мышь (для общей панели действий)
  st: [],             // стикеры с сервера [{key,name,pack,ext,cfg}]
  stAt: 0,            // когда тянули список
  stOpen: false,      // раскрыта палитра стикеров
  stPick: null,       // стикер «на изготовке»: ждёт подпись и отправку
  stPack: '',         // открытый раздел палитры
  cap: 150,           // сколько последних реплик рисуем (остальные — по кнопке)
};
const CH_LOG_CAP = 300;   // столько же строк держит кольцо в базе
const CH_MSG_MAX = 500;
const CH_EDIT_MS = 15 * 60 * 1000;     // окно правки — как в chat_edit_guard()
const CH_GROUP_MS = 5 * 60 * 1000;     // склейка подряд идущих реплик автора
const CH_SS_KEY = 'wk_chat_logs';      // sessionStorage: кадр до ответа сервера
const CH_ROOM_KEY = 'wk_chat_room';    // localStorage: последняя открытая комната
const CH_GHOST_KEY = 'wk_chat_ghost';  // localStorage: режим невидимки
// Быстрые реакции: короткий ряд, а не полный набор символов Unicode — выбор
// из восьми делается за полсекунды, из шестидесяти не делается вовсе.
const CH_RX = ['👍', '🔥', '😄', '❤️', '😮', '😢', '🫡', '💀'];
const CH_EMO = [
  '😄','😁','😂','🤣','🙂','😉','😍','🤔','😐','😑','😏','😒','🤡','😞','😢','😭','😤','😡',
  '👍','👎','👌','🤝','🫡','🙏','👏','💪','🔥','✨','💀','☠️','👀','🧠','⚡','💥',
  '❤️','💔','⭐','🚀','🛰️','🪐','🌍','☄️','⚔️','🛡️','🏴','⚓','💰','📡','🔧','🍀',
];
// Значки-кнопки рисуем контуром, а не символами: смайлик в роли ИКОНКИ
// («ответить», «править») читается как содержание реплики, а не как действие.
const CH_ICO = {
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h7a6 6 0 0 1 6 6v3"/>',
  edit: '<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z"/>',
  del: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  rx: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01"/><path d="M9 15c.8.8 1.8 1.2 3 1.2s2.2-.4 3-1.2"/>',
  down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  // Щит стаффа и «значки» рисуем контуром: символьные ⛨/☺ на части систем
  // приходят тофу-квадратом, а в роли иконки читаются как содержание реплики.
  shield: '<path d="M12 3.5 5 6v5.5c0 4 2.9 7.4 7 8.9 4.1-1.5 7-4.9 7-8.9V6l-7-2.5z"/>',
  sticker: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5V14l-6 6H5.5A1.5 1.5 0 0 1 4 18.5v-13z"/><path d="M20 14h-4.5a1.5 1.5 0 0 0-1.5 1.5V20"/>',
  smile: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01"/><path d="M9 14.5c.8.9 1.8 1.3 3 1.3s2.2-.4 3-1.3"/>',
};
function chIco(k, sz) {
  return `<svg class="ch-ico" viewBox="0 0 24 24" width="${sz || 15}" height="${sz || 15}" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CH_ICO[k] || ''}</svg>`;
}

function chCanUse() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator', 'player'].includes(user.role)); }
function chIsStaff() { return !!(typeof user !== 'undefined' && user && ['superadmin', 'editor', 'moderator'].includes(user.role)); }
function chUid() { return (typeof user !== 'undefined' && user && user.id) || ''; }
function chMyName() {
  return (typeof userProfile !== 'undefined' && userProfile.display_name)
    || (typeof user !== 'undefined' && user && (user.email || '').split('@')[0])
    || 'Аноним';
}
function chLog(room) { return (CH.logs[room = room || CH.room] || (CH.logs[room] = [])); }
function chRoomInfo(key) { return CH.rooms.find(r => r.room === (key || CH.room)) || { room: key || CH.room, name: 'Комната', scope: '', subj: '', subtitle: '' }; }
function chUnreadTotal() { return Object.values(CH.unread).reduce((a, b) => a + b, 0); }
function chMentTotal() { return Object.values(CH.ment).reduce((a, b) => a + b, 0); }
function chById(id, room) { return chLog(room).find(m => m.id === id); }

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
// Разделитель дня. «Сегодня/Вчера» — потому что в живом чате дату читают
// относительно себя, а не по календарю.
function chDay(ts) {
  const d = new Date(ts), n = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  try { return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); } catch (e) { return ''; }
}
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
    uid: r.author_id || '',
    room: r.room || 'global',
    name: String(r.name || 'Аноним').slice(0, 40),
    fac: String(r.fac || '').slice(0, 60),
    fc: /^#[0-9a-fA-F]{3,8}$/.test(r.fc || '') ? r.fc : '',
    av: chAvUrl(r.av),
    staff: !!r.staff,
    body: String(r.body || '').slice(0, CH_MSG_MAX),
    at: r.created_at ? Date.parse(r.created_at) : Date.now(),
    st: r.st || '',
    sflag: chAvUrl(r.sflag),
    re: r.re || null,
    ed: r.ed ? Date.parse(r.ed) : 0,
    del: !!r.del,
  };
}
const CH_SEL = 'id,room,author_id,name,fac,fc,av,staff,body,created_at,re,ed,del,st,sflag';

async function chLoadRooms() {
  try {
    const rows = await dbPost('rpc/chat_my_rooms', {});
    if (!Array.isArray(rows)) return;
    CH.rooms = rows; CH.roomsAt = Date.now();
    let saved = ''; try { saved = localStorage.getItem(CH_ROOM_KEY) || ''; } catch (e) {}
    if (saved && rows.some(r => r.room === saved)) CH.room = saved;
    if (!rows.some(r => r.room === CH.room)) CH.room = 'global';
    chSubscribe(); chSubscribeRoom();
    if (CH.open) { chRenderRooms(); chHistory(CH.room); }
  } catch (e) {}
}
function chPickRoom(key) {
  if (key === CH.room) return;
  CH.room = key; CH.unread[key] = 0; CH.ment[key] = 0; chBadge();
  try { localStorage.setItem(CH_ROOM_KEY, key); } catch (e) {}
  CH.adding = false;
  CH.qm = '';                                  // поиск был по прежнему эфиру
  CH.reply = null; CH.edit = null; CH.pick = null; CH.emo = false; CH.stOpen = false; CH.stPick = null;
  CH.typ = {}; CH.stick = true; CH.fresh = 0; CH.cap = 150; CH.hover = 0;
  const fq = document.getElementById('ch-fq'); if (fq) fq.value = '';
  chSubscribeRoom();
  chRenderRooms(); chRenderLog(); chRenderCompose(); chHistory(key);
  document.getElementById('ch-inp')?.focus();
}

// ── Живая доставка: вставки в chat_messages по моим комнатам ────
// Один канал, по слушателю на комнату. Пакет отдаёт сервер, сверив строку с
// RLS подписчика, — чужая комната не долетит, даже если знать её ключ.
// Слушаем '*': правка и мягкий снос приходят UPDATE'ом той же строки.
function chSubscribe() {
  if (typeof sb === 'undefined' || !chCanUse() || !CH.rooms.length) return;
  if (CH.rt) { try { sb.removeChannel(CH.rt); } catch (e) {} CH.rt = null; }
  const ch = sb.channel('chat-rt-' + (chUid() || 'anon'));
  for (const r of CH.rooms) {
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'chat_messages', filter: `room=eq.${r.room}` },
      p => { if (p.eventType === 'DELETE') chOnDrop(p.old); else chOnRow(p.new); });
  }
  CH.rt = ch;
  ch.subscribe();
}
// Реакции и «печатает…» — только по ОТКРЫТОЙ комнате: держать их по всем
// двум десяткам комнат значит слать себе пакеты, которых никто не увидит.
function chSubscribeRoom() {
  if (typeof sb === 'undefined' || !chCanUse()) return;
  if (CH.rtRoomKey === CH.room && CH.rtRoom) return;
  if (CH.rtRoom) { try { sb.removeChannel(CH.rtRoom); } catch (e) {} CH.rtRoom = null; }
  const room = CH.rtRoomKey = CH.room;
  const ch = sb.channel('chat-room-' + room + '-' + (chUid() || 'anon'));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reactions', filter: `room=eq.${room}` },
    p => chOnRx(p));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_typing', filter: `room=eq.${room}` },
    p => chOnTyping(p));
  CH.rtRoom = ch;
  ch.subscribe();
}
// Упоминание меня — отдельный счёт: в общей комнате на сотню реплик обращение
// лично к тебе теряется, и обычный бейдж «новых 40» об этом ничего не говорит.
function chMentionsMe(body) {
  const nm = chMyName().toLowerCase();
  const s = String(body || '').toLowerCase();
  return s.includes('@' + nm) || s.includes('@все') || s.includes('@all');
}
function chOnRow(row) {
  if (!row || typeof row.body !== 'string') return;
  const m = chRow(row);
  const log = chLog(m.room);
  const i = log.findIndex(x => x.id === m.id);
  if (i >= 0) {                                            // правка / снос своей же строки
    log[i] = m; chSaveLog();
    if (CH.open && m.room === CH.room) chRenderLog();
    return;
  }
  log.push(m);
  if (log.length > CH_LOG_CAP) log.splice(0, log.length - CH_LOG_CAP);
  chSaveLog();
  const mine = m.uid && m.uid === chUid();
  if (!mine && chMentionsMe(m.body)) CH.ment[m.room] = (CH.ment[m.room] || 0) + 1;
  if (CH.open && m.room === CH.room) {
    if (!CH.stick && !mine) CH.fresh++;
    chRenderLog();
  } else {
    CH.unread[m.room] = (CH.unread[m.room] || 0) + 1;
    if (CH.open) chRenderRooms();
    if (!mine) chNudge();
  }
  chBadge();
}
function chOnDrop(old) {
  if (!old || !old.id) return;
  const room = old.room || CH.room;
  const log = CH.logs[room]; if (!log) return;
  const i = log.findIndex(x => x.id === old.id);
  if (i < 0) return;
  log.splice(i, 1); chSaveLog();
  if (CH.open && room === CH.room) chRenderLog();
}

// ── Реакции ────────────────────────────────────────────────────
function chOnRx(p) {
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (!row || !row.msg_id) return;
  const arr = CH.rx[row.msg_id] || (CH.rx[row.msg_id] = []);
  const i = arr.findIndex(x => x.author_id === row.author_id && x.emoji === row.emoji);
  if (p.eventType === 'DELETE') { if (i >= 0) arr.splice(i, 1); }
  else if (i < 0) arr.push({ author_id: row.author_id, emoji: row.emoji, name: row.name || '' });
  if (CH.open && (row.room === CH.room)) chRenderLog();
}
async function chLoadRx(room) {
  try {
    const rows = await dbGet('chat_reactions', `room=eq.${encodeURIComponent(room)}&select=msg_id,emoji,author_id,name`);
    if (!Array.isArray(rows)) return;
    for (const m of chLog(room)) delete CH.rx[m.id];
    for (const r of rows) (CH.rx[r.msg_id] || (CH.rx[r.msg_id] = [])).push(r);
    if (CH.open && room === CH.room) chRenderLog();
  } catch (e) {}
}
// Тумблер: своя реакция снимается тем же нажатием, что и ставится.
async function chRx(id, emoji) {
  const uid = chUid(); if (!uid) return;
  const m = chById(id); if (!m) return;
  CH.pick = null;
  const arr = CH.rx[id] || (CH.rx[id] = []);
  const mine = arr.find(x => x.author_id === uid && x.emoji === emoji);
  try {
    if (mine) {
      arr.splice(arr.indexOf(mine), 1); chRenderLog();
      await dbDel('chat_reactions', `msg_id=eq.${id}&emoji=eq.${encodeURIComponent(emoji)}&author_id=eq.${uid}`);
    } else {
      arr.push({ author_id: uid, emoji, name: chMyName() }); chRenderLog();
      await dbPost('chat_reactions', { msg_id: id, emoji, room: m.room, name: chMyName() });
    }
  } catch (e) { chLoadRx(m.room); toast('Реакция не прошла: ' + (e.message || 'нет связи'), 'err'); }
}
function chPick(id) { CH.pick = (CH.pick === id) ? null : id; chRenderLog(); }

// ── История комнаты (последние 300) ────────────────────────────
async function chHistory(room, force) {
  if (!force && CH.histAt[room] && Date.now() - CH.histAt[room] < 120000) return;
  CH.histAt[room] = Date.now();
  try {
    const rows = await dbGet('chat_messages', `room=eq.${encodeURIComponent(room)}&select=${CH_SEL}&order=id.desc&limit=${CH_LOG_CAP}`);
    if (!Array.isArray(rows)) return;
    const hist = rows.reverse().map(chRow);
    const ids = new Set(hist.map(m => m.id));
    const live = (CH.logs[room] || []).filter(m => m.id && !ids.has(m.id));
    CH.logs[room] = hist.concat(live).slice(-CH_LOG_CAP);
    chSaveLog();
    if (CH.open && room === CH.room) chRenderLog();
    chLoadRx(room);
  } catch (e) { CH.histAt[room] = 0; }
}

// Моя фракция (название+цвет) — один запрос за сессию, дальше из памяти
async function chLoadFaction() {
  if (CH.facLoaded || typeof user === 'undefined' || !user) return;
  CH.facLoaded = true;
  try {
    const rows = await dbGet('faction_applications', `owner_id=eq.${user.id}&status=eq.approved&select=name,color,herald_url&limit=1`);
    if (rows && rows[0]) CH.fac = { name: rows[0].name || '', color: rows[0].color || '', herald: chAvUrl(rows[0].herald_url) };
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
  // Волна — отдельным узлом: обе псевдоэлементные подложки кнопки уже заняты
  // рамкой и фоном (канон срезанного угла), третьего слоя у них нет.
  fab.innerHTML = '<span class="ch-fab-wave" aria-hidden="true"></span>'
    + '<svg class="ch-fab-ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4c-1.2 0-2.4-.2-3.4-.7L3 21l1.8-4.4A8.4 8.4 0 1 1 21 11.5z"/></svg>'
    + '<span id="ch-fab-badge" class="ch-fab-badge" style="display:none">0</span>';
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
    CH.unread[CH.room] = 0; CH.ment[CH.room] = 0; CH.stick = true; CH.fresh = 0; chBadge();
    chConnect();
    chRender();
    if (!CH.rooms.length || Date.now() - CH.roomsAt > 120000) chLoadRooms();
    chSubscribeRoom();
    // Флаг державы тянем и здесь: раньше он приезжал только в колбэке presence,
    // и если канал не поднялся, стикер уходил БЕЗ флага — то есть без главного.
    chLoadFaction();
    chLoadStickers();
    chHistory(CH.room);
    if (!CH.typTick) CH.typTick = setInterval(chTypingSweep, 2000);
    setTimeout(() => document.getElementById('ch-inp')?.focus(), 60);
  } else {
    if (CH.typTick) { clearInterval(CH.typTick); CH.typTick = null; }
    chTypingStop();
  }
}
// ⚠️ КНОПКА ДОЛЖНА ЗВАТЬ, А НЕ ЖДАТЬ. В покое она серая и сливается со стеной —
// это правильно, пока эфир молчит. Но с непрочитанными она оживает: цвет
// акцента + редкая расходящаяся волна, а на каждую НОВУЮ реплику — короткий
// тик. Анимируем только transform/opacity (композитор), никаких фильтров:
// кнопка висит поверх карты, и фильтр на ней тянул бы за собой весь кадр.
function chBadge() {
  const b = document.getElementById('ch-fab-badge'), fab = document.getElementById('ch-fab');
  if (!b) return;
  const n = chUnreadTotal(), mt = chMentTotal();
  b.style.display = n > 0 ? '' : 'none';
  b.classList.toggle('ment', mt > 0);          // обращались лично — цвет другой
  b.textContent = mt > 0 ? '@' : (n > 9 ? '9+' : String(n));
  if (!fab) return;
  fab.classList.toggle('has', n > 0 && !CH.open);
  fab.classList.toggle('ment', mt > 0 && !CH.open);
}
// Тик на приход реплики: один короткий кивок, а не вечное дёрганье — вечное
// глаз отфильтровывает за минуту и перестаёт замечать вовсе.
function chNudge() {
  const fab = document.getElementById('ch-fab');
  if (!fab || CH.open) return;
  fab.classList.remove('nudge'); void fab.offsetWidth; fab.classList.add('nudge');
  setTimeout(() => fab.classList.remove('nudge'), 700);
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

// ── «Печатает…» ────────────────────────────────────────────────
// Докладываем не чаще раза в 3 с и только пока в поле что-то есть; читатель
// сам гасит запись через 6 с (chTypingSweep) — «висящих» печатающих не бывает.
function chTypingPing() {
  if (CH.ghost || !chCanUse()) return;
  const now = Date.now();
  if (now - CH.typT < 3000) return;
  CH.typT = now;
  const room = CH.room;
  apiFetch('chat_typing', {
    method: 'POST',
    body: JSON.stringify({ room, author_id: chUid(), name: chMyName(), at: new Date().toISOString() }),
    headers2: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
  }).catch(() => {});
}
function chTypingStop() {
  CH.typT = 0;
  const uid = chUid(); if (!uid) return;
  dbDel('chat_typing', `author_id=eq.${uid}`).catch(() => {});
}
function chOnTyping(p) {
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (!row || !row.author_id || row.author_id === chUid()) return;
  if (p.eventType === 'DELETE') delete CH.typ[row.author_id];
  else CH.typ[row.author_id] = { name: row.name || 'Кто-то', at: Date.parse(row.at) || Date.now() };
  chRenderTyping();
}
function chTypingSweep() {
  const cut = Date.now() - 6000; let dirty = false;
  for (const k of Object.keys(CH.typ)) if (CH.typ[k].at < cut) { delete CH.typ[k]; dirty = true; }
  if (dirty) chRenderTyping();
}

// ── Отправка, правка, снос ─────────────────────────────────────
async function chSend() {
  const inp = document.getElementById('ch-inp'); if (!inp) return;
  if (CH.edit) return chEditSave();
  if (CH.stPick) return chStSend(CH.stPick, inp.value || '');
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
      re: CH.reply || null,
    });
    CH.lastSent = now;
    inp.value = ''; chGrow(inp);
    CH.reply = null; CH.emo = false; CH.stOpen = false; CH.at = -1;
    CH.stick = true; CH.fresh = 0;
    chTypingStop();
    chRenderCompose();
    if (Array.isArray(rows) && rows[0]) chOnRow(rows[0]);   // своя строка сразу, не дожидаясь эха
  } catch (e) { toast('Не отправилось: ' + (e.message || 'нет связи'), 'err'); }
  finally { CH.busy = false; inp.focus(); }
}
function chCanEdit(m) { return !!m && !m.del && m.uid && m.uid === chUid() && Date.now() - m.at < CH_EDIT_MS; }
function chCanDrop(m) { return !!m && !m.del && m.uid && m.uid === chUid(); }
function chReply(id) {
  const m = chById(id); if (!m || m.del) return;
  CH.reply = id; CH.edit = null; CH.pick = null;
  chRenderCompose(); chRenderLog();
  document.getElementById('ch-inp')?.focus();
}
function chReplyCancel() { CH.reply = null; chRenderCompose(); }
function chEditStart(id) {
  const m = chById(id); if (!chCanEdit(m)) return;
  CH.edit = id; CH.reply = null; CH.pick = null;
  const inp = document.getElementById('ch-inp');
  chRenderCompose();
  if (inp) { inp.value = m.body; chGrow(inp); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  chRenderLog();
}
function chEditCancel() {
  CH.edit = null;
  const inp = document.getElementById('ch-inp'); if (inp) { inp.value = ''; chGrow(inp); }
  chRenderCompose(); chRenderLog();
}
async function chEditSave() {
  const id = CH.edit, inp = document.getElementById('ch-inp');
  const m = chById(id); if (!m || !inp) return chEditCancel();
  const body = (inp.value || '').trim().slice(0, CH_MSG_MAX);
  if (!body) return chEditCancel();
  if (body === m.body) return chEditCancel();
  try {
    const rows = await dbPatch('chat_messages', `id=eq.${id}`, { body });
    if (Array.isArray(rows) && rows[0]) chOnRow(rows[0]);
    chEditCancel();
  } catch (e) { toast(e.message || 'правка не прошла', 'err'); }
}
// Снос МЯГКИЙ: строка остаётся заглушкой, чтобы ответы на неё не повисли.
// Стафф сносит чужое насмерть — это модерация, а не «забрал слово».
async function chDrop(id) {
  const m = chById(id); if (!m) return;
  const mine = chCanDrop(m);
  if (!mine && !chIsStaff()) return;
  if (!confirm(mine ? 'Забрать слово назад?' : 'Снести чужую реплику из эфира?')) return;
  try {
    if (mine) {
      const rows = await dbPatch('chat_messages', `id=eq.${id}`, { del: true });
      if (Array.isArray(rows) && rows[0]) chOnRow(rows[0]);
    } else {
      await dbDel('chat_messages', `id=eq.${id}`);
      chOnDrop({ id, room: m.room });
    }
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}
// Прыжок к цитируемой реплике: подсветить на секунду, иначе непонятно, куда
// именно перенесло.
function chGoto(id) {
  const el = document.getElementById('ch-m-' + id);
  if (!el) { toast('Эта реплика уже выпала из эфира', 'err'); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

// ── Стикеры ────────────────────────────────────────────────────
// Картинки лежат в assets/stickers (батник tools/stickers.bat), в базе —
// только ключ и раскладка (см. _chat_stickers.sql). Рисует общий stHtml()
// из chat_sticker.js: одна отрисовка на палитру, ленту и редактор в админке.
async function chLoadStickers(force) {
  if (!force && CH.st.length && Date.now() - CH.stAt < 300000) return;
  CH.stAt = Date.now();
  try {
    const rows = await dbGet('chat_stickers', 'enabled=eq.true&select=key,name,pack,ext,cfg,ord&order=ord.asc,key.asc');
    if (!Array.isArray(rows)) return;
    CH.st = rows;
    if (!CH.stPack || !rows.some(r => (r.pack || 'Общие') === CH.stPack)) CH.stPack = (rows[0] && rows[0].pack) || 'Общие';
    if (CH.stOpen) chRenderCompose();
  } catch (e) { CH.stAt = 0; }
}
function chStPacks() { return [...new Set(CH.st.map(r => r.pack || 'Общие'))]; }
function chStToggle() {
  CH.stOpen = !CH.stOpen;
  if (CH.stOpen) { CH.emo = false; chLoadStickers(); }
  chRenderCompose();
}
function chStPack(p) { CH.stPack = p; chRenderCompose(); }
// Клик по стикеру: если подпись пишет отправитель — стикер встаёт «на
// изготовку» и ждёт текст (иначе нельзя было бы подписать), иначе уходит сразу.
function chStClick(key) {
  const s = CH.st.find(x => x.key === key); if (!s) return;
  const mode = stCfg(s.cfg).text.mode;
  if (mode === 'author' && stCfg(s.cfg).text.on) {
    CH.stPick = key; CH.stOpen = false; chRenderCompose();
    document.getElementById('ch-inp')?.focus();
  } else chStSend(key, '');
}
function chStCancel() { CH.stPick = null; chRenderCompose(); document.getElementById('ch-inp')?.focus(); }
async function chStSend(key, text) {
  const s = CH.st.find(x => x.key === key); if (!s || CH.busy) return;
  const now = Date.now();
  if (now - CH.lastSent < 2000) { toast('Не так быстро — раз в пару секунд', 'err'); return; }
  CH.busy = true;
  const inp = document.getElementById('ch-inp');
  try {
    const rows = await dbPost('chat_messages', {
      room: CH.room, body: String(text || '').trim().slice(0, 120) || '·',
      name: chMyName(), staff: chIsStaff(),
      fac: CH.fac?.name || '', fc: CH.fac?.color || '', av: chMyAvatar(),
      st: key, sflag: CH.fac?.herald || '', re: CH.reply || null,
    });
    CH.lastSent = now; CH.stPick = null; CH.stOpen = false; CH.reply = null;
    CH.stick = true; CH.fresh = 0;
    if (inp) { inp.value = ''; chGrow(inp); }
    chTypingStop(); chRenderCompose();
    if (Array.isArray(rows) && rows[0]) chOnRow(rows[0]);
  } catch (e) { toast('Стикер не ушёл: ' + (e.message || 'нет связи'), 'err'); }
  finally { CH.busy = false; inp?.focus(); }
}
// Стикер в ленте. Подпись «·» — служебная заглушка (тело не может быть пустым
// по RLS), показывать её не надо.
function chStBody(m) {
  const s = CH.st.find(x => x.key === m.st);
  if (!s) return `<i class="ch-gone">стикер «${esc(m.st)}» снят</i>`;
  return `<div class="ch-st-msg">${stHtml(s, { text: m.body === '·' ? '' : m.body, name: m.name, flag: m.sflag, size: 210 })}</div>`;
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
    delete CH.logs[key]; delete CH.unread[key]; delete CH.ment[key];
    CH.room = 'global';
    await chLoadRooms();
    chSubscribeRoom(); chRenderLog();
    toast('Комната снесена', 'ok');
  } catch (e) { toast(e.message || 'не вышло', 'err'); }
}

// ── Разметка реплики ───────────────────────────────────────────
// Разбираем СЫРОЙ текст на куски и экранируем каждый по отдельности: если
// сперва экранировать всё, а потом гонять регулярки, они начинают цепляться
// за &amp; и рвать разметку изнутри.
const CH_TOK = /`([^`\n]{1,300})`|\*\*([^*\n]{1,300})\*\*|~~([^~\n]{1,300})~~|\*([^*\n]{1,300})\*|(https?:\/\/[^\s<>"']+)/g;
// Имена для упоминаний: кто на связи + кто говорил в этой комнате. Длинные
// вперёд, иначе «@Иван» съест начало «@Иван Грозный».
function chNames() {
  const set = new Set();
  for (const o of CH.online) if (o && o.name) set.add(o.name);
  for (const m of chLog()) if (m.name) set.add(m.name);
  set.add(chMyName());
  return [...set].sort((a, b) => b.length - a.length);
}
function chMentionize(plain) {
  const names = chNames(), my = chMyName().toLowerCase();
  let out = '', i = 0;
  while (i < plain.length) {
    const at = plain.indexOf('@', i);
    if (at < 0) { out += esc(plain.slice(i)); break; }
    out += esc(plain.slice(i, at));
    const tail = plain.slice(at + 1);
    let hit = names.find(n => tail.toLowerCase().startsWith(n.toLowerCase()));
    if (!hit && /^(все|all)\b/i.test(tail)) hit = tail.slice(0, tail.match(/^(все|all)/i)[0].length);
    if (hit) {
      const me = hit.toLowerCase() === my || /^(все|all)$/i.test(hit);
      out += `<span class="ch-at${me ? ' me' : ''}">@${esc(hit)}</span>`;
      i = at + 1 + hit.length;
    } else { out += '@'; i = at + 1; }
  }
  return out;
}
function chFmt(raw) {
  const s = String(raw || '');
  let out = '', last = 0, m;
  CH_TOK.lastIndex = 0;
  while ((m = CH_TOK.exec(s))) {
    out += chMentionize(s.slice(last, m.index));
    if (m[1] != null) out += `<code class="ch-code">${esc(m[1])}</code>`;
    else if (m[2] != null) out += `<b>${chMentionize(m[2])}</b>`;
    else if (m[3] != null) out += `<s>${chMentionize(m[3])}</s>`;
    else if (m[4] != null) out += `<i>${chMentionize(m[4])}</i>`;
    else if (m[5] != null) {
      const u = m[5].replace(/[.,;:!?)]+$/, '');            // хвостовая пунктуация — не часть ссылки
      out += `<a class="ch-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u)}</a>`;
      out += esc(m[5].slice(u.length));
    }
    last = m.index + m[0].length;
  }
  out += chMentionize(s.slice(last));
  return out;
}
function chMark(s, q) {
  const t = esc(s);
  if (!q) return t;
  const i = s.toLowerCase().indexOf(q);
  if (i < 0) return t;
  return esc(s.slice(0, i)) + '<mark class="ch-hit">' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
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
      <button class="ch-x" onclick="chToggle()" title="Закрыть">${chIco('close', 16)}</button>
    </div>
    <div class="ch-body">
      <div class="ch-side">
        <div class="ch-rooms" id="ch-rooms"></div>
        <div class="ch-side-t">На связи <b id="ch-online-n">0</b></div>
        <div class="ch-side-list" id="ch-online-list"></div>
      </div>
      <div class="ch-main">
        <select class="ch-room-sel" id="ch-room-sel" onchange="chPickRoom(this.value)"></select>
        <div class="ch-log-wrap">
          <div class="ch-log" id="ch-log" onscroll="chOnScroll()" onmouseover="chActsOver(event)" onmouseleave="CH.hover=0;chRenderActs()"></div>
          <div class="ch-acts" id="ch-acts" style="display:none"></div>
          <button class="ch-down" id="ch-down" onclick="chToBottom()" style="display:none">${chIco('down', 14)}<span id="ch-down-n"></span></button>
        </div>
        <div class="ch-typing" id="ch-typing"></div>
        <div id="ch-compose"></div>
      </div>
    </div>
  </div>`;
  chRenderRooms(); chRenderLog(); chRenderCompose(); chRenderOnline(); chRenderStatus();
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
    const n = CH.unread[r.room] || 0, mt = CH.ment[r.room] || 0;
    const shut = r.scope !== 'global' && r.scope !== 'fishing';
    const del = r.room === CH.room && r.room.startsWith('r:')
      ? `<span class="ch-room-x" onclick="event.stopPropagation();chRoomDelete()" title="Снести комнату">✕</span>` : '';
    return `<button class="ch-room${r.room === CH.room ? ' on' : ''}" onclick="chPickRoom('${esc(r.room)}')" title="${esc(r.subtitle || '')}">
      <span class="ch-room-n">${shut ? '<span class="ch-room-lock" title="закрытый эфир">⌁</span>' : ''}${esc(r.name)}</span>
      ${mt ? '<i class="ch-room-b ment" title="обращались лично к тебе">@</i>' : ''}
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

// Реакции под репликой: считаем по значку, свою подсвечиваем, в подсказке —
// имена (иначе «5 огней» ничего не говорят о том, кто именно согласился).
function chRxRow(id) {
  const arr = CH.rx[id] || [];
  if (!arr.length && CH.pick !== id) return '';
  const by = new Map();
  for (const r of arr) {
    if (!by.has(r.emoji)) by.set(r.emoji, { n: 0, mine: false, who: [] });
    const g = by.get(r.emoji);
    g.n++; g.who.push(r.name || '???');
    if (r.author_id === chUid()) g.mine = true;
  }
  const chips = [...by.entries()].map(([e, g]) =>
    `<button class="ch-rx${g.mine ? ' mine' : ''}" onclick="chRx(${id},'${esc(e)}')" title="${esc(g.who.join(', '))}">
      <span class="ch-rx-e">${esc(e)}</span><span class="ch-rx-n">${g.n}</span></button>`).join('');
  const pal = CH.pick === id
    ? `<span class="ch-rx-pal">${CH_RX.map(e => `<button class="ch-rx-p" onclick="chRx(${id},'${esc(e)}')">${esc(e)}</button>`).join('')}</span>`
    : '';
  return `<div class="ch-rx-row">${chips}${pal}</div>`;
}
// Цитата над репликой. Тело режем до одной строки: цитата — это напоминание
// «о чём речь», а не второй экземпляр сообщения.
function chQuote(m) {
  if (!m.re) return '';
  const src = chById(m.re);
  if (!src) return `<div class="ch-quo gone">реплика выпала из эфира</div>`;
  const cut = src.body.replace(/\s+/g, ' ').slice(0, 90);
  return `<div class="ch-quo" style="--fc:${src.fc || 'var(--te, #3ec0d0)'}" onclick="chGoto(${src.id})" title="Перейти к реплике">
    <span class="ch-quo-a">${esc(src.name)}</span><span class="ch-quo-b">${esc(cut)}${src.body.length > 90 ? '…' : ''}</span></div>`;
}
function chRenderLog() {
  const box = document.getElementById('ch-log'); if (!box) return;
  const all = chLog();
  const q = CH.qm.trim().toLowerCase();
  const log = q ? all.filter(m => (m.body + ' ' + m.name).toLowerCase().includes(q)) : all;
  const note = q ? `<div class="ch-found">Найдено ${log.length} из ${all.length}<button class="ch-found-x" onclick="chSetQM('')">сбросить</button></div>` : '';

  // Держим место в ленте: innerHTML стирает scrollTop, поэтому считаем прирост
  // высоты и возвращаем взгляд на ту же строку.
  const before = box.scrollHeight, top = box.scrollTop;

  // ⚠️ РИСУЕМ ХВОСТ, А НЕ ВСЁ КОЛЬЦО. В комнате лежит до 300 реплик; на каждую
  // приходится узел с подложкой, цитатой и реакциями, и перерисовка лога (а она
  // тут — innerHTML целиком) начинала подтормаживать вместе со всей страницей.
  // Показываем последние CH.cap, остальное — по кнопке.
  const hid = Math.max(0, log.length - CH.cap);
  const view = hid ? log.slice(hid) : log;
  const more = hid ? `<button class="ch-more" onclick="chMore()">Показать ещё ${hid > 150 ? 150 : hid} · раньше</button>` : '';

  let html = note + more, prev = null, day = '';
  for (const m of view) {
    const d = chDay(m.at);
    if (d !== day) { day = d; prev = null; html += `<div class="ch-day"><span>${esc(d)}</span></div>`; }
    // Склейка: тот же автор, меньше пяти минут, и это не ответ (у ответа своя шапка-цитата).
    const cont = !q && prev && prev.name === m.name && prev.uid === m.uid && !m.re && (m.at - prev.at) < CH_GROUP_MS;
    const fc = m.fc || 'var(--te, #3ec0d0)';
    const facChip = m.fac ? `<span class="ch-msg-f" style="--fc:${m.fc || 'var(--t3)'}">${esc(m.fac)}</span>` : '';
    html += `<div class="ch-msg${m.staff ? ' staff' : ''}${cont ? ' cont' : ''}${m.del ? ' gone' : ''}${CH.edit === m.id ? ' editing' : ''}${CH.reply === m.id ? ' replying' : ''}" id="ch-m-${m.id}" style="--fc:${fc}">
      <div class="ch-msg-av">${cont ? `<span class="ch-msg-tw">${chWhen(m.at)}</span>` : chAvatar(m.name, m.av)}</div>
      <div class="ch-msg-main">
        ${cont ? '' : `<div class="ch-msg-hd"><span class="ch-msg-a">${m.staff ? `<span class="ch-shield" title="администрация">${chIco('shield', 12)}</span>` : ''}${esc(m.name)}</span>${facChip}<span class="ch-msg-w">${chWhen(m.at)}</span></div>`}
        ${chQuote(m)}
        <div class="ch-msg-b">${m.del ? '<i class="ch-gone">слово забрано назад</i>' : (m.st ? chStBody(m) : (q ? chMark(m.body, q) : chFmt(m.body)))}${m.ed && !m.del ? '<span class="ch-ed" title="правлено">· правлено</span>' : ''}</div>
        ${chRxRow(m.id)}
      </div>
    </div>`;
    prev = m;
  }
  box.innerHTML = html || `<div class="ch-empty">${q ? 'Ничего не нашлось.' : 'Тишина в эфире.'}</div>`;

  if (q) { box.scrollTop = 0; }
  else if (CH.stick) { box.scrollTop = box.scrollHeight; CH.fresh = 0; }
  else { box.scrollTop = top + (box.scrollHeight - before); }
  chRenderDown(); chRenderActs();
}
// Пилюля «N новых»: показываем ТОЛЬКО когда человек читает выше — внизу она
// была бы враньём (всё и так видно).
function chRenderDown() {
  const b = document.getElementById('ch-down'); if (!b) return;
  const show = !CH.stick && !CH.qm.trim();
  b.style.display = show ? '' : 'none';
  const n = document.getElementById('ch-down-n');
  if (n) n.textContent = CH.fresh > 0 ? (CH.fresh > 99 ? '99+' : String(CH.fresh)) + ' новых' : '';
}
function chOnScroll() {
  const box = document.getElementById('ch-log'); if (!box) return;
  const at = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (at !== CH.stick) { CH.stick = at; if (at) CH.fresh = 0; chRenderDown(); }
  chPlaceActs();
}
function chMore() { CH.cap += 150; chRenderLog(); }

// ── Панель действий: ОДНА на весь лог ──────────────────────────
// Рисовать по четыре кнопки в каждой реплике значит держать в DOM больше тысячи
// узлов со значками ради четырёх, видимых под курсором. Панель одна, а ездит по
// наведению; при скролле её просто пересчитываем.
function chActsOver(e) {
  const el = e.target.closest && e.target.closest('.ch-msg');
  const id = el ? +el.id.slice(5) : 0;
  if (id === CH.hover) return chPlaceActs();
  CH.hover = id;
  chRenderActs();
}
function chRenderActs() {
  const box = document.getElementById('ch-acts'); if (!box) return;
  const m = CH.hover ? chById(CH.hover) : null;
  if (!m || m.del) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const mine = m.uid && m.uid === chUid();
  box.innerHTML = `<button class="ch-act" onclick="chPick(${m.id})" title="Реакция">${chIco('rx')}</button>
    <button class="ch-act" onclick="chReply(${m.id})" title="Ответить">${chIco('reply')}</button>
    ${chCanEdit(m) ? `<button class="ch-act" onclick="chEditStart(${m.id})" title="Править (15 мин)">${chIco('edit')}</button>` : ''}
    ${(chCanDrop(m) || chIsStaff()) ? `<button class="ch-act warn" onclick="chDrop(${m.id})" title="${mine ? 'Забрать слово' : 'Снести (модерация)'}">${chIco('del')}</button>` : ''}`;
  box.style.display = 'flex';
  chPlaceActs();
}
function chPlaceActs() {
  const box = document.getElementById('ch-acts'), log = document.getElementById('ch-log');
  if (!box || !log || box.style.display === 'none') return;
  const el = document.getElementById('ch-m-' + CH.hover);
  if (!el) { box.style.display = 'none'; return; }
  const y = el.offsetTop - log.scrollTop - 9;
  // Уехала за край ленты — прячем, иначе панель висит над чужой строкой.
  if (y < -4 || y > log.clientHeight - 12) { box.style.display = 'none'; return; }
  box.style.top = y + 'px';
}
function chToBottom() {
  const box = document.getElementById('ch-log'); if (!box) return;
  CH.stick = true; CH.fresh = 0;
  box.scrollTop = box.scrollHeight;
  chRenderDown();
}
function chRenderTyping() {
  const el = document.getElementById('ch-typing'); if (!el) return;
  const who = Object.values(CH.typ).map(t => t.name);
  el.innerHTML = who.length
    ? `<span class="ch-dots"><i></i><i></i><i></i></span>${esc(who.length > 2 ? who.length + ' человек печатают' : who.join(' и ') + (who.length > 1 ? ' печатают' : ' печатает'))}`
    : '';
  el.classList.toggle('on', !!who.length);
}

// ── Поле ввода: ответ/правка сверху, палитра значков, подсказка @ ──
function chRenderCompose() {
  const box = document.getElementById('ch-compose'); if (!box) return;
  const inp = document.getElementById('ch-inp');
  const keep = inp ? inp.value : '';
  const rep = CH.reply ? chById(CH.reply) : null;
  const bar = CH.edit
    ? `<div class="ch-bar edit"><span class="ch-bar-t">Правишь свою реплику</span>
        <button class="ch-bar-x" onclick="chEditCancel()">${chIco('close', 13)}</button></div>`
    : rep
      ? `<div class="ch-bar" style="--fc:${rep.fc || 'var(--te, #3ec0d0)'}">
          <span class="ch-bar-t">В ответ <b>${esc(rep.name)}</b>: ${esc(rep.body.replace(/\s+/g, ' ').slice(0, 60))}${rep.body.length > 60 ? '…' : ''}</span>
          <button class="ch-bar-x" onclick="chReplyCancel()">${chIco('close', 13)}</button></div>`
      : '';
  // Стикер «на изготовке» — своя плашка: видно, что именно уйдёт, и подпись
  // печатается в то же поле, что и обычная реплика (второго ввода не заводим).
  const pick = CH.stPick ? CH.st.find(x => x.key === CH.stPick) : null;
  const pickBar = pick ? `<div class="ch-bar st">
      <span class="ch-st-mini">${stHtml(pick, { flag: CH.fac?.herald || '', size: 34 })}</span>
      <span class="ch-bar-t">Стикер <b>${esc(pick.name || pick.key)}</b> · подпись печатай ниже, Enter — отправить</span>
      <button class="ch-bar-x" onclick="chStCancel()">${chIco('close', 13)}</button></div>` : '';

  box.innerHTML = `${bar}${pickBar}
    ${CH.stOpen ? chStPanel() : ''}
    ${CH.emo ? `<div class="ch-emo">${CH_EMO.map(e => `<button class="ch-emo-b" onclick="chPutEmo('${esc(e)}')">${esc(e)}</button>`).join('')}</div>` : ''}
    <div class="ch-at-box" id="ch-at-box"></div>
    <div class="ch-input-row">
      <div class="ch-inp-wrap">
        <textarea id="ch-inp" class="ch-inp" rows="1" maxlength="${CH_MSG_MAX}"
          placeholder="${CH.edit ? 'Правь и жми Enter' : 'Сообщение · Enter — передать, Shift+Enter — новая строка'}" autocomplete="off"></textarea>
        <button class="ch-emo-t${CH.emo ? ' on' : ''}" onclick="chEmoToggle()" title="Значки" type="button">${chIco('smile', 16)}</button>
        <button class="ch-st-t${CH.stOpen ? ' on' : ''}" onclick="chStToggle()" title="Стикеры" type="button">${chIco('sticker', 16)}</button>
      </div>
      <button class="ch-send" onclick="chSend()">${CH.edit ? 'Сохранить' : 'Передать'}</button>
    </div>`;
  const t = document.getElementById('ch-inp');
  if (t) {
    t.value = keep;
    t.oninput = () => { chGrow(t); chTypingPing(); chAtScan(t); };
    t.onkeydown = chKey;
    chGrow(t);
  }
}
// Палитра: разделы сверху (их заводит админка полем pack), сетка превью ниже.
// Превью рисуем тем же stHtml с МОИМ флагом — видно, как стикер будет выглядеть
// именно у тебя, а не абстрактную картинку.
function chStPanel() {
  if (!CH.st.length) return `<div class="ch-st-pan empty">Стикеров пока нет. Их заводит администрация: батник tools\stickers.bat + вкладка «Стикеры» в админке.</div>`;
  const packs = chStPacks();
  const list = CH.st.filter(x => (x.pack || 'Общие') === CH.stPack);
  return `<div class="ch-st-pan">
    ${packs.length > 1 ? `<div class="ch-st-packs">${packs.map(p => `<button class="ch-st-pk${p === CH.stPack ? ' on' : ''}" onclick="chStPack('${esc(p)}')">${esc(p)}</button>`).join('')}</div>` : ''}
    <div class="ch-st-grid">${list.map(x => `<button class="ch-st-b" onclick="chStClick('${esc(x.key)}')" title="${esc(x.name || x.key)}">
      ${stHtml(x, { flag: CH.fac?.herald || '', name: chMyName(), size: 64 })}</button>`).join('')}</div>
  </div>`;
}
function chGrow(t) {
  if (!t) return;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 132) + 'px';
}
function chEmoToggle() { CH.emo = !CH.emo; chRenderCompose(); document.getElementById('ch-inp')?.focus(); }
function chPutEmo(e) {
  const t = document.getElementById('ch-inp'); if (!t) return;
  const a = t.selectionStart || 0, b = t.selectionEnd || 0;
  t.value = t.value.slice(0, a) + e + t.value.slice(b);
  t.focus(); t.setSelectionRange(a + e.length, a + e.length);
  chGrow(t);
}
// Подсказка @: разбираем ХВОСТ строки до курсора. Список — те, кто на связи и
// кто говорил в комнате: звать по имени человека, которого тут нет, незачем.
function chAtScan(t) {
  const upto = t.value.slice(0, t.selectionStart || 0);
  const m = upto.match(/(?:^|\s)@([^\s@]{0,24})$/);
  if (!m) { if (CH.at >= 0) { CH.at = -1; CH.atList = []; chRenderAt(); } return; }
  const q = m[1].toLowerCase();
  CH.atList = chNames().filter(n => n.toLowerCase().includes(q) && n !== chMyName()).slice(0, 6);
  if (!q) CH.atList = CH.atList.slice(0, 6);
  CH.at = CH.atList.length ? 0 : -1;
  chRenderAt();
}
function chRenderAt() {
  const box = document.getElementById('ch-at-box'); if (!box) return;
  box.innerHTML = (CH.at >= 0 && CH.atList.length)
    ? CH.atList.map((n, i) => `<button class="ch-at-i${i === CH.at ? ' on' : ''}" onmousedown="event.preventDefault();chAtPick(${i})">${esc(n)}</button>`).join('')
    : '';
  box.classList.toggle('on', CH.at >= 0 && !!CH.atList.length);
}
function chAtPick(i) {
  const t = document.getElementById('ch-inp'); if (!t || !CH.atList[i]) return;
  const pos = t.selectionStart || 0;
  const upto = t.value.slice(0, pos);
  const m = upto.match(/(?:^|\s)@([^\s@]{0,24})$/); if (!m) return;
  const start = pos - m[1].length - 1;
  const ins = '@' + CH.atList[i] + ' ';
  t.value = t.value.slice(0, start) + ins + t.value.slice(pos);
  CH.at = -1; CH.atList = []; chRenderAt();
  t.focus(); t.setSelectionRange(start + ins.length, start + ins.length);
  chGrow(t);
}
function chKey(e) {
  if (CH.at >= 0 && CH.atList.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); CH.at = (CH.at + 1) % CH.atList.length; return chRenderAt(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); CH.at = (CH.at - 1 + CH.atList.length) % CH.atList.length; return chRenderAt(); }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return chAtPick(CH.at); }
    if (e.key === 'Escape') { e.preventDefault(); CH.at = -1; CH.atList = []; return chRenderAt(); }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chSend(); return; }
  if (e.key === 'Escape') {
    if (CH.edit) { e.preventDefault(); chEditCancel(); }
    else if (CH.reply) { e.preventDefault(); chReplyCancel(); }
    else if (CH.stPick) { e.preventDefault(); chStCancel(); }
    else if (CH.stOpen) { e.preventDefault(); chStToggle(); }
    else if (CH.emo) { e.preventDefault(); chEmoToggle(); }
    return;
  }
  // ↑ на пустом поле — править последнюю свою реплику (как в терминале).
  if (e.key === 'ArrowUp' && !e.target.value && !CH.edit) {
    const mine = [...chLog()].reverse().find(m => chCanEdit(m));
    if (mine) { e.preventDefault(); chEditStart(mine.id); }
  }
}
function chRenderOnline() {
  const n = document.getElementById('ch-online-n'); if (n) n.textContent = String(CH.online.length);
  const list = document.getElementById('ch-online-list'); if (!list) return;
  list.innerHTML = CH.online.length
    ? CH.online.map(o => {
      const fc = (/^#[0-9a-fA-F]{3,8}$/.test(o.fc || '') ? o.fc : '') || 'var(--te, #3ec0d0)';
      return `<div class="ch-who" style="--fc:${fc}" onclick="chAtName('${esc(String(o.name || '').replace(/'/g, "\\'"))}')" title="Позвать в реплике">
        <span class="ch-who-dot"></span>
        <span class="ch-who-n">${o.staff ? `<span class="ch-shield">${chIco('shield', 11)}</span>` : ''}${esc(o.name || '')}</span>
        ${o.fac ? `<span class="ch-who-f">${esc(o.fac)}</span>` : ''}
      </div>`;
    }).join('')
    : '';
}
function chAtName(name) {
  const t = document.getElementById('ch-inp'); if (!t || !name) return;
  const pre = t.value && !/\s$/.test(t.value) ? ' ' : '';
  t.value += pre + '@' + name + ' ';
  t.focus(); chGrow(t);
}
function chRenderStatus() {
  const el = document.getElementById('ch-status'); if (!el) return;
  el.title = CH.joined ? 'Канал открыт' : 'Переподключение…';
  el.classList.toggle('down', !CH.joined);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chMount);
else chMount();
